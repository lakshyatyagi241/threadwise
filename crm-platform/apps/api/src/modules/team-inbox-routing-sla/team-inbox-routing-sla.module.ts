import { Module } from '@nestjs/common';
import { TeamInboxConversationsModule } from '../team-inbox-conversations';
import { AssigneesService } from './assignees.service';
import { AssignmentController } from './assignment.controller';
import { AssignmentService } from './assignment.service';

/**
 * Team inbox, routing and SLA (TIB2). This slice is assignment: the manual strategy, the only writer of the assignee columns, and the
 * picker's list. Routing rules, business hours, SLA and escalation arrive in later phases as more providers here.
 *
 * Kernel services (audit, outbox, RBAC), the database and realtime are global.
 */
@Module({
  imports: [TeamInboxConversationsModule],
  controllers: [AssignmentController],
  providers: [AssignmentService, AssigneesService],
  exports: [AssignmentService],
})
export class TeamInboxRoutingSlaModule {}
