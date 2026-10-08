import { MiddlewareConsumer, Module, NestModule, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ClsModule, ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { Request } from 'express';
import configuration from '@common/config/configuration';
import { validateEnv } from '@common/config/env.validation';
import { AppClsStore, CLS_KEYS } from '@common/context/request-context';
import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@common/guards/permissions.guard';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';
import { PrismaModule } from '@common/prisma/prisma.module';
import { AuditModule } from '@modules/audit/audit.module';
import { AuthModule } from '@modules/auth/auth.module';
import { CategoriesModule } from '@modules/categories/categories.module';
import { CompaniesModule } from '@modules/companies/companies.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { HealthModule } from '@modules/health/health.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { PermissionsModule } from '@modules/permissions/permissions.module';
import { ProductsModule } from '@modules/products/products.module';
import { RealtimeModule } from '@modules/realtime/realtime.module';
import { RolesModule } from '@modules/roles/roles.module';
import { UsersModule } from '@modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      cache: true,
      // Lets .env compose DATABASE_URL from DB_HOST, DB_USERNAME… (Prisma expands it too).
      expandVariables: true,
    }),
    // Request context: every request gets a correlation id that flows into logs,
    // audit entries and the tenant-scoped Prisma client.
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) => (req.headers['x-correlation-id'] as string) ?? randomUUID(),
        setup: (rawCls, req: Request) => {
          const cls = rawCls as unknown as ClsService<AppClsStore>;
          cls.set(CLS_KEYS.CORRELATION_ID, cls.getId());
          cls.set(CLS_KEYS.IP_ADDRESS, req.ip);
          cls.set(CLS_KEYS.USER_AGENT, req.get('user-agent') ?? undefined);
        },
      },
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: (config.get<number>('throttle.ttlSeconds') ?? 60) * 1000,
            limit: config.get<number>('throttle.limit') ?? 120,
          },
          {
            name: 'auth',
            ttl: 60_000,
            limit: config.get<number>('throttle.authLimit') ?? 10,
          },
        ],
      }),
    }),
    PrismaModule,
    AuditModule,
    HealthModule,
    AuthModule,
    CompaniesModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    CategoriesModule,
    ProductsModule,
    InventoryModule,
    RealtimeModule,
    CustomersModule,
    ConversationsModule,
    MessagesModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          // Rejecting unknown properties is what closes off mass-assignment attacks.
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: false },
        }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(_consumer: MiddlewareConsumer): void {
    // ClsModule mounts its own middleware; kept for future request-scoped middleware.
  }
}
