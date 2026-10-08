import { ConversationMode, ConversationStatus, Prisma } from '@prisma/client';

/**
 * Conversation state transitions, kept as pure functions so the rules are readable in
 * one place and unit-testable without a database.
 *
 * Lifecycle: OPEN (needs attention) → PENDING (waiting on the customer) → RESOLVED
 * (handled, reopens when the customer writes again) → CLOSED (final; the next message
 * starts a new conversation).
 */

/** Statuses that count as "in the inbox". */
export const ACTIVE_CONVERSATION_STATUSES: ConversationStatus[] = [
  ConversationStatus.OPEN,
  ConversationStatus.PENDING,
];

/** Statuses an inbound message may continue; CLOSED starts a fresh conversation. */
export const REUSABLE_CONVERSATION_STATUSES: ConversationStatus[] = [
  ConversationStatus.OPEN,
  ConversationStatus.PENDING,
  ConversationStatus.RESOLVED,
];

export const HANDOVER_REASON = {
  AGENT_REPLIED: 'رد موظف على المحادثة',
  MANUAL: 'تحويل يدوي من لوحة التحكم',
} as const;

export interface ConversationState {
  status: ConversationStatus;
  mode: ConversationMode;
  assignedUserId: string | null;
}

export type ConversationPatch = Prisma.ConversationUncheckedUpdateInput;

function reopen(state: ConversationState): ConversationPatch {
  return state.status === ConversationStatus.OPEN
    ? {}
    : { status: ConversationStatus.OPEN, closedAt: null };
}

/**
 * An agent's reply is also an intervention: the AI stops answering (mode HUMAN), an
 * unassigned conversation becomes the replying agent's, and it counts as read.
 */
export function agentReplyPatch(
  state: ConversationState,
  agentId: string,
  at: Date,
): ConversationPatch {
  return {
    ...reopen(state),
    lastMessageAt: at,
    unreadCount: 0,
    ...(state.mode === ConversationMode.AI
      ? { mode: ConversationMode.HUMAN, handoverAt: at, handoverReason: HANDOVER_REASON.AGENT_REPLIED }
      : {}),
    ...(state.assignedUserId ? {} : { assignedUserId: agentId }),
  };
}

/** A customer message puts the conversation back in front of the team. */
export function inboundPatch(state: ConversationState, at: Date): ConversationPatch {
  return {
    ...reopen(state),
    lastMessageAt: at,
    unreadCount: { increment: 1 },
  };
}

export function statusPatch(status: ConversationStatus, at: Date): ConversationPatch {
  const done = status === ConversationStatus.RESOLVED || status === ConversationStatus.CLOSED;

  return {
    status,
    closedAt: done ? at : null,
    // A handled conversation no longer waits on anyone, so it leaves the unread count.
    ...(done ? { unreadCount: 0 } : {}),
  };
}

export function modePatch(
  mode: ConversationMode,
  reason: string | undefined,
  at: Date,
): ConversationPatch {
  return mode === ConversationMode.HUMAN
    ? { mode, handoverAt: at, handoverReason: reason?.trim() || HANDOVER_REASON.MANUAL }
    : { mode, handoverAt: null, handoverReason: null };
}
