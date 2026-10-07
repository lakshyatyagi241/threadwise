import { Module } from '@nestjs/common';
import { ChatConversationsModule } from '../chat-conversations';
import { RoutingInboundListener } from './routing-inbound.listener';
import { TeamInboxRoutingSlaModule } from './team-inbox-routing-sla.module';

/** What only the worker runs for routing: the listener that routes a new conversation. Imported ONLY by WorkersModule. */
@Module({
  imports: [TeamInboxRoutingSlaModule, ChatConversationsModule],
  providers: [RoutingInboundListener],
})
export class TeamInboxRoutingSlaWorkerModule {}
