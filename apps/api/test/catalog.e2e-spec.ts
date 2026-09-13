import { INestApplication } from '@nestjs/common';
import { TestContext, bearer, createTestApp, registerTenant, resetTenantData } from './helpers/test-app';

describe('Catalog: categories, products, variants (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerTenant>>;

  const auth = () => bearer(owner.accessToken);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await resetTenantData(ctx.prisma);
    owner = await registerTenant(ctx, { companyName: 'متجر الكتالوج', email: 'owner@catalog.iq' });
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await app.close();
  });

  describe('Categories', () => {
    let parentId: string;

    it('creates a root category with a generated slug', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/categories')
        .set('Authorization', auth())
        .send({ name: 'ملابس رجالية' })
        .expect(201);

      parentId = response.body.data.id;
      expect(response.body.data.slug).toBeTruthy();
      expect(response.body.data.parentId).toBeNull();
    });

    it('nests a child under a parent', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/categories')
        .set('Authorization', auth())
        .send({ name: 'قمصان', parentId })
        .expect(201);

      expect(response.body.data.parentId).toBe(parentId);
    });

    it('returns a nested tree when asked', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/categories?tree=true')
        .set('Authorization', auth())
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].children).toHaveLength(1);
      expect(response.body.data[0].children[0].name).toBe('قمصان');
    });

    it('refuses to make a category its own descendant', async () => {
      const children = await ctx
        .http()
        .get('/api/v1/categories')
        .set('Authorization', auth())
        .expect(200);

      const childId = children.body.data.find(
        (category: { parentId: string | null }) => category.parentId === parentId,
      ).id;

      await ctx
        .http()
        .patch(`/api/v1/categories/${parentId}`)
        .set('Authorization', auth())
        .send({ parentId: childId })
        .expect(400);
    });

    it('refuses to delete a category that still has children', async () => {
      const response = await ctx
        .http()
        .delete(`/api/v1/categories/${parentId}`)
        .set('Authorization', auth())
        .expect(409);

      expect(response.body.message).toContain('فرعية');
    });
  });

  describe('Products', () => {
    let productId: string;
    let categoryId: string;

    beforeAll(async () => {
      const categories = await ctx
        .http()
        .get('/api/v1/categories')
        .set('Authorization', auth())
        .expect(200);
      categoryId = categories.body.data[0].id;
    });

    it('creates a product and books the opening quantity as a movement', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({
          name: 'قميص قطني',
          sku: 'SHIRT-001',
          price: 25000,
          costPrice: 16000,
          categoryId,
          initialStock: 20,
          lowStockThreshold: 5,
        })
        .expect(201);

      productId = response.body.data.id;
      expect(response.body.data.stock).toBe(20);
      expect(response.body.data.availableStock).toBe(20);
      expect(response.body.data.isLowStock).toBe(false);

      const movements = await ctx
        .http()
        .get(`/api/v1/inventory/movements?productId=${productId}`)
        .set('Authorization', auth())
        .expect(200);

      expect(movements.body.data.items).toHaveLength(1);
      expect(movements.body.data.items[0].type).toBe('STOCK_IN');
      expect(movements.body.data.items[0].quantityAfter).toBe(20);
    });

    it('generates a SKU when none is supplied', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'بنطلون جينز', price: 35000 })
        .expect(201);

      expect(response.body.data.sku).toMatch(/^[A-Z0-9]+-\d{5}/);
    });

    it('rejects a duplicate SKU', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'قميص آخر', sku: 'SHIRT-001', price: 20000 })
        .expect(409);

      expect(response.body.code).toBe('SKU_ALREADY_USED');
    });

    it('refuses to change stock through the product endpoint', async () => {
      // Stock must move through the inventory ledger, so the field is not accepted here.
      await ctx
        .http()
        .patch(`/api/v1/products/${productId}`)
        .set('Authorization', auth())
        .send({ stock: 999 })
        .expect(400);

      const product = await ctx
        .http()
        .get(`/api/v1/products/${productId}`)
        .set('Authorization', auth())
        .expect(200);

      expect(product.body.data.stock).toBe(20);
    });

    it('rejects a product priced with more precision than the currency supports', async () => {
      await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'منتج', price: 10.12345 })
        .expect(400);
    });

    it('filters by low stock', async () => {
      await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth())
        .send({ productId, type: 'ADJUSTMENT', quantity: 3, reason: 'جرد' })
        .expect(201);

      const response = await ctx
        .http()
        .get('/api/v1/products?lowStock=true')
        .set('Authorization', auth())
        .expect(200);

      const ids = response.body.data.items.map((item: { id: string }) => item.id);
      expect(ids).toContain(productId);
    });

    it('searches by name and by SKU', async () => {
      const byName = await ctx
        .http()
        .get('/api/v1/products?search=جينز')
        .set('Authorization', auth())
        .expect(200);
      expect(byName.body.data.items.length).toBeGreaterThan(0);

      const bySku = await ctx
        .http()
        .get('/api/v1/products?search=SHIRT-001')
        .set('Authorization', auth())
        .expect(200);
      expect(bySku.body.data.items[0].sku).toBe('SHIRT-001');
    });

    it('frees the SKU when a product is deleted so it can be reused', async () => {
      const doomed = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'منتج مؤقت', sku: 'TEMP-001', price: 1000 })
        .expect(201);

      await ctx
        .http()
        .delete(`/api/v1/products/${doomed.body.data.id}`)
        .set('Authorization', auth())
        .expect(200);

      await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'منتج جديد بنفس الرمز', sku: 'TEMP-001', price: 1200 })
        .expect(201);
    });

    it('refuses to delete a category that still holds products', async () => {
      const response = await ctx
        .http()
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', auth())
        .expect(409);

      expect(response.body.message).toContain('منتج');
    });
  });

  describe('Variants', () => {
    let productId: string;

    beforeAll(async () => {
      const product = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', auth())
        .send({ name: 'تيشيرت', sku: 'TSHIRT-100', price: 15000, initialStock: 7 })
        .expect(201);
      productId = product.body.data.id;
    });

    it('moves pre-existing stock out when the first variant is added', async () => {
      const response = await ctx
        .http()
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth())
        .send({ attributes: { color: 'أسود', size: 'M' }, initialStock: 10 })
        .expect(201);

      expect(response.body.data.name).toBe('أسود / M');
      expect(response.body.data.sku).toContain('TSHIRT-100');
      expect(response.body.data.stock).toBe(10);

      // The product total is now the sum of its variants, not the old flat 7.
      const product = await ctx
        .http()
        .get(`/api/v1/products/${productId}`)
        .set('Authorization', auth())
        .expect(200);

      expect(product.body.data.hasVariants).toBe(true);
      expect(product.body.data.stock).toBe(10);
    });

    it('keeps the product total equal to the sum of its variants', async () => {
      await ctx
        .http()
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth())
        .send({ attributes: { color: 'أبيض', size: 'L' }, initialStock: 4 })
        .expect(201);

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
      expect(product.body.data.stock).toBe(14);
    });

    it('rejects a duplicate attribute combination', async () => {
      const response = await ctx
        .http()
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth())
        .send({ attributes: { size: 'M', color: 'أسود' } })
        .expect(409);

      expect(response.body.message).toContain('نفس الخصائص');
    });

    it('rejects a variant with no attributes', async () => {
      await ctx
        .http()
        .post(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth())
        .send({ attributes: {} })
        .expect(400);
    });

    it('refuses to adjust the parent product of a variant product directly', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', auth())
        .send({ productId, type: 'STOCK_IN', quantity: 5 })
        .expect(400);

      expect(response.body.message).toContain('متغيرات');
    });

    it('recomputes the product total when a variant is removed', async () => {
      const variants = await ctx
        .http()
        .get(`/api/v1/products/${productId}/variants`)
        .set('Authorization', auth())
        .expect(200);

      const target = variants.body.data.find((v: { stock: number }) => v.stock === 4);

      await ctx
        .http()
        .delete(`/api/v1/products/${productId}/variants/${target.id}`)
        .set('Authorization', auth())
        .expect(200);

      const product = await ctx
        .http()
        .get(`/api/v1/products/${productId}`)
        .set('Authorization', auth())
        .expect(200);

      expect(product.body.data.stock).toBe(10);
    });
  });
});
