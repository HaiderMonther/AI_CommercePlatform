import type { ChannelType, ConversationStatus, CustomerStatus } from './crm';

export type OrderStatus = 'NEW' | 'CONFIRMED' | 'PREPARING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED';
export type OrderDeliveryStatus =
  | 'PENDING'
  | 'ASSIGNED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'RETURNED'
  | 'FAILED';
export type PaymentMethod =
  | 'CASH_ON_DELIVERY'
  | 'BANK_TRANSFER'
  | 'ZAIN_CASH'
  | 'ASIA_HAWALA'
  | 'FIB'
  | 'CARD'
  | 'OTHER';
export type OrderSource = 'AI' | 'AGENT' | 'DASHBOARD' | 'API';

/** A row of the orders list, also the payload of the `order:updated` event. */
export interface Order {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryStatus: OrderDeliveryStatus;
  paymentMethod: PaymentMethod;
  source: OrderSource;
  currency: string;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  paidAmount: number;
  balanceDue: number;
  customerId: string;
  conversationId: string | null;
  customerName: string;
  customerPhone: string;
  deliveryCity: string | null;
  itemsCount: number;
  createdByUser: { id: string; fullName: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  imageUrl: string | null;
}

export interface OrderStatusChange {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  createdAt: string;
  user: { id: string; fullName: string } | null;
}

export interface OrderDetail extends Order {
  deliveryAddress: string | null;
  notes: string | null;
  confirmedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  customer: {
    id: string;
    name: string;
    phone: string | null;
    city: string | null;
    status: CustomerStatus;
    deleted: boolean;
  };
  conversation: { id: string; channel: ChannelType; status: ConversationStatus } | null;
  items: OrderItem[];
  statusHistory: OrderStatusChange[];
  allowedTransitions: OrderStatus[];
  itemsEditable: boolean;
  pricingEditable: boolean;
}

export interface OrderStats {
  byStatus: Record<OrderStatus, number>;
  open: number;
  total: number;
}

/** Short order summary embedded in a customer profile. */
export interface CustomerOrderSummary {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  total: number;
  paidAmount: number;
  currency: string;
  createdAt: string;
}

/** `order:updated` also announces deletions. */
export type OrderEvent = Order | { id: string; deleted: true };
