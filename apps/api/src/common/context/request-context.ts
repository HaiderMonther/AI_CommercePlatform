import { ClsStore } from 'nestjs-cls';

/** Per-request state carried through AsyncLocalStorage for logging and tenant scoping. */
export interface AppClsStore extends ClsStore {
  correlationId: string;
  userId?: string;
  companyId?: string;
  isPlatformAdmin?: boolean;
  permissions?: string[];
  ipAddress?: string;
  userAgent?: string;
  /** Set while running a deliberately un-scoped query (login, platform admin tooling). */
  bypassTenantScope?: boolean;
}

export const CLS_KEYS = {
  CORRELATION_ID: 'correlationId',
  USER_ID: 'userId',
  COMPANY_ID: 'companyId',
  IS_PLATFORM_ADMIN: 'isPlatformAdmin',
  PERMISSIONS: 'permissions',
  IP_ADDRESS: 'ipAddress',
  USER_AGENT: 'userAgent',
  BYPASS_TENANT_SCOPE: 'bypassTenantScope',
} as const;
