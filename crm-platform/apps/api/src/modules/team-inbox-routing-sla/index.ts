/**
 * Public surface of the team inbox's routing and SLA domain. The conversation core and the other inbox domains reach assignment only
 * through `AssignmentService`; nothing else may write a conversation's assignee columns.
 */
export { TeamInboxRoutingSlaModule } from './team-inbox-routing-sla.module';
export {
  AssignmentService,
  type AssignmentActor,
  type AssignmentChange,
  type AssignmentHow,
} from './assignment.service';
export { RoutingEngine, type RoutingInput, type RoutingOutcome } from './routing-engine.service';
export { TeamInboxRoutingSlaWorkerModule } from './team-inbox-routing-sla-worker.module';
export { HandoffService, type HandoffInput, type HandoffResultInternal } from './handoff.service';
