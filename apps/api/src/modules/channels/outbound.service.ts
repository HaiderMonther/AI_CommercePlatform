import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType, MessageDeliveryStatus } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { WorkerConfig } from '@common/config/configuration';
import { AppClsStore, CLS_KEYS } from '@common/context/request-context';
import { PrismaService } from '@common/prisma/prisma.service';
import { ConversationsService } from '@modules/conversations/conversations.service';
import { MESSAGE_SELECT } from '@modules/messages/message.select';
import { RealtimeService } from '@modules/realtime/realtime.service';
import { ChannelsService } from './channels.service';
import { GraphApiError, MetaGraphClient } from './meta-graph.client';

const MAX_ATTEMPTS = 5;
/** A claimed message is not picked up again for this long, even if its sender died. */
const LEASE_MS = 60_000;
const BASE_BACKOFF_MS = 15_000;
const SWEEP_BATCH = 50;

const CHANNEL_NAMES: Record<ChannelType, string> = {
  WHATSAPP: 'واتساب',
  INSTAGRAM: 'إنستغرام',
  FACEBOOK: 'ماسنجر',
};

export const DELIVERY_FAILURE = {
  NO_CHANNEL: (type: ChannelType) => `لا توجد قناة ${CHANNEL_NAMES[type]} مفعّلة لدى المتجر`,
  NO_RECIPIENT: 'لا يوجد حساب أو رقم للزبون على هذه القناة',
  AUTH: 'رمز وصول القناة غير صالح أو منتهي، حدّثه من إعدادات القنوات',
  WINDOW:
    'مرّت أكثر من 24 ساعة على آخر رسالة من الزبون، ولا تسمح Meta بالرد حتى يراسل المتجر مجدداً',
  EXHAUSTED: 'تعذّر الإرسال بعد عدة محاولات',
  EXPIRED: 'انتهت مهلة الإرسال',
  REJECTED: (detail: string) => `رفضت Meta الرسالة: ${detail}`,
} as const;

/** A permanent problem found before calling Meta. */
class UndeliverableError extends Error {}

interface ClaimedMessage {
  id: string;
  companyId: string;
  conversationId: string;
  content: string;
  attempts: number;
}

/**
 * Delivers outbound messages to WhatsApp, Messenger and Instagram.
 *
 * The messages table is the outbox: a reply is committed as PENDING with the rest of the
 * conversation update, then dispatched. Each attempt first claims the row with a short
 * lease in a single UPDATE, so two API instances (or the inline send and the sweep) can
 * never send the same message twice. Transient failures back off and are retried by the
 * sweep; permanent ones become FAILED with a reason the agent can act on.
 */
