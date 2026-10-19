import type { ChannelType } from './crm';
import type { OrderSource, OrderStatus, PaymentMethod } from './orders';

/** Contracts of the Phase 7 API: dashboard, reports and notifications. */

export interface ReportRange {
  from: string;
  to: string;
  days: number;
  timezone: string;
}

export interface Breakdown<K extends string = string> {
  key: K | null;
  count: number;
  value: number;
}

export interface SalesReport {
  range: ReportRange;
  totals: {
    orders: number;
    value: number;
    averageOrderValue: number;
    cancelled: number;
    customers: number;
    deliveredOrders: number;
    deliveredRevenue: number;
    collected: number;
    change: { orders: number | null; value: number | null };
  };
  series: { day: string; orders: number; value: number; deliveredRevenue: number }[];
  byStatus: Breakdown<OrderStatus>[];
  bySource: Breakdown<OrderSource>[];
  byPaymentMethod: Breakdown<PaymentMethod>[];
  topCities: Breakdown[];
}

export interface ProductSales {
  productId: string | null;
  name: string;
  quantity: number;
  revenue: number;
  orders: number;
  stock: number | null;
  deleted: boolean;
}

export interface ProductsReport {
  range: ReportRange;
  byRevenue: ProductSales[];
  byQuantity: ProductSales[];
  totals: { products: number; quantity: number; revenue: number };
}

export interface ConversationsReport {
  range: ReportRange;
  totals: {
    conversations: number;
    customerMessages: number;
    aiReplies: number;
    agentReplies: number;
    handovers: number;
  };
  byChannel: { key: ChannelType; count: number }[];
  series: { day: string; customerMessages: number; replies: number }[];
}

export interface AiTotals {
  runs: number;
  successRate: number | null;
  handovers: number;
  averageLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  orders: number;
  ordersValue: number;
  conversations: number;
  automationRate: number | null;
}

export interface AiReport {
  range: ReportRange;
  totals: AiTotals;
  byModel: { key: string; runs: number; tokens: number }[];
}

export interface DashboardSummary {
  generatedAt: string;
  today: string;
  sales: {
    today: { orders: number; value: number };
    period: {
      days: number;
      orders: number;
      value: number;
      averageOrderValue: number;
      deliveredRevenue: number;
      change: { orders: number | null; value: number | null };
      aiShare: number | null;
    };
    trend: { day: string; orders: number; value: number }[];
    open: Record<OrderStatus, number>;
    recent: {
      id: string;
      orderNumber: number;
      customerName: string;
      total: number;
      currency: string;
      status: OrderStatus;
      source: OrderSource;
      createdAt: string;
    }[];
  } | null;
  conversations: {
    open: number;
    unread: number;
    waitingForStaff: number;
    assignedToMe: number;
  } | null;
  inventory: {
    lowStockCount: number;
    outOfStockCount: number;
    lowStock: { id: string; name: string; sku: string; stock: number; lowStockThreshold: number }[];
  } | null;
  customers: { total: number; newInPeriod: number } | null;
  ai: (AiTotals & { configured: boolean }) | null;
}

export type NotificationType =
  | 'NEW_ORDER'
  | 'ORDER_STATUS_CHANGED'
  | 'NEW_CUSTOMER'
  | 'LOW_STOCK'
  | 'NEW_CONVERSATION'
  | 'HUMAN_HANDOVER'
  | 'CHANNEL_ERROR'
  | 'SYSTEM';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string | number | null> | null;
  readAt: string | null;
  createdAt: string;
}
