import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '@/app.module';
import TestAgent from 'supertest/lib/agent';
import { PrismaService } from '@common/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: () => TestAgent;
}

export interface TestAppOptions {
  /** Swap providers before compiling, e.g. the Graph API client for a fake. */
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  const moduleRef = await (options.configure ? options.configure(builder) : builder).compile();

  // rawBody: webhook signatures are checked against the exact bytes, as in main.ts.
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live'] });
  await app.init();

  // Bind the server once up front and reuse a single agent. Building a fresh agent per
  // call makes supertest start listening on demand, and a Promise.all of parallel
  // requests then races to bind, surfacing as ECONNRESET instead of a real response.
  const server = app.getHttpServer() as Server;
  if (!server.listening) {
    await new Promise<void>((resolve) => server.listen(0, resolve));
  }

  const agent = request(server);

  return {
    app,
    prisma: app.get(PrismaService),
    http: () => agent,
  };
}

/** Wipes tenant data between suites while keeping reference data (permissions, plans). */
export async function resetTenantData(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      audit_logs, notifications, usage_records, invoices, subscriptions,
      order_status_history, order_items, orders,
      ai_interactions, ai_configs,
      messages, conversations, webhook_events, channel_connections,
      customer_identities, customers,
      inventory_movements, product_variants, product_images, products, categories,
      refresh_tokens, role_permissions, roles, users, companies
    RESTART IDENTITY CASCADE
  `);
}

export interface RegisteredTenant {
  companyId: string;
  ownerId: string;
  accessToken: string;
  refreshToken: string;
  email: string;
  password: string;
}

export async function registerTenant(
  ctx: TestContext,
  overrides: { companyName: string; email: string; fullName?: string; password?: string },
): Promise<RegisteredTenant> {
  const password = overrides.password ?? 'Owner@12345';

  const response = await ctx
    .http()
    .post('/api/v1/auth/register')
    .send({
      companyName: overrides.companyName,
      fullName: overrides.fullName ?? 'مالك الشركة',
      email: overrides.email,
      password,
    })
    .expect(201);

  const body = response.body.data;

  return {
    companyId: body.company.id,
    ownerId: body.user.id,
    accessToken: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
    email: overrides.email,
    password,
  };
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

/** Polls until `check` returns a value, for work that finishes after the response. */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  { timeoutMs = 5000, intervalMs = 50 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Moves a test tenant to a bigger plan, for suites that need more than the trial allows
 * (BASIC: 3 users, 1 channel). Plans come from the reference seed.
 */
export async function setTenantPlan(
  prisma: PrismaClient,
  companyId: string,
  tier: 'BASIC' | 'BUSINESS' | 'ENTERPRISE',
): Promise<void> {
  const plan = await prisma.plan.findUniqueOrThrow({ where: { tier } });
  await prisma.subscription.updateMany({ where: { companyId }, data: { planId: plan.id } });
  await prisma.company.update({ where: { id: companyId }, data: { planTier: tier } });
}
