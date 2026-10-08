import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@common/constants/permissions.constant';
import { RequirePermissions } from '@common/decorators/permissions.decorator';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { QueryMessagesDto, SendMessageDto } from './dto/message.dto';
import { MessagesService } from './messages.service';

@ApiTags('Messages')
@ApiBearerAuth()
@ApiParam({ name: 'conversationId', description: 'معرف المحادثة' })
@Controller('conversations/:conversationId/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_READ)
  @ResponseMessage('تم جلب الرسائل')
  @ApiOperation({
    summary: 'رسائل المحادثة من الأقدم للأحدث',
    description: 'ترقيم بالمؤشر: مرّر `nextBefore` من الاستجابة كـ`before` لتحميل الأقدم.',
  })
  findAll(@Param('conversationId') conversationId: string, @Query() query: QueryMessagesDto) {
    return this.messagesService.list(conversationId, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CONVERSATIONS_REPLY)
  @ResponseMessage('تم إرسال الرسالة')
  @ApiOperation({
    summary: 'رد موظف',
    description:
      'يحوّل المحادثة إلى HUMAN، يعيد فتحها إن كانت مغلقة، ويسندها للموظف إن لم تكن مسندة.',
  })
  send(@Param('conversationId') conversationId: string, @Body() dto: SendMessageDto) {
    return this.messagesService.send(conversationId, dto);
  }
}
