import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { TeamAnalyticsController } from './team-analytics.controller';
import { TeamAnalyticsService } from './team-analytics.service';
import { TeamInboxConversationsModule } from '../team-inbox-conversations';
import { AssigneesService } from './assignees.service';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';
import { BulkActionsService } from './bulk-actions.service';
import { RoutingEngine } from './routing-engine.service';
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
  imports: [TeamInboxConversationsModule, PlansCoreModule],
  controllers: [AssignmentController, RoutingRulesController, TeamAnalyticsController],
  providers: [
    AssignmentService,
    BulkActionsService,
    AssigneesService,
    RoutingRulesRepository,
    RoutingRulesService,
    RoutingEngine,
    TeamAnalyticsService,
  ],
  exports: [AssignmentService, RoutingEngine],
})
export class TeamInboxRoutingSlaModule {}
