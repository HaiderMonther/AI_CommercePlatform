import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ConversationsService } from './conversations.service';
import {
  AssignConversationDto,
  CreateConversationDto,
  QueryConversationsDto,
  UpdateConversationModeDto,
  UpdateConversationStatusDto,
} from './dto/conversation.dto';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_READ)
  @ResponseMessage('تم جلب المحادثات')
  @ApiOperation({ summary: 'صندوق المحادثات، مرتبة بآخر رسالة' })
  @ApiOkResponse({ description: 'قائمة مقسمة بالصفحات، كل عنصر مع آخر رسالة' })
  findAll(@Query() query: QueryConversationsDto) {
    return this.conversationsService.findAll(query);
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_READ)
  @ResponseMessage('تم جلب إحصاءات المحادثات')
  @ApiOperation({ summary: 'عدادات تبويبات صندوق المحادثات' })
  stats() {
    return this.conversationsService.stats();
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_READ)
  @ResponseMessage('تم جلب المحادثة')
  @ApiOperation({ summary: 'تفاصيل محادثة مع ملف الزبون' })
  findOne(@Param('id') id: string) {
    return this.conversationsService.findOne(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_REPLY)
  @ResponseMessage('تم فتح المحادثة')
  @ApiOperation({
    summary: 'بدء محادثة مع زبون',
    description:
      'تُفتح بوضع HUMAN ومسندة لمنشئها. إن وُجدت محادثة نشطة للزبون على القناة نفسها تُعاد هي.',
  })
  create(@Body() dto: CreateConversationDto) {
    return this.conversationsService.create(dto);
  }

  @Patch(':id/assign')
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_ASSIGN)
  @ResponseMessage('تم تحديث إسناد المحادثة')
  @ApiOperation({ summary: 'إسناد المحادثة لموظف أو إلغاء الإسناد' })
  assign(@Param('id') id: string, @Body() dto: AssignConversationDto) {
    return this.conversationsService.assign(id, dto.userId);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_CLOSE)
  @ResponseMessage('تم تحديث حالة المحادثة')
  @ApiOperation({
    summary: 'تغيير حالة المحادثة',
    description: 'RESOLVED تُعاد فتحها برسالة الزبون التالية، أما CLOSED فنهائية.',
  })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateConversationStatusDto) {
    return this.conversationsService.updateStatus(id, dto.status);
  }

  @Patch(':id/mode')
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_REPLY)
  @ResponseMessage('تم تحديث وضع المحادثة')
  @ApiOperation({
    summary: 'تولّي المحادثة من المساعد الذكي أو إعادتها له',
    description: 'HUMAN يوقف الرد الآلي فوراً، AI يعيده.',
  })
  setMode(@Param('id') id: string, @Body() dto: UpdateConversationModeDto) {
    return this.conversationsService.setMode(id, dto);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_READ)
  @ResponseMessage('تم تعليم المحادثة كمقروءة')
  @ApiOperation({ summary: 'تصفير عداد الرسائل غير المقروءة' })
  markRead(@Param('id') id: string) {
    return this.conversationsService.markRead(id);
  }
}
