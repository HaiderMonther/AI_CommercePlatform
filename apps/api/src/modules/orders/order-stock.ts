import { InventoryMovementType } from '@prisma/client';
import { StockStage } from './order.rules';

/** One product (or variant) line of what an order holds in the warehouse. */
export interface StockHolding {
  productId: string;
  variantId: string | null;
  /** Units promised to the order but still on the shelf. */
  reserved: number;
  /** Units that left the shelf for this order. */
  sold: number;
}

export interface PlannedMovement {
  productId: string;
  variantId: string | null;
  type: InventoryMovementType;
  quantity: number;
}

export function holdingKey(productId: string, variantId: string | null): string {
  return `${productId}:${variantId ?? ''}`;
}

/**
 * Stable lock order: every caller touches products in the same sequence, so two orders
 * sharing products queue behind each other instead of deadlocking.
 */
function byLockOrder(a: PlannedMovement, b: PlannedMovement): number {
  return (
    a.productId.localeCompare(b.productId) ||
    (a.variantId ?? '').localeCompare(b.variantId ?? '')
  );
}

/**
 * Movements that carry an order's holdings from one stock stage to the next.
 *
 * The holdings come from the ledger (the order's own movements), not from its current
 * lines, so a line on a product that was not tracked when the order was placed is never
 * "released" from a reservation it never made.
 */
export function stageMovements(
  holdings: StockHolding[],
  from: StockStage,
  to: StockStage,
): PlannedMovement[] {
  if (from === to) {
    return [];
  }

  const movements: PlannedMovement[] = [];

  for (const holding of holdings) {
    const { productId, variantId, reserved, sold } = holding;

    if (from === 'RESERVED' && to === 'SOLD' && reserved > 0) {
      // Two entries so the ledger shows both facts: the promise ended and the goods left.
      movements.push({ productId, variantId, type: InventoryMovementType.RELEASE, quantity: reserved });
      movements.push({ productId, variantId, type: InventoryMovementType.SALE, quantity: reserved });
    }

    if (to === 'NONE') {
      if (reserved > 0) {
        movements.push({ productId, variantId, type: InventoryMovementType.RELEASE, quantity: reserved });
      }
      if (sold > 0) {
        movements.push({ productId, variantId, type: InventoryMovementType.RETURN, quantity: sold });
      }
    }
  }

  // Sorting is stable, so RELEASE stays ahead of SALE for the same product.
  return movements.sort(byLockOrder);
}

/**
 * Reservation changes needed to move a still-reserved order from what it holds to what
 * its new lines require. Only the difference is booked, so editing one line does not
 * churn the ledger for the others.
 */
export function reservationDiff(
  holdings: StockHolding[],
  required: Map<string, { productId: string; variantId: string | null; quantity: number }>,
): PlannedMovement[] {
  const movements: PlannedMovement[] = [];
  const seen = new Set<string>();

  for (const holding of holdings) {
    const key = holdingKey(holding.productId, holding.variantId);
    seen.add(key);
    const target = required.get(key)?.quantity ?? 0;
    const delta = target - holding.reserved;

    if (delta !== 0) {
      movements.push({
        productId: holding.productId,
        variantId: holding.variantId,
        type: delta > 0 ? InventoryMovementType.RESERVATION : InventoryMovementType.RELEASE,
        quantity: Math.abs(delta),
      });
    }
  }

  for (const [key, line] of required) {
    if (!seen.has(key) && line.quantity > 0) {
      movements.push({
        productId: line.productId,
        variantId: line.variantId,
        type: InventoryMovementType.RESERVATION,
        quantity: line.quantity,
      });
    }
  }

  return movements.sort(byLockOrder);
}
