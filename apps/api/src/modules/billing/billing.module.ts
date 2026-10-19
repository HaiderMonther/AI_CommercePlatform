import { Global, Module } from '@nestjs/common';
import { BillingController, PlatformController } from './billing.controller';
import { BillingService } from './billing.service';
import { EntitlementsService } from './entitlements.service';
import { PlatformService } from './platform.service';

/** Global: users, products, channels and the AI agent all check the plan before acting. */
@Global()
@Module({
  controllers: [BillingController, PlatformController],
  providers: [EntitlementsService, BillingService, PlatformService],
  exports: [EntitlementsService, BillingService],
})
export class BillingModule {}
