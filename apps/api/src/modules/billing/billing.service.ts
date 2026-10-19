import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CompanyStatus,
  InvoiceStatus,
  NotificationType,
  PlanTier,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { WorkerConfig } from '@common/config/configuration';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { AppClsStore, CLS_KEYS } from '@common/context/request-context';
import { TenantContextService } from '@common/context/tenant-context.service';
import {
  AppException,
  BadRequestAppException,
  ConflictAppException,
  NotFoundAppException,
} from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { AUDIT_ACTION, AUDIT_ENTITY } from '@modules/audit/audit.constants';
import { AuditService } from '@modules/audit/audit.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import {
  LIMIT_METRICS,
  PAYMENT_TERMS_DAYS,
  PlanLimits,
  addDays,
  addMonth,
  downgradeConflicts,
  invoiceNumber,
  limitOf,
  nextStep,
  standingOf,
} from './billing.rules';
import { EntitlementsService, METRIC_NAMES } from './entitlements.service';

type Tx = Prisma.TransactionClient;

/** Transitions applied per subscription per run, so a long outage still catches up. */
const MAX_STEPS_PER_RUN = 12;
const DAY_MS = 86_400_000;

const PLAN_SELECT = {
  id: true,
  tier: true,
  name: true,
  nameAr: true,
  priceMonthly: true,
  currency: true,
  limits: true,
  features: true,
} as const satisfies Prisma.PlanSelect;

const INVOICE_SELECT = {
  id: true,
  number: true,
  status: true,
  currency: true,
  subtotal: true,
  total: true,
  periodStart: true,
  periodEnd: true,
  dueAt: true,
  paidAt: true,
  createdAt: true,
} as const satisfies Prisma.InvoiceSelect;

/**
 * Plans, subscriptions and invoices.
 *
 * Payment happens outside the platform (bank transfer, Zain Cash, FIB…): an invoice is
 * issued at each period end and the platform team marks it paid. A background run moves
 * subscriptions through their lifecycle on time, in every API instance; each transition
 * is a conditional UPDATE, so two instances never apply the same step twice.
 */
