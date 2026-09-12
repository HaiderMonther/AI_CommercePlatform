import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { AppClsStore, CLS_KEYS } from './request-context';

/**
 * Single source of truth for "which tenant is this request acting as".
 * Reading the company id from here (never from a request body or query string)
 * is what makes cross-tenant access impossible by construction.
 */
@Injectable()
export class TenantContextService {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  getCorrelationId(): string | undefined {
    return this.cls.get(CLS_KEYS.CORRELATION_ID);
  }

  getUserId(): string | undefined {
    return this.cls.get(CLS_KEYS.USER_ID);
  }

  getCompanyId(): string | undefined {
    if (this.cls.get(CLS_KEYS.BYPASS_TENANT_SCOPE)) {
      return undefined;
    }
    return this.cls.get(CLS_KEYS.COMPANY_ID);
  }

  /** The tenant of the current request, ignoring any active bypass. */
  getRawCompanyId(): string | undefined {
    return this.cls.get(CLS_KEYS.COMPANY_ID);
  }

  isPlatformAdmin(): boolean {
    return this.cls.get(CLS_KEYS.IS_PLATFORM_ADMIN) === true;
  }

  getPermissions(): string[] {
    return this.cls.get(CLS_KEYS.PERMISSIONS) ?? [];
  }

  getIpAddress(): string | undefined {
    return this.cls.get(CLS_KEYS.IP_ADDRESS);
  }

  getUserAgent(): string | undefined {
    return this.cls.get(CLS_KEYS.USER_AGENT);
  }

  setAuthContext(context: {
    userId: string;
    companyId?: string | null;
    isPlatformAdmin: boolean;
    permissions: string[];
  }): void {
    this.cls.set(CLS_KEYS.USER_ID, context.userId);
    this.cls.set(CLS_KEYS.COMPANY_ID, context.companyId ?? undefined);
    this.cls.set(CLS_KEYS.IS_PLATFORM_ADMIN, context.isPlatformAdmin);
    this.cls.set(CLS_KEYS.PERMISSIONS, context.permissions);
  }

  /**
   * Runs `fn` with automatic tenant scoping disabled. Use only for flows that
   * legitimately cross tenants (login by email, platform administration, workers
   * that resolve the tenant from an inbound webhook).
   */
  async runUnscoped<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.cls.get(CLS_KEYS.BYPASS_TENANT_SCOPE);
    this.cls.set(CLS_KEYS.BYPASS_TENANT_SCOPE, true);
    try {
      return await fn();
    } finally {
      this.cls.set(CLS_KEYS.BYPASS_TENANT_SCOPE, previous);
    }
  }
}
