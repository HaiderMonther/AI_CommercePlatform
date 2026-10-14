import { Module } from '@nestjs/common';
import { ConversationsModule } from '@modules/conversations/conversations.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { MetaGraphClient } from './meta-graph.client';
import { OutboundService } from './outbound.service';

@Module({
  imports: [ConversationsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, MetaGraphClient, OutboundService],
  exports: [ChannelsService, MetaGraphClient, OutboundService],
})
export class ChannelsModule {}
