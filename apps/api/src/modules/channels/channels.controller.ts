import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ChannelsService } from './channels.service';
import { CreateChannelDto, UpdateChannelDto } from './dto/channel.dto';

@ApiTags('Channels')
@ApiBearerAuth()
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CHANNELS_READ)
  @ResponseMessage('تم جلب القنوات')
  @ApiOperation({ summary: 'قنوات الشركة وحالة اتصال كل منها (بدون رموز الوصول)' })
  findAll() {
    return this.channelsService.findAll();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CHANNELS_READ)
  @ResponseMessage('تم جلب القناة')
  findOne(@Param('id') id: string) {
    return this.channelsService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CHANNELS_MANAGE)
  @ResponseMessage('تمت إضافة القناة')
  @ApiOperation({
    summary: 'ربط حساب واتساب أو صفحة فيسبوك أو حساب إنستغرام',
    description: 'يُشفَّر رمز الوصول ويُتحقق منه لدى Meta فوراً؛ النتيجة في `status` و`lastError`.',
  })
  create(@Body() dto: CreateChannelDto) {
    return this.channelsService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CHANNELS_MANAGE)
  @ResponseMessage('تم تحديث القناة')
  update(@Param('id') id: string, @Body() dto: UpdateChannelDto) {
    return this.channelsService.update(id, dto);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CHANNELS_MANAGE)
  @ResponseMessage('تم فحص الاتصال')
  @ApiOperation({ summary: 'إعادة فحص رمز الوصول لدى Meta' })
  verify(@Param('id') id: string) {
    return this.channelsService.verify(id);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CHANNELS_MANAGE)
  @ResponseMessage('تم حذف القناة')
  async remove(@Param('id') id: string) {
    await this.channelsService.remove(id);
    return null;
  }
}
