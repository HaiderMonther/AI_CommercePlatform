import { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore, CLS_KEYS } from '@common/context/request-context';
import { InboundMessageInput, MessagesService } from '@modules/messages/messages.service';
import { TestContext, bearer, createTestApp, registerTenant, resetTenantData } from './helpers/test-app';

/**
 * Phase 3: customers, conversations and messages — including the inbound path the channel
 * webhooks will use, and the side effects an agent reply has on a conversation.
 */
describe('CRM: customers, conversations, messages (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let other: Awaited<ReturnType<typeof registerTenant>>;
  let agentId: string;
  let agentToken: string;
  let viewerId: string;

  const auth = () => bearer(owner.accessToken);

  /** Runs service code the way the Phase 5 webhook worker will: inside a tenant context. */
  async function inbound(companyId: string, input: InboundMessageInput) {
    const cls = app.get<ClsService<AppClsStore>>(ClsService);
    return cls.run(async () => {
      cls.set(CLS_KEYS.COMPANY_ID, companyId);
      return app.get(MessagesService).recordInbound(input);
    });
  }

  async function createUser(email: string, roleKey: string): Promise<string> {
    const roles = (await ctx.http().get('/api/v1/roles').set('Authorization', auth()).expect(200))
      .body.data as { id: string; key: string }[];

    const response = await ctx
      .http()
      .post('/api/v1/users')
      .set('Authorization', auth())
      .send({
        email,
        fullName: roleKey,
        password: 'Member@12345',
        roleId: roles.find((role) => role.key === roleKey)!.id,
      })
      .expect(201);

    return response.body.data.id;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await resetTenantData(ctx.prisma);

    owner = await registerTenant(ctx, { companyName: 'متجر الزبائن', email: 'owner@crm.iq' });
    other = await registerTenant(ctx, { companyName: 'متجر آخر', email: 'owner@other-crm.iq' });

    agentId = await createUser('agent@crm.iq', 'SALES_AGENT');
    viewerId = await createUser('viewer@crm.iq', 'VIEWER');

    agentToken = (
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'agent@crm.iq', password: 'Member@12345' })
        .expect(200)
    ).body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await app.close();
  });

  describe('Customers', () => {
    let customerId: string;

    it('creates a customer and stores the phone in international form', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/customers')
        .set('Authorization', auth())
        .send({ name: 'علي حسين', phone: '0770 123 4567', city: 'بغداد', tags: ['جملة', 'جملة'] })
        .expect(201);

      customerId = response.body.data.id;
      expect(response.body.data.phone).toBe('+9647701234567');
      expect(response.body.data.tags).toEqual(['جملة']);
      expect(response.body.data.status).toBe('ACTIVE');
      expect(response.body.data.totalSpent).toBe(0);
    });

    it('treats the same number typed with Arabic-Indic digits as a duplicate', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/customers')
        .set('Authorization', auth())
        .send({ name: 'مكرر', phone: '٠٧٧٠١٢٣٤٥٦٧' })
        .expect(409);

      expect(response.body.code).toBe('CUSTOMER_PHONE_TAKEN');
    });

    it('rejects an unreadable phone number', async () => {
      await ctx
        .http()
        .post('/api/v1/customers')
        .set('Authorization', auth())
        .send({ name: 'رقم خاطئ', phone: '12345' })
        .expect(400);
    });

    it('finds a customer by the local form of the phone', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/customers')
        .query({ search: '0770123' })
        .set('Authorization', auth())
        .expect(200);

      expect(response.body.data.items.map((c: { id: string }) => c.id)).toEqual([customerId]);
    });

    it('updates the status and records it as a status change', async () => {
      await ctx
        .http()
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', auth())
        .send({ status: 'BLOCKED' })
        .expect(200);

      const audit = await ctx
        .http()
        .get('/api/v1/audit-logs')
        .query({ entity: 'Customer', entityId: customerId, action: 'status_change' })
        .set('Authorization', auth())
        .expect(200);

      expect(audit.body.data.items).toHaveLength(1);

      await ctx
        .http()
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', auth())
        .send({ status: 'ACTIVE' })
        .expect(200);
    });

    it('frees the phone number when a customer is deleted', async () => {
      const temp = await ctx
        .http()
        .post('/api/v1/customers')
        .set('Authorization', auth())
        .send({ name: 'زبون مؤقت', phone: '07809998877' })
        .expect(201);

      await ctx
        .http()
        .delete(`/api/v1/customers/${temp.body.data.id}`)
        .set('Authorization', auth())
        .expect(200);

      await ctx
        .http()
        .get(`/api/v1/customers/${temp.body.data.id}`)
        .set('Authorization', auth())
        .expect(404);

      await ctx
        .http()
        .post('/api/v1/customers')
        .set('Authorization', auth())
        .send({ name: 'زبون جديد بنفس الرقم', phone: '07809998877' })
        .expect(201);
    });

    it('does not let another company read or list the customer', async () => {
      await ctx
        .http()
        .get(`/api/v1/customers/${customerId}`)
        .set('Authorization', bearer(other.accessToken))
        .expect(404);

      await ctx
        .http()
        .patch(`/api/v1/customers/${customerId}`)
        .set('Authorization', bearer(other.accessToken))
        .send({ name: 'اختراق' })
        .expect(404);

      const list = await ctx
        .http()
        .get('/api/v1/customers')
        .set('Authorization', bearer(other.accessToken))
        .expect(200);

      expect(list.body.data.meta.total).toBe(0);
    });
  });

  describe('Inbound messages', () => {
    let conversationId: string;
    let customerId: string;

    const sender = {
      channel: 'WHATSAPP' as const,
      platformUserId: '9647711112222',
      phone: '9647711112222',
      displayName: 'زينب',
    };

    it('creates the customer, identity and conversation on first contact', async () => {
      const result = await inbound(owner.companyId, {
        sender,
        externalId: 'wamid.001',
        content: 'مرحبا، عندكم هذا القميص؟',
      });

      expect(result.duplicate).toBe(false);
      expect(result.conversationCreated).toBe(true);
      conversationId = result.conversationId;
      customerId = result.customerId;

      const conversation = await ctx
        .http()
        .get(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', auth())
        .expect(200);

      expect(conversation.body.data.mode).toBe('AI');
      expect(conversation.body.data.status).toBe('OPEN');
      expect(conversation.body.data.unreadCount).toBe(1);
      expect(conversation.body.data.customer.name).toBe('زينب');
      expect(conversation.body.data.customer.phone).toBe('+9647711112222');
      expect(conversation.body.data.customer.identities).toHaveLength(1);
      expect(conversation.body.data.lastMessage.content).toContain('القميص');
    });

    it('ignores a redelivered webhook', async () => {
      const result = await inbound(owner.companyId, {
        sender,
        externalId: 'wamid.001',
        content: 'مرحبا، عندكم هذا القميص؟',
      });

      expect(result).toMatchObject({ duplicate: true, conversationId, customerId });

      const messages = await ctx
        .http()
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', auth())
        .expect(200);

      expect(messages.body.data.items).toHaveLength(1);
    });

    it('continues the same conversation for the next message', async () => {
      const result = await inbound(owner.companyId, {
        sender,
        externalId: 'wamid.002',
        content: 'بكم السعر؟',
      });

      expect(result.conversationId).toBe(conversationId);
      expect(result.conversationCreated).toBe(false);

      const conversation = await ctx
        .http()
        .get(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', auth())
        .expect(200);

      expect(conversation.body.data.unreadCount).toBe(2);
    });

    it('links a new channel identity to the customer with the same phone', async () => {
      const known = await ctx
        .http()
        .post('/api/v1/customers')
        .set('Authorization', auth())
        .send({ name: 'حسن كاظم', phone: '07905556666' })
        .expect(201);

      const result = await inbound(owner.companyId, {
        sender: { channel: 'WHATSAPP', platformUserId: '9647905556666', phone: '9647905556666' },
        externalId: 'wamid.100',
        content: 'السلام عليكم',
      });

      expect(result.customerId).toBe(known.body.data.id);

      const customer = await ctx
        .http()
        .get(`/api/v1/customers/${known.body.data.id}`)
        .set('Authorization', auth())
        .expect(200);

      expect(customer.body.data.channels).toEqual(['WHATSAPP']);
      expect(customer.body.data.lastContactAt).not.toBeNull();
      expect(customer.body.data.recentConversations).toHaveLength(1);
    });

    it('pages the thread oldest-first with a cursor', async () => {
      for (let index = 3; index <= 5; index += 1) {
        await inbound(owner.companyId, {
          sender,
          externalId: `wamid.00${index}`,
          content: `رسالة ${index}`,
          receivedAt: new Date(Date.now() + index * 1000),
        });
      }

      const latest = await ctx
        .http()
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .query({ limit: 2 })
        .set('Authorization', auth())
        .expect(200);

      expect(latest.body.data.items.map((m: { content: string }) => m.content)).toEqual([
        'رسالة 4',
        'رسالة 5',
      ]);
      expect(latest.body.data.hasMore).toBe(true);

      const older = await ctx
        .http()
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .query({ limit: 10, before: latest.body.data.nextBefore })
        .set('Authorization', auth())
        .expect(200);

      expect(older.body.data.items).toHaveLength(3);
      expect(older.body.data.items[2].content).toBe('رسالة 3');
      expect(older.body.data.hasMore).toBe(false);
    });

    describe('Agent reply', () => {
      it('takes the conversation over from the AI and assigns it to the agent', async () => {
        const response = await ctx
          .http()
          .post(`/api/v1/conversations/${conversationId}/messages`)
          .set('Authorization', bearer(agentToken))
          .send({ content: '  هلا بيك، متوفر بكل المقاسات  ' })
          .expect(201);

        expect(response.body.data).toMatchObject({
          content: 'هلا بيك، متوفر بكل المقاسات',
          senderType: 'AGENT',
          direction: 'OUTBOUND',
          deliveryStatus: 'PENDING',
          senderUser: { id: agentId },
        });

        const conversation = await ctx
          .http()
          .get(`/api/v1/conversations/${conversationId}`)
          .set('Authorization', auth())
          .expect(200);

        expect(conversation.body.data).toMatchObject({
          mode: 'HUMAN',
          unreadCount: 0,
          assignedUser: { id: agentId },
        });
        expect(conversation.body.data.handoverAt).not.toBeNull();
      });

      it('rejects an empty reply', async () => {
        await ctx
          .http()
          .post(`/api/v1/conversations/${conversationId}/messages`)
          .set('Authorization', bearer(agentToken))
          .send({ content: '   ' })
          .expect(400);
      });

      it('refuses to reply to a blocked customer', async () => {
        await ctx
          .http()
          .patch(`/api/v1/customers/${customerId}`)
          .set('Authorization', auth())
          .send({ status: 'BLOCKED' })
          .expect(200);

        const response = await ctx
          .http()
          .post(`/api/v1/conversations/${conversationId}/messages`)
          .set('Authorization', auth())
          .send({ content: 'مرحبا' })
          .expect(400);

        expect(response.body.code).toBe('CUSTOMER_BLOCKED');

        await ctx
          .http()
          .patch(`/api/v1/customers/${customerId}`)
          .set('Authorization', auth())
          .send({ status: 'ACTIVE' })
          .expect(200);
      });
    });

    describe('Assignment', () => {
      it('lets the owner reassign', async () => {
        const response = await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/assign`)
          .set('Authorization', auth())
          .send({ userId: owner.ownerId })
          .expect(200);

        expect(response.body.data.assignedUser.id).toBe(owner.ownerId);
      });

      it('refuses an assignee who cannot reply', async () => {
        const response = await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/assign`)
          .set('Authorization', auth())
          .send({ userId: viewerId })
          .expect(400);

        expect(response.body.code).toBe('ASSIGNEE_INVALID');
      });

      it('refuses an assignee from another company', async () => {
        const response = await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/assign`)
          .set('Authorization', auth())
          .send({ userId: other.ownerId })
          .expect(400);

        expect(response.body.code).toBe('ASSIGNEE_INVALID');
      });

      it('requires an explicit null to unassign', async () => {
        await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/assign`)
          .set('Authorization', auth())
          .send({})
          .expect(400);

        const response = await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/assign`)
          .set('Authorization', auth())
          .send({ userId: null })
          .expect(200);

        expect(response.body.data.assignedUser).toBeNull();
      });

      it('does not let a sales agent reassign', async () => {
        await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/assign`)
          .set('Authorization', bearer(agentToken))
          .send({ userId: agentId })
          .expect(403);
      });
    });

    describe('Lifecycle', () => {
      it('hands the conversation back to the AI', async () => {
        const response = await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/mode`)
          .set('Authorization', auth())
          .send({ mode: 'AI' })
          .expect(200);

        expect(response.body.data).toMatchObject({ mode: 'AI', handoverAt: null, handoverReason: null });
      });

      it('reopens a resolved conversation when the customer writes again', async () => {
        const resolved = await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/status`)
          .set('Authorization', auth())
          .send({ status: 'RESOLVED' })
          .expect(200);

        expect(resolved.body.data.closedAt).not.toBeNull();

        const result = await inbound(owner.companyId, {
          sender,
          externalId: 'wamid.200',
          content: 'نسيت أسأل عن التوصيل',
        });

        expect(result.conversationId).toBe(conversationId);

        const conversation = await ctx
          .http()
          .get(`/api/v1/conversations/${conversationId}`)
          .set('Authorization', auth())
          .expect(200);

        expect(conversation.body.data).toMatchObject({ status: 'OPEN', closedAt: null, unreadCount: 1 });
      });

      it('starts a new conversation after one is closed', async () => {
        await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/status`)
          .set('Authorization', auth())
          .send({ status: 'CLOSED' })
          .expect(200);

        const result = await inbound(owner.companyId, {
          sender,
          externalId: 'wamid.300',
          content: 'طلب جديد',
        });

        expect(result.conversationId).not.toBe(conversationId);
        expect(result.conversationCreated).toBe(true);
        expect(result.customerId).toBe(customerId);
      });

      it('clears the unread count when read', async () => {
        const { body } = await ctx
          .http()
          .get('/api/v1/conversations')
          .query({ active: true, unread: true })
          .set('Authorization', auth())
          .expect(200);

        const target = body.data.items[0].id;

        await ctx
          .http()
          .post(`/api/v1/conversations/${target}/read`)
          .set('Authorization', auth())
          .expect(200);

        const after = await ctx
          .http()
          .get(`/api/v1/conversations/${target}`)
          .set('Authorization', auth())
          .expect(200);

        expect(after.body.data.unreadCount).toBe(0);
      });

      it('records status changes in the audit trail', async () => {
        const audit = await ctx
          .http()
          .get('/api/v1/audit-logs')
          .query({ entity: 'Conversation', entityId: conversationId, action: 'status_change' })
          .set('Authorization', auth())
          .expect(200);

        expect(audit.body.data.items).toHaveLength(2);
      });
    });

    describe('Isolation', () => {
      it('hides the conversation and its messages from another company', async () => {
        const token = bearer(other.accessToken);

        await ctx.http().get(`/api/v1/conversations/${conversationId}`).set('Authorization', token).expect(404);
        await ctx
          .http()
          .get(`/api/v1/conversations/${conversationId}/messages`)
          .set('Authorization', token)
          .expect(404);
        await ctx
          .http()
          .post(`/api/v1/conversations/${conversationId}/messages`)
          .set('Authorization', token)
          .send({ content: 'اختراق' })
          .expect(404);
        await ctx
          .http()
          .patch(`/api/v1/conversations/${conversationId}/status`)
          .set('Authorization', token)
          .send({ status: 'CLOSED' })
          .expect(404);

        const list = await ctx.http().get('/api/v1/conversations').set('Authorization', token).expect(200);
        expect(list.body.data.meta.total).toBe(0);
      });

      it('keeps the same sender separate per company', async () => {
        const result = await inbound(other.companyId, {
          sender,
          externalId: 'wamid.001',
          content: 'نفس الزبون لمتجر ثاني',
        });

        // Same WhatsApp user and even the same provider message id: a distinct customer,
        // conversation and message, because every key is scoped by company.
        expect(result.duplicate).toBe(false);
        expect(result.customerId).not.toBe(customerId);
        expect(result.conversationId).not.toBe(conversationId);
      });
    });
  });

  describe('Starting a conversation from the dashboard', () => {
    let customerId: string;

    beforeAll(async () => {
      customerId = (
        await ctx
          .http()
          .post('/api/v1/customers')
          .set('Authorization', auth())
          .send({ name: 'مريم', phone: '07501112233' })
          .expect(201)
      ).body.data.id;
    });

    it('opens a WhatsApp conversation in HUMAN mode assigned to its creator', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/conversations')
        .set('Authorization', bearer(agentToken))
        .send({ customerId, channel: 'WHATSAPP', subject: 'متابعة طلب' })
        .expect(201);

      expect(response.body.data).toMatchObject({
        channel: 'WHATSAPP',
        status: 'OPEN',
        mode: 'HUMAN',
        subject: 'متابعة طلب',
        assignedUser: { id: agentId },
      });

      const again = await ctx
        .http()
        .post('/api/v1/conversations')
        .set('Authorization', auth())
        .send({ customerId, channel: 'WHATSAPP' })
        .expect(201);

      expect(again.body.data.id).toBe(response.body.data.id);
    });

    it('refuses a channel the customer has never written from', async () => {
      await ctx
        .http()
        .post('/api/v1/conversations')
        .set('Authorization', auth())
        .send({ customerId, channel: 'INSTAGRAM' })
        .expect(400);
    });

    it('does not open conversations with another company customer', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/conversations')
        .set('Authorization', bearer(other.accessToken))
        .send({ customerId, channel: 'WHATSAPP' })
        .expect(404);

      expect(response.body.code).toBe('CUSTOMER_NOT_FOUND');
    });
  });

  describe('Inbox filters and counters', () => {
    it('filters by assignee and reports tab counters', async () => {
      const mine = await ctx
        .http()
        .get('/api/v1/conversations')
        .query({ assignee: 'me', active: true })
        .set('Authorization', bearer(agentToken))
        .expect(200);

      expect(mine.body.data.items.length).toBeGreaterThan(0);
      for (const item of mine.body.data.items) {
        expect(item.assignedUser.id).toBe(agentId);
      }

      const stats = await ctx
        .http()
        .get('/api/v1/conversations/stats')
        .set('Authorization', bearer(agentToken))
        .expect(200);

      expect(stats.body.data.mine).toBe(mine.body.data.meta.total);
      expect(stats.body.data.byStatus.CLOSED).toBe(1);
      expect(stats.body.data.active).toBe(
        stats.body.data.byStatus.OPEN + stats.body.data.byStatus.PENDING,
      );
    });

    it('lets a viewer read but not reply', async () => {
      const viewerToken = (
        await ctx
          .http()
          .post('/api/v1/auth/login')
          .send({ email: 'viewer@crm.iq', password: 'Member@12345' })
          .expect(200)
      ).body.data.tokens.accessToken;

      const list = await ctx
        .http()
        .get('/api/v1/conversations')
        .set('Authorization', bearer(viewerToken))
        .expect(200);

      await ctx
        .http()
        .post(`/api/v1/conversations/${list.body.data.items[0].id}/messages`)
        .set('Authorization', bearer(viewerToken))
        .send({ content: 'مرحبا' })
        .expect(403);
    });
  });
});
