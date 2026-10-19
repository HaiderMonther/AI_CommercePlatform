/**
 * Socket.IO endpoint. It sits under `/api/` so the nginx and Vite proxies that already
 * forward the REST API (with the WebSocket upgrade headers) carry it unchanged.
 */
export const REALTIME_PATH = '/api/socket.io';

/** Events the server pushes, and the two a client may send. */
export const REALTIME_EVENT = {
  /** Inbox row changed: new message, status, mode, assignee or unread count. */
  CONVERSATION_UPDATED: 'conversation:updated',
  /** A message was added to a conversation the client has joined. */
  MESSAGE_CREATED: 'message:created',
  /** A message's delivery state changed (sent, delivered, read, failed). */
  MESSAGE_UPDATED: 'message:updated',
  /** Order list row changed: created, status, payment, lines or details. */
  ORDER_UPDATED: 'order:updated',
  /** A notification for the connected user (sent to their personal room). */
  NOTIFICATION_CREATED: 'notification:created',

  CONVERSATION_JOIN: 'conversation:join',
  CONVERSATION_LEAVE: 'conversation:leave',
} as const;

/**
 * Room naming. Every room is derived from ids resolved server-side (the user record and a
 * company-filtered lookup), never from a name the client sends, so a socket cannot land
 * in another tenant's room.
 */
export const ROOM = {
  company: (companyId: string) => `company:${companyId}`,
  /** Members hold `conversations.read`; inbox updates go here, not to the whole company. */
  companyConversations: (companyId: string) => `company:${companyId}:conversations`,
  /** Members hold `orders.read`; order list updates go here. */
  companyOrders: (companyId: string) => `company:${companyId}:orders`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  user: (userId: string) => `user:${userId}`,
} as const;

/** Shape of every client → server acknowledgement. */
export interface RealtimeAck {
  ok: boolean;
  code?: string;
}
