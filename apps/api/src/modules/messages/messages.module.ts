import { Module } from '@nestjs/common';
import { ChannelsModule } from '@modules/channels/channels.module';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [ConversationsModule, CustomersModule, ChannelsModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
