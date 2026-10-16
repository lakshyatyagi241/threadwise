---
domain: team-inbox-routing-sla
code: TIB2
title: Team Inbox Routing Rules, Auto-Assignment, SLA, Snooze/Escalation and Reports
threadwise_version: '1.7.0'
sources_read: 52
---

# Team Inbox Routing Rules, Auto-Assignment, SLA, Snooze/Escalation and Reports

## Overview

TIB2 is the **automation and service-level layer of the Team Inbox**. TIB1 owns the conversation UI (queue list, thread, composer, notes, tags, kanban, bulk toolbar); TIB2 owns everything that decides _who gets a conversation, how fast it must be handled, when it comes back, and how the team is measured_:

1. **Business hours** (per workspace weekly schedule + timezone), consumed by the routing condition `outside_business_hours`, the outside-hours template auto-reply and the Flow "out of hours" trigger.
2. **Routing rules** (per workspace, ordered, JSON conditions and actions) evaluated by `RoutingEngine` on every inbound message from every text channel that funnels through it.
3. **Auto-assignment** (`AssignmentService`): manual / round_robin / least_loaded / sticky picking among team members filtered by agent availability and capacity; also the single writer of `assignee_user_id`/`assignee_team_id`.
4. **Escalation** ("if nobody replied in N minutes, run this follow-up action") and **snooze** ("hide until time T, then reopen and remind").
5. **SLA policies** (first-response and resolution targets, priority overrides, per-device scoping) plus the breach flagging sweep.
6. **Reports**: queue statistics snapshot, Team Performance page and AI Agent Performance page (both JSON-backed with today/week/month ranges and an optional device filter).
7. **Agent availability status** (online/away/busy/offline) with the per-day reply/resolution counters that feed the reports and the assignment capacity check.

Actors: **workspace owner/admin** (author routing rules, business hours, SLA policies via `routing.manage` / `sla.manage`), **manager** (assign anyone, snooze, resolve, open analytics pages; cannot edit rules or SLA), **agent** (claim a chat for themselves, snooze, reply), **viewer** (read-only), **the system** (inbound webhooks trigger the engine; poll-driven sweeps do escalation, snooze wake-up and SLA breach flagging). Platform admins bypass plan gates and workspace-role middleware but are not workspace members, so they fail the `routing.manage` / `sla.manage` permission checks unless impersonating.

Main flow end to end: an owner sets business hours and SLA policies, builds routing rules and gives each team an assignment strategy (team CRUD itself is WSP). A customer message arrives on any engine; the channel webhook stores it and calls `RoutingEngine::applyToInbound`, which (a) stamps SLA due dates on the first inbound, (b) runs the ordered rules (primary pass, then fallback pass), which may assign via `AssignmentService`, tag, prioritise, auto-reply, pin a flow for Node to start, or arm an escalation timer. An operator's first reply stops the first-response clock and disarms escalation. Sweeps piggy-back on the operator's 5-second queue poll (no cron): due escalations fire, due snoozes reopen and notify, overdue SLA clocks flip `sla_breached`. Managers watch `/team-inbox/analytics/team`.

Plan tiers: `access_routing_rules` (feature) and `routing_rules_limit` (row cap, counts inactive rules; null/0 = unlimited) gate rule creation; `access_sla_policies` soft-gates the SLA page (GET only, see QUIRK in TW-TIB2-025); `access_team_performance` soft-gates the two analytics pages; `access_business_hours` is a _display-only_ plan flag (a crown icon) that the server never enforces. All plan/role gates are bypassed for platform admins.

Connections: **TIB1** (conversation columns, queue poll host, kanban, bulk toolbar, resolve/reopen/priority/reply endpoints that call SLA hooks, thread header SLA countdown), **WSP** (teams, `team_user.capacity`, members, `strategy` field, workspace timezone), **RBAC** (`WorkspacePermissions` keys `routing.manage`, `sla.manage`, `inbox.assign`, `inbox.assign_self`, `inbox.snooze`; `ConversationPolicy`), **PLAN** (package flags/limits, `PlanLimitGuard`, `EnforcePlanFeature`), **NOTIF** (`NotificationDispatcher::notifyAssignment`/`notifySnoozeWake`/`notifySlaBreach`, `inbox_notifications`, web push, audit log), **AR** (`AutoReplyGuard`, keyword replies, away mode), **FLB/FLR** (`trigger_flow` action, flow "assign" node calls `AssignmentService`, Flow out_of_hours trigger), **AIAG** (`assign_agent` action, AI pause on human assignment, AI analytics fields), **WADEV/WABA/NODE** (inbound webhooks that call the engine; Node consumes `routing_actions.flow_id`), **SUPP** (platform SLA engine shares the `sla_policies` table and `SlaCalculator`), **DASH** (workspace analytics page also computes an agent roll-up), **CORE** (cache used as the sweep gate).

## Feature index

| Id          | Feature                                                    | Status      | Priority | Effort | Depends on                            |
| ----------- | ---------------------------------------------------------- | ----------- | -------- | ------ | ------------------------------------- |
| TW-TIB2-001 | Business hours schedule and workspace timezone             | implemented | P1       | M      | —                                     |
| TW-TIB2-002 | Outside-hours template auto-reply                          | partial     | P2       | S      | TW-TIB2-001                           |
| TW-TIB2-003 | Auto-reply cooldown and spam-threshold fields (unenforced) | dead-code   | P2       | S      | TW-TIB2-001                           |
| TW-TIB2-004 | List routing rules                                         | implemented | P0       | S      | —                                     |
| TW-TIB2-005 | Create routing rule                                        | implemented | P0       | M      | TW-TIB2-004                           |
| TW-TIB2-006 | Update and toggle routing rule                             | implemented | P0       | S      | TW-TIB2-005                           |
| TW-TIB2-007 | Delete routing rule                                        | implemented | P0       | S      | TW-TIB2-005                           |
| TW-TIB2-008 | Routing rules manager modal                                | implemented | P1       | M      | TW-TIB2-004, TW-TIB2-006, TW-TIB2-007 |
| TW-TIB2-009 | Routing rule builder form                                  | implemented | P1       | L      | TW-TIB2-005, TW-TIB2-006              |
| TW-TIB2-010 | Inbound routing pipeline (two passes, follow-up filtering) | implemented | P0       | L      | TW-TIB2-004                           |
| TW-TIB2-011 | Routing condition evaluator                                | implemented | P0       | M      | TW-TIB2-010                           |
| TW-TIB2-012 | Routing action: assign to team                             | implemented | P0       | M      | TW-TIB2-010, TW-TIB2-020              |
| TW-TIB2-013 | Routing action: assign to member                           | implemented | P1       | S      | TW-TIB2-010, TW-TIB2-020              |
| TW-TIB2-014 | Routing actions: set priority, add tag, mark spam, set SLA | partial     | P1       | M      | TW-TIB2-010                           |
| TW-TIB2-015 | Routing action: assign AI agent                            | implemented | P1       | S      | TW-TIB2-010                           |
| TW-TIB2-016 | Routing action: auto-reply                                 | implemented | P1       | M      | TW-TIB2-010                           |
| TW-TIB2-017 | Routing action: trigger flow                               | partial     | P1       | M      | TW-TIB2-010                           |
| TW-TIB2-018 | Routing action: schedule escalation                        | implemented | P1       | M      | TW-TIB2-010, TW-TIB2-019              |
| TW-TIB2-019 | Escalation sweep                                           | implemented | P1       | M      | TW-TIB2-018, TW-TIB2-032              |
| TW-TIB2-020 | Auto-assignment engine and strategies                      | implemented | P0       | L      | —                                     |
| TW-TIB2-021 | Assign and claim endpoint                                  | implemented | P0       | M      | TW-TIB2-020                           |
| TW-TIB2-022 | Unassign endpoint                                          | implemented | P0       | S      | TW-TIB2-020                           |
| TW-TIB2-023 | Agent availability status and activity counters            | partial     | P1       | M      | —                                     |
| TW-TIB2-024 | SLA policies JSON API                                      | implemented | P1       | M      | —                                     |
| TW-TIB2-025 | SLA policies settings page                                 | implemented | P1       | M      | TW-TIB2-024                           |
| TW-TIB2-026 | SLA policy selection and due-date computation              | partial     | P0       | M      | TW-TIB2-024                           |
| TW-TIB2-027 | SLA first-response and resolution hooks                    | implemented | P0       | S      | TW-TIB2-026                           |
| TW-TIB2-028 | SLA breach sweep                                           | implemented | P0       | M      | TW-TIB2-026, TW-TIB2-032              |
| TW-TIB2-029 | SLA breach notification and realtime event                 | dead-code   | P1       | S      | TW-TIB2-028                           |
| TW-TIB2-030 | Snooze a conversation                                      | implemented | P1       | M      | —                                     |
| TW-TIB2-031 | Snooze wake-up sweep                                       | implemented | P1       | M      | TW-TIB2-030, TW-TIB2-032              |
| TW-TIB2-032 | Poll-driven sweep scheduler (no cron)                      | implemented | P0       | M      | —                                     |
| TW-TIB2-033 | Queue statistics snapshot                                  | partial     | P2       | S      | TW-TIB2-023                           |
| TW-TIB2-034 | Team Performance analytics                                 | implemented | P1       | M      | TW-TIB2-023                           |
| TW-TIB2-035 | AI Agent Performance analytics                             | implemented | P2       | M      | —                                     |
| TW-TIB2-036 | Platform support-desk SLA engine and breach scan           | implemented | P2       | M      | TW-TIB2-024                           |

## Features

### TW-TIB2-001 — Business hours schedule and workspace timezone

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** —
- **Summary:** A workspace defines a 7-day weekly schedule (enabled flag, open time, close time per day) and a timezone. The schedule drives the routing condition "outside business hours", the optional outside-hours template auto-reply (TW-TIB2-002) and the Flow "out of hours" trigger. With no saved schedule the workspace is treated as always open.
- **Actors & access:** Read: any authenticated workspace member (also shipped inside `bootstrap`). Write: workspace permission `routing.manage` (Owner and Admin only; Manager/Agent/Viewer get 403). Only the **workspace owner** can change the timezone; for anyone else the timezone field is silently ignored while the hours are still saved. The plan flag `access_business_hours` is shown as a crown on the UI tile but is NOT enforced by the endpoint (QUIRK).
- **UX & screens:** Business hours modal (`#business-hours-modal`) inside `resources/views/user/team-inbox/index.blade.php`, opened from a "Business hours" button in the Routing Rules modal header and from an empty-state tile. Fields: timezone select (about 40 curated IANA zones, current workspace zone injected if not in the list), seven day rows (checkbox, from time, to time; the server supplies defaults Mon-Fri on 09:00-18:00 with Sat/Sun off when nothing is saved; the JS fallback for a day key missing from a saved config is enabled 09:00-18:00), "When a message arrives outside hours" select (Do nothing / Auto-reply with a template) with a template select revealed only for the template choice (list = approved templates from bootstrap), and an "Anti-spam controls" pair (cooldown minutes default 720, spam threshold default 20) covered by TW-TIB2-003. Buttons Cancel / Save hours. Toasts: "Business hours saved", "Save failed", "Failed to load business hours". A collapsible "How business hours work" diagram explains the flow.
- **Endpoints:**
  | Endpoint                           | Route name                                | Action                                  | Middleware   | Request   | Response                                                                                                                                                                                                         |
  | ---------------------------------- | ----------------------------------------- | --------------------------------------- | ------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET team-inbox/api/business-hours  | user.team-inbox.api.business-hours.index  | TeamInboxController@businessHoursIndex  | Authenticate | none      | `{timezone, business_hours}`; timezone falls back to app timezone; `business_hours` falls back to the built-in default (Mon-Fri 09:00-18:00 enabled, weekend off, outside_action none, outside_template_id null) |
  | POST team-inbox/api/business-hours | user.team-inbox.api.business-hours.update | TeamInboxController@businessHoursUpdate | Authenticate | see rules | `{ok:true, timezone, business_hours}`                                                                                                                                                                            |
