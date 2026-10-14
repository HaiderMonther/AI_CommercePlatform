import { ChannelType, MessageDeliveryStatus, MessageType } from '@prisma/client';

/**
 * Turns Meta webhook payloads (WhatsApp Cloud API, Messenger, Instagram messaging) into
 * one flat list of events the rest of the platform understands.
 *
 * Pure and defensive: Meta adds fields and event kinds over time, so anything unknown is
 * skipped rather than failing the whole delivery — a thrown parser would make Meta retry
 * the batch forever.
 */

export interface InboundMessageEvent {
  kind: 'message';
  channel: ChannelType;
  /** The business account the event belongs to: phone_number_id, page id or IG account id. */
  accountId: string;
  /** Provider message id (wamid / mid). Doubles as the idempotency key. */
  eventId: string;
  sender: {
    platformUserId: string;
    displayName: string | null;
    /** WhatsApp senders are identified by their number. */
    phone: string | null;
  };
  type: MessageType;
  content: string;
  mediaUrl: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface DeliveryStatusEvent {
  kind: 'status';
  channel: ChannelType;
  accountId: string;
  eventId: string;
  /** Provider id of the message we sent. */
  messageExternalId: string;
  status: MessageDeliveryStatus;
  error: string | null;
  timestamp: string;
}

export type MetaEvent = InboundMessageEvent | DeliveryStatusEvent;

/** Content stored for messages that carry no text of their own. */
export const MEDIA_PLACEHOLDER: Record<string, string> = {
  IMAGE: '[صورة]',
  AUDIO: '[رسالة صوتية]',
  VIDEO: '[فيديو]',
  FILE: '[ملف]',
  LOCATION: '[موقع]',
  STICKER: '[ملصق]',
  UNSUPPORTED: '[رسالة غير مدعومة]',
};

type Json = Record<string, unknown>;

const asObject = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0
    ? value
    : typeof value === 'number'
      ? String(value)
      : null;

/** Meta sends seconds (WhatsApp, as a string) or milliseconds (Messenger, as a number). */
function toIso(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return new Date().toISOString();
  }
  return new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString();
}

