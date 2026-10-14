import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WebhookEventStatus } from '@prisma/client';
import { AppConfig, MetaConfig } from '@common/config/configuration';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { UnauthorizedAppException } from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { ChannelsService } from '@modules/channels/channels.service';
import { MetaEvent, parseMetaWebhook } from './meta-webhook.parser';
import { isValidMetaSignature } from './webhook-signature';

/** What is stored per event: the normalized event plus the connection it resolved to. */
export type StoredMetaEvent = MetaEvent & { channelId: string };

export interface IngestResult {
  received: number;
  /** Event ids to process, in the order Meta sent them. */
  queued: string[];
}

/**
 * Receiving side of the Meta webhooks.
 *
 * Meta expects a 200 within a few seconds and retries otherwise, so this only verifies,
 * parses and stores; processing happens after the response. Each event is stored once —
 * the unique (channel, externalEventId) key turns Meta's redeliveries into no-ops.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly meta: MetaConfig;
  private readonly production: boolean;
  private warnedUnsigned = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    config: ConfigService,
  ) {
    this.meta = config.getOrThrow<MetaConfig>('meta');
    this.production = config.get<AppConfig>('app')?.nodeEnv === 'production';
  }

  /** The GET handshake Meta performs when the callback URL is saved in the app dashboard. */
  verifySubscription(mode: string | undefined, token: string | undefined): boolean {
    return (
      mode === 'subscribe' && Boolean(this.meta.verifyToken) && token === this.meta.verifyToken
    );
  }

  async ingest(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    payload: unknown,
  ): Promise<IngestResult> {
    const signatureValid = this.checkSignature(rawBody, signature);

    const events = parseMetaWebhook(payload);
    if (events.length === 0) {
      return { received: 0, queued: [] };
    }

    const accounts = [
      ...new Map(events.map((event) => [`${event.channel}:${event.accountId}`, event])).values(),
    ].map((event) => ({ type: event.channel, externalId: event.accountId }));

    const connections = new Map(
      (await this.channels.findByAccounts(accounts)).map((connection) => [
        `${connection.type}:${connection.externalId}`,
        connection,
      ]),
    );

    const rows: Prisma.WebhookEventCreateManyInput[] = events.map((event) => {
      const connection = connections.get(`${event.channel}:${event.accountId}`);
      const usable = connection?.isActive === true;

      return {
        companyId: connection?.companyId ?? null,
        channel: event.channel,
        externalEventId: event.eventId,
        signatureValid,
        payload: {
          ...event,
          channelId: connection?.id ?? null,
        } as unknown as Prisma.InputJsonValue,
        status: usable ? WebhookEventStatus.RECEIVED : WebhookEventStatus.IGNORED,
        error: !connection
          ? `No connection for ${event.channel} account ${event.accountId}`
          : !usable
            ? 'Channel is disabled'
            : null,
      };
    });

    const stored = await this.prisma.webhookEvent.createManyAndReturn({
      data: rows,
      skipDuplicates: true,
      select: { id: true, externalEventId: true, status: true },
    });

    const order = new Map(events.map((event, index) => [event.eventId, index]));
    const queued = stored
      .filter((row) => row.status === WebhookEventStatus.RECEIVED)
      .sort((a, b) => (order.get(a.externalEventId) ?? 0) - (order.get(b.externalEventId) ?? 0))
      .map((row) => row.id);

    if (stored.length < events.length) {
      this.logger.debug(`Skipped ${events.length - stored.length} redelivered webhook event(s)`);
    }

    return { received: events.length, queued };
  }

  /**
   * Without an app secret nothing can be verified. That is tolerated in development (so
   * the flow can be tried with curl) but refused in production.
   */
  private checkSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    if (!this.meta.appSecret) {
      if (this.production) {
        this.logger.error('META_APP_SECRET is not set; rejecting webhook');
        throw this.invalidSignature();
      }
      if (!this.warnedUnsigned) {
        this.logger.warn(
          'META_APP_SECRET is not set; accepting unsigned webhooks (development only)',
        );
        this.warnedUnsigned = true;
      }
      return false;
    }

    if (!isValidMetaSignature(rawBody, signature, this.meta.appSecret)) {
      this.logger.warn('Rejected a webhook with a missing or invalid signature');
      throw this.invalidSignature();
    }
    return true;
  }

  private invalidSignature(): UnauthorizedAppException {
    return new UnauthorizedAppException(
      'توقيع الطلب غير صالح',
      ERROR_CODE.WEBHOOK_SIGNATURE_INVALID,
    );
  }
}
