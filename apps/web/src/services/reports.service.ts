import { http, unwrap } from './http';
import { cleanParams } from './users.service';
import type { Paginated } from '@/types/api';
import type {
  AiReport,
  AppNotification,
  ConversationsReport,
  DashboardSummary,
  ProductsReport,
  SalesReport,
} from '@/types/reports';

export interface RangeQuery {
  from?: string;
  to?: string;
}

export const dashboardService = {
  summary: () => unwrap<DashboardSummary>(http.get('/dashboard/summary')),
};

export const reportsService = {
  sales: (range: RangeQuery) =>
    unwrap<SalesReport>(http.get('/reports/sales', { params: cleanParams(range) })),
  products: (range: RangeQuery) =>
    unwrap<ProductsReport>(http.get('/reports/products', { params: cleanParams(range) })),
  conversations: (range: RangeQuery) =>
    unwrap<ConversationsReport>(http.get('/reports/conversations', { params: cleanParams(range) })),
  ai: (range: RangeQuery) =>
    unwrap<AiReport>(http.get('/reports/ai', { params: cleanParams(range) })),

  /** Downloads the period's orders as a CSV file through the browser. */
  async exportOrders(range: RangeQuery): Promise<void> {
    const response = await http.get<Blob>('/reports/orders/export', {
      params: cleanParams(range),
      responseType: 'blob',
      timeout: 120_000,
    });

    const name =
      /filename="([^"]+)"/.exec(String(response.headers['content-disposition'] ?? ''))?.[1] ??
      'orders.csv';
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  },
};

export const notificationsService = {
  list: (params: { page?: number; limit?: number; unread?: boolean } = {}) =>
    unwrap<Paginated<AppNotification> & { unread: number }>(
      http.get('/notifications', { params: cleanParams(params) }),
    ),
  unreadCount: () => unwrap<{ unread: number }>(http.get('/notifications/unread-count')),
  markRead: (id: string) => unwrap<{ unread: number }>(http.post(`/notifications/${id}/read`)),
  markAllRead: () => unwrap<{ unread: number }>(http.post('/notifications/read-all')),
};
