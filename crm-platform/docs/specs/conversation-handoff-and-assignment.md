# Conversation handoff and assignment: bot first, person second (design, phase 1 built with it)

Status: **design for owner review (auto-assignment redesign H13 to H21 added at the end of section 13, 2026-10-21); phase 1 (BL-396 to BL-404) is built on the branch that follows this note** (backlog section AF). Written 2026-10-20
from a read-only pass over `origin/main` (after Teams T0 to T3). Every "today" statement names the file or table it was read in. Defaults are
chosen in section 13 so nothing waits for an answer; each one can be reversed in the plan editor or a setting without code.

Product framing (owner): ONE fused product (chat + CRM), **bot first, human second**. Plans and add-ons decide what is *available* (plan management owns
the feature flags), personas decide what is *visible*, permissions decide what a person may *do*. A bot is a flow (WhatsApp, web) or an AI agent. Either can
hand the conversation to a person at any moment, at no AI cost, and the person (or the queue) sees why.

## 1. Short answer

1. There is **no handoff action today**. A flow's `AssignAgent` node calls `AssignmentService.assignFromFlow` (a named person or team, strategy `manual`),
   the flow then simply goes on and keeps answering; an AI agent "handoff" is a sentence in the prompt (`chatbot-widget/ai-prompt.ts`) that makes the model
   type a canned message, and `AiAgentHandoffPort` is the opposite direction (flow to AI agent) and is bound to `UnavailableAiAgentHandoff`.
2. Routing rules (`routing-engine.service.ts`) run **only on the first inbound message** of a new or reopened conversation (`RoutingInboundListener`),
   i.e. for human-first conversations. A conversation that a bot answered for ten minutes and then wants a person is never routed.
3. `teams.assignment_strategy`, `business_hours`, `timezone`, `default_assignee_id` are stored, shown "not used yet" (BL-381) and never read.
4. Proposal: **one `HandoffService`** is the only way a bot (flow node, AI agent, keyword rule, bot failure) or a person ("send to queue") says "a person
   must take this". It writes an explicit **handling state** (`with_bot | waiting | with_person`), mutes the bot, records a **handoff card** (reason,
   summary, collected answers) and an assignment **trace**, and then finds the person: named person, team queue, or the workspace's rules. Basic plans
   get the queue (claim and manual assign, always); plans with `inbox_routing` also get automatic assignment, owner-first and sticky agent at handoff.
5. **Contact owner and chat owner** get a workspace setting with three modes (Independent, Owner first, Keep in sync) and an explicit precedence and
   idempotency contract with the record assignment engine, so the two systems can never undo each other.

## 2. What exists today (evidence)

### 2.1 Conversation data and visibility

| Fact | Where |
| --- | --- |
| `conversations.status` is `open, snoozed, resolved, closed, spam`; `assignee_user_id`, `assignee_team_id`, `assignee_agent_id` (an AI agent), `routing_meta` (jsonb, unused by routing), `escalation_*`, `waiting_since` (SLA anchor) | `packages/db/src/schema/chat-conversations/tables.ts`, `CONVERSATION_STATUSES` in `contracts/src/chat-conversations/enums.ts` |
| No field says who handles the thread (bot, queue, person). "AI agent holds it" = `assignee_agent_id`; "a flow is running" = a `flow_runs` row for (channel, peer) | `flow-runtime-engine/runtime/run.repository.ts` (`liveByPeer`) |
| Tabs: `all, mine, unassigned, unread`. `unassigned` = no human assignee (a thread held by an AI agent counts as unassigned) | `INBOX_TABS`, `ConversationsRepository.tabCondition` |
| Visibility: `all`; `team` = mine, my teams' (`assignee_team_id`), plus the unassigned ones when the role holds `inbox.conversation.read_unassigned`; `own` = mine only | `kernel/rbac/scope/conversation-scope.ts`, `team-inbox-conversations/visibility-sql.ts` |
| A team assignment without a person already exists (`assignee_team_id` set, `assignee_user_id` null): it is the seed of a team queue, but nothing shows it as one | `AssignmentService.assignInTx` |
| Event types are an open list (`CONVERSATION_EVENT_TYPES`); the wire type is a string | `contracts/src/team-inbox-conversations/inbox.ts` |

### 2.2 The only writer of assignment

