import { DeliveryStatus, OrderStatus, PaymentStatus, Prisma } from '@prisma/client';

/**
 * Order lifecycle, kept as pure functions so the rules read in one place and are
 * unit-testable without a database.
 *
 *   NEW ─▶ CONFIRMED ─▶ PREPARING ─▶ SHIPPED ─▶ DELIVERED
 *    │         │            │           │
 *    └─────────┴────────────┴───────────┴──▶ CANCELLED
 *
 * An order may skip forward (a shop that hands goods over the counter goes NEW →
 * DELIVERED) but never moves back. DELIVERED and CANCELLED are final.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: [
    OrderStatus.CONFIRMED,
    OrderStatus.PREPARING,
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ],
  CONFIRMED: [
    OrderStatus.PREPARING,
    OrderStatus.SHIPPED,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ],
  PREPARING: [OrderStatus.SHIPPED, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  // A shipped order the customer refuses at the door comes back as a cancellation.
  SHIPPED: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

/** Orders still being worked on. */
export const OPEN_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.SHIPPED,
];

/** Lines can change until the order is being packed. */
export const ITEMS_EDITABLE_STATUSES: OrderStatus[] = [OrderStatus.NEW, OrderStatus.CONFIRMED];

/** Discount and delivery fee can change until the goods leave. */
export const PRICING_EDITABLE_STATUSES: OrderStatus[] = [
  OrderStatus.NEW,
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
];

/** Delivery states an operator may set by hand; the rest follow the order status. */
export const MANUAL_DELIVERY_STATUSES: DeliveryStatus[] = [
  DeliveryStatus.PENDING,
  DeliveryStatus.ASSIGNED,
  DeliveryStatus.IN_TRANSIT,
  DeliveryStatus.FAILED,
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'جديد',
  CONFIRMED: 'مؤكد',
  PREPARING: 'قيد التجهيز',
  SHIPPED: 'تم الشحن',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغى',
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * What an order in a given status holds in the warehouse.
 *
 * RESERVED: promised but still on the shelf (stock unchanged, reservedStock up).
 * SOLD: physically gone (stock down). NONE: holds nothing.
 */
export type StockStage = 'RESERVED' | 'SOLD' | 'NONE';

export function stockStageOf(status: OrderStatus): StockStage {
  switch (status) {
    case OrderStatus.SHIPPED:
    case OrderStatus.DELIVERED:
      return 'SOLD';
    case OrderStatus.CANCELLED:
      return 'NONE';
    default:
      return 'RESERVED';
  }
}

export function paymentStatusOf(
  paidAmount: Prisma.Decimal,
  total: Prisma.Decimal,
): PaymentStatus {
  if (paidAmount.lte(0)) return PaymentStatus.UNPAID;
  if (paidAmount.lt(total)) return PaymentStatus.PARTIALLY_PAID;
  return PaymentStatus.PAID;
}

export interface OrderState {
  status: OrderStatus;
  deliveryStatus: DeliveryStatus;
  paidAmount: Prisma.Decimal;
  confirmedAt: Date | null;
}

/**
 * The columns a status change writes besides `status` itself: lifecycle timestamps,
 * the delivery state that follows from it, and the refund flag on a paid cancellation.
 */
export function statusPatch(
  order: OrderState,
  to: OrderStatus,
  at: Date,
  cancelReason?: string,
): Prisma.OrderUncheckedUpdateInput {
  const patch: Prisma.OrderUncheckedUpdateInput = { status: to };

  // Skipping straight past CONFIRMED still means the order was confirmed.
  if (!order.confirmedAt && to !== OrderStatus.CANCELLED && to !== OrderStatus.NEW) {
    patch.confirmedAt = at;
  }

  if (to === OrderStatus.SHIPPED) {
    patch.deliveryStatus = DeliveryStatus.IN_TRANSIT;
  }

  if (to === OrderStatus.DELIVERED) {
    patch.deliveryStatus = DeliveryStatus.DELIVERED;
    patch.deliveredAt = at;
  }

  if (to === OrderStatus.CANCELLED) {
    patch.cancelledAt = at;
    patch.cancelReason = cancelReason?.trim() || null;
    if (order.status === OrderStatus.SHIPPED) {
      patch.deliveryStatus = DeliveryStatus.RETURNED;
    }
    if (order.paidAmount.gt(0)) {
      patch.paymentStatus = PaymentStatus.REFUNDED;
    }
  }

  return patch;
}
