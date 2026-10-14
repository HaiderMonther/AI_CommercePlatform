import { Module } from '@nestjs/common';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { MessagesModule } from '@modules/messages/messages.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { AiAgentService } from './ai-agent.service';
import { AiClient } from './ai-client';
import { AiResponderService } from './ai-responder.service';
import { AiSettingsService } from './ai-settings.service';
import { AiToolExecutor } from './ai-tools';
import { AiController } from './ai.controller';

@Module({
  imports: [ConversationsModule, MessagesModule, OrdersModule],
  controllers: [AiController],
  providers: [AiClient, AiToolExecutor, AiAgentService, AiSettingsService, AiResponderService],
  exports: [AiResponderService, AiClient],
})
export class AiModule {}
