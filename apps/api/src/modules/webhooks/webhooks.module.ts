import { Module } from '@nestjs/common';
import { AiModule } from '@modules/ai/ai.module';
import { ChannelsModule } from '@modules/channels/channels.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { WebhookProcessorService } from './webhook-processor.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [ChannelsModule, MessagesModule, AiModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookProcessorService],
  exports: [WebhookProcessorService],
})
export class WebhooksModule {}
