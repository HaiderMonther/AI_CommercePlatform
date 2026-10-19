import { SubscriptionStatus } from '@prisma/client';
import {
  GRACE_DAYS,
  addDays,
  addMonth,
  downgradeConflicts,
  invoiceNumber,
  limitOf,
  nextStep,
  standingOf,
} from './billing.rules';

const now = new Date('2026-10-19T12:00:00Z');

describe('billing rules', () => {
  describe('nextStep', () => {
    const base = {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: addDays(now, 10),
      cancelAtPeriodEnd: false,
      overdueSince: null,
    };

    it('does nothing for a paid subscription mid-period', () => {
      expect(nextStep(base, now)).toBeNull();
    });

    it.each([SubscriptionStatus.TRIALING, SubscriptionStatus.ACTIVE])(
      'renews a %s subscription at the end of its period',
      (status) => {
        expect(nextStep({ ...base, status, currentPeriodEnd: now }, now)).toEqual({
          kind: 'renew',
        });
      },
    );

    it('cancels at period end when asked to', () => {
      expect(
        nextStep({ ...base, currentPeriodEnd: addDays(now, -1), cancelAtPeriodEnd: true }, now),
      ).toEqual({ kind: 'cancel' });
    });

    it('marks an overdue invoice as past due, keeping the store running', () => {
      expect(nextStep({ ...base, overdueSince: addDays(now, -1) }, now)).toEqual({
        kind: 'past_due',
      });
      expect(standingOf(SubscriptionStatus.PAST_DUE)).toBe('grace');
    });

    it('expires only after the grace period', () => {
      const pastDue = { ...base, status: SubscriptionStatus.PAST_DUE };

      expect(
        nextStep({ ...pastDue, overdueSince: addDays(now, -(GRACE_DAYS - 1)) }, now),
      ).toBeNull();
      expect(nextStep({ ...pastDue, overdueSince: addDays(now, -(GRACE_DAYS + 1)) }, now)).toEqual({
        kind: 'expire',
      });
    });

    it.each([SubscriptionStatus.EXPIRED, SubscriptionStatus.CANCELLED])(
      'leaves a %s subscription alone',
      (status) => {
        expect(
          nextStep(
            {
              ...base,
              status,
              currentPeriodEnd: addDays(now, -40),
              overdueSince: addDays(now, -40),
            },
            now,
          ),
        ).toBeNull();
        expect(standingOf(status)).toBe('restricted');
      },
    );
  });

  describe('addMonth', () => {
    it('keeps the day of the month', () => {
      expect(addMonth(new Date('2026-10-19T00:00:00Z')).toISOString()).toBe(
        '2026-11-19T00:00:00.000Z',
      );
    });

    it('clamps to the last day of a shorter month', () => {
      expect(addMonth(new Date('2026-01-31T00:00:00Z')).toISOString()).toBe(
        '2026-02-28T00:00:00.000Z',
      );
      expect(addMonth(new Date('2026-12-15T00:00:00Z')).toISOString()).toBe(
        '2027-01-15T00:00:00.000Z',
      );
    });
  });

  describe('limits', () => {
    it('treats -1 and missing limits as unlimited', () => {
      expect(limitOf({ USERS: -1 }, 'USERS')).toBeNull();
      expect(limitOf({}, 'PRODUCTS')).toBeNull();
      expect(limitOf({ CHANNELS: 0 }, 'CHANNELS')).toBe(0);
    });

    it('lists what a smaller plan would not hold', () => {
      expect(
        downgradeConflicts(
          { USERS: 5, PRODUCTS: 100, CHANNELS: 2, AI_MESSAGES: 9000 },
          { USERS: 3, PRODUCTS: 300, CHANNELS: 1, AI_MESSAGES: 1000 },
        ),
      ).toEqual([
        { metric: 'USERS', used: 5, limit: 3 },
        { metric: 'CHANNELS', used: 2, limit: 1 },
      ]);
    });
  });

  it('numbers invoices by month', () => {
    expect(invoiceNumber(new Date('2026-10-19T00:00:00Z'), 42)).toBe('INV-202610-000042');
  });
});
