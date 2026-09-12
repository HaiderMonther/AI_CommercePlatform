import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { CompaniesService } from './companies.service';
import { UpdateCompanyDto } from './dto/update-company.dto';

@ApiTags('Companies')
@ApiBearerAuth()
@Controller('company')
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.COMPANY_READ)
  @ResponseMessage('تم جلب بيانات الشركة')
  @ApiOperation({ summary: 'بيانات الشركة الحالية' })
  @ApiOkResponse({ description: 'بيانات الشركة المرتبطة بالمستخدم الحالي' })
  getCurrent() {
    return this.companiesService.getCurrent();
  }

  @Patch()
  @RequirePermissions(PERMISSIONS.COMPANY_UPDATE)
  @ResponseMessage('تم تحديث بيانات الشركة')
  @ApiOperation({ summary: 'تعديل بيانات الشركة الحالية' })
  update(@Body() dto: UpdateCompanyDto) {
    return this.companiesService.updateCurrent(dto);
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.COMPANY_READ)
  @ResponseMessage('تم جلب إحصائيات الشركة')
  @ApiOperation({ summary: 'عدادات عامة عن محتوى الشركة' })
  getStats() {
    return this.companiesService.getStats();
  }
}
