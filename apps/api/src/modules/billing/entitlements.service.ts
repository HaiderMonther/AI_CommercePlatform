import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { NotificationType, SubscriptionStatus, UsageMetric } from '@prisma/client';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { TenantContextService } from '@common/context/tenant-context.service';
import { AppException, BadRequestAppException } from '@common/exceptions/app.exception';
import { PrismaService } from '@common/prisma/prisma.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { LimitMetric, PlanLimits, Standing, limitOf, standingOf } from './billing.rules';

export const METRIC_NAMES: Record<LimitMetric, string> = {
  USERS: 'المستخدمين',
  PRODUCTS: 'المنتجات',
  CHANNELS: 'القنوات',
  AI_MESSAGES: 'ردود المساعد الذكي',
};

/** Share of the AI allowance at which the store is warned it is running out. */
const AI_WARNING_RATIO = 0.8;

export interface CompanyPlan {
  subscriptionId: string | null;
  status: SubscriptionStatus | null;
  standing: Standing;
  tier: string | null;
  limits: PlanLimits;
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface AiAllowance {
  allowed: boolean;
  used: number;
  limit: number | null;
  /** Why the AI may not answer, worded for the team. */
  reason: string | null;
}

/**
 * What the company's plan lets it do right now: how many users, products and channels
 * it may have, how many AI replies per billing period, and whether the subscription is
 * in good standing at all.
 *
 * Limits are checked where things are created, against live counts, so they hold however
 * the thing was created. A plan change applies at once.
 */
@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: TenantContextService,
    private readonly notifications: NotificationsService,
  ) {}

  async planOf(companyId = this.requireCompanyId()): Promise<CompanyPlan> {
    const subscription = await this.prisma.subscription.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        plan: { select: { tier: true, limits: true } },
      },
    });

    if (!subscription) {
      return {
        subscriptionId: null,
        status: null,
        standing: 'restricted',
        tier: null,
        limits: {},
        periodStart: null,
        periodEnd: null,
      };
    }

    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      standing: standingOf(subscription.status),
      tier: subscription.plan.tier,
      limits: (subscription.plan.limits ?? {}) as PlanLimits,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
    };
  }

  /** Current counts for every limited metric. */
  async usage(
    companyId = this.requireCompanyId(),
    plan?: CompanyPlan,
  ): Promise<Record<LimitMetric, number>> {
    const current = plan ?? (await this.planOf(companyId));

    const [users, products, channels, ai] = await Promise.all([
      this.prisma.user.count({ where: { companyId, deletedAt: null } }),
      this.prisma.product.count({ where: { companyId, deletedAt: null } }),
      this.prisma.channelConnection.count({ where: { companyId } }),
      this.aiRepliesSince(companyId, current.periodStart),
    ]);

    return { USERS: users, PRODUCTS: products, CHANNELS: channels, AI_MESSAGES: ai };
  }

  /**
   * Refuses to add one more user, product or channel when the plan does not allow it.
   * Call before creating, inside the request that creates.
   */
  async assertCanAdd(metric: Exclude<LimitMetric, 'AI_MESSAGES'>): Promise<void> {
    const companyId = this.requireCompanyId();
    const plan = await this.planOf(companyId);

    if (plan.standing === 'restricted') {
      throw new AppException(
        ERROR_CODE.SUBSCRIPTION_INACTIVE,
        'اشتراك المتجر منتهٍ. جدّد الاشتراك من صفحة الاشتراك لإضافة المزيد.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const limit = limitOf(plan.limits, metric);
    if (limit === null) return;

    const used = (await this.usage(companyId, plan))[metric];
    if (used >= limit) {
      throw new AppException(
        ERROR_CODE.PLAN_LIMIT_REACHED,
        `وصلت للحد الأقصى من ${METRIC_NAMES[metric]} في باقتك (${limit}). رقِّ الباقة لإضافة المزيد.`,
        HttpStatus.PAYMENT_REQUIRED,
        { metric, limit, used },
      );
    }
  }

  /** Whether the AI may write another reply in this billing period. */
  async aiAllowance(companyId = this.requireCompanyId()): Promise<AiAllowance> {
    const plan = await this.planOf(companyId);
    const limit = limitOf(plan.limits, 'AI_MESSAGES');
    const used = await this.aiRepliesSince(companyId, plan.periodStart);

    if (plan.standing === 'restricted') {
      return { allowed: false, used, limit, reason: 'اشتراك المتجر منتهٍ، فتوقف المساعد الذكي' };
    }
    if (limit !== null && used >= limit) {
      return {
        allowed: false,
        used,
        limit,
        reason: `نفد رصيد ردود المساعد الذكي في الباقة (${limit} رد لهذه الفترة)`,
      };
    }
    return { allowed: true, used, limit, reason: null };
  }

  /**
   * Called after each AI reply: warns the people who manage billing once the allowance is
   * mostly used, and once when it runs out — one warning of each kind per billing period.
   */
  async afterAiReply(companyId = this.requireCompanyId()): Promise<void> {
    try {
      const allowance = await this.aiAllowance(companyId);
      if (allowance.limit === null || allowance.limit === 0) return;

      const plan = await this.planOf(companyId);
      const period = plan.periodStart?.toISOString().slice(0, 10) ?? 'none';
      const exhausted = allowance.used >= allowance.limit;
      if (!exhausted && allowance.used < allowance.limit * AI_WARNING_RATIO) return;

      await this.notifications.notify({
        type: NotificationType.SYSTEM,
        title: exhausted ? 'نفد رصيد المساعد الذكي' : 'رصيد المساعد الذكي يقترب من النفاد',
        body: exhausted
          ? 'المحادثات الجديدة تُحوَّل للموظفين حتى بداية الفترة القادمة أو ترقية الباقة.'
          : `استُخدم ${allowance.used} من ${allowance.limit} رد في هذه الفترة.`,
        // One alert of each kind per billing period: the dedupe key combines both.
        data: { alert: `${exhausted ? 'ai-exhausted' : 'ai-warning'}:${period}` },
        permission: PERMISSIONS.BILLING_READ,
        dedupe: { key: 'alert', withinMs: 62 * 86_400_000 },
      });
    } catch (error) {
      this.logger.error('AI allowance check failed', error instanceof Error ? error.stack : '');
    }
  }

  /** AI replies counted from the daily usage records since the period began. */
  private async aiRepliesSince(companyId: string, since: Date | null): Promise<number> {
    const result = await this.prisma.usageRecord.aggregate({
      where: {
        companyId,
        metric: UsageMetric.AI_MESSAGES,
        ...(since ? { period: { gte: since.toISOString().slice(0, 10) } } : {}),
      },
      _sum: { value: true },
    });
    return result._sum.value ?? 0;
  }

  private requireCompanyId(): string {
    const companyId = this.context.getCompanyId();
    if (!companyId) {
      throw new BadRequestAppException(
        'لا توجد شركة في سياق الطلب',
        ERROR_CODE.TENANT_CONTEXT_MISSING,
      );
    }
    return companyId;
  }
}
