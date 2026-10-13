# Inbox phase 3 and beyond: gap table, first slice, the rest (BL-036)

Written 2026-10-14 on `lakshya/partial/inbox3`. Evidence is the code at `origin/main` before this change. Inventory entries:
TW-TIB1-035 (priority), 036 and 037 (labels), 039 (bulk), 016 (24-hour window), TW-TIB2-024 to 029 (SLA). Wiring map:
[team-inbox-routing-sla](../threadwise-port/wiring/team-inbox-routing-sla.md).

## 1. Gap table (before this change)

| Item                                                | State                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Template send from the composer, window closed      | built                      | API `GET /inbox/conversations/:id/templates` and `POST .../messages` with `kind: template` (`inbox.controller.ts`, `inbox-thread.service.ts`, `inbox-template-rules.ts`); web banner with the "Send a template" action (`thread-pane.tsx`, `windowBanner.sendTemplate`), `template-picker.tsx` (search, variable form, live preview, only approved templates of the number, a template the inbox cannot fill is listed disabled with its reason); e2e `inbox-template-bubble.e2e.spec.ts`.                                                                         |
| Template send: plan and wallet cost shown           | missing                    | `template-picker.tsx` shows no price. Broadcasts show cost (`apps/web/src/features/broadcasts`); the send itself is already refused with `PLAN_LIMIT_REACHED` before queueing. Not built: a cost line in the picker.                                                                                                                                                                                                                                                                                                                                               |
| Bulk actions on the list                            | missing                    | No route, no UI. `inbox.conversation.bulk` was in the AWAITING list of `key-coverage.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Snooze (`inbox.conversation.snooze`)                | missing                    | Column `conversations.snoozed_until`, status `snoozed`, index `idx_conversations_snooze_due`, timeline types `snoozed` and `auto_unsnoozed`, status chip in the row and header existed; no route set it and no job woke a thread.                                                                                                                                                                                                                                                                                                                                  |
| Priority (`inbox.conversation.priority`)            | partial                    | Column `conversations.priority` and the row chip existed; no route changed it from the inbox (only the contract and the timeline type `priority_changed`).                                                                                                                                                                                                                                                                                                                                                                                                         |
| Conversation labels (`inbox.conversation.tag`)      | built (2nd milestone, 2.5) | Table `conversation_tag` (RLS, composite FK to `tags`) exists in `packages/db/src/schema/team-inbox-conversations/tables.ts`; nothing reads or writes it; no picker, no list filter, no chip.                                                                                                                                                                                                                                                                                                                                                                      |
| Workspace label master list (`inbox.tag.manage`)    | missing                    | `tags` table belongs to contacts (`contacts-attributes-tags`); no inbox route manages it. In Reference there is no standalone screen either (TW-TIB1-037).                                                                                                                                                                                                                                                                                                                                                                                                         |
| SLA policies (`inbox.sla.manage`, plan `inbox_sla`) | partial                    | Tables `sla_policies` (first response, resolution, pause when waiting, business hours, priority overrides, default) and conversation columns `sla_policy_id`, `sla_first_response_due`, `sla_resolution_due`, `sla_breached` plus partial indexes exist; the detail response already returns `sla`; plan feature `inbox_sla` is defined (`plans-subscriptions-trials/catalogue.ts`) but gates nothing. No CRUD, no due-date computation, no sweep, no badge, no notification, no screen. `sla_breaches` is keyed by support-desk `ticket_id`, not by conversation. |
| Routing engine (auto-assignment)                    | built                      | `team-inbox-routing-sla` module, `inbox_routing` gate, `routing_rules` limit (wiring map). Out of scope here.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Saved replies, consent                              | built                      | Merged; untouched by this change. Opt-out STOP detection still runs first in inbound ingest (no ingest file changed).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Retention settings                                  | missing                    | Plan: forever in v1, a per-workspace `message_retention_days` later as a batched delete (`plan-inbox-chat.md` decision 5). Only the message-log archive exists (90 days live, archive one year: `message-log-archive.service.ts`). No setting, no sweep.                                                                                                                                                                                                                                                                                                           |
| Kanban (`inbox_kanban`), team performance           | missing                    | Plan features defined; no screen. Not part of this slice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## 2. Built in this slice

Items 2 and 3 of the brief, in full. Item 1 was already built (see the table); only the cost line is open.

### 2.1 Priority and snooze (single conversation)

- `POST /v2/inbox/conversations/:id/priority` `{rowVersion, priority}` needs `inbox.conversation.priority`; 200 with the row, 409 on a stale
  version, 422 on a bad value, no-op when unchanged. Writes the `priority_changed` timeline event, the `conversation.priority_changed` outbox event
  and an audit row, then publishes the realtime upsert.
- `POST /v2/inbox/conversations/:id/snooze` `{rowVersion, until}` needs `inbox.conversation.snooze`. `until` is 1 minute to 365 days ahead.
  Only open, pending and snoozed threads can be snoozed (else 422 `CONVERSATION_STATUS_INVALID`). Writes `snoozed` (timeline), audit, realtime.
  Waking early is the existing status route (`snoozed -> open`, which already clears `snoozed_until`).
- `InboxSnoozeWakeService` (worker only, `TeamInboxConversationsWorkerModule`, every 30 s): `FOR UPDATE SKIP LOCKED`, up to 100 threads per
  pass across workspaces, sets the thread open, clears the time, writes `auto_unsnoozed` (actor system), the `conversation.reopened` outbox event
  (`by: system`) and the realtime upsert. Safe on every worker at once and safe to repeat.
- Web: Priority and Snooze selects (and "Wake now" on a snoozed thread) in the thread header, shown by permission.

### 2.2 Bulk actions

- `POST /v2/inbox/conversations/bulk` `{ids (1..200, unique), action}`; action is one of `status` (open = reopen, pending, resolved, closed),
  `assign` (person and/or team, `null` clears), `mark_read`, `priority`, `snooze`.
- Needs `inbox.conversation.bulk` AND the action's own permission (resolve, assign or assign_self, read, priority, snooze), checked up front: a
  caller without either gets 403 and nothing runs.
- It is a loop over the single-conversation operations (`setStatus`, `AssignmentService.assign`, `InboxTriageService`, `markRead`), not a second
  implementation, so per conversation: visibility (an invisible or unknown id is `CONVERSATION_NOT_FOUND`), the action permission's own scope
  (403 per row), the state machine, the version check, the timeline and outbox events, the audit row and the realtime upsert all hold.
  Each conversation is its own transaction; one failure never undoes the others.
- Answer: `{requested, done, unchanged, failed, results: [{id, outcome, code?}]}`. Running the same request again answers `unchanged` for
  what is done. One extra audit row `conversations.bulk` carries the action and the counts.
- Web: a "Select" toggle on the list, checkbox rows, click toggles, shift-click selects the run, "Select all N in view", an "N selected" bar with
  Mark as read, Resolve, Close, Reopen, Assign (me, person, team, unassign), Priority, Snooze. After the call a toast reports done, already
  up to date and failed; the failed rows stay selected. A selection longer than 200 is sent in runs of 200. A selection belongs to its view:
  changing filters clears it, a row that leaves the list is dropped.

### 2.3 Differences from Reference (recorded as intended)

| Reference                                                                   | Here                                                                                                          | Why                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Bulk rows the caller may not touch are skipped silently, "touched: 0" toast | Each row answers done, unchanged or failed with a code; the toast says how many failed                        | Port note of TW-TIB1-039 (per-row results)                 |
| No cap on `ids`, synchronous loop                                           | 200 per request, the web sends longer selections in runs                                                      | Port note of TW-TIB1-039 (cap 200)                         |
| Bulk uses `bulk` instead of the action's right                              | `bulk` plus the action's own right                                                                            | A right must not be bypassable through the bulk door       |
| Bulk resolve skips SLA, notifications and webhooks                          | Same path as a single resolve (events, outbox, realtime)                                                      | Reference quirk, fixed                                     |
| Snooze with a past date is accepted                                         | 422 unless the time is at least a minute ahead                                                                | Reference quirk, fixed                                     |
| Bulk snooze with no date means one hour                                     | The client always sends a time (presets 1 h, 3 h, tomorrow 09:00, next Monday 09:00); no free date picker yet | Presets cover the common case; a date picker is open below |

### 2.5 Conversation labels (second milestone)

Reference first: TW-TIB1-036 (labels on a conversation) and 037 (the workspace list). The library is the `tags` table the contacts domain
already uses (Reference shares it as well: a label is a tag), so no migration: `conversation_tag` (RLS, composite FKs, cascade) and
`tags.description` existed. Creating a label goes through the contacts `TagsService`, which already holds the plan `tags` limit, the
case-insensitive unique name and the audit and outbox rows.

- API `GET /inbox/labels` (read the inbox; with usage counts), `POST /inbox/labels`, `PATCH /inbox/labels/:id` (rowVersion), `DELETE /inbox/labels/:id`
  (all `inbox.tag.manage`); `POST /inbox/conversations/:id/labels` (`tagId` or `name`) and `DELETE .../labels/:tagId` (`inbox.conversation.tag`,
  visibility and scope checked). Adding is idempotent; a change writes `tag_added` or `tag_removed` on the timeline, the outbox event
  `conversation.tag_added|tag_removed`, an audit row, bumps the row version and publishes the realtime upsert (`changed: ['labels']`).
- The list row and the detail carry `labels` (one subselect, no N+1) and the list takes `?labels=<id>,<id>` (any of them).
- Bulk: action `{type: 'label', mode: 'add'|'remove', tagId}`, also needing `inbox.conversation.tag`.
- Web: chips on rows and in the thread header, the header's Label menu (tick to add or remove; typing a new name creates it for label
  managers), a multi-select Labels filter above the list kept in the address (`?labels=`), a Label entry in the bulk bar, and the Settings tile
  "Labels" at `/inbox/labels` (create, edit, delete with the usage count). Colors are validated on write and again before they reach a style.
- Intended differences from Reference: a name that does not exist yet is created only by someone with `inbox.tag.manage` (Reference let any
  agent create through the thread and skipped the plan limit); the plan limit applies everywhere; the library can be renamed, recolored and
  described (Reference could not); an empty request is a 422 (Reference created an empty tag). Not built from Reference: the five "quick label"
  chips that also change the priority, and the flow enrolment on "tag added" (blocked on the flow triggers, FLR).
- Deleting a label removes it from contacts too (same tag); the screen says how many conversations carry it.

### 2.4 Not in the slice (still open, recorded in BL-036)

Bulk actions of Reference not built: **spam, archive and unarchive, pin and unpin, mute and unmute, delete**. The archive and pin
columns exist (`archived`, `pinned_at`) and fit the same bulk action union; delete needs an owner decision (see section 5).

## 3. Design for what is left

### 3.1 Labels: built, see 2.5 (design notes kept)

- Reuse `tags` (contacts domain, workspace master list) and `conversation_tag` (exists, RLS, composite FKs). No migration expected; check that
  `tags` has a `kind`/scope that allows conversation use, else add one column in a migration (add-migration skill).
- Routes: `GET /inbox/labels` (the master list, from the contacts barrel), `POST /inbox/conversations/:id/labels` `{tagId}`,
  `DELETE .../labels/:tagId`; creating a new label from the picker needs `inbox.tag.manage`. Timeline events `tag_added`, `tag_removed`
  (types exist), `actor_user_id` in `added_by`. The list gets a `labels` array on each row (one query for the page, no N+1) and a `labelId` filter;
  the bulk union gains `{type: 'label', tagId, mode: 'add'|'remove'}`.
- Web: chips on the row and header, a picker with search in the header and a Label entry in the bulk bar. `data-agent-ignore` is not needed
  (labels are staff-written), but a customer name next to them stays inside the existing ignored regions.

### 3.2 SLA policies (`inbox.sla.manage`, plan feature `inbox_sla`)

- Gate: `@RequirePlanFeature('inbox_sla')` on the policy routes (as `inbox_routing` does for rules); reads with `inbox.settings.read`, writes with
  `inbox.sla.manage`. The conversation columns and badge show only when the feature is on.
- CRUD over `sla_policies` (`/inbox/sla/policies`): name, first response minutes, resolution minutes, pause while waiting on the customer,
  respect business hours (`common/business-hours.ts`, shared with routing and flows), priority overrides, one default. `rowVersion`, audit, outbox.
- Due dates: on the first inbound message (inside the routing listener, after the opt-out check and before rules) pick the policy (rule
  `set_sla` action, else the default), compute `sla_first_response_due` and `sla_resolution_due` in business hours of the workspace timezone;
  recompute on priority change by the override. The first agent reply stamps `first_response_at` and clears the first-response clock; resolving
  stops the resolution clock; waiting-on-customer pauses it (store the paused minutes, do not shift the due time in place).
- Sweep (worker, every minute, privileged, `SKIP LOCKED`, uses the two partial indexes): conversations past a due time with `sla_breached = false`
  get `sla_breached = true`, a `sla_breach` timeline event and an outbox event `conversation.sla_breached`. The notification goes through the
  existing fan-out to the assignee, else the team, else holders of `inbox.sla.manage`, collapsed per conversation; plan gate `inbox_sla`; a bell
  row, push default off. Do not reuse `sla_breaches` (it is keyed by support ticket).
- UI: a breach badge and a countdown chip on the row, the SLA block in the header (the detail already returns `sla`), a Settings tile "SLA
  policies" with the list and a form, en and 20 locales, help guide with `gates.planFeature: inbox_sla`.
- Tests: pure due-date unit tests (business hours edge cases, pause, override), real-Postgres sweep and idempotency, e2e for the gate and the
  permission, web render en and ar.

### 3.3 Retention settings

`workspace_settings.message_retention_days` (null = forever, default; 90 to 3650), a settings tile, a worker sweep deleting in batches of 1000
messages older than the limit for closed or resolved conversations only (never an open thread), media removed with its message, audit row with the
count per run, owner-only right. Needs the owner's answer on delete versus anonymise (section 5).

### 3.4 Template send follow-up

A cost line in the picker: the price of one template message for the number's category and country from the wallet price list, and the balance
or plan allowance after it, using the same estimate call broadcasts use. Until then the send is refused with `PLAN_LIMIT_REACHED` or an
insufficient balance error, which the composer already maps.

## 4. Verification of this slice

See the change's report: typecheck (api, api spec, web), eslint of the touched folders, prettier, `pnpm --filter @crm/api arch`, unit (key
coverage), real-Postgres e2e `inbox-bulk.e2e.spec.ts` (9 tests) plus the existing inbox e2e, web render tests (en and ar) and the selection unit
tests. Not verified: a real browser session, the socket push in a browser, real WhatsApp or Meta, the Reference Playwright parity run (needs the
running reference).

## 5. Decisions for the owner

1. Bulk delete: Reference hard-deletes the conversation and leaves notes and events orphaned. Recommend soft-delete (hidden, purge by the
   retention sweep) with the right `inbox.conversation.delete`, or leave it out. Not built.
2. Retention: delete or anonymise, and the minimum (90 days proposed).
3. Snooze custom date: presets only for now; a date and time picker in the header and bulk bar needs a shared date-time component in `@crm/ui`.
4. Bulk over 200 conversations: the web sends runs of 200 in the foreground. A background job with progress (and "select every conversation that
   matches the filter") is a follow-up if the owners need thousands at once.
