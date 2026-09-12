import { Global, Module } from '@nestjs/common';
import { TenantContextService } from '../context/tenant-context.service';
import { PrismaService } from './prisma.service';
import { TENANT_PRISMA, extendWithTenantScope } from './tenant-prisma.provider';

@Global()
@Module({
  providers: [
    PrismaService,
    TenantContextService,
    {
      provide: TENANT_PRISMA,
      useFactory: (prisma: PrismaService, context: TenantContextService) =>
        extendWithTenantScope(prisma, context),
      inject: [PrismaService, TenantContextService],
    },
  ],
  exports: [PrismaService, TenantContextService, TENANT_PRISMA],
})
export class PrismaModule {}