`AssignmentService` (`team-inbox-routing-sla/assignment.service.ts`) is the only writer of the three assignee columns: `assign` (manual route; `inbox.conversation.assign`
anyone, `inbox.conversation.assign_self` = **a claim**: the caller's own id and nothing else), `assignFromFlow` (flow, no permission check, strategy `manual`),
`handOverOpen` (deactivation), `assignInTx` (used by routing and escalation with `actor: system`). It checks the target is an active member who can open the
inbox and can see that conversation, and that the team has `receives_conversations` (Teams T1). It takes the thread from an AI agent
(`assignee_agent_id` cleared, an `ai_handoff` event), reopens a `closed` one, and writes the timeline event, audit row, outbox event
`conversation.assigned` in one transaction, then realtime after commit.

### 2.3 Routing

`RoutingEngine.route` (worker, after the inbound message committed): gate `inbox_routing` (else `skipped: plan`); locks the conversation; **not eligible** if archived,
a personal mailbox, or already held by a person, team or AI agent; stamps `routed_message`; then (2) "Keep returning contacts with their agent" (workspace setting
`workspace_settings.routing_keep_contact_agent`, default off; the contact's owner, else the person who held the contact's previous conversation; availability is
**not** checked, leave and delegate are) and (3) the active rules by `sort`, then (4) the fallback rule. `choose()` expands people and teams, drops people on leave
(delegate takes the place of a named person), keeps agents who can open the inbox, are not `offline`/`busy` in `agent_statuses`, and are under `user_profiles.chat_limit`
(a capacity that **already exists** in `RoutingRulesRepository.available`), picks by `specific | round_robin | least_busy` with a cursor stored under a row lock on the rule,
and falls back to the first listed team's queue. Everything is one transaction with the conversation row lock; the result is `assigned | triggered | unmatched | skipped`.
There is no run log: the only trace is the timeline event (`strategy`, `ruleId`, `ruleName`, `delegateFor`). All `/inbox/routing/*` routes require `inbox_routing`
(`@RequirePlanFeature` on the controller), settings included.

### 2.4 Flows

* Node `assign` (builder) -> `AssignAgent` (runtime) in `actions-nodes.ts`: reads `data.team`, `data.userId`, `data.message` (note); `assignFromFlow`; always leaves by port 1;
  a refusal is logged in the run and the flow goes on. A button's `handoffs` with nothing wired get a generated `AssignAgent` (`compile-graph.ts`). Label "Assign agent".
* The inbound pipeline (`InboundMessageHooks.run`) runs listeners in order; `FlowInboundService.onStored` resumes a parked run or starts one (keyword, default route, away
  flows) and answers `consumed` so the auto reply and AI agent do not answer twice. Nothing consults who holds the conversation, so **a flow keeps answering after a person
  took the thread**. Listeners that answer: flow runtime, catalog concierge, commerce resume, consent keyword (first), plus the routing and SLA listeners that never answer.
* The engine can already deliver an outside event to a `Custom` wait (`FlowEngine.deliverExternal`), used by forms, shops and Google Forms; `FlowEngine.endForPeer` ends a run
  when "a person took over" (TW-FLR-050), reason `takeover`.

### 2.5 AI agents

The widget AI reply (`chatbot-widget/widget-ai-reply.service.ts`) is single-shot text; `handoffEnabled/handoffKeyword/handoffMessage` only add a sentence to the system prompt.
`AiChatPort.complete` has no tool calling. The Chatbot flow node's `AiAgentHandoffPort` hands a conversation **to** an AI agent (Reference: `respondIfAssigned`), still `Unavailable`.

### 2.6 Contact owner and the record assignment engine

`contacts.owner_id` with `owner_changed_at` stamped **by a database trigger** (`stamp_owner_change`, migration `20261130090000`) on any owner change. `ContactAssignmentEngine.assign`
(worker, on the creation event of a record, via the outbox) writes an owner **only when `owner_id IS NULL AND owner_changed_at IS NULL`** (`setOwner(... unowned)`), or moves an owner
that still carries the engine's own last pick (`reassignOnUpdate`, compared with the run log's `owner_stamp`). It logs a run (trace of every rule) and emits `contact.updated`
(`autoAssigned: true`) + `contact.auto_assigned`. Manual change, bulk reassign batches (`owner_reassign_batches`, `app.owner_batch_id`) and imports go through `ContactsService` and the bulk service.
Leave and delegation (`common/leave-delegate.ts`, `workspace-calendar.ts`) are shared by both engines.

### 2.7 Plans

`inbox_routing` (default true for rows that predate it) gates the routing rules, their settings and the engine. `record_assignment` gates the record engine. Plan feature keys are added
in `contracts/src/plans-subscriptions-trials/catalogue.ts` (`PLAN_FEATURE_DEFS`: `default` = what a plan row that predates the key grants); the plan editor lists every key.

## 3. Gaps

| # | Gap | Evidence |
| --- | --- | --- |
| G1 | No explicit "who handles this": bot, queue or person | 2.1 |
| G2 | The flow keeps answering after a person took the thread | 2.4 |
| G3 | The handoff node can only name a person or a team; no rules, no queue semantics, one output port | 2.4 |
| G4 | Routing never runs at handoff, only at arrival of a human-first conversation | 2.3 |
| G5 | The AI agent has no real handoff action | 2.5 |
| G6 | No "waiting for a person" view; a team-only assignment is invisible as a queue; no claim button (the permission exists) | 2.1, 2.2 |
| G7 | The agent receiving the handoff does not see why (reason, summary, answers) | 2.2 |
| G8 | Team method, hours, timezone, default assignee are stored and ignored | BL-381 note, `assignment.service.ts` |
| G9 | Contact owner and chat owner are unrelated: "keep returning contacts" reads the owner only when the (plan-gated) setting is on, never writes it, and the owner change does not reach open conversations | 2.3, 2.6 |
| G10 | Routing leaves no trace of who was considered and why someone was skipped | 2.3 |
| G11 | Basic plans cannot even configure queue behaviour: every settings route needs `inbox_routing` | 2.3 |