@Injectable()
export class OutboundService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboundService.name);
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly graph: MetaGraphClient,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimeService,
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

  /** Attempts delivery of one message. Never throws: failures are recorded on the message. */
  async dispatch(messageId: string): Promise<void> {
    try {
      const claimed = await this.claim(messageId);
      if (claimed) {
        await this.cls.run(async () => {
          this.cls.set(CLS_KEYS.COMPANY_ID, claimed.companyId);
          await this.deliver(claimed);
        });
      }
    } catch (error) {
      this.logger.error(
        `Dispatch of message ${messageId} crashed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Retries due messages and gives up on ones too old to deliver. Returns how many it tried. */
  async sweep(): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;

    try {
      await this.expireStale();

      const due = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM messages
        WHERE direction = 'OUTBOUND'
          AND "deliveryStatus" = 'PENDING'
          -- Meta refuses replies 24h after the customer's last message.
          AND "createdAt" > NOW() - INTERVAL '24 hours'
          AND COALESCE((metadata #>> '{delivery,notBefore}')::bigint, 0) <= ${Date.now()}::bigint
        ORDER BY "createdAt"
        LIMIT ${SWEEP_BATCH}
      `;

      for (const { id } of due) {
        await this.dispatch(id);
      }
      return due.length;
    } catch (error) {
      this.logger.error(
        'Outbound sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Takes the message for one attempt: bumps the attempt count and sets a lease, only if
   * it is still pending, not leased, and has attempts left.
   */
  private async claim(messageId: string): Promise<ClaimedMessage | null> {
    const now = Date.now();

    const rows = await this.prisma.$queryRaw<ClaimedMessage[]>`
      UPDATE messages
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
            'delivery', jsonb_build_object(
              'attempts', COALESCE((metadata #>> '{delivery,attempts}')::int, 0) + 1,
              'notBefore', ${now + LEASE_MS}::bigint
            )
          )
      WHERE id = ${messageId}
        AND direction = 'OUTBOUND'
        AND "deliveryStatus" = 'PENDING'
        AND COALESCE((metadata #>> '{delivery,notBefore}')::bigint, 0) <= ${now}::bigint
        AND COALESCE((metadata #>> '{delivery,attempts}')::int, 0) < ${MAX_ATTEMPTS}
      RETURNING id,
                "companyId",
                "conversationId",
                content,
                (metadata #>> '{delivery,attempts}')::int AS attempts
    `;

    return rows[0] ?? null;
  }

  private async deliver(message: ClaimedMessage): Promise<void> {
    let channelId: string | null = null;

    try {
      const conversation = await this.prisma.conversation.findFirstOrThrow({
        where: { id: message.conversationId, companyId: message.companyId },
        select: {
          channel: true,
          channelId: true,
          customer: {
            select: {
              phone: true,
              identities: { select: { channel: true, platformUserId: true } },
            },
          },
        },
      });

      const channel = await this.channels.resolveForOutbound(
        message.companyId,
        conversation.channel,
        conversation.channelId,
      );
      if (!channel) {
        throw new UndeliverableError(DELIVERY_FAILURE.NO_CHANNEL(conversation.channel));
      }
      channelId = channel.id;

      const recipient =
        conversation.customer.identities.find(
          (identity) => identity.channel === conversation.channel,
        )?.platformUserId ??
        (conversation.channel === ChannelType.WHATSAPP
          ? conversation.customer.phone?.replace(/^\+/, '')
          : undefined);
      if (!recipient) {
        throw new UndeliverableError(DELIVERY_FAILURE.NO_RECIPIENT);
      }

      const externalId = await this.graph.sendText(channel, recipient, message.content);

      await this.prisma.message.update({
        where: { id: message.id },
        data: {
          deliveryStatus: MessageDeliveryStatus.SENT,
          externalId,
          failureReason: null,
        },
      });
      await this.channels.markHealthy(channel.id);
    } catch (error) {
      const outcome = this.outcomeOf(error, message.attempts);

      if (outcome.retryAt) {
        await this.prisma.$executeRaw`
          UPDATE messages
          SET metadata = jsonb_set(metadata, '{delivery,notBefore}', to_jsonb(${outcome.retryAt}::bigint))
          WHERE id = ${message.id}
        `;
        this.logger.warn(
          `Message ${message.id} attempt ${message.attempts} failed, retrying: ${outcome.log}`,
        );
        return;
      }

      await this.prisma.message.update({
        where: { id: message.id },
        data: { deliveryStatus: MessageDeliveryStatus.FAILED, failureReason: outcome.reason },
      });
      if (outcome.channelBroken && channelId) {
        await this.channels.markError(channelId, outcome.log);
      }
      this.logger.warn(`Message ${message.id} failed permanently: ${outcome.log}`);
    }

    await this.publish(message.id, message.conversationId);
  }

  private outcomeOf(
    error: unknown,
    attempts: number,
  ): { retryAt?: number; reason: string; log: string; channelBroken?: boolean } {
    if (error instanceof UndeliverableError) {
      return { reason: error.message, log: error.message };
    }

    if (error instanceof GraphApiError) {
      switch (error.kind) {
        case 'transient':
          return attempts < MAX_ATTEMPTS
            ? {
                retryAt: Date.now() + BASE_BACKOFF_MS * 2 ** (attempts - 1),
                reason: '',
                log: error.message,
              }
            : { reason: DELIVERY_FAILURE.EXHAUSTED, log: error.message };
        case 'auth':
          return { reason: DELIVERY_FAILURE.AUTH, log: error.message, channelBroken: true };
        case 'window':
          return { reason: DELIVERY_FAILURE.WINDOW, log: error.message };
        default:
          return {
            reason: DELIVERY_FAILURE.REJECTED(error.message).slice(0, 500),
            log: error.message,
          };
      }
    }

    // Unexpected (a decrypt failure, a missing encryption key): retrying will not fix it.
    const detail = error instanceof Error ? error.message : String(error);
    return { reason: detail.slice(0, 500), log: detail };
  }

  /** Pending replies older than Meta's reply window can no longer be delivered. */
  private async expireStale(): Promise<void> {
    const expired = await this.prisma.$queryRaw<
      { id: string; conversationId: string; companyId: string }[]
    >`
      UPDATE messages
      SET "deliveryStatus" = 'FAILED', "failureReason" = ${DELIVERY_FAILURE.EXPIRED}
      WHERE direction = 'OUTBOUND'
        AND "deliveryStatus" = 'PENDING'
        AND "createdAt" <= NOW() - INTERVAL '24 hours'
      RETURNING id, "conversationId", "companyId"
    `;

    for (const row of expired) {
      await this.cls.run(async () => {
        this.cls.set(CLS_KEYS.COMPANY_ID, row.companyId);
        await this.publish(row.id, row.conversationId);
      });
    }
  }

  /** Pushes the new delivery state to the open thread and the inbox row. */
  private async publish(messageId: string, conversationId: string): Promise<void> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: MESSAGE_SELECT,
    });
    if (message) {
      this.realtime.messageUpdated(conversationId, message);
    }
    await this.conversations.publish(conversationId);
  }
}
