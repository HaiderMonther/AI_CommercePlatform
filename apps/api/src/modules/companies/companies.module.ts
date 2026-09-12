import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { CompanyProvisioningService } from './company-provisioning.service';

@Module({
  controllers: [CompaniesController],
  providers: [CompaniesService, CompanyProvisioningService],
  exports: [CompaniesService, CompanyProvisioningService],
})
export class CompaniesModule {}
