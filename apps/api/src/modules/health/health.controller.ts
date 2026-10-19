import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ERROR_CODE } from '@common/constants/error-codes.constant';
import { Public } from '@common/decorators/public.decorator';
import { AppException } from '@common/exceptions/app.exception';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ResponseMessage('الخدمة تعمل')
  @ApiOperation({ summary: 'فحص جاهزية الخدمة وقاعدة البيانات' })
  @ApiOkResponse({ description: 'حالة الخدمة ومكوناتها' })
  async check() {
    const report = await this.healthService.check();
    // A load balancer reads the status code, not the body: 503 takes the instance out.
    if (report.status !== 'ok') {
      throw new AppException(
        ERROR_CODE.SERVICE_UNAVAILABLE,
        'الخدمة غير جاهزة',
        HttpStatus.SERVICE_UNAVAILABLE,
        report,
      );
    }
    return report;
  }

  @Public()
  @Get('live')
  @ResponseMessage('الخدمة تعمل')
  @ApiOperation({ summary: 'فحص حياة الحاوية (liveness probe)' })
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }
}
