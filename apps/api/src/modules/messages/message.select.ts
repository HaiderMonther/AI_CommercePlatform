import { Prisma } from '@prisma/client';

/** The message shape every API response and realtime event carries. */
export const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  senderType: true,
  direction: true,
  type: true,
  content: true,
  mediaUrl: true,
  metadata: true,
  deliveryStatus: true,
  failureReason: true,
  createdAt: true,
  senderUser: { select: { id: true, fullName: true } },
} as const satisfies Prisma.MessageSelect;

export type MessageView = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;
