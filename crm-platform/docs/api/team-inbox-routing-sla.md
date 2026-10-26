# Team inbox: routing and SLA (TIB2)

Phase 1 builds the assignment part only: `AssignmentService` (the only writer of a conversation's assignee columns, manual strategy), the
`assign` route and the `assignees` picker. The rules, the routes, the events and the realtime behaviour are in
[team-inbox-conversations.md](team-inbox-conversations.md#assignment-team-inbox-routing-sla), because the web calls them together with the
conversation routes. Contracts: `packages/contracts/src/team-inbox-routing-sla/assignment.ts`. Code: `apps/api/src/modules/team-inbox-routing-sla/`.

For other domains: assign only through `AssignmentService` (barrel `modules/team-inbox-routing-sla`). `assignInTx(tx, orgId, locked, next, actor)` writes
inside your transaction (lock the conversation first with `ConversationsRepository.lockByUuid` from the team-inbox-conversations barrel) and returns an
`AssignmentChange`; call `afterCommit(orgId, change)` once the transaction has committed. The actor is a person or `system`, `bot` or `flow`.

Not built yet: sticky and team-strategy assignment, agent availability changes and capacity, the routing actions SLA and AI agent (`set_sla`, `assign_agent`), business hours settings, SLA policies and sweeps, escalation, snooze. The contract already carries the
picker's `availability` and each team's `assignmentStrategy`. Routing rules and auto-assignment are below.

## Auto-assignment: routing rules (TW-TIB2-004 to 011, 020, assign action only)

Contracts: `packages/contracts/src/team-inbox-routing-sla/routing-rules.ts`. Code: `routing-rules.{controller,service,repository,mapper}.ts`,
`routing-engine.service.ts`, `routing-matcher.ts`, `agent-picker.ts`, `routing-inbound.listener.ts` (worker only) in
`apps/api/src/modules/team-inbox-routing-sla/`. Web: Settings > Automation > Auto-assignment (`/auto-assignment`).

### Routes (`/v2/inbox/routing`, plan feature `inbox_routing` on every route, reads included)

| Route                      | Permission             | What                                                                                                                                        |
| -------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET rules?q&limit&cursor` | `inbox.settings.read`  | rules in priority order, search by name, cursor pages; `total` and plan `limit`                                                             |
| `POST rules`               | `inbox.routing.manage` | create; goes last, switched off unless `isActive`; 422 `PLAN_LIMIT_REACHED` at the plan's `routing_rules` limit (counts switched-off rules) |
| `GET rules/:id`            | `inbox.settings.read`  | one rule                                                                                                                                    |
| `PATCH rules/:id`          | `inbox.routing.manage` | any subset + `rowVersion` (409 `ROW_VERSION_CONFLICT`); `{rowVersion, isActive}` is the list's switch                                       |
| `DELETE rules/:id`         | `inbox.routing.manage` | 204                                                                                                                                         |
| `POST rules/:id/duplicate` | `inbox.routing.manage` | copy, last, off, not fallback, counters 0; counts against the limit                                                                         |
| `POST rules/reorder`       | `inbox.routing.manage` | `{ids}`: the listed rules take the priority slots they hold now, in that order                                                              |
| `GET/PUT settings`         | read / manage          | `{keepContactAgent}`                                                                                                                        |
| `POST test`                | `inbox.settings.read`  | "Try it": `{contactId?, channelKind, messageText, language?, outsideHours?}` -> which step decides and why. Read-only (see the engine below)    |

Mutations accept `Idempotency-Key`; errors are problem+json; every write is audited (module `routing_rules`, `routing_settings`) and emits
`routing_rule.created|updated|deleted|reordered` / `routing_settings.updated` in the same transaction.

### Where things are stored (no new table)

- `routing_rules.conditions` = `RoutingConditions`: `contact` (the segments rule tree, evaluated with the segments compiler against the contact),
  `contactKind` (`any|new|returning`), `channelKinds`, `keywords {mode, words}`, `languages`, `businessHours`. A set part must hold (AND). A rule with no condition matches
  only when it is the fallback or `routing_rules.applies_to_all` is true (the editor's "Only for conversations that match..." switch is off); when `applies_to_all` is true the
  stored conditions are kept but ignored. The API refuses a non-fallback rule that has neither a condition nor `appliesToAll` (422). `contact` matches what is already saved on
  the contact (a contact created by the arriving message has stage `new`, no tags, no owner); `contactKind` is known at arrival (returning = another conversation, or saved more
  than 10 minutes ago).
- `routing_rules.actions` = list of action dicts: `{type:'assign', strategy, userIds, teamIds, everyone, rrCursor}` (`everyone: true` = every active member who can open the inbox, available now; only
  round robin / least busy; the lists must then be empty; optional: a rule may only mark spam, set a
  priority, add tags, schedule an escalation, auto-reply or start a flow), optionally `{type:'mark_spam'}` (the conversation becomes spam when the rule fires:
  the same state as the bulk "Mark as spam", a `spam_flagged` event with `by: routing` and the rule id, and an audit row; the rule's other actions still run),
  `{type:'set_priority', priority}` (one-shot: a new conversation only; a `priority_changed` event with `by: routing`), `{type:'add_tag', name, color}` per
  tag (found by name, case-insensitive, or created; per message: it also runs on a later message of a live conversation, as in Reference; a `tag_added`
  event), `{type:'set_escalation', minutes, reassign, priority}` (on fire it schedules `escalation_due_at`; the sweep every 30 seconds applies it if the
  thread is still open and we have not replied: reassigns to the rule's agents as they were when it fired and/or sets the priority, then an `escalated`
  event; a reply from us first cancels it), `{type:'auto_reply', body}` (per message: the reply is sent as the business, a bot message through the normal
  outbound path; the channel's rules apply, so a free reply outside the 24 hour window is refused and logged, not sent; the id is derived from the message,
  so a retry does not send twice), and `{type:'note', description}`
  (the rule's **description**; unknown action types are ignored, as in Reference). `rrCursor` is the **round robin cursor**: the internal id of the person who
  took the last turn, saved under a row lock on the rule when it fires; never sent to clients; kept through an edit that leaves the same people and teams.
- **Priority** is `routing_rules.sort` (list shows `position`, 1 = first); new rules take `max(sort)+1`.
- `fired_count` / `last_fired_at` are bumped by the engine.
- Migrations: `workspace_settings.routing_keep_contact_agent boolean default false` (the "keep returning contacts with their agent" switch), and
  `20270321090000_routing_rules_applies_to_all`: `routing_rules.applies_to_all boolean NOT NULL DEFAULT false` (expand-only; no rule is created or changed).

### "Try it" (`POST /v2/inbox/routing/test`)

`RoutingEngine.dryRun` runs `decideArrival`, the same method `route()` uses, with no hooks and inside a `SET TRANSACTION READ ONLY` transaction: no assignment, no `fired_count`, no
round robin cursor move, no event, no outbox row, no audit row. Answer: `outcome` (`sticky|rule|everyone_else|queue|off`), the rule, the assignee (person or team uuid), `steps[]` (each
with `why` and the conditions that matched or not), `trace[]` (who was left out: `on_leave`, `offline_busy_or_at_capacity`, ...), the contact summary and whether it counted as outside
business hours. Covered by `routing-redesign.e2e.spec.ts` (snapshots the tables before and after).

### The engine (`RoutingEngine`)

`RoutingInboundListener` registers with `InboundMessageHooks` in the worker (`TeamInboxRoutingSlaWorkerModule`, imported by `WorkersModule`), so it runs after the
message committed and never in a request. It reacts to the first message of a new conversation and to the one that reopens a finished one
(`InboundStoredEvent.reopenedFrom`, added); later messages of a live thread are ignored. In one transaction under the conversation's row lock:

1. Skip when the plan lacks `inbox_routing`, the conversation is archived or already held by a person, a team or an AI agent, or `routing_meta.routedMessage` equals this message
   (idempotency: a redelivered message is a ledger duplicate and never reaches the hooks; the stamp covers a retried job).
2. If the setting is on and the conversation has a contact: the **contact's owner (`contacts.owner_id`)**, else the person who held the contact's **most recent other conversation
   (`conversations.assignee_user_id`, latest `last_message_at`)**, if an active member who can open the inbox (availability is not checked). Strategy recorded: `contact_agent`.
3. Active rules by `sort, id`. A rule matches by its conditions and _fires_ when it also finds a person: people = listed users + members of listed teams, active, able to open the
   inbox (`inbox.conversation.read`), and not `offline`/`busy` in `agent_statuses` (no row = available; nobody writes a status yet). `round_robin` = next id after the cursor, wrapping;
   `least_busy` = fewest open, ties by the rotation; `specific` = the one person. Nobody available: the first listed team's queue (no person); no team: the rule does not fire.
   A person drawn through a team brings that team. `stop_on_match` (default on) ends evaluation; off, a later firing rule takes over (reassigns).
4. No primary rule fired: the fallback rule (its conditions, if any, apply). Otherwise the conversation stays unassigned.

The write goes through `AssignmentService.assignInTx` (actor `system`, strategy `round_robin|least_busy|specific|contact_agent`, `ruleId`/`ruleName` in the timeline and outbox
payload), then `afterCommit`, so the timeline, audit, `conversation.assigned` outbox event, realtime signals and mine/unassigned counters are those of a manual assignment.

## Start a flow (`triggerFlowId`)

Create and update accept `triggerFlowId` (a flow uuid of the workspace, `null` clears it); rules return `triggerFlow { id, name, isActive }`. A firing rule writes `routing.flow_requested`; the flow runtime starts the flow for the conversation (source `routing`, no subscriber, 600 s). A rule that names a flow fires even when nobody is available.

## Team performance report (TW-TIB2-034)

`GET /v2/inbox/analytics/team?range=today|week|month&channelId=<uuid>`. Needs `inbox.analytics.view` (Owner, Admin, Manager presets) and the plan feature `team_performance`
(`PLAN_FEATURE_LOCKED` otherwise). Reference left its JSON open to every member; here it is gated like the page.

- `range`: `today` (default), `week` (from Monday) or `month`, started at midnight in the workspace time zone (`organizations.settings.timezone`, UTC when unset or unknown). Anything else reads as `today`.
- `channelId`: narrows every figure to conversations on one channel; an unknown channel is 404, a non-uuid 422.

```json
{
  "range": "today",
  "since": "2026-10-13T00:00:00.000Z",
  "totals": { "replies": 3, "resolved": 1, "inbounds": 4, "avgFirstResponseMin": 6 },
  "agents": [
    {
      "userId": "…",
      "name": "Dana",
      "replies": 2,
      "resolved": 1,
      "avgResponseMin": null,
      "status": "online",
      "currentLoad": 2,
      "lastSeenAt": "2026-10-13T08:55:00.000Z"
    }
  ]
}
```

- **Replies** = outbound `messages` with `sender_kind = 'agent'` and a `sender_user_id`, grouped by that person. Automatic replies (routing, keyword, out-of-hours, AI) carry another sender kind and are not counted (Reference attributed them to the conversation owner: deliberate fix).
- **Agents listed** = people with at least one reply in the window (Reference rule, kept): someone who only resolved or was assigned is not listed.
- **resolved** per person = conversations `resolved` with `resolved_at` in the window, grouped by `resolved_by`; the total counts all of them.
- **avgResponseMin** = mean minutes from `created_at` to `first_response_at` over conversations resolved in the window, credited to the **assignee**; `avgFirstResponseMin` is the same mean over all of them (one decimal, `null` when none).
- **currentLoad** = live count of open, unarchived conversations assigned to the person (Reference used a counter that drifted); `status` is the stored availability or `offline`.
- No pagination, export or CSAT here (Reference has none either).
