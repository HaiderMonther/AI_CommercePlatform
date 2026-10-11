import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import {
  CreateOrderDto,
  QueryOrdersDto,
  ReplaceOrderItemsDto,
  UpdateOrderDto,
  UpdateOrderPaymentDto,
  UpdateOrderStatusDto,
} from './dto/order.dto';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  @ResponseMessage('تم جلب الطلبات')
  @ApiOperation({ summary: 'قائمة الطلبات مع البحث والمرشّحات' })
  @ApiOkResponse({ description: 'قائمة مقسمة بالصفحات' })
  findAll(@Query() query: QueryOrdersDto) {
    return this.ordersService.findAll(query);
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  @ResponseMessage('تم جلب عدادات الطلبات')
  @ApiOperation({ summary: 'عدد الطلبات لكل حالة' })
  stats() {
    return this.ordersService.stats();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ORDERS_READ)
  @ResponseMessage('تم جلب الطلب')
  @ApiOperation({ summary: 'تفاصيل الطلب مع المنتجات وسجل الحالات والانتقالات المسموحة' })
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.ORDERS_CREATE)
  @ResponseMessage('تم إنشاء الطلب')
  @ApiOperation({
    summary: 'إنشاء طلب',
    description:
      'يحجز كمية كل منتج في المعاملة نفسها؛ إن نقصت كمية أي منتج لا يُحفظ شيء. ' +
      'الزبون إما `customerId` أو `customer` (يُربط بزبون موجود بنفس الهاتف أو يُنشأ).',
  })
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ORDERS_UPDATE)
  @ResponseMessage('تم تحديث الطلب')
  @ApiOperation({ summary: 'تعديل بيانات التوصيل والملاحظات والخصم وأجور التوصيل' })
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.ordersService.update(id, dto);
  }

  @Put(':id/items')
  @RequirePermissions(PERMISSIONS.ORDERS_UPDATE)
  @ResponseMessage('تم تحديث منتجات الطلب')
  @ApiOperation({
    summary: 'استبدال منتجات الطلب',
    description: 'مسموح للطلبات الجديدة والمؤكدة فقط. يُحجز أو يُفك حجز الفرق فقط.',
  })
  replaceItems(@Param('id') id: string, @Body() dto: ReplaceOrderItemsDto) {
    return this.ordersService.replaceItems(id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.ORDERS_UPDATE)
  @ResponseMessage('تم تحديث حالة الطلب')
  @ApiOperation({
    summary: 'نقل الطلب في دورة حياته',
    description:
      'الشحن أو التسليم يحوّل الحجز إلى بيع، والإلغاء يفك الحجز أو يعيد البضاعة للمخزون.',
  })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.ordersService.updateStatus(id, dto);
  }

  @Patch(':id/payment')
  @RequirePermissions(PERMISSIONS.ORDERS_UPDATE)
  @ResponseMessage('تم تحديث الدفع')
  @ApiOperation({ summary: 'تسجيل المبلغ المستلم، وتُحسب حالة الدفع منه' })
  updatePayment(@Param('id') id: string, @Body() dto: UpdateOrderPaymentDto) {
    return this.ordersService.updatePayment(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ORDERS_DELETE)
  @ResponseMessage('تم حذف الطلب')
  @ApiOperation({ summary: 'حذف طلب ملغى' })
  async remove(@Param('id') id: string) {
    await this.ordersService.remove(id);
    return null;
  }
}