export function parseMetaWebhook(payload: unknown): MetaEvent[] {
  const body = asObject(payload);
  if (!body) return [];

  switch (body.object) {
    case 'whatsapp_business_account':
      return parseWhatsApp(body);
    case 'page':
      return parseMessaging(body, ChannelType.FACEBOOK);
    case 'instagram':
      return parseMessaging(body, ChannelType.INSTAGRAM);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------------------
// WhatsApp Cloud API
// ---------------------------------------------------------------------------------------

const WHATSAPP_STATUS: Record<string, MessageDeliveryStatus> = {
  sent: MessageDeliveryStatus.SENT,
  delivered: MessageDeliveryStatus.DELIVERED,
  read: MessageDeliveryStatus.READ,
  failed: MessageDeliveryStatus.FAILED,
};

function parseWhatsApp(body: Json): MetaEvent[] {
  const events: MetaEvent[] = [];

  for (const entry of asArray(body.entry)) {
    for (const change of asArray(asObject(entry)?.changes)) {
      const changeObject = asObject(change);
      if (changeObject?.field !== 'messages') continue;

      const value = asObject(changeObject.value);
      const accountId = asString(asObject(value?.metadata)?.phone_number_id);
      if (!value || !accountId) continue;

      const names = new Map<string, string>();
      for (const contact of asArray(value.contacts)) {
        const waId = asString(asObject(contact)?.wa_id);
        const name = asString(asObject(asObject(contact)?.profile)?.name);
        if (waId && name) names.set(waId, name);
      }

      for (const raw of asArray(value.messages)) {
        const message = parseWhatsAppMessage(asObject(raw), accountId, names);
        if (message) events.push(message);
      }

      for (const raw of asArray(value.statuses)) {
        const status = asObject(raw);
        const id = asString(status?.id);
        const mapped = WHATSAPP_STATUS[asString(status?.status) ?? ''];
        if (!status || !id || !mapped) continue;

        const firstError = asObject(asArray(status.errors)[0]);
        events.push({
          kind: 'status',
          channel: ChannelType.WHATSAPP,
          accountId,
          eventId: `${id}:${mapped}`,
          messageExternalId: id,
          status: mapped,
          error: firstError
            ? [
                asString(firstError.code),
                asString(firstError.title) ?? asString(firstError.message),
              ]
                .filter(Boolean)
                .join(' - ')
            : null,
          timestamp: toIso(status.timestamp),
        });
      }
    }
  }

  return events;
}

function parseWhatsAppMessage(
  message: Json | null,
  accountId: string,
  names: Map<string, string>,
): InboundMessageEvent | null {
  const id = asString(message?.id);
  const from = asString(message?.from);
  if (!message || !id || !from) return null;

  const kind = asString(message.type) ?? 'unsupported';
  const base = {
    kind: 'message' as const,
    channel: ChannelType.WHATSAPP,
    accountId,
    eventId: id,
    sender: { platformUserId: from, displayName: names.get(from) ?? null, phone: `+${from}` },
    mediaUrl: null,
    timestamp: toIso(message.timestamp),
  };

  const media = (type: MessageType, placeholder: string) => {
    const part = asObject(message[kind]);
    const caption = asString(part?.caption);
    return {
      ...base,
      type,
      content:
        caption ?? (kind === 'document' ? (asString(part?.filename) ?? placeholder) : placeholder),
      // Cloud API media is fetched by id with the channel token; the id is kept for that.
      metadata: { mediaId: asString(part?.id), mimeType: asString(part?.mime_type) },
    };
  };

  switch (kind) {
    case 'text':
      return {
        ...base,
        type: MessageType.TEXT,
        content: asString(asObject(message.text)?.body) ?? '',
        metadata: null,
      };
    case 'image':
      return media(MessageType.IMAGE, MEDIA_PLACEHOLDER.IMAGE);
    case 'sticker':
      return media(MessageType.IMAGE, MEDIA_PLACEHOLDER.STICKER);
    case 'audio':
      return media(MessageType.AUDIO, MEDIA_PLACEHOLDER.AUDIO);
    case 'video':
      return media(MessageType.VIDEO, MEDIA_PLACEHOLDER.VIDEO);
    case 'document':
      return media(MessageType.FILE, MEDIA_PLACEHOLDER.FILE);
    case 'location': {
      const location = asObject(message.location);
      return {
        ...base,
        type: MessageType.LOCATION,
        content:
          [asString(location?.name), asString(location?.address)].filter(Boolean).join(' - ') ||
          MEDIA_PLACEHOLDER.LOCATION,
        metadata: { latitude: location?.latitude ?? null, longitude: location?.longitude ?? null },
      };
    }
    case 'button':
      return {
        ...base,
        type: MessageType.TEXT,
        content: asString(asObject(message.button)?.text) ?? '',
        metadata: null,
      };
    case 'interactive': {
      const interactive = asObject(message.interactive);
      const reply = asObject(interactive?.button_reply) ?? asObject(interactive?.list_reply);
      return {
        ...base,
        type: MessageType.TEXT,
        content: asString(reply?.title) ?? MEDIA_PLACEHOLDER.UNSUPPORTED,
        metadata: reply ? { replyId: asString(reply.id) } : null,
      };
    }
    // A reaction annotates an earlier message; it is not a message of its own.
    case 'reaction':
      return null;
    default:
      return {
        ...base,
        type: MessageType.TEXT,
        content: MEDIA_PLACEHOLDER.UNSUPPORTED,
        metadata: { providerType: kind },
      };
  }
}

// ---------------------------------------------------------------------------------------
// Messenger and Instagram (Messenger Platform)
// ---------------------------------------------------------------------------------------

const ATTACHMENT_TYPE: Record<string, MessageType> = {
  image: MessageType.IMAGE,
  audio: MessageType.AUDIO,
  video: MessageType.VIDEO,
  file: MessageType.FILE,
  location: MessageType.LOCATION,
};

function parseMessaging(body: Json, channel: ChannelType): MetaEvent[] {
  const events: MetaEvent[] = [];

  for (const rawEntry of asArray(body.entry)) {
    const entry = asObject(rawEntry);
    const accountId = asString(entry?.id);
    if (!entry || !accountId) continue;

    for (const rawItem of asArray(entry.messaging)) {
      const item = asObject(rawItem);
      const senderId = asString(asObject(item?.sender)?.id);
      if (!item || !senderId) continue;

      const message = asObject(item.message);

      // Echoes are our own outbound messages (or ones sent from Meta's inbox) coming back.
      if (message && message.is_echo !== true && senderId !== accountId) {
        const parsed = parseMessagingMessage(message, channel, accountId, senderId, item.timestamp);
        if (parsed) events.push(parsed);
      }

      const delivery = asObject(item.delivery);
      for (const mid of asArray(delivery?.mids)) {
        const id = asString(mid);
        if (!id) continue;
        events.push({
          kind: 'status',
          channel,
          accountId,
          eventId: `${id}:${MessageDeliveryStatus.DELIVERED}`,
          messageExternalId: id,
          status: MessageDeliveryStatus.DELIVERED,
          error: null,
          timestamp: toIso(item.timestamp),
        });
      }
    }
  }

  return events;
}

function parseMessagingMessage(
  message: Json,
  channel: ChannelType,
  accountId: string,
  senderId: string,
  timestamp: unknown,
): InboundMessageEvent | null {
  const mid = asString(message.mid);
  if (!mid) return null;

  const base = {
    kind: 'message' as const,
    channel,
    accountId,
    eventId: mid,
    sender: { platformUserId: senderId, displayName: null, phone: null },
    timestamp: toIso(timestamp),
  };

  const text = asString(message.text);
  const attachment = asObject(asArray(message.attachments)[0]);

  if (!attachment) {
    return text
      ? { ...base, type: MessageType.TEXT, content: text, mediaUrl: null, metadata: null }
      : null;
  }

  const kind = asString(attachment.type) ?? 'file';
  const type = ATTACHMENT_TYPE[kind] ?? MessageType.FILE;
  const payload = asObject(attachment.payload);

  return {
    ...base,
    type,
    content: text ?? MEDIA_PLACEHOLDER[type] ?? MEDIA_PLACEHOLDER.FILE,
    // Messenger CDN links expire after a while; good enough to preview, not to archive.
    mediaUrl: asString(payload?.url),
    metadata: { providerType: kind },
  };
}
