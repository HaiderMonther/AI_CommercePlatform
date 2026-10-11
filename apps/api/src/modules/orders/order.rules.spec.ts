import { DeliveryStatus, OrderStatus, PaymentStatus, Prisma } from '@prisma/client';
import { effectiveUnitPrice, orderTotals, priceLine } from './order-pricing';
import {
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  OrderState,
  canTransition,
  paymentStatusOf,
  statusPatch,
  stockStageOf,
} from './order.rules';
import { StockHolding, holdingKey, reservationDiff, stageMovements } from './order-stock';

const d = (value: number | string) => new Prisma.Decimal(value);
const at = new Date('2026-10-09T10:00:00Z');

function state(overrides: Partial<OrderState> = {}): OrderState {
  return {
    status: OrderStatus.NEW,
    deliveryStatus: DeliveryStatus.PENDING,
    paidAmount: d(0),
    confirmedAt: null,
    ...overrides,
  };
}

describe('order lifecycle', () => {
  it('defines transitions and a label for every status in the schema', () => {
    const statuses = Object.values(OrderStatus).sort();
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual(statuses);
    expect(Object.keys(ORDER_STATUS_LABELS).sort()).toEqual(statuses);
  });

  it('allows skipping forward', () => {
    expect(canTransition(OrderStatus.NEW, OrderStatus.DELIVERED)).toBe(true);
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.SHIPPED)).toBe(true);
  });

  it('never moves backwards', () => {
    expect(canTransition(OrderStatus.SHIPPED, OrderStatus.PREPARING)).toBe(false);
    expect(canTransition(OrderStatus.CONFIRMED, OrderStatus.NEW)).toBe(false);
  });

  it.each([OrderStatus.NEW, OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.SHIPPED])(
    'can cancel a %s order',
    (status) => {
      expect(canTransition(status, OrderStatus.CANCELLED)).toBe(true);
    },
  );

  it.each([OrderStatus.DELIVERED, OrderStatus.CANCELLED])('treats %s as final', (status) => {
    expect(ORDER_TRANSITIONS[status]).toEqual([]);
  });

  it('maps statuses to the stock stage they hold', () => {
    expect(stockStageOf(OrderStatus.NEW)).toBe('RESERVED');
    expect(stockStageOf(OrderStatus.PREPARING)).toBe('RESERVED');
    expect(stockStageOf(OrderStatus.SHIPPED)).toBe('SOLD');
    expect(stockStageOf(OrderStatus.DELIVERED)).toBe('SOLD');
    expect(stockStageOf(OrderStatus.CANCELLED)).toBe('NONE');
  });
});

describe('statusPatch', () => {
  it('stamps confirmedAt when confirming', () => {
    expect(statusPatch(state(), OrderStatus.CONFIRMED, at)).toEqual({
      status: OrderStatus.CONFIRMED,
      confirmedAt: at,
    });
  });

  it('keeps the original confirmation time', () => {
    const patch = statusPatch(
      state({ status: OrderStatus.CONFIRMED, confirmedAt: new Date('2026-10-01') }),
      OrderStatus.PREPARING,
      at,
    );
    expect(patch).toEqual({ status: OrderStatus.PREPARING });
  });

  it('marks a skipped confirmation and the delivery when handed over directly', () => {
    expect(statusPatch(state(), OrderStatus.DELIVERED, at)).toEqual({
      status: OrderStatus.DELIVERED,
      confirmedAt: at,
      deliveredAt: at,
      deliveryStatus: DeliveryStatus.DELIVERED,
    });
  });

  it('puts a shipped order in transit', () => {
    expect(statusPatch(state(), OrderStatus.SHIPPED, at).deliveryStatus).toBe(
      DeliveryStatus.IN_TRANSIT,
    );
  });

  it('records the cancel reason without confirming', () => {
    expect(statusPatch(state(), OrderStatus.CANCELLED, at, '  الزبون عدل ')).toEqual({
      status: OrderStatus.CANCELLED,
      cancelledAt: at,
      cancelReason: 'الزبون عدل',
    });
  });

  it('marks a refused shipment as returned and a paid cancellation as refunded', () => {
    const patch = statusPatch(
      state({ status: OrderStatus.SHIPPED, paidAmount: d(5000), confirmedAt: at }),
      OrderStatus.CANCELLED,
      at,
      'رفض الاستلام',
    );

    expect(patch.deliveryStatus).toBe(DeliveryStatus.RETURNED);
    expect(patch.paymentStatus).toBe(PaymentStatus.REFUNDED);
  });
});

describe('paymentStatusOf', () => {
  it.each([
    [0, 30000, PaymentStatus.UNPAID],
    [10000, 30000, PaymentStatus.PARTIALLY_PAID],
    [30000, 30000, PaymentStatus.PAID],
    [0, 0, PaymentStatus.UNPAID],
  ])('paid %d of %d is %s', (paid, total, expected) => {
    expect(paymentStatusOf(d(paid), d(total))).toBe(expected);
  });
});

