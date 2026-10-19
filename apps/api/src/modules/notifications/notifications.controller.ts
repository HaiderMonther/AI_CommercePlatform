import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { QueryNotificationsDto } from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/** Every signed-in member reads only their own notifications; no permission is needed. */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ResponseMessage('تم جلب الإشعارات')
  @ApiOperation({ summary: 'إشعاراتي، الأحدث أولاً، مع عدد غير المقروء' })
  findMine(@Query() query: QueryNotificationsDto) {
    return this.notifications.findMine(query);
  }

  @Get('unread-count')
  @ResponseMessage('تم جلب عدد الإشعارات غير المقروءة')
  unreadCount() {
    return this.notifications.unreadCount();
  }

  @Post('read-all')
  @HttpCode(200)
  @ResponseMessage('تم تعليم كل الإشعارات كمقروءة')
  markAllRead() {
    return this.notifications.markAllRead();
  }

  @Post(':id/read')
  @HttpCode(200)
  @ResponseMessage('تم تعليم الإشعار كمقروء')
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }
}
