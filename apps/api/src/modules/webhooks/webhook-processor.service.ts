import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { WorkerConfig } from '@common/config/configuration';
import { AppClsStore, CLS_KEYS } from '@common/context/request-context';
import { PrismaService } from '@common/prisma/prisma.service';
import { AiResponderService } from '@modules/ai/ai-responder.service';
import { ChannelsService } from '@modules/channels/channels.service';
import { MessagesService } from '@modules/messages/messages.service';
import { StoredMetaEvent } from './webhooks.service';

const MAX_ATTEMPTS = 5;

interface ClaimedEvent {
  id: string;
  companyId: string | null;
  payload: Prisma.JsonValue;
}

/**
 * Turns stored webhook events into customers, conversations, messages and delivery
 * updates.
 *
 * The webhook_events table is the inbox. An event is claimed with one conditional
 * UPDATE before it is handled, so concurrent workers (other API instances, the sweep)
 * never process it twice; recordInbound is idempotent on the provider message id as a
 * second line of defence. Failures are kept with their error and retried with backoff.
 */
@Injectable()
export class WebhookProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookProcessorService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly channels: ChannelsService,
    private readonly ai: AiResponderService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = this.config.get<WorkerConfig>('worker')?.sweepIntervalMs ?? 0;
    if (interval > 0) {
      this.timer = setInterval(() => void this.sweep(), interval);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Processes events in order: one customer's messages must land in the order sent. */
  async processMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.process(id);
    }
  }

  /** Never throws; the outcome is recorded on the event row. */
  async process(id: string): Promise<void> {
    let claimed: ClaimedEvent | null = null;

    try {
      claimed = await this.claim(id);
      if (!claimed) return;

      const event = claimed.payload as unknown as StoredMetaEvent;

      // Workers have no request: the tenant comes from the connection the event matched.
      await this.cls.run(async () => {
        this.cls.set(CLS_KEYS.COMPANY_ID, claimed!.companyId as string);
        await this.handle(event);
      });

      await this.prisma.webhookEvent.update({
        where: { id },
        data: { status: 'PROCESSED', processedAt: new Date(), error: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Webhook event ${id} failed: ${message}`);

      if (claimed) {
        await this.prisma.webhookEvent
          .update({ where: { id }, data: { status: 'FAILED', error: message.slice(0, 1000) } })
          .catch(() => undefined);
      }
    }
  }

  /** Picks up events that were never processed, failed, or were abandoned mid-way. */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;

    try {
      const due = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM webhook_events
        WHERE attempts < ${MAX_ATTEMPTS}
          AND "companyId" IS NOT NULL
          AND (
            (status = 'RECEIVED' AND "createdAt" < NOW() - INTERVAL '10 seconds')
            OR (status = 'FAILED' AND "createdAt" < NOW() - INTERVAL '30 seconds' * power(2, attempts))
            OR (status = 'PROCESSING' AND "createdAt" < NOW() - INTERVAL '10 minutes')
          )
        ORDER BY "createdAt"
        LIMIT 100
      `;

      await this.processMany(due.map((row) => row.id));
      return due.length;
    } catch (error) {
      this.logger.error(
        'Webhook sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  private async claim(id: string): Promise<ClaimedEvent | null> {
    const rows = await this.prisma.$queryRaw<ClaimedEvent[]>`
      UPDATE webhook_events
      SET status = 'PROCESSING', attempts = attempts + 1
      WHERE id = ${id}
        AND "companyId" IS NOT NULL
        AND attempts < ${MAX_ATTEMPTS}
        AND (
          status IN ('RECEIVED', 'FAILED')
          OR (status = 'PROCESSING' AND "createdAt" < NOW() - INTERVAL '10 minutes')
        )
      RETURNING id, "companyId", payload
    `;
    return rows[0] ?? null;
  }

  private async handle(event: StoredMetaEvent): Promise<void> {
    if (event.kind === 'status') {
      await this.messages.applyDeliveryStatus(event.messageExternalId, event.status, event.error);
      return;
    }

    const inbound = await this.messages.recordInbound({
      sender: {
        channel: event.channel,
        platformUserId: event.sender.platformUserId,
        displayName: event.sender.displayName,
        phone: event.sender.phone,
      },
      channelId: event.channelId,
      externalId: event.eventId,
      type: event.type,
      content: event.content,
      mediaUrl: event.mediaUrl,
      metadata: (event.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      receivedAt: new Date(event.timestamp),
    });

    await this.channels.touch(event.channelId);

    // Not awaited: writing a reply takes seconds and must not hold up the next event.
    // The tenant context set for this event carries over into the reply.
    if (!inbound.duplicate) {
      void this.ai.onInbound(inbound.conversationId);
    }
  }
}
