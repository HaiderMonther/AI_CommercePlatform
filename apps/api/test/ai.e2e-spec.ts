import { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore, CLS_KEYS } from '@common/context/request-context';
import { AiClient, AiRequest, AiResponse } from '@modules/ai/ai-client';
import { AiResponderService } from '@modules/ai/ai-responder.service';
import { MetaGraphClient } from '@modules/channels/meta-graph.client';
import { InboundMessageInput, MessagesService } from '@modules/messages/messages.service';
import {
  TestContext,
  bearer,
  createTestApp,
  registerTenant,
  resetTenantData,
  waitFor,
} from './helpers/test-app';

/**
 * Phase 6: the AI agent end to end — the Claude API is scripted, everything else (the
 * responder, tools, orders, conversations) runs for real against the database.
 */
describe('AI sales agent (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let agentToken: string;
  let productId: string;

  /** Scripted Claude: each request takes the next reply, or builds one from the request. */
  const script: ((request: AiRequest) => AiResponse)[] = [];
  const requests: AiRequest[] = [];
  const fakeClient = {
    configured: true,
    createMessage: jest.fn(async (request: AiRequest) => {
      requests.push({ ...request, messages: [...request.messages] });
      const next = script.shift();
      if (!next) throw new Error('No scripted Claude reply');
      return next(request);
    }),
  };

  const auth = () => bearer(owner.accessToken);

  const reply = (content: unknown[], stopReason: AiResponse['stop_reason']) => (): AiResponse =>
    ({
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content,
      stop_reason: stopReason,
      stop_details: null,
      stop_sequence: null,
      usage: {
        input_tokens: 500,
        output_tokens: 40,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1200,
      },
    }) as unknown as AiResponse;

  const say = (text: string) => reply([{ type: 'text', text }], 'end_turn');
  const call = (name: string, input: unknown) =>
    reply([{ type: 'tool_use', id: `tool-${name}`, name, input }], 'tool_use');

  /** A customer message arrives the way the webhook worker records it, then the AI runs. */
  async function customerWrites(phone: string, content: string) {
    const cls = app.get<ClsService<AppClsStore>>(ClsService);
    return cls.run(async () => {
      cls.set(CLS_KEYS.COMPANY_ID, owner.companyId);
      const input: InboundMessageInput = {
        sender: {
          channel: 'WHATSAPP',
          platformUserId: phone.replace('+', ''),
          phone,
          displayName: 'زبون',
        },
        externalId: `wamid.${Date.now()}.${Math.random()}`,
        content,
      };
      const inbound = await app.get(MessagesService).recordInbound(input);
      await app.get(AiResponderService).onInbound(inbound.conversationId);
      return inbound;
    });
  }

  async function messagesOf(conversationId: string) {
    return ctx.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { senderType: true, content: true, deliveryStatus: true },
    });
  }

  beforeAll(async () => {
    ctx = await createTestApp({
      configure: (builder) =>
        builder
          .overrideProvider(AiClient)
          .useValue(fakeClient)
          // No channel is connected; delivery fails fast without calling Meta.
          .overrideProvider(MetaGraphClient)
          .useValue({ sendText: jest.fn(), describeAccount: jest.fn() }),
    });
    app = ctx.app;
    await resetTenantData(ctx.prisma);

    owner = await registerTenant(ctx, { companyName: 'متجر الذكاء', email: 'owner@ai.iq' });

    productId = (
      await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'قميص أسود', sku: 'SHIRT-AI', price: 25000, initialStock: 5 })
        .expect(201)
    ).body.data.id;

    const roles = (await ctx.http().get('/api/v1/roles').set('Authorization', auth()).expect(200))
      .body.data as { id: string; key: string }[];
    await ctx
      .http()
      .post('/api/v1/users')
      .set('Authorization', auth())
      .send({
        email: 'agent@ai.iq',
        fullName: 'مندوب',
        password: 'Member@12345',
        roleId: roles.find((role) => role.key === 'SALES_AGENT')!.id,
      })
      .expect(201);
    agentToken = (
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'agent@ai.iq', password: 'Member@12345' })
        .expect(200)
    ).body.data.tokens.accessToken;
  });

  beforeEach(() => {
    script.length = 0;
    requests.length = 0;
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await app.close();
  });

  describe('Settings', () => {
    it('creates default settings on first read and lists the models', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/ai/config')
        .set('Authorization', auth())
        .expect(200);

      expect(response.body.data.enabled).toBe(true);
      expect(response.body.data.model).toBe('claude-opus-5-5');
      expect(response.body.data.providerConfigured).toBe(true);
      expect(response.body.data.options.models.map((m: { id: string }) => m.id)).toContain(
        'claude-haiku-5-5',
      );
    });

    it('saves settings and rejects a model that is not offered', async () => {
      const response = await ctx
        .http()
        .patch('/api/v1/ai/config')
        .set('Authorization', auth())
        .send({
          returnPolicy: 'الإرجاع خلال 3 أيام',
          workingHours: 'يومياً 10 - 10',
          handoverKeywords: ['موظف', 'موظف', ' شكوى '],
        })
        .expect(200);

      expect(response.body.data.workingHours).toBe('يومياً 10 - 10');
      expect(response.body.data.handoverKeywords).toEqual(['موظف', 'شكوى']);

      await ctx
        .http()
        .patch('/api/v1/ai/config')
        .set('Authorization', auth())
        .send({ model: 'gpt-4' })
        .expect(400);
    });

    it('keeps settings away from a sales agent', async () => {
      await ctx
        .http()
        .patch('/api/v1/ai/config')
        .set('Authorization', bearer(agentToken))
        .send({ enabled: false })
        .expect(403);
    });

    it('tries the agent on a sample message without placing anything', async () => {
      script.push(call('search_products', { query: 'قميص' }), say('القميص الأسود بـ 25,000 د.ع'));

      const response = await ctx
        .http()
        .post('/api/v1/ai/test')
        .set('Authorization', auth())
        .send({ message: 'بكم القميص الأسود؟' })
        .expect(200);

      expect(response.body.data.reply).toBe('القميص الأسود بـ 25,000 د.ع');
      expect(response.body.data.toolCalls[0].name).toBe('search_products');

      // The tool really searched the catalog.
      const toolResult = JSON.parse(
        (requests[1].messages[2].content as { content: string }[])[0].content,
      );
      expect(toolResult.results[0].product_id).toBe(productId);
      expect(toolResult.results[0].price).toBe(25000);

      // The store's own policy reached the prompt.
      const system = requests[0].system as { text: string }[];
      expect(system[0].text).toContain('الإرجاع خلال 3 أيام');
    });
  });

  describe('Automatic replies', () => {
    it('answers a customer and records the interaction', async () => {
      script.push(say('هلا بيك! شلون أگدر أساعدك؟'));

      const inbound = await customerWrites('+9647700000001', 'مرحبا');
      const thread = await messagesOf(inbound.conversationId);

      expect(thread.map((m) => m.senderType)).toEqual(['CUSTOMER', 'AI']);
      expect(thread[1].content).toBe('هلا بيك! شلون أگدر أساعدك؟');

      const interaction = await ctx.prisma.aiInteraction.findFirstOrThrow({
        where: { conversationId: inbound.conversationId },
      });
      expect(interaction.success).toBe(true);
      expect(interaction.totalTokens).toBe(1740);
      expect(interaction.messageId).not.toBeNull();

      const usage = await ctx.prisma.usageRecord.findMany({
        where: { companyId: owner.companyId },
      });
      expect(usage.find((row) => row.metric === 'AI_MESSAGES')?.value).toBeGreaterThan(0);
    });

    it('takes an order end to end and reserves the stock', async () => {
      script.push(
        call('create_order', {
          items: [{ product_id: productId, variant_id: null, quantity: 2 }],
          customer_name: 'زينب',
          phone: null,
          city: 'البصرة',
          address: 'العشار',
          payment_method: 'CASH_ON_DELIVERY',
          notes: null,
          customer_confirmed: true,
        }),
        (request) => {
          const result = JSON.parse(
            (request.messages.at(-1)!.content as { content: string }[])[0].content,
          );
          return say(`تم! رقم طلبك #${result.order_number}`)();
        },
      );

      const inbound = await customerWrites('+9647700000002', 'نعم أكد الطلب');

      const order = await ctx.prisma.order.findFirstOrThrow({
        where: { conversationId: inbound.conversationId },
        include: { items: true },
      });
      expect(order.source).toBe('AI');
      expect(order.customerPhone).toBe('+9647700000002');
      expect(order.deliveryCity).toBe('البصرة');
      expect(Number(order.total)).toBe(50000);

      const product = await ctx.prisma.product.findUniqueOrThrow({ where: { id: productId } });
      expect(product.reservedStock).toBe(2);

      const thread = await messagesOf(inbound.conversationId);
      expect(thread.at(-1)!.content).toBe(`تم! رقم طلبك #${order.orderNumber}`);
    });

    it('refuses to place an order the customer has not confirmed', async () => {
      script.push(
        call('create_order', {
          items: [{ product_id: productId, variant_id: null, quantity: 1 }],
          customer_name: 'علي',
          phone: null,
          city: 'بغداد',
          address: 'المنصور',
          payment_method: 'CASH_ON_DELIVERY',
          notes: null,
          customer_confirmed: false,
        }),
        say('أرسلتلك ملخص الطلب، تأكده؟'),
      );

      const inbound = await customerWrites('+9647700000003', 'أريد قميص');

      expect(
        await ctx.prisma.order.count({ where: { conversationId: inbound.conversationId } }),
      ).toBe(0);
      const result = (requests[1].messages[2].content as { is_error?: boolean }[])[0];
      expect(result.is_error).toBe(true);
    });

    it('hands over on a keyword without calling Claude', async () => {
      const inbound = await customerWrites('+9647700000004', 'أريد أحچي ويه موظف');

      expect(requests).toHaveLength(0);

      const conversation = await ctx.prisma.conversation.findUniqueOrThrow({
        where: { id: inbound.conversationId },
      });
      expect(conversation.mode).toBe('HUMAN');
      expect(conversation.handoverReason).toContain('موظف');

      const thread = await messagesOf(inbound.conversationId);
      expect(thread.at(-1)!.senderType).toBe('AI');
    });

    it('stays quiet once a person has taken over', async () => {
      const inbound = await customerWrites('+9647700000004', 'وينكم؟');

      expect(requests).toHaveLength(0);
      expect((await messagesOf(inbound.conversationId)).at(-1)!.senderType).toBe('CUSTOMER');
    });

    it('hands over when Claude fails, so the customer is not left waiting', async () => {
      const inbound = await customerWrites('+9647700000005', 'شكد التوصيل؟'); // nothing scripted

      const conversation = await ctx.prisma.conversation.findUniqueOrThrow({
        where: { id: inbound.conversationId },
      });
      expect(conversation.mode).toBe('HUMAN');

      const interaction = await ctx.prisma.aiInteraction.findFirstOrThrow({
        where: { conversationId: inbound.conversationId },
      });
      expect(interaction.success).toBe(false);
    });

    it('does not answer when the merchant turned automatic replies off', async () => {
      await ctx
        .http()
        .patch('/api/v1/ai/config')
        .set('Authorization', auth())
        .send({ autoReply: false })
        .expect(200);

      const inbound = await customerWrites('+9647700000006', 'هلا');
      expect(requests).toHaveLength(0);
      expect(await messagesOf(inbound.conversationId)).toHaveLength(1);

      await ctx
        .http()
        .patch('/api/v1/ai/config')
        .set('Authorization', auth())
        .send({ autoReply: true })
        .expect(200);
    });

    it('answers one burst once, even when two triggers race', async () => {
      script.push(say('أكيد، شنو تحب تشوف؟'));

      const cls = app.get<ClsService<AppClsStore>>(ClsService);
      const inbound = await cls.run(async () => {
        cls.set(CLS_KEYS.COMPANY_ID, owner.companyId);
        const messages = app.get(MessagesService);
        const sender = {
          channel: 'WHATSAPP' as const,
          platformUserId: '9647700000007',
          phone: '+9647700000007',
        };
        const first = await messages.recordInbound({
          sender,
          externalId: 'wamid.burst.1',
          content: 'هلا',
        });
        await messages.recordInbound({
          sender,
          externalId: 'wamid.burst.2',
          content: 'عندكم قمصان؟',
        });

        const responder = app.get(AiResponderService);
        await Promise.all([
          responder.onInbound(first.conversationId),
          responder.onInbound(first.conversationId),
        ]);
        return first;
      });

      await waitFor(async () => (await messagesOf(inbound.conversationId)).length >= 3);
      const thread = await messagesOf(inbound.conversationId);

      expect(thread.filter((m) => m.senderType === 'AI')).toHaveLength(1);
      expect(requests).toHaveLength(1);
      // Both messages were answered together.
      expect(requests[0].messages.at(-1)!.content).toBe('هلا\nعندكم قمصان؟');
    });
  });
});
