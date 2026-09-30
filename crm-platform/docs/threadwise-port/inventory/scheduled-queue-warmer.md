---
domain: scheduled-queue-warmer
code: SCHED
title: Scheduled Messages, Send Queue, Number Warmer & Send Safety
threadwise_version: '1.7.0'
sources_read: 64
---

# Scheduled Messages, Send Queue, Number Warmer & Send Safety

## Overview

This domain covers four things that all answer "when, how fast and how safely does an outbound WhatsApp send leave the system":

1. **Scheduled messages** (`/scheduled`): a workspace manager composes a send for a future time (once, or daily/weekly/monthly), for a group, tag, past broadcast audience or typed numbers, from one or several connected senders on any engine (Unofficial/Baileys, Meta WABA, Twilio). Laravel owns only the database rows, validation, plan gates and the HTTP hand-off; **all cron and sending lives in the Node bridge** (in-memory `node-cron` jobs). Node reports progress back through two token-gated callbacks, and re-loads active schedules from Laravel after a restart.
2. **The "send queue"**: Reference has no Laravel queue workers (there are no Job classes; `QUEUE_CONNECTION=database` is unused, and `routes/console.php` states that no `schedule:run` exists). "Queue" means two things: (a) the Node bridge's in-memory schedule table plus the heartbeat-driven retry sweeper, and (b) the mobile app's "message queues", which are `Broadcast` rows re-labelled by `Api\App\QueueController` (14 routes) and dispatched to the bridge, plus `POST api/app/schedule-message` which creates a `ScheduledMessage`.
3. **The Number Warmer** (`/warmer`): a per-number warm-up profile (ramping daily budget, send gap, active hours, spintax, health score) for every engine's connected number. It is advisory in the UI but enforced by the bulk-send controllers (broadcasts, campaigns, scheduled) through `WarmerService` and a per-day ledger table `warmer_daily_sends`.
4. **Send safety**: `SendGate` (emergency halt, admin guardrails, wallet precheck), `RetryPolicy` (per-feature retry attempts and backoff), and the Node `sendSafety.js` primitives (jitter, batch pacing, per-device daily cap, socket liveness, socket-send serialisation, Twilio helper, auth-template and HTTPS-media checks).

Who uses it: workspace managers/admins/owners (the `/scheduled` pages need role `manager`; `/warmer` needs only a login), API-key clients (`/api/v1/scheduled`), the mobile app (`/api/app/*queue*`, `schedule-message`), the Node bridge (callbacks, restore, heartbeat), and the platform admin (pacing knobs, retry defaults, emergency halt, guardrail mode).

Main flow (scheduled): composer -> `POST /scheduled` validates (plan feature `schedulemessage`, limit `scheduled_campaign_limit`, 2-minute lead time, wallet precheck, warmer budget reservation), creates one `scheduled_messages` row per selected sender and seeds `scheduled_message_contacts` (one pending row per recipient), then registers each row with Node (`/api/schedule-message-bulk/{from}` or `/api/schedule-recurring/{from}`) and stores the returned `node_schedule_id`. At fire time Node sends recipient by recipient with jittered gaps, posts one per-recipient callback (sent/failed) and one aggregate callback. Laravel recomputes counters from the pivot, settles wallet billing for messages that carry a provider message id, and shows results on the list and detail pages. Failed one-off schedules are re-armed by a sweeper driven by the Node heartbeat (up to N attempts with exponential backoff). Operators can pause/resume/cancel/run-now/retry/delete.

Plan tiers: the `schedulemessage` boolean feature gates the whole area (page renders behind a paywall sheet; store hard-blocks), `scheduled_campaign_limit` caps the number of schedule rows per workspace, `monthly_messages_limit` influences the eligibility filter for the restore endpoint, and a package flag `access_whatsapp_warmer` is referenced by the warmer controller but does not exist on any package (see TW-SCHED-041).

Connections: `node-bridge-runtime` (NODE: heartbeat, `/api/*` token guard, settings feed), `whatsapp-devices-baileys` (WADEV) and `whatsapp-cloud-api-waba` (WABA: sender models, status webhook that also updates the pivot), `wallet-message-billing` (WALLET: `settleDelivered`, `precheck`, `OverflowBilling`), `auth-registration-security` (AUTH: Security Center keys behind SendGate), `broadcasts` (BCAST) and `campaigns` (CAMP: the other warmer enforcers, `BroadcastSweeper`, `CampaignScheduleSweeper`), `message-templates` (TPL: approved templates, `template_overrides`, `TemplateDataBuilder`), `contacts-attributes-tags` (CON: groups, tags, `subscribed()`), `plans-subscriptions-trials` (PLAN: feature/limit guards), `developer-rest-api-v1` (API) and `mobile-app-api` (MOB: the routes are also theirs by folder), `shopify-woocommerce`/`storefront-builder`/`appointments-booking` (producers of programmatic schedules).

## Feature index

| Id           | Feature                                                                | Status      | Priority | Effort | Depends on                                             |
| ------------ | ---------------------------------------------------------------------- | ----------- | -------- | ------ | ------------------------------------------------------ |
| TW-SCHED-001 | Scheduled list page with stats, up-next, tabs, search and live refresh | implemented | P0       | M      | TW-SCHED-003                                           |
| TW-SCHED-002 | Schedule composer wizard (5 steps)                                     | implemented | P0       | L      | TW-SCHED-003                                           |
| TW-SCHED-003 | Create a schedule: validation, gates and persistence (POST /scheduled) | implemented | P0       | XL     | TW-SCHED-019, TW-SCHED-004, TW-SCHED-005, TW-SCHED-006 |
| TW-SCHED-004 | Audience types and recipient resolution (group, tag, queue, number)    | implemented | P0       | L      | -                                                      |
| TW-SCHED-005 | Multi-sender fan-out and audience splitting                            | implemented | P1       | M      | TW-SCHED-004                                           |
| TW-SCHED-006 | Message types, media upload and template payload for the bridge        | implemented | P0       | L      | TW-SCHED-003                                           |
| TW-SCHED-007 | "Send a test to me first" preview                                      | implemented | P2       | S      | TW-SCHED-003                                           |
| TW-SCHED-008 | Warmer budget reservation at schedule time                             | implemented | P1       | M      | TW-SCHED-039                                           |
| TW-SCHED-009 | SendGate: emergency halt, guardrails and wallet precheck               | implemented | P0       | M      | -                                                      |
| TW-SCHED-010 | Registration with the Node scheduler and failure messaging             | implemented | P0       | L      | TW-SCHED-020                                           |
| TW-SCHED-011 | Recurrence model: cadence, weekly days, end date, next run             | partial     | P0       | M      | TW-SCHED-010                                           |
| TW-SCHED-012 | Schedule detail and analytics page                                     | implemented | P1       | M      | TW-SCHED-024                                           |
| TW-SCHED-013 | Pause and resume                                                       | implemented | P0       | S      | TW-SCHED-020                                           |
| TW-SCHED-014 | Cancel                                                                 | implemented | P0       | S      | TW-SCHED-020                                           |
| TW-SCHED-015 | Run now                                                                | implemented | P0       | M      | TW-SCHED-010                                           |
| TW-SCHED-016 | Edit a schedule (PATCH)                                                | partial     | P1       | S      | TW-SCHED-003                                           |
| TW-SCHED-017 | Retry a failed schedule with a new time                                | implemented | P1       | M      | TW-SCHED-010                                           |
| TW-SCHED-018 | Delete a schedule                                                      | implemented | P0       | S      | TW-SCHED-014                                           |
| TW-SCHED-019 | Plan, role and limit gates for scheduled messages                      | implemented | P0       | S      | -                                                      |
| TW-SCHED-020 | Node scheduler runtime: registration endpoints, cron, in-memory state  | implemented | P0       | XL     | -                                                      |
| TW-SCHED-021 | Node one-off execution: engine routing and per-recipient send          | implemented | P0       | XL     | TW-SCHED-020, TW-SCHED-042                             |
| TW-SCHED-022 | Node recurring-run execution                                           | partial     | P0       | L      | TW-SCHED-021                                           |
| TW-SCHED-023 | Aggregate status callback (POST api/update-schedule-status)            | implemented | P0       | M      | TW-SCHED-021                                           |
| TW-SCHED-024 | Per-recipient status callback and billing settlement                   | implemented | P0       | M      | TW-SCHED-021                                           |
| TW-SCHED-025 | Restore after a Node restart (GET api/scheduled/active)                | implemented | P0       | M      | TW-SCHED-020                                           |
| TW-SCHED-026 | Durable retry sweeper for failed one-off schedules                     | implemented | P1       | M      | TW-SCHED-027, TW-SCHED-010                             |
| TW-SCHED-027 | RetryPolicy: per-feature attempts and backoff                          | implemented | P1       | S      | -                                                      |
| TW-SCHED-028 | REST API v1 scheduled endpoints                                        | partial     | P1       | M      | TW-SCHED-029                                           |
| TW-SCHED-029 | Mobile app schedule-message                                            | partial     | P1       | S      | TW-SCHED-025                                           |
| TW-SCHED-030 | Programmatic schedule producers (cart recovery, appointment reminders) | partial     | P2       | S      | TW-SCHED-010                                           |
| TW-SCHED-031 | Mobile message queues: create and recipient resolution                 | implemented | P1       | L      | -                                                      |
| TW-SCHED-032 | Mobile message queues: list, detail, status and CSV                    | implemented | P1       | M      | TW-SCHED-031                                           |
| TW-SCHED-033 | Mobile message queues: start sending or schedule via the bridge        | implemented | P1       | L      | TW-SCHED-031                                           |
| TW-SCHED-034 | Mobile message queues: send to an existing queue                       | implemented | P2       | M      | TW-SCHED-033                                           |
| TW-SCHED-035 | Mobile message queues: rename, pin, archive, delete                    | implemented | P2       | S      | TW-SCHED-031                                           |
| TW-SCHED-036 | Warmer page                                                            | implemented | P1       | M      | TW-SCHED-038                                           |
| TW-SCHED-037 | Warmer: save a number's profile                                        | implemented | P1       | S      | TW-SCHED-038                                           |
| TW-SCHED-038 | Warmer engine: ramp, active hours, gap, spintax                        | implemented | P1       | M      | -                                                      |
| TW-SCHED-039 | Warmer daily ledger and where it is enforced                           | partial     | P1       | M      | TW-SCHED-038                                           |
| TW-SCHED-040 | Warmer health score                                                    | implemented | P2       | S      | TW-SCHED-038                                           |
| TW-SCHED-041 | Warmer access and plan gate                                            | partial     | P2       | S      | -                                                      |
| TW-SCHED-042 | Node send-safety primitives                                            | implemented | P0       | L      | -                                                      |
| TW-SCHED-043 | Pacing settings feed from admin to Node                                | implemented | P1       | S      | TW-SCHED-042                                           |
| TW-SCHED-044 | UI-only and advertised-but-absent controls                             | docs-only   | P2       | S      | -                                                      |
| TW-SCHED-045 | Read surfaces of scheduled data in other pages                         | implemented | P2       | S      | TW-SCHED-003                                           |

## Features

### TW-SCHED-001 — Scheduled list page with stats, up-next, tabs, search and live refresh

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-003
- **Summary:** The landing page of the area: a four-card stat strip, an "Up next" list, status tabs with counts, a name search, list/grid toggle and per-row action buttons. It refreshes itself every 15 seconds without a page reload.
- **Actors & access:** Workspace role `manager` or higher (middleware `EnsureWorkspaceRole:manager`; platform admins bypass; agents/viewers are redirected to `/team-inbox`, manager+ get 403). Plan feature `schedulemessage` (see TW-SCHED-019): the page renders but a paywall sheet is slid over it when the feature is off. Scope is the current workspace.
- **UX & screens:** `resources/views/user/scheduled/index.blade.php` (nav-key `more`, page key `user-scheduled-index`) with row partial `_rows.blade.php`, JS `user-scheduled-index.js` and shared modal helper `sched-confirm-modal.js`.
  - Header: back arrow to `/more`, title "Scheduled messages", a mint chip "N queued" (N = active count) and a "Schedule message" button to `/scheduled/create`.
  - Stat strip: Total scheduled (all states), Active queue ("waiting to fire", status `scheduled` + `running`), Total sent (sum of `total_sent`), Delivery rate ("across completed", 1 decimal).
  - "Up next" card (title says "Firing in the next 24 hours" but there is NO time filter): up to 8 rows with status `scheduled` and a `next_run_at`, sorted ascending; each shows a relative label (overdue / now / in Nm / in Nh / tomorrow / "M j"), local time in the schedule's timezone, name, "count / audience-type · message type · repeat interval" and a chip queued/recurring. Empty state: "Nothing scheduled yet" + create link. QUIRK: recurring schedules sit in status `running` so they never appear here.
  - A static tip card ("Send when they read", 9-11 AM / 6-8 PM advice).
  - Status tabs: All, Scheduled, Running, Paused, Completed, Failed, Cancelled, each with a count badge. Search box "Search by name" filters client-side by lower-cased name (names are encrypted in the DB so server-side LIKE is impossible). List/grid toggle (`x-list-grid-toggle`, key `scheduled`).
  - Table columns: Schedule (type icon, bold name, 60-char message excerpt or a dash), Type pill (Text/Template/Media/Location), Recipients ("1,234 / Group|Queue|Numbers"; the `tag` audience shows a dash), Send time (local `M j · H:i` in the row timezone plus a sub-line: "completed <relative>" for completed rows, otherwise relative to now, then " · <timezone>"), Repeat (daily/weekly/monthly pill or "once"), Status pill (labels: scheduled=Queued, running=Running, paused=Paused, completed=Done, failed=Failed, cancelled=Cancelled).
  - Row actions by status: eye (open detail) always; pause when `scheduled|running`; resume when `paused`; run-now, cancel and delete when `scheduled|paused|running`; retry (opens the retry modal) when `failed`; delete ("Delete from history") when `completed|cancelled|failed`.
  - Confirmation modal (shared): run-now "Fire this schedule now?", cancel "Cancel this schedule?", delete "Delete this schedule permanently?" (Enter confirms, Esc cancels, focus lands on the cancel button). Pause and resume do not confirm. The run-now text says the bot sends within about 60 seconds and that it "counts against your message wallet immediately"; both statements are inaccurate (see TW-SCHED-015 and TW-SCHED-024).
  - Retry modal: send date (min today in the workspace timezone, default today), time (default now + 10 min in the workspace timezone), timezone select of all PHP identifiers (default workspace timezone, fallback Asia/Kolkata); client requires all three ("Date, time and timezone are all required."), server errors are shown inline.
  - Empty table state: partial `user.partials.empty-state` "No schedules match the current filters..." with reset and create links.
  - Realtime: polls `GET /scheduled?partial=1` every 15 s while the tab is visible, once immediately when the tab becomes visible again, stops on pagehide; after every action it silently refreshes the tbody (no reload), keeps the active tab and search.
- **Endpoints:**

| Endpoint      | Route name           | Handler                   | Middleware                                | Request                                  | Response                                                  |
| ------------- | -------------------- | ------------------------- | ----------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| GET scheduled | user.scheduled.index | ScheduledController@index | Authenticate, EnsureWorkspaceRole:manager | optional `partial=1` (or `Accept: json`) | full view, or JSON `{rows: <html>, totals, shown, total}` |

- **Data:** reads `scheduled_messages` for the workspace (`workspace_id = current`), scoped by `forCurrentEngine()` (provider IN the engines enabled for the workspace, so a WABA-only workspace hides rows stamped `baileys` and rows with NULL provider), newest `created_at` first, HARD LIMIT 500 rows (no pagination; QUIRK: totals and counts only reflect these 500). Eager-loads `template(id,template_name)` and `device(id,phone_number,device_name)`. Totals: `active` = scheduled+running, `avg_delivery` = mean of the row-level `delivery_rate` (`total_delivered / total_sent * 100`, 1 decimal, 0 when nothing sent) across `completed` rows only.
- **Rules & edge cases:**
  1. Schedule name, message content and target numbers are encrypted at rest, so the server cannot filter/search; everything is hydrated and filtered in the browser.
  2. QUIRK: tab counts drift. The server renders the Scheduled tab count as rows with status `scheduled`, but after the first silent refresh the JS overwrites it with `totals.active` (scheduled + running) and never updates the Running tab count.
  3. QUIRK: the "Delivery rate" card averages the row counters `total_delivered/total_sent`. Node reports `totalDelivered = 0` on its aggregate callbacks and only pushes `sent`/`failed` per recipient, so for Baileys schedules the figure is normally 0% even when the detail page (which counts pivot rows) shows deliveries.
  4. Rows whose sender was deleted still render (device relation `withDefault`).
  5. Deleted (soft) rows never appear. Names/tips are localised through `__()`; some button strings are hard-coded English.
