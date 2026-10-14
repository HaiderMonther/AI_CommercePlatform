import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { AiSettingsService } from './ai-settings.service';
import { TestAiDto, UpdateAiConfigDto } from './dto/ai-config.dto';

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly settings: AiSettingsService) {}

  @Get('config')
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_READ)
  @ResponseMessage('تم جلب إعدادات المساعد الذكي')
  @ApiOperation({ summary: 'إعدادات المساعد الذكي للشركة والنماذج المتاحة' })
  getConfig() {
    return this.settings.get();
  }

  @Patch('config')
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_UPDATE)
  @ResponseMessage('تم حفظ إعدادات المساعد الذكي')
  updateConfig(@Body() dto: UpdateAiConfigDto) {
    return this.settings.update(dto);
  }

  @Post('test')
  @HttpCode(200)
  // Each call spends tokens; a generous limit for trying things out, not a free API.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(PERMISSIONS.AI_SETTINGS_UPDATE)
  @ResponseMessage('تمت تجربة المساعد')
  @ApiOperation({
    summary: 'تجربة المساعد على رسالة بالإعدادات الحالية',
    description: 'يبحث في الكتالوج فعلياً، لكن لا يُنشئ طلبات ولا يحوّل محادثات.',
  })
  test(@Body() dto: TestAiDto) {
    return this.settings.test(dto);
  }
}
