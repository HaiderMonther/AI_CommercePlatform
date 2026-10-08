import { http, unwrap } from './http';
import { cleanParams } from './users.service';
import type { Paginated } from '@/types/api';
import type {
  ChannelType,
  Conversation,
  ConversationDetail,
  ConversationMode,
  ConversationStats,
  ConversationStatus,
  Customer,
  CustomerDetail,
  CustomerStatus,
  Message,
  MessagePage,
} from '@/types/crm';

export interface CustomersQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: CustomerStatus;
  channel?: ChannelType;
  city?: string;
  tag?: string;
  sortBy?: 'createdAt' | 'name' | 'lastContactAt' | 'totalSpent' | 'totalOrders';
  sortOrder?: 'asc' | 'desc';
}

export interface CustomerPayload {
  name: string;
  phone?: string | null;
  altPhone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  tags?: string[];
  status?: CustomerStatus;
}

export const customersService = {
  list: (params: CustomersQuery = {}) =>
    unwrap<Paginated<Customer>>(http.get('/customers', { params: cleanParams(params) })),

  get: (id: string) => unwrap<CustomerDetail>(http.get(`/customers/${id}`)),

  create: (payload: CustomerPayload) => unwrap<CustomerDetail>(http.post('/customers', payload)),

  update: (id: string, payload: Partial<CustomerPayload>) =>
    unwrap<CustomerDetail>(http.patch(`/customers/${id}`, payload)),

  remove: (id: string) => unwrap<null>(http.delete(`/customers/${id}`)),
};

export interface ConversationsQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: ConversationStatus;
  active?: boolean;
  mode?: ConversationMode;
  channel?: ChannelType;
  /** `me`, `unassigned` or a user id */
  assignee?: string;
  customerId?: string;
  unread?: boolean;
}

export const conversationsService = {
  list: (params: ConversationsQuery = {}) =>
    unwrap<Paginated<Conversation>>(http.get('/conversations', { params: cleanParams(params) })),

  stats: () => unwrap<ConversationStats>(http.get('/conversations/stats')),

  get: (id: string) => unwrap<ConversationDetail>(http.get(`/conversations/${id}`)),

  create: (payload: { customerId: string; channel: ChannelType; subject?: string }) =>
    unwrap<ConversationDetail>(http.post('/conversations', payload)),

  assign: (id: string, userId: string | null) =>
    unwrap<ConversationDetail>(http.patch(`/conversations/${id}/assign`, { userId })),

  setStatus: (id: string, status: ConversationStatus) =>
    unwrap<ConversationDetail>(http.patch(`/conversations/${id}/status`, { status })),

  setMode: (id: string, mode: ConversationMode, reason?: string) =>
    unwrap<ConversationDetail>(http.patch(`/conversations/${id}/mode`, { mode, reason })),

  markRead: (id: string) => unwrap<null>(http.post(`/conversations/${id}/read`)),

  messages: (id: string, params: { before?: string; limit?: number } = {}) =>
    unwrap<MessagePage>(http.get(`/conversations/${id}/messages`, { params: cleanParams(params) })),

  send: (id: string, content: string) =>
    unwrap<Message>(http.post(`/conversations/${id}/messages`, { content })),
};