- **Async & events:** 15-second polling only. No websocket.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a manager in a workspace with 3 scheduled and 1 failed schedule, When opening `/scheduled`, Then the stat strip shows Total 4, Active queue 3, the Failed tab shows 1 and the failed row shows a retry action and a delete action.
  - Given the page is open, When a schedule completes on the bridge, Then within about 15 seconds its pill flips to Done and its pause/run-now/cancel buttons disappear without a reload.
  - Given an agent role user, When requesting `/scheduled`, Then they are redirected to `/team-inbox` with a warning flash.
  - Given `GET /scheduled?partial=1`, Then the response is JSON with `rows` (HTML fragment), `totals`, `shown` and `total`.
  - Given a workspace with 600 schedules, Then only the newest 500 are listed and counted.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (index), `resources/views/user/scheduled/index.blade.php`, `resources/views/user/scheduled/_rows.blade.php`, `resources/js/charts/user-scheduled-index.js`, `resources/js/charts/sched-confirm-modal.js`, `app/Models/ScheduledMessage.php`, `app/Models/Concerns/HasEngineScope.php`, `Documentation/pages/messaging/scheduled.html`.
- **Port notes:** `apps/web/app/(app)/scheduled/*` list page backed by a cursor-paginated `GET /scheduled` (drop the 500-row cap; move search/filter server-side by storing a searchable name or using a blind-index/trigram on the plaintext name if encryption at rest is kept). Compute counts with SQL aggregates, not by hydrating rows. Replace the 15 s poll with a websocket/SSE event on schedule state change. RLS on `scheduled_messages(tenant_id)`. Fix the tab-count drift and the hard-coded "next 24 hours" copy.

### TW-SCHED-002 — Schedule composer wizard (5 steps)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-SCHED-003
- **Summary:** A five-step wizard (Basics, Recipients, Message, When, Review) with a live WhatsApp-style preview rail, live audience/time/cost estimates, a template picker modal and an optional "send a test to me" toggle. Submitting posts multipart form data to `POST /scheduled` via `fetch`.
- **Actors & access:** Manager+ (`EnsureWorkspaceRole:manager`); plan feature `schedulemessage` (page renders; paywall sheet when off). Workspace scoped.
- **UX & screens:** `resources/views/user/scheduled/create.blade.php`, `resources/js/charts/user-scheduled-create.js` (page key `user-scheduled-create`).
  - Server preloads: connected senders across ALL enabled engines (`WorkspaceEngine::senders`, composite keys `engine:id`; Baileys devices only when status `connected`; WABA/Twilio only when the provider config is connected), approved templates (`WaTemplate::approved()`, newest first, no cap), contact groups (`id`, `user_group`, `color`), the 50 most recent broadcasts with status `completed` or `completed_with_errors` (ordered by `completed_at`), tags with live member counts (distinct contacts per tag).
  - Sticky toolbar: back link, "Scheduled / New", a static "Draft / unsaved" chip and a "Save draft" button that has NO handler (dead control).
  - Stepper: five clickable nodes; going forward (Next button or clicking a later node) validates ONLY the current step; going back is free. Toast + red ring + scroll on the failing field.
  - Step 1 Basics: schedule name (required, "Internal label only"), sender picker `x-sender-picker name=sender multiple` (a sole sender is auto-ticked; with 2+ senders a hint explains one schedule per sender with a fair share of the audience), message type tiles Plain text / Template / With media / Location. Validation: name non-empty; at least one sender ticked ("Connect a sender first." when no sender exists).
  - Step 2 Recipients: source tiles Group / Tags / Audience queue / Numbers, each with a panel. Group: card grid of groups (multi tick; empty state links to Contacts). Tags: chips with member counts and the note that recipients are recalculated when the schedule fires (see TW-SCHED-004 for why this is untrue). Queue: list of the 50 broadcasts with status, relative completion time, delivered count and recipient count, "de-duplicated automatically". Numbers: textarea, entries split on whitespace/commas/semicolons, non-digit characters (except `+`) stripped, must match `^\+?\d{8,15}$`. A "Total recipients" readout shows N groups selected / the queue sum ("max, de-duped at send") / the number count. Validation: at least one group / broadcast / number; NO check for tags (an empty tag selection passes the client and fails on the server with "Selected recipients are empty.").
  - Step 3 Message: plain composer (toolbar B/I/S/m buttons that do nothing, variable buttons `{name}` `{phone}` `{email}`, counter "n / 1024" that does not enforce a limit); template composer (empty state -> modal picker with search over name/id/body and category filters All/Marketing/Utility/Auth, selected card, hidden mirror `<select id=tlm-template-mirror>` feeding the shared `x-template-live-mapping` panel); media composer (drop zone accepting image/video/audio/pdf/doc/docx, copy says "max 5 MB" while the server limit is 50 MB, optional caption); location composer (latitude, longitude, optional place name, OpenStreetMap iframe preview). Live stat cards: "Estimated send time" (recipients / 60 per minute, hard-coded), "Variables in message" (count of `{{...}}` tokens), "Cost estimate" (recipients x 0.007 in `window.WA_CURRENCY`, hard-coded).
  - Step 4 When: mode tiles Send once / Recurring; date input (min today in the workspace timezone, default today), time input (default 10:00), timezone select (all PHP identifiers, default workspace timezone else Asia/Kolkata). Recurring panel: "Repeat every N" number + unit select (day(s)/week(s)/month(s), default weeks), an "End" select (Never / After N occurrences / On a specific date) that is never read or submitted, and weekday toggle buttons Sun..Sat. Validation: date and time set; when recurring with the unit "week" at least one weekday must be picked.
  - Step 5 Review: filled by JS (name, sender label or "N senders", type, mode, recipient source, count, estimated time, cost) plus the "Send a test to me first" switch (disabled with an explanation when the account has no WhatsApp number of at least 8 digits in `users.mobile`).
  - Live preview rail: phone-frame bubble with image / map / template-name eyebrow and body text mirrored from the active composer.
  - Submit: builds a fresh `FormData` (fields: `schedule_name`, `sender[]`, `send_date`, `send_time`, `timezone`, `schedule_type`, `message_type`, `message_content` (plain body, media caption or place name), `template_id`, `media` file, `latitude`/`longitude`, `recipient_type`, `target_tags[]`/`target_groups[]`/`target_queues[]`/`contact_numbers[]`, for recurring `repeat_interval` (derived from the unit text: day->daily, week->weekly, month->monthly), `repeat_every`, `days_of_week[]` (0=Sun..6=Sat), and `send_test=1`). Button becomes "Scheduling..."; on success it toasts the server message and redirects to `data.redirect_url` (detail page for a single sender, list for multi-sender), waiting 4 s first when the test message failed; errors show the first validation message.
- **Endpoints:**

| Endpoint             | Route name            | Handler                    | Middleware                                | Request | Response                                                               |
| -------------------- | --------------------- | -------------------------- | ----------------------------------------- | ------- | ---------------------------------------------------------------------- |
| GET scheduled/create | user.scheduled.create | ScheduledController@create | Authenticate, EnsureWorkspaceRole:manager | -       | view with devices, templates, groups, queues, senders, tags, tagCounts |

(Submission goes to `POST scheduled`, see TW-SCHED-003.)

- **Data:** read-only: `devices`/`wa_provider_configs` (senders), `wa_templates`, `contact_groups`, `broadcasts`, `tags` + `contact_tag` + `contacts`, workspace timezone, `users.mobile`.
- **Rules & edge cases:**
  1. QUIRK: `template_overrides` (send-time variable/media/button overrides) are edited in the shared mapping panel, whose hidden input sits inside the form, but the submit handler builds its own `FormData` and never includes it, so overrides entered here are silently dropped even though the server accepts and stores them.
  2. QUIRK: the variable buttons insert single-brace tokens `{name}`, `{phone}`, `{email}`, but the bridge only substitutes double-brace tokens (`{{name}}`), and the keys are `name, first_name, last_name, mobile, email, address, title, country_code, language` (no `phone` key), so single-brace text is delivered literally.
  3. The legacy `$devices` list passed to the view is unused by the current picker.
  4. `ScheduledMessage::RECIPIENT_TYPES` omits `tag`, but the UI and store support it.
  5. The estimate constants (60 msg/min, 0.007 per message) are hard-coded and ignore admin pacing and the real per-country rate card.
  6. Empty-state copy for no groups/tags/broadcasts links to Contacts / Broadcasts.
- **Async & events:** none until submit.
- **External systems:** OpenStreetMap embed for the location preview (client-side iframe, no key).
- **Settings:** workspace timezone (`workspaces.timezone`, normalised by `safe_timezone`), platform currency symbol (`window.WA_CURRENCY`).
- **Acceptance criteria:**
  - Given a workspace with one connected sender, When the page loads, Then that sender is auto-ticked and step 1 only asks for a name.
  - Given no recipient selected, When clicking Next on step 2, Then a toast says to pick at least one group/broadcast/number and the panel is highlighted.
  - Given recurring mode with unit "week(s)" and no weekday ticked, When clicking Next on step 4, Then "Pick at least one day." is shown.
  - Given two senders ticked, When submitting, Then the user is redirected to the list (not a detail page) and the toast says N schedules were created across 2 senders.
  - Given the account has no WhatsApp number saved, Then the test toggle is disabled with the account-settings hint.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (create), `resources/views/user/scheduled/create.blade.php`, `resources/js/charts/user-scheduled-create.js`, `resources/views/components/sender-picker.blade.php`, `resources/views/components/template-live-mapping.blade.php`, `app/Services/WorkspaceEngine.php`.
- **Port notes:** `apps/web` wizard with a typed zod schema shared with the API (`@crm/contracts`). Post `template_overrides` (fixing the drop). Use one placeholder syntax across composer, preview and sender (recommend `{{name}}`). Get estimates from the rate-card service and admin pacing. Provide real draft saving or remove the button. Sender list comes from the channel-account registry (WADEV/WABA), not per-engine ad-hoc queries.

