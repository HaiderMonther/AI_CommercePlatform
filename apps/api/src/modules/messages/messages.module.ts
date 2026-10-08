import { Module } from '@nestjs/common';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { CustomersModule } from '@modules/customers/customers.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [ConversationsModule, CustomersModule],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
