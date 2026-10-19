import { OutboundService } from '@modules/channels/outbound.service';
import { GraphApiError, MetaGraphClient } from '@modules/channels/meta-graph.client';
import { signMetaPayload } from '@modules/webhooks/webhook-signature';
import {
  TestContext,
  bearer,
  createTestApp,
  registerTenant,
  resetTenantData,
  setTenantPlan,
  waitFor,
} from './helpers/test-app';

const APP_SECRET = 'test-meta-app-secret';
const PHONE_NUMBER_ID = '106540352242922';
const PAGE_ID = '200300400500';

/** Stands in for Meta: every Graph call the platform makes lands here. */
const graph = {
  sendText: jest.fn<Promise<string>, [unknown, string, string]>(),
  describeAccount: jest.fn<Promise<string>, [unknown]>(),
};

/**
 * Phase 5: channel connections, the Meta webhooks (verification, signatures, idempotent
 * ingestion, processing into conversations) and outbound delivery with receipts.
 */
describe('Channels and webhooks (e2e)', () => {
  let ctx: TestContext;
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let other: Awaited<ReturnType<typeof registerTenant>>;
  let whatsappChannelId: string;

  const auth = () => bearer(owner.accessToken);

  function postWebhook(path: string, payload: unknown, secret: string | null = APP_SECRET) {
    const body = JSON.stringify(payload);
    const request = ctx
      .http()
      .post(`/api/v1/webhooks/${path}`)
      .set('Content-Type', 'application/json');
    if (secret !== null) request.set('X-Hub-Signature-256', signMetaPayload(body, secret));
    return request.send(body);
  }

  const whatsappMessage = (id: string, from: string, text: string, name = 'Ali') => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ wa_id: from, profile: { name } }],
              messages: [
                {
                  from,
                  id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  const whatsappStatus = (id: string, status: string) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)) }],
            },
          },
        ],
      },
    ],
  });

  async function messageStatus(id: string) {
    return ctx.prisma.message.findUniqueOrThrow({
      where: { id },
      select: { deliveryStatus: true, externalId: true, failureReason: true, metadata: true },
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp({
      configure: (builder) => builder.overrideProvider(MetaGraphClient).useValue(graph),
    });
    await resetTenantData(ctx.prisma);

    owner = await registerTenant(ctx, { companyName: 'متجر القنوات', email: 'owner@channels.iq' });
    // Connects WhatsApp and Messenger; the trial plan holds one channel.
    await setTenantPlan(ctx.prisma, owner.companyId, 'BUSINESS');
    other = await registerTenant(ctx, {
      companyName: 'متجر آخر',
      email: 'owner@other-channels.iq',
    });
  });

  beforeEach(() => {
    graph.sendText.mockReset();
    graph.describeAccount.mockReset();
    graph.describeAccount.mockResolvedValue('Demo Store');
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await ctx.app.close();
  });

  describe('Connections', () => {
    it('connects a WhatsApp number, verifies it and never returns the token', async () => {
      const token = 'EAAG-test-access-token-ending-WXYZ';

      const response = await ctx
        .http()
        .post('/api/v1/channels')
        .set('Authorization', auth())
        .send({
          type: 'WHATSAPP',
          name: 'واتساب المتجر',
          externalId: PHONE_NUMBER_ID,
          accessToken: token,
        })
        .expect(201);

      whatsappChannelId = response.body.data.id;
      expect(response.body.data).toMatchObject({
        status: 'CONNECTED',
        hasAccessToken: true,
        tokenHint: '…WXYZ',
        webhookPath: 'webhooks/whatsapp',
      });
      expect(JSON.stringify(response.body)).not.toContain(token);
      expect(response.body.data.credentials).toBeUndefined();

      const stored = await ctx.prisma.channelConnection.findUniqueOrThrow({
        where: { id: whatsappChannelId },
      });
      expect(JSON.stringify(stored.credentials)).not.toContain(token);
    });

    it('records a token Meta rejects as a connection error', async () => {
      graph.describeAccount.mockRejectedValue(
        new GraphApiError('Invalid OAuth access token', 'auth', 190),
      );

      const response = await ctx
        .http()
        .post('/api/v1/channels')
        .set('Authorization', auth())
        .send({
          type: 'FACEBOOK',
          name: 'صفحة المتجر',
          externalId: PAGE_ID,
          accessToken: 'x'.repeat(30),
        })
        .expect(201);

      expect(response.body.data.status).toBe('ERROR');
      expect(response.body.data.lastError).toContain('Invalid OAuth');
    });

    it('refuses an account already connected here or to another store', async () => {
      const body = {
        type: 'WHATSAPP',
        name: 'مكرر',
        externalId: PHONE_NUMBER_ID,
        accessToken: 'y'.repeat(30),
      };

      const mine = await ctx
        .http()
        .post('/api/v1/channels')
        .set('Authorization', auth())
        .send(body)
        .expect(409);
      expect(mine.body.code).toBe('CHANNEL_ALREADY_CONNECTED');

      await ctx
        .http()
        .post('/api/v1/channels')
        .set('Authorization', bearer(other.accessToken))
        .send(body)
        .expect(409);
    });

    it("hides another company's connections", async () => {
      await ctx
        .http()
        .get(`/api/v1/channels/${whatsappChannelId}`)
        .set('Authorization', bearer(other.accessToken))
        .expect(404);

      const list = await ctx
        .http()
        .get('/api/v1/channels')
        .set('Authorization', bearer(other.accessToken))
        .expect(200);
      expect(list.body.data).toEqual([]);
    });
  });

  describe('Webhook verification and signatures', () => {
    it('echoes the challenge for the right verify token only', async () => {
      const ok = await ctx
        .http()
        .get('/api/v1/webhooks/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'test-verify-token-value',
          'hub.challenge': '12345',
        })
        .expect(200);
      expect(ok.text).toBe('12345');

      await ctx
        .http()
        .get('/api/v1/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' })
        .expect(403);
    });

    it('rejects unsigned and wrongly signed deliveries', async () => {
      const payload = whatsappMessage('wamid.forged', '9647700000000', 'forged');

      const unsigned = await postWebhook('whatsapp', payload, null).expect(401);
      expect(unsigned.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
      await postWebhook('whatsapp', payload, 'not-the-secret').expect(401);

      expect(await ctx.prisma.webhookEvent.count()).toBe(0);
    });

    it('rejects an unknown channel path', async () => {
      await postWebhook('telegram', {}).expect(400);
    });
  });

  describe('Inbound messages', () => {
    let conversationId: string;

    it('creates the customer, the conversation and the message from a signed delivery', async () => {
      const response = await postWebhook(
        'whatsapp',
        whatsappMessage('wamid.in.1', '9647701112222', 'هلا، القميص الأسود متوفر؟', 'Zainab'),
      ).expect(200);
      expect(response.body.data).toEqual({ received: 1, queued: 1 });

      const message = await waitFor(() =>
        ctx.prisma.message.findFirst({
          where: { externalId: 'wamid.in.1' },
          include: { conversation: { include: { customer: true } } },
        }),
      );

      conversationId = message.conversationId;
      expect(message.companyId).toBe(owner.companyId);
      expect(message.content).toBe('هلا، القميص الأسود متوفر؟');
      expect(message.conversation.channelId).toBe(whatsappChannelId);
      expect(message.conversation.customer).toMatchObject({
        name: 'Zainab',
        phone: '+9647701112222',
      });

      const event = await waitFor(() =>
        ctx.prisma.webhookEvent.findFirst({
          where: { externalEventId: 'wamid.in.1', status: 'PROCESSED' },
        }),
      );
      expect(event.signatureValid).toBe(true);
    });

    it('ignores a redelivery of the same message', async () => {
      const response = await postWebhook(
        'whatsapp',
        whatsappMessage('wamid.in.1', '9647701112222', 'هلا، القميص الأسود متوفر؟'),
      ).expect(200);
      expect(response.body.data).toEqual({ received: 1, queued: 0 });

      expect(await ctx.prisma.message.count({ where: { externalId: 'wamid.in.1' } })).toBe(1);
    });

    it('continues the same conversation for the next message', async () => {
      await postWebhook('whatsapp', whatsappMessage('wamid.in.2', '9647701112222', 'وبكم؟')).expect(
        200,
      );

      const message = await waitFor(() =>
        ctx.prisma.message.findFirst({ where: { externalId: 'wamid.in.2' } }),
      );
      expect(message.conversationId).toBe(conversationId);
    });

    it('stores events for unknown accounts as ignored, without a tenant', async () => {
      const payload = whatsappMessage('wamid.stranger', '964', 'hi');
      payload.entry[0].changes[0].value.metadata.phone_number_id = '999999999';

      const response = await postWebhook('whatsapp', payload).expect(200);
      expect(response.body.data).toEqual({ received: 1, queued: 0 });

      const event = await ctx.prisma.webhookEvent.findFirstOrThrow({
        where: { externalEventId: 'wamid.stranger' },
      });
      expect(event).toMatchObject({ status: 'IGNORED', companyId: null });
    });

    describe('Outbound replies', () => {
      async function reply(content: string): Promise<string> {
        const response = await ctx
          .http()
          .post(`/api/v1/conversations/${conversationId}/messages`)
          .set('Authorization', auth())
          .send({ content })
          .expect(201);
        expect(response.body.data.deliveryStatus).toBe('PENDING');
        return response.body.data.id;
      }

      it('sends the reply through the conversation channel and follows its receipts', async () => {
        graph.sendText.mockResolvedValue('wamid.out.1');

        const id = await reply('نعم متوفر، السعر 25 ألف');

        const sent = await waitFor(async () => {
          const status = await messageStatus(id);
          return status.deliveryStatus === 'SENT' ? status : null;
        });
        expect(sent.externalId).toBe('wamid.out.1');

        const [channel, recipient, text] = graph.sendText.mock.calls[0];
        expect(channel).toMatchObject({ type: 'WHATSAPP', externalId: PHONE_NUMBER_ID });
        expect((channel as { accessToken: string }).accessToken).toBe(
          'EAAG-test-access-token-ending-WXYZ',
        );
        expect(recipient).toBe('9647701112222');
        expect(text).toBe('نعم متوفر، السعر 25 ألف');

        await postWebhook('whatsapp', whatsappStatus('wamid.out.1', 'read')).expect(200);
        await waitFor(async () => (await messageStatus(id)).deliveryStatus === 'READ');

        // A late "delivered" must not move a read message back.
        await postWebhook('whatsapp', whatsappStatus('wamid.out.1', 'delivered')).expect(200);
        await waitFor(() =>
          ctx.prisma.webhookEvent.findFirst({
            where: { externalEventId: 'wamid.out.1:DELIVERED', status: 'PROCESSED' },
          }),
        );
        expect((await messageStatus(id)).deliveryStatus).toBe('READ');
      });

      it('fails with a clear reason outside the 24-hour window, and can be retried', async () => {
        graph.sendText.mockRejectedValueOnce(
          new GraphApiError('Re-engagement message', 'window', 131047),
        );

        const id = await reply('مرحبا مجدداً');

        const failed = await waitFor(async () => {
          const status = await messageStatus(id);
          return status.deliveryStatus === 'FAILED' ? status : null;
        });
        expect(failed.failureReason).toContain('24 ساعة');

        graph.sendText.mockResolvedValueOnce('wamid.out.retry');
        await ctx
          .http()
          .post(`/api/v1/conversations/${conversationId}/messages/${id}/retry`)
          .set('Authorization', auth())
          .expect(200);

        await waitFor(async () => (await messageStatus(id)).deliveryStatus === 'SENT');
      });

      it('marks the channel broken when Meta rejects the token', async () => {
        graph.sendText.mockRejectedValueOnce(new GraphApiError('Session has expired', 'auth', 190));

        const id = await reply('رسالة');
        await waitFor(async () => (await messageStatus(id)).deliveryStatus === 'FAILED');

        const channel = await ctx.prisma.channelConnection.findUniqueOrThrow({
          where: { id: whatsappChannelId },
        });
        expect(channel.status).toBe('ERROR');
      });

      it('backs off on a transient failure and delivers on a later sweep', async () => {
        graph.sendText.mockRejectedValueOnce(new GraphApiError('Service unavailable', 'transient'));

        const id = await reply('رسالة بعد انقطاع');

        const pending = await waitFor(async () => {
          const status = await messageStatus(id);
          const attempts = (status.metadata as { delivery?: { attempts?: number } } | null)
            ?.delivery?.attempts;
          return attempts === 1 && status.deliveryStatus === 'PENDING' ? status : null;
        });
        expect(pending.failureReason).toBeNull();

        // Not due yet: the sweep leaves it alone.
        graph.sendText.mockResolvedValue('wamid.out.later');
        await ctx.app.get(OutboundService).sweep();
        expect((await messageStatus(id)).deliveryStatus).toBe('PENDING');

        // Fast-forward the backoff.
        await ctx.prisma.$executeRaw`
          UPDATE messages SET metadata = jsonb_set(metadata, '{delivery,notBefore}', '0') WHERE id = ${id}
        `;
        await ctx.app.get(OutboundService).sweep();
        expect((await messageStatus(id)).deliveryStatus).toBe('SENT');
      });

      it('fails at once when the store has no connection for the channel', async () => {
        const customer = await ctx.prisma.customer.create({
          data: {
            companyId: owner.companyId,
            name: 'زبون إنستغرام',
            identities: {
              create: {
                companyId: owner.companyId,
                channel: 'INSTAGRAM',
                platformUserId: 'IGSID-1',
              },
            },
          },
        });

        const conversation = await ctx
          .http()
          .post('/api/v1/conversations')
          .set('Authorization', auth())
          .send({ customerId: customer.id, channel: 'INSTAGRAM' })
          .expect(201);

        const sent = await ctx
          .http()
          .post(`/api/v1/conversations/${conversation.body.data.id}/messages`)
          .set('Authorization', auth())
          .send({ content: 'مرحبا' })
          .expect(201);

        const failed = await waitFor(async () => {
          const status = await messageStatus(sent.body.data.id);
          return status.deliveryStatus === 'FAILED' ? status : null;
        });
        expect(failed.failureReason).toContain('إنستغرام');
        expect(graph.sendText).not.toHaveBeenCalled();
      });
    });
  });
});
