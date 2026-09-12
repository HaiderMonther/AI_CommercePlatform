import { http, unwrap } from './http';
import { cleanParams } from './users.service';
import type { Paginated } from '@/types/api';
import type { AuditLog, Company, CompanyStats } from '@/types/users';

export const companyService = {
  get: () => unwrap<Company>(http.get('/company')),
  update: (payload: Partial<Company>) => unwrap<Company>(http.patch('/company', payload)),
  stats: () => unwrap<CompanyStats>(http.get('/company/stats')),
};

export interface AuditQuery {
  page?: number;
  limit?: number;
  entity?: string;
  action?: string;
  userId?: string;
}

export const auditService = {
  list: (params: AuditQuery = {}) =>
    unwrap<Paginated<AuditLog>>(http.get('/audit-logs', { params: cleanParams(params) })),
};
