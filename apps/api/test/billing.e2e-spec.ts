import { INestApplication } from '@nestjs/common';
import { BillingService } from '@modules/billing/billing.service';
import { addDays } from '@modules/billing/billing.rules';
import { PasswordService } from '@modules/auth/password.service';
import {
  TestContext,
  bearer,
  createTestApp,
  registerTenant,
  resetTenantData,
  setTenantPlan,
} from './helpers/test-app';

/**
 * Phase 8: plan limits, the subscription lifecycle (trial → invoice → past due →
 * expired → paid), plan changes, and the platform team's controls.
 */
describe('Billing and plans (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let adminToken: string;
  let agentRoleId: string;

  const auth = () => bearer(owner.accessToken);
  const admin = () => bearer(adminToken);

  async function subscription() {
    return ctx.prisma.subscription.findFirstOrThrow({ where: { companyId: owner.companyId } });
  }

  async function addUser(email: string, status = 201) {
    return ctx
      .http()
      .post('/api/v1/users')
      .set('Authorization', auth())
      .send({ email, fullName: 'عضو', password: 'Member@12345', roleId: agentRoleId })
      .expect(status);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await resetTenantData(ctx.prisma);

    owner = await registerTenant(ctx, { companyName: 'متجر الاشتراك', email: 'owner@billing.iq' });

    const roles = (await ctx.http().get('/api/v1/roles').set('Authorization', auth()).expect(200))
      .body.data as { id: string; key: string }[];
    agentRoleId = roles.find((role) => role.key === 'SALES_AGENT')!.id;

    // The reset truncates users, so the platform admin is created here.
    await ctx.prisma.user.create({
      data: {
        email: 'admin@platform.iq',
        fullName: 'مدير المنصة',
        passwordHash: await app.get(PasswordService).hash('Admin@12345'),
        isPlatformAdmin: true,
        status: 'ACTIVE',
      },
    });
    adminToken = (
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'admin@platform.iq', password: 'Admin@12345' })
        .expect(200)
    ).body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await app.close();
  });

  describe('Trial and limits', () => {
    it('starts every store on a 14-day trial of the basic plan', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/billing/status')
        .set('Authorization', auth())
        .expect(200);

      expect(response.body.data).toMatchObject({
        status: 'TRIALING',
        standing: 'active',
        tier: 'BASIC',
      });
      expect(response.body.data.daysLeft).toBeGreaterThanOrEqual(13);
      expect(response.body.data.openInvoice).toBeNull();
    });

    it('shows usage against the plan limits', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/billing/subscription')
        .set('Authorization', auth())
        .expect(200);

      const users = response.body.data.usage.find(
        (row: { metric: string }) => row.metric === 'USERS',
      );
      expect(users).toMatchObject({ used: 1, limit: 3 });
      expect(response.body.data.plans.map((plan: { tier: string }) => plan.tier)).toEqual([
        'BASIC',
        'BUSINESS',
        'ENTERPRISE',
      ]);
    });

    it('refuses a member beyond the plan, with what was reached', async () => {
      await addUser('two@billing.iq');
      await addUser('three@billing.iq');

      const response = await addUser('four@billing.iq', 402);
      expect(response.body.code).toBe('PLAN_LIMIT_REACHED');
      expect(response.body.details).toMatchObject({ metric: 'USERS', limit: 3, used: 3 });
    });

    it('lets an upgrade take effect at once', async () => {
      await ctx
        .http()
        .post('/api/v1/billing/subscription/change')
        .set('Authorization', auth())
        .send({ tier: 'BUSINESS' })
        .expect(200);

      await addUser('four@billing.iq');
      expect((await subscription()).status).toBe('TRIALING');
    });

    it('blocks a downgrade the store no longer fits in', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/billing/subscription/change')
        .set('Authorization', auth())
        .send({ tier: 'BASIC' })
        .expect(409);

      expect(response.body.code).toBe('PLAN_DOWNGRADE_BLOCKED');
      expect(response.body.details.conflicts).toEqual([{ metric: 'USERS', used: 4, limit: 3 }]);
    });

    it('keeps billing from members without the permission', async () => {
      const token = (
        await ctx
          .http()
          .post('/api/v1/auth/login')
          .send({ email: 'two@billing.iq', password: 'Member@12345' })
          .expect(200)
      ).body.data.tokens.accessToken;

      await ctx
        .http()
        .get('/api/v1/billing/subscription')
        .set('Authorization', bearer(token))
        .expect(403);
      // The banner status is for everyone.
      await ctx
        .http()
        .get('/api/v1/billing/status')
        .set('Authorization', bearer(token))
        .expect(200);
    });
  });

  describe('Lifecycle', () => {
    const lifecycle = (at: Date) => app.get(BillingService).runLifecycle(at);
    let trialEnd: Date;

    it('invoices the first month when the trial ends', async () => {
      trialEnd = (await subscription()).currentPeriodEnd;
      await lifecycle(addDays(trialEnd, 0.01));

      const after = await subscription();
      expect(after.status).toBe('ACTIVE');
      expect(after.currentPeriodStart.getTime()).toBe(trialEnd.getTime());

      const invoices = await ctx
        .http()
        .get('/api/v1/billing/invoices')
        .set('Authorization', auth())
        .expect(200);
      expect(invoices.body.data).toHaveLength(1);
      expect(invoices.body.data[0]).toMatchObject({ status: 'OPEN', total: 79 });
      expect(invoices.body.data[0].number).toMatch(/^INV-\d{6}-\d{6}$/);

      const company = await ctx.prisma.company.findUniqueOrThrow({
        where: { id: owner.companyId },
      });
      expect(company.status).toBe('ACTIVE');
    });

    it('is safe to run again: nothing is invoiced twice', async () => {
      await lifecycle(addDays(trialEnd, 0.02));
      expect(await ctx.prisma.invoice.count({ where: { companyId: owner.companyId } })).toBe(1);
    });

    it('marks the store past due after the payment terms, and keeps it working', async () => {
      await lifecycle(addDays(trialEnd, 8));
      expect((await subscription()).status).toBe('PAST_DUE');

      await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'منتج أثناء السماح', price: 1000 })
        .expect(201);
    });

    it('restricts the store once the grace period is over', async () => {
      await lifecycle(addDays(trialEnd, 8 + 15));
      expect((await subscription()).status).toBe('EXPIRED');

      const refused = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'منتج بعد الانتهاء', price: 1000 })
        .expect(402);
      expect(refused.body.code).toBe('SUBSCRIPTION_INACTIVE');

      // Restricted, not locked out: existing data stays readable.
      await ctx.http().get('/api/v1/products').set('Authorization', auth()).expect(200);
      const status = await ctx
        .http()
        .get('/api/v1/billing/status')
        .set('Authorization', auth())
        .expect(200);
      expect(status.body.data.standing).toBe('restricted');
      expect(status.body.data.openInvoice.total).toBe(79);
    });

    it('runs again once the platform team records the payment', async () => {
      const invoice = await ctx.prisma.invoice.findFirstOrThrow({
        where: { companyId: owner.companyId, status: 'OPEN' },
      });

      const response = await ctx
        .http()
        .post(`/api/v1/platform/invoices/${invoice.id}/pay`)
        .set('Authorization', admin())
        .expect(200);
      expect(response.body.data.subscription.status).toBe('ACTIVE');

      await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'منتج بعد الدفع', price: 1000 })
        .expect(201);

      const notified = await ctx.prisma.notification.findFirst({
        where: { userId: owner.ownerId, title: 'تم استلام الدفعة' },
      });
      expect(notified).not.toBeNull();
    });

    it('ends without a new invoice when renewal was cancelled', async () => {
      await ctx
        .http()
        .post('/api/v1/billing/subscription/cancel')
        .set('Authorization', auth())
        .send({ cancel: true })
        .expect(200);

      const before = await ctx.prisma.invoice.count({ where: { companyId: owner.companyId } });
      await lifecycle(addDays((await subscription()).currentPeriodEnd, 0.01));

      expect((await subscription()).status).toBe('CANCELLED');
      expect(await ctx.prisma.invoice.count({ where: { companyId: owner.companyId } })).toBe(
        before,
      );
    });

    it('starts a new paid period when a cancelled store picks a plan again', async () => {
      await ctx
        .http()
        .post('/api/v1/billing/subscription/change')
        .set('Authorization', auth())
        .send({ tier: 'BUSINESS' })
        .expect(200);

      expect((await subscription()).status).toBe('ACTIVE');
      expect(
        await ctx.prisma.invoice.count({ where: { companyId: owner.companyId, status: 'OPEN' } }),
      ).toBe(1);
    });
  });

  describe('Platform team', () => {
    it('lists stores with their plan and what they owe', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/platform/companies')
        .query({ search: 'الاشتراك' })
        .set('Authorization', admin())
        .expect(200);

      expect(response.body.data.items[0]).toMatchObject({
        id: owner.companyId,
        openInvoices: 1,
        amountDue: 79,
      });
    });

    it('is closed to store owners', async () => {
      await ctx.http().get('/api/v1/platform/companies').set('Authorization', auth()).expect(403);
    });

    it('extends a period as a goodwill grant', async () => {
      const before = (await subscription()).currentPeriodEnd;
      await ctx
        .http()
        .patch(`/api/v1/platform/companies/${owner.companyId}/subscription`)
        .set('Authorization', admin())
        .send({ extendDays: 7 })
        .expect(200);

      expect((await subscription()).currentPeriodEnd.getTime()).toBe(addDays(before, 7).getTime());
    });

    it('suspends a store, which locks its members out, and reactivates it', async () => {
      await ctx
        .http()
        .patch(`/api/v1/platform/companies/${owner.companyId}/status`)
        .set('Authorization', admin())
        .send({ status: 'SUSPENDED' })
        .expect(200);

      const refused = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: owner.password })
        .expect(401);
      expect(refused.body.code).toBe('COMPANY_SUSPENDED');

      await ctx
        .http()
        .patch(`/api/v1/platform/companies/${owner.companyId}/status`)
        .set('Authorization', admin())
        .send({ status: 'ACTIVE' })
        .expect(200);

      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: owner.password })
        .expect(200);
    });

    it('moves a store to any plan, bypassing the downgrade check', async () => {
      await setTenantPlan(ctx.prisma, owner.companyId, 'BUSINESS');
      const response = await ctx
        .http()
        .patch(`/api/v1/platform/companies/${owner.companyId}/subscription`)
        .set('Authorization', admin())
        .send({ tier: 'BASIC' })
        .expect(200);

      expect(response.body.data.planTier).toBe('BASIC');
    });
  });
});
