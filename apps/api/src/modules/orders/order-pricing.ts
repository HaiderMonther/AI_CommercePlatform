import { Prisma } from '@prisma/client';
import { BadRequestAppException } from '@common/exceptions/app.exception';

type Money = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

export interface PriceSource {
  price: Money | null;
  salePrice: Money | null;
}

/**
 * The price a customer pays for one unit. A variant with its own price overrides the
 * product; within either, an active sale price wins over the list price.
 */
export function effectiveUnitPrice(product: PriceSource & { price: Money }, variant?: PriceSource | null): Money {
  const own = variant ? (variant.salePrice ?? variant.price) : null;
  return own ?? product.salePrice ?? product.price;
}

export interface LineInput {
  quantity: number;
  unitPrice: Money;
  discount?: Money;
}

export interface PricedLine {
  quantity: number;
  unitPrice: Money;
  discount: Money;
  total: Money;
}

export interface OrderTotals {
  subtotal: Money;
  discount: Money;
  deliveryFee: Money;
  total: Money;
}

export function priceLine(line: LineInput): PricedLine {
  const discount = line.discount ?? ZERO;
  const gross = line.unitPrice.mul(line.quantity);

  if (discount.gt(gross)) {
    throw new BadRequestAppException('خصم السطر أكبر من قيمته');
  }

  return {
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discount,
    total: gross.sub(discount),
  };
}

/**
 * Order totals. All arithmetic stays in Decimal: summing floats drifts by fractions of a
 * dinar across many lines, and the stored columns are Decimal(14,3).
 */
export function orderTotals(
  lines: PricedLine[],
  discount: Money = ZERO,
  deliveryFee: Money = ZERO,
): OrderTotals {
  const subtotal = lines.reduce((sum, line) => sum.add(line.total), ZERO);

  if (discount.gt(subtotal)) {
    throw new BadRequestAppException('خصم الطلب أكبر من مجموع المنتجات');
  }

  return { subtotal, discount, deliveryFee, total: subtotal.sub(discount).add(deliveryFee) };
}

export function toMoney(value: number | string | null | undefined): Money {
  return value === null || value === undefined ? ZERO : new Prisma.Decimal(value);
}
