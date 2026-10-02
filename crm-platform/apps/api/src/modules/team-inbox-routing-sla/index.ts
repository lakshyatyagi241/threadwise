/**
 * Public surface of the team inbox's routing and SLA domain. The conversation core and the other inbox domains reach assignment only
 * through `AssignmentService`; nothing else may write a conversation's assignee columns.
 */
export { TeamInboxRoutingSlaModule } from './team-inbox-routing-sla.module';
export {
  AssignmentService,
  type AssignmentActor,
  type AssignmentChange,
} from './assignment.service';
