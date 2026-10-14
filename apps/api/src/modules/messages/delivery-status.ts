import { MessageDeliveryStatus } from '@prisma/client';

const RANK: Record<MessageDeliveryStatus, number> = {
  PENDING: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 1,
};

/**
 * Whether a delivery receipt moves a message forward.
 *
 * Providers deliver receipts out of order (a "read" can overtake "delivered"), so a status
 * only ever advances: a late "sent" never downgrades a read message. FAILED is accepted
 * only before the message reached the customer.
 */
export function advancesDelivery(
  current: MessageDeliveryStatus,
  next: MessageDeliveryStatus,
): boolean {
  if (current === next || current === MessageDeliveryStatus.FAILED) {
    return false;
  }
  if (next === MessageDeliveryStatus.FAILED) {
    return current === MessageDeliveryStatus.PENDING || current === MessageDeliveryStatus.SENT;
  }
  return RANK[next] > RANK[current];
}
