import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@common/decorators/public.decorator';
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
  check() {
    return this.healthService.check();
  }

  @Public()
  @Get('live')
  @ResponseMessage('الخدمة تعمل')
  @ApiOperation({ summary: 'فحص حياة الحاوية (liveness probe)' })
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }
}
