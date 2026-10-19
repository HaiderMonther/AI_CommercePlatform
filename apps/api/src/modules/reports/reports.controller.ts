import { Controller, Get, Header, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { DashboardService } from './dashboard.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('sales')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ResponseMessage('تم جلب تقرير المبيعات')
  @ApiOperation({
    summary: 'المبيعات: الإجماليات، السلسلة اليومية، والتوزيع حسب الحالة والمصدر والدفع والمدينة',
  })
  async sales(@Query() query: ReportQueryDto) {
    return this.reports.sales(await this.reports.range(query));
  }

  @Get('products')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ResponseMessage('تم جلب تقرير المنتجات')
  @ApiOperation({ summary: 'الأكثر مبيعاً بالإيراد وبالكمية' })
  async products(@Query() query: ReportQueryDto) {
    return this.reports.products(await this.reports.range(query));
  }

  @Get('conversations')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ResponseMessage('تم جلب تقرير المحادثات')
  async conversations(@Query() query: ReportQueryDto) {
    return this.reports.conversations(await this.reports.range(query));
  }

  @Get('ai')
  @RequirePermissions(PERMISSIONS.REPORTS_READ)
  @ResponseMessage('تم جلب تقرير المساعد الذكي')
  @ApiOperation({ summary: 'نشاط المساعد: الردود، التحويلات، الطلبات، الرموز، ونسبة الأتمتة' })
  async ai(@Query() query: ReportQueryDto) {
    return this.reports.ai(await this.reports.range(query));
  }

  @Get('orders/export')
  @RequirePermissions(PERMISSIONS.REPORTS_READ, PERMISSIONS.ORDERS_READ)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'تصدير طلبات الفترة إلى CSV (يفتح في Excel)' })
  async exportOrders(@Query() query: ReportQueryDto): Promise<StreamableFile> {
    const range = await this.reports.range(query);
    const csv = await this.reports.ordersCsv(range);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="orders-${range.from}-to-${range.to}.csv"`,
    });
  }
}

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ResponseMessage('تم جلب ملخص لوحة التحكم')
  @ApiOperation({
    summary: 'أرقام الصفحة الرئيسية',
    description: 'كل قسم يُرجع فقط لمن يملك صلاحيته، وإلا يكون null.',
  })
  summary() {
    return this.dashboard.summary();
  }
}
