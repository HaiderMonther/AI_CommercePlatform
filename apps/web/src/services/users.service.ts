import { http, unwrap } from './http';
import type { Paginated } from '@/types/api';
import type { CreateUserPayload, UpdateUserPayload, User } from '@/types/users';

export interface UsersQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  roleId?: string;
}

export const usersService = {
  list: (params: UsersQuery = {}) =>
    unwrap<Paginated<User>>(http.get('/users', { params: cleanParams(params) })),

  get: (id: string) => unwrap<User>(http.get(`/users/${id}`)),

  create: (payload: CreateUserPayload) => unwrap<User>(http.post('/users', payload)),

  update: (id: string, payload: UpdateUserPayload) =>
    unwrap<User>(http.patch(`/users/${id}`, payload)),

  resetPassword: (id: string, newPassword: string) =>
    unwrap<null>(http.post(`/users/${id}/reset-password`, { newPassword })),

  remove: (id: string) => unwrap<null>(http.delete(`/users/${id}`)),
};

/** Drops empty filters so the API does not receive `status=` and reject it. */
export function cleanParams<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}
