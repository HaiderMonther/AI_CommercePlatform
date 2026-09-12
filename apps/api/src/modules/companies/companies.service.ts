import { Inject, Injectable } from '@nestjs/common';
import { TenantContextService } from '@common/context/tenant-context.service';
import { NotFoundAppException } from '@common/exceptions/app.exception';
import { TENANT_PRISMA, TenantPrismaClient } from '@common/prisma/tenant-prisma.provider';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { UpdateCompanyDto } from './dto/update-company.dto';

const COMPANY_SELECT = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  phone: true,
  email: true,
  address: true,
  city: true,
  country: true,
  currency: true,
  timezone: true,
  locale: true,
  status: true,
  planTier: true,
  trialEndsAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class CompaniesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrismaClient,
    private readonly context: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  /** Returns the caller's own company. The tenant filter makes the id implicit. */
  async getCurrent() {
    const companyId = this.requireCompanyId();
    const company = await this.db.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: COMPANY_SELECT,
    });

    if (!company) {
      throw new NotFoundAppException('الشركة غير موجودة');
    }

    return company;
  }

  async updateCurrent(dto: UpdateCompanyDto) {
    const before = await this.getCurrent();

    const updated = await this.db.company.update({
      where: { id: before.id },
      data: dto,
      select: COMPANY_SELECT,
    });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.COMPANY,
      entityId: before.id,
      oldValue: before,
      newValue: updated,
    });

    return updated;
  }

  /** Headline counters used by the settings page and the platform admin view. */
  async getStats() {
    const companyId = this.requireCompanyId();

    const [users, products, customers, orders, channels] = await Promise.all([
      this.db.user.count({ where: { deletedAt: null } }),
      this.db.product.count({ where: { deletedAt: null } }),
      this.db.customer.count({ where: { deletedAt: null } }),
      this.db.order.count(),
      this.db.channelConnection.count({ where: { isActive: true } }),
    ]);

    return { companyId, users, products, customers, orders, channels };
  }

  private requireCompanyId(): string {
    const companyId = this.context.getCompanyId();
    if (!companyId) {
      throw new NotFoundAppException('لا توجد شركة مرتبطة بهذا الحساب');
    }
    return companyId;
  }
}
