import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { QueryCategoriesDto } from './dto/query-categories.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('Categories')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CATEGORIES_READ)
  @ResponseMessage('تم جلب التصنيفات')
  @ApiOperation({ summary: 'قائمة التصنيفات، مسطّحة أو كشجرة' })
  @ApiQuery({ name: 'tree', required: false, description: 'إرجاع الشجرة متداخلة' })
  @ApiOkResponse({ description: 'تصنيفات الشركة مرتبة حسب الترتيب ثم الاسم' })
  findAll(@Query() query: QueryCategoriesDto) {
    return this.categoriesService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_READ)
  @ResponseMessage('تم جلب التصنيف')
  @ApiOperation({ summary: 'تفاصيل تصنيف' })
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATEGORIES_CREATE)
  @ResponseMessage('تم إنشاء التصنيف')
  @ApiOperation({ summary: 'إضافة تصنيف جديد' })
  create(@Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_UPDATE)
  @ResponseMessage('تم تحديث التصنيف')
  @ApiOperation({ summary: 'تعديل تصنيف أو نقله تحت تصنيف آخر' })
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categoriesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_DELETE)
  @ResponseMessage('تم حذف التصنيف')
  @ApiOperation({ summary: 'حذف تصنيف فارغ (بدون منتجات أو فروع)' })
  async remove(@Param('id') id: string) {
    await this.categoriesService.remove(id);
    return null;
  }
}
