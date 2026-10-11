import { http, unwrap } from './http';
import { cleanParams } from './users.service';
import type { Paginated } from '@/types/api';
import type {
  Order,
  OrderDeliveryStatus,
  OrderDetail,
  OrderSource,
  OrderStats,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@/types/orders';

export interface OrdersQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: OrderStatus;
  open?: boolean;
  paymentStatus?: PaymentStatus;
  deliveryStatus?: OrderDeliveryStatus;
  source?: OrderSource;
  customerId?: string;
  conversationId?: string;
  from?: string;
  to?: string;
  sortBy?: 'createdAt' | 'orderNumber' | 'total';
  sortOrder?: 'asc' | 'desc';
}

export interface OrderLinePayload {
  productId: string;
  variantId?: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
}

export interface CreateOrderPayload {
  customerId?: string;
  customer?: { name: string; phone: string; city?: string; address?: string };
  conversationId?: string;
  items: OrderLinePayload[];
  paymentMethod?: PaymentMethod;
  discount?: number;
  deliveryFee?: number;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryCity?: string;
  notes?: string;
}

export interface UpdateOrderPayload {
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryCity?: string;
  notes?: string;
  paymentMethod?: PaymentMethod;
  discount?: number;
  deliveryFee?: number;
  deliveryStatus?: OrderDeliveryStatus;
}

export const ordersService = {
  list: (params: OrdersQuery = {}) =>
    unwrap<Paginated<Order>>(http.get('/orders', { params: cleanParams(params) })),

  stats: () => unwrap<OrderStats>(http.get('/orders/stats')),

  get: (id: string) => unwrap<OrderDetail>(http.get(`/orders/${id}`)),

  create: (payload: CreateOrderPayload) => unwrap<OrderDetail>(http.post('/orders', payload)),

  update: (id: string, payload: UpdateOrderPayload) =>
    unwrap<OrderDetail>(http.patch(`/orders/${id}`, payload)),

  replaceItems: (id: string, items: OrderLinePayload[]) =>
    unwrap<OrderDetail>(http.put(`/orders/${id}/items`, { items })),

  setStatus: (id: string, payload: { status: OrderStatus; note?: string; cancelReason?: string }) =>
    unwrap<OrderDetail>(http.patch(`/orders/${id}/status`, payload)),

  setPayment: (id: string, payload: { paidAmount: number; paymentMethod?: PaymentMethod }) =>
    unwrap<OrderDetail>(http.patch(`/orders/${id}/payment`, payload)),

  remove: (id: string) => unwrap<null>(http.delete(`/orders/${id}`)),
};
