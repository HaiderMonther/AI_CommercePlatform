import type { Conversation, Message } from '@/types/crm';

function timeOf(value: string | null): number {
  return value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY;
}

/** Inbox order, as the API sorts it: latest activity first, never-messaged last. */
export function compareConversations(a: Conversation, b: Conversation): number {
  return (
    timeOf(b.lastMessageAt) - timeOf(a.lastMessageAt) ||
    timeOf(b.createdAt) - timeOf(a.createdAt)
  );
}

/**
 * Applies a realtime inbox update to the loaded page: replaces the row, inserts it when
 * it newly matches the active tab, drops it when it no longer does, and re-sorts.
 */
export function upsertConversation(
  list: Conversation[],
  updated: Conversation,
  matches: (conversation: Conversation) => boolean,
): Conversation[] {
  const rest = list.filter((conversation) => conversation.id !== updated.id);
  const next = matches(updated) ? [...rest, updated] : rest;
  return next.sort(compareConversations);
}

/**
 * Adds a message to the open thread once. The sender receives its own reply twice — from
 * the HTTP response and from the realtime echo — and both must render as one bubble.
 */
export function appendMessage(messages: Message[], message: Message): Message[] {
  if (messages.some((existing) => existing.id === message.id)) {
    return messages;
  }

  return [...messages, message].sort(
    (a, b) => timeOf(a.createdAt) - timeOf(b.createdAt) || a.id.localeCompare(b.id),
  );
}

/** Prepends an older page, skipping anything already shown. */
export function prependMessages(messages: Message[], older: Message[]): Message[] {
  const known = new Set(messages.map((message) => message.id));
  return [...older.filter((message) => !known.has(message.id)), ...messages];
}

/** Local calendar day, used to draw date separators in the thread. */
export function dayKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