## 4. Design

### 4.1 The handling state

New column `conversations.handling text NULL` with the values `with_bot | waiting | with_person` (a CHECK added `NOT VALID`, validated in a later migration), `handling_since timestamptz`
and `assigned_source text NULL` (who set the current assignee: `manual | claim | handoff_named | rule | owner | sticky | sync | system`). It is a **separate column**: `status`
(`open/snoozed/resolved/closed/spam`), the kanban and every inbox filter are untouched. `NULL` means "not tracked": every existing row, and every conversation that no
handoff ever touched; it behaves exactly as today. The API exposes an *effective* value: stored value if set, else `with_person` when a person or team is assigned, `with_bot` when
an AI agent holds it, otherwise `null`.

```
                      handoff(destination = person)
        ┌────────────────────────────────────────────────┐
        │                                                ▼
   with_bot ── handoff(queue / rules found nobody) ──▶ waiting ──claim / assign──▶ with_person
        ▲                                                │  ▲                        │
        │                          send to queue ◀───────┘  └──── unassign / release ─┤
        │                                                                              │
        └────────────── return to bot ─────────────────────────────────────────────────┘
   resolve / close / spam  : handling -> NULL (history stays in the handoff row)
   customer writes to a resolved/closed thread (reopen): handling -> NULL, then the normal arrival path
        (flow / AI agent answers if one handles the channel; else arrival routing; else the thread waits unassigned as today)
```

* `waiting` = nobody holds it; it is in a queue (a team's, or the workspace's "no team" queue). `with_person` = a person holds it (`assignee_user_id` set). A team-only assignment from the
  manual UI stays `with_person`-less: it is `waiting` with `assignee_team_id`. Rule: `handling = 'waiting'` iff a handoff or "send to queue" put it there and no person has it.
* Any human assignment (manual, claim, rule, flow) of a conversation whose stored handling is `waiting` or `with_bot` sets `with_person`. A conversation with `NULL` stays `NULL`
  when assigned (no behaviour change for human-first traffic); it gets a value only through a handoff or "send to queue".
* **Mute**: while `handling` is `waiting` or `with_person`, `InboundMessageHooks.run` skips the listeners marked `bot: true` (flow runtime, catalog concierge, commerce resume) and
  answers `consumed: true`, so no auto reply or AI agent talks over the person. The flow run is **not** cancelled: it stays where it is (a `waiting` run keeps its wait), its idle
  timers keep their normal limits. Listeners that never answer (consent, routing follow-up, SLA, translation) run as before.
* **Return to bot**: `handling -> with_bot`, an event, the muted run (if still live) receives the next message exactly as before. Optional "start flow" is a follow-up (BL-410).
* The unmute is by `HandoffService.returnToBot`; resolving does not unmute (the thread is closed); a reopened thread starts at `NULL`.

### 4.2 One `HandoffService`

`modules/team-inbox-routing-sla/handoff.service.ts` (the module that owns `AssignmentService`, routing and SLA; flows and AI call it through a barrel). Public methods:

| Method | Caller | Does |
| --- | --- | --- |
| `handoff(input)` | flow node, AI agent, customer "talk to a person" keyword rule, bot failure, manual "send to queue" | the whole algorithm below |
| `claim(conversation, actor)` | the Claim button | `assign_self` semantics, then first-touch owner (4.5) |
| `returnToBot(conversation, actor)` | "Return to bot" | handling -> `with_bot`, event, trace |
| `settings()/updateSettings()` | settings screen | workspace handoff settings (4.6) |

Input (`HandoffInput`): `orgId`, `conversationUuid`, `source` (`flow | ai_agent | keyword | bot_failure | manual`), `reason` (picklist: `customer_asked`, `bot_could_not_help`, `sensitive_topic`, `sales_lead`,
`complaint`, `other`) + `reasonText`, `summary`, `answers` (flow variables, string map, at most 20 keys, 500 chars each, no secrets), `destination` (`{ kind: 'person', userId }`, `{ kind: 'team', teamId }`,
`{ kind: 'rules' }`), `priority`, `customerMessage`, `offHoursMessage`, `idempotencyKey` (flow: `flow:<run>:<node>:<step>`; AI: message uuid; manual: client key), `actor`.

Algorithm, one transaction holding the conversation row lock (the same lock `AssignmentService` uses):

