import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { REALTIME_EVENT, ROOM } from './realtime.constants';

/**
 * Publishing side of the realtime channel. Business services call this after their write
 * has committed; the gateway hands over the Socket.IO server once it is initialized.
 *
 * Emitting is best-effort by design: a dropped push costs a stale screen until the next
 * fetch, whereas letting it throw would fail a reply that was already saved.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  attach(server: Server): void {
    this.server = server;
  }

  conversationUpdated(companyId: string, conversation: unknown): void {
    this.emit(ROOM.companyConversations(companyId), REALTIME_EVENT.CONVERSATION_UPDATED, conversation);
  }

  messageCreated(conversationId: string, message: unknown): void {
    this.emit(ROOM.conversation(conversationId), REALTIME_EVENT.MESSAGE_CREATED, {
      conversationId,
      message,
    });
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (!this.server) {
      return;
    }

    try {
      this.server.to(room).emit(event, payload);
    } catch (error) {
      this.logger.error(
        `Failed to emit ${event} to ${room}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
