# Inbox phase 3 and beyond: gap table, first slice, the rest (BL-036)

Written 2026-10-14 on `lakshya/partial/inbox3`. Evidence is the code at `origin/main` before this change. Inventory entries:
TW-TIB1-035 (priority), 036 and 037 (tags, once called labels here), 039 (bulk), 016 (24-hour window), TW-TIB2-024 to 029 (SLA). Wiring map:
[team-inbox-routing-sla](../threadwise-port/wiring/team-inbox-routing-sla.md).

## 1. Gap table (before this change)

| Item                                                | State                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Template send from the composer, window closed      | built                      | API `GET /inbox/conversations/:id/templates` and `POST .../messages` with `kind: template` (`inbox.controller.ts`, `inbox-thread.service.ts`, `inbox-template-rules.ts`); web banner with the "Send a template" action (`thread-pane.tsx`, `windowBanner.sendTemplate`), `template-picker.tsx` (search, variable form, live preview, only approved templates of the number, a template the inbox cannot fill is listed disabled with its reason); e2e `inbox-template-bubble.e2e.spec.ts`.                                                                                                                                                 |
| Template send: plan and wallet cost shown           | missing                    | `template-picker.tsx` shows no price. Broadcasts show cost (`apps/web/src/features/broadcasts`); the send itself is already refused with `PLAN_LIMIT_REACHED` before queueing. Not built: a cost line in the picker.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Bulk actions on the list                            | missing                    | No route, no UI. `inbox.conversation.bulk` was in the AWAITING list of `key-coverage.spec.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Snooze (`inbox.conversation.snooze`)                | missing                    | Column `conversations.snoozed_until`, status `snoozed`, index `idx_conversations_snooze_due`, timeline types `snoozed` and `auto_unsnoozed`, status chip in the row and header existed; no route set it and no job woke a thread.                                                                                                                                                                                                                                                                                                                                                                                                          |
| Priority (`inbox.conversation.priority`)            | partial                    | Column `conversations.priority` and the row chip existed; no route changed it from the inbox (only the contract and the timeline type `priority_changed`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Conversation tags (`inbox.conversation.tag`)        | built (2nd milestone, 2.5) | Table `conversation_tag` (RLS, composite FK to `tags`) exists in `packages/db/src/schema/team-inbox-conversations/tables.ts`; nothing reads or writes it; no picker, no list filter, no chip.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Workspace tag master list (`inbox.tag.manage`)      | missing                    | `tags` table belongs to contacts (`contacts-attributes-tags`); no inbox route manages it. In Reference there is no standalone screen either (TW-TIB1-037).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| SLA policies (`inbox.sla.manage`, plan `inbox_sla`) | built (3rd milestone, 2.6) | Tables `sla_policies` (first response, resolution, pause when waiting, business hours, priority overrides, default) and conversation columns `sla_policy_id`, `sla_first_response_due`, `sla_resolution_due`, `sla_breached` plus partial indexes exist; the detail response already returns `sla`; plan feature `inbox_sla` is defined (`plans-subscriptions-trials/catalogue.ts`) but gates nothing. No CRUD, no due-date computation, no sweep, no badge, no notification, no screen. `sla_breaches` was keyed by support-desk `ticket_id`, not by conversation, and has since been dropped (`20261216090000_drop_dormant_tables.sql`). |
| Routing engine (auto-assignment)                    | built                      | `team-inbox-routing-sla` module, `inbox_routing` gate, `routing_rules` limit (wiring map). Out of scope here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Saved replies, consent                              | built                      | Merged; untouched by this change. Opt-out STOP detection still runs first in inbound ingest (no ingest file changed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Retention settings                                  | missing                    | Plan: forever in v1, a per-workspace `message_retention_days` later as a batched delete (`plan-inbox-chat.md` decision 5). Only the message-log archive exists (90 days live, archive one year: `message-log-archive.service.ts`). No setting, no sweep.                                                                                                                                                                                                                                                                                                                                                                                   |
| Kanban (`inbox_kanban`), team performance           | missing                    | Plan features defined; no screen. Not part of this slice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

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

### 2.5 Conversation tags (second milestone; renamed from "labels")

**Naming decision (owner approved): one concept, one word.** The reference calls them tags (`conversation_tag` pivot, `Tag` model). The earlier
name "labels" was ours, confused users ("tags can also be used in chat, but we built labels") and is retired: every visible string, menu, aria label,
help guide and timeline line says tag, in all 21 locales. What was kept for compatibility is listed under "Kept as aliases" below. No data
migration: same tables.

Reference first: TW-TIB1-036 (tags on a conversation) and 037 (the workspace list). The library is the `tags` table the contacts domain
already uses (Reference shares it as well), so no migration: `conversation_tag` (RLS, composite FKs, cascade) and
`tags.description` existed. Creating a tag goes through the contacts `TagsService`, which already holds the plan `tags` limit, the
case-insensitive unique name and the audit and outbox rows.

- API `GET /inbox/tags` (read the inbox; with usage counts), `POST /inbox/tags`, `PATCH /inbox/tags/:id` (rowVersion), `DELETE /inbox/tags/:id`
  (all `inbox.tag.manage`); `POST /inbox/conversations/:id/tags` (`tagId` or `name`) and `DELETE .../tags/:tagId` (`inbox.conversation.tag`,
  visibility and scope checked). Adding is idempotent; a change writes `tag_added` or `tag_removed` on the timeline, the outbox event
  `conversation.tag_added|tag_removed`, an audit row, bumps the row version and publishes the realtime upsert (`changed: ['tags', 'labels']`).
- The list row and the detail carry the thread's tags (one subselect, no N+1; the JSON field keeps its original name `labels`) and the list takes
  `?tags=<id>,<id>` (any of them) with `tagScope=conversation|contact`. `contact` matches the tags of the conversation's contact:
  `EXISTS (contact_tags JOIN tags)` on `(org_id, contact_id)`, indexed by `idx_contact_tags_contact`, with the same `org_id` match as every other
  filter (a small RLS-safe join, so it shipped). A thread with no contact never matches the contact scope. The detail also returns
  `contactSummary.contactTags`.
- Bulk: action `{type: 'tag', mode: 'add'|'remove', tagId}`, also needing `inbox.conversation.tag`.
- Web: chips on rows and in the thread header, the header's Tag menu (tick to add or remove; typing a new name creates it for tag
  managers), the side panel's two groups (**Contact tags**, read-only with an "Edit on contact" link for people who may edit contacts, and
  **Conversation tags**, add and remove), each with its own heading and a one-line "?" help (a contact tag describes the PERSON: VIP, lead,
  region; a conversation tag describes this THREAD: billing, refund, urgent; both come from the same library), a multi-select Tags filter above
  the list with a Conversation tags / Contact tags switch kept in the address (`?tags=&tagScope=`), a Tag entry in the bulk bar, and the Settings tile
  "Conversation tags" (`inbox-tags`) at `/inbox/tags` (create, edit, delete with the usage count). Colors are validated on write and again before they reach a style.
- **Kept as aliases (nothing breaks):** the routes `/v2/inbox/labels*` and `/v2/inbox/conversations/:id/labels*`; the list parameter `?labels=`
  (merged with `?tags=`; the web page reads it and rewrites it to `tags`); the bulk action type `label`; the page `/inbox/labels` (redirects to
  `/inbox/tags`); the JSON field `labels` on conversations; the error codes `INBOX_LABEL_NOT_FOUND` and `INBOX_LABEL_CREATE_FORBIDDEN`; `labels` in
  the realtime `changed` list. Permission keys (`inbox.conversation.tag`, `inbox.tag.manage`), the timeline types and the outbox event names
  already said tag and are unchanged. Retiring the aliases is BL-113.
- Intended differences from Reference: a name that does not exist yet is created only by someone with `inbox.tag.manage` (Reference let any
  agent create through the thread and skipped the plan limit); the plan limit applies everywhere; the library can be renamed, recolored and
  described (Reference could not); an empty request is a 422 (Reference created an empty tag). Not built from Reference: the five "quick label"
  chips that also change the priority, and the flow enrolment on "tag added" (blocked on the flow triggers, FLR).
- Deleting a tag removes it from contacts too (same tag); the screen says how many conversations carry it.

### 2.6 SLA policies and response clocks (third milestone, branch `lakshya/partial/sla`)

Reference first: TW-TIB2-024 to 028. The tables (`sla_policies`, and the SLA columns of `conversations` with their partial indexes) existed, so
no migration.

- **Policies.** `GET|POST /v2/inbox/sla/policies`, `PATCH|DELETE .../:id`. Every route needs the plan feature `inbox_sla` (422
  `PLAN_FEATURE_LOCKED`); reads `inbox.settings.read`, writes `inbox.sla.manage`. Targets in minutes (first reply 1 to 100000, resolution 1 to
  1000000, either may be empty), pause while waiting on the customer, count business hours only, per-priority overrides (key by key), one
  default (exclusive inside one transaction; the workspace's first policy is the default). `rowVersion`, audit and outbox
  (`inbox.sla_policy.created|updated|deleted`).
- **Start (`SlaInboundListener` > `SlaClockService`, worker).** On the first message of a new conversation, and on the one that reopens a resolved or
  closed conversation, the default policy gives the due times, anchored at `waiting_since`. Priority override applies; with business hours
  the minutes count only open time in the workspace's time zone (`common/sla-time.ts`: `addBusinessMinutes`, minute-accurate, DST and overnight
  shifts handled, a workspace with every day off is treated as always open). No default policy, no targets or no `inbox_sla` means no clock. The
  opt-out STOP detection and the other listeners are untouched (this one only reads the stored-message event).
- **Sweep (`SlaSweepService`, worker, every minute, `SKIP LOCKED`, only workspaces with `inbox_sla`).** (1) A first-reply clock whose customer was
  answered (`waiting_since` clear) is closed and a `first_response` event records `withinSla`; a late answer is a breach. (2) An open (or
  pending, unless the policy pauses) conversation past its first-reply target while the customer waits, or past its resolution target, is flagged
  once: `sla_breached`, a `sla_breach` event (`kind`, `dueAt`), outbox `conversation.sla_breached`, realtime. Snoozed, resolved, closed and spam
  are skipped.
- **Notification.** New type `sla_breached` (preferences row, group Conversations, in-app toast on, sound and push off by default, en and 21
  locales): to the assignee, else the assigned team's members, else the holders of `inbox.sla.manage`; one row per person and event; the push
  carries the title only (no customer name).
- **Badge.** `slaStatus` on every list row and the detail: `breached`, `at_risk` (within 30 minutes of the due time) or `ok`, computed from the
  stored due times at read time, so it never lags the once-a-minute sweep. The row shows only a clock in trouble; the thread header shows the clock
  that matters now (first reply while the customer waits, then resolution).
- **Web.** Settings > Automation > "Response targets" at `/sla-policies` (list, create, edit, delete, priority overrides; the paywall sheet on a plan
  without the feature), the row and header badges, the notification preference row, help guide `sla-policies`.
- **Intended differences from Reference.** A new cycle starts when a customer writes after a resolve (Reference ran one clock per conversation for
  ever); no default policy means no clock (Reference applied "any" policy); business hours and the pause flag are real (Reference stored but ignored
  them); a late first reply is a breach; the breach notifies (Reference did not); policy writes are validated, versioned, audited and gated by
  the plan; delete is available and leaves running clocks alone; the flag is one per cycle (kept).
- **Not built.** Device-scoped policies (`device_ids`, the column is left null), crediting the time spent pending (a pending conversation is not
  flagged, its due time is not moved), the routing action "set SLA", a kanban/performance report on breaches, an SLA breach tab in the list,
  and a `sla_met` / `sla_missed` event on resolve.

### 2.4 Not in the slice (still open, recorded in BL-036)

Bulk actions of Reference not built: **spam, archive and unarchive, pin and unpin, mute and unmute, delete**. The archive and pin
columns exist (`archived`, `pinned_at`) and fit the same bulk action union; delete needs an owner decision (see section 5).

## 3. Design for what is left

### 3.1 Tags (first designed as "labels"): built, see 2.5 (design notes kept)

- Reuse `tags` (contacts domain, workspace master list) and `conversation_tag` (exists, RLS, composite FKs). No migration expected; check that
  `tags` has a `kind`/scope that allows conversation use, else add one column in a migration (add-migration skill).
- Routes: `GET /inbox/labels` (the master list, from the contacts barrel), `POST /inbox/conversations/:id/labels` `{tagId}`,
  `DELETE .../labels/:tagId`; creating a new label from the picker needs `inbox.tag.manage`. Timeline events `tag_added`, `tag_removed`
  (types exist), `actor_user_id` in `added_by`. The list gets a `labels` array on each row (one query for the page, no N+1) and a `labelId` filter;
  the bulk union gains `{type: 'label', tagId, mode: 'add'|'remove'}`.
- Web: chips on the row and header, a picker with search in the header and a Label entry in the bulk bar. `data-agent-ignore` is not needed
  (labels are staff-written), but a customer name next to them stays inside the existing ignored regions.

### 3.2 SLA policies: built, see 2.6 (original design kept)

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
  row, push default off. Do not reuse `sla_breaches` (it was keyed by support ticket and is now dropped, `20261216090000_drop_dormant_tables.sql`; the helpdesk ledger is `support_sla_breaches`).
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
