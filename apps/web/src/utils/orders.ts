import type { Order, OrderEvent } from '@/types/orders';

interface PriceSource {
  price: number | null;
  salePrice: number | null;
}

/**
 * Same rule as the API: a variant with its own price overrides the product, and within
 * either an active sale price wins over the list price.
 */
export function effectiveUnitPrice(product: PriceSource & { price: number }, variant?: PriceSource | null): number {
  const own = variant ? (variant.salePrice ?? variant.price) : null;
  return own ?? product.salePrice ?? product.price;
}

export interface DraftLine {
  quantity: number;
  unitPrice: number;
  discount?: number;
}

/** Rounds to the 3 decimals the API stores, so the preview matches the saved total. */
const round = (value: number) => Math.round(value * 1000) / 1000;

export function lineTotal(line: DraftLine): number {
  return round(line.quantity * line.unitPrice - (line.discount ?? 0));
}

/** Preview of what the API will compute; the API remains the authority. */
export function draftTotals(lines: DraftLine[], discount = 0, deliveryFee = 0) {
  const subtotal = round(lines.reduce((sum, line) => sum + lineTotal(line), 0));
  return { subtotal, total: round(subtotal - discount + deliveryFee) };
}

export function isDeletion(event: OrderEvent): event is { id: string; deleted: true } {
  return 'deleted' in event && event.deleted === true;
}

/**
 * Applies a live `order:updated` event to the visible page: replaces a row in place,
 * drops one that was deleted or no longer matches the filters, and puts a new matching
 * order on top. Returns null when the event does not touch the visible list.
 */
export function applyOrderEvent(
  list: Order[],
  event: OrderEvent,
  matches: (order: Order) => boolean,
): Order[] | null {
  const index = list.findIndex((order) => order.id === event.id);

  if (isDeletion(event)) {
    return index === -1 ? null : list.filter((order) => order.id !== event.id);
  }

  if (index !== -1) {
    return matches(event)
      ? list.map((order) => (order.id === event.id ? event : order))
      : list.filter((order) => order.id !== event.id);
  }

  return matches(event) ? [event, ...list] : null;
}
