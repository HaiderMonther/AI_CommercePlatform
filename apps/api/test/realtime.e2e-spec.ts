import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { ClsService } from 'nestjs-cls';
import { Socket, io } from 'socket.io-client';
import { AppClsStore, CLS_KEYS } from '@common/context/request-context';
import { MessagesService } from '@modules/messages/messages.service';
import { REALTIME_EVENT, REALTIME_PATH } from '@modules/realtime/realtime.constants';
import { TestContext, bearer, createTestApp, registerTenant, resetTenantData } from './helpers/test-app';

/**
 * The realtime channel carries customer messages, so it gets the same tenant guarantees as
 * the REST API: no token, no socket; and no event or room from another company.
 */
describe('Realtime gateway (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let url: string;
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let other: Awaited<ReturnType<typeof registerTenant>>;
  let conversationId: string;
  let foreignConversationId: string;
  const sockets: Socket[] = [];

  function connect(token?: string): Socket {
    const socket = io(url, {
      path: REALTIME_PATH,
      transports: ['websocket'],
      reconnection: false,
      auth: token ? { token } : {},
    });
    sockets.push(socket);
    return socket;
  }

  function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
  }

  function rejection(socket: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      socket.once('connect', () => reject(new Error('connection should have been refused')));
      socket.once('connect_error', (error) => resolve(error.message));
    });
  }

  function nextEvent<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${event} within ${timeoutMs}ms`)), timeoutMs);
      socket.once(event, (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  /** Resolves true if the event arrives within the window — used to prove it does not. */
  function receives(socket: Socket, event: string, windowMs = 500): Promise<boolean> {
    return new Promise((resolve) => {
      const handler = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        socket.off(event, handler);
        resolve(false);
      }, windowMs);
      socket.once(event, handler);
    });
  }

  async function seedConversation(companyId: string, platformUserId: string): Promise<string> {
    const cls = app.get<ClsService<AppClsStore>>(ClsService);
    const result = await cls.run(async () => {
      cls.set(CLS_KEYS.COMPANY_ID, companyId);
      return app.get(MessagesService).recordInbound({
        sender: { channel: 'WHATSAPP', platformUserId, phone: platformUserId },
        content: 'مرحبا',
      });
    });
    return result.conversationId;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await resetTenantData(ctx.prisma);

    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;

    owner = await registerTenant(ctx, { companyName: 'متجر اللحظي', email: 'owner@realtime.iq' });
    other = await registerTenant(ctx, { companyName: 'متجر منافس', email: 'owner@rival.iq' });

    conversationId = await seedConversation(owner.companyId, '9647700000001');
    foreignConversationId = await seedConversation(other.companyId, '9647700000002');
  });

  afterEach(() => {
    while (sockets.length) {
      sockets.pop()?.disconnect();
    }
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await app.close();
  });

  it('refuses a connection without a token', async () => {
    expect(await rejection(connect())).toBe('UNAUTHENTICATED');
  });

  it('refuses a forged token', async () => {
    expect(await rejection(connect('not-a-real-token'))).toBe('TOKEN_INVALID');
  });

  it('refuses a refresh token used as an access token', async () => {
    expect(await rejection(connect(owner.refreshToken))).toBe('TOKEN_INVALID');
  });

  it('joins a conversation of the own company', async () => {
    const socket = connect(owner.accessToken);
    await connected(socket);

    const ack = await socket.emitWithAck(REALTIME_EVENT.CONVERSATION_JOIN, { conversationId });
    expect(ack).toEqual({ ok: true });
  });

  it('cannot join another company conversation', async () => {
    const socket = connect(owner.accessToken);
    await connected(socket);

    const ack = await socket.emitWithAck(REALTIME_EVENT.CONVERSATION_JOIN, {
      conversationId: foreignConversationId,
    });
    expect(ack).toEqual({ ok: false, code: 'CONVERSATION_NOT_FOUND' });
  });

  it('validates the join payload', async () => {
    const socket = connect(owner.accessToken);
    await connected(socket);

    expect(await socket.emitWithAck(REALTIME_EVENT.CONVERSATION_JOIN, 'nope')).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
  });

  it('pushes a reply to the thread and the inbox, and nothing to another company', async () => {
    const ownerSocket = connect(owner.accessToken);
    const rivalSocket = connect(other.accessToken);
    await Promise.all([connected(ownerSocket), connected(rivalSocket)]);

    await ownerSocket.emitWithAck(REALTIME_EVENT.CONVERSATION_JOIN, { conversationId });

    const message = nextEvent<{ conversationId: string; message: { content: string } }>(
      ownerSocket,
      REALTIME_EVENT.MESSAGE_CREATED,
    );
    const inbox = nextEvent<{ id: string; mode: string; lastMessage: { content: string } }>(
      ownerSocket,
      REALTIME_EVENT.CONVERSATION_UPDATED,
    );
    const leakedUpdate = receives(rivalSocket, REALTIME_EVENT.CONVERSATION_UPDATED);
    const leakedMessage = receives(rivalSocket, REALTIME_EVENT.MESSAGE_CREATED);

    await ctx
      .http()
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .set('Authorization', bearer(owner.accessToken))
      .send({ content: 'أهلاً وسهلاً' })
      .expect(201);

    expect(await message).toMatchObject({ conversationId, message: { content: 'أهلاً وسهلاً' } });
    expect(await inbox).toMatchObject({
      id: conversationId,
      mode: 'HUMAN',
      lastMessage: { content: 'أهلاً وسهلاً' },
    });
    expect(await leakedUpdate).toBe(false);
    expect(await leakedMessage).toBe(false);
  });

  it('keeps inbox events from a member without conversations.read', async () => {
    const role = await ctx
      .http()
      .post('/api/v1/roles')
      .set('Authorization', bearer(owner.accessToken))
      .send({ name: 'Stock keeper', nameAr: 'أمين مخزن', permissions: ['products.read'] })
      .expect(201);

    await ctx
      .http()
      .post('/api/v1/users')
      .set('Authorization', bearer(owner.accessToken))
      .send({
        email: 'stock@realtime.iq',
        fullName: 'أمين المخزن',
        password: 'Stock@12345',
        roleId: role.body.data.id,
      })
      .expect(201);

    const token = (
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'stock@realtime.iq', password: 'Stock@12345' })
        .expect(200)
    ).body.data.tokens.accessToken;

    const socket = connect(token);
    await connected(socket);

    expect(await socket.emitWithAck(REALTIME_EVENT.CONVERSATION_JOIN, { conversationId })).toEqual({
      ok: false,
      code: 'PERMISSION_DENIED',
    });

    const leaked = receives(socket, REALTIME_EVENT.CONVERSATION_UPDATED);

    await ctx
      .http()
      .post(`/api/v1/conversations/${conversationId}/read`)
      .set('Authorization', bearer(owner.accessToken))
      .expect(200);

    expect(await leaked).toBe(false);
  });
});
