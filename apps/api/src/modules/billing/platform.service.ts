import { Injectable } from '@nestjs/common';
import {
  CompanyStatus,
  InvoiceStatus,
  NotificationType,
  PlanTier,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { AppClsStore, CLS_KEYS } from '@common/context/request-context';
import { paginate } from '@common/dto/pagination.dto';
import {
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { BillingService, INVOICE_SELECT } from './billing.service';
import { LIMIT_METRICS, addDays, addMonth, limitOf, standingOf } from './billing.rules';
import { EntitlementsService, METRIC_NAMES } from './entitlements.service';
import {
  QueryCompaniesDto,
  QueryInvoicesDto,
  UpdateCompanySubscriptionDto,
} from './dto/billing.dto';

/**
 * The platform team's view across every store: plans, trials, payments and suspension.
 * Runs without a tenant, so every query names its company explicitly.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly entitlements: EntitlementsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async companies(query: QueryCompaniesDto) {
    const where: Prisma.CompanyWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { slug: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          phone: true,
          status: true,
          planTier: true,
          createdAt: true,
          _count: { select: { users: true, orders: true, products: true } },
          subscriptions: {
            select: { status: true, currentPeriodEnd: true, plan: { select: { tier: true } } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          invoices: {
            where: { status: InvoiceStatus.OPEN },
            select: { total: true, currency: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.company.count({ where }),
    ]);

    return paginate(
      items.map(({ subscriptions, invoices, _count, ...company }) => ({
        ...company,
        counts: _count,
        subscription: subscriptions[0]
          ? { ...subscriptions[0], standing: standingOf(subscriptions[0].status) }
          : null,
        openInvoices: invoices.length,
        amountDue: invoices.reduce((sum, invoice) => sum + Number(invoice.total), 0),
      })),
      total,
      query.page,
      query.limit,
    );
  }

  async company(id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        phone: true,
        city: true,
        status: true,
        planTier: true,
        trialEndsAt: true,
        createdAt: true,
      },
    });
    if (!company) {
      throw new NotFoundAppException('الشركة غير موجودة', ERROR_CODE.COMPANY_NOT_FOUND);
    }

    const plan = await this.entitlements.planOf(id);
    const [usage, subscription, invoices] = await Promise.all([
      this.entitlements.usage(id, plan),
      plan.subscriptionId
        ? this.prisma.subscription.findUnique({
            where: { id: plan.subscriptionId },
            select: {
              id: true,
              status: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
              plan: { select: { tier: true, nameAr: true } },
            },
          })
        : null,
      this.prisma.invoice.findMany({
        where: { companyId: id },
        select: INVOICE_SELECT,
        orderBy: { createdAt: 'desc' },
        take: 24,
      }),
    ]);

    return {
      ...company,
      subscription: subscription
        ? { ...subscription, standing: standingOf(subscription.status) }
        : null,
      usage: LIMIT_METRICS.map((metric) => ({
        metric,
        label: METRIC_NAMES[metric],
        used: usage[metric],
        limit: limitOf(plan.limits, metric),
      })),
      invoices: invoices.map((invoice) => this.billing.invoiceView(invoice)),
    };
  }

  /** Suspension locks every member out; reactivation lets them back in. */
  async setCompanyStatus(id: string, status: CompanyStatus) {
    if (status !== CompanyStatus.ACTIVE && status !== CompanyStatus.SUSPENDED) {
      throw new BadRequestAppException('الحالة المسموحة: ACTIVE أو SUSPENDED');
    }

    const before = await this.findCompany(id);
    // A trialing store goes back to TRIAL rather than to a paid state it never reached.
    const subscription = await this.entitlements.planOf(id);
    const next =
      status === CompanyStatus.ACTIVE && subscription.status === SubscriptionStatus.TRIALING
        ? CompanyStatus.TRIAL
        : status;

    await this.prisma.company.update({ where: { id }, data: { status: next } });

    if (next === CompanyStatus.SUSPENDED) {
      // Signed-in members are cut off at their next request; end their sessions now too.
      await this.prisma.refreshToken.updateMany({
        where: { user: { companyId: id }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.audit.record({
      action: AUDIT_ACTION.STATUS_CHANGE,
      entity: AUDIT_ENTITY.COMPANY,
      entityId: id,
      companyId: id,
      oldValue: { status: before.status },
      newValue: { status: next },
    });

    return this.company(id);
  }

  /** Moves a store to a plan without the downgrade checks, and/or extends its period. */
  async updateSubscription(id: string, dto: UpdateCompanySubscriptionDto) {
    await this.findCompany(id);
    const current = await this.entitlements.planOf(id);

    if (!dto.tier && !dto.extendDays) {
      throw new BadRequestAppException('حدّد الباقة أو عدد أيام التمديد');
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.tier) {
        const plan = await this.billing.activePlan(dto.tier as PlanTier);

        if (current.subscriptionId && current.standing !== 'restricted') {
          await tx.subscription.update({
            where: { id: current.subscriptionId },
            data: { planId: plan.id },
          });
        } else {
          await this.billing.startPaidPeriod(tx, id, current.subscriptionId, plan, new Date());
        }
        await tx.company.update({ where: { id }, data: { planTier: plan.tier } });
      }

      if (dto.extendDays) {
        const subscription = current.subscriptionId
          ? await tx.subscription.findUnique({ where: { id: current.subscriptionId } })
          : null;
        if (!subscription) {
          throw new BadRequestAppException('لا يوجد اشتراك لتمديده');
        }

        const base =
          subscription.currentPeriodEnd > new Date() ? subscription.currentPeriodEnd : new Date();
        const end = addDays(base, dto.extendDays);
        const restricted = standingOf(subscription.status) === 'restricted';

        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            currentPeriodEnd: end,
            // Extending an ended subscription is a goodwill grant: it runs again until then.
            ...(restricted ? { status: SubscriptionStatus.ACTIVE, cancelledAt: null } : {}),
          },
        });
        if (subscription.status === SubscriptionStatus.TRIALING) {
          await tx.company.update({ where: { id }, data: { trialEndsAt: end } });
        }
      }
    });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.SUBSCRIPTION,
      entityId: current.subscriptionId,
      companyId: id,
      oldValue: { tier: current.tier, periodEnd: current.periodEnd },
      newValue: dto,
    });

    return this.company(id);
  }

  async invoices(query: QueryInvoicesDto) {
    const where: Prisma.InvoiceWhereInput = query.status ? { status: query.status } : {};

    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        select: { ...INVOICE_SELECT, company: { select: { id: true, name: true } } },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return paginate(
      items.map(({ company, ...invoice }) => ({ ...this.billing.invoiceView(invoice), company })),
      total,
      query.page,
      query.limit,
    );
  }

  /**
   * Records a payment received outside the platform. Once nothing is left unpaid, a
   * subscription held up by it runs again; one whose period already ended starts a new one.
   */
  async markInvoicePaid(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, number: true, status: true, companyId: true, subscriptionId: true },
    });
    if (!invoice) {
      throw new NotFoundAppException('الفاتورة غير موجودة', ERROR_CODE.INVOICE_NOT_FOUND);
    }
    if (invoice.status !== InvoiceStatus.OPEN) {
      throw new ConflictAppException('الفاتورة ليست بانتظار الدفع', ERROR_CODE.CONFLICT);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: InvoiceStatus.PAID, paidAt: now },
      });

      if (!invoice.subscriptionId) return;
      const stillOpen = await tx.invoice.count({
        where: { subscriptionId: invoice.subscriptionId, status: InvoiceStatus.OPEN },
      });
      const subscription = await tx.subscription.findUnique({
        where: { id: invoice.subscriptionId },
      });
      if (stillOpen > 0 || !subscription) return;

      const heldUp =
        subscription.status === SubscriptionStatus.PAST_DUE ||
        subscription.status === SubscriptionStatus.EXPIRED;
      if (!heldUp) return;

      const ended = subscription.currentPeriodEnd <= now;
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          ...(ended ? { currentPeriodStart: now, currentPeriodEnd: addMonth(now) } : {}),
        },
      });
    });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.INVOICE,
      entityId: invoice.id,
      companyId: invoice.companyId,
      oldValue: { status: invoice.status },
      newValue: { status: InvoiceStatus.PAID },
    });

    await this.cls.run(async () => {
      this.cls.set(CLS_KEYS.COMPANY_ID, invoice.companyId);
      await this.notifications.notify({
        type: NotificationType.SYSTEM,
        title: 'تم استلام الدفعة',
        body: `سُجّلت دفعة الفاتورة ${invoice.number}. شكراً لك.`,
        data: { invoiceId: invoice.id },
        permission: PERMISSIONS.BILLING_READ,
      });
    });

    return this.company(invoice.companyId);
  }

  async voidInvoice(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new NotFoundAppException('الفاتورة غير موجودة', ERROR_CODE.INVOICE_NOT_FOUND);
    }
    if (invoice.status !== InvoiceStatus.OPEN) {
      throw new ConflictAppException('يمكن إلغاء الفواتير غير المدفوعة فقط', ERROR_CODE.CONFLICT);
    }

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.VOID },
    });
    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.INVOICE,
      entityId: invoiceId,
      companyId: invoice.companyId,
      newValue: { status: InvoiceStatus.VOID },
    });
    return this.company(invoice.companyId);
  }

  private async findCompany(id: string) {
    const company = await this.prisma.company.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!company) {
      throw new NotFoundAppException('الشركة غير موجودة', ERROR_CODE.COMPANY_NOT_FOUND);
    }
    return company;
  }
}
