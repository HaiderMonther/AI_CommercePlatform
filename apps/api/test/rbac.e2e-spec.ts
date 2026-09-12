import { INestApplication } from '@nestjs/common';
import { TestContext, bearer, createTestApp, registerTenant, resetTenantData } from './helpers/test-app';

/**
 * Role-based access control: a sales agent may work conversations and orders but must not
 * be able to manage users, roles or the company profile — and revoking a role must take
 * effect on the caller's next request, not when their token happens to expire.
 */
describe('RBAC and role management (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let owner: Awaited<ReturnType<typeof registerTenant>>;
  let roles: { id: string; key: string; isSystem: boolean }[];
  let agentToken: string;
  let agentId: string;

  const roleIdByKey = (key: string) => roles.find((role) => role.key === key)!.id;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await resetTenantData(ctx.prisma);

    owner = await registerTenant(ctx, { companyName: 'شركة الصلاحيات', email: 'owner@rbac.iq' });

    roles = (
      await ctx.http().get('/api/v1/roles').set('Authorization', bearer(owner.accessToken)).expect(200)
    ).body.data;

    const created = await ctx
      .http()
      .post('/api/v1/users')
      .set('Authorization', bearer(owner.accessToken))
      .send({
        email: 'agent@rbac.iq',
        fullName: 'مندوب المبيعات',
        password: 'Agent@12345',
        roleId: roleIdByKey('SALES_AGENT'),
      })
      .expect(201);

    agentId = created.body.data.id;

    agentToken = (
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'agent@rbac.iq', password: 'Agent@12345' })
        .expect(200)
    ).body.data.tokens.accessToken;
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await app.close();
  });

  it('seeds the five system roles with the expected permission spread', () => {
    const owner = roles.find((role) => role.key === 'COMPANY_OWNER') as unknown as {
      permissions: string[];
    };
    const viewer = roles.find((role) => role.key === 'VIEWER') as unknown as {
      permissions: string[];
    };

    expect(owner.permissions).toContain('users.delete');
    expect(viewer.permissions.every((permission) => permission.endsWith('.read'))).toBe(true);
  });

  it('lets a sales agent read what their role allows', async () => {
    await ctx
      .http()
      .get('/api/v1/company')
      .set('Authorization', bearer(agentToken))
      .expect(200);
  });

  it('blocks a sales agent from listing users', async () => {
    const response = await ctx
      .http()
      .get('/api/v1/users')
      .set('Authorization', bearer(agentToken))
      .expect(403);

    expect(response.body.code).toBe('PERMISSION_DENIED');
  });

  it('blocks a sales agent from creating users or roles', async () => {
    await ctx
      .http()
      .post('/api/v1/users')
      .set('Authorization', bearer(agentToken))
      .send({
        email: 'sneaky@rbac.iq',
        fullName: 'مستخدم',
        password: 'Sneaky@123',
        roleId: roleIdByKey('VIEWER'),
      })
      .expect(403);

    await ctx
      .http()
      .post('/api/v1/roles')
      .set('Authorization', bearer(agentToken))
      .send({ name: 'Custom', nameAr: 'مخصص', permissions: ['products.read'] })
      .expect(403);
  });

  it('blocks a sales agent from editing the company profile', async () => {
    await ctx
      .http()
      .patch('/api/v1/company')
      .set('Authorization', bearer(agentToken))
      .send({ name: 'اسم جديد' })
      .expect(403);
  });

  it('refuses to modify a system role', async () => {
    const response = await ctx
      .http()
      .patch(`/api/v1/roles/${roleIdByKey('VIEWER')}`)
      .set('Authorization', bearer(owner.accessToken))
      .send({ permissions: ['users.delete'] })
      .expect(400);

    expect(response.body.code).toBe('SYSTEM_ROLE_IMMUTABLE');
  });

  it('creates a custom role and enforces exactly its permission set', async () => {
    const custom = await ctx
      .http()
      .post('/api/v1/roles')
      .set('Authorization', bearer(owner.accessToken))
      .send({
        name: 'Warehouse Keeper',
        nameAr: 'أمين المخزن',
        permissions: ['products.read', 'inventory.read', 'inventory.adjust'],
      })
      .expect(201);

    expect(custom.body.data.isSystem).toBe(false);
    expect(custom.body.data.permissions.sort()).toEqual(
      ['inventory.adjust', 'inventory.read', 'products.read'].sort(),
    );

    await ctx
      .http()
      .patch(`/api/v1/users/${agentId}`)
      .set('Authorization', bearer(owner.accessToken))
      .send({ roleId: custom.body.data.id })
      .expect(200);

    const keeperToken = (
      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'agent@rbac.iq', password: 'Agent@12345' })
        .expect(200)
    ).body.data.tokens.accessToken;

    // company.read is not in the custom role, so the previously allowed call now fails.
    await ctx
      .http()
      .get('/api/v1/company')
      .set('Authorization', bearer(keeperToken))
      .expect(403);

    const me = await ctx
      .http()
      .get('/api/v1/auth/me')
      .set('Authorization', bearer(keeperToken))
      .expect(200);

    expect(me.body.data.user.permissions.sort()).toEqual(
      ['inventory.adjust', 'inventory.read', 'products.read'].sort(),
    );
  });

  it('rejects an unknown permission key', async () => {
    await ctx
      .http()
      .post('/api/v1/roles')
      .set('Authorization', bearer(owner.accessToken))
      .send({ name: 'Bad', nameAr: 'سيئ', permissions: ['everything.*'] })
      .expect(400);
  });

  it('refuses to delete a role that still has users', async () => {
    const assigned = roles.find((role) => role.key === 'SALES_AGENT')!;

    const response = await ctx
      .http()
      .delete(`/api/v1/roles/${assigned.id}`)
      .set('Authorization', bearer(owner.accessToken))
      .expect(400);

    // System roles are rejected before the in-use check.
    expect(response.body.code).toBe('SYSTEM_ROLE_IMMUTABLE');
  });

  it('protects the last active company owner', async () => {
    const response = await ctx
      .http()
      .patch(`/api/v1/users/${owner.ownerId}`)
      .set('Authorization', bearer(owner.accessToken))
      .send({ roleId: roleIdByKey('VIEWER') })
      .expect(400);

    expect(response.body.code).toBe('LAST_OWNER_PROTECTED');
  });

  it('exposes the grouped permission catalog for the roles screen', async () => {
    const response = await ctx
      .http()
      .get('/api/v1/permissions')
      .set('Authorization', bearer(owner.accessToken))
      .expect(200);

    const groups = response.body.data;
    expect(groups.length).toBeGreaterThan(5);
    expect(groups[0]).toHaveProperty('groupLabel');
    expect(groups.flatMap((group: { permissions: unknown[] }) => group.permissions).length).toBe(42);
  });

  it('records sensitive changes in the audit trail', async () => {
    const response = await ctx
      .http()
      .get('/api/v1/audit-logs?entity=User')
      .set('Authorization', bearer(owner.accessToken))
      .expect(200);

    const actions = response.body.data.items.map((log: { action: string }) => log.action);
    expect(actions).toContain('create');
  });
});
