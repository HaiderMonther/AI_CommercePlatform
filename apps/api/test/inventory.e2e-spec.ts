import { INestApplication } from '@nestjs/common';
import { TestContext, bearer, createTestApp, registerTenant, resetTenantData } from './helpers/test-app';

describe('Inventory ledger (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerTenant>>;

  const auth = () => bearer(owner.accessToken);

  const createProduct = async (name: string, initialStock: number, sku?: string) => {
    const response = await ctx
      .http()
      .post('/api/v1/products')
      .set('Authorization', auth())
      .send({ name, price: 10000, costPrice: 6000, initialStock, ...(sku ? { sku } : {}) })
      .expect(201);
    return response.body.data.id as string;
  };

  const stockOf = async (productId: string) => {
    const response = await ctx
      .http()
      .get(`/api/v1/products/${productId}`)
      .set('Authorization', auth())
      .expect(200);
    return response.body.data as { stock: number; reservedStock: number; availableStock: number };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await resetTenantData(ctx.prisma);
    owner = await registerTenant(ctx, { companyName: 'متجر المخزون', email: 'owner@stock.iq' });
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await app.close();
  });

  describe('Movement types', () => {
    it('adds stock on STOCK_IN and records before/after', async () => {
      const productId = await createProduct('منتج إدخال', 10);

      const response = await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth())
        .send({ productId, type: 'STOCK_IN', quantity: 5, reason: 'شحنة جديدة' })
        .expect(201);

      expect(response.body.data.stockBefore).toBe(10);
      expect(response.body.data.stockAfter).toBe(15);
      expect((await stockOf(productId)).stock).toBe(15);
    });

    it('removes stock on STOCK_OUT', async () => {
      const productId = await createProduct('منتج إخراج', 10);

      await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth())
        .send({ productId, type: 'STOCK_OUT', quantity: 4, reason: 'تالف' })
        .expect(201);

      expect((await stockOf(productId)).stock).toBe(6);
    });

    it('treats ADJUSTMENT as the counted total, not a delta', async () => {
      const productId = await createProduct('منتج جرد', 10);

      const response = await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth())
        .send({ productId, type: 'ADJUSTMENT', quantity: 7, reason: 'جرد شهري' })
        .expect(201);

      // 7 is what was counted on the shelf, so stock becomes 7 — not 17.
      expect(response.body.data.stockAfter).toBe(7);
      expect((await stockOf(productId)).stock).toBe(7);
    });

    it('records the signed change so the ledger reconstructs current stock', async () => {
      const productId = await createProduct('منتج السجل', 10);

      await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth())
        .send({ productId, type: 'STOCK_OUT', quantity: 3 })
        .expect(201);

      const movements = await ctx
        .http()
        .get(`/api/v1/inventory/movements?productId=${productId}&sortOrder=asc`)
        .set('Authorization', auth())
        .expect(200);

      const sum = movements.body.data.items.reduce(
        (total: number, movement: { quantity: number }) => total + movement.quantity,
        0,
      );

      expect(sum).toBe(7);
      expect((await stockOf(productId)).stock).toBe(sum);
    });

    it('refuses movement types reserved for the order flow', async () => {
      const productId = await createProduct('منتج محمي', 10);

      for (const type of ['SALE', 'RESERVATION', 'RELEASE']) {
        await ctx
          .http()
          .post('/api/v1/inventory/adjust')
          .set('Authorization', auth())
          .send({ productId, type, quantity: 1 })
          .expect(400);
      }
    });
  });

  describe('Guards', () => {
    it('never lets stock go negative', async () => {
      const productId = await createProduct('منتج قليل', 3);

      const response = await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth())
        .send({ productId, type: 'STOCK_OUT', quantity: 10 })
        .expect(409);

      expect(response.body.code).toBe('INSUFFICIENT_STOCK');
      expect((await stockOf(productId)).stock).toBe(3);
    });

    it('rejects a movement on a product that does not track inventory', async () => {
      const created = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'خدمة تفصيل', price: 5000, trackInventory: false })
        .expect(201);

      await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth())
        .send({ productId: created.body.data.id, type: 'STOCK_IN', quantity: 5 })
        .expect(400);
    });

    it('rejects a negative quantity', async () => {
      const productId = await createProduct('منتج سالب', 5);

      await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth())
        .send({ productId, type: 'STOCK_IN', quantity: -5 })
        .expect(400);
    });
  });

  /**
   * The guarantee that matters once the AI starts taking orders: two buyers must never
   * be sold the same last piece. Without the row lock in recordMovement, concurrent
   * requests all read the same "before" value and stock ends up negative.
   */
  describe('Concurrency', () => {
    it('serializes concurrent decrements and never oversells', async () => {
      const productId = await createProduct('منتج التزاحم', 10, 'RACE-001');

      const attempts = Array.from({ length: 20 }, () =>
        ctx
          .http()
          .post('/api/v1/inventory/adjust')
          .set('Authorization', auth())
          .send({ productId, type: 'STOCK_OUT', quantity: 1, reason: 'بيع متزامن' }),
      );

      const results = await Promise.all(attempts);

      const succeeded = results.filter((result) => result.status === 201).length;
      const rejected = results.filter((result) => result.status === 409).length;

      expect(succeeded).toBe(10);
      expect(rejected).toBe(10);

      const final = await stockOf(productId);
      expect(final.stock).toBe(0);

      // Exactly one movement per successful decrement: no lost updates, no phantom rows.
      const movements = await ctx
        .http()
        .get(`/api/v1/inventory/movements?productId=${productId}&limit=100`)
        .set('Authorization', auth())
        .expect(200);

      const outbound = movements.body.data.items.filter(
        (movement: { type: string }) => movement.type === 'STOCK_OUT',
      );
      expect(outbound).toHaveLength(10);
    });

    it('keeps a variant product total consistent under concurrent variant movements', async () => {
      const productId = await createProduct('منتج متغيرات متزامن', 0, 'RACE-002');

      const variantIds: string[] = [];
      for (const size of ['S', 'M']) {
        const variant = await ctx
          .http()
          .post(`/api/v1/products/${productId}/variants`)
          .set('Authorization', auth())
          .send({ attributes: { size }, initialStock: 10 })
          .expect(201);
        variantIds.push(variant.body.data.id);
      }

      await Promise.all(
        variantIds.flatMap((variantId) =>
          Array.from({ length: 6 }, () =>
            ctx
              .http()
              .post('/api/v1/inventory/adjust')
              .set('Authorization', auth())
              .send({ productId, variantId, type: 'STOCK_OUT', quantity: 1 }),
          ),
        ),
      );

      const product = await ctx
        .http()
        .get(`/api/v1/products/${productId}`)
        .set('Authorization', auth())
        .expect(200);

      const sum = product.body.data.variants.reduce(
        (total: number, variant: { stock: number }) => total + variant.stock,
        0,
      );

      expect(product.body.data.stock).toBe(sum);
      expect(sum).toBe(8);
    });
  });

  describe('Reporting', () => {
    it('lists products at or below their threshold', async () => {
      const productId = await createProduct('منتج منخفض', 2, 'LOW-001');

      const response = await ctx
        .http()
        .get('/api/v1/inventory/low-stock')
        .set('Authorization', auth())
        .expect(200);

      const ids = response.body.data.map((row: { id: string }) => row.id);
      expect(ids).toContain(productId);
    });

    it('summarizes units, reservations and stock value', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/inventory/summary')
        .set('Authorization', auth())
        .expect(200);

      const summary = response.body.data;
      expect(summary.totalProducts).toBeGreaterThan(0);
      expect(summary.availableUnits).toBe(summary.totalUnits - summary.reservedUnits);
      expect(Number(summary.stockValue)).toBeGreaterThan(0);
    });
  });
});
