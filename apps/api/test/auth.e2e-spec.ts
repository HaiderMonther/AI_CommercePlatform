import { INestApplication } from '@nestjs/common';
import { TestContext, bearer, createTestApp, registerTenant, resetTenantData } from './helpers/test-app';

describe('Authentication (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let tenant: Awaited<ReturnType<typeof registerTenant>>;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    await resetTenantData(ctx.prisma);
    tenant = await registerTenant(ctx, { companyName: 'متجر الاختبار', email: 'owner@test.iq' });
  });

  afterAll(async () => {
    await resetTenantData(ctx.prisma);
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('provisions the company, its system roles, AI config and a trial subscription', async () => {
      const [roles, aiConfig, subscription] = await Promise.all([
        ctx.prisma.role.findMany({ where: { companyId: tenant.companyId } }),
        ctx.prisma.aiConfig.findUnique({ where: { companyId: tenant.companyId } }),
        ctx.prisma.subscription.findFirst({ where: { companyId: tenant.companyId } }),
      ]);

      expect(roles.map((role) => role.key).sort()).toEqual(
        ['ADMIN', 'COMPANY_OWNER', 'MANAGER', 'SALES_AGENT', 'VIEWER'].sort(),
      );
      expect(aiConfig?.language).toBe('ar-IQ');
      expect(subscription?.status).toBe('TRIALING');
    });

    it('gives the owner the full tenant permission set', async () => {
      const response = await ctx
        .http()
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(tenant.accessToken))
        .expect(200);

      expect(response.body.data.user.roleKey).toBe('COMPANY_OWNER');
      expect(response.body.data.user.permissions).toContain('orders.create');
      expect(response.body.data.user.permissions).not.toContain('platform.companies.manage');
    });

    it('rejects a duplicate email', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/auth/register')
        .send({
          companyName: 'شركة أخرى',
          fullName: 'مستخدم آخر',
          email: 'owner@test.iq',
          password: 'Owner@12345',
        })
        .expect(409);

      expect(response.body.code).toBe('EMAIL_ALREADY_USED');
    });

    it('rejects a weak password', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/auth/register')
        .send({
          companyName: 'شركة ضعيفة',
          fullName: 'مستخدم',
          email: 'weak@test.iq',
          password: 'weak',
        })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects unknown fields instead of silently ignoring them', async () => {
      await ctx
        .http()
        .post('/api/v1/auth/register')
        .send({
          companyName: 'شركة',
          fullName: 'مستخدم',
          email: 'extra@test.iq',
          password: 'Owner@12345',
          isPlatformAdmin: true,
        })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('returns tokens and the company profile', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: tenant.email, password: tenant.password })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tokens.accessToken).toEqual(expect.any(String));
      expect(response.body.data.company.id).toBe(tenant.companyId);
    });

    it('returns the same error for a wrong password and an unknown email', async () => {
      const wrongPassword = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: tenant.email, password: 'Wrong@12345' })
        .expect(401);

      const unknownEmail = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@test.iq', password: 'Wrong@12345' })
        .expect(401);

      expect(wrongPassword.body.code).toBe('INVALID_CREDENTIALS');
      expect(unknownEmail.body.code).toBe('INVALID_CREDENTIALS');
      expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    });

    it('never returns the password hash', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: tenant.email, password: tenant.password })
        .expect(200);

      expect(JSON.stringify(response.body)).not.toContain('argon2');
      expect(response.body.data.user.passwordHash).toBeUndefined();
    });
  });

  describe('Protected routes', () => {
    it('rejects a request without a token', async () => {
      const response = await ctx.http().get('/api/v1/users').expect(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a forged token', async () => {
      await ctx
        .http()
        .get('/api/v1/users')
        .set('Authorization', 'Bearer not.a.real.token')
        .expect(401);
    });

    it('rejects a refresh token used as an access token', async () => {
      await ctx
        .http()
        .get('/api/v1/users')
        .set('Authorization', bearer(tenant.refreshToken))
        .expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      const login = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: tenant.email, password: tenant.password })
        .expect(200);

      const original = login.body.data.tokens.refreshToken;

      const refreshed = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: original })
        .expect(200);

      expect(refreshed.body.data.tokens.refreshToken).not.toBe(original);

      await ctx
        .http()
        .get('/api/v1/auth/me')
        .set('Authorization', bearer(refreshed.body.data.tokens.accessToken))
        .expect(200);
    });

    it('detects replay of a rotated token and kills the whole session family', async () => {
      const login = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: tenant.email, password: tenant.password })
        .expect(200);

      const first = login.body.data.tokens.refreshToken;

      const rotated = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(200);

      // Replaying the consumed token is the classic stolen-token signal.
      const replay = await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: first })
        .expect(401);

      expect(replay.body.code).toBe('REFRESH_TOKEN_REUSED');

      // ...and the token issued by the rotation is revoked along with it.
      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: rotated.body.data.tokens.refreshToken })
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('invalidates the presented refresh token', async () => {
      const login = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: tenant.email, password: tenant.password })
        .expect(200);

      const { accessToken, refreshToken } = login.body.data.tokens;

      await ctx
        .http()
        .post('/api/v1/auth/logout')
        .set('Authorization', bearer(accessToken))
        .send({ refreshToken })
        .expect(200);

      await ctx.http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    });
  });

  describe('POST /auth/change-password', () => {
    it('rejects a wrong current password', async () => {
      const response = await ctx
        .http()
        .post('/api/v1/auth/change-password')
        .set('Authorization', bearer(tenant.accessToken))
        .send({ currentPassword: 'Nope@12345', newPassword: 'Brand@12345' })
        .expect(401);

      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('changes the password and revokes every existing session', async () => {
      const login = await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: tenant.email, password: tenant.password })
        .expect(200);

      await ctx
        .http()
        .post('/api/v1/auth/change-password')
        .set('Authorization', bearer(login.body.data.tokens.accessToken))
        .send({ currentPassword: tenant.password, newPassword: 'Brand@12345' })
        .expect(200);

      await ctx
        .http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.data.tokens.refreshToken })
        .expect(401);

      await ctx
        .http()
        .post('/api/v1/auth/login')
        .send({ email: tenant.email, password: 'Brand@12345' })
        .expect(200);

      tenant.password = 'Brand@12345';
    });
  });

  describe('GET /health', () => {
    it('reports database connectivity without authentication', async () => {
      const response = await ctx.http().get('/health').expect(200);
      expect(response.body.data.checks.database.status).toBe('up');
    });
  });
});
