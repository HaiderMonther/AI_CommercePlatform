import { SubscriptionStatus } from '@prisma/client';

/**
 * Subscription lifecycle, as pure functions.
 *
 *   TRIALING ──period end──▶ ACTIVE + invoice (due in PAYMENT_TERMS_DAYS)
 *   ACTIVE ────period end──▶ ACTIVE + next invoice      (or CANCELLED if cancelling)
 *   ACTIVE ──invoice overdue──▶ PAST_DUE   (still works: a grace period)
 *   PAST_DUE ──GRACE_DAYS more──▶ EXPIRED  (restricted)
 *   any ──invoice paid──▶ ACTIVE
 *
 * Restricted (EXPIRED, CANCELLED) is not locked out: the store keeps its data and can sign
 * in to pay, but the AI stops and nothing new can be added.
 */

export const TRIAL_DAYS = 14;
export const PAYMENT_TERMS_DAYS = 7;
export const GRACE_DAYS = 14;

const DAY_MS = 86_400_000;

export const LIMIT_METRICS = ['USERS', 'PRODUCTS', 'CHANNELS', 'AI_MESSAGES'] as const;
export type LimitMetric = (typeof LIMIT_METRICS)[number];
/** -1, or a missing key, means unlimited. */
export type PlanLimits = Partial<Record<LimitMetric, number>>;

export type Standing = 'active' | 'grace' | 'restricted';

export function standingOf(status: SubscriptionStatus | null): Standing {
  switch (status) {
    case SubscriptionStatus.TRIALING:
    case SubscriptionStatus.ACTIVE:
      return 'active';
    case SubscriptionStatus.PAST_DUE:
      return 'grace';
    default:
      return 'restricted';
  }
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Same day next month, clamped (31 Jan → 28/29 Feb), in UTC. */
export function addMonth(date: Date): Date {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

export function limitOf(limits: PlanLimits, metric: LimitMetric): number | null {
  const value = limits[metric];
  return typeof value === 'number' && value >= 0 ? value : null;
}

export interface LifecycleInput {
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  /** Due date of the oldest unpaid invoice, if any. */
  overdueSince: Date | null;
}

export type LifecycleStep =
  { kind: 'renew' } | { kind: 'cancel' } | { kind: 'past_due' } | { kind: 'expire' };

/** The next transition due at `now`, or null when the subscription is up to date. */
export function nextStep(input: LifecycleInput, now: Date): LifecycleStep | null {
  const live =
    input.status === SubscriptionStatus.TRIALING || input.status === SubscriptionStatus.ACTIVE;

  if (live && now >= input.currentPeriodEnd) {
    return input.cancelAtPeriodEnd ? { kind: 'cancel' } : { kind: 'renew' };
  }

  if (
    input.status === SubscriptionStatus.ACTIVE &&
    input.overdueSince &&
    now > input.overdueSince
  ) {
    return { kind: 'past_due' };
  }

  if (
    input.status === SubscriptionStatus.PAST_DUE &&
    input.overdueSince &&
    now > addDays(input.overdueSince, GRACE_DAYS)
  ) {
    return { kind: 'expire' };
  }

  return null;
}

export interface DowngradeConflict {
  metric: LimitMetric;
  used: number;
  limit: number;
}

/** What the store already has that a smaller plan would not allow. */
export function downgradeConflicts(
  usage: Partial<Record<LimitMetric, number>>,
  limits: PlanLimits,
): DowngradeConflict[] {
  return (['USERS', 'PRODUCTS', 'CHANNELS'] as const).flatMap((metric) => {
    const limit = limitOf(limits, metric);
    const used = usage[metric] ?? 0;
    return limit !== null && used > limit ? [{ metric, used, limit }] : [];
  });
}

/** Invoice number: INV-202610-000042. */
export function invoiceNumber(issuedAt: Date, sequence: number): string {
  const month = `${issuedAt.getUTCFullYear()}${String(issuedAt.getUTCMonth() + 1).padStart(2, '0')}`;
  return `INV-${month}-${String(sequence).padStart(6, '0')}`;
}
