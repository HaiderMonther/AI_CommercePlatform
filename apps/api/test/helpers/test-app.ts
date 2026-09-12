import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '@/app.module';
import TestAgent from 'supertest/lib/agent';
import { PrismaService } from '@common/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  http: () => TestAgent;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live'] });
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    http: () => request(app.getHttpServer()),
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
