import { Module } from '@nestjs/common';
import { ChatConversationsModule } from '../chat-conversations';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { TeamInboxConversationsModule } from '../team-inbox-conversations';
import { RoutingInboundListener } from './routing-inbound.listener';
import { SlaInboundListener } from './sla-inbound.listener';
import { SlaSweepService } from './sla-sweep.service';
import { TeamInboxRoutingSlaModule } from './team-inbox-routing-sla.module';

/**
 * What only the worker runs for routing and SLA: the listener that routes a new conversation, the one that starts a response clock,
 * and the sweep that closes answered clocks and flags breached ones. Imported ONLY by WorkersModule.
 */
@Module({
  imports: [
    TeamInboxRoutingSlaModule,
    ChatConversationsModule,
    TeamInboxConversationsModule,
    PlansCoreModule,
  ],
  providers: [RoutingInboundListener, SlaInboundListener, SlaSweepService],
})
export class TeamInboxRoutingSlaWorkerModule {}