- **Data:** `workspaces.business_hours` (JSON, null = 24/7), `workspaces.timezone` (varchar 64, default UTC). JSON shape: `days.{mon..sun}.{enabled:bool, from:"HH:MM", to:"HH:MM"}`, `outside_action` in {none, template}, `outside_template_id` (int or null), `auto_reply_cooldown_min`, `spam_threshold_msgs`, `spam_window_seconds` (last three: TW-TIB2-003).
- **Rules & edge cases:**
  1. Validation: `timezone` nullable string max 64 and a valid PHP timezone identifier; `business_hours` and `business_hours.days` required arrays; each of the seven day keys required with `enabled` boolean, `from` and `to` in `H:i` format and `to` strictly after `from` (so overnight shifts are impossible; a day that spans midnight must be modelled as two days or left 24/7 by not saving); `outside_action` required in {none, template}; `outside_template_id` nullable integer that must exist in `wa_templates.id` (NOT scoped to the workspace; a foreign id passes validation and later silently does nothing because the send path re-scopes); `auto_reply_cooldown_min` 1..10080; `spam_threshold_msgs` 2..500; `spam_window_seconds` 5..3600.
  2. Save replaces the whole `business_hours` JSON with the validated payload (unknown keys are dropped by the validator's output).
  3. `Workspace::isOutsideBusinessHours(at?)`: returns false when there is no config or no `days`; converts "now" to the workspace timezone (falls back to app timezone); day key = lowercase three-letter weekday; a missing or disabled day = outside; inside means `from <= HH:MM < to` by string comparison (the close minute itself is outside).
  4. `outside_action=template` with a null template id validates fine but sends nothing.
  5. No holiday calendar, no per-team override (the `teams.business_hours`/`teams.timezone` columns exist but nothing reads or writes them).
  6. Response reflects the stored timezone, so a non-owner sees the old zone come back.
- **Async & events:** none. Read by routing (TW-TIB2-011), outside-hours reply (TW-TIB2-002), Flow enrolment `inboundFlowKinds` (FLR) which adds `out_of_hours` when outside hours.
- **External systems:** none.
- **Settings:** package flag `access_business_hours` (cosmetic only). Default schedule constant lives in `Workspace::defaultBusinessHours()`.
- **Acceptance criteria:**
  - Given an Owner with no saved schedule, When they open the modal, Then Mon-Fri show enabled 09:00-18:00 and the timezone select shows the workspace timezone.
  - Given an Admin posts a schedule with `to` earlier than or equal to `from` on any day, When saved, Then a 422 validation error is returned and nothing is stored.
  - Given a non-owner Admin posts a new timezone with valid hours, When saved, Then hours persist and the timezone is unchanged.
  - Given a Manager posts valid data, When saved, Then 403.
  - Given a schedule where Tuesday is disabled, When a message arrives Tuesday noon workspace time, Then `outside_business_hours` evaluates true.
  - Given exactly the configured `to` time, When evaluated, Then the workspace counts as outside hours.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (businessHoursIndex, businessHoursUpdate), `app/Models/Workspace.php` (BUSINESS_HOURS_DAYS, defaultBusinessHours, isOutsideBusinessHours), `resources/views/user/team-inbox/index.blade.php` (business hours modal), `resources/js/charts/user-team-inbox-index.js` (Business Hours section), `database/migrations/2026_05_14_010000_add_business_hours_to_workspaces.php`, `routes/web.php`, `Documentation/pages/messaging/team-inbox.html`.
- **Port notes:** put on `org_settings` (JSONB) or a `business_hours` table keyed by org; timezone belongs to the org record (WSP). Store weekly windows as an array of {day, start, end} and validate with the same "end after start" rule; consider allowing multiple windows per day and overnight windows, which Reference cannot express. Expose a shared `isOutsideBusinessHours(orgId, at)` helper because routing, SLA (see TW-TIB2-026 QUIRK) and flows all need it. RLS on org_id.
- **Port status (business hours editor):** the CRM read the schedule but had no way to write it, so nobody could change the hours. Added `GET`/`PUT /v2/inbox/routing/business-hours`, the "Business hours" dialog on the Auto-assignment screen, and the workspace zone is now read from `organizations.settings.timezone` by the routing engine and the SLA clock. Still open: the flows, leads and support-desk readers of the zone (wiring WIRE-TIB-BH-05). See `wiring/team-inbox-routing-sla.md` WIRE-TIB-BH.

### TW-TIB2-002 — Outside-hours template auto-reply

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-TIB2-001
- **Summary:** When business hours are configured with `outside_action = template`, an inbound customer message that arrives outside hours triggers an automatic reply with the chosen template's body text. It works only for the unofficial-API (Baileys) inbound path.
- **Actors & access:** System (inbound webhook). Configured by Owner/Admin in TW-TIB2-001.
- **UX & screens:** No screen of its own; outbound message appears in the thread as a normal outbound bubble tagged origin `outside_business_hours`.
- **Endpoints:** none of its own (triggered inside the Node-to-Laravel inbound endpoint handled by `WaInboundController`, owned by WADEV/NODE).
- **Data:** writes `inbox_messages` (direction out, status pending, meta `{target_jid, origin:'outside_business_hours'}`), updates `conversations.preview`, `last_message_at`, `last_outbound_at`, stamps `routing_meta.last_auto_reply_at`.
- **Rules & edge cases:**
  1. Runs on EVERY inbound (not only new conversations), after routing, the opt-out check, the AI-agent reply and the voice-assistant reply.
  2. Skips when the workspace is not outside hours, `outside_action != template`, template id missing, template not in the same workspace, or template body blank.
  3. Sends only the template's `template_body` text (no header, footer, buttons or variables), to the digits of `conversations.raw_jid`, from the conversation's device number.
  4. Guarded by `AutoReplyGuard::canAutoReply`, which is currently hard-wired to always true, so there is NO cooldown: a customer sending five messages after hours receives five replies (QUIRK; the UI promises a 12h cooldown, see TW-TIB2-003).
  5. Not called from the WABA/Twilio webhook or any of the social/SMS/email channel handlers, so those channels never get an outside-hours reply (QUIRK/partial).
  6. Does not check first-message-only or that a human already replied.
  7. Mid-send failures are swallowed with a log line; the pending message row remains.
- **Async & events:** message handed to `InboxDispatcher::send` (Node bridge for Baileys). No queue job, no audit entry, no webhook.
- **External systems:** Node/Baileys bridge via `InboxDispatcher`.
- **Settings:** `workspaces.business_hours.outside_action`, `outside_template_id`.
- **Acceptance criteria:**
  - Given outside hours and a configured template, When a Baileys customer messages, Then exactly one outbound pending message with the template body is created and dispatched.
  - Given the same setup and the customer messages three times in a minute, When each arrives, Then three replies are sent (documents current no-cooldown behavior; port may add the cooldown from TW-TIB2-003).
  - Given a WABA customer messages outside hours, When it arrives, Then no outside-hours reply is sent in Reference (parity note; port should decide whether to fix).
  - Given the template belongs to another workspace, When triggered, Then nothing is sent.
- **Source refs:** `app/Http/Controllers/WaInboundController.php` (maybeSendOutsideHoursReply and its call site), `app/Services/Inbox/AutoReplyGuard.php`, `app/Models/Workspace.php`.
- **Port notes:** implement as a routing-pipeline step shared by all channels (a worker job on `inbound.message.received`) instead of a Baileys-only inline call; use the AR domain's auto-reply guard once it exists; render the whole template (header/buttons) through the WhatsApp adapter rather than only the body.

### TW-TIB2-003 — Auto-reply cooldown and spam-threshold fields (unenforced)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-TIB2-001
- **Summary:** The Business hours modal lets an admin set a per-contact auto-reply cooldown (default 720 minutes) and a spam threshold (default 20 messages per 60 s), and the routing help text promises that flooding contacts get flagged as spam. The values are saved but no code path reads them.
- **Actors & access:** Same as TW-TIB2-001.
- **UX & screens:** "Anti-spam controls" section of the Business hours modal: number inputs `#bh-cooldown` (min 1, max 10080, unit minutes) and `#bh-spam-threshold` (min 2, max 500, unit "msgs / 60s"). UI clamps to minimum 1 and 2 on submit.
- **Endpoints:** part of POST team-inbox/api/business-hours (TW-TIB2-001).
- **Data:** `workspaces.business_hours.auto_reply_cooldown_min`, `.spam_threshold_msgs`, `.spam_window_seconds` (the window field is validated 5..3600 but the UI never sends it).
- **Rules & edge cases:**
  1. `AutoReplyGuard` was deliberately disabled ("auto-replies fire on every inbound message"): `canAutoReply` always returns true; `markReplied` only stamps `routing_meta.last_auto_reply_at` for display.
  2. Per-rule cooldown and delay for keyword auto-replies live in `keyword_replies.cooldown`/`timeout` (AR domain), not here.
  3. The routing rule form still tells users that auto-reply "respects 12h cooldown" (stale copy).
  4. Nothing sets `conversations.is_spam` from message flooding.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** fields above.
- **Acceptance criteria:**
  - Given an admin saves cooldown 30 and threshold 5, When the schedule is read back, Then the three values round-trip.
  - Given any inbound flood, When routing runs, Then Reference does not throttle (parity); the port must decide to implement or drop.
- **Source refs:** `app/Services/Inbox/AutoReplyGuard.php`, `app/Http/Controllers/TeamInboxController.php` (businessHoursUpdate validation), `resources/js/charts/user-team-inbox-index.js`, `resources/views/user/team-inbox/index.blade.php`.
- **Port notes:** either implement a real per-contact cooldown/flood guard in the auto-reply worker (recommended: Redis key per org+contact) or omit the fields; do not port the misleading copy.

### TW-TIB2-004 — List routing rules

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** —
- **Summary:** Returns every routing rule of the current workspace so the rules manager (and the routing engine's authors) can show them. The same list is embedded in the inbox `bootstrap` payload.
- **Actors & access:** Any authenticated workspace member can read (no `routing.manage` check on GET, and `bootstrap` ships the rules to every member, including viewers). Workspace scope = `users.current_workspace_id`.
- **UX & screens:** consumed by the Routing Rules modal (TW-TIB2-008) and the rail badge showing the count of active rules (hidden when zero).
- **Endpoints:**
  | Endpoint                   | Route name                        | Action                           | Middleware   | Request | Response                                                                                                                                                       |
  | -------------------------- | --------------------------------- | -------------------------------- | ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET team-inbox/api/routing | user.team-inbox.api.routing.index | TeamInboxController@routingIndex | Authenticate | none    | JSON array of all rule rows (id, workspace_id, name, conditions, actions, stop_on_match, is_active, is_fallback, sort, fired_count, last_fired_at, timestamps) |
- **Data:** `routing_rules` read, ordered by `sort` ascending only (ties come back in unspecified order; the engine itself orders by `sort` then `id`, so the two can disagree for equal sort values). No pagination; volume is small (plan cap `routing_rules_limit`).
- **Rules & edge cases:**
  1. Includes inactive and fallback rules.
  2. The `bootstrap` response also carries `routing_rules` (same ordering, no permission filter), plus `flows` (active flows), `templates` (approved templates), `teams`, `members`, `ai_agents`, `devices` used by the builder.
  3. Soft delete is not used; deleted rules are gone.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace with three rules, When any member calls the endpoint, Then all three are returned ordered by `sort`.
  - Given a workspace with no rules, When called, Then an empty array is returned.
  - Given a rule in another workspace, When called, Then it is never included.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (routingIndex, bootstrap), `app/Models/RoutingRule.php`, `routes/web.php`.
- **Port notes:** target module `apps/api/src/modules/inbox-routing`; table `routing_rules` with org_id + RLS. Restrict reads to roles that can see automation config unless product wants agents to see rules (Reference leaks them to viewers). Add a deterministic `ORDER BY sort, id`.

### TW-TIB2-005 — Create routing rule

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-TIB2-004
- **Summary:** An Owner/Admin creates a named rule made of conditions and actions, with flags for stop-on-match, fallback and active. Creation is plan-gated by both a feature flag and a row limit.
- **Actors & access:** workspace permission `routing.manage` (Owner, Admin). Plan: feature `access_routing_rules` must be on (else 422 `feature_disabled`), and `routing_rules_limit` must not be reached (else 422 `limit_reached`); platform admins bypass both.
- **UX & screens:** Rule builder (TW-TIB2-009) "Save rule".
- **Endpoints:**
  | Endpoint                    | Route name                        | Action                           | Middleware   | Request                                                                                                                                                                                                                                                                                | Response          |
  | --------------------------- | --------------------------------- | -------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
  | POST team-inbox/api/routing | user.team-inbox.api.routing.store | TeamInboxController@routingStore | Authenticate | `name` (required, string, max 128), `conditions` (array; required with min 1 unless `is_fallback` true, then only `present`), `actions` (required array, min 1), `stop_on_match`, `is_active`, `is_fallback` (nullable booleans), `sort` (nullable integer), per-action id rules below | `{ok:true, rule}` |
- **Data:** inserts `routing_rules` with `workspace_id` = current workspace. DB defaults when a flag is omitted: `stop_on_match` true (!), `is_active` true, `is_fallback` false, `sort` 0, `fired_count` 0. `conditions`/`actions` stored as JSON.
- **Rules & edge cases:**
  1. Per-action validation: every `actions.*` must be an array with `type` required string max 32; `user_id` (nullable integer) must be a member of this workspace (`workspace_user`); `team_id` must be a non-deleted team of this workspace; the nested escalation `then_action.team_id` / `then_action.user_id` are scoped the same way. Friendly messages: "That member is not part of this workspace." / "That team is not part of this workspace." / "Add at least one condition, or mark this rule as the fallback."
  2. Other action keys (`value`, `name`, `color`, `body`, `template_id`, `flow_id`, `agent_id`, `minutes`, `sla_policy_id`) are NOT validated; the controller stores the raw `actions` input after validation. Unknown action `type` strings are accepted and silently ignored by the engine.
  3. Condition entries are not validated at all (field/op/value can be anything; unknown fields evaluate against null).
  4. The row-limit check counts ALL rules including inactive ones and is checked before validation (limit error wins over validation errors); null or <= 0 limit = unlimited.
  5. `sort` is never sent by the UI, so UI-created rules all have sort 0 and evaluate in creation (`id`) order; there is no reorder endpoint and the "drag-reorder" tip in the modal help is not implemented (QUIRK).
  6. No audit-log entry and no duplicate-name check.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package `access_routing_rules` (bool), `routing_rules_limit` (int or null).
- **Acceptance criteria:**
  - Given an Owner on a plan with routing enabled and limit 3 with 3 existing rules, When they create another, Then 422 with plan_limit_reached and nothing inserted.
  - Given a non-fallback rule with an empty `conditions` array, When posted, Then 422 "Add at least one condition, or mark this rule as the fallback."
  - Given `is_fallback` true with `conditions: []`, When posted, Then it is created and later matches every message that no primary rule matched.
  - Given an action `assign_user` with a user id from another workspace, When posted, Then 422 "That member is not part of this workspace."
  - Given an Agent posts, When called, Then 403.
  - Given a plan without `access_routing_rules`, When an Owner posts, Then 422 feature_disabled.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (routingStore, routingActionRules, routingActionMessages), `app/Services/PlanLimitGuard.php`, `app/Exceptions/PlanLimitReachedException.php`, `app/Models/RoutingRule.php`, `app/Support/WorkspacePermissions.php`.
- **Port notes:** validate action payloads with a discriminated-union schema per action type (zod in `packages/contracts`) instead of storing raw JSON; add real `sort` handling plus a reorder endpoint; keep the org-scoped FK checks (RLS makes cross-org ids impossible, still return the friendly 422). Enforce plan limits via the PLAN domain guard.

### TW-TIB2-006 — Update and toggle routing rule

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-TIB2-005
- **Summary:** Edits any subset of a rule's fields; the UI also uses it to switch a rule on or off with a body of only `is_active`.
- **Actors & access:** `routing.manage`. No plan-feature or limit check on update (reactivating never counts against the limit).
- **UX & screens:** rules list enable/disable icon; builder form in edit mode.
- **Endpoints:**
  | Endpoint                          | Route name                         | Action                            | Middleware                | Request                                                                                                                                                                                                                                       | Response                                                                |
  | --------------------------------- | ---------------------------------- | --------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
  | PATCH team-inbox/api/routing/{id} | user.team-inbox.api.routing.update | TeamInboxController@routingUpdate | Authenticate (id numeric) | `name` (sometimes, required, max 128), `conditions` (sometimes array), `actions` (sometimes array, min 1), `stop_on_match`, `is_active`, `is_fallback` (sometimes boolean), `sort` (sometimes integer) + same per-action id scoping as create | `{ok:true, rule}` (fresh row); 404 if the rule is not in this workspace |
- **Data:** updates `routing_rules`.
- **Rules & edge cases:**
  1. Lookup is scoped to the workspace (`findOrFail`), so a foreign id is 404.
  2. When `actions` is present the raw input array replaces the stored actions (same passthrough as create).
  3. `conditions` may be set to an empty array on a non-fallback rule with no error; such a rule then never matches (see TW-TIB2-010 rule about empty conditions).
  4. Changing `is_fallback` is allowed at any time.
  5. `fired_count` and `last_fired_at` are engine-owned and cannot be changed here (not fillable via validation output).
- **Async & events:** none; no audit entry.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a rule, When the client PATCHes `{is_active:false}`, Then only that flag changes and the rule stops firing.
  - Given a PATCH whose actions include a foreign team id, When sent, Then 422 and the rule is unchanged.
  - Given a rule id from another workspace, When PATCHed, Then 404.
  - Given a Manager, When PATCHing, Then 403.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (routingUpdate), `resources/js/charts/user-team-inbox-index.js` (toggle handler).
- **Port notes:** `PATCH /inbox/routing-rules/:id` with partial zod schema; use optimistic concurrency (`updated_at`) because two admins editing JSON blobs overwrite each other in Reference.

### TW-TIB2-007 — Delete routing rule

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-TIB2-005
- **Summary:** Permanently removes a rule.
- **Actors & access:** `routing.manage`.
- **UX & screens:** trash icon on the rules list with a browser `confirm("Delete rule <name>?")`; toast "Rule deleted." or "Delete failed: ...".
- **Endpoints:**
  | Endpoint                           | Route name                          | Action                             | Middleware   | Request | Response                             |
  | ---------------------------------- | ----------------------------------- | ---------------------------------- | ------------ | ------- | ------------------------------------ |
  | DELETE team-inbox/api/routing/{id} | user.team-inbox.api.routing.destroy | TeamInboxController@routingDestroy | Authenticate | none    | `{ok:true}`; 404 for other workspace |
- **Data:** hard-deletes the `routing_rules` row. Conversations keep any effects already applied and `routing_meta.fired_rules` ids that now dangle.
- **Rules & edge cases:** 1. Armed escalation timers already stored on conversations (`escalation_action`) survive rule deletion and still fire. 2. No audit entry.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an existing rule, When an Admin deletes it, Then it disappears from list and bootstrap and no longer fires.
  - Given an armed escalation from that rule, When the timer expires, Then it still executes.
  - Given another workspace's rule id, When deleted, Then 404.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (routingDestroy), `resources/js/charts/user-team-inbox-index.js`.
- **Port notes:** consider soft delete plus audit event for parity with the wider audit domain (NOTIF); add `rule.deleted` audit.

### TW-TIB2-008 — Routing rules manager modal

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2-004, TW-TIB2-006, TW-TIB2-007
- **Summary:** The "Routing Rules" modal lists rules in evaluation order with status chips, lets admins enable/disable, edit and delete them, and links to the rule builder and Business hours.
- **Actors & access:** visible only when the workspace permission `routing.manage` is granted (rail icon `#nav-routing` with active-rule count badge, and an empty-state tile "Routing rules" with a plan crown for `access_routing_rules`). Server enforces the permission on writes.
- **UX & screens:** modal `#routing-modal` in `resources/views/user/team-inbox/index.blade.php`: title "Routing Rules", subtitle about auto-assigning by content and contact details, collapsible "How routing works" ASCII diagram (rules walk top to bottom; stop-on-match; fallback rules last; tip "drag-reorder" is inaccurate), header buttons "Business hours" and "Add rule", list `#routing-rules-list` (skeleton cards while loading). Row: name, chips (`active`/`off`, `stop`, `fallback`), "N condition(s) / N action(s)", "Fired N times, last <time>" when fired at least once, icons Edit, Disable/Enable, Delete. Empty state: "No routing rules yet. Click 'Add rule' to create your first one." Toasts: "Rule enabled." / "Rule disabled." / "Failed: ...".
- **Endpoints:** uses TW-TIB2-004, -006, -007 endpoints; no own routes.
- **Data:** client state `routingRules` from bootstrap, refreshed after each change.
- **Rules & edge cases:** 1. Toggle sends only `{is_active}`. 2. Badge counts active rules only. 3. No pagination, search or reordering. 4. Plan crown is decorative; enforcement happens on create.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an Admin opens the modal with 2 rules (one off), When rendered, Then two rows show with an `off` chip on the disabled one and the rail badge shows 1.
  - Given a rule fired 5 times, When rendered, Then "Fired 5x" and last-fired time appear.
  - Given an Agent, When the inbox loads, Then the rail icon and tile are not rendered.
- **Source refs:** `resources/views/user/team-inbox/index.blade.php`, `resources/js/charts/user-team-inbox-index.js` (Routing Rules section, updateNavRoutingCount).
- **Port notes:** `apps/web/app/(inbox)/settings/routing`; implement real drag-to-reorder persisting `sort`.

### TW-TIB2-009 — Routing rule builder form

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-TIB2-005, TW-TIB2-006
- **Summary:** A modal form to compose one rule: name, a list of conditions (all must match), a list of actions, and three checkboxes. It hides options the workspace cannot use and validates action completeness client-side.
- **Actors & access:** `routing.manage`.
- **UX & screens:** `#routing-form-modal` ("Create rule" / "Edit rule"). Fields: Rule name (required, max 128, placeholder "e.g. Route sales keywords to Sales team"); Conditions (ALL must match, "+ Add condition"); Actions ("+ Add action"); checkboxes Stop on match, Fallback rule, Active (default checked for new rules). Condition row = field select + operator select + value input + remove. Fields offered: Message text, Contact phone, Channel, Priority, Hour of day (0-23), Day of week (0=Sun), Language, Outside business hours (yes/no dropdown), and "Incoming device (number)" only when the workspace has more than one paired device (multi-select of devices). Operators offered: equals, not equals, contains, not contains, starts with, ends with, matches regex, greater, greater-or-equal, less, less-or-equal. Action types offered: Assign to team, Assign to member, Assign AI agent, Set priority (low/normal/high/urgent), Add tag (free text name), Auto-reply (template select + optional free text), Trigger flow (flow select; a "no active flows" hint linking to /flows if none), Mark as spam (no value), Escalate if no reply (minutes 1..1440 + target team; then_action is always assign_team). A default first row is pre-added to both lists.
  Client-side validation on submit: assign_team needs a team, assign_user a member, assign_agent an AI agent, add_tag a name, auto_reply a template or text, trigger_flow a flow, escalation needs minutes and a team ("Incomplete action: ..."), at least one action ("Add at least one action."), and at least one condition unless Fallback is ticked. Submit shows "Saving...", toast "Rule saved." or "Save failed: <message>".
- **Endpoints:** POST/PATCH team-inbox/api/routing (TW-TIB2-005/-006).
- **Data:** builds `conditions: [{field, op, value}]` and `actions: [{type, ...}]` with keys `team_id`, `user_id`, `agent_id`, `value`, `name`, `template_id`, `body`, `flow_id`, `minutes`, `then_action:{type:'assign_team',team_id}`. Flags sent as 0/1.
- **Rules & edge cases:**
  1. The UI cannot author: `set_sla` action, `contact_tag` condition, `in`/`not_in`/`has_any` operators, nested condition groups (engine supports them), a per-condition case flag, escalation then-actions other than assign_team, or the `sort` field. Rules made via the API can use all of these.
  2. QUIRK: the "Incoming device" multi-select stores an array value but the operator list has no `in`; with equals the comparison is int == array and never matches, with not-equals it always matches. Device routing from the UI is effectively broken; through the API `in` works.
  3. QUIRK: "Outside business hours: No (inside hours)" stores the string "false"; with operator equals the engine's loose comparison treats the non-empty string as true, so the rule never matches while "Yes" works.
  4. Editing an existing rule rehydrates values (team, template+body, flow, minutes+team) from the saved action objects.
  5. Help text inside the modal claims the auto-reply "respects 12h cooldown" (stale; see TW-TIB2-003) and that assign-team routes to the least-busy member (actually honours the team's strategy, see TW-TIB2-012).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** devices list, teams, members, AI agents, templates, flows come from `bootstrap`.
- **Acceptance criteria:**
  - Given no conditions and Fallback unticked, When saving, Then the form refuses with the "Add at least one condition, or mark this rule as the fallback." toast and sends nothing.
  - Given an `assign_team` action without a team, When saving, Then "Incomplete action: assign_team needs a team." appears.
  - Given a workspace with a single device, When adding a condition, Then "Incoming device" is not offered.
  - Given an existing rule with escalation 10 min then team 4, When edited, Then the form shows 10 and team 4 preselected.
- **Source refs:** `resources/views/user/team-inbox/index.blade.php` (routing-form-modal), `resources/js/charts/user-team-inbox-index.js` (BASE_CONDITION_FIELDS, CONDITION_OPS, ACTION_TYPES, addConditionRow, addActionRow, submit handler).
- **Port notes:** build with a rule-builder component driven by the shared contracts schema, exposing every engine capability (groups, in/has_any, set_sla, tag conditions) and fixing the two QUIRKs above by typing values (boolean, id list) instead of loose strings.

### TW-TIB2-010 — Inbound routing pipeline (two passes, follow-up filtering)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-TIB2-004
- **Summary:** For every inbound customer message on an engine that calls it, `RoutingEngine::applyToInbound` starts the SLA clock (first inbound), then evaluates the workspace's active rules in order, runs the actions of matching rules, records what fired, and stops early when a matching rule has stop-on-match. Fallback rules run only if no primary rule fired.
- **Actors & access:** System. Called from inbound handlers: WhatsApp Baileys inbound (`WaInboundController`), WABA/Twilio webhook (`WaWebhookController`), LINE, Viber (text and non-text), SMS, WeChat, Telegram, Facebook Messenger ingest, TikTok ingest and Email (Mailtrixy ingest). It is NOT called for the embedded chatbot widget or the Instagram/Instaflow pull path (grep-verified), so rules and SLA never apply to those conversations.
- **UX & screens:** effects are visible in the thread timeline events `routing_rule_fired` (payload rule ids), `flow_triggered`, `assigned`/`reassigned`, and in the rules list "Fired N times".
- **Endpoints:** none (internal service). Node-facing side effect: the Baileys inbound endpoint returns `routing_actions.flow_id` (TW-TIB2-017).
- **Data:** reads `routing_rules`; writes `conversations` (assignee columns, priority, sla_policy_id, is_spam/inbox_status, escalation_due_at/action, assignee_agent_id, `routing_meta`), `conversation_tags`, `inbox_messages` (auto-replies), `conversation_events`; updates `routing_rules.fired_count` (+1 per fire) and `last_fired_at`.
- **Rules & edge cases:**
  1. Suppression: if the workspace's Meta Business Agent coexistence mode fronts the number (`suppressesOurAutoReply`), the whole engine (including SLA start) is skipped and a log line is written.
  2. SLA start: on the first inbound (conversation has no `first_response_at` and no `sla_first_response_due`) the SLA tracker computes due dates BEFORE rules run (TW-TIB2-026). Failure is logged, never thrown.
  3. Rules = active, this workspace, ordered by `sort` then `id`. Split into primary (not fallback) and fallback.
  4. Pass 1 runs primary rules; if none fired, pass 2 runs fallback rules.
  5. A rule matches when its conditions list is non-empty and every top-level condition/group is true (top level is AND). An empty conditions list matches only if the rule is a fallback (catch-all); a normal empty rule never matches.
  6. `isFollowUp` = the conversation already existed. On follow-ups only the per-message actions `add_tag`, `auto_reply`, `trigger_flow` run. Every other type (assign_team, assign_user, set_priority, mark_spam, set_sla, assign_agent, set_escalation) is dropped, so an operator's manual reassignment is not trampled. If a matching rule has no per-message action left it is skipped completely: not counted as fired, `stop_on_match` does not apply, and so fallback rules may still run on that follow-up (QUIRK). The source declares a one-shot list constant but does not use it.
  7. Each fired rule bumps `fired_count`, sets `last_fired_at`, and if `stop_on_match` the pass ends.
  8. After all: if anything fired, `routing_meta` is merged (keeping keys such as `pending_flow_id`, `voice_assistant_id`) with `fired_rules` (ids from this run only, overwriting the previous run) and `at`, and a `routing_rule_fired` event (actor type `rule`) is recorded on every inbound that fires, including follow-ups.
  9. Actions execute sequentially in array order; an unknown type is ignored; an assignment target rejected by `AssignmentService` (member removed, foreign team) is logged and skipped without aborting the remaining actions or the webhook.
  10. Any exception is caught by the inbound handler which logs a warning and continues delivering the message.
  11. There is no per-rule execution log, no dry-run/test mode and no rule versioning.
- **Async & events:** synchronous inside the inbound webhook request. No queue jobs. Assignment made by rules does NOT send the assignee a notification, broadcast `ConversationAssigned`, or fire the outbound `conversation.assigned` webhook (only the manual assign endpoint does), and the resulting `assigned` timeline event is recorded with actor type `user` although no user acted (QUIRK).
- **External systems:** none directly; auto-reply and flow triggers hand off to Node (TW-TIB2-016/017).
- **Settings:** rules themselves; `workspaces.meta_agent_enabled` + `ai_responder_mode` (suppression); timezone for hour-based conditions is NOT the workspace timezone (see TW-TIB2-011).
- **Acceptance criteria:**
  - Given rules R1 (stop_on_match, matches) and R2 (matches), When a new conversation arrives, Then R1's actions run, R2's do not, and R1's `fired_count` increments.
  - Given only a fallback rule with no conditions, When a message matches no primary rule, Then the fallback fires.
  - Given a rule with actions [assign_team, add_tag], When the customer sends a second message in the same conversation, Then only add_tag runs.
  - Given the workspace is in Meta-agent-only mode, When a message arrives, Then no rule fires and no SLA due dates are set.
  - Given a rule action points at a removed member, When the rule fires, Then a warning is logged, that action is skipped and later actions still run.
- **Source refs:** `app/Services/Inbox/RoutingEngine.php`, `app/Http/Controllers/WaInboundController.php`, `app/Http/Controllers/WaWebhookController.php`, `app/Http/Controllers/Line/LineWebhookController.php`, `app/Http/Controllers/Viber/ViberWebhookController.php`, `app/Http/Controllers/Sms/SmsWebhookController.php`, `app/Http/Controllers/WeChat/WeChatWebhookController.php`, `app/Http/Controllers/Telegram/TelegramWebhookController.php`, `app/Services/Facebook/FacebookIngestService.php`, `app/Services/Tiktok/TiktokIngestService.php`, `app/Services/Mailtrixy/MailtrixyIngestService.php`, `app/Models/RoutingRule.php`, `app/Models/ConversationEvent.php`.
- **Port notes:** implement as a BullMQ worker consuming a normalized `inbound.message.persisted` outbox event (all channels publish the same event, including widget and Instagram, closing the gaps above); keep the engine a pure function `(rules, conversation, context) -> plannedActions` for unit testing, then an executor with tenant context (RLS). Emit notifications and webhooks for rule-driven assignments too (a deliberate improvement; mark parity deviation).

### TW-TIB2-011 — Routing condition evaluator

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-TIB2-010
- **Summary:** Defines what a condition can look at and how values are compared, including nested AND/OR groups. It is the contract that stored rule JSON must satisfy.
- **Actors & access:** System.
- **UX & screens:** builder (TW-TIB2-009) authors a flat AND list only.
- **Endpoints:** none.
- **Data:** condition node = `{field, op, value, case?}`; group node = `{type:'group', op:'and'|'or', conditions:[...]}`, arbitrary nesting; top-level array is ANDed.
- **Rules & edge cases:**
  1. Fields: `message_text` (inbound text), `contact_phone` (sender digits / channel user id / email depending on channel), `contact_tag` (array from `context.contact_tags`), `channel` (`conversations.channel`), `priority`, `time_of_day` (integer hour 0-23 of "now"), `day_of_week` (0=Sunday), `language`, `outside_business_hours` (boolean from TW-TIB2-001, cached per engine call), `incoming_device` (`conversations.device_id`; for WABA/Twilio it is a provider-config id, so ids can collide with Baileys device ids). Any other field evaluates to null.
  2. QUIRK: no caller ever supplies `contact_tags` or `language` in the context, so `contact_tag` is always an empty list (has_any always false) and `language` is always an empty string; `equals`-style tests on them never match. The docs advertise "Contact tag" and "Language" conditions (docs-only in practice). `conversations.customer_language` exists but is not consulted.
  3. QUIRK: `time_of_day` and `day_of_week` use the application timezone (`now()`), not the workspace timezone, unlike `outside_business_hours` which uses the workspace timezone.
  4. Operators: `equals`, `not_equals` (loose PHP `==`), `contains`, `not_contains`, `starts_with`, `ends_with` (only true when the actual value is a string; `not_contains` is also false for non-strings), `in`, `not_in` (value must be an array, loose membership), `gt`, `gte`, `lt`, `lte` (loose numeric/string comparison), `has_any` (both sides arrays, non-empty intersection), `matches` (regex built as `#value#` plus `i` when case-insensitive, errors suppressed, invalid pattern = no match; a `#` in the pattern breaks it). Unknown operator = false. Default operator when missing = equals.
  5. Case handling: case-insensitive by default (`case` missing or `i`); when insensitive both string sides are lowercased with multibyte-safe lowercasing.
  6. Empty group = passes; group `op` defaults to and.
  7. Loose comparison QUIRK: a boolean actual compared with the string "false" is never equal (non-empty string is truthy), so `outside_business_hours equals "false"` never matches; use a real boolean or `equals true` with negation via `not_equals true`.
  8. Message text for non-text inbound may be empty; `message_text contains x` is then false.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given condition `message_text contains "REFUND"` and a message "I need a refund", When evaluated, Then true (case-insensitive default).
  - Given a group OR of two conditions where only the second is true, When evaluated, Then the group is true.
  - Given `contact_tag has_any ["vip"]`, When evaluated, Then false in Reference regardless of the contact's tags (parity note; port should feed real tags).
  - Given `time_of_day gte 9` and app timezone 08:30 while the workspace timezone is 09:30, When evaluated, Then false (uses app timezone).
  - Given `incoming_device in [36]` and a conversation on device 36, When evaluated, Then true.
- **Source refs:** `app/Services/Inbox/RoutingEngine.php` (matches, evalNode, evalOne, compare), `app/Models/Workspace.php`.
- **Port notes:** define the condition schema in `packages/contracts`; supply `contact_tags` and `language` from the contacts/translation modules; evaluate time fields in the org timezone; type-check operators against field types instead of PHP loose comparison.

### TW-TIB2-012 — Routing action: assign to team

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-TIB2-010, TW-TIB2-020
- **Summary:** Action `assign_team {team_id}` routes the conversation to a team and lets that team's configured assignment strategy pick the member.
- **Actors & access:** System (rule authored by `routing.manage`). New conversations only (one-shot, dropped on follow-ups).
- **UX & screens:** builder action "Assign to team" (team select).
- **Endpoints:** none.
- **Data:** writes `conversations.assignee_team_id`, `assignee_user_id`; reads `teams` (`assignment_strategy`, `device_ids`), `team_user`, `agent_statuses`.
- **Rules & edge cases:**
  1. `team_id <= 0` or missing = no-op.
  2. Device scope guard: the team is loaded within the conversation's workspace; if the team has a non-empty `device_ids` whitelist that does not include the conversation's `device_id` (a conversation with no device fails a non-empty whitelist), the action is skipped with an info log. Manual assignment through the UI is never device-restricted.
  3. If the team id is not in this workspace the team lookup is null, the device guard is bypassed and `AssignmentService` throws `team_not_in_workspace`, which the engine logs and swallows (no assignment).
  4. Strategy = the team's `assignment_strategy` when it is one of manual/round_robin/least_loaded/sticky, otherwise least_loaded. NOTE the docs and the form help say "least-loaded"; the code honours the team setting (a comment records that this used to be hard-coded). A team on `manual` therefore sets the team but resolves no member: the conversation stays user-unassigned in the team queue.
  5. No notification, no broadcast and no webhook is emitted for rule-driven assignment (see TW-TIB2-010 Async & events).
- **Async & events:** synchronous; timeline events `assigned` (or `reassigned` when a user was previously set) and optional `ai_handoff` (TW-TIB2-020).
- **External systems:** none.
- **Settings:** team strategy and device whitelist (WSP owns the editor).
- **Acceptance criteria:**
  - Given a team on round_robin with two online members, When a rule assigns a new conversation, Then the member with the oldest last assignment gets it.
  - Given a team scoped to device 5 and a conversation on device 7, When the rule fires, Then no assignment occurs and the conversation remains unassigned.
  - Given a team with strategy manual, When the rule fires, Then `assignee_team_id` is set and `assignee_user_id` is null.
  - Given a follow-up message, When the same rule matches again, Then the assignment is not re-run.
- **Source refs:** `app/Services/Inbox/RoutingEngine.php` (execute case assign_team, safeAssign), `app/Models/Team.php` (handlesDevice, STRATEGIES), `app/Services/Inbox/AssignmentService.php`.
- **Port notes:** teams live in the WSP module (`teams`, `team_members` already exist in the target). Add `strategy` and `device_ids` columns there. Call a shared `AssignmentService` from routing, flow node and API.

### TW-TIB2-013 — Routing action: assign to member

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-TIB2-010, TW-TIB2-020
- **Summary:** Action `assign_user {user_id}` puts a new conversation directly on a named workspace member, keeping the conversation's current team.
- **Actors & access:** System. New conversations only.
- **UX & screens:** builder action "Assign to member" (member select).
- **Endpoints:** none.
- **Data:** writes `assignee_user_id` (team column kept).
- **Rules & edge cases:** 1. Missing/zero `user_id` is skipped (a previous bug turned this into a silent unassign). 2. Strategy is `manual`; the target must be a live member of the workspace or the assignment is rejected and logged. 3. No availability or capacity check (manual). 4. Historically the builder never offered this action; the engine supported it from the start.
- **Async & events:** as TW-TIB2-012.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a rule assign_user 12, When a new conversation matches, Then `assignee_user_id` = 12 and the event `assigned` is recorded.
  - Given user 12 was removed from the workspace, When the rule fires, Then no assignment happens and the remaining actions run.
- **Source refs:** `app/Services/Inbox/RoutingEngine.php`, `app/Services/Inbox/AssignmentService.php`.
- **Port notes:** same shared assignment service.

### TW-TIB2-014 — Routing actions: set priority, add tag, mark spam, set SLA

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2-010
- **Summary:** Four small mutation actions: change the conversation priority, attach a workspace tag (creating it if needed, and enrolling the contact in tag-triggered flows), flag the conversation as spam, or pin an SLA policy id. The pinned SLA policy is effectively inert (see rules).
- **Actors & access:** System. `set_priority` and `mark_spam` are one-shot (dropped on follow-ups); `add_tag` also runs on follow-ups; `set_sla` is one-shot and cannot be authored from the UI.
- **UX & screens:** builder actions "Set priority" (low/normal/high/urgent), "Add tag" (free-text name), "Mark as spam" (no value). No `set_sla` option in the builder.
- **Endpoints:** none.
- **Data:** `conversations.priority`; `tags` firstOrCreate (workspace, slug = slug of name; default name "tag", colour from action `color` else `#075E54`) and the conversation-tag pivot via `syncWithoutDetaching`; `conversations.is_spam=1` and `inbox_status='spam'`; `conversations.sla_policy_id`.
- **Rules & edge cases:**
  1. `set_priority` applies only when the value is one of low/normal/high/urgent; otherwise no-op. It records no timeline event and does not broadcast.
  2. `add_tag` is idempotent; the tag lookup keys on the slug of the name, so "VIP" and "vip" map to the same tag. On success the flow enrollment service is asked to enrol the contact in flows triggered by "tag added" (errors swallowed). It does NOT check the plan tag limit and records no event.
  3. `mark_spam` moves the conversation out of the open queue (status spam) but does not stop later actions in the same rule and does not block the AI/auto-reply paths that run after routing.
  4. `set_sla` writes `sla_policy_id` (0 or missing becomes null) without validating that the policy belongs to the workspace. QUIRK: routing runs after the SLA tracker already computed due dates on the first inbound (TW-TIB2-010 rule 2), and the tracker never recomputes due dates afterwards, so a pinned policy changes nothing about the due timestamps. Likewise `set_priority` runs after due dates were computed, so priority overrides in the SLA policy (TW-TIB2-026) do not see the rule's priority.
- **Async & events:** none besides the flow enrolment side effect.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a rule add_tag "Refund", When it fires twice on the same conversation, Then exactly one tag row and one pivot row exist.
  - Given a rule set_priority "urgent", When it fires on a new conversation, Then `priority` = urgent.
  - Given a rule mark_spam, When it fires, Then the conversation no longer appears in the open queue.
  - Given set_sla pointing at policy 9, When the first inbound is processed, Then `sla_policy_id` = 9 but the previously computed due dates are unchanged (parity quirk).
- **Source refs:** `app/Services/Inbox/RoutingEngine.php`, `app/Services/Flow/FlowEnrollmentService.php` (onConversationTagged), `app/Models/Tag.php`.
- **Port notes:** decide whether `set_sla` should recompute due dates (recommended: yes, run the SLA calculator after actions). Enforce tag limits centrally. Record timeline events for each mutation.

### TW-TIB2-015 — Routing action: assign AI agent

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-TIB2-010
- **Summary:** Action `assign_agent {agent_id}` attaches an AI agent to the conversation and immediately asks the AI service to answer the current customer message.
- **Actors & access:** System; one-shot (dropped on follow-ups).
- **UX & screens:** builder action "Assign AI agent".
- **Endpoints:** none (manual equivalents `assign-agent`/`assign-assistant` belong to AIAG/TIB1).
- **Data:** writes `conversations.assignee_agent_id`.
- **Rules & edge cases:** 1. `agent_id` is not validated at rule-save time; `AiAgentService::respondIfAssigned` re-checks that the agent exists in the conversation's workspace, is active and has auto-respond on, that the plan has `access_ai_agents`, and that Meta-agent coexistence is not suppressing replies. 2. No timeline event `agent_assigned` is written by this path (the manual endpoint writes one). 3. It does not clear an existing human-takeover pause in `routing_meta`. 4. Because the inbound handler also calls the AI responder after routing when an agent is assigned, verify whether the customer could be answered twice for the same message (open question, dedupe lives inside the AI service).
- **Async & events:** synchronous AI call inside the webhook; failures logged.
- **External systems:** LLM providers through `AiAgentService` (AIAG domain).
- **Settings:** AI agent settings.
- **Acceptance criteria:**
  - Given a rule assign_agent 3 on an active auto-respond agent, When a new conversation matches, Then `assignee_agent_id` = 3 and an AI reply is generated.
  - Given the plan lacks `access_ai_agents`, When the rule fires, Then the agent id is stored but no reply is produced.
  - Given a follow-up message, When the rule matches, Then the action is skipped.
- **Source refs:** `app/Services/Inbox/RoutingEngine.php`, `app/Services/AiAgentService.php` (respondIfAssigned), `app/Http/Controllers/WaInboundController.php`.
- **Port notes:** keep the AI gate in the AIAG module; routing should only emit `conversation.ai_agent_assigned` and let AIAG react. Validate `agent_id` against the org at save time.

### TW-TIB2-016 — Routing action: auto-reply

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2-010
- **Summary:** Action `auto_reply {template_id?, body?}` sends an outbound message into the conversation from a saved template's text or from free text typed in the rule.
- **Actors & access:** System. Runs on new conversations AND on every follow-up (per-message action).
- **UX & screens:** builder shows a template select (approved templates) plus an optional free-text input; either or both allowed (validated client-side only).
- **Endpoints:** none.
- **Data:** inserts `inbox_messages` (direction out, status pending, `user_id` = the conversation's owner user, meta origin `routing_rule`, plus template `buttons`, `footer`, `header`, and for carousel templates `template_type` + `carousel_data`); updates `conversations.preview` (191 chars), `last_message_at`, `last_outbound_at`; stamps `routing_meta.last_auto_reply_at`.
- **Rules & edge cases:**
  1. Body source priority: template body (template must belong to the conversation's workspace) then free text; blank body = no send. The template body is used literally; no contact/order variables are interpolated (operators are told to use a Flow for that). Placeholders `{{device_phone}}` and `{{device_name}}` are expanded from the conversation's device (name falls back to "Device #id").
  2. Recipient = digits of `raw_jid`; empty = no send. Sender number = device country code + number.
  3. The cooldown is stamped BEFORE dispatch, but `AutoReplyGuard::canAutoReply` is a no-op, so no throttling happens (TW-TIB2-003). A customer's five messages can trigger five auto-replies from the same rule.
  4. Dispatch goes through `InboxDispatcher::send(msg, platform ?? 'W')`; failures are logged and swallowed, leaving the pending row.
  5. The message is not counted as a first response: SLA clock keeps running (TW-TIB2-027), `first_response_at` stays null, and any message-credit charge happens (if at all) inside `InboxDispatcher::send`, not in the engine (open question for WALLET: confirm automation messages are metered).
  6. Meta-agent coexistence suppresses the whole engine before this runs.
- **Async & events:** message dispatched to Node/Baileys or the Cloud API via `InboxDispatcher` (owned by WADEV/WABA); delivery status updates arrive through the normal status webhooks.
- **External systems:** WhatsApp engine of the conversation (Baileys/WABA/Twilio) via the dispatcher.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a rule with a template and a matching new conversation, When it fires, Then a pending outbound message with the template body appears in the thread and is dispatched.
  - Given a template from another workspace, When the rule fires, Then falls back to free text if present, else nothing is sent.
  - Given body "Hello from {{device_name}}", When fired on device "Sales", Then the sent text is "Hello from Sales".
  - Given the same rule, When the customer sends a second message, Then another reply is sent (no cooldown; parity).
- **Source refs:** `app/Services/Inbox/RoutingEngine.php` (dispatchAutoReply), `app/Services/Inbox/AutoReplyGuard.php`, `app/Services/InboxDispatcher.php`, `app/Models/WaTemplate.php`.
- **Port notes:** route through the shared "send message" service so wallet, opt-out and channel rules apply; add a real per-contact cooldown; require a first-response flag on automation messages so SLA is not stopped by bots unless configured.

### TW-TIB2-017 — Routing action: trigger flow

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2-010
- **Summary:** Action `trigger_flow {flow_id}` records that a specific active flow should start for this conversation; the WhatsApp Baileys inbound path hands that intent to the Node bridge in the same webhook response, which then starts the flow. Other channels record the intent but nothing consumes it.
- **Actors & access:** System. Per-message action (runs on follow-ups too).
- **UX & screens:** builder action "Trigger flow (records pending intent)" with an active-flow select.
- **Endpoints:** internal contract: the Baileys inbound endpoint response contains `routing_actions.flow_id`.
- **Data:** `routing_meta.pending_flow_id` + `pending_flow_at`; timeline event `flow_triggered {flow_id, flow_name}` (actor type rule). The flow must be `is_active` and in the same workspace (not required to be published).
- **Rules & edge cases:**
  1. `WaInboundController` reads and CLEARS `pending_flow_id` when building its response, so it cannot replay; Node's `BaileysClientManager` then runs the flow (with a 600 ms delay parameter).
  2. QUIRK: `WaWebhookController` (WABA/Twilio) and every social/SMS/email handler call the engine but never consume `pending_flow_id`, so on those channels the rule records the event and leaves a stale `pending_flow_id` that is then delivered on the next Baileys inbound if the conversation ever moves there. Effectively the action works for unofficial WhatsApp only.
  3. Also on the Baileys path, a media-only inbound with no `flow_id` from routing can start the workspace "order flow" (owned by the flow/order domains, noted here because it shares the `routing_actions.flow_id` slot).
  4. Foreign or inactive flow id = silently skipped.
- **Async & events:** Node-side flow start (`handleFlowAutoReply`).
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a rule trigger_flow 4 on an active flow and a Baileys inbound, When the message is processed, Then the response contains `routing_actions.flow_id = 4`, the slot is cleared and the flow starts.
  - Given the same rule and a WABA inbound, When processed, Then the `flow_triggered` event is recorded (Reference does not start the flow; port should).
  - Given an inactive flow, When the rule fires, Then no event and no slot.
- **Source refs:** `app/Services/Inbox/RoutingEngine.php`, `app/Http/Controllers/WaInboundController.php`, `node/classes/BaileysClientManager.js`.
- **Port notes:** publish `flow.trigger.requested {conversationId, flowId}` on the outbox; FLR consumes it for all channels; drop the polling-slot pattern.

### TW-TIB2-018 — Routing action: schedule escalation

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2-010, TW-TIB2-019
- **Summary:** Action `set_escalation {minutes, then_action}` arms a per-conversation timer: if no operator reply has landed when it expires, the stored follow-up action runs (for example reassign to a senior team).
- **Actors & access:** System; one-shot (only on new conversations). Authored by `routing.manage`.
- **UX & screens:** builder action "Escalate if no reply": minutes (1-1440 in the UI) then a target team; the UI always creates `then_action = {type:'assign_team', team_id}`.
- **Endpoints:** none.
- **Data:** `conversations.escalation_due_at` (timestamp, indexed) and `escalation_action` (JSON action dict).
- **Rules & edge cases:**
  1. `minutes` defaults to 5 when absent and must be > 0 or nothing is armed (no server maximum; the UI caps at 1440). `then_action` must be an array or it is stored as null (later firing only clears the timer).
  2. Re-arming overwrites any earlier timer on the same conversation (last rule wins).
  3. The timer is cleared when an operator sends a text reply (`reply` endpoint sets both columns to null). The media and voice-note reply endpoints do NOT clear it, but they set `first_response_at`, which makes the sweep skip the row, so the leftover timestamp is harmless.
  4. `then_action` may be any engine action type when authored through the API (assign_user, assign_agent, set_priority, ...), including another `set_escalation` (chain); the UI only offers assign_team.
  5. Nested `then_action.team_id/user_id` are workspace-validated on rule save.
- **Async & events:** fired by TW-TIB2-019.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a rule with escalation 10 minutes to team B, When a new conversation matches at 12:00, Then `escalation_due_at` = 12:10 and the action stored.
  - Given an operator replies with text at 12:05, When the reply is sent, Then both escalation columns are null.
  - Given minutes = 0, When the rule fires, Then no timer is set.
- **Source refs:** `app/Services/Inbox/RoutingEngine.php`, `app/Http/Controllers/TeamInboxController.php` (reply clears at the outbound update), `database/migrations/2026_05_13_000200_add_escalation_to_conversations.php`.
- **Port notes:** model as a delayed BullMQ job (`inbox.escalation.fire`, jobId = conversationId, removed on first reply/resolve) instead of polling columns; keep the JSON action shape.

### TW-TIB2-019 — Escalation sweep

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2-018, TW-TIB2-032
- **Summary:** Finds conversations whose escalation timer expired without a first response and executes the stored follow-up action, then clears the timer and logs an `escalated` event.
- **Actors & access:** System. Triggered by the inbox queue poll (per workspace) or by the artisan command `inbox:escalate {--limit=200}` (global, never scheduled by Reference; it is available for a host cron).
- **UX & screens:** timeline event "escalated" on the conversation.
- **Endpoints:** none of its own (queue poll: TW-TIB2-032).
- **Data:** selects `conversations` with `escalation_due_at <= now`, `inbox_status` in (open, pending) and `first_response_at` null, limit 200; `RoutingEngine::applyEscalation` executes the action via the normal engine executor and nulls both columns.
- **Rules & edge cases:**
  1. An action array without a `type` just clears the timer.
  2. Any exception clears the timer so a bad action cannot loop forever.
  3. Executing `assign_team` goes through the same device-scope guard and strategy logic as TW-TIB2-012; assignment sends no notification.
  4. The `escalated` event is recorded with the action payload, actor type rule, even when the underlying assignment was skipped by a guard.
  5. Snoozed, resolved or closed conversations are ignored (timer stays armed and can fire after the snooze wakes if still unanswered).
  6. Poll version is gated to once per 30 s per workspace; a workspace with no operator polling escalates late (only when someone opens the inbox).
- **Async & events:** none besides timeline event; no notification to the new assignee.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a timer that expired at 12:10 with no reply and status open, When the next poll sweep runs, Then the action executes, the columns clear and an `escalated` event exists.
  - Given the conversation was answered (first_response_at set), When the sweep runs, Then it is skipped.
  - Given a broken action that throws, When run, Then the timer is cleared and the sweep continues with the next row.
- **Source refs:** `app/Console/Commands/InboxEscalateCommand.php`, `app/Services/Inbox/RoutingEngine.php` (applyEscalation), `app/Http/Controllers/TeamInboxController.php` (queue sweep block), `routes/console.php`.
- **Port notes:** replace with a delayed job per TW-TIB2-018; notify the new assignee and emit `conversation.escalated` for webhooks.

### TW-TIB2-020 — Auto-assignment engine and strategies

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** —
- **Summary:** `AssignmentService` is the only writer of `assignee_user_id` and `assignee_team_id`. It picks a member for a conversation according to a strategy (manual, round_robin, least_loaded, sticky), validates tenancy, wakes a closed conversation, pauses any running AI agent when a human takes over, recomputes agent load counters and records the timeline. Callers: the manual assign endpoint, the bulk endpoint, routing rules, escalation and the Flow "Assign" node (`POST api/flow-node/assign`, FLR).
- **Actors & access:** System/callers. Strategy is a property of each team (`teams.assignment_strategy`, default manual; edited in the WSP team form).
- **UX & screens:** none; results appear as assignee chips and timeline events.
- **Endpoints:** none of its own.
- **Data:** writes `conversations` (`assignee_user_id`, `assignee_team_id`, `inbox_status`, `assignee_agent_id`), `agent_statuses.current_load`, `conversation_events`; reads `teams`, `team_user` (pivot `capacity` default 20, `is_lead` unused), `agent_statuses`, `workspace_user`, `messages`, `conversations`.
- **Rules & edge cases:**
  1. Tenancy: when the requested `team_id` differs from the conversation's current team it must belong to the same workspace, else `AssignmentTargetException('team_not_in_workspace')`. Re-affirming the current team is exempt. A `manual` assignment whose `user_id` is not a live member of the workspace (or is soft-deleted) throws `user_not_in_workspace` instead of silently unassigning. HTTP renders the exception as 422 `{ok:false, error:'assignment_target_invalid', reason, message}`.
  2. Strategy resolution: `manual` = the given user (or none when `user_id` is null); `round_robin` = among eligible members of `team_id`, the one whose most recent assignment is oldest (never-assigned first); `least_loaded` = fewest open/pending conversations; `sticky` = the member who last replied to this contact if still a workspace member and not offline, otherwise least_loaded within the team (or null with no team). Any other strategy string resolves to no user. round_robin/least_loaded without a `team_id` resolve to no user.
  3. Eligibility: team members (soft-deleted users excluded) except those whose `agent_statuses.status` is `offline` or `busy`; members with no status row count as eligible; `away` members remain eligible (QUIRK; docs say only offline/busy are skipped, which matches). Capacity: the pivot `capacity` (default 20) must exceed the member's load, where load = the stored `agent_statuses.current_load` when a status row exists (possibly stale) else a live count.
  4. Load counters (`current_load`) are recalculated only for the previous and the new assignee at each assignment (live count of their open/pending conversations). Resolving, snoozing, reopening or deleting a conversation does NOT refresh it, so the stored counter can drift high until that user is next involved in an assignment (QUIRK); least_loaded sorts by the live count while the capacity check uses the stored counter.
  5. round_robin "last assignment" = the max `updated_at` of conversations currently assigned to the member, so any edit of any of their conversations (a note, tag, priority change) moves them to the back of the line, and a conversation reassigned away stops counting (QUIRK).
  6. sticky looks for the last outbound row with a user in the legacy `messages` table, but Team Inbox replies are stored in `inbox_messages`, so in practice the lookup finds nothing and sticky degrades to least_loaded (probable bug; verify against a seeded thread).
  7. The write always overwrites `assignee_user_id` with the resolved user (possibly null) and sets the team only when a team id is supplied, so assigning a conversation to a team whose members are all busy/offline/full, or on `manual` with no user, clears the previous individual assignee while keeping the team (QUIRK).
  8. A conversation with `inbox_status = closed` becomes `open` on any assignment; resolved/snoozed/spam statuses are untouched.
  9. AI takeover: when a human or a team is assigned and the conversation has `assignee_agent_id`, that column is nulled and an `ai_handoff {reason:'assigned_to_human', strategy}` event is recorded (actor type human if a user acted, flow otherwise).
  10. Timeline: event type `reassigned` when a previous user existed else `assigned`, payload `{from_user_id,to_user_id,from_team_id,to_team_id,strategy}`; actor type stays the default `user` even for routing/flow callers (QUIRK).
  11. Return value is the resolved `User` or null; callers must treat null as "left in the team queue".
- **Async & events:** none inside the service; callers add notification/broadcast/webhook/audit (TW-TIB2-021).
- **External systems:** none.
- **Settings:** `teams.assignment_strategy` in {manual, round_robin, least_loaded, sticky}; `team_user.capacity` (no UI edits it, always 20); package-level none.
- **Acceptance criteria:**
  - Given a team of A (load 3) and B (load 1) both online on least_loaded, When a conversation is assigned to the team, Then B gets it.
  - Given A is `busy` and B is `offline` on round_robin, When assigning, Then `assignee_user_id` is null and the team is set.
  - Given member A at capacity 20, When least_loaded runs, Then A is excluded.
  - Given a manual assignment to a user of another workspace, When called, Then `AssignmentTargetException` and the row is unchanged.
  - Given a closed conversation, When assigned, Then it becomes open.
  - Given a conversation with an active AI agent, When a human is assigned, Then `assignee_agent_id` becomes null and an ai_handoff event exists.
- **Source refs:** `app/Services/Inbox/AssignmentService.php`, `app/Exceptions/AssignmentTargetException.php`, `app/Models/AgentStatus.php`, `app/Models/Team.php`, `app/Http/Controllers/FlowNodeActionsController.php` (assign node), `database/migrations/2026_05_06_120003_create_workspace_inbox_tables.php`.
- **Port notes:** implement in `apps/api/src/modules/inbox-assignment` with a transactional row lock on the conversation. Fix the drift by deriving load from a live query or a trigger/outbox-maintained counter, add the real `messages` source for sticky (inbox_messages author), respect team capacity edits in the UI, and only overwrite the individual assignee when the strategy actually resolved someone (or make the clear explicit).

### TW-TIB2-021 — Assign and claim endpoint

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-TIB2-020
- **Summary:** Operators assign a conversation to a member, to a team (letting the team's strategy pick) or claim it for themselves. Agents may only claim for themselves; managers and above may assign anyone. Fires an in-app notification, realtime broadcast, audit record and outbound webhook.
- **Actors & access:** authenticated workspace member. Authorization runs AFTER validation through `ConversationPolicy::assign`: allowed with permission `inbox.assign` (Owner, Admin, Manager) for any target/strategy; with only `inbox.assign_self` (Agent) allowed solely when strategy is manual, the target user is the caller and the team is null or unchanged. Viewer: 403. Conversation must be in the caller's current workspace (404 otherwise). Plan gates: none.
- **UX & screens:** thread header "Assign" menu (`#assign-btn`): managers see Teams (each labelled auto-assign), Members (with status), Unassign; agents see a single "Assign to me" (or "This chat is already assigned to you." / "Assignment is unavailable."); the control is hidden without any assign permission. Kanban "agent"/"team" groupings drag-to-assign; bulk toolbar "Assign" claims the selection for the current user (needs `inbox.bulk`). Toasts: "Assigned.", "You do not have permission to assign conversations.", "Could not assign this chat." or the server's 422 text.
- **Endpoints:**
  | Endpoint                                      | Route name                 | Action                     | Middleware   | Request                                                                                                                                                                                                     | Response                                                                                                                                                                                           |
  | --------------------------------------------- | -------------------------- | -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST team-inbox/api/conversations/{id}/assign | user.team-inbox.api.assign | TeamInboxController@assign | Authenticate | `user_id` (nullable int, must be a member of the conversation's workspace), `team_id` (nullable int, non-deleted team of the workspace), `strategy` (nullable in manual, round_robin, least_loaded, sticky) | `{ok:true, conversation: listItem}`; 422 validation ("That member is not part of this workspace." / "That team is not part of this workspace.") or `{ok:false,message}` from the service; 403; 404 |
- **Data:** see TW-TIB2-020. Strategy default: when a team is given without user and without strategy the team's own strategy (fallback least_loaded); otherwise manual.
- **Rules & edge cases:**
  1. Passing neither user nor team on manual clears the individual assignee (an "assign nobody").
  2. A member is notified only when a user was resolved (`notifyAssignment`, in-app row type `assigned`, title "Conversation assigned to you", link `/team-inbox?c={id}`, deduplicated 30 s per conversation+user, plus web push when the team-inbox PWA setting is on). Team-only assignment that resolves nobody notifies nobody.
  3. Audit entry `conversation.assigned` {to_user_id, team_id, strategy}; realtime `conversation.assigned` broadcast to workspace and conversation channels (excluding the actor); outbound webhook `conversation.assigned` {to_user_id, team_id, strategy, by_user_id}.
  4. The bulk endpoint's `assign` action bypasses this policy: it only needs `inbox.bulk` (Owner/Admin/Manager), uses strategy manual, so a team-only bulk assign sets the team and clears the user without picking a member, sends no per-item notification, event broadcast or webhook, and skips rows whose target became invalid (QUIRK; bulk is owned by TIB1).
  5. Assigning does not check the target's availability/capacity in manual mode.
  6. Response `conversation` is re-read with assignee, team and tag relations loaded.
- **Async & events:** `ConversationAssigned` broadcast (private channels `workspace.{id}.inbox` and `conversation.{id}`, event name `conversation.assigned`), inbox notification row, web push, outbound webhook dispatcher, audit log (`AuditLogger::workspace`), timeline events from TW-TIB2-020.
- **External systems:** outbound webhook subscribers (TIB1 owns webhook config).
- **Settings:** `ti_pwa_enabled` system setting for push.
- **Acceptance criteria:**
  - Given an Agent, When they assign the conversation to themselves, Then 200, the conversation appears in their Mine tab and audit/broadcast/webhook fire.
  - Given an Agent, When they assign to a teammate, Then 403.
  - Given a Manager assigning to a team on round_robin with an eligible member, When posted with only `team_id`, Then that member is set and notified.
  - Given a `user_id` from another workspace, When posted, Then 422 "That member is not part of this workspace."
  - Given a Viewer, When posted, Then 403.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (assign, teamStrategy, bulk), `app/Policies/ConversationPolicy.php`, `app/Services/Inbox/NotificationDispatcher.php`, `app/Events/Inbox/ConversationAssigned.php`, `app/Services/Inbox/OutboundWebhookDispatcher.php`, `resources/js/charts/user-team-inbox-index.js` (assign menu), `resources/views/user/team-inbox/kanban.blade.php`.
- **Port notes:** `POST /conversations/:id/assign`; permissions `inbox.assign` / `inbox.assign_self` map onto the RBAC v3 catalogue; publish `conversation.assigned` through the outbox so notification, websocket and webhook consumers run after commit.

### TW-TIB2-022 — Unassign endpoint

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-TIB2-020
- **Summary:** Removes the individual assignee from a conversation (the team stays), returning it to the team/unassigned queue.
- **Actors & access:** `inbox.assign` only (the claim-only Agent permission is not enough because no target is passed). Workspace member; conversation in the current workspace.
- **UX & screens:** "Unassign" item at the bottom of the assign menu (managers), toast "Could not unassign this chat." on failure.
- **Endpoints:**
  | Endpoint                                        | Route name                   | Action                       | Middleware   | Request | Response                            |
  | ----------------------------------------------- | ---------------------------- | ---------------------------- | ------------ | ------- | ----------------------------------- |
  | POST team-inbox/api/conversations/{id}/unassign | user.team-inbox.api.unassign | TeamInboxController@unassign | Authenticate | none    | `{ok:true, conversation: listItem}` |
- **Data:** `conversations.assignee_user_id = null`; previous assignee's `agent_statuses.current_load` recomputed; event `unassigned {from_user_id}`.
- **Rules & edge cases:** 1. No-op (no event) when there was no assignee. 2. Team and AI agent columns are untouched. 3. Broadcasts `conversation.assigned` (with new_user null) and writes audit `conversation.unassigned`; no webhook, no notification. 4. The kanban "Unassigned" lane also calls this endpoint.
- **Async & events:** broadcast + audit as above.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an assigned conversation, When a Manager unassigns, Then `assignee_user_id` is null and an `unassigned` event exists.
  - Given an Agent, When calling, Then 403.
  - Given an unassigned conversation, When unassigned again, Then 200 with no new event.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (unassign), `app/Services/Inbox/AssignmentService.php`.
- **Port notes:** emit `conversation.unassigned` for webhooks (Reference omits it).

### TW-TIB2-023 — Agent availability status and activity counters

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** —
- **Summary:** Each workspace member has a row of availability (online, away, busy, offline), a status message, last-seen time, an open-chat load counter and per-day reply/resolution counters. Assignment strategies and the analytics pages read it. The API to change status exists, but no screen calls it.
- **Actors & access:** any authenticated workspace member can set their own status (no permission key). Rows are created lazily.
- **UX & screens:** none sets the status (grep-verified: no JS, blade or docs reference `me/status`); the docs page advertises operators choosing an availability status (docs-only in the UI). Read surfaces: the Members page (WSP), Team Performance table and the queue stats modal.
- **Endpoints:**
  | Endpoint                      | Route name                 | Action                        | Middleware   | Request                                                                             | Response                 |
  | ----------------------------- | -------------------------- | ----------------------------- | ------------ | ----------------------------------------------------------------------------------- | ------------------------ |
  | POST team-inbox/api/me/status | user.team-inbox.api.status | TeamInboxController@setStatus | Authenticate | `status` required in online, away, busy, offline; `message` nullable string max 128 | `{ok:true, status: row}` |
- **Data:** `agent_statuses` (unique user_id+workspace_id): `status` varchar(12) default online, `status_message` (128), `last_seen_at`, `current_load`, `today_replies`, `today_resolutions`, `counters_date`, `preferences` (JSON, unused).
- **Rules & edge cases:**
  1. Row lifecycle: created by `RecordAgentActivity` middleware (global web middleware, at most one write per 30 s per user+workspace, skipped before install), by `bootstrap` via `agentStatusForCurrent()` (status online), or by `setStatus`.
  2. `last_seen_at` refreshes on activity but nothing ever flips status to offline/away automatically; a user who closed the tab stays `online` until they change it, so "online" is unreliable for routing (QUIRK).
  3. Counters: `today_replies` incremented on operator text/media/voice replies; `today_resolutions` on resolve and bulk resolve (by count); `rolloverIfStale()` zeroes both when `counters_date` is not today (called by the activity middleware and by the stats endpoint, in app timezone).
  4. `current_load` is set only by the assignment service (TW-TIB2-020 rule 4).
  5. Bootstrap returns per-member `status` (default `offline` when no row), `last_seen_at`, `load`, and `me.status`.
- **Async & events:** none (no presence broadcast).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user posts status busy with message "lunch", When saved, Then the row shows busy and round_robin/least_loaded skip them.
  - Given status "invalid", When posted, Then 422.
  - Given a new authenticated request after 30 s, When the middleware runs, Then `last_seen_at` refreshes.
  - Given yesterday's counters, When the next activity arrives, Then counters reset to 0 with today's date.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (setStatus, bootstrap, stats), `app/Models/AgentStatus.php`, `app/Http/Middleware/RecordAgentActivity.php`, `app/Models/User.php` (agentStatusForCurrent), `Documentation/pages/messaging/team-inbox.html`.
- **Port notes:** derive presence from the realtime layer (websocket connect/disconnect and idle timers) with manual overrides busy/away/offline; keep a table `agent_availability` (org_id, user_id) and build the missing status picker in the inbox header. Counters should be computed from event tables rather than incremented columns.

### TW-TIB2-024 — SLA policies JSON API

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** —
- **Summary:** JSON endpoints to list, create and update the workspace's SLA policies (targets, priority overrides, device scope, default flag). There is no JSON delete endpoint; deletion exists only on the web page (TW-TIB2-025).
- **Actors & access:** list: any workspace member (also in `bootstrap.sla_policies`). Create/update: permission `sla.manage` (Owner, Admin only). No plan gate on these API routes and no role middleware (QUIRK: the plan flag `access_sla_policies` is only a soft paywall on the page).
- **UX & screens:** no dedicated JS screen uses the write endpoints today (the settings page uses form posts); kept for API/legacy clients.
- **Endpoints:**
  | Endpoint                      | Route name                     | Action                        | Middleware   | Request                                                                                                                                                                                                                                                                                                | Response                                          |
  | ----------------------------- | ------------------------------ | ----------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
  | GET team-inbox/api/sla        | user.team-inbox.api.sla.index  | TeamInboxController@slaIndex  | Authenticate | none                                                                                                                                                                                                                                                                                                   | array of policies for the workspace (no ordering) |
  | POST team-inbox/api/sla       | user.team-inbox.api.sla.store  | TeamInboxController@slaStore  | Authenticate | `name` required string max 128; `first_response_minutes`, `resolution_minutes` nullable integer min 1; `pause_when_waiting_on_customer`, `respect_business_hours`, `is_default` nullable boolean; `priority_overrides` nullable array; `device_ids` nullable array of integers that exist in `devices` | `{ok:true, policy}`                               |
  | PATCH team-inbox/api/sla/{id} | user.team-inbox.api.sla.update | TeamInboxController@slaUpdate | Authenticate | any of name, first_response_minutes, resolution_minutes, pause_when_waiting_on_customer, respect_business_hours, priority_overrides, is_default, device_ids (NO validation)                                                                                                                            | `{ok:true, policy}`; 404 for another workspace    |
- **Data:** `sla_policies`: `workspace_id` (nullable: null = platform-wide policy for the support desk, TW-TIB2-036), `name` varchar 128, `first_response_minutes`/`resolution_minutes` (unsigned int, nullable), `pause_when_waiting_on_customer` (bool default 1), `respect_business_hours` (bool default 1), `device_ids` (JSON list or null), `priority_overrides` (JSON `{low|normal|high|urgent: {first_response_minutes?, resolution_minutes?}}` or null), `is_default`. Indexed on (workspace_id, is_default).
- **Rules & edge cases:**
  1. `device_ids` are intersected with devices owned by users whose current workspace is this one; an empty result is stored as null (applies to all devices).
  2. Setting `is_default` true clears the flag on every other policy of the workspace (after the write; not transactional).
  3. Update trusts the body: negative or zero minutes, non-array overrides and arbitrary `is_default` values are accepted (QUIRK); PATCH also lets an update set the default without the store-time validation.
  4. Store defaults for omitted booleans come from the DB (both default true); `is_default` false.
  5. `pause_when_waiting_on_customer` and `respect_business_hours` are stored but never used by the tracker (TW-TIB2-026).
  6. A policy with both minutes null is allowed (no targets).
  7. No audit entry.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an Admin posts a policy with first_response 30 and is_default true, When created, Then every other workspace policy has is_default false.
  - Given `device_ids` containing a device of another workspace, When posted, Then it is dropped and, if none remain, stored as null.
  - Given an Agent, When posting, Then 403.
  - Given a policy id of another workspace, When PATCHed, Then 404.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (slaIndex, slaStore, slaUpdate, intersectWorkspaceDevices), `app/Models/SlaPolicy.php`, `database/migrations/2026_05_06_120003_create_workspace_inbox_tables.php`, `database/migrations/2026_05_22_020000_add_device_ids_to_teams_and_sla.php`.
- **Port notes:** table `sla_policies` (org_id, RLS); add a `calendar_id`/business-hours FK and remove the unimplemented pause flag or implement it; add DELETE and proper validation on update; make the default flag a partial unique index (`WHERE is_default`).

### TW-TIB2-025 — SLA policies settings page

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2-024
- **Summary:** A server-rendered "Response targets" page where managers view policies and admins create, edit and delete them with plain form posts (no JS bundle).
- **Actors & access:** page and writes require workspace role Manager or higher (`workspace.role:manager` middleware), but the write actions additionally require the `sla.manage` permission which Manager lacks, so Managers can view the page yet every write returns 403 (QUIRK). Plan: the page GET has `EnforcePlanFeature:access_sla_policies`, which on a plan without the feature still renders the page and shows a global paywall overlay (GET is only soft-gated); the POST/PUT/DELETE routes have no plan middleware, so writes succeed even without the feature (QUIRK). Platform admins pass the role middleware but fail `sla.manage` unless they hold a workspace role.
- **UX & screens:** `resources/views/user/team-inbox/sla.blade.php` (layout `x-layouts.user`, nav key team-inbox). Left rail: info card with "N active" chip or "Not configured", a "How it works" 4-step list (customer messages, agent replies before target, miss it and the chat is flagged breached, breaches show in inbox and Team Performance), "Back to inbox" link, help card "Enter targets in minutes (60 = 1 hour, 240 = 4 hours, 1440 = 1 day). The default policy applies workspace-wide." Main: header "Response targets"; one card per policy (ordered default first then id) with inline-editable name (max 128), First-response target and Resolution target number inputs (min 1, max 100000 and 1000000), checkboxes "Pause clock while waiting on the customer", "Only count business hours", "Make default (applies workspace-wide)", a Default chip, Delete (with a confirm prompt "Delete this SLA policy?") and Save changes; empty state "No SLA policies yet"; "Add a policy" form with the same fields (default checkbox pre-ticked when no policy exists). Flash success (status) and first validation error banners.
- **Endpoints:**
  | Endpoint                   | Route name                  | Action                            | Middleware                                                                        | Request                                                                                                                                | Response                                                 |
  | -------------------------- | --------------------------- | --------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
  | GET team-inbox/sla         | user.team-inbox.sla         | TeamInboxController@slaPage       | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_sla_policies | none                                                                                                                                   | HTML page                                                |
  | POST team-inbox/sla        | user.team-inbox.sla.store   | TeamInboxController@slaWebStore   | Authenticate, EnsureWorkspaceRole:manager                                         | `name` required max 128; `first_response_minutes` nullable int 1..100000; `resolution_minutes` nullable int 1..1000000; checkbox flags | redirect back with status `SLA policy "<name>" created.` |
  | PUT team-inbox/sla/{id}    | user.team-inbox.sla.update  | TeamInboxController@slaWebUpdate  | Authenticate, EnsureWorkspaceRole:manager                                         | same fields                                                                                                                            | redirect back `SLA policy updated.`                      |
  | DELETE team-inbox/sla/{id} | user.team-inbox.sla.destroy | TeamInboxController@slaWebDestroy | Authenticate, EnsureWorkspaceRole:manager                                         | none                                                                                                                                   | redirect back `SLA policy deleted.`                      |
- **Data:** `sla_policies`.
- **Rules & edge cases:**
  1. Unchecked checkboxes become false, so saving an edit form with "Only count business hours" unticked turns it off; a policy created here has both booleans false unless ticked (the JSON API default is true).
  2. The form has no priority-override or device-scope fields; updating leaves those columns untouched.
  3. Ticking default clears other defaults in the workspace; unticking the default box on the current default leaves the workspace with no default policy.
  4. Delete removes the row without touching conversations: `conversations.sla_policy_id` values dangle and the tracker then treats those conversations as having no policy (`find` returns null), even if other policies exist (QUIRK).
  5. Not found or foreign policy = 404.
  6. No audit entries (the admin-side platform SLA form does audit).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package flag `access_sla_policies`.
- **Acceptance criteria:**
  - Given an Admin, When they submit a new policy 60/1440 with default ticked, Then it is created, becomes default and the flash reads created.
  - Given a Manager, When submitting the form, Then 403.
  - Given an Agent visiting the page, When loaded, Then redirected to /team-inbox by the role middleware.
  - Given a policy deleted while conversations reference it, When a new inbound arrives on such a conversation, Then no SLA is applied.
  - Given first_response_minutes 0, When submitted, Then a validation error banner shows.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (slaPage, slaWebStore, slaWebUpdate, slaWebDestroy), `resources/views/user/team-inbox/sla.blade.php`, `routes/web.php`, `app/Http/Middleware/EnforcePlanFeature.php`, `app/Support/WorkspacePermissions.php`.
- **Port notes:** `apps/web/app/(settings)/inbox/sla`; use the same RBAC permission for view and write; hard-gate the plan feature on writes; on delete, null out or reassign referencing conversations.

### TW-TIB2-026 — SLA policy selection and due-date computation

- **Status:** partial
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-TIB2-024
- **Summary:** When the first customer message of a conversation arrives, the tracker picks the applicable SLA policy and stamps `sla_first_response_due` and `sla_resolution_due` on the conversation by adding the policy's target minutes (after any priority override). Business-hours math and the "pause while waiting on customer" flag are stored on policies but not implemented.
- **Actors & access:** System (called at the top of the routing pipeline, so it inherits the channel coverage and the Meta-agent suppression of TW-TIB2-010).
- **UX & screens:** due dates surface as the header SLA countdown ("SLA breached" or a human duration from the first-response due) and the list chip (TIB1 UI).
- **Endpoints:** none.
- **Data:** writes `conversations.sla_policy_id`, `sla_first_response_due`, `sla_resolution_due`, `sla_breached=false`, `last_inbound_at`; reads `sla_policies`.
- **Rules & edge cases:**
  1. Trigger: `applyToInbound` calls the tracker only when the conversation has no `first_response_at` AND no `sla_first_response_due`. Consequences: (a) only the first inbound normally starts the clock; later inbounds before the first reply do not push the due date; (b) a conversation that got its first response never gets a new SLA cycle, even after resolve/reopen or a long silence; (c) if no policy applied on the first inbound (or the policy has no first-response target), every subsequent inbound before the first reply re-runs the computation, re-stamping resolution due from "now" and resetting `sla_breached` to false (QUIRK for resolution-only policies).
  2. Policy resolution: a conversation-level pinned `sla_policy_id` wins (looked up by id, not workspace-scoped; a deleted policy resolves to none). Otherwise `SlaPolicy::bestFor(workspace, device)`: first the first policy that has a non-empty `device_ids` containing the conversation's device (if several match, the first returned by the database wins); then the workspace default (`is_default`); then ANY policy of the workspace (first returned) even when none is marked default (QUIRK: a workspace with policies but no default still gets one applied). A conversation with no device never matches a device-scoped policy. Only workspace-owned policies are considered; platform-wide (null workspace) policies are ignored here.
  3. Targets: base `first_response_minutes` / `resolution_minutes` overridden per priority by `priority_overrides[priority]`, key by key (`??`), where priority is the conversation's priority at that moment (a routing `set_priority` runs later, so it cannot influence the first computation).
  4. A target of null or 0 yields a null due date.
  5. Due = now + minutes, literal wall-clock addition. `respect_business_hours` is ignored (the class comment says real business-hours math would need a subclass override) and `pause_when_waiting_on_customer` is ignored. The docs and UI copy advertise both.
  6. Each run also stamps `last_inbound_at = now`.
  7. Failures are logged as warnings and never block the inbound.
- **Async & events:** none (synchronous, no event, no timeline entry when the clock starts).
- **External systems:** none.
- **Settings:** policies (TW-TIB2-024/025), package flag `access_sla_policies` (UI only).
- **Acceptance criteria:**
  - Given a default policy 30/240 and a new conversation, When the first inbound arrives at 10:00, Then first-response due = 10:30 and resolution due = 14:00 and `sla_breached` = false.
  - Given a policy with priority override urgent 5 minutes and a conversation already at urgent, When the first inbound arrives, Then first-response due = +5 minutes.
  - Given two policies where policy S is scoped to device 3 and policy D is default, When a conversation on device 3 gets its first inbound, Then S applies; on device 4 D applies.
  - Given no policies, When a message arrives, Then all SLA columns stay null.
  - Given a second inbound before any reply on a policy with a first-response target, When it arrives, Then due dates are unchanged.
- **Source refs:** `app/Services/Inbox/SlaTracker.php`, `app/Models/SlaPolicy.php`, `app/Services/Inbox/RoutingEngine.php`, `resources/js/charts/user-team-inbox-index.js` (SLA chip/countdown), `Documentation/pages/messaging/team-inbox.html`.
- **Port notes:** implement a real business-hours calendar (see `SlaCalculator::addBusinessMinutes` in TW-TIB2-036 for the shape) and pause/resume on customer-wait status; start a new SLA cycle on every customer message after resolution/reopen; fix the null-first-response re-run and recompute when `set_sla`/priority change. Keep due timestamps in UTC.

### TW-TIB2-027 — SLA first-response and resolution hooks

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-TIB2-026
- **Summary:** Lifecycle hooks that stop the first-response clock when an operator replies and check the resolution target when a conversation is resolved.
- **Actors & access:** system, invoked by operator actions.
- **UX & screens:** timeline event "first_response" with `within_sla`; a breached flag after a late resolve.
- **Endpoints:** invoked inside `POST team-inbox/api/conversations/{id}/reply`, `.../media`, `.../voice` (first response) and `.../resolve` (resolution) which are TIB1 routes.
- **Data:** `conversations.first_response_at`, `last_outbound_at`, `sla_breached`; event `first_response {at, within_sla}` (actor type system, `within_sla` null when no due date).
- **Rules & edge cases:**
  1. `markFirstResponse` fires only from the three operator send endpoints (text, media, voice note) and only when `first_response_at` is empty. Catalog sends, forwards, compose, routing auto-replies, keyword auto-replies, outside-hours replies, AI-agent replies and messages typed on the phone and mirrored back by Baileys do NOT stop the clock (QUIRK: bots never satisfy the SLA; a phone reply never does either).
  2. The text reply also clears escalation timers (TW-TIB2-018).
  3. `applyOnResolution` (single-conversation resolve only) sets `sla_breached=true` when resolved after `sla_resolution_due`; it never clears a breach and emits no event or notification. The bulk `resolve` action does not call it (QUIRK). Reopen keeps `first_response_at` and any breach flag.
  4. `sla_first_response_due` is left in place after the reply so the header can still show compliance.
- **Async & events:** timeline event; nothing else.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given first-response due 10:30 and an operator text reply at 10:20, When sent, Then `first_response_at` = 10:20 and the event has `within_sla` true.
  - Given a reply at 10:45, When sent, Then the event has `within_sla` false (the breach flag itself is set only by the sweep).
  - Given resolution due 14:00 and resolve at 14:10, When resolved, Then `sla_breached` = true.
  - Given only an AI-agent reply, When sent, Then `first_response_at` stays null.
- **Source refs:** `app/Services/Inbox/SlaTracker.php`, `app/Http/Controllers/TeamInboxController.php` (reply, mediaReply, voiceNote, resolve, bulk).
- **Port notes:** decide which senders count as "first human response" (recommended: any outbound with an authoring user; optionally AI when configured); emit `conversation.first_response` and `conversation.sla_met/missed` events.

### TW-TIB2-028 — SLA breach sweep

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-TIB2-026, TW-TIB2-032
- **Summary:** A periodic pass over open conversations flags those whose first-response or resolution due time has passed by setting `sla_breached` and writing a `sla_breach` timeline event.
- **Actors & access:** System, gated to run at most once per 60 s across the entire platform (see TW-TIB2-032).
- **UX & screens:** breached conversations show an "SLA" chip in list and kanban, feed the "SLA breach" queue tab and its count, the stats tile "SLA Breached", and the header shows "breached".
- **Endpoints:** none (the SLA breach tab is the queue endpoint with `tab=sla_breach`, TIB1).
- **Data:** first pass selects conversations that are open/pending, `sla_breached=0`, have a first-response due in the past and no `first_response_at`; second pass (after the first has flagged its rows) selects open/pending, not breached, resolution due in the past. Each is set `sla_breached=true` and gets event `sla_breach {kind: first_response|resolution, due_at}` (actor type system).
- **Rules & edge cases:**
  1. Global scope: one sweep covers every workspace (no workspace or engine filter) and loads all matching rows with an unbounded `get()`; the workspace whose operator poll wins the cache gate does the work for everyone.
  2. A conversation gets at most one breach event, of whichever kind is detected first; the flag never clears (a later reply does not un-flag it).
  3. Snoozed, resolved, closed and spam conversations are skipped, so a snoozed chat that passes its due time is flagged only after it wakes.
  4. Returns the number flagged (unused).
  5. No notification, broadcast or webhook is emitted (TW-TIB2-029).
  6. There is no warning threshold ("about to breach") for workspace conversations.
- **Async & events:** timeline events only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an open conversation with first-response due 10:30, no reply and now 10:31, When the sweep runs, Then `sla_breached` = true and one `sla_breach` event with kind first_response exists.
  - Given the operator replied at 10:20, When the sweep runs after 10:30, Then no first-response breach is recorded.
  - Given a snoozed conversation past its due, When the sweep runs, Then it is not flagged until it wakes.
  - Given the sweep ran 30 s ago, When another poll happens, Then no second sweep starts (cache gate).
- **Source refs:** `app/Services/Inbox/SlaTracker.php` (sweepBreaches), `app/Http/Controllers/TeamInboxController.php` (queue sweep block), `app/Models/Conversation.php` (scopeOpen, scopeSlaBreached).
- **Port notes:** run as a repeatable BullMQ job per org or a single job with keyset pagination; index on `(sla_first_response_due)`/`(sla_resolution_due)` partial where `sla_breached=false`; also handle warn-level thresholds.

### TW-TIB2-029 — SLA breach notification and realtime event

- **Status:** dead-code
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-TIB2-028
- **Summary:** Reference contains an SLA-breach notification method, a broadcast event and a notification preference for it, but nothing calls or dispatches them; breaches are silent apart from the flag and timeline entry.
- **Actors & access:** none (unreachable).
- **UX & screens:** the workspace notification preferences list "SLA breached" with in-app, email and Slack defaulted on (NOTIF domain), yet no such notification is ever created.
- **Endpoints:** none.
- **Data:** `NotificationDispatcher::notifySlaBreach` would notify the assignee (or every member of the assigned team) with type `sla_breach`, title "SLA breached", dedupe key `sla:{conversationId}` for 30 s and link `/team-inbox?c={id}`; event `SlaBreached` would broadcast `sla.breached` {conversation_id, kind, due_at} on the workspace inbox private channel.
- **Rules & edge cases:** 1. Neither `notifySlaBreach` nor `SlaBreached::dispatch` has a caller (grep-verified). 2. The docs claim breaches are "shown on the timeline and in the SLA breach tab", which is true; they do not promise notifications. 3. The notification preference key exists in workspace defaults (`sla_breached`).
- **Async & events:** none currently.
- **External systems:** email/Slack channels would be used if wired (INTG).
- **Settings:** `workspaces.notification_prefs.sla_breached`.
- **Acceptance criteria:**
  - Given the port wires it, When a conversation is flagged breached, Then the assignee (or team members) receive an in-app notification and a `conversation.sla_breached` websocket message honoring their preferences.
  - Given Reference parity, When a breach is flagged, Then no notification is produced.
- **Source refs:** `app/Services/Inbox/NotificationDispatcher.php`, `app/Events/Inbox/SlaBreached.php`, `app/Models/Workspace.php` (notification prefs).
- **Port notes:** implement in the SLA sweep worker: publish `conversation.sla_breached` on the outbox, consumed by NOTIF and the realtime gateway.

### TW-TIB2-030 — Snooze a conversation

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** —
- **Summary:** An operator hides a conversation from the open queue until a chosen future time; when it elapses the conversation returns to open (TW-TIB2-031).
- **Actors & access:** permission `inbox.snooze` (Owner, Admin, Manager, Agent; Viewer no) through `ConversationPolicy::snooze`; the conversation must be in the current workspace. No plan gate and no assignee requirement.
- **UX & screens:** thread header snooze button and the quick-action "Snooze" chip open a themed prompt "Snooze conversation" (placeholder "ISO date, or 1h, 30m, 2d", default `1h`); accepted formats are `<n>h|m|d` or any date string the browser can parse; toasts "Snoozed.", "Invalid snooze duration.", "Snooze failed: ...". Snoozed rows show an amber pill "Snoozed <time left>" (or "due") and the status filter has a Snoozed view. Kanban: dragging a card to the Snoozed column snoozes for one hour. Bulk API action `snooze` (needs `inbox.bulk`) uses `until` or now+1 hour by default and, unlike the single endpoint, has no `after:now` check, writes no timeline event, audit-per-row or broadcast (audit is per bulk call).
- **Endpoints:**
  | Endpoint                                      | Route name                 | Action                     | Middleware   | Request                           | Response                                                      |
  | --------------------------------------------- | -------------------------- | -------------------------- | ------------ | --------------------------------- | ------------------------------------------------------------- |
  | POST team-inbox/api/conversations/{id}/snooze | user.team-inbox.api.snooze | TeamInboxController@snooze | Authenticate | `until` required, date, after now | `{ok:true, conversation: listItem}`; 422 on invalid; 403; 404 |
- **Data:** `conversations.inbox_status='snoozed'`, `snoozed_until` (timestamp, indexed); event `snoozed {until}`; audit `conversation.snoozed {until}`; broadcast `conversation.snoozed` (ConversationUpdated with `until`).
- **Rules & edge cases:**
  1. Snoozing an already snoozed conversation just updates the time. Snoozing a resolved/closed/spam conversation is allowed and changes it to snoozed.
  2. Assignment is kept; unread count is kept; SLA due dates keep running but breach flagging is suspended while snoozed (TW-TIB2-028); escalation timers are not fired while snoozed (TW-TIB2-019).
  3. Time zone: the string is parsed by the server in the application timezone unless it carries an offset; the UI always sends an ISO UTC instant.
  4. A new customer message wakes a snoozed conversation: the Baileys inbound path sets status open and the Cloud API path sets pending (or the Meta-agent mode status), without a notification, and `snoozed_until` is left populated but stale.
  5. Reopen (TIB1) sets status open but does not clear `snoozed_until`.
  6. Maximum horizon: none.
- **Async & events:** broadcast, audit, timeline event; no notification, no outbound webhook.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an open conversation, When an Agent snoozes with `until` two hours ahead, Then status = snoozed and it leaves the Open queue and appears under Snoozed.
  - Given `until` in the past, When posted to the single endpoint, Then 422.
  - Given a Viewer, When posted, Then 403.
  - Given the user types "30m", When the UI submits, Then `until` = now + 30 minutes in ISO UTC.
  - Given a snoozed conversation and a new inbound, When it arrives, Then the conversation is back in the Open queue.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (snooze, bulk), `app/Policies/ConversationPolicy.php`, `resources/js/charts/user-team-inbox-index.js` (snooze, parseSnoozeTarget, snoozeLeft), `resources/views/user/team-inbox/kanban.blade.php`, `app/Http/Controllers/WaInboundController.php`, `app/Http/Controllers/WaWebhookController.php`.
- **Port notes:** store `snoozed_until` and schedule a delayed BullMQ job for the wake-up (TW-TIB2-031); clear `snoozed_until` whenever status leaves snoozed; apply the same future-time validation to bulk.

### TW-TIB2-031 — Snooze wake-up sweep

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2-030, TW-TIB2-032
- **Summary:** When `snoozed_until` passes, the conversation flips back to open, a realtime update is broadcast, a timeline event is recorded and the assignee (or team) gets a follow-up reminder.
- **Actors & access:** System. Poll-driven (per workspace, 30 s gate, 50 rows max) or through `php artisan inbox:wake-snoozed {--limit=500}` (global, unscheduled).
- **UX & screens:** the conversation reappears in Open/Mine; the kanban card leaves the Snoozed column on the next poll; the reminder shows in the notification bell: "Snoozed chat reopened — follow up".
- **Endpoints:** none.
- **Data:** selects `inbox_status='snoozed'` with `snoozed_until <= now`; sets `inbox_status='open'`, `snoozed_until=null`; event `auto_unsnoozed {by: system}` (actor type system); broadcast `conversation.unsnoozed` {inbox_status: open}; `notifySnoozeWake`: recipients = the assignee, else all members of the assigned team, none if unassigned; notification type `snooze_wake`, dedupe 30 s per conversation, link `/team-inbox?c={id}`, optional web push.
- **Rules & edge cases:** 1. Notification failures are swallowed. 2. Unassigned, team-less conversations wake silently. 3. A row with a null `snoozed_until` is never woken. 4. The command version processes up to 500 rows across all workspaces; the poll version 50 per workspace per 30 s, so a large backlog drains slowly. 5. Because it depends on an operator polling the queue, a workspace nobody opens wakes late (docs: "within about 30-60 seconds of the queue refreshing").
- **Async & events:** broadcast, timeline event, in-app notification, web push.
- **External systems:** Web Push (VAPID) when the team-inbox PWA setting `ti_pwa_enabled` is on.
- **Settings:** `ti_pwa_enabled`.
- **Acceptance criteria:**
  - Given a snoozed conversation due at 15:00 assigned to Ana, When a sweep runs at 15:01, Then status = open, `snoozed_until` = null, an `auto_unsnoozed` event exists and Ana receives the reminder.
  - Given the same conversation unassigned with no team, When woken, Then no notification is created.
  - Given `snoozed_until` in the future, When the sweep runs, Then untouched.
  - Given the operator resolved the chat while snoozed, When the sweep runs, Then it is not reopened (status no longer snoozed).
- **Source refs:** `app/Console/Commands/InboxWakeSnoozedCommand.php`, `app/Http/Controllers/TeamInboxController.php` (queue wake block), `app/Services/Inbox/NotificationDispatcher.php` (notifySnoozeWake), `app/Events/Inbox/ConversationUpdated.php`.
- **Port notes:** per-conversation delayed job keyed by conversation id, cancelled when status changes; publish `conversation.unsnoozed` on the outbox.

### TW-TIB2-032 — Poll-driven sweep scheduler (no cron)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** —
- **Summary:** Reference deliberately avoids `schedule:run`: periodic work is triggered from the operator's 5-second inbox queue poll, gated by cache keys and deferred until after the response is flushed. TIB2 owns three of these sweeps (escalation, SLA breach, snooze wake); others piggy-back on the same hook.
- **Actors & access:** System, triggered by any authenticated operator polling `GET team-inbox/api/queue` (TIB1 route).
- **UX & screens:** none; the queue response is unaffected.
- **Endpoints:** none of its own.
- **Data:** cache keys (default cache store) and TTLs, each `put` synchronously before deferral so simultaneous polls cannot double-schedule:
  | Cache key                       | TTL  | Work                                                 |
  | ------------------------------- | ---- | ---------------------------------------------------- |
  | `inbox:esc-sweep:{ws}`          | 30 s | escalation sweep, 200 rows (TW-TIB2-019)             |
  | `inbox:sla-sweep` (global)      | 60 s | SLA breach sweep across all workspaces (TW-TIB2-028) |
  | `inbox:wake-sweep:{ws}`         | 30 s | snooze wake, 50 rows (TW-TIB2-031)                   |
  | `inbox:ig-pull:{ws}`            | 12 s | Instagram pull (IG domain)                           |
  | `deals:remind-sweep:{ws}`       | 60 s | deal task reminders, 100 rows (DEAL)                 |
  | `crm:task-remind-sweep:{ws}`    | 60 s | CRM task reminders, 100 rows (CTP)                   |
  | `inbox:campaign-sweep` (global) | 20 s | scheduled campaign trigger (CAMP/SCHED)              |
- **Rules & edge cases:**
  1. Bodies run in `app()->terminating` callbacks, i.e. after the JSON is sent (PHP-FPM finish), inside the same PHP worker.
  2. Each body catches all exceptions and logs a warning; a failing sweep never breaks the poll.
  3. Workspaces without an active operator are not swept; `routes/console.php` documents the trade-off and keeps the artisan commands (`inbox:escalate`, `inbox:wake-snoozed`, `support:sla-scan`) for manual/cron use only. The comment there claims `support:sla-scan` is swept from the queue, but the queue code does not call it (QUIRK; see TW-TIB2-036).
  4. Sweeps run for the workspace of the polling user; only the SLA and campaign sweeps are global.
  5. The queue also has an idle-poll signature short-circuit; the sweeps run before that check so they still fire on unchanged inboxes.
- **Async & events:** none besides the individual sweep effects.
- **External systems:** none.
- **Settings:** none (intervals hard-coded).
- **Acceptance criteria:**
  - Given two operators polling within the same second, When both requests hit, Then only one escalation sweep is scheduled for the workspace in that 30 s window.
  - Given an exception inside the SLA sweep, When it runs, Then the queue response is still delivered and a warning is logged.
  - Given no operator has the inbox open, When time passes, Then no sweep runs (Reference parity; the port should use worker schedules instead).
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (queue), `routes/console.php`, `app/Console/Commands/InboxEscalateCommand.php`, `app/Console/Commands/InboxWakeSnoozedCommand.php`, `app/Console/Commands/Support/ScanSlaBreaches.php`.
- **Port notes:** replace with BullMQ repeatable jobs and per-conversation delayed jobs (see TW-TIB2-018/031); keep idempotency (state re-checked in the job); register queue names in `apps/api/src/queues`. Do not couple sweeps to HTTP polling.

### TW-TIB2-033 — Queue statistics snapshot

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-TIB2-023
- **Summary:** An endpoint returning live inbox counters and per-agent day stats, backing a "Team Performance" modal that no control opens any more.
- **Actors & access:** any authenticated workspace member (no role or permission check on the endpoint; QUIRK: viewers and agents can read per-agent stats). Workspace-scoped, not engine-scoped.
- **UX & screens:** `#stats-modal` (id `stats-modal`) in the inbox blade with six tiles (Open, Awaiting reply, Unassigned, SLA Breached, Resolved Today, Avg First Reply) and an agent table (Agent, Status, Load, Replies, Resolutions, Last seen), auto-refresh every 30 s. The opener `#nav-stats` no longer exists in the markup, so the modal is unreachable (dead UI superseded by the analytics pages).
- **Endpoints:**
  | Endpoint                 | Route name                | Action                    | Middleware   | Request | Response                                                                                                                                                                                                       |
  | ------------------------ | ------------------------- | ------------------------- | ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET team-inbox/api/stats | user.team-inbox.api.stats | TeamInboxController@stats | Authenticate | none    | `{queue:{open, awaiting_reply, unassigned, sla_breached, resolved_today}, avg_first_response_minutes, agents:[{user_id,name,status,current_load,today_replies,today_resolutions,last_seen_at}], generated_at}` |
- **Data:** counts on `conversations` for the workspace: open = status open/pending; awaiting_reply = open with no `first_response_at`; unassigned = open with null assignee user; sla_breached = open and flagged; resolved_today = resolved with `resolved_at` on today's app-timezone date. Average first response = mean minutes from `created_at` to `first_response_at` over conversations resolved in the last 7 days (rounded, null when none). Agents from `agent_statuses` (rolled over when stale), user name "Unknown" if missing.
- **Rules & edge cases:** 1. Not scoped by engine or device. 2. A conversation assigned only to a team counts as unassigned. 3. Business hours are ignored in the average.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 open conversations (1 unassigned, 1 breached) and 2 resolved today, When called, Then counts match.
  - Given no resolved conversations in 7 days, When called, Then `avg_first_response_minutes` is null.
  - Given an Agent, When called, Then 200 (parity).
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (stats), `resources/views/user/team-inbox/index.blade.php` (stats-modal), `resources/js/charts/user-team-inbox-index.js` (Team Performance Stats).
- **Port notes:** expose as `GET /inbox/stats` behind `analytics.view`; consider merging with the queue counts (TIB1) to avoid duplicate aggregation.

### TW-TIB2-034 — Team Performance analytics

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-TIB2-023
- **Summary:** A live page showing workspace totals and a per-agent breakdown of replies, resolutions, average first-reply time, availability and load for today, this week or this month, with an optional per-device filter.
- **Actors & access:** page: workspace role Manager or higher plus plan feature `access_team_performance` (GET only soft-gated with a paywall overlay). The JSON endpoint has only `Authenticate`, so any member can call it directly (QUIRK). The rail icons are shown by `analytics.view` (Owner, Admin, Manager).
- **UX & screens:** `resources/views/user/team-inbox/analytics-team.blade.php`. Header "How fast did your team respond?", a pulsing "Live" label, summary sentence ("N replies, N resolved, avg first reply X"), range tabs Today / This week / This month, device dropdown (hidden unless the workspace has 2+ devices, options from bootstrap; `?device_id=` deep link supported and kept in the URL), four tiles (Replies sent, Resolved, Inbounds, Avg first reply as `Nm` or `Nh Nm`), table Agent / Status / Load / Replies / Resolved / Avg reply / Last seen with skeleton rows while loading and "No agent activity in this window." when empty; links to AI Performance and back to inbox; refreshes every 30 s; errors only go to the console.
- **Endpoints:**
  | Endpoint                          | Route name                         | Action                                | Middleware                                                                            | Request                                                                                       | Response                                                                                                                                                               |
  | --------------------------------- | ---------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET team-inbox/analytics/team     | user.team-inbox.analytics.team     | TeamInboxController@teamAnalyticsPage | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_team_performance | none                                                                                          | HTML page                                                                                                                                                              |
  | GET team-inbox/api/analytics/team | user.team-inbox.api.analytics.team | TeamInboxController@teamAnalytics     | Authenticate                                                                          | `range` in today (default), week, month (anything else = today); `device_id` optional integer | `{range, since, totals:{replies, resolved, inbounds, avg_first_response}, agents:[{user_id,name,replies,resolved,avg_response_min,status,current_load,last_seen_at}]}` |
- **Data:** `since` = start of day / start of week (Carbon default Monday) / start of month in the application timezone. Replies = outbound `inbox_messages` created since, with no `agent_id` (AI excluded), grouped by author `user_id`; resolved per user = conversations with status resolved and `resolved_at >= since` grouped by `resolved_by`; avg response per user = mean minutes `created_at` to `first_response_at` over conversations resolved since, grouped by the ASSIGNED user; totals: replies (human outbound), resolved (all resolved since), inbounds (inbound `inbox_messages`), workspace average first response. Device filter joins on `conversations.device_id`.
- **Rules & edge cases:**
  1. QUIRK: the agent list is driven by users who sent at least one human outbound message in the window, so members who only resolved or were assigned appear only if they replied.
  2. QUIRK: automated outbound rows written by routing/keyword/outside-hours auto-replies have `agent_id` null and `user_id` = the conversation owner, so they inflate that owner's reply count.
  3. The average is over resolved-in-window conversations, not all conversations, and measures calendar time (no business hours); it credits the current assignee, not whoever replied first.
  4. Status falls back to `offline` when no `agent_statuses` row exists.
  5. Time boundaries use the application timezone, not the workspace timezone.
  6. No pagination, export, CSAT or SLA compliance figures here (the separate `/analytics` page owned by DASH has an agent roll-up with CSAT).
- **Async & events:** none (page polls).
- **External systems:** none.
- **Settings:** package `access_team_performance`.
- **Acceptance criteria:**
  - Given a Manager opens the page on Today, When two agents replied, Then both rows show their reply counts and the totals equal the sums (excluding AI replies).
  - Given `range=month&device_id=7`, When called, Then every aggregate narrows to conversations on device 7.
  - Given `range=foo`, When called, Then it behaves as today.
  - Given an Agent, When opening the page URL, Then redirected to /team-inbox.
  - Given a plan without `access_team_performance`, When a Manager opens the page, Then it renders with a paywall overlay.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (teamAnalyticsPage, teamAnalytics), `resources/views/user/team-inbox/analytics-team.blade.php`, `app/Models/AgentStatus.php`, `routes/web.php`, `Documentation/pages/messaging/team-inbox.html`.
- **Port notes:** `GET /inbox/analytics/team` with `analytics.view`; compute in SQL over event tables in the org timezone; attribute auto-replies to the automation, not a user; add pagination and CSV export as follow-ups.
- **Built (Threadwise):** `GET /v2/inbox/analytics/team` (permission `inbox.analytics.view`, plan feature `team_performance`), page `/inbox/analytics/team`, Settings tile `team-performance` (with an inbox shortcut) instead of Reference's rail icons; see `docs/api/team-inbox-routing-sla.md`. QUIRK 1 (agents listed only if they replied) kept; QUIRK 2 (auto-replies inflating the owner's count) fixed; the open JSON endpoint is gated. Not built: the link to AI Performance (TW-TIB2-035).

### TW-TIB2-035 — AI Agent Performance analytics

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** —
- **Summary:** A live page showing, per AI agent, messages sent and failed, success rate, conversations handled, conversations currently assigned, average self-rated quality (1-10) and the ten most recent rated replies, over today/week/month with an optional device filter.
- **Actors & access:** page: Manager or higher plus `access_team_performance` (soft paywall); JSON endpoint: `Authenticate` only.
- **UX & screens:** `resources/views/user/team-inbox/analytics-ai.blade.php`: header "How well are your AI agents doing?" with the note that AI scores its own reply and the score is never shown to the customer; range tabs; device dropdown (2+ devices); cards per agent (avatar initials on the agent colour, name, active/off chip, provider, model, tone; Sent, Success %, Active; Self-rating x/10 with colour thresholds green >= 8, amber >= 5, red below and a progress bar; "N rated, N convos, N lifetime"); "Recent self-rated replies" list (agent, conversation number, time, note in italics, score). Empty states: "No AI agents yet - set them up in the team-inbox sidebar." and "No rated replies yet. ..." Auto-refresh 30 s.
- **Endpoints:**
  | Endpoint                               | Route name                       | Action                              | Middleware                                                                            | Request                                           | Response                                                                                                                                                                                                                                                                    |
  | -------------------------------------- | -------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET team-inbox/analytics/ai-agents     | user.team-inbox.analytics.ai     | TeamInboxController@aiAnalyticsPage | Authenticate, EnsureWorkspaceRole:manager, EnforcePlanFeature:access_team_performance | none                                              | HTML page                                                                                                                                                                                                                                                                   |
  | GET team-inbox/api/analytics/ai-agents | user.team-inbox.api.analytics.ai | TeamInboxController@aiAnalytics     | Authenticate                                                                          | `range` (today default, week, month), `device_id` | `{range, since, agents:[{id,name,provider,model,tone,avatar_color,is_active,messages_sent,messages_failed,success_rate,conversations,active_now,avg_quality,rated_count,lifetime_sent}], recent_rated:[{id,agent_name,agent_color,conversation_id,score,note,created_at}]}` |
- **Data:** per agent, `inbox_messages` with that `agent_id` since the range start joined to workspace conversations: sent (count), failed (status failed), distinct conversations, average and count of `quality_score` (rounded to 1 decimal); `active_now` = conversations assigned to the agent in open/pending regardless of range; `success_rate` = (sent - failed)/sent as a percentage with 1 decimal, null when nothing was sent; `lifetime_sent` from `ai_agents.messages_sent`. `recent_rated` = last 10 rated AI messages of the workspace (device filter applies), newest by id.
- **Rules & edge cases:** 1. Agents listed regardless of activity (ordered by id). 2. Time boundaries in app timezone. 3. `quality_score`/`quality_note` are written by the AI service (AIAG).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package `access_team_performance`.
- **Acceptance criteria:**
  - Given an agent with 10 sent and 1 failed today, When the page loads, Then success = 90%.
  - Given no messages in range, When loaded, Then the success rate shows a dash.
  - Given a device filter, When applied, Then counts and the recent-rated list narrow to that device.
  - Given a workspace with no agents, When loaded, Then the empty card message appears.
- **Source refs:** `app/Http/Controllers/TeamInboxController.php` (aiAnalyticsPage, aiAnalytics), `resources/views/user/team-inbox/analytics-ai.blade.php`, `app/Models/AiAgent.php`.
- **Port notes:** ownership could move to AIAG; keep the payload contract; require `analytics.view` on the API.

### TW-TIB2-036 — Platform support-desk SLA engine and breach scan

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-TIB2-024
- **Summary:** A separate SLA engine for the platform's own support tickets (SUPP domain) lives in `SlaCalculator` and shares the `sla_policies` table (rows with null `workspace_id`). It computes deadlines with real business-hours math, reports status pills and persists breach rows via `support:sla-scan`. Documented here because it contains the only business-hours-aware SLA algorithm in Reference and shares the SlaPolicy model.
- **Actors & access:** platform staff (admin console, SUPP owns the routes `admin/support/sla*` and the board view). System for the scan.
- **UX & screens:** consumed by the admin support inbox (per-ticket "12m left / 8m over" pills, `SlaCalculator::status`) and the admin SLA board (SUPP).
- **Endpoints:** none owned here (`GET admin/support/sla`, `POST admin/support/sla/policies`, `PATCH/DELETE admin/support/sla/policies/{id}` belong to SUPP).
- **Data:** reads `sla_policies` (platform-wide, default policy = `is_default`), `support_tickets`, `workspaces.business_hours`/`timezone`; writes `sla_breaches` (`ticket_id` FK cascade, `sla_policy_id` FK null on delete, `breach_type` first_response|resolution, `breached_at`, `severity` warn|breach, `over_by_minutes`). Admin policy form validation: name max 120, first_response 1..10080, resolution 1..43200 minutes; default flag exclusive platform-wide.
- **Rules & edge cases:**
  1. Policy for a ticket = its `sla_policy_id` else the platform default (`is_default`).
  2. Deadline = ticket `created_at` plus target minutes; when the policy respects business hours, minutes are added only inside open windows (weekdays 09:00-17:00 default) walking day by day with a 30-day look-ahead guard, in the workspace timezone, result converted back to app timezone.
  3. Severity: met (answered/resolved in time), breach (late or overdue), warn when remaining time is below max(5 minutes, a quarter of the window), else ok.
  4. QUIRK: the expected `business_hours` shape here (`tz` and `days[day] = [open, close]`) differs from the workspace schedule saved by TW-TIB2-001 (`days[day] = {enabled, from, to}`), so for a workspace that saved hours the positional destructuring reads undefined offsets (probable bug; disabled days are treated as open too). Needs verification against a ticket whose workspace has saved hours.
  5. `scanAndPersist` walks unresolved tickets in chunks of 200 and inserts at most one breach row per ticket and type (checked in code, not by a unique index).
  6. QUIRK: `support:sla-scan` is not scheduled and the queue poll does not call it (despite comments), so `sla_breaches` stays empty unless a host cron runs the command.
  7. Workspace inbox policies and platform policies share the table; the inbox tracker ignores null-workspace rows and the admin engine ignores workspace rows.
- **Async & events:** command `support:sla-scan` (no schedule).
- **External systems:** none.
- **Settings:** platform default SLA policy.
- **Acceptance criteria:**
  - Given a ticket created Friday 16:30 with a 60-minute first-response target under a business-hours policy, When computed, Then the deadline is Monday 09:30 workspace time.
  - Given a ticket 10 minutes over its deadline, When scanned twice, Then exactly one `sla_breaches` row exists with `over_by_minutes` 10.
  - Given the remaining time under a quarter of the window, When status is requested, Then severity is warn.
- **Source refs:** `app/Support/SlaCalculator.php`, `app/Console/Commands/Support/ScanSlaBreaches.php`, `app/Http/Controllers/Admin/Support/SlaController.php`, `app/Http/Controllers/Admin/Support/InboxController.php`, `database/migrations/2026_05_23_154446_support_module_phase1_schema.php`, `database/migrations/2026_05_23_160344_support_phase1_fixes_sla_nullable_status_remap.php`.
- **Port notes:** share one SLA calculator between workspace conversations and platform tickets in a `sla` package; unify the business-hours schema; schedule the scan as a repeatable worker job.

## Data model

**`routing_rules`** (owned; ~0-50 rows per workspace; read on every inbound of that workspace). Columns: `id`; `workspace_id` (NOT NULL, no FK); `name` varchar(128); `conditions` JSON NOT NULL (list of condition nodes, see TW-TIB2-011; the API stores `[]` for a catch-all); `actions` JSON NOT NULL (list of action dicts: `assign_team{team_id}`, `assign_user{user_id}`, `assign_agent{agent_id}`, `set_priority{value}`, `add_tag{name,color?}`, `auto_reply{template_id?,body?}`, `trigger_flow{flow_id}`, `mark_spam`, `set_sla{sla_policy_id}`, `set_escalation{minutes,then_action}`); `stop_on_match` bool DEFAULT 1; `is_active` bool DEFAULT 1; `is_fallback` bool DEFAULT 0; `sort` unsigned int DEFAULT 0 (UI never sets it); `fired_count` bigint DEFAULT 0; `last_fired_at`; timestamps. Indexes: (workspace_id, is_active, sort), workspace_id, is_fallback. Written by TW-TIB2-005/006/007 and the engine (`fired_count`, `last_fired_at`); read by TW-TIB2-004, 008, 010.

**`sla_policies`** (owned, shared row-space with SUPP). Columns: `id`; `workspace_id` NULLABLE (null = platform support-desk policy, TW-TIB2-036); `name` varchar(128); `first_response_minutes`, `resolution_minutes` unsigned int NULL; `pause_when_waiting_on_customer` bool DEFAULT 1 (unused); `respect_business_hours` bool DEFAULT 1 (used only by the platform ticket engine); `device_ids` JSON NULL (list of device ids, null/empty = all devices); `priority_overrides` JSON NULL (`{low|normal|high|urgent:{first_response_minutes?,resolution_minutes?}}`); `is_default` bool DEFAULT 0 (uniqueness maintained in code); timestamps. Indexes: (workspace_id, is_default), workspace_id. No FK from `conversations.sla_policy_id` (deleting leaves dangling ids). Written by TW-TIB2-024/025 and SUPP's admin form; read by TW-TIB2-026 and 036.

**`agent_statuses`** (owned; one row per user per workspace, grows with membership). Columns: `id`; `user_id`, `workspace_id` (unique together); `status` varchar(12) DEFAULT online (online, away, busy, offline); `status_message` varchar(128); `last_seen_at` (indexed); `current_load` unsigned int DEFAULT 0 (only maintained by assignment); `today_replies`, `today_resolutions` unsigned int; `counters_date` date (rollover marker); `preferences` JSON (unused); timestamps. Written by TW-TIB2-023 (middleware, bootstrap, set status), reply/resolve endpoints (counters), TW-TIB2-020 (load); read by 020, 033, 034 and bootstrap.

**`sla_breaches`** (shared with SUPP; support-desk tickets only; empty by default because the scan is unscheduled). Columns: `id`; `ticket_id` FK support_tickets ON DELETE CASCADE; `sla_policy_id` FK sla_policies ON DELETE SET NULL; `breach_type` varchar(24) (first_response|resolution); `breached_at` DEFAULT now; `severity` varchar(16) DEFAULT warn; `over_by_minutes`. Index (ticket_id, breach_type). Written by `SlaCalculator::scanAndPersist` (TW-TIB2-036).

**Columns of tables owned by other domains that this domain reads or writes** (definitions live with TIB1/WSP): `conversations.inbox_status` (open, pending, snoozed, resolved, closed, spam), `priority` (low, normal, high, urgent; default normal), `assignee_user_id`, `assignee_team_id`, `assignee_agent_id`, `first_response_at`, `snoozed_until`, `resolved_at/resolved_by`, `sla_policy_id`, `sla_first_response_due`, `sla_resolution_due`, `sla_breached`, `escalation_due_at`, `escalation_action`, `routing_meta` JSON (`fired_rules`, `at`, `pending_flow_id`, `pending_flow_at`, `last_auto_reply_at`, `voice_assistant_id`, `ai_paused_by_*`), `last_inbound_at`, `last_outbound_at`, `device_id` (polymorphic: devices.id for Baileys, wa_provider_configs.id for WABA/Twilio); `conversation_events` (`type`, `payload`, `actor_type` user|system|rule|flow|human); `teams.assignment_strategy` (manual default), `teams.device_ids`, `team_user.capacity` (default 20) and `is_lead`; `workspaces.business_hours`, `timezone`; `inbox_messages` (`user_id`, `agent_id`, `direction`, `quality_score`); `inbox_notifications` (types assigned, snooze_wake, sla_breach).

## Cross-domain contracts

- **Consumes from TIB1:** the conversation aggregate and its columns; the inbound webhook handlers that call `RoutingEngine::applyToInbound(conversation, context{message_text, contact_phone}, isFollowUp)`; the reply/media/voice endpoints that call `SlaTracker::markFirstResponse` and clear escalation; the resolve endpoint that calls `applyOnResolution`; the `queue` poll that hosts the sweep hook (TW-TIB2-032) and the `sla_breach` tab; `bootstrap` carrying `routing_rules`, `sla_policies`, `business_hours`, members with status; bulk assign/snooze. Routes TIB2 took from `TeamInboxController`: routing (4), business-hours (2), SLA JSON (3) and SLA web (4), `assign`, `unassign`, `snooze`, `me/status`, `stats`, analytics pages (2) and analytics APIs (2). Left to TIB1: `queue`, `bootstrap`, `bulk`, `resolve`, `reopen`, `priority`, presence/typing, `kanban`, notes, tags, reply endpoints, `sync-history`.
- **Consumes from WSP:** `teams` and their `assignment_strategy`, `device_ids`, members and `capacity`; workspace timezone; workspace membership; team CRUD (routes `team-inbox/api/teams*`).
- **Consumes from RBAC:** workspace permissions `routing.manage`, `sla.manage`, `inbox.assign`, `inbox.assign_self`, `inbox.snooze`, `inbox.bulk`, `analytics.view`; `ConversationPolicy` (assign, snooze); `EnsureWorkspaceRole` middleware (manager for SLA page and analytics pages).
- **Consumes from PLAN:** `PlanLimitGuard::feature/check`, `EnforcePlanFeature` (soft GET gate), package fields `access_routing_rules`, `routing_rules_limit`, `access_sla_policies`, `access_team_performance`, `access_business_hours` (unenforced).
- **Exposes to NOTIF:** trigger points for `notifyAssignment`, `notifySnoozeWake` (and the unused `notifySlaBreach`); audit events `conversation.assigned`, `conversation.unassigned`, `conversation.snoozed`; the notification preference key `sla_breached`.
- **Exposes to FLR/FLB:** `AssignmentService::assign` (flow "Assign" node via `POST api/flow-node/assign`), `Workspace::isOutsideBusinessHours` (Flow `out_of_hours` trigger), `routing_meta.pending_flow_id` slot and the `routing_actions.flow_id` field of the Baileys inbound response consumed by `node/classes/BaileysClientManager.js` (NODE).
- **Consumes from AIAG:** `AiAgentService::respondIfAssigned`; exposes the AI-pause-on-human-assignment behavior and the AI analytics page.
- **Consumes from AR:** `AutoReplyGuard` (no-op) and template records (`wa_templates`) for the auto-reply actions; away-mode and keyword replies are AR's.
- **Consumes from WADEV/WABA/NODE:** `InboxDispatcher::send`, device records for the device-scope guards and placeholders.
- **Shares with SUPP:** `sla_policies` table, `SlaPolicy` model, `SlaCalculator`, `support:sla-scan`, `sla_breaches`; SUPP owns `admin/support/sla*` routes and the admin SLA board view.
- **Shares with DASH:** the workspace `/analytics` page also computes agent first-response/resolution averages and CSAT from the same conversation columns.
- **Shares with ASHELL/TIB1:** the platform-side team inbox (`admin/team-inbox*`, `admin/support/team-inbox`) is NOT in this domain (see Open questions).

## Open questions & quirks

1. **Platform inbox ownership.** `Admin\AdminTeamInboxController` routes (`admin/team-inbox`, `.../api/queue`, `.../conversations/{id}`, `note`, `spam`, `flag`, `suspend`, `unsuspend`, `audit`) and `Admin\Support\TeamInboxController` (`admin/support/team-inbox`, `admin/support/{id}/move`) belong to no TIB2 feature. WSP documented the suspend/flag actions, NOTIF the audit log, RBAC the permissions; the page/queue/note/spam actions look like TIB1 or ASHELL/SUPP territory. Flagged for the orchestrator.
2. **Bulk actions** (`POST team-inbox/api/bulk`) mix TIB2 semantics (assign, snooze) with TIB1 ones; left to TIB1 and cross-referenced in TW-TIB2-021 and 030.
3. **`assign-agent` and `assign-assistant`** (AI attachments) left to AIAG/TIB1; `POST api/flow-node/assign` left to FLR.
4. **Dead or unwired code:** `SlaBreached` event and `notifySlaBreach` never used (TW-TIB2-029); `AutoReplyGuard` disabled so cooldown/spam fields do nothing (TW-TIB2-003); stats modal has no opener (TW-TIB2-033); `AgentStatus::available` scope, `agent_statuses.preferences`, `team_user.is_lead`, `teams.default_assignee_user_id`, `teams.business_hours`, `teams.timezone` are never used by routing; `pause_when_waiting_on_customer` and `respect_business_hours` never influence workspace SLA due dates; `inbox:escalate`, `inbox:wake-snoozed`, `support:sla-scan` are never scheduled.
5. **Docs vs code:** the docs page promises contact-tag and language conditions (never fed), an anti-spam cooldown on auto-replies (disabled), SLA pause and business-hours-aware SLA (not implemented), drag-to-reorder of rules (absent), operators setting their own availability (no UI), a live SLA countdown (implemented by TIB1 header), priority-overridden SLA targets (only via API, and effective only if priority was set before the first inbound) and "set SLA" rule action (API-only and ineffective). Docs statement that Managers cannot edit routing/SLA matches code.
6. **Security/authorization gaps worth fixing in the port:** analytics and stats JSON endpoints require only login (any viewer/agent can read per-agent stats); routing rules and SLA policies are readable by every member and shipped in bootstrap; SLA JSON PATCH is unvalidated; `outside_template_id` and `set_sla.sla_policy_id` and `assign_agent.agent_id` are not workspace-scoped at save time; SLA web writes do not enforce the plan flag.
7. **Rule-driven assignment side effects missing:** no assignee notification, no `ConversationAssigned` broadcast, no outbound `conversation.assigned` webhook; timeline event actor type recorded as `user` with a null actor.
8. **Double AI reply risk:** the `assign_agent` action calls the AI responder inline and `WaInboundController` calls it again after routing; whether the AI service dedupes per inbound message is unverified.
9. **Sticky strategy** reads the legacy `messages` table for the last human replier while Team Inbox stores replies in `inbox_messages`; likely always falls through to least_loaded. Needs a seeded-data check.
10. **`current_load` drift** (TW-TIB2-020 rule 4) and **round_robin's `updated_at` proxy** (rule 5) make assignment fairness unpredictable.
11. **`SlaCalculator` vs workspace business hours schema mismatch** (TW-TIB2-036 rule 4) may throw for tickets whose workspace saved hours; verify with a live ticket.
12. **Channel coverage:** routing and SLA never run for chatbot-widget or Instagram (Instaflow) conversations; outside-hours reply runs only for Baileys; `trigger_flow` only starts a flow for Baileys.
13. **Timezone inconsistencies:** condition fields `time_of_day` / `day_of_week`, analytics `since` boundaries and `resolved_today` use the app timezone, while business hours use the workspace timezone.
14. **Snooze leftovers:** `snoozed_until` is not cleared when a customer message or a manual reopen exits the snoozed state; bulk snooze accepts past times.
15. **Seed data:** the reference database has zero routing rules, zero SLA policies and one agent_statuses row, so live parity checks need fixtures.
16. **Permission manifest:** the four Spatie keys `inbox.view`, `inbox.reply`, `inbox.assign`, `inbox.export` in `permissions.txt` are RBAC's catalogue-only admin keys and do not gate any workspace behavior in this domain; the real workspace permission names are the `WorkspacePermissions` constants listed above, which are not in the manifest and therefore not in the coverage block.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET team-inbox/api/routing",
    "POST team-inbox/api/routing",
    "PATCH team-inbox/api/routing/{id}",
    "DELETE team-inbox/api/routing/{id}",
    "GET team-inbox/api/business-hours",
    "POST team-inbox/api/business-hours",
    "GET team-inbox/api/sla",
    "POST team-inbox/api/sla",
    "PATCH team-inbox/api/sla/{id}",
    "GET team-inbox/sla",
    "POST team-inbox/sla",
    "PUT team-inbox/sla/{id}",
    "DELETE team-inbox/sla/{id}",
    "POST team-inbox/api/conversations/{id}/assign",
    "POST team-inbox/api/conversations/{id}/unassign",
    "POST team-inbox/api/conversations/{id}/snooze",
    "POST team-inbox/api/me/status",
    "GET team-inbox/api/stats",
    "GET team-inbox/analytics/team",
    "GET team-inbox/analytics/ai-agents",
    "GET team-inbox/api/analytics/team",
    "GET team-inbox/api/analytics/ai-agents"
  ],
  "controllers": ["app/Http/Controllers/TeamInboxController.php"],
  "services": [
    "app/Services/Inbox/RoutingEngine.php",
    "app/Services/Inbox/AssignmentService.php",
    "app/Services/Inbox/SlaTracker.php",
    "app/Support/SlaCalculator.php"
  ],
  "models": ["RoutingRule", "SlaPolicy", "AgentStatus"],
  "tables": ["routing_rules", "sla_policies", "agent_statuses", "sla_breaches"],
  "views": [
    "resources/views/user/team-inbox/sla.blade.php",
    "resources/views/user/team-inbox/analytics-team.blade.php",
    "resources/views/user/team-inbox/analytics-ai.blade.php",
    "resources/views/user/team-inbox/index.blade.php"
  ],
  "commands": ["inbox:escalate", "inbox:wake-snoozed", "support:sla-scan"],
  "permissions": [],
  "middleware": ["app/Http/Middleware/RecordAgentActivity.php"],
  "node_files": [],
  "js_assets": ["resources/js/charts/user-team-inbox-index.js"],
  "misc_files": [
    "app/Events/Inbox/SlaBreached.php",
    "app/Events/Inbox/ConversationAssigned.php",
    "app/Exceptions/AssignmentTargetException.php"
  ],
  "config_files": [],
  "doc_pages": ["Documentation/pages/messaging/team-inbox.html"],
  "feature_map": {
    "TW-TIB2-001": ["GET team-inbox/api/business-hours", "POST team-inbox/api/business-hours"],
    "TW-TIB2-002": [],
    "TW-TIB2-003": [],
    "TW-TIB2-004": ["GET team-inbox/api/routing"],
    "TW-TIB2-005": ["POST team-inbox/api/routing"],
    "TW-TIB2-006": ["PATCH team-inbox/api/routing/{id}"],
    "TW-TIB2-007": ["DELETE team-inbox/api/routing/{id}"],
    "TW-TIB2-008": [],
    "TW-TIB2-009": [],
    "TW-TIB2-010": [],
    "TW-TIB2-011": [],
    "TW-TIB2-012": [],
    "TW-TIB2-013": [],
    "TW-TIB2-014": [],
    "TW-TIB2-015": [],
    "TW-TIB2-016": [],
    "TW-TIB2-017": [],
    "TW-TIB2-018": [],
    "TW-TIB2-019": [],
    "TW-TIB2-020": [],
    "TW-TIB2-021": ["POST team-inbox/api/conversations/{id}/assign"],
    "TW-TIB2-022": ["POST team-inbox/api/conversations/{id}/unassign"],
    "TW-TIB2-023": ["POST team-inbox/api/me/status"],
    "TW-TIB2-024": [
      "GET team-inbox/api/sla",
      "POST team-inbox/api/sla",
      "PATCH team-inbox/api/sla/{id}"
    ],
    "TW-TIB2-025": [
      "GET team-inbox/sla",
      "POST team-inbox/sla",
      "PUT team-inbox/sla/{id}",
      "DELETE team-inbox/sla/{id}"
    ],
    "TW-TIB2-026": [],
    "TW-TIB2-027": [],
    "TW-TIB2-028": [],
    "TW-TIB2-029": [],
    "TW-TIB2-030": ["POST team-inbox/api/conversations/{id}/snooze"],
    "TW-TIB2-031": [],
    "TW-TIB2-032": [],
    "TW-TIB2-033": ["GET team-inbox/api/stats"],
    "TW-TIB2-034": ["GET team-inbox/analytics/team", "GET team-inbox/api/analytics/team"],
    "TW-TIB2-035": ["GET team-inbox/analytics/ai-agents", "GET team-inbox/api/analytics/ai-agents"],
    "TW-TIB2-036": []
  }
}
```

## Port note: data model (2026-10-02)

`agent_statuses` gains `last_assigned_at`, the clock a real round robin needs (Reference's pick used the oldest `conversations.updated_at`,
which any edit bumps). `conversations` now carries `waiting_since` (the start of the current wait for a human answer) and `msg_seq`; the
partial due-date indexes for the sweeps are in `20261014100000_chat_conversation_reshape.sql`. See
[docs/api/chat-conversations.md](../../api/chat-conversations.md).

## Port note: auto-assignment rules (2026-10-07)

Built: TW-TIB2-004, 005, 006, 007, 008, 009 (the manager modal is a page, `/auto-assignment`, with a form page) and, for the **assign** action only, 010, 011, 012, 013, 020.
See [docs/api/team-inbox-routing-sla.md](../../api/team-inbox-routing-sla.md#auto-assignment-routing-rules-tw-tib2-004-to-011-020-assign-action-only).
Not built (the rows stay in-progress): the actions `set_priority`, `add_tag`, `mark_spam`, `set_sla`, `assign_agent`, `auto_reply`, `trigger_flow`, `set_escalation`
(TW-TIB2-014 to 018); the `sticky` and team-`strategy` assignment and capacity (020); follow-up filtering (rules only act on a new or reopened conversation); the
`priority`, `time_of_day`/`day_of_week` and `incoming_device` conditions; business hours settings (001), SLA, snooze, reports.

Additions beyond the inventory (parity deviations, decided by the owner's request):

- Strategies `least_busy` and `specific` on a set of people and teams (Reference's only assign actions were `assign_team`/`assign_user`).
- The `contact` condition (the shared segment rule builder over contact fields and tags), `keywords` any/all, `languages` (from the translation reading), `channelKinds`.
- Real priority (`sort`) with a reorder endpoint and up/down buttons; duplicate; one fallback only; rules saved switched off ("Save" vs "Save and Activate").
- Description of a rule (stored as a `note` action); read needs `inbox.settings.read` (Reference: every member), write `inbox.routing.manage`.
- Rule-driven assignment emits the timeline event (actor `system`), audit, the `conversation.assigned` outbox event and realtime, as the inventory's port notes recommended.
- "Keep returning contacts with their agent" (`workspace_settings.routing_keep_contact_agent`).
- With `stop_on_match` off, a later firing rule reassigns (parity with Reference's sequential actions).
