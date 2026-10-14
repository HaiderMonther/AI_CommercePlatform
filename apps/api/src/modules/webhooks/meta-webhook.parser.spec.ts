import { MEDIA_PLACEHOLDER, parseMetaWebhook } from './meta-webhook.parser';
import { isValidMetaSignature, signMetaPayload } from './webhook-signature';

const whatsapp = (value: Record<string, unknown>) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1001' }, ...value },
        },
      ],
    },
  ],
});

describe('parseMetaWebhook — WhatsApp', () => {
  it('parses a text message with the sender name and number', () => {
    const events = parseMetaWebhook(
      whatsapp({
        contacts: [{ wa_id: '9647701234567', profile: { name: 'Ali' } }],
        messages: [
          {
            from: '9647701234567',
            id: 'wamid.1',
            timestamp: '1760000000',
            type: 'text',
            text: { body: 'هلا، القميص متوفر؟' },
          },
        ],
      }),
    );

    expect(events).toEqual([
      {
        kind: 'message',
        channel: 'WHATSAPP',
        accountId: '1001',
        eventId: 'wamid.1',
        sender: { platformUserId: '9647701234567', displayName: 'Ali', phone: '+9647701234567' },
        type: 'TEXT',
        content: 'هلا، القميص متوفر؟',
        mediaUrl: null,
        metadata: null,
        timestamp: new Date(1760000000 * 1000).toISOString(),
      },
    ]);
  });

  it('keeps the media id of an image and uses its caption as content', () => {
    const [event] = parseMetaWebhook(
      whatsapp({
        messages: [
          {
            from: '964',
            id: 'wamid.2',
            type: 'image',
            image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'هذا اللون' },
          },
        ],
      }),
    );

    expect(event).toMatchObject({
      type: 'IMAGE',
      content: 'هذا اللون',
      metadata: { mediaId: 'media-1', mimeType: 'image/jpeg' },
    });
  });

  it('describes a location and a voice note with readable content', () => {
    const events = parseMetaWebhook(
      whatsapp({
        messages: [
          {
            from: '964',
            id: 'wamid.3',
            type: 'location',
            location: { latitude: 33.3, longitude: 44.4, name: 'المنصور' },
          },
          { from: '964', id: 'wamid.4', type: 'audio', audio: { id: 'a1' } },
        ],
      }),
    );

    expect(events.map((event) => event.kind === 'message' && [event.type, event.content])).toEqual([
      ['LOCATION', 'المنصور'],
      ['AUDIO', MEDIA_PLACEHOLDER.AUDIO],
    ]);
  });

  it('skips reactions and records unknown types as unsupported', () => {
    const events = parseMetaWebhook(
      whatsapp({
        messages: [
          { from: '964', id: 'wamid.5', type: 'reaction', reaction: { emoji: '👍' } },
          { from: '964', id: 'wamid.6', type: 'order' },
        ],
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventId: 'wamid.6', content: MEDIA_PLACEHOLDER.UNSUPPORTED });
  });

  it('turns statuses into delivery events, one id per status', () => {
    const events = parseMetaWebhook(
      whatsapp({
        statuses: [
          { id: 'wamid.out', status: 'delivered', timestamp: '1760000000' },
          {
            id: 'wamid.out2',
            status: 'failed',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
        ],
      }),
    );

    expect(events).toMatchObject([
      {
        kind: 'status',
        eventId: 'wamid.out:DELIVERED',
        messageExternalId: 'wamid.out',
        status: 'DELIVERED',
      },
      { kind: 'status', status: 'FAILED', error: '131047 - Re-engagement message' },
    ]);
  });
});

describe('parseMetaWebhook — Messenger and Instagram', () => {
  const messaging = (object: string, items: unknown[]) => ({
    object,
    entry: [{ id: 'PAGE', time: 1760000000000, messaging: items }],
  });

  it('parses a Messenger text message', () => {
    const [event] = parseMetaWebhook(
      messaging('page', [
        {
          sender: { id: 'PSID' },
          recipient: { id: 'PAGE' },
          timestamp: 1760000000000,
          message: { mid: 'm_1', text: 'بكم السعر؟' },
        },
      ]),
    );

    expect(event).toMatchObject({
      kind: 'message',
      channel: 'FACEBOOK',
      accountId: 'PAGE',
      eventId: 'm_1',
      sender: { platformUserId: 'PSID', displayName: null, phone: null },
      type: 'TEXT',
      content: 'بكم السعر؟',
      timestamp: new Date(1760000000000).toISOString(),
    });
  });

  it('parses an Instagram image attachment with its URL', () => {
    const [event] = parseMetaWebhook(
      messaging('instagram', [
        {
          sender: { id: 'IGSID' },
          recipient: { id: 'PAGE' },
          message: {
            mid: 'ig_1',
            attachments: [{ type: 'image', payload: { url: 'https://cdn/x.jpg' } }],
          },
        },
      ]),
    );

    expect(event).toMatchObject({
      channel: 'INSTAGRAM',
      type: 'IMAGE',
      content: MEDIA_PLACEHOLDER.IMAGE,
      mediaUrl: 'https://cdn/x.jpg',
    });
  });

  it('ignores echoes of our own messages', () => {
    const events = parseMetaWebhook(
      messaging('page', [
        { sender: { id: 'PAGE' }, message: { mid: 'm_2', text: 'رد', is_echo: true } },
        { sender: { id: 'PSID' }, message: { mid: 'm_3', text: 'echo', is_echo: true } },
      ]),
    );

    expect(events).toEqual([]);
  });

  it('turns delivery receipts into status events', () => {
    const events = parseMetaWebhook(
      messaging('page', [{ sender: { id: 'PSID' }, delivery: { mids: ['m_a', 'm_b'] } }]),
    );

    expect(events.map((event) => event.eventId)).toEqual(['m_a:DELIVERED', 'm_b:DELIVERED']);
  });
});

describe('parseMetaWebhook — robustness', () => {
  it.each([null, 'text', 42, {}, { object: 'user' }, { object: 'page', entry: 'x' }])(
    'returns nothing for %p',
    (payload) => {
      expect(parseMetaWebhook(payload)).toEqual([]);
    },
  );

  it('skips malformed items without dropping the valid ones', () => {
    const events = parseMetaWebhook({
      object: 'page',
      entry: [
        {
          id: 'PAGE',
          messaging: [
            null,
            { sender: {} },
            { sender: { id: 'P' }, message: { mid: 'ok', text: 'hi' } },
          ],
        },
        { messaging: [] },
      ],
    });

    expect(events.map((event) => event.eventId)).toEqual(['ok']);
  });
});

describe('isValidMetaSignature', () => {
  const body = Buffer.from('{"object":"page","entry":[]}');
  const secret = 'app-secret';

  it('accepts the signature Meta computes over the raw bytes', () => {
    expect(isValidMetaSignature(body, signMetaPayload(body, secret), secret)).toBe(true);
  });

  it('rejects a signature made with another secret, or over other bytes', () => {
    expect(isValidMetaSignature(body, signMetaPayload(body, 'other'), secret)).toBe(false);
    expect(isValidMetaSignature(Buffer.from('{}'), signMetaPayload(body, secret), secret)).toBe(
      false,
    );
  });

  it.each([undefined, '', 'sha1=abc', 'sha256=zz', 'sha256='])(
    'rejects the header %p',
    (header) => {
      expect(isValidMetaSignature(body, header, secret)).toBe(false);
    },
  );

  it('rejects everything when no secret is configured', () => {
    expect(isValidMetaSignature(body, signMetaPayload(body, ''), '')).toBe(false);
  });
});
