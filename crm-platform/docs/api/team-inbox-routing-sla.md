# Team inbox: routing and SLA (TIB2)

Phase 1 builds the assignment part only: `AssignmentService` (the only writer of a conversation's assignee columns, manual strategy), the
`assign` route and the `assignees` picker. The rules, the routes, the events and the realtime behaviour are in
[team-inbox-conversations.md](team-inbox-conversations.md#assignment-team-inbox-routing-sla), because the web calls them together with the
conversation routes. Contracts: `packages/contracts/src/team-inbox-routing-sla/assignment.ts`. Code: `apps/api/src/modules/team-inbox-routing-sla/`.

For other domains: assign only through `AssignmentService` (barrel `modules/team-inbox-routing-sla`). `assignInTx(tx, orgId, locked, next, actor)` writes
inside your transaction (lock the conversation first with `ConversationsRepository.lockByUuid` from the team-inbox-conversations barrel) and returns an
`AssignmentChange`; call `afterCommit(orgId, change)` once the transaction has committed. The actor is a person or `system`, `bot` or `flow`.

Not built yet (Phase 3 onward): the strategies round robin, least loaded and sticky, agent availability changes and capacity, routing rules, business
hours, SLA policies and sweeps, escalation, snooze. The contract already carries the picker's `availability` and each team's `assignmentStrategy`.
