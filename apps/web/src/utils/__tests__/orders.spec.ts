import { describe, expect, it } from 'vitest';
import type { Order } from '@/types/orders';
import { applyOrderEvent, draftTotals, effectiveUnitPrice, lineTotal } from '../orders';

function order(id: string, status = 'NEW'): Order {
  return { id, status } as Order;
}

const all = () => true;

describe('effectiveUnitPrice', () => {
  it('prefers a variant price, then a sale price, then the list price', () => {
    const product = { price: 30000, salePrice: 25000 };

    expect(effectiveUnitPrice(product)).toBe(25000);
    expect(effectiveUnitPrice(product, { price: 32000, salePrice: null })).toBe(32000);
    expect(effectiveUnitPrice(product, { price: 32000, salePrice: 28000 })).toBe(28000);
    expect(effectiveUnitPrice(product, { price: null, salePrice: null })).toBe(25000);
  });
});

describe('draftTotals', () => {
  it('applies line discount, order discount and delivery fee', () => {
    const lines = [
      { quantity: 2, unitPrice: 25000, discount: 5000 },
      { quantity: 1, unitPrice: 10000 },
    ];

    expect(lineTotal(lines[0])).toBe(45000);
    expect(draftTotals(lines, 2000, 5000)).toEqual({ subtotal: 55000, total: 58000 });
  });

  it('does not show floating-point noise', () => {
    const lines = Array.from({ length: 10 }, () => ({ quantity: 1, unitPrice: 0.1 }));
    expect(draftTotals(lines).subtotal).toBe(1);
  });
});

describe('applyOrderEvent', () => {
  it('replaces a visible order in place', () => {
    const updated = { ...order('b'), status: 'CONFIRMED' } as Order;
    const result = applyOrderEvent([order('a'), order('b')], updated, all);

    expect(result?.map((item) => item.status)).toEqual(['NEW', 'CONFIRMED']);
  });

  it('puts a new matching order on top', () => {
    expect(applyOrderEvent([order('a')], order('b'), all)?.map((item) => item.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('drops an order that left the current filter', () => {
    const onlyNew = (item: Order) => item.status === 'NEW';
    const result = applyOrderEvent([order('a')], order('a', 'CANCELLED'), onlyNew);

    expect(result).toEqual([]);
  });

  it('removes a deleted order', () => {
    expect(applyOrderEvent([order('a')], { id: 'a', deleted: true }, all)).toEqual([]);
  });

  it('ignores events that do not touch the visible list', () => {
    const onlyNew = (item: Order) => item.status === 'NEW';

    expect(applyOrderEvent([order('a')], order('z', 'DELIVERED'), onlyNew)).toBeNull();
    expect(applyOrderEvent([order('a')], { id: 'z', deleted: true }, all)).toBeNull();
  });
});
