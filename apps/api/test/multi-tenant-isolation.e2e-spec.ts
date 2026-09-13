import { INestApplication } from '@nestjs/common';
import {
  TestContext,
  bearer,
  createTestApp,
  registerTenant,
  resetTenantData,
} from './helpers/test-app';

/**
 * The single most important guarantee of the platform: company A can never observe or
 * mutate company B's data — not through a listing, not by guessing an id, and not by
 * sending a foreign companyId in a payload.
 */
describe('Multi-tenant isolation (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;

  let alpha: Awaited<ReturnType<typeof registerTenant>>;
  let beta: Awaited<ReturnType<typeof registerTenant>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await resetTenantData(ctx.prisma);

    alpha = await registerTenant(ctx, {
      companyName: 'شركة ألفا',
      email: 'owner@alpha.iq',
      fullName: 'مالك ألفا',
    });

    beta = await registerTenant(ctx, {
      companyName: 'شركة بيتا',
      email: 'owner@beta.iq',
      fullName: 'مالك بيتا',
    });
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await app.close();
  });

  it('gives each signup its own company', () => {
    expect(alpha.companyId).not.toBe(beta.companyId);
  });

  it('returns only the caller own company from GET /company', async () => {
    const response = await ctx
      .http()
      .get('/api/v1/company')
      .set('Authorization', bearer(alpha.accessToken))
      .expect(200);

    expect(response.body.data.id).toBe(alpha.companyId);
    expect(response.body.data.name).toBe('شركة ألفا');
  });

  it('never lists another company users', async () => {
    const response = await ctx
      .http()
      .get('/api/v1/users')
      .set('Authorization', bearer(alpha.accessToken))
      .expect(200);

    const emails = response.body.data.items.map((user: { email: string }) => user.email);
    expect(emails).toContain('owner@alpha.iq');
    expect(emails).not.toContain('owner@beta.iq');
    expect(response.body.data.meta.total).toBe(1);
  });

  it('returns 404 — not 403 — when reading another company user by id', async () => {
    const response = await ctx
      .http()
      .get(`/api/v1/users/${beta.ownerId}`)
      .set('Authorization', bearer(alpha.accessToken))
      .expect(404);

    expect(response.body.success).toBe(false);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  it('refuses to update another company user', async () => {
    await ctx
      .http()
      .patch(`/api/v1/users/${beta.ownerId}`)
      .set('Authorization', bearer(alpha.accessToken))
      .send({ fullName: 'مخترق' })
      .expect(404);

    const untouched = await ctx.prisma.user.findUniqueOrThrow({ where: { id: beta.ownerId } });
    expect(untouched.fullName).toBe('مالك بيتا');
  });

  it('refuses to delete another company user', async () => {
    await ctx
      .http()
      .delete(`/api/v1/users/${beta.ownerId}`)
      .set('Authorization', bearer(alpha.accessToken))
      .expect(404);

    const untouched = await ctx.prisma.user.findUniqueOrThrow({ where: { id: beta.ownerId } });
    expect(untouched.deletedAt).toBeNull();
  });

  it('never exposes another company roles', async () => {
    const [alphaRoles, betaRoles] = await Promise.all([
      ctx.http().get('/api/v1/roles').set('Authorization', bearer(alpha.accessToken)).expect(200),
      ctx.http().get('/api/v1/roles').set('Authorization', bearer(beta.accessToken)).expect(200),
    ]);

    const alphaIds = alphaRoles.body.data.map((role: { id: string }) => role.id);
    const betaIds = betaRoles.body.data.map((role: { id: string }) => role.id);

    expect(alphaIds).toHaveLength(5);
    expect(betaIds).toHaveLength(5);
    expect(alphaIds.some((id: string) => betaIds.includes(id))).toBe(false);
  });

  it('refuses to read another company role by id', async () => {
    const betaRoles = await ctx
      .http()
      .get('/api/v1/roles')
      .set('Authorization', bearer(beta.accessToken))
      .expect(200);

    const betaRoleId = betaRoles.body.data[0].id;

    await ctx
      .http()
      .get(`/api/v1/roles/${betaRoleId}`)
      .set('Authorization', bearer(alpha.accessToken))
      .expect(404);
  });

  it('refuses to assign a user to another company role', async () => {
    const betaRoles = await ctx
      .http()
      .get('/api/v1/roles')
      .set('Authorization', bearer(beta.accessToken))
      .expect(200);

    const response = await ctx
      .http()
      .post('/api/v1/users')
      .set('Authorization', bearer(alpha.accessToken))
      .send({
        email: 'smuggler@alpha.iq',
        fullName: 'محاولة تسلل',
        password: 'Smuggle@123',
        roleId: betaRoles.body.data[0].id,
      })
      .expect(400);

    expect(response.body.code).toBe('ROLE_NOT_FOUND');
  });

  it('strips an injected companyId from a request body (mass assignment)', async () => {
    const response = await ctx
      .http()
      .patch('/api/v1/company')
      .set('Authorization', bearer(alpha.accessToken))
      .send({ name: 'ألفا المحدثة', companyId: beta.companyId, id: beta.companyId })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');

    const betaCompany = await ctx.prisma.company.findUniqueOrThrow({
      where: { id: beta.companyId },
    });
    expect(betaCompany.name).toBe('شركة بيتا');
  });

  it('scopes company stats to the caller tenant', async () => {
    await ctx
      .http()
      .post('/api/v1/users')
      .set('Authorization', bearer(beta.accessToken))
      .send({
        email: 'agent@beta.iq',
        fullName: 'مندوب بيتا',
        password: 'Agent@12345',
        roleId: (
          await ctx
            .http()
            .get('/api/v1/roles')
            .set('Authorization', bearer(beta.accessToken))
        ).body.data.find((role: { key: string }) => role.key === 'SALES_AGENT').id,
      })
      .expect(201);

    const [alphaStats, betaStats] = await Promise.all([
      ctx
        .http()
        .get('/api/v1/company/stats')
        .set('Authorization', bearer(alpha.accessToken))
        .expect(200),
      ctx
        .http()
        .get('/api/v1/company/stats')
        .set('Authorization', bearer(beta.accessToken))
        .expect(200),
    ]);

    expect(alphaStats.body.data.users).toBe(1);
    expect(betaStats.body.data.users).toBe(2);
  });

  describe('Catalog isolation', () => {
    let alphaProductId: string;
    let betaProductId: string;
    let betaVariantId: string;

    beforeAll(async () => {
      const alphaProduct = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', bearer(alpha.accessToken))
        .send({ name: 'منتج ألفا', sku: 'SHARED-SKU', price: 10000, initialStock: 5 })
        .expect(201);
      alphaProductId = alphaProduct.body.data.id;

      const betaProduct = await ctx
        .http()
        .post('/api/v1/products')
        .set('Authorization', bearer(beta.accessToken))
        // The same SKU in another company must be allowed: uniqueness is per tenant.
        .send({ name: 'منتج بيتا', sku: 'SHARED-SKU', price: 20000, initialStock: 8 })
        .expect(201);
      betaProductId = betaProduct.body.data.id;

      const betaVariant = await ctx
        .http()
        .post(`/api/v1/products/${betaProductId}/variants`)
        .set('Authorization', bearer(beta.accessToken))
        .send({ attributes: { size: 'M' }, initialStock: 4 })
        .expect(201);
      betaVariantId = betaVariant.body.data.id;
    });

    it('allows the same SKU in two different companies', async () => {
      expect(alphaProductId).not.toBe(betaProductId);
    });

    it('lists only the caller own products', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/products')
        .set('Authorization', bearer(alpha.accessToken))
        .expect(200);

      const names = response.body.data.items.map((item: { name: string }) => item.name);
      expect(names).toContain('منتج ألفا');
      expect(names).not.toContain('منتج بيتا');
    });

    it('returns 404 when reading another company product by id', async () => {
      const response = await ctx
        .http()
        .get(`/api/v1/products/${betaProductId}`)
        .set('Authorization', bearer(alpha.accessToken))
        .expect(404);

      expect(response.body.code).toBe('PRODUCT_NOT_FOUND');
    });

    it('refuses to move another company stock', async () => {
      await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', bearer(alpha.accessToken))
        .send({ productId: betaProductId, type: 'STOCK_OUT', quantity: 1 })
        .expect(404);

      const untouched = await ctx.prisma.product.findUniqueOrThrow({
        where: { id: betaProductId },
      });
      expect(untouched.stock).toBe(4);
    });

    it('refuses to touch another company variant', async () => {
      await ctx
        .http()
        .post('/api/v1/inventory/adjust')
        .set('Authorization', bearer(alpha.accessToken))
        .send({ productId: betaProductId, variantId: betaVariantId, type: 'STOCK_OUT', quantity: 1 })
        .expect(404);

      const untouched = await ctx.prisma.productVariant.findUniqueOrThrow({
        where: { id: betaVariantId },
      });
      expect(untouched.stock).toBe(4);
    });

    it('never leaks another company inventory movements', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/inventory/movements?limit=100')
        .set('Authorization', bearer(alpha.accessToken))
        .expect(200);

      const foreign = response.body.data.items.filter(
        (movement: { companyId: string }) => movement.companyId !== alpha.companyId,
      );
      expect(foreign).toEqual([]);
    });

    it('scopes the inventory summary to the caller tenant', async () => {
      const [alphaSummary, betaSummary] = await Promise.all([
        ctx
          .http()
          .get('/api/v1/inventory/summary')
          .set('Authorization', bearer(alpha.accessToken))
          .expect(200),
        ctx
          .http()
          .get('/api/v1/inventory/summary')
          .set('Authorization', bearer(beta.accessToken))
          .expect(200),
      ]);

      expect(alphaSummary.body.data.totalUnits).toBe(5);
      expect(betaSummary.body.data.totalUnits).toBe(4);
    });

    it('refuses to assign a product to another company category', async () => {
      const betaCategory = await ctx
        .http()
        .post('/api/v1/categories')
        .set('Authorization', bearer(beta.accessToken))
        .send({ name: 'تصنيف بيتا' })
        .expect(201);

      await ctx
        .http()
        .patch(`/api/v1/products/${alphaProductId}`)
        .set('Authorization', bearer(alpha.accessToken))
        .send({ categoryId: betaCategory.body.data.id })
        .expect(400);
    });
  });

  it('keeps audit trails separate', async () => {
    const response = await ctx
      .http()
      .get('/api/v1/audit-logs')
      .set('Authorization', bearer(alpha.accessToken))
      .expect(200);

    const companyIds: string[] = response.body.data.items.map(
      (log: { companyId: string }) => log.companyId,
    );

    expect(companyIds.length).toBeGreaterThan(0);
    expect(new Set(companyIds)).toEqual(new Set([alpha.companyId]));
  });
});
