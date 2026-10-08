import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { SkipThrottle } from '@nestjs/throttler';
import type { Server, Socket } from 'socket.io';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { Public } from '@common/decorators/public.decorator';
import { AppException } from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { AuthenticatedUser } from '@common/types/authenticated-user.type';
import { PrincipalService } from '@modules/auth/principal.service';
import { TokenService } from '@modules/auth/token.service';
import { REALTIME_EVENT, REALTIME_PATH, ROOM, RealtimeAck } from './realtime.constants';
import { RealtimeService } from './realtime.service';

interface SocketData {
  principal: AuthenticatedUser;
  tokenExpiresAt: number | null;
}

type AppSocket = Socket & { data: SocketData };

/**
 * Authenticated Socket.IO entry point.
 *
 * The HTTP guards cannot authenticate a socket, so the gateway opts out of them
 * (`@Public`, `@SkipThrottle`) and authenticates once, in the handshake middleware, with
 * the same access token and the same principal resolution as a REST call. The company is
 * read from the user record, and every room is derived from it.
 *
 * Permissions are captured at connect time. The socket is closed when its access token
 * expires, so the client reconnects with a fresh token and a freshly resolved principal —
 * a revoked role stops receiving events within one token lifetime.
 */
@Public()
@SkipThrottle()
@WebSocketGateway({ path: REALTIME_PATH, serveClient: false })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly tokens: TokenService,
    private readonly principals: PrincipalService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.authenticate(socket as AppSocket)
        .then(() => next())
        .catch((error: unknown) => {
          // The code travels as the error message so the client can tell an expired
          // token (refresh and retry) from a rejected one (stop).
          const code = error instanceof AppException ? error.code : ERROR_CODE.UNAUTHENTICATED;
          next(new Error(code));
        });
    });

    this.realtime.attach(server);
  }

  async handleConnection(socket: AppSocket): Promise<void> {
    const { principal, tokenExpiresAt } = socket.data;
    const companyId = principal.companyId as string;

    const rooms = [ROOM.company(companyId), ROOM.user(principal.id)];
    if (this.can(principal, PERMISSIONS.CONVERSATIONS_READ)) {
      rooms.push(ROOM.companyConversations(companyId));
    }
    await socket.join(rooms);

    if (tokenExpiresAt) {
      const timer = setTimeout(
        () => socket.disconnect(true),
        Math.max(tokenExpiresAt - Date.now(), 0),
      );
      timer.unref();
      this.expiryTimers.set(socket.id, timer);
    }
  }

  handleDisconnect(socket: AppSocket): void {
    const timer = this.expiryTimers.get(socket.id);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(socket.id);
    }
  }

  /** Subscribes the socket to one conversation's message stream (the open chat thread). */
  @SubscribeMessage(REALTIME_EVENT.CONVERSATION_JOIN)
  async joinConversation(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<RealtimeAck> {
    const { principal } = socket.data;

    if (!this.can(principal, PERMISSIONS.CONVERSATIONS_READ)) {
      return { ok: false, code: ERROR_CODE.PERMISSION_DENIED };
    }

    const conversationId = this.conversationIdOf(body);
    if (!conversationId) {
      return { ok: false, code: ERROR_CODE.VALIDATION_FAILED };
    }

    // Filtered by the socket's own company: another tenant's id is indistinguishable
    // from one that does not exist.
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, companyId: principal.companyId as string },
      select: { id: true },
    });

    if (!conversation) {
      return { ok: false, code: ERROR_CODE.CONVERSATION_NOT_FOUND };
    }

    await socket.join(ROOM.conversation(conversation.id));
    return { ok: true };
  }

  @SubscribeMessage(REALTIME_EVENT.CONVERSATION_LEAVE)
  async leaveConversation(
    @ConnectedSocket() socket: AppSocket,
    @MessageBody() body: unknown,
  ): Promise<RealtimeAck> {
    const conversationId = this.conversationIdOf(body);
    if (!conversationId) {
      return { ok: false, code: ERROR_CODE.VALIDATION_FAILED };
    }

    await socket.leave(ROOM.conversation(conversationId));
    return { ok: true };
  }

  private async authenticate(socket: AppSocket): Promise<void> {
    const token = this.tokenOf(socket);
    if (!token) {
      throw new AppException(ERROR_CODE.UNAUTHENTICATED, 'الرجاء تسجيل الدخول', 401);
    }

    const payload = await this.tokens.verifyAccessToken(token);
    const principal = await this.principals.resolve(payload.sub);

    // Platform admins act across tenants and have no company room to join.
    if (!principal.companyId) {
      throw new AppException(ERROR_CODE.FORBIDDEN, 'لا توجد شركة لهذا الحساب', 403);
    }

    socket.data.principal = principal;
    socket.data.tokenExpiresAt = payload.exp ? payload.exp * 1000 : null;

    this.logger.debug(`Socket ${socket.id} authenticated as ${principal.id}`);
  }

  private tokenOf(socket: AppSocket): string | null {
    const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const raw =
      typeof fromAuth === 'string' ? fromAuth : (socket.handshake.headers.authorization ?? '');

    const token = raw.replace(/^Bearer\s+/i, '').trim();
    return token.length > 0 ? token : null;
  }

  private conversationIdOf(body: unknown): string | null {
    const id = (body as { conversationId?: unknown } | null)?.conversationId;
    return typeof id === 'string' && id.length > 0 && id.length <= 40 ? id : null;
  }

  private can(principal: AuthenticatedUser, permission: string): boolean {
    return principal.isPlatformAdmin || principal.permissions.includes(permission);
  }
}
