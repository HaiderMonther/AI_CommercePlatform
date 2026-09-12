import { http, unwrap } from './http';
import type { PermissionGroup, Role } from '@/types/users';

export interface RolePayload {
  name: string;
  nameAr: string;
  description?: string;
  permissions: string[];
}

export const rolesService = {
  list: () => unwrap<Role[]>(http.get('/roles')),
  get: (id: string) => unwrap<Role>(http.get(`/roles/${id}`)),
  create: (payload: RolePayload) => unwrap<Role>(http.post('/roles', payload)),
  update: (id: string, payload: Partial<RolePayload>) =>
    unwrap<Role>(http.patch(`/roles/${id}`, payload)),
  remove: (id: string) => unwrap<null>(http.delete(`/roles/${id}`)),
  permissions: () => unwrap<PermissionGroup[]>(http.get('/permissions')),
};
