import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto, UpdateVariantDto } from './dto/variant.dto';
import { ProductsService } from './products.service';
import { VariantsService } from './variants.service';

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly variantsService: VariantsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ResponseMessage('تم جلب المنتجات')
  @ApiOperation({ summary: 'قائمة المنتجات مع البحث والمرشّحات' })
  @ApiOkResponse({ description: 'قائمة مقسمة بالصفحات' })
  findAll(@Query() query: QueryProductsDto) {
    return this.productsService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ResponseMessage('تم جلب المنتج')
  @ApiOperation({ summary: 'تفاصيل منتج مع صوره ومتغيراته' })
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.PRODUCTS_CREATE)
  @ResponseMessage('تم إنشاء المنتج')
  @ApiOperation({
    summary: 'إضافة منتج جديد',
    description: 'الكمية الابتدائية تُسجَّل كحركة إدخال مخزون ضمن نفس المعاملة.',
  })
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ResponseMessage('تم تحديث المنتج')
  @ApiOperation({
    summary: 'تعديل منتج',
    description: 'لا يمكن تعديل الكمية من هنا، استخدم POST /inventory/adjust.',
  })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.PRODUCTS_DELETE)
  @ResponseMessage('تم حذف المنتج')
  @ApiOperation({ summary: 'حذف منتج (حذف ناعم يحرّر رمز المنتج)' })
  async remove(@Param('id') id: string) {
    await this.productsService.remove(id);
    return null;
  }

  // --- Variants -------------------------------------------------------------

  @Get(':id/variants')
  @RequirePermissions(PERMISSIONS.PRODUCTS_READ)
  @ResponseMessage('تم جلب المتغيرات')
  @ApiOperation({ summary: 'متغيرات المنتج' })
  @ApiParam({ name: 'id', description: 'معرف المنتج' })
  findVariants(@Param('id') productId: string) {
    return this.variantsService.findAll(productId);
  }

  @Post(':id/variants')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ResponseMessage('تم إنشاء المتغير')
  @ApiOperation({
    summary: 'إضافة متغير (لون/مقاس)',
    description: 'أول متغير يحوّل المنتج إلى منتج بمتغيرات، ويصبح مخزونه مجموع متغيراته.',
  })
  createVariant(@Param('id') productId: string, @Body() dto: CreateVariantDto) {
    return this.variantsService.create(productId, dto);
  }

  @Patch(':id/variants/:variantId')
  @RequirePermissions(PERMISSIONS.PRODUCTS_UPDATE)
  @ResponseMessage('تم تحديث المتغير')
  @ApiOperation({ summary: 'تعديل متغير' })
  updateVariant(
    @Param('id') productId: string,
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.variantsService.update(productId, variantId, dto);
  }

  @Delete(':id/variants/:variantId')
  @RequirePermissions(PERMISSIONS.PRODUCTS_DELETE)
  @ResponseMessage('تم حذف المتغير')
  @ApiOperation({ summary: 'حذف متغير غير محجوز ضمن طلبات' })
  async removeVariant(@Param('id') productId: string, @Param('variantId') variantId: string) {
    await this.variantsService.remove(productId, variantId);
    return null;
  }
}
