import { io, type Socket } from 'socket.io-client';
import { ref } from 'vue';
import { refreshAccessToken } from './http';
import { useAuthStore } from '@/stores/auth.store';

/** Must match `REALTIME_PATH` on the API. It sits under /api so the proxies forward it. */
const REALTIME_PATH = '/api/socket.io';

export const REALTIME_EVENT = {
  CONVERSATION_UPDATED: 'conversation:updated',
  MESSAGE_CREATED: 'message:created',
} as const;

/** Server refusals that a new token will not fix; the client stops retrying on these. */
const FATAL_CODES = new Set(['UNAUTHENTICATED', 'TOKEN_INVALID', 'ACCOUNT_SUSPENDED', 'FORBIDDEN']);

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'offline';

export const realtimeStatus = ref<RealtimeStatus>('idle');

type Handler = (payload: never) => void;

let socket: Socket | null = null;
let tokenInUse: string | null = null;
const handlers = new Map<string, Set<Handler>>();
/** Conversation rooms to rejoin after every reconnect: rooms do not survive one. */
const joinedConversations = new Set<string>();

/** The API origin: same origin behind the proxy, or the host of an absolute API URL. */
function realtimeOrigin(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
  return new URL(base, window.location.origin).origin;
}

function dispatch(event: string, payload: unknown): void {
  handlers.get(event)?.forEach((handler) => (handler as (value: unknown) => void)(payload));
}

/**
 * The server closes the socket when its access token expires, and refuses an expired
 * one at handshake. Either way: reuse a token the HTTP layer has already refreshed, or
 * refresh through the same single-flight call the HTTP layer uses — two independent
 * refreshes would present the rotated refresh token twice and end the session.
 */
async function reconnectWithFreshToken(): Promise<void> {
  const auth = useAuthStore();
  const token =
    auth.accessToken && auth.accessToken !== tokenInUse
      ? auth.accessToken
      : await refreshAccessToken();

  if (token && socket) {
    socket.connect();
  } else {
    realtimeStatus.value = 'offline';
  }
}

export function connectRealtime(): void {
  if (socket) return;

  const auth = useAuthStore();
  realtimeStatus.value = 'connecting';

  socket = io(realtimeOrigin(), {
    path: REALTIME_PATH,
    transports: ['websocket'],
    reconnectionDelayMax: 10_000,
    // A callback, so every reconnect reads the current token rather than the first one.
    auth: (callback) => {
      tokenInUse = auth.accessToken;
      callback({ token: auth.accessToken });
    },
  });

  socket.on('connect', () => {
    realtimeStatus.value = 'connected';
    joinedConversations.forEach((conversationId) =>
      socket?.emit('conversation:join', { conversationId }),
    );
  });

  socket.on('disconnect', (reason) => {
    realtimeStatus.value = 'offline';
    // Server-initiated closes are not retried by socket.io itself.
    if (reason === 'io server disconnect') {
      void reconnectWithFreshToken();
    }
  });

  socket.on('connect_error', (error) => {
    realtimeStatus.value = 'offline';
    if (error.message === 'TOKEN_EXPIRED') {
      void reconnectWithFreshToken();
    } else if (FATAL_CODES.has(error.message)) {
      socket?.disconnect();
    }
  });

  socket.onAny(dispatch);
}

export function disconnectRealtime(): void {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  tokenInUse = null;
  joinedConversations.clear();
  realtimeStatus.value = 'idle';
}

/** Subscribes to a server event; returns the unsubscribe function. */
export function onRealtime<T>(event: string, handler: (payload: T) => void): () => void {
  const set = handlers.get(event) ?? new Set<Handler>();
  set.add(handler as Handler);
  handlers.set(event, set);
  return () => set.delete(handler as Handler);
}

export function joinConversation(conversationId: string): void {
  joinedConversations.add(conversationId);
  if (socket?.connected) {
    socket.emit('conversation:join', { conversationId });
  }
}

export function leaveConversation(conversationId: string): void {
  joinedConversations.delete(conversationId);
  if (socket?.connected) {
    socket.emit('conversation:leave', { conversationId });
  }
}
