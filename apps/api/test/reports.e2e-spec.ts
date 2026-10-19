import {
  TestContext,
  bearer,
  createTestApp,
  registerTenant,
  resetTenantData,
} from './helpers/test-app';

/**
 * Phase 7: dashboard, reports, CSV export and notifications — including that each member
 * sees only their own notifications and only the dashboard sections they may see.
 */
describe('Dashboard, reports and notifications (e2e)', () => {
  let ctx: TestContext;
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let other: Awaited<ReturnType<typeof registerTenant>>;
  let agentToken: string;
  let productId: string;
  let customerId: string;
  let orderId: string;

  const auth = () => bearer(owner.accessToken);
  const agent = () => bearer(agentToken);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetTenantData(ctx.prisma);

    owner = await registerTenant(ctx, { companyName: 'متجر التقارير', email: 'owner@reports.iq' });
    other = await registerTenant(ctx, { companyName: 'متجر آخر', email: 'owner@other-reports.iq' });

    const roles = (await ctx.http().get('/api/v1/roles').set('Authorization', auth()).expect(200))
      .body.data as { id: string; key: string }[];
    await ctx
      .http()
      .post('/api/v1/users')
      .set('Authorization', auth())
      .send({
        email: 'agent@reports.iq',
        fullName: 'مندوب',
        password: 'Member@12345',
        roleId: roles.find((role) => role.key === 'SALES_AGENT')!.id,
      })
      .expect(201);
    agentToken = (
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'agent@reports.iq', password: 'Member@12345' })
        .expect(200)
    ).body.data.tokens.accessToken;

    productId = (
      await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'قميص', sku: 'RPT-1', price: 20000, initialStock: 6, lowStockThreshold: 5 })
        .expect(201)
    ).body.data.id;

    customerId = (
      await ctx
        .http()
        .post('/api/v1/customers')
        .set('Authorization', auth())
        .send({ name: 'زبون التقرير', phone: '07701112233', city: 'النجف' })
        .expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await ctx.app.close();
  });

  describe('Notifications', () => {
    it('tells the team about a new order, but not the person who placed it', async () => {
      orderId = (
        await ctx
          .http()
          .post('/api/v1/orders')
          .set('Authorization', auth())
          .send({ customerId, items: [{ productId, quantity: 2 }], deliveryFee: 5000 })
          .expect(201)
      ).body.data.id;

      const mine = await ctx
        .http()
        .get('/api/v1/notifications')
        .set('Authorization', auth())
        .expect(200);
      expect(
        mine.body.data.items.filter((n: { type: string }) => n.type === 'NEW_ORDER'),
      ).toHaveLength(0);

      const theirs = await ctx
        .http()
        .get('/api/v1/notifications')
        .set('Authorization', agent())
        .expect(200);
      const notification = theirs.body.data.items.find(
        (n: { type: string }) => n.type === 'NEW_ORDER',
      );
      expect(notification.data.orderId).toBe(orderId);
      expect(notification.body).toContain('45,000 د.ع');
      expect(theirs.body.data.unread).toBeGreaterThan(0);
    });

    it('alerts once when shipping brings stock to its reorder level', async () => {
      await ctx
        .http()
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', agent())
        .send({ status: 'SHIPPED' })
        .expect(200);

      // A manual stock-out on the same product must not raise a second alert.
      await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', agent())
        .send({ productId, type: 'STOCK_OUT', quantity: 1 })
        .expect(201);

      const list = await ctx
        .http()
        .get('/api/v1/notifications')
        .set('Authorization', auth())
        .expect(200);
      const alerts = list.body.data.items.filter((n: { type: string }) => n.type === 'LOW_STOCK');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].data.productId).toBe(productId);
    });

    it('marks one and then all notifications as read', async () => {
      const list = await ctx
        .http()
        .get('/api/v1/notifications')
        .set('Authorization', agent())
        .expect(200);
      const first = list.body.data.items[0];

      const afterOne = await ctx
        .http()
        .post(`/api/v1/notifications/${first.id}/read`)
        .set('Authorization', agent())
        .expect(200);
      expect(afterOne.body.data.unread).toBe(list.body.data.unread - 1);

      await ctx
        .http()
        .post('/api/v1/notifications/read-all')
        .set('Authorization', agent())
        .expect(200);
      const count = await ctx
        .http()
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', agent())
        .expect(200);
      expect(count.body.data.unread).toBe(0);
    });

    it("cannot read or clear someone else's notification", async () => {
      const mine = await ctx.prisma.notification.findFirstOrThrow({
        where: { companyId: owner.companyId, userId: owner.ownerId },
      });

      await ctx
        .http()
        .post(`/api/v1/notifications/${mine.id}/read`)
        .set('Authorization', agent())
        .expect(404);
      await ctx
        .http()
        .post(`/api/v1/notifications/${mine.id}/read`)
        .set('Authorization', bearer(other.accessToken))
        .expect(404);
    });
  });

  describe('Reports', () => {
    it('totals sales for the period with a day for every date', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/reports/sales')
        .query({ from: '2026-01-01', to: '2026-12-31' })
        .set('Authorization', auth())
        .expect(200);

      const report = response.body.data;
      expect(report.totals.orders).toBe(1);
      expect(report.totals.value).toBe(45000);
      expect(report.series).toHaveLength(365);
      expect(report.bySource).toEqual([{ key: 'DASHBOARD', count: 1, value: 45000 }]);
      expect(report.topCities[0]).toMatchObject({ key: 'النجف', count: 1 });
    });

    it('ranks products by what they sold', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/reports/products')
        .set('Authorization', auth())
        .expect(200);

      expect(response.body.data.byQuantity[0]).toMatchObject({
        productId,
        quantity: 2,
        revenue: 40000,
        orders: 1,
      });
    });

    it('rejects a reversed or overlong range', async () => {
      await ctx
        .http()
        .get('/api/v1/reports/sales')
        .query({ from: '2026-10-10', to: '2026-10-01' })
        .set('Authorization', auth())
        .expect(400);
      await ctx
        .http()
        .get('/api/v1/reports/sales')
        .query({ from: '2020-01-01', to: '2026-01-01' })
        .set('Authorization', auth())
        .expect(400);
    });

    it('keeps reports from a sales agent', async () => {
      await ctx.http().get('/api/v1/reports/sales').set('Authorization', agent()).expect(403);
    });

    it("never mixes in another company's orders", async () => {
      const response = await ctx
        .http()
        .get('/api/v1/reports/sales')
        .set('Authorization', bearer(other.accessToken))
        .expect(200);
      expect(response.body.data.totals.orders).toBe(0);
    });

    it('exports the period as a CSV Excel opens in Arabic', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/reports/orders/export')
        .set('Authorization', auth())
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks).toString('utf8')));
        })
        .expect(200);

      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');

      const csv = response.body as string;
      expect(csv.charCodeAt(0)).toBe(0xfeff);
      const lines = csv.slice(1).split('\r\n');
      expect(lines[0]).toContain('رقم الطلب');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('2 × قميص');
      expect(lines[1]).toContain('+9647701112233');
    });
  });

  describe('Dashboard', () => {
    it('shows the owner every section', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/dashboard/summary')
        .set('Authorization', auth())
        .expect(200);
      const summary = response.body.data;

      expect(summary.sales.today.orders).toBe(1);
      expect(summary.sales.open.SHIPPED).toBe(1);
      expect(summary.sales.trend).toHaveLength(14);
      expect(summary.sales.recent[0].id).toBe(orderId);
      expect(summary.inventory.lowStockCount + summary.inventory.outOfStockCount).toBe(1);
      expect(summary.customers.total).toBe(1);
      expect(summary.ai).not.toBeNull();
    });

    it('leaves out what a sales agent may not see', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/dashboard/summary')
        .set('Authorization', agent())
        .expect(200);

      expect(response.body.data.sales).not.toBeNull();
      expect(response.body.data.ai).toBeNull();
    });
  });
});