### TW-SCHED-003 — Create a schedule: validation, gates and persistence (POST /scheduled)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** XL (>2 weeks)
- **Depends on:** TW-SCHED-019, TW-SCHED-004, TW-SCHED-005, TW-SCHED-006, TW-SCHED-008, TW-SCHED-009, TW-SCHED-010
- **Summary:** The single write path that turns the composer into one or more `scheduled_messages` rows with a pre-seeded recipient pivot, then registers each row with the Node scheduler. It answers JSON (`201`) and never redirects.
- **Actors & access:** Manager+; plan feature `schedulemessage` (hard block via `PlanLimitGuard::feature`), plan limit `scheduled_campaign_limit` (row count of the workspace's `scheduled_messages`, soft-deleted excluded, all statuses counted). `PlanLimitReachedException` renders as JSON 422 `{ok:false, error:"plan_limit_reached", reason, key, used, limit, message}` for JSON/`api/*` requests.
- **UX & screens:** driven by TW-SCHED-002; response toasts.
- **Endpoints:**

| Endpoint       | Route name           | Handler                   | Middleware                                | Request                | Response                                                                                                                                          |
| -------------- | -------------------- | ------------------------- | ----------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST scheduled | user.scheduled.store | ScheduledController@store | Authenticate, EnsureWorkspaceRole:manager | multipart fields below | 201 `{ok, message, data:{id, created_ids[], devices_count, node_schedule_id, test_send, redirect_url}}` or 422 `{ok:false, errors:{field:[msg]}}` |

Validation (all server-side): `schedule_name` required string max 255; `schedule_type` required in `once,recurring`; `send_date` required date, `after_or_equal:today` (evaluated in the app timezone, not the schedule's); `send_time` required string max 16 (24h `H:i`, or 12h `h:i A`/`h:iA`, normalised to 24h); `timezone` required and IN the PHP identifier list; one of `sender[]` (array min 1, each string max 64, composite `engine:id`), legacy `device_id` (integer) or `device_ids[]` (integers) is required (`required_without_all`); `send_test` nullable boolean; `message_type` required in `plain,template,media,location`; `template_id` integer, required when type is template (any id is accepted; no approval or ownership check); `template_overrides` nullable string max 65000; `message_content` nullable string max 4096; `recipient_type` required in `group,queue,number,tag`; `target_tags[]`, `target_groups[]`, `target_queues[]` arrays; `contact_numbers[]` array of strings matching `^[0-9+\-\s]{8,20}$`; `repeat_interval` nullable in `daily,weekly,monthly`; `repeat_every` nullable integer 1..365; `days_of_week` required (array) when `repeat_interval=weekly`, each integer 0..6 (weekday names like `mon`/`monday` are normalised to 0..6 first, duplicates removed); `end_date` nullable date `after:send_date`; `media` nullable file max 51200 KB; `latitude` -90..90, `longitude` -180..180 (numeric, nullable).

- **Data:** creates `scheduled_messages` (one per sender), bulk-inserts `scheduled_message_contacts` (pending), may create `contacts` (typed numbers), writes a media file to `public/uploads/scheduled/`; see Data model.
- **Rules & edge cases:**
  1. Order of checks: plan feature, plan limit, days-of-week normalisation, validation, 2-minute lead time, recipient resolution (empty -> 422 `errors.recipient_type: "Selected recipients are empty."`), SendGate wallet precheck (422 `errors.wallet`), auto-save typed numbers as contacts, media upload guard, template type derivation, sender resolution, fan-out split, warmer reservation (422 `errors.schedule: "Held by WhatsApp Warmer..."`), row creation, pivot seed, Node registration, optional test send.
  2. Lead time: `send_date + send_time` is parsed in the schedule's timezone and converted to the app timezone (UTC default); it must be at least `now + 2 minutes` else 422 `errors.send_time: "Schedule must be at least 2 minutes from now."`. There is no upper bound (QUIRK: a one-off more than a year out fires at the next matching day-and-month because Node's cron has no year).
  3. Typed numbers (`recipient_type=number`) are remembered as contacts through `Contact::rememberPhone` (dedupe by phone hash per workspace; skipped when fewer than 6 digits).
  4. Media: `SecureUpload::problem()` rejects script/active content (422 `errors.media`), stored under a randomised allow-listed name in `public/uploads/scheduled/` (publicly reachable URL `.../uploads/scheduled/<name>`), the DB keeps only the file name in `media_file`.
  5. `template_type` on the row: `template` when message_type is template; else `location` when BOTH latitude and longitude are filled (0 counts as filled); else `media` when a file was uploaded; else `text`. So `message_type=media` without a file, or `location` without coordinates, silently becomes `text`; QUIRK: nothing server-side requires a body for plain text (empty body passes; the bridge then marks every recipient failed).
  6. Sender resolution: composite keys go through `WorkspaceEngine::senderForKey` (forged/stale keys are dropped; duplicates removed; zero valid -> 422 `errors.sender: "No valid senders in this workspace."`); the legacy `device_id(s)` path is intersected with the workspace's devices (`errors.device_id: "No valid devices in this workspace."`) and stamps the workspace default engine. `from_number` is the sender's full digit string (country code + number) because Node keys its Baileys clients by it.
  7. Each row stores `provider` = the CHOSEN engine (auto-stamped from the workspace default when empty), `device_id` = `devices.id` (Baileys) or `wa_provider_configs.id` (WABA/Twilio) (a polymorphic pair with `provider`), `status='scheduled'`, `scheduled_time` and `next_run_at` = the UTC instant, `send_date`, `send_time` (24h), `timezone`, `repeat_every` default 1, `days_of_week` null when empty, `total_recipients` snapshot, encrypted `schedule_name`, `message_content`, `target_numbers`, `template_overrides` (sanitised by `TemplateOverrideResolver::sanitize`).
  8. Pivot seeding: one `pending` row per unique digit string per created row (contact matched by phone digits within the workspace when possible). Not seeded for `tag` audiences or for single-sender group/queue when nothing resolves (see TW-SCHED-004).
  9. Response `message`: "Schedule created." / "N schedules created across M senders." / the Node failure copy from TW-SCHED-010, plus " Test message sent to your number." or " Test message wasn't sent - <reason>." Response HTTP is always 201 once rows exist, even if Node registration failed.
  10. Wallet gate uses the number of recipients at store time and `message_content` as the body; for template sends the body is empty so content guardrails see nothing.
  11. QUIRK: a `recurring` request with no `repeat_interval` is accepted (interval nullable); Node then fails to build a cron expression and registration returns null.
- **Async & events:** Node registration HTTP call per row (TW-SCHED-010); no queue job; optional preview send (TW-SCHED-007). No outbound webhook, no audit log entry, no notification.
- **External systems:** Node bridge (`SERVER_URL` / admin `baileys_server_url`), token `X-Node-Token`.
- **Settings:** package `schedulemessage`, `scheduled_campaign_limit`; workspace `plan_overrides` per key; `security.wa_guardrails_mode` etc. (TW-SCHED-009); warmer profile (TW-SCHED-008); app timezone.
- **Acceptance criteria:**
  - Given a valid once-schedule 10 minutes ahead for 3 typed numbers, When posting, Then a 201 is returned, one `scheduled_messages` row with status `scheduled` (or `running` only for recurring) and 3 pending pivot rows exist and `node_schedule_id` is stored when the bridge accepts.
  - Given `send_time` 1 minute ahead, Then 422 with "Schedule must be at least 2 minutes from now." and no row is created.
  - Given a plan without `schedulemessage`, Then 422 with reason `feature_disabled`; given the workspace already has `scheduled_campaign_limit` rows, Then 422 with the limit message.
  - Given `recipient_type=group` with a group that has no members, Then 422 "Selected recipients are empty."
  - Given a forged sender key, Then it is ignored; if none remain, 422 "No valid senders in this workspace."
  - Given weekly recurrence without weekdays, Then 422 on `days_of_week`.
  - Given an empty wallet on a pay-per-message workspace, Then 422 `errors.wallet` and nothing is created.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (store, normalizeDaysOfWeek, parseTimeTo24Hour), `app/Models/ScheduledMessage.php`, `app/Services/PlanLimitGuard.php`, `app/Exceptions/PlanLimitReachedException.php`, `app/Support/SecureUpload.php`, `database/migrations/2026_05_06_140000_create_scheduled_messages_table.php`, `Documentation/pages/messaging/scheduled.html`.
- **Port notes:** `apps/api/src/modules/scheduling/` use case `CreateSchedule`. Persist the fire instant as `timestamptz` plus IANA tz and keep the wall-clock (date/time/tz) so DST is honoured for recurrence. Replace Node in-memory cron with BullMQ delayed/repeatable jobs keyed by schedule id (idempotent job id), created in the same transaction via the outbox. Validate template ownership/approval and body presence server-side. Media goes to object storage with signed URLs, not `public/`. Add an audit event. Keep the 2-minute lead time but make it a setting.

### TW-SCHED-004 — Audience types and recipient resolution (group, tag, queue, number)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** none (contacts: CON)
- **Summary:** Four ways to choose who receives a schedule, resolved twice: once at store time to produce a count and pivot rows, and again by `NodeSchedulerClient::resolveRecipients` when the schedule is registered with (or restored to) the bridge.
- **Actors & access:** part of TW-SCHED-003 and TW-SCHED-025.
- **UX & screens:** step 2 of TW-SCHED-002; detail page recipient summary (TW-SCHED-012): "N group(s)", "N broadcast queue(s)", "N number(s)"; the `tag` audience shows a dash there and on the list.
- **Endpoints:** none of its own.
- **Data:** row columns `recipient_type` (`group|queue|number|tag`), `target_groups` (JSON array of group id strings; for tags the strings `tag:<id>`), `target_queues` (JSON array of broadcast ids), `target_numbers` (encrypted JSON array of number strings), `total_recipients`.
- **Rules & edge cases:**
  1. Group: ids are strings matched against the encrypted `contacts.contact_group` array (contacts are hydrated and filtered in PHP). Count at store time = workspace contacts intersecting the chosen groups (includes opted-out contacts and contacts without a number).
  2. Tag: tag ids are restricted to the workspace; count = contacts in the workspace carrying any chosen tag (`whereHas tags`). Stored as `tag:<id>` in `target_groups` with `recipient_type='tag'`.
  3. Queue: broadcast ids restricted to the workspace; count = DISTINCT `contact_id` over `broadcast_contacts` of those broadcasts. Only `completed`/`completed_with_errors` broadcasts are offered in the UI, but the server accepts any workspace broadcast id.
  4. Number: each typed entry is reduced to digits and `+`, kept when it matches `^\+?[0-9]{8,15}$`, de-duplicated. The stored list keeps the `+` if typed.
  5. Registration-time resolution (`resolveRecipients`): group -> contacts of any workspace MEMBER (`contacts.user_id IN workspace_user`) whose groups intersect; queue -> contacts of broadcasts owned by a workspace member; tag -> workspace contacts with the tag (re-checked); number -> the stored list. The resulting numbers are the stored `contacts.mobile` value (decrypted by the model cast); the contact's separate `country_code` column is NOT prepended (QUIRK: contacts stored with a separate country code get a number missing its prefix, unlike the mobile queue path which canonicalises).
  6. QUIRK (compliance): on the single-sender path none of these resolutions filters opted-out contacts (`is_unsubscribed`), so a contact who replied STOP still receives a scheduled group/tag/queue send. Only the multi-sender flatten step and the pivot-listing helper apply `Contact::subscribed()`.
  7. QUIRK: the comments and UI say tag/group audiences are "recalculated when the schedule fires". In reality recipients are resolved only when the row is registered with Node (store time, run-now, retry, sweeper re-arm) or re-registered after a Node restart; between those moments the bridge iterates its in-memory snapshot, so newly tagged/added contacts are NOT included.
  8. Resume-safe filter: when resolving for registration, numbers whose pivot row for this schedule already has status `sent` (digits compared) are dropped, so a retry/re-arm/restore only targets the remainder. Pivot rows in `delivered`/`read` are not dropped. Manual retry (TW-SCHED-017) resets the pivot to pending first, so it re-sends to everyone; the sweeper (TW-SCHED-026) does not reset it. QUIRK: after a bridge restart a recurring schedule whose recipients are all `sent` re-registers with an EMPTY recipient list and silently stops sending.
  9. Per-number attribute map for placeholders: `contacts.mobile` string equality against the resolved number, so typed numbers that do not exactly equal a stored `mobile` get no attributes (`{{name}}` stays literal).
  10. Contact lookups for tag use `workspace_id`, but group/queue and attribute lookups use `user_id IN workspace members`, so contacts created by a removed member are excluded.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a tag audience of 40 contacts and a schedule created today, When contacts are tagged afterwards but before the fire time without any re-registration, Then the bridge still sends to the original snapshot only.
  - Given a group audience with one opted-out contact and a single sender, When the schedule fires, Then the opted-out contact still receives it (documented gap; the port must fix).
  - Given typed input "+91 98765 43210, 12345", Then only the valid entry is kept and total_recipients is 1.
  - Given two broadcasts sharing 10 contacts, When both are picked as queues, Then total_recipients counts each contact once.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (resolveRecipients, resolveGroupOrQueueToNumbers), `app/Services/NodeSchedulerClient.php` (resolveRecipients), `app/Models/Contact.php` (subscribed, canonicalizePhone), `Documentation/pages/messaging/scheduled.html`.
- **Port notes:** one `AudienceResolver` service shared with broadcasts/campaigns (`apps/api/src/modules/audiences`) that (a) always excludes opted-out/blocked contacts, (b) emits canonical E.164 numbers, (c) can run at fire time inside the worker for live tag/segment audiences and snapshot for fixed lists, and (d) stores the resolved recipients as rows (recipient table) rather than JSON arrays. All queries go through tenant-scoped RLS, not `user_id IN members`.

### TW-SCHED-005 — Multi-sender fan-out and audience splitting

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-004
- **Summary:** Ticking two or more senders creates one schedule row per sender and divides the audience round-robin so nobody receives multiple copies.
- **Actors & access:** part of TW-SCHED-003.
- **UX & screens:** step 1 sender picker; the list shows one row per sender with the name suffixed " · <sender label>".
- **Endpoints:** none of its own (POST scheduled).
- **Data:** N `scheduled_messages` rows with distinct `device_id`/`provider`/`from_number`, each with its own `target_numbers` slice and `total_recipients`.
- **Rules & edge cases:**
  1. `isMulti` = more than one resolved sender. For multi-sender group/queue audiences the reference is expanded to a flat, de-duplicated, opted-out-filtered number list at store time (`Contact::subscribed()`), otherwise every sender's row would re-expand the same group and each contact would get N copies. Numbers are dealt round-robin (`index % senderCount`).
  2. Multi-sender rows always store `recipient_type='number'` with only `target_numbers`; `target_groups`/`target_queues` are cleared. Single-sender rows keep the original reference.
  3. QUIRK: with `recipient_type=tag` and 2+ senders the tag is not expanded (only group/queue are), so every row ends with an empty number list, `total_recipients=0` and Node registration marks each row `failed` ("No recipients matched at registration time.").
  4. Typed numbers are also dealt round-robin across senders.
  5. Each row is created and registered independently; partial registration failures are reported ("N schedule(s) registered; M couldn't reach the sending service...").
  6. Warmer reservations (TW-SCHED-008) use each sender's own slice size.
  7. The wallet gate runs once with the total recipient count (not per sender).
- **Async & events:** one Node register call per row.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 senders and 9 typed numbers, When saved, Then three rows exist with 3 numbers each and names suffixed with each sender label.
  - Given 2 senders and a group of 10 contacts of which 1 is opted out, Then the rows hold 9 numbers in total.
  - Given 2 senders and a tag audience, Then the created rows fail registration (documented defect).
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (store fan-out block), `Documentation/pages/messaging/scheduled.html` (Multi-Device & Audience).
- **Port notes:** model a parent "schedule" with child "send legs" instead of duplicating rows; the audience is resolved once and allocated across legs by a deterministic splitter; keep per-leg counters and roll them up for the list.

### TW-SCHED-006 — Message types, media upload and template payload for the bridge

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-SCHED-003
- **Summary:** Four message types (plain text, approved template, media with caption, location) and how each is turned into the payload the Node bridge understands, including per-recipient Meta payload pre-building for approved WABA templates and several template safety gates.
- **Actors & access:** part of store, run-now, retry, sweeper and restore.
- **UX & screens:** step 3 of TW-SCHED-002; detail page "What recipients see" (TW-SCHED-012).
- **Endpoints:** none of its own.
- **Data:** row columns `template_type` (`text|template|media|location`), `message_content` (encrypted; plain body, media caption or place name), `template_id`, `template_overrides` (encrypted JSON), `media_file`, `latitude`, `longitude` (decimal 10,7).
- **Rules & edge cases:**
  1. Free-form body: workspace attributes (`{{promo_key}}`, positional) are pre-resolved by `AttributeResolver` before sending (only when the body contains `{{` and the row has no template); contact-level placeholders are left for the bridge.
  2. Template data (`resolveTemplateData`): body/header/footer are resolved against the workspace attribute table using the template's `variable_map` (nested `{header:[{num,key}], body:[...]}` or flat), carousel cards' title/body/footer are resolved, buttons decoded, attachment URL from `media_url()`, attachment inlined as base64 once (`WaTemplate::inlineAttachment`) with URL fallback, `twilio_content_sid`, `category`, `language`, `template_type`. Missing template -> null.
  3. Meta pre-build (`maybePrebuildMetaPayloads`) runs ONLY when the template has a `meta_template_id`, `meta_status = APPROVED` and the platform setting `waba_templates_v2_enabled` is on. It then: refuses `auth` templates (row `markFailed`: cannot be scheduled because each recipient needs a unique OTP), refuses a template paused for negative feedback (`paused_until` in the future), refuses a quality score below `waba_template_quality_floor` (default `YELLOW`; ranks RED 0 < UNKNOWN 1 < YELLOW 2 < GREEN 3), refuses attachment URLs that are not HTTPS, private/reserved IPs or hosts ending `.local .test .internal .localhost`; then builds a per-phone `meta_payloads_by_phone` map through `BroadcastsController::varsForRecipient` + `wrapUrlsForRecipient` (link tracking) + `TemplatePayloadBuilder::buildSend`. Each refusal marks the schedule `failed` with a readable `failure_reason` (registration then returns null).
     3a. When the v2 flag is off, or the template is not approved on Meta, no pre-build happens: WABA sends then only work for free-text messages inside the 24-hour window (bridge refuses otherwise).
  4. Media: the bridge downloads `mediaUrl` (`url('uploads/scheduled/<file>')`) and infers the WhatsApp slot from the MIME type (image, video, audio, otherwise document with file name and caption). Uploaded files are deleted when the schedule is deleted (TW-SCHED-018).
  5. Location: `latitude`/`longitude` and the place name in `message_content`.
  6. Recurrence payload adds `repeatInterval`, `repeatEvery`, `daysOfWeek`, `endDate` (TW-SCHED-011).
  7. `template_type` values outside the four (`standard`, used by cart recovery rows) are passed to the bridge verbatim and hit its "unknown message type" branch on Baileys (see TW-SCHED-030).
  8. The approved-templates-only rule is enforced only by the picker (server accepts any `template_id`, unscoped `WaTemplate::find`), so a forged id could reach another workspace's template on the web path.
- **Async & events:** none.
- **External systems:** Meta Graph API via the bridge (pre-built payloads); Twilio Content API via `twilio_content_sid`.
- **Settings:** `waba_templates_v2_enabled` (default off), `waba_template_quality_floor` (default YELLOW).
- **Acceptance criteria:**
  - Given an approved Marketing template on a WABA number and v2 enabled, When the schedule is registered, Then the payload carries `meta_payloads_by_phone` keyed by each recipient.
  - Given an authentication-category template, Then the row becomes `failed` with the OTP explanation and nothing is registered.
  - Given a template paused until tomorrow, Then registration fails with "Template is paused until <date>...".
  - Given a body "Hi {{promo_key}}" and a workspace attribute promo_key=SPRING, Then the payload message reads "Hi SPRING".
- **Source refs:** `app/Services/NodeSchedulerClient.php` (resolveTemplateData, resolveFreeformMessage, maybePrebuildMetaPayloads, mediaUrlReachableForMeta), `app/Services/AttributeResolver.php`, `app/Services/TemplateOverrideResolver.php`, `app/Services/Waba/TemplatePayloadBuilder.php`, `app/Http/Controllers/BroadcastsController.php` (varsForRecipient), `app/Support/SecureUpload.php`.
- **Port notes:** put payload building in the provider adapter layer (`apps/api/src/modules/messaging/providers/*`), not in the scheduler; the scheduler stores intent (template id, variables, overrides) and the worker renders per recipient at send time using the shared `TemplateRenderer` (also used by broadcasts/campaigns). Keep the four gates (auth, paused, quality floor, reachable HTTPS media) as pre-send policy checks that fail the job with a typed reason.

### TW-SCHED-007 — "Send a test to me first" preview

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-SCHED-003
- **Summary:** After the schedule is saved, one preview message is sent to the operator's own WhatsApp number using the first created row's sender and engine, so they can see the real message.
- **Actors & access:** the user posting the schedule; requires `users.mobile` with at least 8 digits.
- **UX & screens:** review-step toggle (disabled with hint when the number is missing); result appended to the success toast; a failed test delays the redirect by 4 seconds.
- **Endpoints:** part of `POST scheduled` (`send_test=1`); response `data.test_send` = null when off, else `{ok, reason?, to?}`.
- **Data:** none written by the preview itself (the dispatcher may create message rows).
- **Rules & edge cases:**
  1. Runs AFTER the schedule is saved; a failed preview never costs the schedule. One preview even for multi-sender fan-out.
  2. WABA + template -> `Waba\TemplateSender::send` with variables resolved as if the operator were the recipient (name, email from the user; overrides applied through `BroadcastsController::varsForRecipient`), because a plain text to a cold number is rejected outside the 24 h window.
  3. Everything else -> `WhatsAppDispatcher::sendRaw` (routes by `provider`). A template on a non-WABA engine is flattened to readable text via `InboxMirror::readableTemplateBody(TemplateDataBuilder::build(...))`. Empty body with no media -> reason "nothing to preview - the message body is empty".
  4. `local_only=true` from the dispatcher (provider disabled, emergency halt, ...) is treated as NOT sent.
  5. Failure reasons returned to the UI: no account number ("add one in Account settings"), Meta rejection text, dispatcher error, or exception message (logged `[SCHED-PREVIEW]`).
- **Async & events:** synchronous send; no schedule state change.
- **External systems:** the row's provider (Baileys via bridge, Meta Cloud, Twilio).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Baileys schedule with the toggle on and a valid account number, Then one message reaches that number and the toast says "Test message sent to your number."
  - Given no account number, Then the toggle is disabled and no preview is attempted.
  - Given the emergency halt is engaged (`local_only`), Then the toast reports the test was not sent while the schedule stays saved.
- **Source refs:** `app/Services/Scheduled/SchedulePreviewSender.php`, `app/Http/Controllers/ScheduledController.php` (store tail), `resources/views/user/scheduled/create.blade.php`.
- **Port notes:** reuse the generic "send test to me" use case across broadcasts/campaigns (`apps/api/src/modules/messaging/preview`), through the provider adapter and outbound policy pipeline; do not run it inline in the request if the provider is slow (short timeout, report failure).

### TW-SCHED-008 — Warmer budget reservation at schedule time

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-039
- **Summary:** For one-off schedules from a number whose warmer is enabled, the batch is checked against, and reserved in, that number's ramped budget for the SEND DATE. A batch that does not fit is refused.
- **Actors & access:** part of store; only when `schedule_type != recurring` and the sender's `warmer_config.enabled` is true.
- **UX & screens:** 422 JSON `errors.schedule[0]`: "Held by WhatsApp Warmer: <label> is warming - its budget for <date> is already reserved." or "... only R of its B-message budget for <date> remains, but this send has N recipients. Reduce the audience or pick a later date. You can adjust these limits at /warmer."
- **Endpoints:** part of `POST scheduled`.
- **Data:** upserts `warmer_daily_sends(engine, device_id, day) += n`.
- **Rules & edge cases:**
  1. The sender model is resolved by engine: `Device` for baileys, `WaProviderConfig` for waba and twilio (broadcasts additionally include `sms`; scheduled does not).
  2. `n` = the sender's slice size (multi-sender) or the total recipients (single sender). The check is `gateBatchFor(device, n, sendDate)`: warmer disabled -> allowed; budget for that date computed from the ramp; remaining = budget - ledger for that date; `remaining <= 0` -> held (`daily_budget_reached`); `n > remaining` -> held (`budget_capped`). Active hours are NOT checked (the send is in the future).
  3. All holds are collected across senders first; only if none hold are the reservations written (`recordSendsFor`), so a partial reservation cannot happen inside one request.
  4. QUIRK: reservations are made BEFORE the rows and Node registration exist and are never released: cancelling, deleting, failing or never sending a schedule leaves the reserved count in the ledger, permanently shrinking that day's budget.
  5. QUIRK: recurring schedules are skipped entirely, and run-now, retry, sweeper re-arm, API-v1 and mobile schedule creation never reserve. The active-hours window, minimum gap and spintax are never applied to scheduled sends (the schedule payload has no `warmerGap`, and Node's schedule service has no warmer logic), contrary to the docs page.
  6. The date used is the raw `send_date` (the sender's local day is not recomputed); ledger day keys are plain dates.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** per-number warmer profile (TW-SCHED-037).
- **Acceptance criteria:**
  - Given a warming number with a day budget of 20 and 15 already reserved, When scheduling 10 recipients for that date, Then 422 says only 5 remain.
  - Given the same number and 5 recipients, Then the schedule is created and the ledger for that date reads 20.
  - Given a recurring schedule from a warming number, Then no reservation is made.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (store warmer block), `app/Services/WarmerService.php` (gateBatchFor, recordSendsFor), `Documentation/pages/messaging/warmer.html`.
- **Port notes:** implement as a `SendBudget` reservation with an owner (schedule id) so it is released on cancel/delete/failure and consumed on actual send; enforce active hours, gap and spintax inside the send worker for every bulk source, including scheduled.

### TW-SCHED-009 — SendGate: emergency halt, guardrails and wallet precheck

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** none (settings owned by AUTH; wallet by WALLET)
- **Summary:** `App\Support\SendGate` is the single pre-send gate: an always-on platform emergency halt, an optional three-mode (off/monitor/enforce) set of admin guardrails (content filters and per-workspace rate caps), and, for bulk launches, a wallet precheck. This entry records how the scheduled/bulk paths use it; the setting semantics are specified in TW-AUTH-040/041 and the wallet rules in TW-WALLET-013.
- **Actors & access:** system; configured by the platform admin in Security Center.
- **UX & screens:** none of its own; blocks surface as 422 JSON on `POST scheduled` (`errors.wallet[0]` carries the message) or as errors in other domains.
- **Endpoints:** none.
- **Data:** reads `system_settings` (`platform.emergency_send_halt`, `security.wa_guardrails_mode`, `security.wa_max_sends_per_minute|day`, `wa_hold_on_links_count`, `wa_hold_on_scam_pattern`, `abuse_block_finance_terms`, `abuse_block_short_links`, `abuse_block_keyword_list`); cache counters `wa-rl-min:{ws}:{YmdHi}` (TTL 120 s) and `wa-rl-day:{ws}:{Ymd}` (TTL 90000 s); audit actions `security.send_flagged`, `security.send_blocked`, `billing.send_blocked_no_wallet`.
- **Rules & edge cases:**
  1. `halted()` memoises the halt flag per request; `guard()` throws a RuntimeException with the "Outbound sends are paused (platform emergency halt is engaged)..." text. `screen(ws, body, ctx)` (1:1 dispatchers) = guard, then mode check, content checks, then rate caps. `screenBody(body, ctx)` (bulk launch) = wallet precheck (`MessageBillingService::precheck(workspace, ctx.count)`; empty wallet blocks regardless of mode) then content-only checks once per batch; no rate caps and NO halt guard.
  2. Content checks in order: link count (`https?://` occurrences above the limit), scam phrasing regex, finance-spam regex, URL-shortener domains, custom keyword substrings; first hit wins. Monitor mode logs + audits and allows; enforce blocks with "This message was blocked by security policy (<reason>)."
  3. Everything except the halt and the wallet block is fail-open: any exception in a check logs `[SENDGATE]` and allows the send. The wallet check itself is fail-open for non-block exceptions.
  4. Scheduled usage: only `POST /scheduled` calls `screenBody(message_content, {source:'scheduled', workspace_id, count})`. Template sends carry an empty body, so content guardrails never see template text. QUIRK: run-now, retry, the sweeper, the restore endpoint, API-v1 create, mobile schedule-message and the Node scheduler never call SendGate, and the Node bridge has no knowledge of the halt flag, so an engaged emergency halt does NOT stop schedules already registered on the bridge.
  5. The Node restore endpoint applies a separate read-only quota/wallet eligibility filter (TW-SCHED-025).
  6. Rate cap windows are fixed calendar buckets; a check under the cap increments the counter even when the other cap then blocks.
- **Async & events:** audit log rows (layer `platform`, result `warning`); Laravel log lines `[SENDGATE]`.
- **External systems:** none.
- **Settings:** the `security.*` keys above (defaults: mode `off`, caps 0 = unlimited, filters off), `platform.emergency_send_halt` (default false).
- **Acceptance criteria:**
  - Given guardrail mode enforce with links limit 2, When a plain-text schedule body contains 3 URLs, Then `POST /scheduled` fails 422 and `security.send_blocked` is audited.
  - Given mode monitor, Then the same schedule is created and `security.send_flagged` is audited.
  - Given a pay-per-message workspace with an empty wallet, Then the schedule is refused with the wallet message before any row is created, even in mode off.
  - Given the emergency halt is on, When a previously registered schedule fires on the bridge, Then it still sends (documented gap).
- **Source refs:** `app/Support/SendGate.php`, `app/Support/SecurityPolicy.php`, `app/Http/Controllers/ScheduledController.php` (store), `app/Services/WhatsAppDispatcher.php`, `app/Services/InboxDispatcher.php`, `app/Services/MessageBillingService.php`.
- **Port notes:** implement one `OutboundPolicy` pipeline (halt, content rules, rate caps, wallet precheck, warmer budget) executed at enqueue time AND again in the send worker for every source (scheduled, broadcast, campaign, API, mobile, flow), so the halt stops queued work. Make rules data-driven and per-tenant/platform. Keep fail-open only for advisory content rules; the halt and the wallet gate must fail closed.

### TW-SCHED-010 — Registration with the Node scheduler and failure messaging

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-SCHED-020
- **Summary:** `NodeSchedulerClient` hands a saved row to the bridge (one-off or recurring), stores the returned Node schedule id, and tells the operator honestly when the bridge did not confirm.
- **Actors & access:** system (store, run-now, retry, sweeper, cart-recovery producers).
- **UX & screens:** success or warning message on the composer: all failed -> "Saved, but the sending service didn't confirm this schedule - it won't send until the WhatsApp bridge is reachable and the sender device is connected. Reconnect the device, then edit & save to retry."; some failed -> "N schedule(s) registered; M couldn't reach the sending service and won't send until the bridge reconnects."; run-now failure -> HTTP 502 "Couldn't reach the sending service to fire now...".
- **Endpoints (outbound to Node):**

| Call                                                                                                                       | Purpose              | Body highlights                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `{SERVER_URL}/api/schedule-message-bulk/{from_number}`                                                                | register a one-off   | `scheduleId` (local id), `provider`, `targetPhoneNumbers[]`, `message`, `scheduleDateTime` (ISO-8601 with offset), `timezone`, `messageType`, `mediaUrl`, `latitude`, `longitude`, `isTemplate`, `templateData`, `recipientAttributes{}` |
| POST `{SERVER_URL}/api/schedule-recurring/{from_number}`                                                                   | register a recurring | same plus `targetQueues`, `targetGroups`, `targetNumbers`, `repeatInterval`, `repeatEvery`, `daysOfWeek`, `endDate`                                                                                                                      |
| POST `/api/pause-schedule/{nodeId}`, POST `/api/resume-schedule/{nodeId}`, DELETE `/api/cancel-scheduled-message/{nodeId}` | lifecycle            | none                                                                                                                                                                                                                                     |

All calls: JSON, 10 s timeout, header `X-Node-Token` (`node_token()`), success = 2xx with `scheduleId` in the response.

- **Data:** writes `node_schedule_id` (varchar 100) and `status` (`running` for recurring, `scheduled` for one-off) on success; on failure leaves the id null.
- **Rules & edge cases:**
  1. The client returns null (no registration) when: no Node URL configured (`tw_node_url()`: admin `baileys_server_url`, else `.env SERVER_URL`); the row has no `from_number`; a one-off resolves to zero recipients (row marked `failed`: "No recipients matched at registration time."); a template gate fails (TW-SCHED-006); the bridge returns non-2xx (logged with body); the HTTP call throws.
  2. `scheduleDateTime` is sent as ISO-8601 WITH offset because the bridge re-parses it with `moment.tz(value, timezone)`; a naive string would shift the send by the user's UTC offset.
  3. Lifecycle calls (`pause`, `resume`, `cancel`) return false when Node is unconfigured or the row has no `node_schedule_id`, and swallow errors: Laravel flips the local status anyway so the UI never lies; the next reconcile is on restore.
  4. Local state on a failed registration stays `scheduled` (the column default) even for recurring rows, so the row looks armed but nothing will fire until a restart-restore, run-now, sweeper or manual save; recurring rows that fail never become `running`.
  5. QUIRK: rows created by API-v1 and the mobile app never call registration at all (TW-SCHED-028/029); they wait for the next bridge restart.
  6. The Node id is returned by Node as `bulk_<ms>_<rand>` / `recurring_<ms>_<rand>`; Laravel stores it as an opaque string.
- **Async & events:** synchronous HTTP; Laravel logs `NodeScheduler <op> non-2xx / failed`.
- **External systems:** Node bridge (auth `X-Node-Token`; the bridge also accepts loopback callers when `NODE_API_AUTH=loopback`, default).
- **Settings:** `baileys_server_url` (admin system message settings) / `.env SERVER_URL`; `node_webhook_token` / `baileys_callback_token` / `.env NODE_WEBHOOK_TOKEN`.
- **Acceptance criteria:**
  - Given the bridge is down, When saving a schedule, Then the row exists with a null `node_schedule_id` and the toast explains it will not send until the bridge is reachable.
  - Given a one-off whose audience resolves to nobody, Then the row is `failed` with the "No recipients matched" reason.
  - Given a recurring schedule is registered, Then its status becomes `running` and the id starts with `recurring_`.
- **Source refs:** `app/Services/NodeSchedulerClient.php`, `app/Http/Controllers/ScheduledController.php` (store tail, runNow, retry), `app/Support/fc_helpers.php` (node_token, tw_node_url), `node/routes/index.js`.
- **Port notes:** replaced by direct enqueue into BullMQ (no HTTP hop). Keep the contract of "registration can fail visibly" as job-scheduling failure surfaced on the schedule (`status='failed'`, `failure_reason`). Store the resolved job id for cancel/pause.

### TW-SCHED-011 — Recurrence model: cadence, weekly days, end date, next run

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-010
- **Summary:** A schedule is either `once` or `recurring` with a daily/weekly/monthly cadence, optional weekdays and optional end date. The intent is well defined in the docs, but what actually fires is decided by Node cron expressions, and several inputs (repeat-every, end-date semantics, next-run display) do not behave as advertised.
- **Actors & access:** part of TW-SCHED-003 (input) and TW-SCHED-022 (execution).
- **UX & screens:** step 4 recurrence panel (TW-SCHED-002); list "Repeat" pill; detail "Repeats every N <interval>(s)".
- **Endpoints:** none of its own.
- **Data:** `schedule_type` (`once|recurring`), `repeat_interval` (`daily|weekly|monthly`), `repeat_every` (int, default 1), `days_of_week` (JSON ints 0=Sun..6=Sat), `end_date` (date), `send_date`, `send_time`, `timezone`, `scheduled_time` (first fire, UTC), `next_run_at`, `last_run_at`, `completed_at`.
- **Rules & edge cases:**
  1. Cron built by the bridge from the first fire time in the schedule timezone: daily -> `<min> <hour> * * *`; weekly -> `<min> <hour> * * <days joined by comma>` (all days when the list is empty); monthly -> `<min> <hour> <day-of-month> * *`. Runs at that wall-clock time in the schedule's IANA zone (DST-safe).
  2. QUIRK: `repeat_every` (1..365, "every 2 weeks") is validated and stored but the cron ignores it: daily always runs every day, weekly every listed weekday of every week, monthly every month. Only the Laravel-side `advanceRecurring()` uses it, and that only feeds a display field.
  3. QUIRK: monthly on the 29th-31st simply does not fire in shorter months (cron day-of-month), whereas `advanceRecurring()` uses "add months without overflow" (clamps to the last day). The two disagree.
  4. End date: the composer never sends one (see TW-SCHED-044), but the API of `POST /scheduled` accepts `end_date` (`after:send_date`). The bridge compares "now" with `moment.tz(endDate, tz)` = midnight AT THE START of the end date, so the last run is the day BEFORE `end_date`, and the transition to `completed` only happens on the first cron tick after that moment (the bridge posts `completed`, Laravel stores `completed_at`). `advanceRecurring()` treats the end date as inclusive (`endOfDay`). Docs say "after this date the schedule stops".
  5. `advanceRecurring()` (daily add N days; weekly = next allowed weekday within 14 days, or +N weeks when no days; monthly add N months no overflow; returns false past the end date) is only invoked by the aggregate callback when the bridge reports status `completed` for a recurring row, which happens only at end-of-schedule. During normal operation the bridge reports `running`, so `next_run_at` is never advanced: the list/detail keep showing the FIRST run time (or "overdue") forever. `markRunComplete()` (the intended per-run hook) has no caller (dead code).
  6. Status model: after successful registration the row is `running`; it returns to `paused` on pause; `completed` only on end date; `failed` if registration or a run reports failure.
  7. Per-recipient results are a high-water mark across runs (pivot statuses only move up; a later `sent` can overwrite `failed`, never the reverse), so the detail page shows cumulative recipient state, not per-run history. Aggregate `total_sent` is recomputed from the pivot, so it does not grow with each run.
  8. Recipient list for a recurring schedule is a snapshot at registration (or restore); group/tag membership changes after that are not picked up (TW-SCHED-004 rule 7).
  9. `once` schedules never advance; they end `completed` (or `failed`).
- **Async & events:** cron ticks in Node; aggregate callback per run (TW-SCHED-023).
- **External systems:** `node-cron` + `moment-timezone` in the bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a weekly schedule Mon/Wed 09:00 Asia/Kolkata, When registered, Then the bridge runs it at 09:00 IST on Mondays and Wednesdays.
  - Given a daily schedule with repeat_every 3, Then (documented gap) the bridge still runs it every day; the port must honour the interval.
  - Given a weekly schedule with no weekday, Then the API rejects it with 422 on `days_of_week`.
  - Given an `end_date` of 2026-10-10, Then the port should define whether a 09:00 run on 10 October still fires (reference: it does not).
- **Source refs:** `app/Models/ScheduledMessage.php` (advanceRecurring, nextWeeklySlot, markRunComplete), `node/controllers/scheduleController.js` (scheduleRecurring), `node/services/scheduleService.js` (executeRecurringSchedule), `app/Http/Controllers/ScheduledController.php` (updateStatus), `Documentation/pages/messaging/scheduled.html`.
- **Port notes:** represent recurrence as an RRULE-like value (freq, interval, byweekday, until inclusive) evaluated in the tenant zone with a proper "next occurrence" function (monthly clamps or skips per an explicit setting) and store `next_run_at` after every run. Use BullMQ repeatable jobs or a scheduler that enqueues the next occurrence after each run. Keep per-run history (`schedule_runs`) so the detail page can show each run.

### TW-SCHED-012 — Schedule detail and analytics page

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-024
- **Summary:** One page per schedule with status, KPI strip, delivery funnel, engagement curve, status donut, a tabbed per-recipient table, configuration details and a message preview, plus lifecycle buttons.
- **Actors & access:** Manager+ ; workspace-scoped `findOrFail` (other workspaces' ids 404; soft-deleted rows 404).
- **UX & screens:** `resources/views/user/scheduled/detail.blade.php`, JS `user-scheduled-detail.js` (ApexCharts), page key `user-scheduled-detail`.
  - Header: back link, "Schedule analytics", status badge (labels Scheduled/Running/Paused/Completed/Failed/Cancelled).
  - Header card: name, chips (Template · name, or message type; audience type · summary such as "2 group(s)", "1 broadcast queue(s)", "5 number(s)"; scheduled time + timezone; "Recurs · <interval> x <every>"; device label + phone; "Fires <relative>" while active), buttons: Pause (active) / Resume (paused), Run now and Cancel (not finished), Delete (always). NO retry button on this page (only on the list).
  - KPI cards driven by the PIVOT: Recipients (row `total_recipients`, else pivot count), Delivered (+failed, delivery %), Read (+ % of sent), Sent (+ pending, progress %), Status (+ "fires ..."/"paused"/"done ...").
  - Engagement curve (area chart, cumulative reads and cumulative sends) with buckets at 0,5,15,30,60,120,240,480,720,1440,2880,4320 minutes after the FIRST send; shown only when there is any sent/read; the "Reads/Sent" toggle buttons are decorative (both series always plot). Delivery funnel bars (Recipients, Sent, Delivered, Read, Failed). Status donut [delivered, sent-not-delivered, failed, pending] with total in the centre.
  - Recipient table with tabs All / Sent (sent+delivered+read) / Delivered (delivered+read) / Read / Failed / Pending and counts; columns Recipient (contact name/first name or dash), Phone (`mask_phone`, currently a no-op so full number), Status pill, When (failed/read/delivered/sent timestamp in the schedule timezone), Note (error message or "msg <first 8 chars of wamid>..."). Empty: "No recipients on file for this schedule." / "No recipients in this tab yet."
  - Details grid: schedule type, message type, scheduled at, next run, last run, repeats every, from device, sender phone, Node schedule id. Preview panel "What recipients see": the resolved template body (via `resolveTemplateData`) or the message content, `(empty body)` otherwise, template name and category, and a "Schedule another" link when not finished.
- **Endpoints:**

| Endpoint           | Route name            | Handler                    | Middleware                                               | Request | Response |
| ------------------ | --------------------- | -------------------------- | -------------------------------------------------------- | ------- | -------- |
| GET scheduled/{id} | user.scheduled.detail | ScheduledController@detail | Authenticate, EnsureWorkspaceRole:manager (`id` numeric) | -       | view     |

- **Data:** `scheduled_messages` (+ template and device relations), `scheduled_message_contacts` ordered by id with `contact(id,name,first_name,last_name,mobile,email,country_code)`.
- **Rules & edge cases:**
  1. Counts come from the pivot, not the row counters, so they can disagree with the list page (which sums row counters).
  2. QUIRK: the device relation is `belongsTo(Device)` for every provider. For WABA/Twilio rows `device_id` holds a `wa_provider_configs.id`, so the page shows a dash or, worse, an unrelated Baileys device that happens to share the id.
  3. Status badge text for `cancelled` is the raw status word.
  4. Rows are hydrated in full (no pagination), so a schedule with tens of thousands of recipients renders a huge page. There is no auto-refresh; action buttons reload the page 400 ms after success (delete redirects to the list).
  5. `recipientSummary` returns a dash for `tag` audiences.
- **Async & events:** none (no realtime).
- **External systems:** ApexCharts (bundled).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a completed schedule with 10 recipients (7 delivered, 2 read, 1 failed), Then the KPI cards show Sent 9 (sent+delivered+read), Delivered 9, Read 2, Failed 1, and the donut series is [9, 0, 1, 0] (total 10).
  - Given a paused schedule, Then the header shows Resume, Run now, Cancel and Delete.
  - Given a schedule id from another workspace, Then 404.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (detail), `resources/views/user/scheduled/detail.blade.php`, `resources/js/charts/user-scheduled-detail.js`.
- **Port notes:** paginate the recipient table server-side; compute KPI/funnel/curve with SQL aggregates on the recipient table; join the correct sender table by provider (use a channel-account registry); add SSE for live progress while a run is active.

### TW-SCHED-013 — Pause and resume

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-SCHED-020
- **Summary:** Temporarily stop and restart an active schedule.
- **Actors & access:** Manager+; workspace-scoped.
- **UX & screens:** icon buttons on list rows and header buttons on the detail page; no confirmation; toasts "Paused." / "Resumed."
- **Endpoints:**

| Endpoint                   | Route name            | Handler                    | Middleware                                | Request | Response                                                                         |
| -------------------------- | --------------------- | -------------------------- | ----------------------------------------- | ------- | -------------------------------------------------------------------------------- |
| POST scheduled/{id}/pause  | user.scheduled.pause  | ScheduledController@pause  | Authenticate, EnsureWorkspaceRole:manager | -       | `{ok:true}` or 422 `{ok:false, message:"Only active schedules can be paused."}`  |
| POST scheduled/{id}/resume | user.scheduled.resume | ScheduledController@resume | same                                      | -       | `{ok:true}` or 422 `{ok:false, message:"Only paused schedules can be resumed."}` |

- **Data:** `scheduled_messages.status` (`scheduled|running` -> `paused` -> `scheduled` for once / `running` for recurring).
- **Rules & edge cases:**
  1. Pause is allowed only from `scheduled` or `running`; resume only from `paused`.
  2. The bridge is told first (`pause-schedule/{node_schedule_id}` stops the cron and marks the in-memory entry paused; resume restarts the cron), but the local status flips regardless of the bridge result, so the UI never lies.
  3. QUIRK: a paused one-off whose fire time passes while paused is not run on resume (the cron only matches its original day/month, i.e. next year); the operator must use Run now.
  4. QUIRK: after a bridge restart, paused rows are not restored (restore lists only `scheduled|running`); resuming such a row flips the DB status but the stale `node_schedule_id` no longer exists on the bridge, so nothing is armed and the schedule silently never fires until the next restore.
  5. Rows with no `node_schedule_id` (API/mobile-created) are paused only locally.
  6. Bridge-initiated pauses (daily cap reached, socket dropped) set the in-memory entry to `paused` and try to report status `paused`, which Laravel's validator rejects (TW-SCHED-023), so those pauses are invisible in the UI.
- **Async & events:** bridge HTTP call.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active recurring schedule, When paused, Then status is `paused` and the bridge stops firing it.
  - Given a paused schedule, When resumed, Then status is `running` (recurring) or `scheduled` (once).
  - Given a completed schedule, When pausing, Then 422 "Only active schedules can be paused."
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (pause, resume), `app/Services/NodeSchedulerClient.php`, `node/controllers/scheduleController.js` (pauseSchedule, resumeSchedule).
- **Port notes:** pausing removes/holds the BullMQ repeatable job; resuming recomputes the next occurrence from now (never fire missed runs unless the schedule says so) and always re-arms the job.

### TW-SCHED-014 — Cancel

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-SCHED-020
- **Summary:** Stop a not-yet-finished schedule for good while keeping its history.
- **Actors & access:** Manager+.
- **UX & screens:** confirm modal "Cancel this schedule?" (list and detail); toast "Cancelled - Node cron removed."
- **Endpoints:**

| Endpoint                   | Route name            | Handler                    | Middleware                                | Request | Response                                                                               |
| -------------------------- | --------------------- | -------------------------- | ----------------------------------------- | ------- | -------------------------------------------------------------------------------------- |
| POST scheduled/{id}/cancel | user.scheduled.cancel | ScheduledController@cancel | Authenticate, EnsureWorkspaceRole:manager | -       | `{ok:true}` or 422 `{message:"Already finished."}` (status completed/cancelled/failed) |

- **Data:** `status='cancelled'`; pivot rows untouched (stay `pending`).
- **Rules & edge cases:**
  1. Allowed from `scheduled`, `running`, `paused`. `failed` rows cannot be cancelled (use delete).
  2. The bridge is asked to cancel (`DELETE /api/cancel-scheduled-message/{node_schedule_id}`): it removes EVERY in-memory entry whose node id or caller `scheduleId` matches and stops the jobs; unknown ids return 404 which Laravel ignores. If the bridge is unreachable the row is still marked `cancelled` locally.
  3. QUIRK: rows registered on the bridge WITHOUT a stored `node_schedule_id` (created via API-v1/mobile and restored after a restart) are never cancelled on the bridge because Laravel only calls cancel when it has an id; the bridge still fires them.
  4. The same cancel behaviour applies to API-v1 `DELETE /api/v1/scheduled/{id}` (TW-SCHED-028).
- **Async & events:** bridge HTTP call.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a future one-off, When cancelled, Then status is `cancelled` and no message is sent at the original time.
  - Given a failed schedule, When cancelling, Then 422 "Already finished."
  - Given a paused schedule, When cancelled, Then it becomes `cancelled`.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (cancel), `node/controllers/scheduleController.js` (cancelSchedule).
- **Port notes:** delete the queued job by deterministic id (`schedule:{id}:{run}`) in the same transaction as the status change; guard the worker to re-read status before sending so a cancel racing a run wins.

### TW-SCHED-015 — Run now

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-010
- **Summary:** Fire a schedule immediately, ignoring its planned time.
- **Actors & access:** Manager+.
- **UX & screens:** confirm modal "Fire this schedule now?" ("Send now"); toast "Will fire shortly."; the modal copy (about 60 s, counts against wallet immediately) is inaccurate.
- **Endpoints:**

| Endpoint                    | Route name             | Handler                    | Middleware                                | Request | Response                                                                                                                                   |
| --------------------------- | ---------------------- | -------------------------- | ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| POST scheduled/{id}/run-now | user.scheduled.run-now | ScheduledController@runNow | Authenticate, EnsureWorkspaceRole:manager | -       | `{ok:true, message:"Sending now..."}`, 422 "Schedule is already finished." (completed/cancelled), or 502 when the bridge cannot be reached |

- **Data:** sets `scheduled_time` and `next_run_at` = now, `status` = `running` (recurring) / `scheduled` (once); replaces `node_schedule_id`.
- **Rules & edge cases:**
  1. Allowed from `scheduled`, `running`, `paused` and also `failed` (only completed/cancelled are refused).
  2. Local row is updated first, then the old bridge entry is cancelled (to prevent a double fire) and the row is re-registered; the bridge sends immediately when the target time is within 5 seconds (the docs' "about 60 seconds" is wrong).
  3. Recurring rows: the new registration re-anchors the cadence to the current clock time (daily 14:07 from now on).
  4. QUIRK: if registration fails the request returns 502 but the row has already been modified (time = now, status active or `failed` when the audience resolved empty).
  5. Recipients already `sent` in the pivot are skipped (resume-safe filter), so run-now on a partly sent schedule sends only to the remainder; failure fields (`failure_reason`, `failed_at`) are not cleared.
  6. No warmer, wallet, plan or SendGate checks run.
- **Async & events:** bridge HTTP calls (cancel + register).
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a scheduled one-off for tomorrow, When Run now is used, Then the bridge sends within seconds and the row completes.
  - Given the bridge is down, Then 502 with the "check the WhatsApp bridge is running..." message.
  - Given a completed schedule, Then 422 "Schedule is already finished."
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (runNow), `node/controllers/scheduleController.js` (scheduleBulkMessage immediate branch).
- **Port notes:** enqueue an immediate job with the same idempotency key as the scheduled one; make the operation atomic (either the row changes and the job exists, or neither).

### TW-SCHED-016 — Edit a schedule (PATCH)

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-SCHED-003
- **Summary:** A JSON endpoint to change name, message, date, time or timezone. The docs list "Edit" as a feature, but no page calls it and it does not update the bridge.
- **Actors & access:** Manager+ (API only in practice).
- **UX & screens:** none (no edit button exists in any view or script; the composer's failure copy says "edit & save to retry" but there is no edit screen).
- **Endpoints:**

| Endpoint             | Route name            | Handler                    | Middleware                                | Request                                                                                                                                                             | Response                                                                                            |
| -------------------- | --------------------- | -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| PATCH scheduled/{id} | user.scheduled.update | ScheduledController@update | Authenticate, EnsureWorkspaceRole:manager | `schedule_name` string max 255, `message_content` nullable string max 4096, `send_date` date, `send_time` string max 16, `timezone` string max 64 (all `sometimes`) | `{ok:true, data:<full row>}` or 422 "Cannot edit a finished schedule." (completed/cancelled/failed) |

- **Data:** updates the given columns; when any of date/time/timezone is present recomputes `send_time` (24h), `scheduled_time` and `next_run_at` in UTC.
- **Rules & edge cases:**
  1. QUIRK: no 2-minute lead-time check, no `after_or_equal:today`, and the timezone is NOT checked against the identifier list (an invalid zone throws and yields a 500).
  2. QUIRK: the bridge is never told (the bridge has `PUT /api/update-schedule/:id` but Laravel never calls it), so the in-memory cron and message keep the OLD values until a restart or re-registration.
  3. Response returns the entire model (decrypted name, body and target numbers) which is PII.
  4. Recipients, sender, template and recurrence cannot be edited.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active schedule, When PATCHing a new `send_time`, Then `scheduled_time`/`next_run_at` change (documented gap: the bridge still fires at the old time).
  - Given a completed schedule, Then 422 "Cannot edit a finished schedule."
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (update), `node/controllers/scheduleController.js` (updateSchedule), `Documentation/pages/messaging/scheduled.html`.
- **Port notes:** implement edit as cancel + re-create of the queued job atomically, re-run the lead-time and timezone validation, return a DTO without recipient PII, and build the missing edit screen (reuse the composer prefilled).

### TW-SCHED-017 — Retry a failed schedule with a new time

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-010
- **Summary:** For a `failed` schedule the operator picks a fresh date/time/timezone; the row and its recipients are reset to a clean state and re-registered.
- **Actors & access:** Manager+.
- **UX & screens:** retry icon on failed list rows -> "Retry with new time" modal (TW-SCHED-001); toast "Retry scheduled."
- **Endpoints:**

| Endpoint                  | Route name           | Handler                   | Middleware                                | Request                                                                                                                                | Response                                                                                                                                                                                                                 |
| ------------------------- | -------------------- | ------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST scheduled/{id}/retry | user.scheduled.retry | ScheduledController@retry | Authenticate, EnsureWorkspaceRole:manager | `send_date` required date after_or_equal today, `send_time` required string max 16, `timezone` required and in the PHP identifier list | `{ok, message:"Retry scheduled.", data:{id, scheduled_time (ISO), timezone, node_schedule_id}}`; 422 "Only failed schedules can be retried. Use Run-now for other states."; 422 `errors.send_time` for the 2-minute rule |

- **Data:** resets `send_date`, `send_time`, `scheduled_time`, `timezone`, `next_run_at`, `status='scheduled'`, `failed_at`, `failure_reason`, `completed_at`, `last_run_at` (null), `total_sent/delivered/failed/charged_sent` (0), `node_schedule_id` (null); pivot rows -> `status='pending'`, `error_message`, `wa_message_id`, `sent_at`, `delivered_at`, `read_at`, `failed_at` (null).
- **Rules & edge cases:**
  1. Any lingering bridge job is cancelled first. Then the row is registered again; success moves recurring rows to `running`.
  2. If registration fails the endpoint still answers success with `node_schedule_id: null` and the row stays `scheduled`, armed on nothing.
  3. QUIRK: `send_attempts`, `next_attempt_at` and `last_error` are not reset, so the automatic sweeper's attempt budget carries over.
  4. Because the pivot is fully reset, a retry re-sends to EVERY recipient, including those that had already received the earlier partial run.
  5. `charged_sent` is zeroed; billing is idempotent per provider message id so re-sent messages create new ids and are charged again when delivered.
  6. Not available on the detail page.
- **Async & events:** bridge HTTP calls.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a failed schedule, When retrying for tomorrow 09:00, Then status is `scheduled`, counters are 0, failure fields are cleared and all recipients are `pending`.
  - Given a non-failed schedule, Then 422 with the "Use Run-now" message.
  - Given a time 1 minute ahead, Then 422 on `send_time`.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (retry), `resources/js/charts/user-scheduled-index.js` (openRetryModal), `Documentation/pages/messaging/scheduled.html`.
- **Port notes:** model attempts as run records; a manual retry creates a new run with a clean recipient state but keeps history of earlier runs instead of overwriting counters.

### TW-SCHED-018 — Delete a schedule

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-SCHED-014
- **Summary:** Remove a schedule (any status) and its uploaded media file.
- **Actors & access:** Manager+.
- **UX & screens:** confirm modal "Delete this schedule permanently?" ("This cannot be undone" - in fact a soft delete). On the detail page the toast is followed by a redirect to the list.
- **Endpoints:**

| Endpoint              | Route name             | Handler                     | Middleware                                | Request | Response    |
| --------------------- | ---------------------- | --------------------------- | ----------------------------------------- | ------- | ----------- |
| DELETE scheduled/{id} | user.scheduled.destroy | ScheduledController@destroy | Authenticate, EnsureWorkspaceRole:manager | -       | `{ok:true}` |

- **Data:** soft-deletes the row (`deleted_at`); pivot rows remain (the FK cascade only fires on hard delete); the media file `public/uploads/scheduled/<media_file>` is unlinked.
- **Rules & edge cases:**
  1. The bridge job is cancelled first when a `node_schedule_id` exists (so a deleted schedule cannot fire).
  2. QUIRK: a multi-sender fan-out shares ONE uploaded file across all sibling rows; deleting one row removes the file and breaks the media for its siblings.
  3. Any status can be deleted, including `running`; the list only offers delete on terminal rows or active rows, the detail page always.
  4. Soft-deleted rows disappear from list, detail, plan-limit counts, API and restore.
- **Async & events:** bridge HTTP call.
- **External systems:** Node bridge.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a scheduled row with media, When deleted, Then the row is gone from the UI, the bridge job is cancelled and the media file no longer exists.
  - Given a schedule from another workspace, Then 404.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (destroy), `app/Models/ScheduledMessage.php` (SoftDeletes).
- **Port notes:** keep soft delete plus a retention purge job; store media per schedule (or reference-count) so siblings survive; cascade-delete or archive recipients on purge.

### TW-SCHED-019 — Plan, role and limit gates for scheduled messages

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** none
- **Summary:** Who may use scheduled messages and how many schedules a workspace may hold.
- **Actors & access:** all `/scheduled*` routes require workspace role `manager` (owner > admin > manager > agent > viewer; platform admins bypass; agents/viewers are redirected to `/team-inbox`). Plan feature `schedulemessage` (package boolean; the Starter seed has it on) and numeric limit `scheduled_campaign_limit` (package integer; label "Scheduled campaigns"; 0/negative/null = unlimited). Workspace-level `plan_overrides[key]` wins over the package; platform-admin-owned workspaces are unlimited.
- **UX & screens:** URL-path paywall (`config/plan_gates.php`: `scheduled` and `scheduled/*` -> `schedulemessage`): the page still renders and `<x-plan-paywall>` slides an upgrade sheet over it. Hard block only at creation: `POST /scheduled` throws `PlanLimitReachedException`, rendered as JSON 422 `{ok:false, error:"plan_limit_reached", reason:"feature_disabled"|"limit_reached", key, used, limit, message}`. Messages: "This feature isn't available on your current plan. Upgrade to unlock it." / "You've reached your plan's limit of N scheduled campaigns. Upgrade your plan to add more, or delete an existing one to free up space."
- **Endpoints:** none of its own.
- **Data:** `packages.schedulemessage`, `packages.scheduled_campaign_limit`, `workspaces.plan_overrides`; usage = count of the workspace's `scheduled_messages` (all statuses, soft-deleted excluded). Plan usage card label "Scheduled messages" (`PlanUsage`).
- **Rules & edge cases:**
  1. The limit is a live row count (not the delete-proof `PlanUsage` ledger), so deleting a schedule frees a slot; a multi-sender fan-out creates several rows but the check runs once before creation, so a workspace can exceed the cap by (senders - 1).
  2. QUIRK: pause/resume/cancel/run-now/retry/delete/edit are not plan-gated (only the page paywall and create). API-v1 create and mobile schedule-message perform NO plan feature or limit check at all.
  3. The `/warmer` page has its own (ineffective) gate, see TW-SCHED-041.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package fields above; workspace `plan_overrides`.
- **Acceptance criteria:**
  - Given a package with `schedulemessage=false`, When posting `/scheduled`, Then 422 reason `feature_disabled`.
  - Given `scheduled_campaign_limit=5` and 5 existing rows, Then 422 with the limit message; deleting one row lets the next create succeed.
  - Given a viewer role, Then `/scheduled` redirects to `/team-inbox`.
  - Given the same plan, When posting `/api/v1/scheduled`, Then it succeeds (documented gap).
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (store), `app/Services/PlanLimitGuard.php`, `app/Exceptions/PlanLimitReachedException.php`, `app/Http/Middleware/EnsureWorkspaceRole.php`, `config/plan_gates.php`, `app/Models/Package.php`, `database/seeders/PackageSeeder.php`, `Documentation/pages/messaging/scheduled.html`.
- **Port notes:** express as capability `scheduling.use` (RBAC) plus entitlement `scheduling.max_active_schedules` (PLAN); enforce in the use case shared by web, API and mobile so every entry point applies the same check; decide whether the cap counts active or all rows.

### TW-SCHED-020 — Node scheduler runtime: registration endpoints, cron, in-memory state

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** XL (>2 weeks)
- **Depends on:** none
- **Summary:** The Node bridge is the real scheduler. It exposes nine `/api` endpoints, keeps every pending schedule as an entry in `app.locals.scheduledMessages` and a `node-cron` job in `app.locals.scheduledJobs`, and fires them in the schedule's timezone. Nothing is persisted on the bridge; Laravel is the source of truth and re-feeds it after restarts.
- **Actors & access:** Laravel server-side callers (`NodeSchedulerClient`, appointment reminder scheduler, `WhatsAppDispatcher`). All `/api/*` bridge routes pass `apiTokenGuard`: allowed when `X-Node-Token` (or body `node_token`) equals `NODE_WEBHOOK_TOKEN` (constant-time compare) OR the peer is loopback (mode `NODE_API_AUTH`: `loopback` default, `token` strict, `off` legacy).
- **UX & screens:** none.
- **Endpoints (bridge):**

| Endpoint                                         | Handler              | Purpose                                                                                                                   |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| POST /api/schedule-message-bulk/:phoneNumber     | scheduleBulkMessage  | register a one-off multi-recipient schedule                                                                               |
| POST /api/schedule-recurring/:phoneNumber        | scheduleRecurring    | register a recurring schedule                                                                                             |
| POST /api/send-bulk-immediate/:phoneNumber       | sendBulkImmediate    | send a bulk list now (id `immediate_...`); no Laravel caller exists                                                       |
| POST /api/schedule-message/:phoneNumber          | scheduleMessage      | legacy single-recipient schedule (id `single_...`); used by the team-inbox/chat "send later" path in `WhatsAppDispatcher` |
| GET /api/scheduled-messages/:phoneNumber         | getScheduledMessages | list in-memory entries for a sender; no Laravel caller                                                                    |
| POST /api/pause-schedule/:scheduleId             | pauseSchedule        | stop the cron, mark paused (by node id only)                                                                              |
| POST /api/resume-schedule/:scheduleId            | resumeSchedule       | restart the cron, mark running                                                                                            |
| DELETE /api/cancel-scheduled-message/:scheduleId | cancelSchedule       | remove by node id OR caller scheduleId                                                                                    |
| PUT /api/update-schedule/:scheduleId             | updateSchedule       | change time/timezone/message and re-arm; no Laravel caller                                                                |

- **Data (in memory only):** entry fields `id` (`bulk_|recurring_|single_|immediate_` + epoch ms + 9 random chars), `scheduleId` (Laravel id or caller-defined, including negative synthetic ids for appointment reminders), `provider`, `senderPhoneNumber`, `targetPhoneNumbers`, `message`, `scheduleDateTime`, `timezone`, `messageType`, `mediaUrl`, `latitude`, `longitude`, `isTemplate`, `templateData`, `recipientAttributes`, `status`, `type` (`bulk|recurring|single`), recurrence fields, counters.
- **Rules & edge cases:**
  1. One-off register: the ISO time is parsed with `moment.tz(scheduleDateTime, timezone||UTC)`. If the target is within 5 seconds (or in the past) the send runs immediately via `setImmediate` and no cron is created. Otherwise the cron expression is `<min> <hour> <day> <month> *` in the schedule timezone; there is no year field (a date more than a year away fires at the next matching day/month).
  2. De-duplication: registering with a `scheduleId` that already exists REPLACES the previous entries and stops their jobs (so a reschedule of the same appointment never stacks). Cancel-by-`scheduleId` removes all entries for that id.
  3. Recurring register builds a cron from the interval (TW-SCHED-011), status `running`, `totalRuns` 0; unknown interval or missing weekday list makes cron creation throw and the endpoint returns 500 `Failed to schedule recurring message`.
  4. Pause/resume find entries by node id only. Update rebuilds a cron from the new time (bulk/recurring dispatch by entry type) and does not honour the immediate-fire shortcut.
  5. Legacy single: Baileys supports text, media (`media_with_caption`/`media_only` via URL download by extension), location; on WABA/Twilio (`provider` in payload) only text is supported and other types fail loudly. QUIRK: the handler ignores `targetJid`, so team-inbox "send later" replies to WhatsApp GROUPS are sent to the digits as a personal chat instead of the group; the entry is removed 60 s after a successful send. (Owner of the inbox side: TIB1/CHAT.)
  6. State is lost on any bridge restart; the only recovery is the boot sync (TW-SCHED-025), which skips past-due one-offs.
  7. A separate service-level `executeScheduledMessage` in `scheduleService.js` is dead code and would throw (references an undefined `settings`).
  8. `node/utils/cleanup.js` has the schedule-cancel-on-logout block commented out, so disconnecting a device leaves its schedules armed.
- **Async & events:** node-cron ticks; status callbacks to Laravel (TW-SCHED-023/024); boot-time restore.
- **External systems:** `node-cron`, `moment-timezone`.
- **Settings:** env `NODE_WEBHOOK_TOKEN`, `NODE_API_AUTH`, `APP_DOMAIN_NAME` (Laravel base URL for callbacks; default `http://localhost:8000`).
- **Acceptance criteria:**
  - Given a register call for 10 minutes ahead, Then the response contains a `bulk_...` id and `scheduledFor`, and the message goes out at the requested local time.
  - Given a register call for "now", Then the response is "Sending now" and sending starts immediately.
  - Given two register calls with the same `scheduleId`, Then only the second fires.
  - Given a cancel by caller `scheduleId`, Then every entry with that id is removed and the response reports `cancelled: n`.
  - Given a request without a valid token from a non-loopback host, Then 401.
- **Source refs:** `node/routes/index.js`, `node/controllers/scheduleController.js`, `node/services/scheduleService.js`, `node/utils/cleanup.js`, `app/Services/Appointments/AppointmentReminderScheduler.php`, `app/Services/WhatsAppDispatcher.php`.
- **Port notes:** replace with `apps/api/src/modules/scheduling/` + a BullMQ `scheduled-send` queue (delayed jobs for one-offs, job schedulers for recurrences, deterministic job ids for dedupe/cancel). Persist state in Postgres, never in worker memory. Provide a small `Scheduler` port (`schedule/cancel/pause/resume/rescheduleAt`) so appointment reminders, cart recovery and the inbox "send later" feature use the same mechanism. Store the target as a group JID when sending to groups.

### TW-SCHED-021 — Node one-off execution: engine routing and per-recipient send

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** XL (>2 weeks)
- **Depends on:** TW-SCHED-020, TW-SCHED-042
- **Summary:** What the bridge does when a one-off schedule fires: choose the engine, walk the recipient list with safe pacing, send each message in the correct WhatsApp shape, and report each outcome.
- **Actors & access:** system (cron tick or immediate fire).
- **UX & screens:** none (results appear on list/detail).
- **Endpoints:** outbound to Laravel: `GET api/whatsapp-settings?phone=` (settings/branding, via `getWhatsAppSettings`), `GET api/whatsapp-message-settings` (pacing refresh), `POST api/update-scheduled-contact-status` (per recipient), `POST api/update-schedule-status` (aggregate).
- **Data:** in-memory entry; Laravel pivot/row via callbacks.
- **Rules & edge cases:**
  1. Entries whose status is `cancelled` or `paused` at fire time are skipped silently (a schedule paused when its moment passes never fires).
  2. Engine choice: the row's `provider` is authoritative. `baileys` forces Baileys; `waba` uses Meta only when settings have `use_facebook_api`, phone id and token; `twilio` uses Twilio only when `use_twilio`, SID, auth token and from-number are set and Meta is not enabled; an empty provider (old rows) falls back to the settings heuristic. With no Baileys client and no usable HTTP engine the run fails with "Client not found" (callback `failed`, 0/0). An empty recipient list fails with "No recipients".
  3. Before the loop: pacing settings are refreshed from Laravel (so an admin change applies to the next run), and for Baileys the per-device daily cap is checked (default 4,000/day/number, UTC day): at zero the entry is paused with an explanatory error and a `paused` callback is attempted.
  4. Per recipient (Baileys only): the socket-liveness gate runs first; on a dropped connection the run pauses, attempts a `paused` callback, and unwinds without failing the remaining recipients (they stay pending).
  5. Message building per type. Text: the workspace `branding_footer` (plan-gated) is appended as an italic line; contact placeholders (`{{key}}`, tolerant of case/space/dash variants) are replaced from the recipient attribute map. Template (Baileys): positional `{{1}}` mapped through `variable_map`, header rendered bold above the body, footer separate, carousel via `sendCarouselMessage`, media header sent as image/video/document/audio with body+footer caption (base64 payload preferred over URL download), quick-reply/URL/call buttons formatted as interactive buttons (max 3), text-only template with buttons sent as an interactive-button message; if an attachment is configured but its bytes cannot be produced the recipient is marked FAILED (never silently downgraded to text). Media: downloaded from `mediaUrl`, slot chosen by MIME type (image/video/audio/document with file name), caption placeholders resolved. Location: latitude/longitude with the message text as the place name.
  6. WABA: a pre-built Meta template payload for the phone (keyed by the number as given or the formatted number) is sent as a template; otherwise a plain text message when `messageType='text'` (inside the 24 h window; footer appended, NO per-recipient placeholder replacement); otherwise the recipient fails with "No Meta payload built for this scheduled send. Use a template OR plain text within the 24h customer-service window." Media and location are not supported on WABA scheduled sends.
  7. Twilio: template via ContentSid + positional variables when `twilio_content_sid` exists (else body text; media attachment URL when present), media messages (`messageType='media'` with URL), or plain text with footer; otherwise "No template / media / text body provided for Twilio send." Bulk (one-off) Twilio calls pass empty contact data, so content variables resolve to blanks.
  8. Accounting: success increments the run counter and (Baileys only) the daily tally; the per-recipient callback is always posted (`sent`/`failed`, error text such as the exception message or "send returned no success flag"; WABA/Twilio also pass the provider message id; Baileys passes none).
  9. After each recipient (success or failure, even the last) the bridge waits a jittered `msg_gap` (admin, default 3 s, +-20%). When batching is enabled and the list exceeds `batches_gap` (default 50), it processes batches with a jittered `bw_msg_gap` (default 5 minutes, +-20%) between batches.
  10. Final status: `failed` when EVERY recipient failed, else `completed` (even with partial failures). The aggregate callback sends `totalSent = sent`, `totalDelivered = 0` ("do not fabricate delivered"), with three attempts and 1.5 s/3 s backoff; the failed count and any failure reason are NOT sent, so Laravel's `failure_reason` stays empty for bridge-detected failures.
  11. An unexpected exception marks the entry failed and posts a `failed` callback (0/0). The cron job is stopped and removed in a `finally` block.
  12. WABA/Twilio schedules skip the socket gate and the Baileys daily cap.
  13. The bridge does not check the platform emergency halt, the warmer gap/active hours/spintax, or wallet state.
- **Async & events:** callbacks; `[SCHED-*]` console logs.
- **External systems:** Baileys sockets, Meta Graph API (`sendMessageViaFacebookApi`), Twilio REST (`sendMessageViaTwilioApi`), media hosts.
- **Settings:** admin `msg_gap`, `enable_batches`, `batches_gap`, `bw_msg_gap` (TW-SCHED-043); `baileys_daily_cap` (never actually delivered to the bridge, so always 4,000, see TW-SCHED-042); workspace `branding_footer`.
- **Acceptance criteria:**
  - Given a Baileys one-off with 3 recipients and plain text "Hi {{name}}", When it fires, Then each recipient receives their own name, three `sent` callbacks are posted, spaced by the jittered gap, then the aggregate callback reports `completed` with `totalSent=3`.
  - Given the sender device is disconnected at fire time, Then the run fails with "Client not found" and Laravel marks the row `failed`.
  - Given a WABA number and a free-text schedule to a contact outside the 24 h window, Then that recipient fails with Meta's error text and the pivot shows it.
  - Given all recipients fail, Then the row becomes `failed`; given one succeeds, Then `completed`.
- **Source refs:** `node/services/scheduleService.js` (executeBulkScheduledMessage, replacePlaceholders, buildBaileysMediaPayload), `node/utils/sendSafety.js`, `node/utils/helpers.js` (getWhatsAppSettings, updateBulkScheduleStatus, downloadAndPrepareMediaBaileys, formatPhoneNumber), `Documentation/pages/messaging/scheduled.html`.
- **Port notes:** the send worker (`apps/api/src/modules/messaging/workers/scheduled-send.worker.ts`) should iterate recipients as individual idempotent jobs (one per recipient with a per-run dedupe key) through the provider adapter for the sender's channel account, apply the outbound policy + warmer + pacing per number, and write recipient results transactionally. Report real failure counts and reasons. Reuse the same renderer for placeholders across all engines.

### TW-SCHED-022 — Node recurring-run execution

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-SCHED-021
- **Summary:** What the bridge does each time a recurring cron fires. It mirrors the one-off path with several gaps.
- **Actors & access:** system.
- **UX & screens:** none.
- **Endpoints:** outbound `POST api/update-scheduled-contact-status` per recipient and `POST api/update-schedule-status` once per run.
- **Data:** in-memory `totalRuns`, `lastRunAt`.
- **Rules & edge cases:**
  1. Skips when cancelled/paused. Checks the end date (TW-SCHED-011 rule 4); when passed, marks completed, stops the cron and posts `completed`.
  2. Engine routing is the same provider-authoritative logic, but if no engine is usable the run returns silently (no callback, nothing recorded).
  3. Recipients: the stored `targetPhoneNumbers` snapshot; if empty, a legacy fallback calls `POST api/get-queue-recipients` on Laravel, a route that does not exist, so it yields nothing; an empty list logs a warning and skips the run with no callback.
  4. The Baileys daily cap check silently skips the run when exhausted; a dropped socket mid-run silently abandons the run.
  5. Message types: text, media, location on Baileys; WABA prebuilt/text path; Twilio template/media/text. QUIRK: there is NO `template` branch for Baileys, so a recurring TEMPLATE schedule on an Unofficial number marks every recipient failed ("send returned no success flag"). The recurring WABA text path does not append the branding footer; the Twilio path passes the recipient's attributes.
  6. Per-recipient callbacks and gap pacing as in TW-SCHED-021; batching as well.
  7. Per-run aggregate callback: `status:"running"`, `totalSent = this run's sent count` (per-run, not cumulative), `totalDelivered:0`, `lastRunAt`, `phoneNumber`. Laravel treats a callback whose counters do not exceed the stored totals as a duplicate (TW-SCHED-023), so repeated equal-sized runs are dropped, and `next_run_at` is not advanced.
  8. Failed runs are not reported as `failed`; the schedule stays `running` and the failure is visible only per recipient.
- **Async & events:** cron.
- **External systems:** as TW-SCHED-021.
- **Settings:** as TW-SCHED-021.
- **Acceptance criteria:**
  - Given a daily text schedule to 2 numbers, When 09:00 arrives, Then both receive the message and 2 per-recipient callbacks + 1 aggregate `running` callback are posted.
  - Given a recurring template schedule on a Baileys number, Then (documented defect) all recipients fail.
  - Given the end date has passed, Then the run posts `completed` and the cron stops.
- **Source refs:** `node/services/scheduleService.js` (executeRecurringSchedule), `node/controllers/scheduleController.js` (scheduleRecurring, registerRecurringInternal), `node/utils/helpers.js` (fetchQueueRecipients).
- **Port notes:** each occurrence is a `schedule_run` with its own recipient snapshot and counters; support all message types on all engines; record failures at run level; fix per-run vs cumulative accounting.

### TW-SCHED-023 — Aggregate status callback (POST api/update-schedule-status)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-021
- **Summary:** The bridge reports a schedule's lifecycle and sent totals; Laravel updates the row, meters usage and backfills the recipient pivot.
- **Actors & access:** the Node bridge. Route is in the `api` group with no session/CSRF; authentication is the shared secret header `X-Node-Token` compared with `hash_equals` against `node_token()` (admin `node_webhook_token`, else `baileys_callback_token`, else `.env NODE_WEBHOOK_TOKEN`). An unset secret or a mismatch aborts 403 (an empty secret no longer means "allow all").
- **UX & screens:** none.
- **Endpoints:**

| Endpoint                        | Route name              | Handler                          | Middleware | Request                                                                                                                                                                                                                                                                     | Response                                                                                           |
| ------------------------------- | ----------------------- | -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| POST api/update-schedule-status | scheduled.update-status | ScheduledController@updateStatus | api        | `scheduleId` required (local id or node id), `status` required in `sent,failed,running,completed,scheduled`, `totalSent`/`totalDelivered`/`totalFailed` nullable integer >= 0, `phoneNumber` string max 64, `timestamp`/`lastRunAt` string max 64, `reason` string max 1000 | `{ok:true}`, `{ok:true, duplicate:true}`, 404 `{ok:false, message:"Schedule not found"}`, 403, 422 |

- **Data:** updates `status`, `total_sent`, `total_delivered`, `total_failed`, `last_run_at`, `completed_at`, `failed_at`, `failure_reason`, `charged_sent`, and pivot rows.
- **Rules & edge cases:**
  1. Row lookup: numeric `scheduleId` matches `id`, OR (via `orWhere`) any row whose `node_schedule_id` equals it. Not workspace-scoped (the bridge is trusted). Appointment-reminder synthetic negative ids do not match and return 404 (harmless).
  2. `sent` maps to `completed`; the rest pass through.
  3. QUIRK: `paused` is NOT an accepted status. The bridge's own pauses (Baileys daily cap, dropped socket) attempt `paused` and receive 422, so Laravel never learns about them; the row stays `scheduled`/`running` while the bridge has stopped.
  4. Idempotency: if the new status equals the stored status and every supplied counter is <= the stored value, the call is a no-op duplicate. Consequences: repeated `running` callbacks from equal-sized recurring runs are ignored; `total_sent` set here is later overwritten by the pivot recompute.
  5. Patch rules: counters overwrite (not add); `totalSent` also stamps `last_run_at = now`; `completed` stamps `completed_at`; `failed` stamps `failed_at` and stores `reason` (the bridge never sends one, so it is null).
  6. Legacy overflow metering: when `totalSent` and a `user_id` exist, the delta `totalSent - charged_sent` is metered message by message through `OverflowBilling::consumeOne(workspace, usedThisMonth + metered)` (used = this month's outbound in `inbox_messages` + legacy `messages`); on plan-cap or billing exceptions it stops and only the messages actually metered advance `charged_sent`. With the default setting `wallet_billing_on_delivery = 1` the meter is a no-op that returns immediately, so `charged_sent` simply mirrors sent counts and nothing is debited; with `0` (legacy) it charges one wallet credit per message beyond the plan quota. No pre-gate: an active plan is never blocked by an empty wallet.
  7. After the save the pivot is back-filled from the aggregate counters (failed slots taken from `pending` rows in id order, then sent slots, then delivered upgrades), capped by the pivot size, as a backstop for missing per-recipient callbacks.
  8. For recurring rows reporting `completed`, `advanceRecurring()` runs; if it finds a further slot the status returns to `running`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `node_webhook_token`/`baileys_callback_token`/`NODE_WEBHOOK_TOKEN`; `wallet_billing_on_delivery`.
- **Acceptance criteria:**
  - Given a valid token and `status=sent,totalSent=5`, Then the row becomes `completed` with `total_sent=5` and `completed_at` set.
  - Given the same payload again, Then `{ok:true,duplicate:true}` and nothing changes.
  - Given a wrong or missing token, Then 403.
  - Given `status=paused`, Then 422.
  - Given an unknown id, Then 404.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (updateStatus, backfillPivotFromAggregates), `routes/api.php`, `app/Services/OverflowBilling.php`, `app/Support/fc_helpers.php`, `node/utils/helpers.js` (updateBulkScheduleStatus).
- **Port notes:** internal worker events replace HTTP callbacks: the send worker updates run/recipient rows in the same transaction and emits a `schedule.progress` outbox event. If an external bridge stays (unofficial engine), keep a signed callback endpoint with replay protection and accept every lifecycle state including `paused` with a reason.

### TW-SCHED-024 — Per-recipient status callback and billing settlement

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-021
- **Summary:** The bridge posts each recipient's outcome. Laravel updates the pivot with a monotonic status machine, recomputes the parent's counters from the pivot, and settles wallet billing when a provider message id is present.
- **Actors & access:** the Node bridge (same `X-Node-Token` gate as TW-SCHED-023).
- **UX & screens:** feeds the detail page tabs and KPIs.
- **Endpoints:**

| Endpoint                                 | Route name                      | Handler                                 | Middleware | Request                                                                                                                                                                               | Response                                                                   |
| ---------------------------------------- | ------------------------------- | --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| POST api/update-scheduled-contact-status | scheduled.update-contact-status | ScheduledController@updateContactStatus | api        | `scheduleId` required integer (local id), `phone` required string max 32, `status` required in `sent,delivered,read,failed`, `error` max 512, `messageId` max 128, `timestamp` max 64 | `{ok:true, status}`, `{ok:true, noop:true}`, 404 "Schedule not found", 403 |

- **Data:** `scheduled_message_contacts` (find by `scheduled_message_id` + digits of `phone`; create when absent, matching a workspace contact by comparing digits of every contact's mobile), parent counters.
- **Rules & edge cases:**
  1. Billing first: when `messageId` is present and status is `sent|delivered|read`, `MessageBillingService::settleDelivered(workspace, messageId, phone, category, provider, 'scheduled')` is called with the template's resolved Meta category (null for free text); `failed` calls `settleFailed(workspace, messageId)`. Errors are logged (`[BILLING] scheduled settle failed`) and swallowed. QUIRK 1: the code comment says WABA schedules bill through the Meta status webhook, but the bridge reports `sent` with the wamid for WABA/Twilio, which settles at send time (idempotent per message id, so the later webhook cannot double-charge). QUIRK 2: Baileys per-recipient callbacks carry NO message id, so Baileys scheduled sends are never settled or billed.
  2. Status machine (rank: pending 0, failed 1, sent 2, delivered 3, read 4): `failed` only applies over `pending` (a later failure never overrides a sent/delivered/read recipient); any other status applies only when its rank is higher than the stored one; otherwise `{ok:true, noop:true}`. Timestamps `sent_at/delivered_at/read_at/failed_at` are set once (from `timestamp` when parseable, else now); `error_message` stored on failure; `wa_message_id` stored once.
  3. Counters: after the update the parent row is recomputed from the pivot in one aggregate query: `total_sent` = sent+delivered+read, `total_delivered` = delivered+read, `total_failed` = failed, `last_run_at = now`.
  4. For WABA schedules, `delivered`/`read`/late `failed` reach the pivot via the Meta status webhook (matching `wa_message_id`), which updates the pivot but does NOT recompute the parent's counters; the parent counters stay stale while the detail page (pivot-based) is right. Baileys delivered/read receipts never reach the pivot because the bridge's receipt handler only recognises broadcast messages (it forwards everything else to the chat message-status endpoint), so Baileys schedules show only sent/failed.
  5. QUIRK (cross-domain id clash): the Meta webhook treats `scheduled_message_contacts.scheduled_message_id` as a BROADCAST id (a leftover from the inherited schema): after updating a pivot row it recomputes `broadcasts` aggregates and fires the broadcast webhook for the broadcast whose id equals the SCHEDULE id, and `BroadcastsController` reads the same table by broadcast id. Only `ScheduledController` writes this table, so these reads/updates collide across the two id spaces. See Open questions.
  6. Contact matching hydrates every workspace contact to compare digits: O(contacts) per new pivot row.
- **Async & events:** none (Meta webhook is another domain).
- **External systems:** none.
- **Settings:** `node_webhook_token` family.
- **Acceptance criteria:**
  - Given a pending recipient, When `sent` with messageId arrives, Then the pivot is `sent`, parent `total_sent` +1 and one billing settlement is attempted.
  - Given the recipient is already `delivered`, When `sent` arrives, Then `{ok:true, noop:true}`.
  - Given the recipient is `sent`, When `failed` arrives, Then it is ignored.
  - Given an unknown phone, Then a pivot row is created (contact matched if possible) and updated.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (updateContactStatus), `app/Services/MessageBillingService.php`, `app/Http/Controllers/WaWebhookController.php` (applyStatus, recomputeBroadcastAggregates), `node/classes/BaileysClientManager.js` (handleMessageStatusUpdate), `node/services/scheduleService.js` (postRecipientStatus).
- **Port notes:** one `recipient_results` table keyed by (run, recipient) with a status enum and timestamps written by workers and provider webhooks through the same reducer (never regress; failure never overrides delivered/read); derive counters by aggregate view; make billing a consumer of delivery events, not of the send call.

### TW-SCHED-025 — Restore after a Node restart (GET api/scheduled/active)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-020
- **Summary:** On boot the bridge asks Laravel for every active schedule and re-arms it in memory. The endpoint also applies a plan/wallet eligibility filter.
- **Actors & access:** the Node bridge; `X-Node-Token` (403 otherwise). Not workspace scoped.
- **UX & screens:** none.
- **Endpoints:**

| Endpoint                 | Route name               | Handler                          | Middleware | Request                                                | Response                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------ | -------------------------------- | ---------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET api/scheduled/active | scheduled.active-for-bot | ScheduledController@activeForBot | api        | optional `phone_number` (exact match on `from_number`) | `{ok:true, schedules:[{id, schedule_type, scheduleId, node_schedule_id, from_number, provider, message, messageType, isTemplate, templateData, mediaUrl, latitude, longitude, scheduleDateTime, nextRunAt, timezone, targetPhoneNumbers, recipientAttributes, repeatInterval, repeatEvery, daysOfWeek, endDate}]}` |

- **Data:** reads `scheduled_messages` with status `scheduled|running`, ordered by `next_run_at`, LIMIT 1000 (QUIRK: more than 1,000 active schedules are not all restored).
- **Rules & edge cases:**
  1. Eligibility filter (read-only mirror of the overflow decision): rows with no `user_id` or no workspace pass; workspaces whose `monthly_messages_limit` is null/unlimited pass; workspaces still under the limit (outbound count this month across `inbox_messages` and legacy `messages`) pass; over the cap they pass only if the workspace owner has at least 1 wallet credit; otherwise the schedule is dropped from this response (it stays `scheduled` in the DB and is simply not armed).
  2. Recipients are freshly resolved for each row (TW-SCHED-004, including the resume-safe filter), template data re-resolved, media URL rebuilt from `media_file`.
  3. The bridge consumes it once at boot (after sessions restore and campaign sync): recurring rows -> recurring register; others -> bulk register but only if the fire time is still in the future. QUIRK/design: past-due one-offs are deliberately skipped (a double-send guard because the completion callback may have been lost); they stay `scheduled` in the UI until the operator uses Run now. There is no periodic re-sync, so schedules created without registration (API-v1, mobile) and paused-then-resumed rows are only armed by the next restart.
  4. The bridge reuses `node_schedule_id` when present; otherwise it generates a new id and never reports it back, so Laravel cannot pause or cancel those entries later (TW-SCHED-014 rule 3).
  5. QUIRK: a restored recurring row whose recipients were all previously `sent` has an empty recipient list and is a silent no-op.
- **Async & events:** boot-time only.
- **External systems:** Node bridge.
- **Settings:** `node_webhook_token` family; plan `monthly_messages_limit`.
- **Acceptance criteria:**
  - Given 3 active schedules in the future, When the bridge boots, Then all 3 are armed with their original node ids.
  - Given an active one-off whose time passed during downtime, Then it is not armed and remains `scheduled`.
  - Given an over-quota workspace with an empty owner wallet, Then its schedules are not returned.
  - Given no token, Then 403.
- **Source refs:** `app/Http/Controllers/ScheduledController.php` (activeForBot), `node/controllers/scheduleController.js` (syncScheduledMessages, registerBulkInternal, registerRecurringInternal), `node/index.js`.
- **Port notes:** not needed with durable BullMQ jobs; instead run a periodic reconcile job that finds schedules whose next occurrence has no queued job (or is overdue by less than a grace window) and re-enqueues them; define an explicit missed-run policy (fire within grace, otherwise mark `missed` and notify).

### TW-SCHED-026 — Durable retry sweeper for failed one-off schedules

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-027, TW-SCHED-010
- **Summary:** A failed one-off schedule (for example device offline at fire time) is automatically re-armed with exponential backoff up to a maximum number of attempts.
- **Actors & access:** system; driven by the bridge heartbeat.
- **UX & screens:** none (state changes show on the list: `failed` -> `scheduled`).
- **Endpoints:** invoked from `POST api/node-heartbeat` (`WaConnectController@nodeHeartbeat`, owned by NODE/WADEV): after the campaign sweep, `Cache::add('scheduled-sweep-throttle', 1, 120 s)` gates a call to `ScheduledMessageSweeper::sweep()` (about every 2 minutes).
- **Data:** `scheduled_messages.send_attempts` (tinyint), `next_attempt_at`, `last_error`, `scheduled_time`, `status`, `node_schedule_id`.
- **Rules & edge cases:**
  1. Cluster-safe lock `Cache::lock('scheduled-message-sweeper', 25)`; other callers return 0.
  2. Selects up to 50 rows ordered by id: `schedule_type='once'`, `status='failed'`, `from_number` not null, and (`next_attempt_at` null or due). Recurring rows are excluded (they re-arm themselves).
  3. For each row: max attempts = `RetryPolicy::attempts(workspace,'scheduled')`; rows at or over the max are skipped and stay `failed` for the user. Otherwise `send_attempts` is incremented, `scheduled_time = now + 5 s` and `next_attempt_at = now + RetryPolicy::delayForAttempt(...)` are saved BEFORE registering (crash-safe), then the row is registered with the bridge; on success `status='scheduled'` and the new `node_schedule_id` are stored (the bridge fires it within 5 s); if the bridge is unreachable the row stays `failed` with `last_error = "retry: bridge unreachable"`; exceptions store `retry: <message>`.
  4. The resume-safe recipient filter drops recipients already `sent`, so only the remainder is targeted; the pivot is NOT reset (unlike manual retry).
  5. QUIRK: the media URL is built as `url(<media_file>)` (no `uploads/scheduled/` prefix), so retried media schedules point at a non-existent URL.
  6. QUIRK: registration-time failures caused by permanent conditions (no recipients, auth template, quality floor, unreachable media URL) are also retried up to the max, uselessly.
  7. The heartbeat only runs when the bridge has at least one live Baileys client; WABA/Twilio-only installs never sweep. There is no admin UI for the retry settings.
  8. Manual retry does not reset `send_attempts`.
- **Async & events:** log lines `[SCHED-SWEEP]`.
- **External systems:** Node bridge.
- **Settings:** `scheduled_retry_attempts` (default 3), `scheduled_retry_backoff_sec` (default 60) at workspace-override or platform level (TW-SCHED-027).
- **Acceptance criteria:**
  - Given a failed one-off whose device is offline, When the device reconnects and the sweep runs, Then the schedule is re-armed (`send_attempts=1`, status `scheduled`) and fires within seconds.
  - Given the third failure, Then the row stays `failed` and is not re-armed again.
  - Given `next_attempt_at` in the future, Then the row is skipped this pass.
- **Source refs:** `app/Services/ScheduledMessageSweeper.php`, `app/Services/RetryPolicy.php`, `app/Http/Controllers/WaConnectController.php` (nodeHeartbeat), `database/migrations/2026_06_18_000400_add_retry_to_scheduled_messages.php`.
- **Port notes:** replace with BullMQ job retry options (`attempts`, exponential `backoff`) on the send job itself; keep a "schedule failed after N attempts" terminal state and notification.

### TW-SCHED-027 — RetryPolicy: per-feature attempts and backoff

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** none
- **Summary:** A tiny resolver that decides how many times, and how far apart, a failed send may be retried for a feature.
- **Actors & access:** system (used by the scheduled and broadcast sweepers).
- **UX & screens:** none; no admin UI edits the keys.
- **Endpoints:** none.
- **Data:** reads `workspaces.plan_overrides[<feature>_retry_attempts|_retry_backoff_sec]`, `system_settings` rows of the same names.
- **Rules & edge cases:**
  1. Features and hard-coded defaults: `scheduled` [3 attempts, 60 s], `broadcast` [3, 60], `campaign` [3, 60]. Unknown feature uses the `scheduled` defaults.
  2. Resolution order: workspace override -> platform setting -> default. Blank/null values are ignored.
  3. `attempts()` is floored at 1; `backoff()` at 0. `delayForAttempt(n)` = `min(3600, base * 2^(n-1))` seconds; base 0 means immediate.
  4. QUIRK: campaigns do not call `RetryPolicy`; they read `campaign_retry_attempts`/`campaign_retry_backoff_sec` from settings directly (backoff floor 5 s).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `scheduled_retry_attempts`, `scheduled_retry_backoff_sec`, `broadcast_retry_attempts`, `broadcast_retry_backoff_sec`, `campaign_retry_*` (none seeded, no UI).
- **Acceptance criteria:**
  - Given no overrides, Then attempts=3 and delays are 60, 120, 240 s.
  - Given base 1000 and attempt 4, Then the delay is capped at 3600 s.
  - Given a workspace override of 5, Then attempts=5 regardless of the platform value.
- **Source refs:** `app/Services/RetryPolicy.php`, `app/Services/ScheduledMessageSweeper.php`, `app/Services/BroadcastSweeper.php`.
- **Port notes:** expose `messaging.retry.{feature}.{attempts,backoffSec}` in platform settings with per-tenant override and a settings UI; map directly onto BullMQ job options.

### TW-SCHED-028 — REST API v1 scheduled endpoints

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-SCHED-029
- **Summary:** API-key clients can create, list, read and cancel scheduled messages. Creation delegates to the mobile schedule-message logic, which persists the row but does not register it with the bridge.
- **Actors & access:** API key (`AuthenticateApiKey`: acts as the key's owner with the key's workspace set current, not persisted) with plan-tiered rate limiting (`ApiPlanRateLimit`, API domain). No plan feature or limit check for scheduled messages.
- **UX & screens:** none (documented in `developer-guide/api-endpoints.html`, which lists only `POST /scheduled`).
- **Endpoints:**

| Endpoint                     | Route name               | Handler                            | Middleware                                | Request                                                                                                                                                                                                                                 | Response                                                                                                      |
| ---------------------------- | ------------------------ | ---------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| POST api/v1/scheduled        | api.v1.scheduled.store   | Api\V1\ScheduledController@store   | api, AuthenticateApiKey, ApiPlanRateLimit | `name` required max 255; `message` required without `template_id`, max 4096; `template_id` integer; `device_id` integer; `recipients` required array min 1 of strings max 32; `run_at` required string max 64; `timezone` string max 64 | 201 `{data:<ScheduledResource>}`; 404 `template_not_found`; 422 `schedule_failed` with the delegate's message |
| GET api/v1/scheduled         | api.v1.scheduled.index   | Api\V1\ScheduledController@index   | same                                      | `limit` 1..200 (default 50)                                                                                                                                                                                                             | `{data:[...], meta:{count}}` newest first, workspace-scoped, all engines and statuses                         |
| GET api/v1/scheduled/{id}    | api.v1.scheduled.show    | Api\V1\ScheduledController@show    | same                                      | -                                                                                                                                                                                                                                       | `{data}` or 404 `not_found`                                                                                   |
| DELETE api/v1/scheduled/{id} | api.v1.scheduled.destroy | Api\V1\ScheduledController@destroy | same                                      | -                                                                                                                                                                                                                                       | `{data}` (status `cancelled`); 404 `not_found`; 422 `not_cancellable` when completed/cancelled/failed         |

Resource fields: `id`, `name`, `type` (template_type), `status`, `message`, `template_id`, `device_id`, `recipient_count`, `run_at` and `next_run_at` (ISO-8601), `timezone`, `total_sent`, `total_delivered`, `total_failed`, `created_at`; recipient numbers are never returned.

- **Data:** `scheduled_messages`.
- **Rules & edge cases:**
  1. `template_id` must belong to the workspace (`WaTemplate::forCurrentWorkspace()`), else 404 `template_not_found` (a check the web store lacks).
  2. `run_at` is mapped to the mobile handler's `send_at` and parsed in `timezone` (default workspace timezone); at least 1 minute ahead (not 2). One-off text or template only, numbers only, no media/location/recurrence.
  3. QUIRK: created rows are never registered with the bridge (`node_schedule_id` stays null). They fire only after a bridge restart re-reads `api/scheduled/active` and only if still in the future; before that they stay `scheduled` forever, and the DELETE cancel cannot stop a restored job (no node id).
  4. Delete = cancel (soft state change to `cancelled`, row kept); works from `scheduled|running|paused`.
  5. QUIRK: no plan-limit, wallet, warmer or guardrail checks.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** API key settings (API domain).
- **Acceptance criteria:**
  - Given a valid key and body, Then 201 with the created schedule in status `scheduled`.
  - Given a template id from another workspace, Then 404 `template_not_found`.
  - Given a finished schedule, When DELETE, Then 422 `not_cancellable`.
  - Given `run_at` 30 seconds ahead, Then 422 `schedule_failed` "send_at must be at least 1 minute in the future".
- **Source refs:** `app/Http/Controllers/Api/V1/ScheduledController.php`, `app/Http/Requests/Api/V1/Scheduled/StoreScheduledRequest.php`, `app/Http/Resources/Api/V1/ScheduledResource.php`, `app/Http/Controllers/Api/App/QueueController.php` (scheduleMessage), `Documentation/pages/developer-guide/api-endpoints.html`.
- **Port notes:** `apps/api/src/modules/public-api/scheduled` calling the same `CreateSchedule` use case as the web (single validation, gates and job enqueue); return the envelope defined in `@crm/contracts`; keep the ownership check.

### TW-SCHED-029 — Mobile app schedule-message

- **Status:** partial
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-SCHED-025
- **Summary:** The Flutter app can schedule a text or template send to raw phone numbers. The row is stored but never handed to the bridge.
- **Actors & access:** Sanctum-authenticated app user (`Authenticate:sanctum`, `ResolveAppWorkspace` which verifies membership of the workspace named in `X-Workspace-Id` and stashes `X-Device-Id`). No role, plan or limit gate.
- **UX & screens:** none in this repo (mobile client).
- **Endpoints:**

| Endpoint                      | Route name | Handler                                 | Middleware                                     | Request                                                                                                                                                                                                                                                                                               | Response                                                                                                                                                 |
| ----------------------------- | ---------- | --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST api/app/schedule-message | app.       | Api\App\QueueController@scheduleMessage | api, Authenticate:sanctum, ResolveAppWorkspace | `device_id` nullable integer; `name` required max 255; `message` required without `template_id` (max 4096; also accepted as `temp_caption`/`message_text`); `template_id` nullable integer; `recipients` required array min 1 (strings max 32); `send_at` required string; `timezone` nullable max 64 | 200 `{success, message, data:{schedule_id, scheduled_time (UTC), timezone, total_recipient, status}}`; 422 `{success:false, message:"Validation failed." | "Could not parse send_at." | "send_at must be at least 1 minute in the future (in <tz>)." | "No valid recipient numbers.", data:{errors}}` |

- **Data:** creates one `scheduled_messages` row: `schedule_type='once'`, `recipient_type='number'`, `target_numbers` (digits only, unique), `template_type` `template` or `text`, `provider='baileys'` when a device resolved else the workspace default engine, `status='scheduled'`, `scheduled_time`/`next_run_at` in UTC, `send_date`/`send_time` in the given zone.
- **Rules & edge cases:**
  1. Timezone precedence: request, workspace, user, app default; not validated against the identifier list (an invalid zone makes parsing throw -> 500 `Failed to schedule message`).
  2. Sender: explicit `device_id` validated against the workspace's devices, else the workspace's newest CONNECTED Baileys device; `from_number` = its digits. With no connected device `device_id`/`from_number` are null and the row can never be registered.
  3. QUIRK: the row is not registered with the bridge and no pivot rows are created (the detail page shows recipients only after sends report in). It is picked up only by the next bridge restart and only if still in the future.
  4. No template ownership/approval check; no media, location or recurrence; no wallet/guardrail/warmer/plan checks. Every workspace member of any role can call it.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid request 10 minutes ahead, Then 200 with a `schedule_id` and status `scheduled`.
  - Given `send_at` 30 seconds ahead, Then 422 with the 1-minute message.
  - Given no connected device and no `device_id`, Then the row is created with null sender (documented defect).
- **Source refs:** `app/Http/Controllers/Api/App/QueueController.php` (scheduleMessage, resolveQueueDeviceId), `app/Http/Middleware/ResolveAppWorkspace.php`, `routes/app.php`.
- **Port notes:** the mobile endpoint should be a thin adapter over the shared `CreateSchedule` use case (same gates, same enqueue) and should return the created schedule id + next run.

### TW-SCHED-030 — Programmatic schedule producers (cart recovery, appointment reminders)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-SCHED-010
- **Summary:** Other domains reuse the scheduler: Shopify, WooCommerce and Storefront abandoned-cart recovery create real `scheduled_messages` rows and register them; appointment reminders bypass the table and talk to the bridge directly using synthetic ids.
- **Actors & access:** system (ECOM/STORE/APPT flows).
- **UX & screens:** cart-recovery rows appear in `/scheduled` like any other schedule (name "Cart recovery · <label>"); appointment reminders never appear.
- **Endpoints:** none of its own; bridge calls per TW-SCHED-020.
- **Data:** cart recovery rows: `schedule_type='later'` (value outside the documented enum), `template_type='standard'`, `recipient_type='number'`, `target_numbers=[customer phone]`, `template_id` = the recovery template, `provider`/`device_id`/`from_number` from the workspace engine (Baileys: newest connected device; WABA/Twilio: primary provider config, no device id), timezone = app timezone, `send_date/send_time/scheduled_time/next_run_at` = now + configured delay, `total_recipients=1`, then `registerOneOff` and the returned node id stored; the recovery record keeps the schedule ids so a converted order cancels them (`status='scheduled'` rows only: bridge cancel + local `cancelled`).
  Appointment reminders: `POST {node}/api/schedule-message-bulk/{devicePhone}` with `scheduleId` = `-1000000 - appointmentId` (booking types with several offsets use `-2000000000 - appointmentId*100 - offsetIndex`), text body from the workspace `reminder_template` tokens `{title} {time} {date}`, provider = the workspace engine; cancel = `DELETE /api/cancel-scheduled-message/{id}` for the single id plus 8 offset ids. Relies on the bridge de-duplicating by `scheduleId` and cancelling by caller id.
- **Rules & edge cases:**
  1. QUIRK: `template_type='standard'` is passed to the bridge as `messageType`; on Baileys the send switch has no such case (unknown type -> recipient failed), and on Twilio the template branch requires `messageType='template'`, so cart-recovery messages appear to work only on WABA with the v2 pre-built payload path (TW-SCHED-006).
  2. Appointment reminders exist only in bridge memory: they are lost on restart (never restored), and their status callbacks (negative ids) receive 404 from Laravel.
  3. Producers insert rows directly, so they bypass the plan feature and limit checks; the rows do count toward `scheduled_campaign_limit` for later manual creates.
  4. Cancel-on-convert only cancels rows still in status `scheduled`.
- **Async & events:** bridge registration; order-created webhooks trigger cancellation.
- **External systems:** Node bridge.
- **Settings:** cart-recovery delays/templates (ECOM/STORE), appointment `reminder_template` (APPT).
- **Acceptance criteria:**
  - Given an abandoned cart and a 1-hour recovery step, Then a `scheduled_messages` row and a bridge job exist and are visible in `/scheduled`.
  - Given the customer orders before the fire time, Then the row becomes `cancelled` and the bridge job is removed.
  - Given an appointment is rescheduled, Then registering with the same synthetic id replaces the old reminder.
- **Source refs:** `app/Services/Shopify/ShopifyCartService.php`, `app/Services/Woocommerce/WoocommerceCartService.php`, `app/Services/Storefront/StorefrontCartService.php`, `app/Services/Appointments/AppointmentReminderScheduler.php`, `node/controllers/scheduleController.js`.
- **Port notes:** producers call the shared `Scheduler` port with (idempotency key, run-at, payload) instead of writing rows/HTTP; use a `source` column (`manual|cart_recovery|appointment_reminder`) so the UI can hide or label system schedules.
