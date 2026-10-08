import { ConversationMode, ConversationStatus } from '@prisma/client';
import {
  HANDOVER_REASON,
  agentReplyPatch,
  inboundPatch,
  modePatch,
  statusPatch,
} from './conversation.rules';

const at = new Date('2026-09-28T10:00:00Z');

describe('conversation rules', () => {
  describe('agentReplyPatch', () => {
    it('hands an AI conversation over to the replying agent and assigns it', () => {
      const patch = agentReplyPatch(
        { status: ConversationStatus.OPEN, mode: ConversationMode.AI, assignedUserId: null },
        'agent-1',
        at,
      );

      expect(patch).toEqual({
        lastMessageAt: at,
        unreadCount: 0,
        mode: ConversationMode.HUMAN,
        handoverAt: at,
        handoverReason: HANDOVER_REASON.AGENT_REPLIED,
        assignedUserId: 'agent-1',
      });
    });

    it('keeps an existing assignee and handover', () => {
      const patch = agentReplyPatch(
        { status: ConversationStatus.OPEN, mode: ConversationMode.HUMAN, assignedUserId: 'owner' },
        'agent-1',
        at,
      );

      expect(patch).toEqual({ lastMessageAt: at, unreadCount: 0 });
    });

    it.each([ConversationStatus.PENDING, ConversationStatus.RESOLVED, ConversationStatus.CLOSED])(
      'reopens a %s conversation',
      (status) => {
        const patch = agentReplyPatch(
          { status, mode: ConversationMode.HUMAN, assignedUserId: 'agent-1' },
          'agent-1',
          at,
        );

        expect(patch.status).toBe(ConversationStatus.OPEN);
        expect(patch.closedAt).toBeNull();
      },
    );
  });

  describe('inboundPatch', () => {
    it('increments unread without touching mode or assignee', () => {
      const patch = inboundPatch(
        { status: ConversationStatus.OPEN, mode: ConversationMode.AI, assignedUserId: null },
        at,
      );

      expect(patch).toEqual({ lastMessageAt: at, unreadCount: { increment: 1 } });
    });

    it('reopens a resolved conversation', () => {
      const patch = inboundPatch(
        { status: ConversationStatus.RESOLVED, mode: ConversationMode.HUMAN, assignedUserId: 'a' },
        at,
      );

      expect(patch.status).toBe(ConversationStatus.OPEN);
      expect(patch.closedAt).toBeNull();
    });
  });

  describe('statusPatch', () => {
    it.each([ConversationStatus.RESOLVED, ConversationStatus.CLOSED])(
      'stamps closedAt and clears unread when %s',
      (status) => {
        expect(statusPatch(status, at)).toEqual({ status, closedAt: at, unreadCount: 0 });
      },
    );

    it.each([ConversationStatus.OPEN, ConversationStatus.PENDING])(
      'clears closedAt when moving back to %s',
      (status) => {
        expect(statusPatch(status, at)).toEqual({ status, closedAt: null });
      },
    );
  });

  describe('modePatch', () => {
    it('records when and why a conversation moved to a human', () => {
      expect(modePatch(ConversationMode.HUMAN, '  الزبون طلب موظف ', at)).toEqual({
        mode: ConversationMode.HUMAN,
        handoverAt: at,
        handoverReason: 'الزبون طلب موظف',
      });
    });

    it('falls back to a default reason', () => {
      expect(modePatch(ConversationMode.HUMAN, undefined, at).handoverReason).toBe(
        HANDOVER_REASON.MANUAL,
      );
    });

    it('clears the handover when returning to AI', () => {
      expect(modePatch(ConversationMode.AI, 'ignored', at)).toEqual({
        mode: ConversationMode.AI,
        handoverAt: null,
        handoverReason: null,
      });
    });
  });
});