describe('order pricing', () => {
  it('prefers a variant price, then a sale price, then the list price', () => {
    const product = { price: d(30000), salePrice: d(25000) };

    expect(effectiveUnitPrice(product)).toEqual(d(25000));
    expect(effectiveUnitPrice(product, { price: d(32000), salePrice: null })).toEqual(d(32000));
    expect(effectiveUnitPrice(product, { price: d(32000), salePrice: d(28000) })).toEqual(d(28000));
    expect(effectiveUnitPrice(product, { price: null, salePrice: null })).toEqual(d(25000));
    expect(effectiveUnitPrice({ price: d(30000), salePrice: null })).toEqual(d(30000));
  });

  it('totals lines without floating-point drift', () => {
    const lines = Array.from({ length: 10 }, () =>
      priceLine({ quantity: 1, unitPrice: d('0.1') }),
    );

    expect(orderTotals(lines).subtotal.toString()).toBe('1');
  });

  it('applies line discount, order discount and delivery fee', () => {
    const lines = [
      priceLine({ quantity: 2, unitPrice: d(25000), discount: d(5000) }),
      priceLine({ quantity: 1, unitPrice: d(10000) }),
    ];

    const totals = orderTotals(lines, d(2000), d(5000));

    expect(lines[0].total.toNumber()).toBe(45000);
    expect(totals.subtotal.toNumber()).toBe(55000);
    expect(totals.total.toNumber()).toBe(58000);
  });

  it('rejects discounts larger than what they discount', () => {
    expect(() => priceLine({ quantity: 1, unitPrice: d(1000), discount: d(1001) })).toThrow();
    expect(() => orderTotals([priceLine({ quantity: 1, unitPrice: d(1000) })], d(1001))).toThrow();
  });
});

describe('order stock movements', () => {
  const holding = (overrides: Partial<StockHolding>): StockHolding => ({
    productId: 'p1',
    variantId: null,
    reserved: 0,
    sold: 0,
    ...overrides,
  });

  it('turns a reservation into a sale when the goods leave', () => {
    expect(stageMovements([holding({ reserved: 3 })], 'RESERVED', 'SOLD')).toEqual([
      { productId: 'p1', variantId: null, type: 'RELEASE', quantity: 3 },
      { productId: 'p1', variantId: null, type: 'SALE', quantity: 3 },
    ]);
  });

  it('releases the reservation when cancelled before shipping', () => {
    expect(stageMovements([holding({ reserved: 2 })], 'RESERVED', 'NONE')).toEqual([
      { productId: 'p1', variantId: null, type: 'RELEASE', quantity: 2 },
    ]);
  });

  it('books the goods back in when a shipped order is cancelled', () => {
    expect(stageMovements([holding({ sold: 2 })], 'SOLD', 'NONE')).toEqual([
      { productId: 'p1', variantId: null, type: 'RETURN', quantity: 2 },
    ]);
  });

  it('moves nothing within a stage or for lines that never reserved', () => {
    expect(stageMovements([holding({ reserved: 2 })], 'RESERVED', 'RESERVED')).toEqual([]);
    expect(stageMovements([holding({ sold: 2 })], 'SOLD', 'SOLD')).toEqual([]);
    expect(stageMovements([holding({})], 'RESERVED', 'SOLD')).toEqual([]);
  });

  it('orders movements by product so concurrent orders lock in the same sequence', () => {
    const movements = stageMovements(
      [holding({ productId: 'p2', reserved: 1 }), holding({ productId: 'p1', reserved: 1 })],
      'RESERVED',
      'NONE',
    );

    expect(movements.map((movement) => movement.productId)).toEqual(['p1', 'p2']);
  });

  it('reserves only the difference when lines change', () => {
    const required = new Map([
      [holdingKey('p1', null), { productId: 'p1', variantId: null, quantity: 5 }],
      [holdingKey('p3', 'v1'), { productId: 'p3', variantId: 'v1', quantity: 1 }],
    ]);

    const movements = reservationDiff(
      [
        holding({ productId: 'p1', reserved: 2 }),
        holding({ productId: 'p2', reserved: 4 }),
      ],
      required,
    );

    expect(movements).toEqual([
      { productId: 'p1', variantId: null, type: 'RESERVATION', quantity: 3 },
      { productId: 'p2', variantId: null, type: 'RELEASE', quantity: 4 },
      { productId: 'p3', variantId: 'v1', type: 'RESERVATION', quantity: 1 },
    ]);
  });

  it('books nothing when the lines are unchanged', () => {
    const required = new Map([[holdingKey('p1', null), { productId: 'p1', variantId: null, quantity: 2 }]]);
    expect(reservationDiff([holding({ reserved: 2 })], required)).toEqual([]);
  });
});
