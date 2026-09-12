import { Injectable, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { SYSTEM_ROLES } from '@common/constants/roles.constant';
import { PrismaService } from '@common/prisma/prisma.service';
import { randomSuffix, slugify } from '@common/utils/slug.util';

const TRIAL_DAYS = 14;

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Everything a brand-new tenant needs before its first login: a unique slug, the system
 * role set with its permissions, default AI settings and a trial subscription.
 *
 * Runs inside the caller's transaction so a failed signup never leaves a half-built tenant.
 */
@Injectable()
export class CompanyProvisioningService {
  private readonly logger = new Logger(CompanyProvisioningService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'store';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
      const existing = await this.prisma.company.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
    }

    return `${base}-${Date.now().toString(36)}`;
  }

  /** Creates the five system roles for a company and wires up their permissions. */
  async createSystemRoles(tx: TransactionClient, companyId: string): Promise<Map<string, string>> {
    const permissions = await tx.permission.findMany({ select: { id: true, key: true } });
    const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));
    const roleIdByKey = new Map<string, string>();

    for (const definition of SYSTEM_ROLES) {
      const role = await tx.role.create({
        data: {
          companyId,
          key: definition.key,
          name: definition.name,
          nameAr: definition.nameAr,
          description: definition.description,
          isSystem: true,
        },
      });

      const links: Prisma.RolePermissionCreateManyInput[] = definition.permissions
        .map((key) => permissionIdByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId }));

      if (links.length !== definition.permissions.length) {
        this.logger.warn(
          `Role ${definition.key}: ${definition.permissions.length - links.length} permission(s) missing from the permissions table. Run the seed.`,
        );
      }

      await tx.rolePermission.createMany({ data: links, skipDuplicates: true });
      roleIdByKey.set(definition.key, role.id);
    }

    return roleIdByKey;
  }

  async createDefaultAiConfig(
    tx: TransactionClient,
    companyId: string,
    businessName: string,
  ): Promise<void> {
    await tx.aiConfig.create({
      data: {
        companyId,
        businessName,
        tone: 'friendly',
        language: 'ar-IQ',
        currency: 'IQD',
        paymentMethods: ['CASH_ON_DELIVERY'],
        handoverKeywords: ['موظف', 'شكوى', 'مدير', 'بشري'],
      },
    });
  }

  /** Starts the company on a BASIC trial so plan limits are enforceable from day one. */
  async createTrialSubscription(tx: TransactionClient, companyId: string): Promise<Date | null> {
    const plan = await tx.plan.findUnique({ where: { tier: 'BASIC' }, select: { id: true } });
    if (!plan) {
      this.logger.warn('No BASIC plan found; skipping trial subscription. Run the seed.');
      return null;
    }

    const start = new Date();
    const end = new Date(start.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    await tx.subscription.create({
      data: {
        companyId,
        planId: plan.id,
        status: 'TRIALING',
        currentPeriodStart: start,
        currentPeriodEnd: end,
      },
    });

    return end;
  }
}
