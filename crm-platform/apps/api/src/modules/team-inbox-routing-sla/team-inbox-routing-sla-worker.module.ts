import { Module } from '@nestjs/common';
import { ChatConversationsModule } from '../chat-conversations';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { TeamInboxConversationsModule } from '../team-inbox-conversations';
import { AwayConsumer, AwaySweep } from './away.consumer';
import { OwnerSyncConsumer } from './owner-sync.consumer';
import { QueueTimersSweep } from './queue-timers-sweep.service';
import { RoutingEscalationSweep } from './routing-escalation-sweep.service';
import { RoutingInboundListener } from './routing-inbound.listener';
import { SlaInboundListener } from './sla-inbound.listener';
import { SlaSweepService } from './sla-sweep.service';
import { TeamInboxRoutingSlaModule } from './team-inbox-routing-sla.module';

/**
 * What only the worker runs for routing and SLA: the listener that routes a new conversation, the one that starts a response clock,
 * the sweep that closes answered clocks and flags breached ones, and the sweep that applies due escalations, and the sweep that runs the waiting queue's timers. Imported ONLY by WorkersModule.
 */
@Module({
  imports: [
    TeamInboxRoutingSlaModule,
    ChatConversationsModule,
    TeamInboxConversationsModule,
    PlansCoreModule,
  ],
  providers: [
    OwnerSyncConsumer,
    RoutingInboundListener,
    SlaInboundListener,
    SlaSweepService,
    RoutingEscalationSweep,
    QueueTimersSweep,
    AwayConsumer,
    AwaySweep,
  ],
})
export class TeamInboxRoutingSlaWorkerModule {}
