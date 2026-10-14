import { describe, expect, it } from 'vitest';
import type { Conversation, Message } from '@/types/crm';
import { appendMessage, prependMessages, updateMessage, upsertConversation } from '../conversations';

function conversation(id: string, lastMessageAt: string | null, status = 'OPEN'): Conversation {
  return {
    id,
    lastMessageAt,
    status,
    createdAt: '2026-01-01T00:00:00Z',
  } as Conversation;
}

function message(id: string, createdAt: string): Message {
  return { id, createdAt } as Message;
}

const isActive = (item: Conversation) => item.status === 'OPEN' || item.status === 'PENDING';

describe('upsertConversation', () => {
  it('moves an updated conversation to the top', () => {
    const list = [conversation('a', '2026-01-02T10:00:00Z'), conversation('b', '2026-01-02T09:00:00Z')];

    const result = upsertConversation(list, conversation('b', '2026-01-02T11:00:00Z'), isActive);

    expect(result.map((item) => item.id)).toEqual(['b', 'a']);
  });

  it('inserts a conversation that newly matches the tab', () => {
    const result = upsertConversation(
      [conversation('a', '2026-01-02T10:00:00Z')],
      conversation('new', '2026-01-02T12:00:00Z'),
      isActive,
    );

    expect(result.map((item) => item.id)).toEqual(['new', 'a']);
  });

  it('drops a conversation that no longer matches the tab', () => {
    const list = [conversation('a', '2026-01-02T10:00:00Z')];

    const result = upsertConversation(list, conversation('a', '2026-01-02T10:00:00Z', 'CLOSED'), isActive);

    expect(result).toEqual([]);
  });

  it('sorts never-messaged conversations last', () => {
    const result = upsertConversation(
      [conversation('empty', null)],
      conversation('active', '2026-01-02T10:00:00Z'),
      isActive,
    );

    expect(result.map((item) => item.id)).toEqual(['active', 'empty']);
  });
});

describe('appendMessage', () => {
  it('renders a reply once when both the HTTP response and the realtime echo arrive', () => {
    const reply = message('m2', '2026-01-02T10:01:00Z');
    const thread = appendMessage([message('m1', '2026-01-02T10:00:00Z')], reply);

    expect(appendMessage(thread, reply)).toHaveLength(2);
  });

  it('keeps the thread in time order when an event arrives late', () => {
    const thread = [message('m1', '2026-01-02T10:00:00Z'), message('m3', '2026-01-02T10:02:00Z')];

    const result = appendMessage(thread, message('m2', '2026-01-02T10:01:00Z'));

    expect(result.map((item) => item.id)).toEqual(['m1', 'm2', 'm3']);
  });
});

describe('prependMessages', () => {
  it('adds an older page without duplicating the boundary message', () => {
    const current = [message('m3', '2026-01-02T10:02:00Z')];
    const older = [message('m1', '2026-01-02T10:00:00Z'), message('m3', '2026-01-02T10:02:00Z')];

    expect(prependMessages(current, older).map((item) => item.id)).toEqual(['m1', 'm3']);
  });
});

describe('updateMessage', () => {
  const sent = (id: string, createdAt: string) =>
    ({ ...message(id, createdAt), deliveryStatus: 'SENT' }) as Message;

  it('replaces the message in place', () => {
    const result = updateMessage(
      [message('a', '2026-01-01T00:01:00Z'), message('b', '2026-01-01T00:02:00Z')],
      sent('b', '2026-01-01T00:02:00Z'),
    );

    expect(result.map((item) => item.deliveryStatus)).toEqual([undefined, 'SENT']);
  });

  it('adds an update that arrives before the message itself', () => {
    const result = updateMessage(
      [message('a', '2026-01-01T00:01:00Z')],
      message('b', '2026-01-01T00:02:00Z'),
    );

    expect(result.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('keeps the newer state when the send response arrives after its update', () => {
    const update = sent('b', '2026-01-01T00:02:00Z');
    const response = { ...update, deliveryStatus: 'PENDING' } as Message;

    expect(appendMessage(updateMessage([], update), response)[0].deliveryStatus).toBe('SENT');
  });
});
