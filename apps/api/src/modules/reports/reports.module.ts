import { Module } from '@nestjs/common';
import { AiModule } from '@modules/ai/ai.module';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { DashboardService } from './dashboard.service';
import { DashboardController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [InventoryModule, AiModule],
  controllers: [ReportsController, DashboardController],
  providers: [ReportsService, DashboardService],
})
export class ReportsModule {}
