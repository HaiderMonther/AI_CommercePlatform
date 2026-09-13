import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { QueryMovementsDto } from './dto/query-movements.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('movements')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ResponseMessage('تم جلب حركات المخزون')
  @ApiOperation({ summary: 'سجل حركات المخزون مع المرشّحات' })
  @ApiOkResponse({ description: 'قائمة مقسمة بالصفحات من الحركات' })
  findMovements(@Query() query: QueryMovementsDto) {
    return this.inventoryService.findMovements(query);
  }

  @Post('adjust')
  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @ResponseMessage('تم تحديث المخزون')
  @ApiOperation({
    summary: 'تعديل مخزون منتج أو متغير',
    description:
      'للإدخال والإخراج والإرجاع تمثل الكمية مقدار التغيير، وللجرد (ADJUSTMENT) تمثل الكمية النهائية.',
  })
  adjust(@Body() dto: AdjustStockDto) {
    return this.inventoryService.adjust(dto);
  }

  @Get('low-stock')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ResponseMessage('تم جلب المنتجات منخفضة المخزون')
  @ApiOperation({ summary: 'المنتجات التي وصلت حد إعادة الطلب' })
  findLowStock() {
    return this.inventoryService.findLowStock();
  }

  @Get('summary')
  @RequirePermissions(PERMISSIONS.INVENTORY_READ)
  @ResponseMessage('تم جلب ملخص المخزون')
  @ApiOperation({ summary: 'ملخص المخزون: الكميات والقيمة والنواقص' })
  getSummary() {
    return this.inventoryService.getSummary();
  }
}