@Injectable()
export class BillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
    private readonly entitlements: EntitlementsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = this.config.get<WorkerConfig>('worker')?.billingIntervalMs ?? 0;
    if (interval > 0) {
      this.timer = setInterval(() => void this.runLifecycle(), interval);
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ---------------------------------------------------------------------------------
  // The store's view
  // ---------------------------------------------------------------------------------

  async plans() {
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      select: PLAN_SELECT,
      orderBy: { priceMonthly: 'asc' },
    });
    return plans.map((plan) => this.planView(plan));
  }

  /** Lightweight standing for the banner every member sees. */
  async status() {
    const companyId = this.requireCompanyId();
    const plan = await this.entitlements.planOf(companyId);
    const openInvoice = await this.prisma.invoice.findFirst({
      where: { companyId, status: InvoiceStatus.OPEN },
      select: { number: true, total: true, currency: true, dueAt: true },
      orderBy: { dueAt: 'asc' },
    });

    return {
      status: plan.status,
      standing: plan.standing,
      tier: plan.tier,
      periodEnd: plan.periodEnd,
      daysLeft: plan.periodEnd
        ? Math.max(0, Math.ceil((plan.periodEnd.getTime() - Date.now()) / DAY_MS))
        : null,
      openInvoice: openInvoice ? { ...openInvoice, total: Number(openInvoice.total) } : null,
    };
  }

  async overview() {
    const companyId = this.requireCompanyId();
    const plan = await this.entitlements.planOf(companyId);

    const [subscription, usage, plans] = await Promise.all([
      plan.subscriptionId
        ? this.prisma.subscription.findUnique({
            where: { id: plan.subscriptionId },
            select: {
              id: true,
              status: true,
              currentPeriodStart: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
              cancelledAt: true,
              plan: { select: PLAN_SELECT },
            },
          })
        : null,
      this.entitlements.usage(companyId, plan),
      this.plans(),
    ]);

    return {
      subscription: subscription
        ? {
            ...subscription,
            standing: standingOf(subscription.status),
            plan: this.planView(subscription.plan),
          }
        : null,
      usage: LIMIT_METRICS.map((metric) => ({
        metric,
        label: METRIC_NAMES[metric],
        used: usage[metric],
        limit: limitOf(plan.limits, metric),
        perPeriod: metric === 'AI_MESSAGES',
      })),
      plans,
    };
  }

  async invoices() {
    const invoices = await this.prisma.invoice.findMany({
      where: { companyId: this.requireCompanyId() },
      select: INVOICE_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return invoices.map((invoice) => this.invoiceView(invoice));
  }

  /**
   * Moves the store to another plan, effective at once; the new price applies from the
   * next invoice. A store whose subscription ended starts a new paid period here.
   */
  async changePlan(tier: PlanTier) {
    const companyId = this.requireCompanyId();
    const target = await this.activePlan(tier);
    const current = await this.entitlements.planOf(companyId);

    if (current.tier === tier && current.standing !== 'restricted') {
      throw new BadRequestAppException('هذه باقتك الحالية');
    }

    const conflicts = downgradeConflicts(
      await this.entitlements.usage(companyId, current),
      target.limits as PlanLimits,
    );
    if (conflicts.length) {
      throw new ConflictAppException(
        `الباقة لا تتسع لما لديك الآن: ${conflicts
          .map((c) => `${METRIC_NAMES[c.metric]} ${c.used} من ${c.limit}`)
          .join('، ')}. احذف الزائد أولاً.`,
        ERROR_CODE.PLAN_DOWNGRADE_BLOCKED,
        { conflicts },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (current.subscriptionId && current.standing !== 'restricted') {
        await tx.subscription.update({
          where: { id: current.subscriptionId },
          data: { planId: target.id },
        });
      } else {
        await this.startPaidPeriod(tx, companyId, current.subscriptionId, target, new Date());
      }
      await tx.company.update({ where: { id: companyId }, data: { planTier: tier } });
    });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.SUBSCRIPTION,
      entityId: current.subscriptionId,
      oldValue: { tier: current.tier, status: current.status },
      newValue: { tier },
    });

    return this.overview();
  }

  /** Stops renewal at the end of the current period; the store keeps working until then. */
  async setCancelAtPeriodEnd(cancel: boolean) {
    const companyId = this.requireCompanyId();
    const current = await this.entitlements.planOf(companyId);

    if (!current.subscriptionId || current.standing === 'restricted') {
      throw new BadRequestAppException('لا يوجد اشتراك فعّال');
    }

    await this.prisma.subscription.update({
      where: { id: current.subscriptionId },
      data: { cancelAtPeriodEnd: cancel },
    });

    await this.audit.record({
      action: AUDIT_ACTION.UPDATE,
      entity: AUDIT_ENTITY.SUBSCRIPTION,
      entityId: current.subscriptionId,
      newValue: { cancelAtPeriodEnd: cancel },
    });

    return this.overview();
  }

  // ---------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------

  /** Applies every transition that is due. Safe to run from several instances. */
  async runLifecycle(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let applied = 0;

    try {
      const subscriptions = await this.prisma.subscription.findMany({
        where: {
          status: {
            in: [
              SubscriptionStatus.TRIALING,
              SubscriptionStatus.ACTIVE,
              SubscriptionStatus.PAST_DUE,
            ],
          },
        },
        select: { id: true, companyId: true },
      });

      for (const { id, companyId } of subscriptions) {
        await this.cls.run(async () => {
          this.cls.set(CLS_KEYS.COMPANY_ID, companyId);
          for (let step = 0; step < MAX_STEPS_PER_RUN; step++) {
            if (!(await this.advance(id, now))) break;
            applied++;
          }
        });
      }
    } catch (error) {
      this.logger.error('Billing lifecycle run failed', error instanceof Error ? error.stack : '');
    } finally {
      this.running = false;
    }

    return applied;
  }

  /** Applies the next due transition of one subscription. Returns false when none was due. */
  private async advance(subscriptionId: string, now: Date): Promise<boolean> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        companyId: true,
        status: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        plan: { select: PLAN_SELECT },
      },
    });
    if (!subscription) return false;

    const overdue = await this.prisma.invoice.findFirst({
      where: { subscriptionId, status: InvoiceStatus.OPEN },
      select: { dueAt: true },
      orderBy: { dueAt: 'asc' },
    });

    const step = nextStep(
      {
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        overdueSince: overdue?.dueAt ?? null,
      },
      now,
    );
    if (!step) return false;

    // Each transition only applies if the row is still in the state it was read in.
    const guard = {
      id: subscription.id,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
    };

    switch (step.kind) {
      case 'renew': {
        const applied = await this.prisma.$transaction(async (tx) => {
          const periodStart = subscription.currentPeriodEnd;
          const periodEnd = addMonth(periodStart);
          const moved = await tx.subscription.updateMany({
            where: guard,
            data: {
              status: SubscriptionStatus.ACTIVE,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
            },
          });
          if (moved.count === 0) return false;

          await this.issueInvoice(
            tx,
            subscription.companyId,
            subscription.id,
            subscription.plan,
            periodStart,
            periodEnd,
          );
          await tx.company.updateMany({
            where: { id: subscription.companyId, status: CompanyStatus.TRIAL },
            data: { status: CompanyStatus.ACTIVE },
          });
          return true;
        });

        if (applied && subscription.status === SubscriptionStatus.TRIALING) {
          await this.notifyBilling(
            'انتهت الفترة التجريبية',
            `صدرت فاتورة أول شهر من باقة ${subscription.plan.nameAr}. ادفعها خلال ${PAYMENT_TERMS_DAYS} أيام ليستمر المتجر دون انقطاع.`,
            'trial-ended',
          );
        }
        return applied;
      }

      case 'cancel': {
        const moved = await this.prisma.subscription.updateMany({
          where: guard,
          data: { status: SubscriptionStatus.CANCELLED, cancelledAt: now },
        });
        if (moved.count) {
          await this.notifyBilling(
            'انتهى الاشتراك',
            'أُلغي الاشتراك بنهاية الفترة. يمكنك الاشتراك من جديد في أي وقت.',
            'cancelled',
          );
        }
        return moved.count > 0;
      }

      case 'past_due': {
        const moved = await this.prisma.subscription.updateMany({
          where: guard,
          data: { status: SubscriptionStatus.PAST_DUE },
        });
        if (moved.count) {
          await this.notifyBilling(
            'فاتورة متأخرة',
            'تأخر دفع فاتورة الاشتراك. يستمر المتجر بالعمل لفترة سماح قصيرة.',
            'past-due',
          );
        }
        return moved.count > 0;
      }

      case 'expire': {
        const moved = await this.prisma.subscription.updateMany({
          where: guard,
          data: { status: SubscriptionStatus.EXPIRED },
        });
        if (moved.count) {
          await this.notifyBilling(
            'توقف الاشتراك',
            'انتهت فترة السماح دون دفع. توقف المساعد الذكي وإضافة البيانات الجديدة حتى الدفع.',
            'expired',
          );
        }
        return moved.count > 0;
      }
    }
  }

  // ---------------------------------------------------------------------------------
  // Shared with the platform admin
  // ---------------------------------------------------------------------------------

  /** Starts a new month on `plan` from `start`, with its invoice. */
  async startPaidPeriod(
    tx: Tx,
    companyId: string,
    subscriptionId: string | null,
    plan: { id: string; priceMonthly: Prisma.Decimal; currency: string },
    start: Date,
  ): Promise<string> {
    const end = addMonth(start);
    const data = {
      planId: plan.id,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
    };

    const subscription = subscriptionId
      ? await tx.subscription.update({ where: { id: subscriptionId }, data, select: { id: true } })
      : await tx.subscription.create({ data: { ...data, companyId }, select: { id: true } });

    await this.issueInvoice(tx, companyId, subscription.id, plan, start, end);
    return subscription.id;
  }

  /** Issues the invoice for one period. A free plan's invoice is settled on issue. */
  async issueInvoice(
    tx: Tx,
    companyId: string,
    subscriptionId: string,
    plan: { priceMonthly: Prisma.Decimal; currency: string },
    periodStart: Date,
    periodEnd: Date,
  ): Promise<void> {
    const issuedAt = new Date();
    const free = plan.priceMonthly.lte(0);

    // Numbers are global and sequential per month; a concurrent issuer takes the next.
    const monthPrefix = invoiceNumber(issuedAt, 0).slice(0, -6);
    for (let attempt = 0; ; attempt++) {
      const count = await tx.invoice.count({ where: { number: { startsWith: monthPrefix } } });
      try {
        await tx.invoice.create({
          data: {
            companyId,
            subscriptionId,
            number: invoiceNumber(issuedAt, count + 1 + attempt),
            status: free ? InvoiceStatus.PAID : InvoiceStatus.OPEN,
            currency: plan.currency,
            subtotal: plan.priceMonthly,
            total: plan.priceMonthly,
            periodStart,
            periodEnd,
            dueAt: addDays(periodStart, PAYMENT_TERMS_DAYS),
            paidAt: free ? issuedAt : null,
          },
        });
        return;
      } catch (error) {
        const taken =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!taken || attempt >= 5) throw error;
      }
    }
  }

  async activePlan(tier: PlanTier) {
    const plan = await this.prisma.plan.findUnique({ where: { tier }, select: PLAN_SELECT });
    if (!plan) {
      throw new NotFoundAppException('الباقة غير موجودة', ERROR_CODE.PLAN_NOT_FOUND);
    }
    return plan;
  }

  planView(plan: Prisma.PlanGetPayload<{ select: typeof PLAN_SELECT }>) {
    return { ...plan, priceMonthly: Number(plan.priceMonthly), limits: plan.limits as PlanLimits };
  }

  invoiceView(invoice: Prisma.InvoiceGetPayload<{ select: typeof INVOICE_SELECT }>) {
    return { ...invoice, subtotal: Number(invoice.subtotal), total: Number(invoice.total) };
  }

  private async notifyBilling(title: string, body: string, kind: string): Promise<void> {
    await this.notifications.notify({
      type: NotificationType.SYSTEM,
      title,
      body,
      data: { alert: `billing-${kind}-${new Date().toISOString().slice(0, 10)}` },
      permission: PERMISSIONS.BILLING_READ,
      dedupe: { key: 'alert', withinMs: DAY_MS },
    });
  }

  private requireCompanyId(): string {
    const companyId = this.context.getCompanyId();
    if (!companyId) {
      throw new AppException(
        ERROR_CODE.TENANT_CONTEXT_MISSING,
        'لا توجد شركة في سياق الطلب',
        HttpStatus.BAD_REQUEST,
      );
    }
    return companyId;
  }
}

export { INVOICE_SELECT, PLAN_SELECT };
