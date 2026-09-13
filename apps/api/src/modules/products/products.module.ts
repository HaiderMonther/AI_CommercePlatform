import { Module } from '@nestjs/common';
import { InventoryModule } from '@modules/inventory/inventory.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { VariantsService } from './variants.service';

@Module({
  imports: [InventoryModule],
  controllers: [ProductsController],
  providers: [ProductsService, VariantsService],
  exports: [ProductsService, VariantsService],
})
export class ProductsModule {}
