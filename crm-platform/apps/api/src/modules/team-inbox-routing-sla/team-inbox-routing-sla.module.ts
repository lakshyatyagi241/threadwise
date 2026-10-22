import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { TeamAnalyticsController } from './team-analytics.controller';
import { TeamAnalyticsService } from './team-analytics.service';
import { ChatConversationsModule } from '../chat-conversations';
import { TeamInboxConversationsModule } from '../team-inbox-conversations';
import { AssigneesService } from './assignees.service';
import { BusinessHoursService } from './business-hours.service';
import { AssignmentController } from './assignment.controller';
import { HandoffController } from './handoff.controller';
import { HandoffRepository } from './handoff.repository';
import { HandoffService } from './handoff.service';
import { OwnerAlignmentService } from './owner-alignment.service';
import { AssignmentService } from './assignment.service';
import { BulkActionsService } from './bulk-actions.service';
import { QueueArrivalService } from './queue-arrival.service';
import { RoutingEngine } from './routing-engine.service';
import { SlaClockService } from './sla-clock.service';
import { SlaPoliciesController } from './sla-policies.controller';
import { SlaPoliciesRepository } from './sla-policies.repository';
import { SlaPoliciesService } from './sla-policies.service';
import { RoutingRulesController } from './routing-rules.controller';
import { RoutingRulesRepository } from './routing-rules.repository';
import { RoutingRulesService } from './routing-rules.service';

/**
 * Team inbox, routing and SLA (TIB2). This slice is assignment (the manual strategy, the only writer of the assignee columns, the
 * picker's list) and the routing rules: their CRUD API and the engine that auto-assigns a new conversation (`RoutingEngine`, run by
 * `RoutingInboundListener` in the worker). Business hours, SLA and escalation arrive in later phases as more providers here.
 *
 * Kernel services (audit, outbox, RBAC), the database and realtime are global.
 */
@Module({
  imports: [TeamInboxConversationsModule, ChatConversationsModule, PlansCoreModule],
  controllers: [
    AssignmentController,
    HandoffController,
    RoutingRulesController,
    SlaPoliciesController,
    TeamAnalyticsController,
  ],
  providers: [
    AssignmentService,
    HandoffRepository,
    HandoffService,
    OwnerAlignmentService,
    BulkActionsService,
    AssigneesService,
    BusinessHoursService,
    RoutingRulesRepository,
    RoutingRulesService,
    RoutingEngine,
    QueueArrivalService,
    SlaPoliciesRepository,
    SlaPoliciesService,
    SlaClockService,
    TeamAnalyticsService,
  ],
  exports: [
    AssignmentService,
    HandoffService,
    HandoffRepository,
    RoutingEngine,
    RoutingRulesRepository,
    SlaClockService,
  ],
})
export class TeamInboxRoutingSlaModule {}