1. **Idempotency**: a handoff row with the same `(org_id, idempotency_key)` returns that row's outcome, writes nothing. An *open* handoff (`waiting`/`assigned`) on the conversation absorbs a repeat (counts, no second card).
2. **Preconditions**: not archived; not a personal mailbox thread (`channelOwnerUserId` stays the mailbox owner's, as in routing); a spam conversation is refused.
3. **Record**: insert `conversation_handoffs` (the card and the run log), timeline event `handoff_requested` (actor `flow | ai | bot | user`; payload: handoff uuid, reason, source, destination), set `handling`,
   `handling_since`, and mark waiting. The AI agent is released (`assignee_agent_id` cleared, `ai_handoff` event, as `assignInTx` does today).
4. **Find the person** (`resolve`), every step appends a **trace** line to the handoff row (`{step, result, why}`): a person is *eligible* when active, can open this conversation (`conversationVisible`),
   the team (if any) `receives_conversations`, not on leave (delegate takes the place, one hop), `agent_statuses` not offline/busy, under `chat_limit`, and the team's business hours are open for team-bound picks.
   * destination **person**: that person if eligible (leave and delegate honoured, but availability and hours are NOT required: the author named them); else the destination's team (if the node also has one) queue; else the workspace queue.
   * destination **team**: team method (`teams.assignment_strategy`: `manual` -> team queue; `round_robin`, `least_loaded` -> pick among its members, needs plan `inbox_routing`); no one available -> team `default_assignee_id` if eligible -> team queue (`waiting`).
   * destination **rules**: needs plan `inbox_routing` and the workspace switch `auto_assign` on; runs `RoutingEngine.chooseForHandoff` (the same rules, pickers and fallback rule as arrival, evaluated with the *conversation facts and the handoff's last customer message*; rule actions that are not an assignment (tags, priority, auto reply, escalation) apply as they do at arrival; a rule that starts a flow is ignored at handoff, with a trace line, so a handoff can never start a bot). Without the plan or the switch: **degrade to the queue** (`waiting`, no team), trace `rules_not_in_plan` / `auto_assign_off`, the node's `unavailable`... see 4.3.
   * Before team/rules picking, **sticky stage** (4.5): owner-first, then last handler within the continuity window. A named person is never overridden.
   * Off-hours: if the team (or, for rules, the workspace) hours are closed, the conversation still enters the queue (so it is there when the office opens) and the outcome is `unavailable` with `reason: out_of_hours`; the `offHoursMessage` is sent instead of `customerMessage`.
5. **Write** through `AssignmentService.assignInTx` (timeline `assigned`, audit, outbox `conversation.assigned`; `strategy` extended with `handoff`, `owner`, `sticky`, `claim`) with `assigned_source` set. A queue write is `assignInTx` with only `teamId`.
6. **After commit**: realtime (existing `afterCommit`, plus `inbox.handoff` to the audience of the queue), notifications to the queue (4.4), the customer message (`facade.enqueueOutbound`, sender `bot`, deterministic client id so a retry never sends twice), outbox event `conversation.handoff_requested`.

Outcome: `assigned | waiting | unavailable` + `assigneeUserId/TeamId` + `trace`. These are exactly the **node ports**.

### 4.3 Flow node: "Human handoff"

Builder type `assign` keeps its key (stored flows and `TYPE_MAP` are untouched), the **label becomes "Human handoff"** (catalogue, simple builder, advanced canvas, help). New data (additive, `data.handoff = 2`):

| Field | Meaning |
| --- | --- |
| `destination` | `team` (+ `team`), `person` (+ `userId`), `rules` (needs the plan; shows a lock and an upgrade hint otherwise) |
| `reason`, `priority`, `note` (internal, for the agent, supports `{{variables}}`), `summary` template, `answers` (list of flow variables to pass; default: all non-system variables, capped) |
| `customerMessage`, `offHoursMessage` | sent by the handoff, not by a following Message node |
| `muteBot` | default on |

Ports (new nodes): `assigned` (1), `waiting` (2), `unavailable` (3: no agent or out of hours). `PORT_MAP.assign = { assigned: 1, waiting: 2, unavailable: 3 }`; the legacy handle
(`out`/none) still means port 1, so an old flow is unchanged. A node with `data.handoff` absent runs the **legacy path**: the same `assignFromFlow` behaviour (person/team, note, port 1, no handling change, no mute),
through `HandoffService.legacyAssign` so there is one action, one set of code paths. Opening an old node in the builder shows its person/team as destination and the new fields empty; saving it upgrades it to `handoff: 2`
(an explicit click: "Use handoff features" in the editor, never silently).

After a handoff leaves by `assigned` or `waiting`, the flow may keep running along the wired path (tags, deal, notify, webhook, even messages are the author's choice) but **new inbound messages no longer reach the run** (mute). A branch
that ends in a question parks there and re-arms on return to bot. The compiler validator warns (not blocks) when a handoff has `waiting` wired to nothing and when `rules` is chosen on a workspace without the plan.

### 4.4 Waiting queue, claim, notifications (all plans)

* Inbox tab **Waiting for a person** (`INBOX_TABS += 'waiting'`), counter badge from the existing tab-count aggregate, columns: reason, age (`handling_since`), team, priority, summary on hover. Visibility is the existing
  one, no new rule: team-scoped readers see their teams' queue and (with `read_unassigned`) the no-team queue; `own` readers do not see the queue (documented limitation, BL-410).
* **Claim**: `POST /v2/inbox/conversations/:id/claim` (permission `inbox.conversation.assign_self`, the existing claim permission; no new key, so no locked-role migration). Claim assigns to the claimer only,
  `assigned_source = claim`, handling -> `with_person`; losing a race answers 409 with the current holder. A conversation already held cannot be claimed; the Claim button is hidden then.
* **Assign** from the queue = the existing assign (`inbox.conversation.assign`), unchanged.
* **Send to queue** (manual): `POST .../handoff` with `source: manual`, same service (permission `inbox.conversation.assign`).
* **Notifications**: the existing conversation notification rules gain the event `conversation.handoff_requested` -> members of the destination team (or, for the no-team queue, everyone who may read unassigned and reply),
  in-app + push through `NotificationFanout`, with the handoff reason in the body, deduped per handoff. The existing waiting nudge keeps working for unassigned chats.

### 4.5 Contact owner and chat owner

Workspace setting `owner_mode` (default `independent`):

| Mode | Plan | At handoff / arrival | When the contact owner changes | When a person takes the chat |
| --- | --- | --- | --- | --- |
| `independent` | all | as today | nothing | nothing |
| `owner_first` | `inbox_routing` and `inbox_assignment_sticky` | if the contact has an eligible owner, assign to them (and their primary team as `owning_team_id`-style hint in the trace) **before** rules/team method; else fall through | nothing | nothing |
| `keep_in_sync` | same | as `owner_first` | the contact's open conversations whose `assigned_source` is automatic (`rule, owner, sticky, sync, system`) or that are unassigned/waiting follow the new owner if eligible; **never** a conversation a person took (`manual, claim, handoff_named`) | first touch: if the contact has no owner (and was never explicitly set), the person who is assigned or claims becomes the owner; a manual reassign of a chat offers a prompt "also make X the contact owner?" (option `prompt_owner_on_reassign`, default off) |

Independent of the mode:

* **Claim sets the owner when empty** (`claim_sets_owner`, default off, **all plans**, a plain toggle): on claim, `UPDATE contacts SET owner_id = :me WHERE owner_id IS NULL AND owner_changed_at IS NULL` (the exact guard the record engine uses),
  audited with `source: 'chat_claim'`.
* **Sticky last handler**: the legacy `routing_keep_contact_agent` stays (owner, else last handler, no window, `inbox_routing`). New `continuity_days` (default empty = no window = today) limits "last handler" to conversations whose
  last assignment is within N days (`inbox_assignment_sticky`). Eligibility is **checked** in the new code (active, can read, not on leave with delegate; capacity and hours when the pick is team-bound); the legacy path (`independent` + flag) keeps its "availability not checked".
* **Precedence** (first that yields an eligible person wins): named person of the node > owner (mode `owner_first`/`keep_in_sync`, or legacy flag) > last handler in the window (flag on) > team method / rules > fallback rule > team default assignee > queue.

#### Conflicts with the record assignment engine (never fight)

| Race | Rule |
| --- | --- |
| Engine assigns the contact owner (worker, on `contact.created`) while a handoff reads the owner | The handoff reads the owner once, in its own transaction; owner null -> falls through. A later engine owner reaches the chat only by `keep_in_sync`, only for automatic chats, via `assignInTx` with `assigned_source = sync` (audited, event payload `source: 'owner_sync'`). Idempotent: if the chat already belongs to that person it is a no-op. |
| Claim writes the owner while the engine is about to | Both use the same guarded `UPDATE ... WHERE owner_id IS NULL AND owner_changed_at IS NULL` under the contact's row lock; one wins, the other's guard matches no row (engine logs `raced`/`has_owner`, claim logs "owner already set to X" in the trace). The claim's write stamps `owner_changed_at` (trigger), so the engine treats it as an explicit human owner and never reassigns it, and `reassignOnUpdate` cannot move it (the stamp does not match the engine's last pick). |
| Sync -> contact -> sync loop | One direction per event. Owner events carry `source` (`chat_claim`, `owner_sync`, `engine`, `manual`, `bulk`, `import`). The sync consumer ignores `chat_claim` and `owner_sync`; a sync only ever writes a *conversation*, a claim only ever writes a *contact owner when empty*. There is no code path that writes both for the same trigger. |
| Bulk reassign batch (`owner_reassign_batches`) | Emits per-contact owner events; the sync consumer treats them as `manual`-class changes and follows them under `keep_in_sync`, skipping chats a person took. A batch **restore** is an owner change like any other. |
| Owner on leave | Delegate carries the chat meanwhile (same `pickDelegate`); the owner is not changed. |

The source and reason of every owner change is in the audit row (`delta` + `source`) and the outbox event payload.

### 4.6 Settings (phase 1)

Workspace (new endpoint `GET/PUT /v2/inbox/handoff-settings`; read `inbox.settings.read`, write `inbox.routing.manage`; **not** behind `inbox_routing`, so every plan can set what applies to it; fields the plan does not include come back with `locked: true`):

| Field | Default | Plan |
| --- | --- | --- |
| `autoAssign` (on/off switch for automatic assignment at handoff and at arrival) | on | `inbox_routing` (when off, rules do not run at all: **this switch also stops arrival routing; default on keeps today**) |
| `claimSetsOwner` | off | none |
| `ownerMode` (`independent / owner_first / keep_in_sync`) | independent | `inbox_assignment_sticky` + `inbox_routing` |
| `continuityDays` (empty = no window) | empty | same |
| `promptOwnerOnReassign` | off | same |
| `notifyQueue` | on | none |

Teams (existing Teams screen, existing columns, now **used**): `assignment_strategy` (`manual` default, `round_robin`, `least_loaded`), `business_hours` + `timezone` (a team inside hours; empty = always open), `default_assignee_id`
(the "not used yet" note in the Teams screen is removed; `device_ids` stays out of scope and is untouched).

### 4.7 Run log and trace (minimal, now)

`conversation_handoffs` is both the card and the log: one row per handoff with `trace jsonb` (ordered `{step, who?, result, why}` lines: considered, skipped with reason (`on_leave`, `delegate_used`, `offline`, `over_capacity`, `cannot_read`, `team_closed`,
`no_owner`, `owner_ineligible`, `window_expired`, `rules_not_in_plan`, `auto_assign_off`, `no_rule_matched`), chosen), the outcome and the source. The conversation timeline shows the same summary in the `handoff_requested` / `assigned` events; the
agent sees the pinned card in the thread (reason, summary, answers, who/what handed over, why this person); a manager sees the trace line "why" in the card's details. A full screen (test box, filters, export) is BL-409.

## 5. Data model (expand-only)

Migration 1 `20270301090000_handoff_schema.sql`: `conversations` + `handling`, `handling_since`, `assigned_source` (nullable, no default, CHECK `NOT VALID`), partial index on `(org_id, handling_since) WHERE handling = 'waiting'`;
new tenant table `conversation_handoffs` (composite PK/FKs, RLS forced, `touch_row`; columns: `uuid, conversation_id, source, reason, reason_text, summary, answers jsonb, destination_kind, destination_team_id, destination_user_id,
priority, status ('waiting','assigned','returned','resolved','cancelled'), outcome ('assigned','waiting','unavailable'), assigned_user_id, assigned_team_id, trace jsonb, idempotency_key, flow_run_id, node_id, created_at, completed_at`; unique `(org_id, idempotency_key)`;
partial unique `(org_id, conversation_id) WHERE status IN ('waiting','assigned')`); `workspace_settings` + the six settings columns. Migration 2 validates the CHECKs. No data migration: every existing row is `NULL` = today's behaviour.
No permission migration (reuse of `assign_self`, `assign`, `settings.read`, `routing.manage`), hence no locked-role unlock pattern is needed. New plan key `inbox_assignment_sticky` (`productLine: chat`, `default: true`; effective only together with `inbox_routing`).
Contracts: `team-inbox-routing-sla/handoff.ts` (input, outcome, trace, settings, card), `INBOX_TABS += 'waiting'`, summary gets `handling`, `handlingSince`, `handoff` (card), flow node data and ports, event names.

## 6. Permissions

| Action | Permission |
| --- | --- |
| See the queue | `inbox.conversation.read` (scope) + `read_unassigned` for the no-team queue |
| Claim | `inbox.conversation.assign_self` |
| Assign from the queue, send to queue | `inbox.conversation.assign` |
| Return to bot | `inbox.conversation.reply` |
| Handoff settings | read `inbox.settings.read`, write `inbox.routing.manage` |
| A bot (flow, AI agent) handing off | no permission check, as `assignFromFlow` today (the author decided); refusals are traced, never silent |

## 7. Plan gating

| Capability | Basic (no `inbox_routing`) | `inbox_routing` | `inbox_routing` + `inbox_assignment_sticky` |
| --- | --- | --- | --- |
| Handoff node / AI handoff / keyword / manual send to queue | yes | yes | yes |
| Waiting queue, claim, manual assign, queue notifications, handoff card, trace | yes | yes | yes |
| Destination person or team (manual team = queue) | yes | yes | yes |
| Team method round robin / least busy at handoff | no (queue) | yes | yes |
| Destination "assignment rules" at handoff, arrival routing | no (degrades to the queue, hint shown) | yes | yes |
| Claim sets the contact owner when empty | yes | yes | yes |
| Owner first, keep in sync, continuity window, prompt on reassign | no | legacy "keep returning contacts" only | yes |

`inbox_assignment_sticky` defaults to true for plan rows that predate it, so Standard (which has `inbox_routing`) gets it and nothing changes for anyone today; the owner can switch it off for Standard and keep it on Pro in plan management with no code change.
Each capability checks one named key through `HANDOFF_GATES` (`contracts`), so moving one is a data change.

## 8. Phases

| Phase | Content |
| --- | --- |
| P1 (built with this note) | BL-396 to BL-404: handoff service, state, mute, card, queue, claim, notifications, node and ports, AI/keyword wiring, rules at handoff behind the plan, owner modes, first-touch owner, sync both ways, team settings used, minimal trace, help, API doc, wiring, 21 locales |
| P2 | BL-405 capacity limits as a setting and accept-or-return timers; BL-406 reassign on offline/leave and overflow chains |
| P3 | BL-407 skills/weights/offers; BL-408 assignment reports; BL-409 assignment test box and run log screen; BL-410 unify the Unassigned tab with the queue, rules builder for "customer asks for a person" / bot failure triggers, return-to-bot at a chosen node, queue visibility for `own` readers |

## 9. State and compatibility checklist

Old `AssignAgent` flows: same config, same port, same effect (legacy path). Existing routing rules and the arrival path: unchanged, except the switch `autoAssign` (default on) and the added trace. Kanban and inbox filters: unchanged, `status` untouched. `routing_keep_contact_agent`: unchanged.
Realtime payloads gain fields (additive). Old mobile clients ignore `handling`.

## 10. Risks

* Muting is the one visible behaviour change for flows using the **new** node; the legacy node never mutes (compatibility). A run left parked while muted can idle out (the engine's normal limits).
* Two writers to `conversations` (handoff, routing) share the row lock and `assignInTx`; a unit test runs a handoff and an arrival routing concurrently on one conversation.
* Sync could move chats people care about: limited to automatic chats, off unless the mode is chosen, every move audited with its source.
* The record engine runs from the outbox, later than the inbound: owner-first on the very first message sees no owner when the engine is slower than the handoff; this is by design (fall through), not a bug.
* `own`-scope readers cannot see a queue (limitation, documented, BL-410).

## 11. Evidence list

`team-inbox-routing-sla/{assignment.service,routing-engine.service,routing-inbound.listener,routing-rules.repository,routing-rules.controller}.ts`; `flow-runtime-engine/runtime/nodes/actions/{actions-nodes,actions-config}.ts`, `graph/compile-graph.ts`, `triggers/inbound.service.ts`,
`runtime/engine.service.ts`; `chat-conversations/inbound-hooks.ts`; `chatbot-widget/{ai-prompt,widget-ai-reply.service}.ts`; `infra/providers/flow-runtime-engine/ai-agent-handoff.port.ts`; `crm/contact-assignment/contact-assignment.engine.ts` + repository;
`packages/db/migrations/20261130090000_owner_reassign.sql`; `kernel/rbac/scope/conversation-scope.ts`; `contracts/src/plans-subscriptions-trials/catalogue.ts`.

## 12. Backlog

See `docs/backlog.md` section AF (BL-396 to BL-410).

## 13. Decisions (defaults taken; the owner can reverse any of them)

| # | Decision | Default taken | Alternative |
| --- | --- | --- | --- |
| H1 | Handling state | separate nullable column `handling`, NULL = untracked | derive from assignee + flow run |
| H2 | Claim permission | reuse `inbox.conversation.assign_self` | new `inbox.conversation.claim` (needs a locked-role migration) |
| H3 | Mute without cancelling the run | yes | end the run on handoff (loses the branch to come back to) |
| H4 | Legacy `AssignAgent` | legacy path, no mute | mute everywhere |
| H5 | Rules at handoff without the plan | degrade to the queue, hint in the builder and the run trace | refuse the publish |
| H6 | `autoAssign` switch also stops arrival routing | yes, default on (= today) | switch only for handoff |
| H7 | Sticky gate | new key `inbox_assignment_sticky`, default true, needs `inbox_routing` | reuse `inbox_routing` only |
| H8 | Sync direction | contact owner -> open automatic chats; claim -> empty contact owner; never both for one trigger | bidirectional |
| H9 | AI agent handoff | one action (`HandoffService`); the widget AI uses a structured marker `[[handoff: reason]]` in the model output and the keyword, because `AiChatPort` has no tool calling; a real tool call plugs into the same method | wait for tool calling |
| H10 | Team queue notification | team members; no-team queue: everyone who may read unassigned and reply | managers only |
| H11 | Off-hours | still enters the queue, outcome `unavailable`, off-hours message | do not queue |
| H12 | Run log | `conversation_handoffs.trace` | separate run table (BL-409) |
| H13 | A rule's "When" is not mandatory | Per-rule switch "Only for conversations that match..." (off by default = the rule applies to every new conversation). New column `routing_rules.applies_to_all boolean NOT NULL DEFAULT false` (expand-only, migration `20270321090000`). Conditions stay stored but are ignored while the switch is off; the editor shows only the conditions the admin added (menu: New or returning contact, Channel, Message words, Language, Business hours, Contact details). Nothing is inferred from empty conditions: a hand-edited non-fallback rule with no conditions never matched and still does not; the API refuses such a rule unless it is the fallback or `appliesToAll` is true (a client that sends neither is refused as before). Real data: the owner's database (`crm_owner`, copied to a scratch db, 37 pending migrations applied, exit 0) has 2 workspaces and 0 routing rules, so nothing existing changes meaning; the column is needed anyway to keep conditions while ignoring them | infer "catch-all" from empty conditions (rejected: silently turns dormant hand-edited rows on) |
| H14 | One pipeline, one page | `/auto-assignment` shows, top to bottom: the four switches in the owner's wording (H21) with Advanced under them; the optional layer "Need more control? Add rules": step 1 contact owner / sticky agent (the switches), the rules in priority order (drag or arrows, one readable sentence per rule, on/off switch, fired count), "Everyone else" pinned last, then the waiting queue; "Try it"; "Where this applies". The old `/assignment-settings` page and its settings tile are folded into Advanced (the address redirects); basic plans keep the queue, claim and manual assignment and see locks with an upgrade hint, never hidden controls | keep two pages |
| H15 | "Everyone else" has three explicit choices | Distribute evenly (a fallback rule whose assign action has `everyone: true`: round robin or least busy over every active member who can open the inbox and is available: not offline or busy, not on leave, under their chat limit), listed agents or teams, or the waiting queue (the row is switched off, or absent). The row is created by an admin action only: choosing "evenly", or switching Auto Assignment from off to on when no fallback exists. Never by a migration or at deploy: a workspace with no fallback today keeps leaving chats unassigned. Verified: real-data copy has 0 fallback rows and the migration creates none; e2e test "a workspace that never set a fallback keeps leaving conversations unassigned" | auto-create at deploy (rejected: silent behaviour change) |
| H16 | New or returning contact is a first-class condition | `conditions.contactKind` = `any | new | returning`. Returning = the contact has another conversation, or was saved more than 10 minutes before now (so an imported contact is returning, a contact the very chat created is new). A chat without a contact matches neither. Read in one query, and only when an active rule asks | rely on contact fields being empty |
| H17 | Contact details match what is already saved | At arrival the contact was created by the same message in the same transaction (`resolveOrCreateByIdentity`): stage is the column default `new` (so "Stage is not empty" is true for every contact that exists, which is why admins used it to mean "everyone"), no tags, no owner, no custom fields. A chat with no contact (plan limit, no address) matches no contact-detail condition. The editor says so, and "Try it" shows "this contact does not have that saved". At handoff the rules read the contact row inside the handoff transaction, so values a flow saved to the contact before the node count (e2e "rules at handoff time") | |
| H18 | Handoff evaluates the same list | A Human handoff node with a named person ignores the rules; with a named team it uses the team's method; with destination "assignment rules" it evaluates the rules in priority order, then Everyone else, then the waiting queue, against the contact, the channel and the customer's LATEST message. The flow node passes `user_message` (the latest typed message), the widget passes the message, and a manual "send to queue" passes none: the engine then reads the conversation's latest incoming text message (`latestCustomerText`). Before, the manual path passed nothing and keyword conditions never matched | |
| H19 | Warnings the page must show | A rule that applies to every conversation, is active and stops on match, sits above other active rules: those rules "never run unless nobody it points at is available" (names listed, "Never runs" on each row). A rule with neither conditions nor the switch is marked "Never matches". A rule that applies to every conversation is skipped for later messages of a live chat (it would otherwise answer or start a flow on every message); the fallback already was | |
| H20 | "Try it" is a dry run of the real code | `POST /v2/inbox/routing/test` (permission `inbox.settings.read`, plan `inbox_routing`): body contact (optional), channel, sample message, optional language and "pretend inside/outside business hours". `RoutingEngine.route()` and `dryRun()` call ONE method, `decideArrival`, which only reads and calls hooks for every write; `dryRun` passes no hooks AND runs in a `SET TRANSACTION READ ONLY` transaction. Answer: the deciding step (contact's agent, rule X, Everyone else, waiting queue, switch off), every step with the conditions that matched or not, the contact summary, and who was skipped and why (the handoff trace lines). With no contact the sample is a brand-new person and contact-detail conditions cannot be checked. Test: it snapshots rules (counters, cursor, actions, row versions), conversations, events, outbox and audit before and after every outcome and requires equality | copy the matching logic (rejected) |
| H21 | The four switches mean exactly what the engine does | (1) Auto Assignment = `autoAssign` (needs `inbox_routing`): off stops rules AND the contact's agent at arrival and sends the "assignment rules" handoff destination to the queue. (2) Sticky Agent = `keepContactAgent`: the contact owner first, then the person who held the last chat (window in Advanced); availability is not checked, leave and delegates are. (3) Assign Chat to Contact Owner = owner mode is not `independent` (turning it on sets `owner_first`; Advanced "Keep open chats with the owner" = `keep_in_sync`); with (2) also on, the owner wins and the last handler is second. (4) Assign Agent as Contact Owner = `claimSetsOwner`: set on a claim (and by a handoff under keep-in-sync), never overwrites an owner, NOT set when a rule assigns the chat. Known inconsistency left unchanged (no silent behaviour change): at a handoff to a team or to "assignment rules" the owner / sticky stage runs even when Auto Assignment is off, whereas at arrival it does not | wording that promises more than the engine does |
