import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChannelType } from '@prisma/client';
import { MetaConfig } from '@common/config/configuration';

/**
 * How a failed Graph call should be handled.
 *
 * - transient: try again later (network, 5xx, rate limits)
 * - auth: the channel token is invalid or expired — retrying cannot help until it is replaced
 * - window: outside the 24-hour customer-service window; only a new customer message reopens it
 * - permanent: the request itself is wrong (bad recipient, blocked user…)
 */
export type GraphErrorKind = 'transient' | 'auth' | 'window' | 'permanent';

export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly kind: GraphErrorKind,
    readonly code: number | null = null,
    readonly subcode: number | null = null,
  ) {
    super(message);
    this.name = 'GraphApiError';
  }
}

const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80007, 130429, 131016]);
const AUTH_CODES = new Set([102, 190, 463, 467]);

export function classifyGraphError(
  httpStatus: number,
  code: number | null,
  subcode: number | null,
): GraphErrorKind {
  if (code !== null && AUTH_CODES.has(code)) return 'auth';
  // WhatsApp 131047 / Messenger 10+2018278: replying after the 24h window closed.
  if (code === 131047 || (code === 10 && subcode === 2018278)) return 'window';
  if (code !== null && TRANSIENT_CODES.has(code)) return 'transient';
  if (httpStatus === 401) return 'auth';
  if (httpStatus === 429 || httpStatus >= 500) return 'transient';
  return 'permanent';
}

export interface GraphChannel {
  type: ChannelType;
  /** phone_number_id, page id or IG account id */
  externalId: string;
  accessToken: string;
}

const TIMEOUT_MS = 15_000;

/**
 * Thin client for the Graph API calls the platform makes. Kept behind an injectable so
 * tests replace it and never reach Meta.
 */
@Injectable()
export class MetaGraphClient {
  private readonly logger = new Logger(MetaGraphClient.name);
  private readonly config: MetaConfig;

  constructor(config: ConfigService) {
    this.config = config.getOrThrow<MetaConfig>('meta');
  }

  /** Sends a text reply and returns the provider's message id. */
  async sendText(channel: GraphChannel, recipient: string, text: string): Promise<string> {
    if (channel.type === ChannelType.WHATSAPP) {
      const result = await this.request<{ messages?: { id: string }[] }>(
        `/${channel.externalId}/messages`,
        channel.accessToken,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'text',
          text: { body: text, preview_url: false },
        },
      );
      const id = result.messages?.[0]?.id;
      if (!id) throw new GraphApiError('Graph response carried no message id', 'transient');
      return id;
    }

    // Messenger and Instagram share the Send API on the page token.
    const result = await this.request<{ message_id?: string }>(
      `/me/messages`,
      channel.accessToken,
      {
        recipient: { id: recipient },
        messaging_type: 'RESPONSE',
        message: { text },
      },
    );
    if (!result.message_id)
      throw new GraphApiError('Graph response carried no message id', 'transient');
    return result.message_id;
  }

  /** Confirms the token can read the account, and returns a display name for it. */
  async describeAccount(channel: GraphChannel): Promise<string> {
    const fields =
      channel.type === ChannelType.WHATSAPP
        ? 'display_phone_number,verified_name'
        : channel.type === ChannelType.INSTAGRAM
          ? 'username,name'
          : 'name';

    const account = await this.request<Record<string, string | undefined>>(
      `/${channel.externalId}?fields=${fields}`,
      channel.accessToken,
    );

    return (
      account.verified_name ??
      account.display_phone_number ??
      account.username ??
      account.name ??
      channel.externalId
    );
  }

  private async request<T>(path: string, token: string, body?: unknown): Promise<T> {
    const url = `${this.config.graphBaseUrl}/${this.config.graphVersion}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new GraphApiError(
        `Graph API unreachable: ${error instanceof Error ? error.message : String(error)}`,
        'transient',
      );
    }

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number; error_subcode?: number };
    };

    if (!response.ok || payload.error) {
      const code = payload.error?.code ?? null;
      const subcode = payload.error?.error_subcode ?? null;
      const kind = classifyGraphError(response.status, code, subcode);
      const message = payload.error?.message ?? `HTTP ${response.status}`;

      this.logger.warn(`Graph ${path} failed (${kind}, code ${code ?? '-'}): ${message}`);
      throw new GraphApiError(message, kind, code, subcode);
    }

    return payload as T;
  }
}
