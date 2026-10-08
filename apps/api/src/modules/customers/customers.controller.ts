import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomersDto } from './dto/query-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_READ)
  @ResponseMessage('تم جلب الزبائن')
  @ApiOperation({ summary: 'قائمة الزبائن مع البحث والمرشّحات' })
  @ApiOkResponse({ description: 'قائمة مقسمة بالصفحات' })
  findAll(@Query() query: QueryCustomersDto) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_READ)
  @ResponseMessage('تم جلب الزبون')
  @ApiOperation({ summary: 'ملف الزبون مع هوياته على القنوات وآخر محادثاته' })
  findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_CREATE)
  @ResponseMessage('تم إضافة الزبون')
  @ApiOperation({
    summary: 'إضافة زبون',
    description: 'رقم الهاتف يُوحَّد إلى الصيغة الدولية ويجب أن يكون فريداً داخل الشركة.',
  })
  create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_UPDATE)
  @ResponseMessage('تم تحديث الزبون')
  @ApiOperation({ summary: 'تعديل بيانات زبون أو حالته' })
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customersService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_DELETE)
  @ResponseMessage('تم حذف الزبون')
  @ApiOperation({ summary: 'حذف زبون (حذف ناعم يُبقي طلباته ومحادثاته ويحرّر رقمه)' })
  async remove(@Param('id') id: string) {
    await this.customersService.remove(id);
    return null;
  }
}
