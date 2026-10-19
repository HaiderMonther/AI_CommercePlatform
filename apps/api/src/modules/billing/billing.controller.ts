import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { PlatformAdminOnly, RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { BillingService } from './billing.service';
import {
  CancelSubscriptionDto,
  ChangePlanDto,
  QueryCompaniesDto,
  QueryInvoicesDto,
  UpdateCompanyStatusDto,
  UpdateCompanySubscriptionDto,
} from './dto/billing.dto';
import { PlatformService } from './platform.service';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('status')
  @ResponseMessage('تم جلب حالة الاشتراك')
  @ApiOperation({ summary: 'حالة الاشتراك المختصرة لشريط التنبيه، لكل الأعضاء' })
  status() {
    return this.billing.status();
  }

  @Get('plans')
  @RequirePermissions(PERMISSIONS.BILLING_READ)
  @ResponseMessage('تم جلب الباقات')
  plans() {
    return this.billing.plans();
  }

  @Get('subscription')
  @RequirePermissions(PERMISSIONS.BILLING_READ)
  @ResponseMessage('تم جلب الاشتراك')
  @ApiOperation({ summary: 'الاشتراك الحالي، الاستخدام مقابل حدود الباقة، والباقات المتاحة' })
  overview() {
    return this.billing.overview();
  }

  @Post('subscription/change')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  @ResponseMessage('تم تغيير الباقة')
  @ApiOperation({
    summary: 'تغيير الباقة فوراً',
    description:
      'التخفيض يُرفض إن تجاوز ما لدى المتجر حدود الباقة الجديدة. الاشتراك المنتهي يبدأ فترة جديدة بفاتورة.',
  })
  changePlan(@Body() dto: ChangePlanDto) {
    return this.billing.changePlan(dto.tier);
  }

  @Post('subscription/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.BILLING_MANAGE)
  @ResponseMessage('تم تحديث التجديد')
  @ApiOperation({ summary: 'إيقاف التجديد بنهاية الفترة أو التراجع عنه' })
  cancel(@Body() dto: CancelSubscriptionDto) {
    return this.billing.setCancelAtPeriodEnd(dto.cancel);
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.BILLING_READ)
  @ResponseMessage('تم جلب الفواتير')
  invoices() {
    return this.billing.invoices();
  }
}

/** The platform team's controls over every store. */
@ApiTags('Platform')
@ApiBearerAuth()
@PlatformAdminOnly()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('companies')
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES_READ)
  @ResponseMessage('تم جلب الشركات')
  companies(@Query() query: QueryCompaniesDto) {
    return this.platform.companies(query);
  }

  @Get('companies/:id')
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES_READ)
  @ResponseMessage('تم جلب الشركة')
  company(@Param('id') id: string) {
    return this.platform.company(id);
  }

  @Patch('companies/:id/status')
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES_MANAGE)
  @ResponseMessage('تم تحديث حالة الشركة')
  @ApiOperation({ summary: 'إيقاف شركة (يمنع دخول أعضائها) أو إعادة تفعيلها' })
  setStatus(@Param('id') id: string, @Body() dto: UpdateCompanyStatusDto) {
    return this.platform.setCompanyStatus(id, dto.status);
  }

  @Patch('companies/:id/subscription')
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES_MANAGE)
  @ResponseMessage('تم تحديث اشتراك الشركة')
  @ApiOperation({ summary: 'تغيير الباقة دون فحص التخفيض و/أو تمديد الفترة' })
  updateSubscription(@Param('id') id: string, @Body() dto: UpdateCompanySubscriptionDto) {
    return this.platform.updateSubscription(id, dto);
  }

  @Get('invoices')
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES_READ)
  @ResponseMessage('تم جلب الفواتير')
  invoices(@Query() query: QueryInvoicesDto) {
    return this.platform.invoices(query);
  }

  @Post('invoices/:id/pay')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES_MANAGE)
  @ResponseMessage('تم تسجيل الدفع')
  @ApiOperation({ summary: 'تسجيل دفعة استُلمت خارج المنصة (تحويل، زين كاش، FIB…)' })
  markPaid(@Param('id') id: string) {
    return this.platform.markInvoicePaid(id);
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.PLATFORM_COMPANIES_MANAGE)
  @ResponseMessage('تم إلغاء الفاتورة')
  voidInvoice(@Param('id') id: string) {
    return this.platform.voidInvoice(id);
  }
}
