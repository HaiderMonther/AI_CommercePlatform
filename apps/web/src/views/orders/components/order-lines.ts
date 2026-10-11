import type { OrderLinePayload } from '@/services/orders.service';
import type { OrderItem } from '@/types/orders';
import type { Product, ProductVariant } from '@/types/users';
import { effectiveUnitPrice } from '@/utils/orders';

/** One editable row of an order being placed or changed. */
export interface EditorLine {
  key: string;
  productId: string;
  productName: string;
  imageUrl: string | null;
  /** Set when the product has variants; the row is incomplete until one is chosen. */
  variants: ProductVariant[] | null;
  variantId: string | null;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  /** What can still be sold, or null when stock is not tracked (or unknown for existing lines). */
  available: number | null;
  /** Catalog prices, to reprice when the variant changes. */
  basePrice: { price: number; salePrice: number | null } | null;
}

/** A customer the order is placed for, when opened from a profile or a conversation. */
export interface PresetCustomer {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  address?: string | null;
}

let counter = 0;
const nextKey = () => `line-${++counter}`;

export function lineFromProduct(product: Product): EditorLine {
  return {
    key: nextKey(),
    productId: product.id,
    productName: product.name,
    imageUrl: product.images[0]?.url ?? null,
    variants: product.hasVariants ? (product.variants ?? []).filter((variant) => variant.isActive) : null,
    variantId: null,
    variantName: null,
    quantity: 1,
    unitPrice: effectiveUnitPrice(product),
    discount: 0,
    available: product.trackInventory && !product.hasVariants ? product.availableStock : null,
    basePrice: { price: product.price, salePrice: product.salePrice },
  };
}

/** Existing order lines keep the price they were sold at. */
export function lineFromItem(item: OrderItem): EditorLine {
  return {
    key: nextKey(),
    productId: item.productId ?? '',
    productName: item.productName,
    imageUrl: item.imageUrl,
    variants: null,
    variantId: item.variantId,
    variantName: item.variantName,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    discount: item.discount,
    available: null,
    basePrice: null,
  };
}

export function selectVariant(line: EditorLine, variantId: string): EditorLine {
  const variant = line.variants?.find((candidate) => candidate.id === variantId);
  if (!variant || !line.basePrice) return line;

  return {
    ...line,
    variantId,
    variantName: variant.name,
    unitPrice: effectiveUnitPrice(line.basePrice, variant),
    available: variant.availableStock,
  };
}

export function isLineComplete(line: EditorLine): boolean {
  return Boolean(line.productId) && (line.variants === null || Boolean(line.variantId)) && line.quantity >= 1;
}

export function toPayload(line: EditorLine): OrderLinePayload {
  return {
    productId: line.productId,
    ...(line.variantId ? { variantId: line.variantId } : {}),
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    ...(line.discount ? { discount: line.discount } : {}),
  };
}
