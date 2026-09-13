import { InventoryMovementType } from '@prisma/client';

/** Where a stock change came from, so a movement can be traced back to its cause. */
export const MOVEMENT_REFERENCE = {
  ORDER: 'Order',
  MANUAL: 'Manual',
  IMPORT: 'Import',
  RETURN: 'Return',
} as const;

export type MovementReference = (typeof MOVEMENT_REFERENCE)[keyof typeof MOVEMENT_REFERENCE];

export interface RecordMovementInput {
  productId: string;
  variantId?: string | null;
  type: InventoryMovementType;
  /** Always a positive magnitude; the type decides the direction. */
  quantity: number;
  /** Absolute target for ADJUSTMENT, which is the only type that sets rather than shifts. */
  targetQuantity?: number;
  unitCost?: number | null;
  reason?: string | null;
  referenceType?: MovementReference | string | null;
  referenceId?: string | null;
}

/**
 * How each movement type changes the two counters.
 *
 * `stock` is what is physically on hand. `reservedStock` is what is promised to an
 * unconfirmed order — the AI holds stock while it collects the customer's details, so
 * two buyers cannot be sold the same last piece.
 *
 * Available to sell = stock - reservedStock.
 */
export const MOVEMENT_EFFECT: Record<
  InventoryMovementType,
  { stock: -1 | 0 | 1; reserved: -1 | 0 | 1 }
> = {
  STOCK_IN: { stock: 1, reserved: 0 },
  RETURN: { stock: 1, reserved: 0 },
  STOCK_OUT: { stock: -1, reserved: 0 },
  SALE: { stock: -1, reserved: 0 },
  ADJUSTMENT: { stock: 1, reserved: 0 }, // signed delta computed from targetQuantity
  RESERVATION: { stock: 0, reserved: 1 },
  RELEASE: { stock: 0, reserved: -1 },
};

export const MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  STOCK_IN: 'إدخال مخزون',
  STOCK_OUT: 'إخراج مخزون',
  ADJUSTMENT: 'جرد وتعديل',
  SALE: 'بيع',
  RETURN: 'إرجاع',
  RESERVATION: 'حجز',
  RELEASE: 'فك حجز',
};
