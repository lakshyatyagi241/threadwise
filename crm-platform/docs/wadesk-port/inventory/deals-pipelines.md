---
domain: deals-pipelines
code: DEAL
title: Deals and Pipelines (Sales Pipeline CRM)
wadesk_version: '1.7.0'
sources_read: 62
---

# Deals and Pipelines (Sales Pipeline CRM)

## Overview

The Sales Pipeline is a paid WaDesk feature (plan flag `access_sales_pipeline`) that gives a workspace a
drag-and-drop Kanban board of **deals** (opportunities). A workspace owns one or more **pipelines**; a pipeline owns an ordered list of
**stages** (columns); a deal sits in exactly one stage at a time. Two stages per pipeline may be flagged **won** or **lost** (terminal);
a deal's `status` (`open|won|lost`) and its `won_at`/`lost_at` stamps are always derived from its stage by a model hook.

Actors: workspace members of any role (the routes carry **no role gate**, only the plan gate), API clients holding a workspace API key,
flow runtime (Node bridge with a shared token), the Messenger lead node, the AI CRM copilot, and the order hook (auto-deal). End customers never touch it.

Main flow: first visit to `/deals` seeds a default pipeline "Sales Pipeline" with a six-stage ladder -> deals arrive from nine sources
(`manual, inbox, order, shopify, woo, form, api, flow, facebook`; only some have writers, see WD-DEAL-009 notes) -> cards are dragged across stages -> moving into a won/lost stage flips status, stamps the date,
notifies the owner, and fires the `deal_stage_changed` flow trigger for the linked contact -> follow-up tasks on the deal
timeline remind the owner when due -> `/deals/reports` shows value by stage, win rate, forecast, 6-month won/lost trend and an agent leaderboard.

Plan tiers: only an on/off flag (`access_sales_pipeline`). A second column `packages.pipelines_limit` exists but is **never enforced** (dead).
Platform admins bypass the plan gate. The AI copilot is gated separately (`access_ai_agents`).

Everything outside the happy path is thin: there is **no UI or API to create/rename/reorder/delete pipelines or stages**, no lost-reason catalog, no pagination
on the board, no audit log, no outbound webhook for deals. The WaDesk documentation promises stage editing (see WD-DEAL-041, status docs-only).

Connected domains: contacts (WD-CON-*, deal.contact_id; contact 360 shows deals), companies/tasks/projects/proposals/estimates/calendar/briefs/invoices (CRM overlap, see WD-DEAL-038/039),
inbox (create-deal button + deals panel), flows (trigger + node), orders/commerce (auto-deal from orders), AI CRM copilot, notifications, plan limits, REST API.

## Feature index

| Id | Feature | Status | Priority | Effort | Depends on |
| --- | --- | --- | --- | --- | --- |
| WD-DEAL-001 | Plan gate and (absent) role gate for the deals area | implemented | P0 | S | plan-limits domain |
| WD-DEAL-002 | Default pipeline and stage ladder seeding (+ currency heal) | implemented | P0 | S | WD-DEAL-001 |
| WD-DEAL-003 | Kanban board page: pipeline selection, columns, cards | implemented | P0 | L | WD-DEAL-002 |
| WD-DEAL-004 | Board filters (search, owner, source) | implemented | P1 | S | WD-DEAL-003 |
| WD-DEAL-005 | Board KPI strip | implemented | P1 | S | WD-DEAL-003, WD-DEAL-006 |
| WD-DEAL-006 | Money: minor units, display-currency conversion, weighted value | implemented | P0 | M | WD-DEAL-003 |
| WD-DEAL-007 | Drag-and-drop stage move (PATCH /deals/{deal}/stage) | implemented | P0 | M | WD-DEAL-003 |
| WD-DEAL-008 | Stage-change engine (status/won_at/lost_at sync, timeline row, flow trigger, notifications) | implemented | P0 | M | WD-DEAL-007 |
| WD-DEAL-009 | Create deal (modal, POST /deals) and deal sources | implemented | P0 | M | WD-DEAL-003 |
| WD-DEAL-010 | Deal detail slide-over (GET /deals/{deal}) | implemented | P0 | M | WD-DEAL-003 |
| WD-DEAL-011 | Edit deal fields inline (PATCH /deals/{deal}) | implemented | P0 | M | WD-DEAL-010 |
| WD-DEAL-012 | Mark Won / Mark Lost with optional lost reason | implemented | P0 | S | WD-DEAL-008 |
| WD-DEAL-013 | Delete deal | implemented | P1 | S | WD-DEAL-010 |
| WD-DEAL-014 | Link a contact to a deal (picker + search endpoint) | implemented | P1 | S | WD-CON-* |
| WD-DEAL-015 | Activity timeline: notes, calls, messages, tasks | implemented | P1 | M | WD-DEAL-010 |
| WD-DEAL-016 | Task done / reopen toggle | implemented | P1 | S | WD-DEAL-015 |
| WD-DEAL-017 | Overdue deal-task reminder sweep | implemented | P1 | M | WD-DEAL-015, notifications |
| WD-DEAL-018 | Owner notifications (assigned, won, lost, task due) | implemented | P1 | M | WD-DEAL-008 |
| WD-DEAL-019 | Reports page metrics and leaderboard | implemented | P1 | M | WD-DEAL-008 |
| WD-DEAL-020 | Reports charts (value by stage, won vs lost 6 months) | implemented | P1 | S | WD-DEAL-019 |
| WD-DEAL-021 | Workspace deal settings: auto-deal from orders | implemented | P2 | S | WD-DEAL-022 |
| WD-DEAL-022 | Auto-create a deal from a new order | implemented | P1 | M | commerce/orders domain |
| WD-DEAL-023 | Stage list JSON (flow builder + inbox picker) | implemented | P1 | S | WD-DEAL-002 |
| WD-DEAL-024 | Deep link /deals?deal=ID opens the drawer | implemented | P2 | S | WD-DEAL-010 |
| WD-DEAL-025 | Inbox: create deal from a conversation | implemented | P1 | M | inbox domain |
| WD-DEAL-026 | Inbox: deals panel for a conversation/contact | implemented | P1 | S | inbox domain |
| WD-DEAL-027 | Flow trigger: deal_stage_changed | implemented | P1 | M | flows domain |
| WD-DEAL-028 | Flow node: create / move deal (POST /api/flow-node/deal-action) | implemented | P1 | M | flows domain |
| WD-DEAL-029 | Messenger lead node creates a deal | implemented | P2 | S | channels (facebook) |
| WD-DEAL-030 | REST API: list deals | implemented | P1 | S | WD-DEAL-035 |
| WD-DEAL-031 | REST API: show deal | implemented | P1 | S | WD-DEAL-035 |
| WD-DEAL-032 | REST API: create deal | implemented | P1 | S | WD-DEAL-035 |
| WD-DEAL-033 | REST API: update / advance deal | implemented | P1 | S | WD-DEAL-035 |
| WD-DEAL-034 | REST API: delete deal | implemented | P1 | S | WD-DEAL-035 |
| WD-DEAL-035 | REST API cross-cutting: auth, throttle, envelope, errors, plan gate | implemented | P0 | M | api-keys domain |
| WD-DEAL-036 | AI CRM copilot deal tools (list/create/move + sales report) | implemented | P2 | M | ai domain |
| WD-DEAL-037 | Contact 360 consumption of deals and deal activities | implemented | P2 | S | WD-CON-* |
| WD-DEAL-038 | Company link (deals.company_id) and company 360 rollups | partial | P2 | M | companies |
| WD-DEAL-039 | Other CRM surfaces that read or reference deals (dashboard, calendar, briefs, tasks, projects, payments, proposals) | implemented | P2 | M | CRM overlap |
| WD-DEAL-040 | Main-dashboard deal KPI card | implemented | P2 | S | dashboard domain |
| WD-DEAL-041 | Pipeline and stage editor (rename, reorder, add, delete, flag won/lost) | docs-only | P1 | L | WD-DEAL-002 |
| WD-DEAL-042 | Multiple pipelines (selector exists, creation does not) | partial | P2 | M | WD-DEAL-041 |
| WD-DEAL-043 | Lost reasons | partial | P2 | S | WD-DEAL-012 |
| WD-DEAL-044 | pipelines_limit plan quota | dead-code | P2 | S | WD-DEAL-042 |
| WD-DEAL-045 | Demo seeding command (deals:demo) | implemented | P2 | S | WD-DEAL-002 |
| WD-DEAL-046 | Workspace data wipe includes deals and activities | implemented | P2 | S | admin/retention |
| WD-DEAL-047 | Empty, loading and error states + i18n inventory | implemented | P1 | S | WD-DEAL-003 |

## Features

### WD-DEAL-001 — Plan gate and (absent) role gate for the deals area

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** plan-limits domain, auth domain
- **Summary:** Every `/deals*` route (and companies/tasks/projects/proposals/estimates/calendar/crm) sits behind the route middleware `plan:access_sales_pipeline`. Behavior differs between safe and unsafe HTTP methods. There is no workspace-role middleware on deals.
- **Actors & access:** any authenticated user whose current workspace has the feature (platform admins bypass: Spatie roles `Super Admin`/`Admin` or legacy `users.role` in `admin`,`A`). Plan feature key `access_sales_pipeline` (package column, tinyint default 0). The nav entry "Deals" is shown with menu tier `admin` and feature `access_sales_pipeline` (UserNav) — visibility only, not enforcement.
- **UX & screens:** For a GET on a workspace without the feature the page still renders and a global paywall sheet ("Your plan does not include Sales pipeline. Upgrade to unlock this feature.") slides over it (`<x-plan-paywall>`, also driven by `config/plan_gates.php` keys `deals` and `deals/*`). Mutations are refused.
- **Endpoints:** applies to all routes in WD-DEAL-003..027. See each feature.
- **Data:** reads `packages.access_sales_pipeline` via `Workspace::effectiveLimit` (add-ons stack) through `PlanLimitGuard::hasFeature`.
- **Rules & edge cases:**
  1. Middleware `EnforcePlanFeature`: for POST/PUT/PATCH/DELETE without the feature: JSON/AJAX requests get HTTP 403 `{ok:false, error:"plan_feature_disabled", feature:"access_sales_pipeline", message:"Your plan doesn't include Sales pipeline. Upgrade to unlock this feature."}`; non-AJAX get a redirect back with a `warning` flash of the same text.
  2. QUIRK: for safe methods (GET/HEAD) the middleware does NOT block; it only shares a `planPaywall` view variable and continues. So `GET /deals/{id}`, `GET /deals/stages`, `GET /deals/contacts/search`, `GET /deals/reports` and the board itself return full data to a workspace without the plan (UI shows the paywall overlay, but a direct JSON request reads everything). The REST API is stricter (403 on every method, see WD-DEAL-035).
  3. QUIRK: there is no `workspace.role` middleware on any deals route. Viewer and agent roles can call every mutation (create, move, edit, delete, add activity) by direct request; the nav hides the link behind tier admin. The CRM dashboard/tasks/projects docblocks say "role manager" but their routes also lack the middleware.
  4. All data is workspace-scoped by `users.current_workspace_id` (model scope `forCurrentWorkspace`); with no user the scope yields no rows.
  5. Platform admins who have no membership still pass.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package feature toggle in Admin -> Packages ("Sales pipeline (Deal CRM)").
- **Acceptance criteria:**
  - Given a workspace whose plan lacks the feature, When a member sends `PATCH /deals/5/stage` as AJAX, Then the response is 403 with `error=plan_feature_disabled` and nothing changes.
  - Given the same workspace, When it opens `/deals`, Then the board renders with the upgrade sheet over it. (Decide: port strictly as 403 for reads, see Differences to decide D-01.)
  - Given a user with role `viewer`, When they POST /deals, Then WaDesk accepts it (document this; port decision D-02).
- **Source refs:** routes/web.php:1429-1446, app/Http/Middleware/EnforcePlanFeature.php, app/Services/PlanLimitGuard.php, config/plan_gates.php:60-61, app/Support/UserNav.php:146, app/Models/Package.php:145-146,608.
- **Port notes:** target stack has RBAC permission keys; define `deals.view`, `deals.write`, `deals.delete`, `deals.report`, `deals.settings` and a plan flag `salesPipeline`. Enforce reads too. Use the `rbac-permission` skill.

### WD-DEAL-002 — Default pipeline and stage ladder seeding (+ currency heal)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-DEAL-001
- **Summary:** `Pipeline::ensureDefaultForWorkspace(workspaceId, currency?)` guarantees the workspace has a pipeline with stages and returns the default. It is called on the first board visit, on the reports page, the stage-list JSON, from the REST API create, inbox create, flow/AI/order/Messenger writers.
- **Actors & access:** implicit, any caller of the above.
- **UX & screens:** none; first visit just shows the board populated with six empty columns.
- **Endpoints:** none of its own.
- **Data:** `pipelines`, `pipeline_stages`, `deals.currency` (heal).
- **Rules & edge cases:**
  1. Seeded pipeline: name `Sales Pipeline`, `is_default=1`, `sort_order=0`, currency = the workspace's `currency` (or the platform `default_currency` system setting, fallback `USD`) unless a currency argument is passed (order flow passes the order currency).
  2. Seeded stage ladder (sort_order 0..5): New Lead p=10 `#64748B`; Qualified p=25 `#0EA5E9`; Proposal p=50 `#6366F1`; Negotiation p=75 `#F59E0B`; Won p=100 `#16A34A` is_won; Lost p=0 `#DC2626` is_lost. Each stage row also carries `workspace_id`.
  3. If a pipeline exists (ordered by `is_default` desc then id) it is returned; a pipeline with zero stages is self-healed by seeding the six stages.
  4. Currency heal (runs every call when a pipeline exists): if the target currency is not `INR`, every deal and pipeline of the workspace whose stored `currency='INR'` is silently relabeled to the target currency (no amount conversion). Rationale in code comment: an old hardcoded INR default. QUIRK: the target currency is the *caller-supplied* currency (order currency in the auto-deal path) or the workspace currency; so a workspace on USD can never keep a deal explicitly priced in INR (it flips back on the next board/reports/stage-JSON/API-create call), and a USD order can relabel the workspace's INR pipeline/deals to USD.
  5. Heal errors are swallowed.
  6. The board only seeds when the pipelines list is empty; other callers always run the function.
- **Async & events:** none (synchronous).
- **External systems:** none.
- **Settings:** `workspaces.currency`, system setting `default_currency`.
- **Acceptance criteria:**
  - Given a workspace with no pipeline, When any member opens `/deals`, Then one pipeline "Sales Pipeline" (default) with exactly the six stages above exists and the board shows them in order.
  - Given a pipeline with no stages, When the board is opened, Then the six stages are created.
  - Given a USD workspace with a deal whose currency is `INR`, When the board loads, Then the deal's currency becomes `USD` (document or reject, D-03).
- **Source refs:** app/Models/Pipeline.php (DEFAULT_STAGES, ensureDefaultForWorkspace, seedDefaultStages), app/Http/Controllers/DealsController.php:25-30,246,490.
- **Port notes:** seed in the workspace-provisioning step, not lazily on GET; drop the INR heal (migrate data once). Table `pipelines`/`pipeline_stages` do not exist in this repo yet.

### WD-DEAL-003 — Kanban board page: pipeline selection, columns, cards

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** WD-DEAL-002
- **Summary:** `/deals` renders a server-side Kanban of the selected pipeline: one column per stage (ordered by `sort_order`), cards per deal, a KPI strip, a filter bar, a new-deal modal, a settings modal and a hidden detail slide-over.
- **Actors & access:** WD-DEAL-001.
- **UX & screens:** `resources/views/user/deals/index.blade.php`, JS `resources/js/charts/user-deals-board.js` (page key `user-deals-board`, nav key `deals`). Header: eyebrow "Sales / Pipeline of opportunities", title "Deals pipeline"; pipeline `<select>` only when more than one pipeline exists (navigates to `?pipeline=ID`); "Reports" link; settings gear; "New deal" button. Each column header: color dot, stage name, count badge, column total (`symbol` + integer, no decimals), `+` button (opens the new-deal modal; it does NOT preselect the column's stage). Card: top-left pill (source pill, or "Closed won" green pill on the won stage, "Lost" red pill on the lost stage), age (short relative time since created_at, absolute syntax), title, linked contact name (name, else "first last", else phone), thin probability bar for open stages with 0<p<100 (colors: p>=75 green, p>=50 amber, else teal) with "N%" text, amount (display currency, 2 decimals), avatar with 1-2 initials of the owner name (fallback contact name, fallback "Deal"; color from a 6-color palette by crc32 of the name). Won column cards get a won style; columns get `dl-col-won`/`dl-col-lost` classes. Empty column text: "No deals yet".
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| GET deals | user.deals.index | DealsController@index | auth, plan:access_sales_pipeline | query `pipeline` int, `owner` int, `source` string, `q` string | HTML view |

- **Data:** reads pipelines, pipeline_stages, deals (+ contact `id,name,first_name,last_name,country_code,mobile`, owner `id,name`), workspace members (`users.id,name`), currencies.
- **Rules & edge cases:**
  1. Pipelines ordered by `sort_order`, then `id`. Selected pipeline = `?pipeline=` if it belongs to the workspace, else the default (`is_default`), else the first.
  2. Within a stage, deals are ordered `sort_order` asc then `id` desc (newest first). QUIRK: `sort_order` is always written as 0 by every writer except the demo seeder, so effective ordering is newest-first; drag within a column is a no-op and no manual order is ever saved.
  3. NO pagination, no per-stage cap, no lazy load: every deal of every stage of the pipeline is loaded and rendered, including all-time won and lost deals. (Port must paginate per stage with a cursor; WaDesk has no reference behavior.)
  4. Filters (WD-DEAL-004) apply to the card lists and column totals but not to the KPIs (WD-DEAL-005).
  5. A card click (without drag) opens the detail slide-over (WD-DEAL-010). Cards are `draggable`.
  6. The new-deal button label inside the columns is accessible name "Add deal".
  7. QUIRK: the card avatar prefers the owner name, so unassigned deals show the contact's initials.
- **Async & events:** none (no polling, no websockets: the board never refreshes by itself; after create/edit-in-drawer the page reloads).
- **External systems:** none.
- **Settings:** display currency (workspace currency -> platform `default_currency`), see WD-DEAL-006.
- **Acceptance criteria:**
  - Given a pipeline with stages A,B,C and deals, When the board loads, Then columns appear in `sort_order` and each column's count equals its deals after filters.
  - Given two pipelines, When the user selects the second, Then the URL carries `?pipeline=<id>` and only its stages show.
  - Given an unknown `?pipeline=999`, Then the default pipeline is shown (no 404).
- **Source refs:** app/Http/Controllers/DealsController.php:21-126, resources/views/user/deals/index.blade.php, resources/js/charts/user-deals-board.js.
- **Port notes:** Next.js route under `apps/web/app/(app)/deals`; use the dnd kit; per-stage cursor pagination (e.g. 25 cards, "load more"), counts/sums computed in SQL aggregates per stage; no board-level reload.

### WD-DEAL-004 — Board filters (search, owner, source)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-003
- **Summary:** A GET form with a text search, owner select and source select; "Filter" submits, "Clear" appears when any filter is set.
- **Actors & access:** WD-DEAL-001.
- **UX & screens:** inputs `q` (placeholder "Search deals…"), `owner` (All owners + workspace members), `source` (All sources + `manual, inbox, order, shopify, woo, form, api, flow, facebook` shown capitalized). Hidden `pipeline` keeps the selected pipeline. No debounce/live filtering: full page reload.
- **Endpoints:** same as WD-DEAL-003.
- **Data:** `deals.title LIKE`, `deals.owner_user_id =`, `deals.source =`.
- **Rules & edge cases:**
  1. `q` is trimmed and matched with `title LIKE %q%`; `%` and `_` are escaped. Only the title is searched (not contact, notes, id, company).
  2. `owner` is an integer id; 0/absent = no filter. There is no "unassigned" or "me" option.
  3. `source` exact match; any string accepted (an unknown value yields empty columns).
  4. Filters never change KPIs (WD-DEAL-005) and never change the report page.
  5. No status filter, no value-range or date filter, no sort control.
- **Async & events:** none.
- **Acceptance criteria:**
  - Given deals "Acme annual" and "Beta", When q=`acme`, Then only "Acme annual" appears and column counts reflect it while the KPI strip is unchanged.
  - Given q=`100%`, Then the `%` is treated literally.
  - Given owner=7 and source=api, Then only deals with both match.
- **Source refs:** DealsController.php:38-53, views/user/deals/index.blade.php:89-112.
- **Port notes:** add server-side filters on the stage-list endpoints; consider adding "unassigned" and contact/company search (extension, not parity).

### WD-DEAL-005 — Board KPI strip

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-003, WD-DEAL-006
- **Summary:** Five tiles above the filters, scoped to the selected pipeline, all money converted to the display currency.
- **Actors & access:** WD-DEAL-001.
- **UX & screens:** (1) "Open pipeline" value + "N deals"; (2) "Weighted forecast" "by probability"; (3) "Won · this month" value + count; (4) "Win rate" N% "won vs lost"; (5) "Open deals" count "in pipeline" (duplicate of tile 1's count).
- **Data / formulas (all within the selected pipeline, workspace-scoped):**
  - Open value = sum over `status='open'` deals of converted value (convert each deal from its own `currency` to the display currency, round to minor).
  - Open count = count of `status='open'`.
  - Weighted forecast = sum over ALL board columns (post-filter) of `round(column_converted_value_minor * stage.probability / 100)`. QUIRK: includes the Won column at 100% and the Lost column at 0%, so already-won value inflates the forecast, and the figure changes when board filters are applied (the other tiles do not).
  - Won this month count/value = `status='won' AND won_at >= start of current month` (app timezone), value converted.
  - Win rate = round(won_all / (won_all + lost_all) * 100) over the pipeline, all-time, 0 when no closed deals.
  - Money formatting: currency symbol (from admin currencies table, else `CODE `) + `number_format(minor/100, 2)`.
- **Rules & edge cases:** unknown currency code converts with rate 1.0; inactive currencies are absent from the rate map, also rate 1.0 (QUIRK).
- **Acceptance criteria:**
  - Given open deals 100 USD and 200 USD in stages p=10 and p=50 and one won 300 USD, When the board loads (USD workspace), Then open value = 300, forecast = 10+100+300 = 410 (parity) — and a decision D-04 to exclude won from forecast.
  - Given 2 won and 2 lost, Then win rate shows 50%.
  - Given no deals, Then all tiles show 0 values and `0%`.
- **Source refs:** DealsController.php:55-125.
- **Port notes:** compute with SQL aggregation using a rates table; keep the same field names for contracts (`open_count, open_value, forecast, won_this_month, won_value, win_rate`).

### WD-DEAL-006 — Money: minor units, display-currency conversion, weighted value

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-DEAL-003
- **Summary:** Deal money is stored as integer minor units (`value_minor`, bigint) together with a per-deal `currency` code; the board and KPIs convert every deal into one display currency; reports do not.
- **Actors & access:** WD-DEAL-001.
- **Rules & edge cases:**
  1. Input `value` is a major-unit decimal (`numeric|min:0|max:99999999`); stored as `round(value*100)` integer; display divides by 100 (always two decimals, regardless of the currency's real precision, e.g. JPY).
  2. `currency` is a free string up to 10 chars; NOT validated against the currencies table and NOT upper-cased on write (the UI select posts uppercase codes). New deal default: pipeline currency. DB default `INR`. The UI currency select lists active admin currencies (code order), plus the pipeline's own stored currency even if deactivated.
  3. Display currency = workspace `currency`, else system `default_currency`, else `USD`. Conversion = `amount / rate(from) * rate(to)` rounded to 2 decimals, using `currencies.exchange_rate` (relative to a base), rates cached 60 s; equal codes skip conversion; rate <= 0 or missing = treated as 1.0.
  4. Column total = sum of converted card amounts; weighted = `round(column_total_minor * probability / 100)`.
  5. The drawer header and `value_display` use the deal's OWN currency symbol, not the display currency (the card uses the display currency) — inconsistency when currencies are mixed. The inline drawer edit of `value` changes only the number, never the currency (the currency can only be set at create or via PATCH/API `currency`).
  6. Reports and the leaderboard sum raw `value_minor` across currencies with no conversion but label with the workspace symbol (QUIRK, see WD-DEAL-019).
  7. Currency symbol lookup: admin currencies table (cached 300 s); unknown code renders `CODE ` + amount.
- **Acceptance criteria:**
  - Given a 100.50 deal, Then `value_minor=10050` and card shows `100.50`.
  - Given a workspace on USD with a deal stored in EUR, Then the card, column total and KPIs show the USD-converted amount, and the drawer shows EUR.
  - Given value 100000000, Then validation fails (max 99,999,999).
- **Source refs:** DealsController.php:55-101, app/Models/Deal.php (getValueDisplayAttribute), app/Support/FormatSettings.php:123-137, app/Models/Currency.php:36-44.
- **Port notes:** store `value_minor bigint` + `currency char(3)` validated against a currency list; per-currency precision; do conversion in SQL or a service with a cached FX table; document that weighted value = minor * probability / 100 rounded half away from zero.

### WD-DEAL-007 — Drag-and-drop stage move (PATCH /deals/{deal}/stage)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-DEAL-003
- **Summary:** Dropping a card on another column optimistically moves it in the DOM, sends the new stage, and reverts on error.
- **Actors & access:** WD-DEAL-001 (no role gate).
- **UX & screens:** HTML5 drag events (`dragstart/dragend/dragover/dragleave/drop`), `dataTransfer.effectAllowed=move` and a `text/plain` payload (Firefox requirement); target column gets `dragover` class. Dropping on the same column is ignored. After a successful move a toast: "Deal marked Won" (success) when the stage is won, "Deal marked Lost" (info) when lost, else "Deal moved" (success). On failure the card returns to its source column and an error toast shows the server message (fallback "Could not move the deal."). Column counts are recomputed client-side; column VALUE totals, KPI strip and probability bars are NOT refreshed until reload (QUIRK: stale totals after a move). The card is appended at the end of the target column in the DOM (not at the drop position).
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| PATCH deals/{deal} (`{deal}` numeric)/stage | user.deals.stage | DealsController@updateStage | auth, plan | JSON `stage_id` required integer; `sort_order` nullable integer (UI never sends it) | 200 `{ok:true, status, stage:{id,name,is_won,is_lost}}`; 404 `{ok:false,message:"Deal not found."}`; 422 `{ok:false,message:"Invalid target stage."}`; 422 Laravel validation `{message,errors}` |

- **Data:** updates `deals.stage_id`, `deals.sort_order`, and via hook `status/won_at/lost_at/lost_reason` (WD-DEAL-008).
- **Rules & edge cases:**
  1. The destination stage must belong to the deal's pipeline AND the workspace; moving across pipelines is impossible.
  2. `sort_order` is written as the supplied integer or 0 (so any move resets order to 0).
  3. Moving to the same stage is accepted (no stage change recorded).
  4. No optimistic-concurrency check; last write wins.
  5. The response `status` is the deal's status after the hook.
- **Async & events:** WD-DEAL-008.
- **Acceptance criteria:**
  - Given a deal in New Lead, When it is dragged to Won, Then 200 with `status="won"`, `stage.is_won=true`, `won_at` set, a `stage_change` timeline row exists, and the toast says "Deal marked Won".
  - Given a stage id from another pipeline, Then 422 "Invalid target stage." and the card snaps back.
  - Given a network failure, Then the card is reverted and an error toast appears.
- **Source refs:** DealsController.php:207-240, resources/js/charts/user-deals-board.js:21-114.
- **Port notes:** PATCH `/deals/:id/stage` accepting `stageId` and `beforeDealId/afterDealId` (real ordering) is a recommended improvement; keep 422 semantic code for wrong-pipeline.

### WD-DEAL-008 — Stage-change engine (status/won_at/lost_at sync, timeline row, flow trigger, notifications)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-DEAL-007
- **Summary:** All writers (board, drawer, API, flows, AI, inbox, orders, Messenger) funnel through model hooks on `Deal` so status and timestamps never drift from the stage.
- **Rules & edge cases (saving hook, runs on create and update when `stage_id` is dirty):**
  1. Target stage `is_won`: `status='won'`; `won_at = existing won_at OR now`; `lost_at = null`. (`lost_reason` is NOT cleared.)
  2. Target stage `is_lost`: `status='lost'`; `lost_at = existing OR now`; `won_at = null`. `lost_reason` untouched.
  3. Otherwise (open stage): `status='open'`; `won_at=null`; `lost_at=null`; `lost_reason=null` (reopen clears the reason and both dates).
  4. If the stage id does not resolve, the hook returns without changes.
  5. A deal created directly in a won/lost stage becomes won/lost in the same insert; it then also notifies the owner of the outcome. An explicit `won_at`/`lost_at` passed in create attributes is kept (demo/seed).
  6. `updated` hook: if `stage_id` changed it (a) inserts a `deal_activities` row `type='stage_change'`, `user_id=auth id or null`, `meta={from_stage_id,to_stage_id}`, no body; failure only logs a warning; (b) calls `FlowEnrollmentService::onDealStageChanged` (WD-DEAL-027); failure only logs.
  7. QUIRK: stage-change timeline rows and the flow trigger are produced only on update, never on create, so the first placement of a deal is not logged and does not fire flows.
  8. Won/lost outcome and ownership change notifications: see WD-DEAL-018.
  9. There is no `closed_at`; the "closed date" is `won_at` or `lost_at` (timestamps), plus the user-editable `expected_close_date` (date, informational; not cleared on won/lost).
  10. Probability does not drive status; only the flags do. Reopen = move to any non-terminal stage. A deal can go won -> lost directly (won_at nulled, lost_at set).
  11. Cascade check: unlimited stages may be flagged won/lost; "Mark Won/Lost" uses the first flagged stage by `sort_order` (WD-DEAL-012). Moves via drag use the chosen stage.
- **Async & events:** synchronous model events; no queue. No Pusher/websocket broadcast, no outbound webhook, no audit-log row.
- **Acceptance criteria:**
  - Given an open deal, When moved to a won stage, Then `status=won`, `won_at` is set, `lost_at` null.
  - Given a lost deal with a reason, When moved to Qualified, Then `status=open`, `lost_at=null`, `lost_reason=null`.
  - Given a deal moved won -> lost, Then `won_at=null` and `lost_at` is set.
  - Given any stage move, Then exactly one `stage_change` activity with the from/to ids exists.
- **Source refs:** app/Models/Deal.php:44-117, app/Models/DealActivity.php.
- **Port notes:** implement as a domain service in one transaction (state machine) plus an outbox event `deal.stage_changed`; emit also on create; keep `lost_reason` cleared only when reopening.

### WD-DEAL-009 — Create deal (modal, POST /deals) and deal sources

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-DEAL-003
- **Summary:** The "New deal" modal posts a quick-create; the deal lands in the chosen stage (default first) of the selected pipeline.
- **Actors & access:** WD-DEAL-001.
- **UX & screens:** modal "New deal": Title (required, maxlength 191, placeholder "e.g. Acme Corp — annual plan"), Value (number min 0 step 0.01), Currency (active admin currencies, preselected pipeline currency), Stage (all stages of the pipeline incl. won/lost), Owner (default option "Me" + members), Expected close date (date). Buttons Cancel / "Create deal"; submit shows "…" and disables; on success toast "Deal created" and a full page reload; on failure the server message as an error toast and the button re-enabled. Backdrop click closes. No contact picker in this modal (link later in the drawer).
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| POST deals | user.deals.store | DealsController@store | auth, plan | `title` required string max191; `pipeline_id` required integer; `stage_id` nullable integer; `value` nullable numeric 0..99999999; `currency` nullable string max10; `owner_user_id` nullable integer; `contact_id` nullable integer; `expected_close_date` nullable date | 200 `{ok:true,message:"Deal created.",deal_id}`; 404 `{ok:false,message:"Pipeline not found."}`; 422 `{ok:false,message:"This pipeline has no stages."}`; Laravel validation 422 |

- **Data:** inserts `deals` (`source='manual'`, `sort_order=0`, `status` via hook).
- **Rules & edge cases:**
  1. The pipeline must belong to the workspace (404 otherwise). `stage_id` must belong to that pipeline, otherwise it silently falls back to the first stage (by `sort_order`); no stages -> 422.
  2. `contact_id` that is not in the workspace is silently dropped (null).
  3. `owner_user_id`: absent/0 -> the creating user. QUIRK: any integer is accepted, with no check that the user is a workspace member (or exists).
  4. `value` blank -> 0. `title` stored as given (not trimmed beyond validation).
  5. Currency default is the pipeline currency (not the workspace display currency).
  6. Source vocabulary in `Deal::SOURCES`: `manual, inbox, order, shopify, woo, form, api, flow, facebook`. Writers: `manual` (board), `api` (REST API and AI copilot), `inbox` (conversation button), `order` (auto from order), `flow` (flow node), `facebook` (Messenger lead). QUIRK: `shopify`, `woo`, `form` have no writer in the code base (they exist in the filter list and pills only); `demo` seeds use them.
  7. Creating a deal for another owner triggers a "Deal assigned to you" notification (WD-DEAL-018). Self-created deals are silent.
  8. Deal title uniqueness: none.
  9. No plan quota on deal count.
- **Async & events:** `created` hook: owner notification, outcome notification if created in won/lost stage; no timeline row, no flow trigger.
- **Acceptance criteria:**
  - Given pipeline 1 with stages, When POST `{title:"A", pipeline_id:1}`, Then 200, deal in the first stage, `owner_user_id` = actor, `source=manual`.
  - Given `stage_id` from another pipeline, Then the deal lands in the first stage (no error).
  - Given no title, Then 422 validation error on `title`.
  - Given `owner_user_id` of another member, Then that member gets a "Deal assigned to you" notification.
- **Source refs:** DealsController.php:148-205, views/user/deals/index.blade.php:184-237, user-deals-board.js:148-187.
- **Port notes:** validate owner membership (stricter than WaDesk), return 422 for a bad stage instead of silent fallback (record as intentional difference), keep `source` as an enum with `manual,inbox,order,api,flow,facebook,shopify,woo,form`.

### WD-DEAL-010 — Deal detail slide-over (GET /deals/{deal})

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-DEAL-003
- **Summary:** Clicking a card opens a right-hand panel populated from one JSON call: editable fields, customer card, Mark Won/Lost, activity timeline.
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| GET deals/{deal} | user.deals.show | DealsController@show | auth, plan | path `deal` numeric | 200 `{ok:true, deal:{id,title,value(float major),value_display,currency,status,conversation_id,stage_id,stage_name,owner_user_id,owner_name,source,lost_reason,expected_close_date(Y-m-d),created_at(day-date-time string),contact:{id,name,phone,wa_phone}|null}, stages:[{id,name,is_won,is_lost}], members:[{id,name}], activities:[{id,type,body,label,user_name,due_at,done,created_at}]}`; 404 `{ok:false,message:"Deal not found."}` |

- **UX & screens (rendered client-side in `renderPanel`):**
  - Header: editable title input ("Deal name"), delete (trash) and close buttons, amount (`value_display`, deal's own currency), status badge (OPEN/WON/LOST uppercased), stage name, eyebrow "Deal · via {source}".
  - Customer section: if a contact is linked: initials circle, name, phone, a green "Message" link `https://wa.me/{wa_phone}` (new tab) and a ghost link "Open in inbox" (`/team-inbox?c={conversation_id}`) when the deal has a conversation, else "Open chat" (`/chat?to={wa_phone}`). If no contact: dashed box "No contact linked yet — search to connect this deal to a person." with a search input (WD-DEAL-014).
  - Deal details: Value (number), Stage (select of the deal's pipeline stages), Owner (select: "Unassigned" + members), Expected close (date). "Mark Won" / "Mark Lost" buttons. "Lost reason: ..." line when set. (Currency and title also editable only by title input.)
  - Activity: type select (Note, Task, Call log), due date input shown only for Task, textarea "Add a note, log a call, or create a task…", "Add to timeline"; timeline below, newest first; empty text "No activity yet — add a note, log a call, or set a task above."
  - Loading state "Loading…"; error state shows the server message or "Failed to load".
  - Closing the panel reloads the page if anything was changed (`boardDirty`). Backdrop click closes. No Escape key handler.
- **Rules & edge cases:**
  1. Activities are loaded unbounded (`activities()` is `latest()` by created_at). Body is decrypted from the encrypted column.
  2. `label` is set only for `stage_change` rows: "{from name} → {to name}" with `?` for missing/renamed stages.
  3. `user_name` falls back to "System" (null/deleted user: flow/API/auto writers).
  4. `created_at` of the deal is a server-formatted `toDayDateTimeString()` (not ISO) and activity `created_at` is a localized relative string; `due_at` is day-date-time string; port should send ISO and format on the client.
  5. `phone` and `wa_phone`: both are the canonical phone digits (`mask_phone` is a no-op in WaDesk: masking is disabled product-wide although comments claim masking); `wa_phone` is used for the wa.me link.
  6. `members` = workspace members (id, name) via the `workspace_user` pivot.
  7. Panel is not pipeline-restricted: `?deal=ID` of a deal in another pipeline still opens.
  8. Message type `message` activities cannot be added from the UI (only API/endpoint accepts it).
- **Acceptance criteria:**
  - Given a deal with a contact and conversation, When opened, Then "Open in inbox" links to `/team-inbox?c=<conversation_id>`.
  - Given a deal id of another workspace, Then 404 "Deal not found.".
  - Given a deal with a stage_change from stage A to a stage deleted from the DB, Then the label shows `A → ?`.
- **Source refs:** DealsController.php:310-330,500-550, user-deals-board.js:214-370.
- **Port notes:** drawer should be a route (`/deals/[id]`) as a parallel route, deep-linkable; send ISO timestamps.

### WD-DEAL-011 — Edit deal fields inline (PATCH /deals/{deal})

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-DEAL-010
- **Summary:** Each field in the drawer saves on `change` with its own PATCH call; the board card is live-patched.
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| PATCH deals/{deal} | user.deals.update | DealsController@update | auth, plan | all optional (`sometimes`): `title` required string max191; `value` nullable numeric 0..99999999; `currency` nullable string max10; `owner_user_id` nullable integer; `stage_id` nullable integer; `contact_id` nullable integer; `expected_close_date` nullable date | 200 `{ok:true, deal:<serialized, see WD-DEAL-010>}`; 404 `{ok:false,message:"Deal not found."}`; 422 validation |

- **Rules & edge cases:**
  1. `value` null/"" -> stored 0. `currency` empty is ignored (kept). `expected_close_date` null clears it.
  2. `owner_user_id` falsy -> owner becomes null (Unassigned); no membership check (QUIRK). Changing owner notifies the new owner when different from the actor.
  3. `contact_id` falsy -> unlink; a contact outside the workspace -> unlink (null) silently.
  4. `stage_id`: if the stage belongs to the deal's pipeline it is applied (and WD-DEAL-008 runs); an invalid/foreign stage is silently ignored and still returns 200 (QUIRK; the REST API returns 422 for the same input). Empty stage_id is ignored.
  5. The drawer re-renders (full reload of the panel via GET) after `stage_id` or `value` edits so header/badge match; the board card title/amount/column are patched live; closing the panel reloads the page.
  6. The drawer sends the raw `<input>` string for `value` and `expected_close_date`; `title` blank fails validation (422) and shows the error toast; no inline field-level error UI.
  7. No `If-Match`/version; concurrent edits overwrite per field.
  8. Cannot edit `lost_reason`, `notes`, `company_id`, `source`, `meta`, `conversation_id`, `owner_team_id` from the web UI.
- **Acceptance criteria:**
  - Given a deal, When Value is changed to 250.5, Then `value_minor=25050`, toast "Saved", the card amount updates and the drawer re-renders.
  - Given Owner set to Unassigned, Then `owner_user_id` is null and the card avatar uses the contact name.
  - Given `stage_id` of a foreign pipeline, Then 200 but the stage is unchanged.
- **Source refs:** DealsController.php:332-373, user-deals-board.js:372-392.
- **Port notes:** PATCH with a partial DTO; return 422 for foreign stage (document as improvement); add optimistic concurrency via `updatedAt`.

### WD-DEAL-012 — Mark Won / Mark Lost with optional lost reason

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-DEAL-008
- **Summary:** One-click outcome buttons in the drawer move the deal to the pipeline's first won/lost stage.
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| POST deals/{deal}/won | user.deals.won | DealsController@markWon | auth, plan | none | 200 `{ok:true,status,stage:{id,name}}`; 404 "Deal not found."; 422 `{ok:false,message:"This pipeline has no Won stage."}` |
| POST deals/{deal}/lost | user.deals.lost | DealsController@markLost | auth, plan | optional `reason` string (trimmed, cut to 191 chars) | same; 422 "This pipeline has no Lost stage." |

- **Rules & edge cases:**
  1. Stage chosen = the lowest `sort_order` stage with the matching flag in the deal's pipeline.
  2. For lost, a non-empty `reason` overwrites `lost_reason`; an empty reason leaves any previous reason in place. The reason is set BEFORE the stage change so notifications include it ("title · value — reason").
  3. QUIRK: the drawer's "Mark Lost" button posts `{}`: the web UI never collects a reason (no prompt, no picklist), so `lost_reason` can only be set via this endpoint's `reason`, the REST API `lost_reason`, or seed data. The reason is displayed read-only in the drawer.
  4. No confirm dialog for Won/Lost. Marking an already won deal won again is a no-op (no timeline row), but still returns 200.
  5. Notifications: owner notified unless the owner is the actor (WD-DEAL-018).
- **Acceptance criteria:**
  - Given an open deal, When POST /won, Then status becomes won and `won_at` set; POST /lost with `reason:"Budget"` sets `lost_reason="Budget"` and `status=lost`.
  - Given a pipeline with no lost stage, Then 422 "This pipeline has no Lost stage.".
  - Given a reason of 300 characters, Then it is stored truncated to 191.
- **Source refs:** DealsController.php:429-459, user-deals-board.js:412-421.
- **Port notes:** add a lost-reason picker (see WD-DEAL-043) in the drawer and a required-reason workspace setting (extension).

### WD-DEAL-013 — Delete deal

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-010
- **Summary:** Hard delete from the drawer (trash icon) after a browser `confirm("Delete this deal? This cannot be undone.")`.
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| DELETE deals/{deal} | user.deals.destroy | DealsController@destroy | auth, plan | none | 200 `{ok:true}`; 404 "Deal not found." |

- **Rules & edge cases:** deletes the deal's `deal_activities` rows then the deal (no transaction, no soft delete, no audit log, no notification, no flow trigger). References that remain dangling (no FKs): `tasks.related_id` (type deal), `projects.deal_id`, `payments.deal_id`, `sales_docs.deal_id`, invoice meta `deal_id`, `crm_briefs.subject_id`, inbox notification links `/deals?deal=ID`. Toast "Deal deleted"; panel closes and the page reloads.
- **Acceptance criteria:** Given a deal with 5 activities, When deleted, Then the deal and its 5 activities are gone and a second DELETE returns 404.
- **Source refs:** DealsController.php:375-385, user-deals-board.js:449-453.
- **Port notes:** soft-delete + audit row + outbox event; null out referencing FKs (`ON DELETE SET NULL`).

### WD-DEAL-014 — Link a contact to a deal (picker + search endpoint)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-CON-*
- **Summary:** A deal with no contact shows a search box; choosing a result PATCHes `contact_id`.
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| GET deals/contacts/search | user.deals.contacts.search | DealsController@contactsSearch | auth, plan | query `q` | 200 `{ok:true,data:[{id,name,phone}]}` max 15 |

- **Rules & edge cases:**
  1. Matches `contacts.name LIKE %q%` or `contacts.mobile LIKE %q%` with `%`/`_` escaped; NOT first_name/last_name/email/company. Empty `q` returns the 15 newest contacts. Ordered `id` desc.
  2. `name` = contact name, else "first last", else the phone. `phone` = canonical digits (`country_code`+`mobile`, formatting by `Contact::canonicalizePhone`); `mask_phone` is a no-op.
  3. Typing is debounced 250 ms; results are a plain list of buttons "name · phone"; no empty-result text; no "create contact" shortcut.
  4. Only an unlinked deal shows the picker; there is NO way to change or remove a linked contact from the UI (the PATCH API supports `contact_id` null).
  5. The picked contact is revalidated server-side against the workspace.
  6. The panel re-renders after linking, and the board reloads on close.
- **Acceptance criteria:**
  - Given contacts "Ana" (mobile 5551) and "Bob", When searching `5551`, Then only Ana returns with her phone.
  - Given `contact_id` of another workspace in PATCH, Then the link is dropped (null).
- **Source refs:** DealsController.php:461-485, user-deals-board.js:394-448.
- **Port notes:** use the contacts search service; allow unlink/relink (improvement). Contact deletion in WaDesk does not unlink or delete deals (dangling `contact_id`, relation `withDefault` hides it).

### WD-DEAL-015 — Activity timeline: notes, calls, messages, tasks

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-DEAL-010
- **Summary:** Free-text entries on a deal: note, call log, message log, task (with due date). System entries (`stage_change`) are written by the stage hook.
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| POST deals/{deal}/activity | user.deals.activity | DealsController@addActivity | auth, plan | `type` required in `note,call,message,task`; `body` required string max 5000; `due_at` nullable date | 200 `{ok:true,activity:{id,type,body,label,user_name,due_at,done,created_at}}`; 404 "Deal not found."; 422 validation |

- **Data:** `deal_activities` (`deal_id, workspace_id, user_id, type, body (encrypted at rest), meta, due_at, done_at, reminded_at`). Types allowed in the model: `note, stage_change, call, message, task`.
- **Rules & edge cases:**
  1. `due_at` is stored only for `type=task`; other types ignore it. The web UI posts a date (YYYY-MM-DD) so it is saved as midnight in the app timezone (a task is due at 00:00 of that day for reminder purposes).
  2. `user_id` = the actor. `body` is encrypted with the app key via the encrypted cast (text column).
  3. The UI offers Note, Task, Call log; `message` is accepted only by the endpoint.
  4. Blank body (after trim) is blocked client-side silently (no toast); the server requires non-empty.
  5. New entries are inserted at the top of the timeline without a reload. Order: `created_at` desc (ties unspecified).
  6. There is no edit, delete, pin or attachment for activities; no activity is written for create, owner change, value change, contact link or won/lost beyond the stage_change row.
  7. Timeline row: body text (or the `from → to` label for stage_change; fallback "Stage changed"), `user_name · created_at-relative`, `· due {date}` for tasks, "Mark done"/"Done" link for tasks.
- **Acceptance criteria:**
  - Given a deal, When adding type=task body="Call back" due=2026-11-01, Then the row has `due_at=2026-11-01 00:00`, `done=false` and "Mark done".
  - Given type=note with due_at, Then due_at is discarded.
  - Given type=email, Then 422.
- **Source refs:** DealsController.php:387-411, app/Models/DealActivity.php.
- **Port notes:** encrypt `body` (column encryption or app-level). Consider `activity` enum plus a `payload` jsonb for stage changes.

### WD-DEAL-016 — Task done / reopen toggle

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-015
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| POST deals/{deal}/task/{activity}/done | user.deals.task.done | DealsController@completeTask | auth, plan | none (both ids numeric) | 200 `{ok:true,done:bool}`; 404 "Deal not found." / "Task not found." |

- **Rules & edge cases:** toggles `done_at` between now and null (it is a toggle, not "complete"); only `type=task` activities of that deal are matched; `reminded_at` is NOT reset on reopen (so a reopened overdue task is never reminded again). The link text flips between "Mark done" and "Done" with color classes; no strike-through; no timestamp shown for completion. No "my tasks" view for deal tasks exists (the first-class `/tasks` feature is a separate table `tasks`).
- **Acceptance criteria:** Given an open task, When toggled twice, Then responses are `done:true` then `done:false`; a stage_change id returns 404 "Task not found.".
- **Source refs:** DealsController.php:413-427, user-deals-board.js:435-443.

### WD-DEAL-017 — Overdue deal-task reminder sweep

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-DEAL-015, notifications domain
- **Summary:** Overdue open tasks notify the deal owner once.
- **Rules & edge cases:**
  1. Candidates: `deal_activities` with `type='task'`, `done_at IS NULL`, `reminded_at IS NULL`, `due_at IS NOT NULL AND due_at <= now`, ordered by `due_at`, limited (`100` for the inbox poll per workspace, `500` for heartbeat/command).
  2. Notification `deal_task_due` goes to the deal owner, fallback the task's author; skipped if neither; title "Deal task due", body "{deal title} — {first 120 chars of task body}", link `/deals?deal={id}`; dedupe key `deal_task_due:{activity_id}`.
  3. `reminded_at` is stamped for every processed task, even when the deal no longer exists (orphan tasks stop re-appearing).
  4. Triggers (no scheduler dependency): (a) Team inbox queue poll, cache-gated once per 60 s per workspace, deferred after response; (b) the global heartbeat in WaConnectController, lock `deal-reminder-sweep-lock` 120 s, all workspaces, limit 500; (c) artisan `deals:remind-tasks {--limit=500}` for cron hosts. All idempotent via `reminded_at`.
  5. Individual task failures are logged and the sweep continues. Date-only due times mean reminders fire at the start of the due day.
  6. No snooze, no repeated reminder, no overdue badge on the board/drawer.
- **Acceptance criteria:**
  - Given a task due yesterday with no reminder, When the sweep runs, Then one `deal_task_due` notification is created for the owner and `reminded_at` is set; running again creates none.
  - Given a completed task, Then it is never reminded.
- **Source refs:** app/Services/Deals/DealReminderService.php, app/Console/Commands/DealsRemindTasksCommand.php, TeamInboxController.php:699-707, WaConnectController.php:803-815.
- **Port notes:** BullMQ repeatable job per minute (`worker-job` skill), idempotent on `reminded_at`; use due datetime (not date) so reminders follow the tenant timezone.

### WD-DEAL-018 — Owner notifications (assigned, won, lost, task due)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-DEAL-008, notifications/inbox domain
- **Summary:** In-app feed rows (+ optional web push) keep owners informed.
- **Rules & edge cases:**
  1. `deal_assigned` ("Deal assigned to you", body "{title} · {value_display}"): on create when `owner_user_id>0` and owner != actor; on update when the owner changed and new owner != actor. Never when the owner is null.
  2. `deal_won`/`deal_lost` ("Deal won"/"Deal lost", body "{title} · {value_display}" plus " — {lost_reason}" for lost): on status change to won/lost (update) or creation in a won/lost stage; skipped when the actor is the owner or the owner is null/0. A flow/API/order writer has `auth()->id()` null (or the key owner for the API), so owners are notified.
  3. All notifications: row in `inbox_notifications` (`type` in `deal_assigned, deal_won, deal_lost, deal_task_due`; `data` {deal_id,...}; `link` `/deals?deal={id}`; body stripped of tags, cut at 200); a 30-second dedupe cache key per (type, deal, owner); optional VAPID web push when system setting `ti_pwa_enabled` is true (title cut 100, body 180).
  4. Failure of a notification never blocks the save.
  5. No email, no WhatsApp, no Slack/Trello for deal events. Creator/mentions/watchers do not exist.
- **Acceptance criteria:**
  - Given user A drags B's deal to Won, Then B gets one "Deal won" notification linking to `/deals?deal=<id>`; given B drags it, Then none.
  - Given A assigns a deal to B twice within 30 s, Then B gets one notification.
- **Source refs:** app/Models/Deal.php:90-117, app/Services/Inbox/NotificationDispatcher.php:106-170,253-287.
- **Port notes:** emit through the outbox to the notification module; keep the same four types and the dedupe window.

### WD-DEAL-019 — Reports page metrics and leaderboard

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-DEAL-008
- **Summary:** `/deals/reports` is a read-only analytics page.
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| GET deals/reports | user.deals.reports | DealsController@reports | auth, plan | none (no filters, no date range) | HTML view with embedded JSON `{byStage[], months[], symbol}` |

- **Metrics and formulas (workspace-wide, ALL pipelines, no currency conversion, display symbol = workspace currency):**
  1. `byStage[]` (over every stage of every pipeline of the workspace, ordered by `sort_order` only): `name, color, value = sum(value_minor of OPEN deals in that stage)/100, count = count of open deals, weighted = round(sum_minor * probability / 100)/100`. Won/Lost stages therefore have 0.
  2. `won`, `lost` = all-time counts of `status='won'` / `'lost'`; `winRate = round(won/(won+lost)*100)`, 0 if none.
  3. `openValue` = sum of open `value_minor` (raw, mixed currencies) formatted; `forecast` = sum of per-stage weighted (open only; so it differs from the board forecast); `wonValue` = sum of ALL-TIME won value.
  4. `months[]` = last 6 calendar months including the current one (oldest first), label = short month name (`M`, e.g. "Oct", no year); `won` = count with `won_at` in `[month start, month end]`, `lost` likewise on `lost_at`. App timezone.
  5. `leaders[]` = won deals grouped by `owner_user_id` (non-null), `won` count, value = SUM(value_minor)/100, ordered by value desc, top 10; name from `users` (N+1) else "Unknown".
- **UX & screens:** `resources/views/user/deals/reports.blade.php`: hero "N% of your closed deals were won." with sub-line "{openDeals} open deals · {openValue} in play · {forecast} weighted forecast." or, when nothing exists, "No deals yet — create a few on the board and this dashboard fills in."; "Back to board"; dark hero card (Open pipeline value, win rate chip, open deals/forecast/"won (mo)"); six stat cards: Weighted forecast "by probability", "Won · this month" (shows the ALL-TIME won value with sub "{won} all-time won"), Win rate "{won}/{closed} closed", Open deals "in pipeline", Lost "closed lost", Open value "total in play"; chart row; leaderboard card "N agents" with rows (initials, name, "{n} won", value rounded to integer, "won value"), empty "No won deals yet — close a few and they show up here.".
- **Rules & edge cases:** QUIRKS: (a) labels "Won · this month"/"won (mo)" show all-time value; (b) values from mixed currencies are summed raw and shown with one symbol, unlike the board; (c) reports ignore the board's pipeline selection and filters; with multiple pipelines stage names repeat; (d) the page seeds a default pipeline as a side effect; (e) leaderboard ignores date range; (f) no export, no CSV, no date picker, no per-agent open pipeline, no funnel/conversion/avg-cycle metrics.
- **Acceptance criteria:**
  - Given stages with open deals totalling 300 in "Qualified" (p=25), Then byStage Qualified `value=300`, `weighted=75`.
  - Given won deals 3 and lost 1, Then win rate 75%.
  - Given a won deal dated 7 months ago, Then it counts in `won` and the leaderboard but not in `months`.
- **Source refs:** DealsController.php:242-308, views/user/deals/reports.blade.php.
- **Port notes:** add `from/to/pipelineId` query params, convert currency per deal, fix the "this month" labels; compute with grouped SQL in the tenant timezone.

### WD-DEAL-020 — Reports charts (value by stage, won vs lost 6 months)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-019
- **Summary:** ApexCharts render from `<script type="application/json" id="dl-report-data">`.
- **Rules & edge cases:** Chart 1 "Pipeline value by stage" (card tag "Distribution"): bar, height 280, distributed colors = stage color, one bar per stage incl. empty won/lost, values rounded to integers, axis/tooltip prefix = currency symbol, no data labels, no legend. Chart 2 "Won vs lost" (tag "Momentum", chip "6 mo"): grouped bars, series Won `#16A34A`, Lost `#DC2626`, legend top-right, x = month labels. Both use theme colors for grid. No empty-state for the charts (they render empty axes). Chart errors: bad JSON aborts silently.
- **Acceptance criteria:** Given 6 months of data, Then the trend chart has 6 categories ordered oldest to newest; the stage chart has one bar per stage with the stage color.
- **Source refs:** resources/js/charts/user-deals-reports.js, views/user/deals/reports.blade.php:94-115.
- **Port notes:** Recharts/ECharts with the same series; rounding to whole currency units hides cents (keep or improve).

### WD-DEAL-021 — Workspace deal settings: auto-deal from orders

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-DEAL-022
- **Summary:** The gear opens a modal "Pipeline settings": checkbox "Auto-create a deal from new orders" and "Only for orders above (blank = any value)".
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| POST deals/settings | user.deals.settings | DealsController@saveSettings | auth, plan | `auto_from_orders` nullable boolean; `min_value` nullable numeric 0..99999999 | 200 `{ok:true,message:"Settings saved."}`; 422 `{ok:false,message:"No active workspace."}`; validation 422 |

- **Rules & edge cases:** sets `workspaces.deals_auto_from_orders = bool(auto_from_orders, default false)` and `workspaces.deals_auto_min_minor = round(min_value*100)` or null when blank. Missing `auto_from_orders` always switches the feature OFF. The modal is prefilled from the workspace (min shown in major units). Toast "Settings saved". No role gate (any member can change it). Closing the modal needs no reload. These are the ONLY pipeline settings in the product: no stage editor, no currency picker, no lost-reason list, no default-owner or round-robin rule.
- **Acceptance criteria:** Given auto on and min 50, Then `deals_auto_from_orders=1`, `deals_auto_min_minor=5000`; given blank min, Then null; given an unchecked box, Then off.
- **Source refs:** DealsController.php:128-146, views/user/deals/index.blade.php:239-262, user-deals-board.js:189-212, app/Models/Workspace.php:25-26,70-71.
- **Port notes:** a `workspace_settings.deals` jsonb (or two columns) gated by `deals.settings` permission.

### WD-DEAL-022 — Auto-create a deal from a new order

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** commerce/orders domain, WD-DEAL-021
- **Summary:** When a `wa_orders` row is created and the workspace opted in, a deal is created in the default pipeline's first stage.
- **Rules & edge cases:**
  1. Hook: `WaOrder::created`, deferred to after the HTTP response (`app()->terminating`), calls `OrderDealService::maybeCreateFromOrder` and `FlowEnrollmentService::onOrderPlaced`. Errors are logged only.
  2. No-ops unless `deals_auto_from_orders`; skips when `order.total_minor < deals_auto_min_minor` (compared as raw minor units regardless of currency).
  3. Idempotent: one deal per order (`source='order'` and JSON `meta->order_id` match).
  4. Pipeline: `ensureDefaultForWorkspace(ws, order currency or null)` (see WD-DEAL-002 heal quirk). Stage: first by `sort_order`. NOTE: it does not check the `access_sales_pipeline` plan flag.
  5. Deal: title `"{customer_name or 'Order'} — #{order id}"` cut to 191, `value_minor = order.total_minor`, `currency = order.currency_code or pipeline currency`, `source='order'`, `meta={order_id}`, owner null (so no assignment notification, no outcome notification), contact resolved by comparing the order's customer phone digits to each workspace contact's canonical phone (loads all workspace contacts into memory), null if none.
  6. Status changes of the order do NOT move the local deal (docs claim "paid/shipped close it won", but that applies to the HubSpot sync only; see Open questions).
  7. HubSpot sync (`HubspotSyncService`) pushes orders as HubSpot deals; those are NOT local `deals` rows.
- **Acceptance criteria:**
  - Given auto on, min 100.00 and an order total 5000 minor, Then no deal; given 12000, Then one deal "Ana — #42" in the first stage with source `order` and the same order never creates a second.
  - Given auto off, Then no deal is created.
- **Source refs:** app/Services/Deals/OrderDealService.php, app/Models/WaOrder.php:86-99.
- **Port notes:** subscribe to an `order.created` outbox event in a worker; add the plan check; resolve contact by indexed normalized phone column.

### WD-DEAL-023 — Stage list JSON (flow builder + inbox picker)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-002
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| GET deals/stages | user.deals.stages | DealsController@stagesJson | auth, plan | none | 200 `{ok:true,data:[{id,name}]}` stages of the DEFAULT pipeline ordered by `sort_order` |

- **Rules & edge cases:** seeds the default pipeline if missing; only the default pipeline (other pipelines unreachable from the flow builder and the inbox mini-form, QUIRK for multi-pipeline); no probability/won flags in the payload; used by the flow builder (trigger node "stage that triggers the flow", deal node "Pipeline stage") and the inbox create-deal modal.
- **Acceptance criteria:** Given a default pipeline with six stages, Then `data` has six items in order; the first call on an empty workspace seeds them.
- **Source refs:** DealsController.php:487-496, resources/js/charts/user-flows-builder.js:249,1560,3095, user-team-inbox-index.js:3411-3418.

### WD-DEAL-024 — Deep link /deals?deal=ID opens the drawer

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Summary:** On load, if `?deal=<digits>` is present the drawer opens for that deal. Used by notification links, the inbox deals panel (`url`) and calendar entries link to `/deals` only. Invalid or foreign ids show the error text in the panel ("Deal not found."). No change of the selected pipeline.
- **Acceptance criteria:** Given `/deals?deal=12`, Then the drawer shows deal 12 without clicking; given `?deal=abc`, Then nothing opens.
- **Source refs:** user-deals-board.js:27-33, NotificationDispatcher.php:124, TeamInboxController.php:2250.

### WD-DEAL-025 — Inbox: create deal from a conversation

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** inbox domain, WD-DEAL-002
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| POST team-inbox/api/conversations/{id}/create-deal | team-inbox.create-deal (name per group) | TeamInboxController@createDeal | auth (+ inbox group) | `title` nullable string max191; `value` nullable numeric 0..99999999; `stage_id` nullable integer | 200 `{ok:true,deal_id,url:"/deals",message:"Deal created in {pipeline name}."}`; 422 `{ok:false,message:"Sales Pipeline is not enabled on your plan."}` or `"Your pipeline has no stages yet."` |

- **Rules & edge cases:** plan check is in code (not the middleware). Pipeline = the default pipeline; stage = requested stage found in that pipeline (else first). Contact resolved by comparing the contact `mobile` digits to the conversation `raw_jid`/`alt_jid` (note: `mobile` without country code vs full jid digits). Title default = contact name or `Deal — {phone}`. Deal: `conversation_id`, `contact_id`, `currency = pipeline currency`, `owner_user_id = actor`, `source='inbox'`, `sort_order=0`. Writes a `conversation_events` note "Deal created: {title} (#id)". UI: header button "Create deal" opens a mini modal (Deal name prefilled with contact/thread name, Value, Stage select from `/deals/stages`).
- **Acceptance criteria:** Given a conversation with a matching contact, When creating "Acme", Then a deal exists with the conversation and contact ids, owner = actor, source inbox, and the thread shows a note event.
- **Source refs:** TeamInboxController.php:2066-2139, user-team-inbox-index.js:3353-3470.

### WD-DEAL-026 — Inbox: deals panel for a conversation/contact

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| GET team-inbox/api/conversations/{id}/deals | team-inbox.deals | TeamInboxController@conversationDeals | auth (+ inbox group) | none | 200 `{ok:true,enabled:bool,deals:[{id,title,value_display,status,stage_name,owner_name,url}]}`; when the plan lacks the feature `{ok:true,enabled:false,deals:[]}` (panel hidden) |

- **Rules & edge cases:** deals where `conversation_id = conv` OR `contact_id = matched contact`; open first, then id desc; limit 12; section shows the count and "No deals yet. Create one"; each row links to `/deals?deal=ID`.
- **Acceptance criteria:** Given an order-sourced deal tied only to the contact, Then it appears in the panel of that contact's conversation; with the plan off the panel is hidden.
- **Source refs:** TeamInboxController.php:2141-2193, user-team-inbox-index.js:3356-3409.

### WD-DEAL-027 — Flow trigger: deal_stage_changed

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** flows domain, WD-DEAL-008
- **Summary:** A flow whose trigger node kind is `deal_stage_changed` with `stageId` runs for a deal's linked contact whenever a deal moves INTO that stage.
- **Rules & edge cases:**
  1. Flow stored with `trigger_kind='deal_stage_changed'`, `trigger_value = stage id` (builder field "Stage that triggers the flow"; picker loaded from `GET /deals/stages` => default pipeline only).
  2. On a stage update (not create), if the deal has a linked contact, every flow in the same workspace with `is_active` and `is_published`, matching kind and value, enrolls the contact via `FlowEnrollmentService::enroll` (workspace-membership check; a `flow_subscribers` row UNIQUE on (flow_id, contact_id); launches only when newly created or previously `failed`).
  3. QUIRK: because enrollment is unique per (flow, contact), a contact enters a given stage-flow ONCE ever; later deals/moves into that stage for the same contact do not re-run it. Deals without a contact do nothing. Not suppressed when the workspace has the Meta Business Agent in front (launch is suppressed but the subscriber row is created).
  4. Errors are swallowed and logged.
- **Acceptance criteria:** Given a published flow on stage "Won" and a deal with a contact, When the deal moves to Won, Then the contact becomes a subscriber and the flow starts; moving a second deal of the same contact to Won does not start it again.
- **Source refs:** app/Models/Deal.php:80-88, app/Services/Flow/FlowEnrollmentService.php:187-199,34-62,313-323, app/Http/Controllers/FlowsController.php:2554, app/Models/Flow.php:374-375.

### WD-DEAL-028 — Flow node: create / move deal (POST /api/flow-node/deal-action)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** flows domain
- **Summary:** A "Deal" flow node (Node bridge executor `executeDealNode`) calls Laravel to create a deal or re-stage the contact's open deal.
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| POST api/flow-node/deal-action | api.flow-node.deal-action | FlowNodeActionsController@dealAction | header `X-Node-Token` (shared token compared with hash_equals); CSRF-exempt | `workspace_id` required int; `action` required in `create,move`; `stage_id` required int; `deal_name` nullable string max191; `value` nullable numeric 0..99999999; `owner_user_id` nullable int; `contact_phone` nullable string max32; `deal_id` nullable int | 200 `{ok:true,deal_id,status,created:bool}`; 401 `{ok:false,error:"unauthorized"}`; 404 `{ok:false,error:"workspace_not_found"}`; 422 `{ok:false,error:"plan_not_allowed",message:"Sales Pipeline is not enabled on this workspace plan."}` or `{ok:false,error:"stage_not_found"}`; 500 `{ok:false,error:"deal_failed",message}` |

- **Rules & edge cases:** stage must belong to the workspace; its pipeline is the target pipeline (so non-default pipelines work here). `move`: explicit `deal_id` wins, else the contact's most recent OPEN deal (any pipeline) in the workspace; if none found it CREATES a deal (flow never dead-ends; response `created:true`). `create`: title = `deal_name` or "New deal" (cut 191), `value_minor`, `currency = pipeline currency`, `owner_user_id` (unvalidated) else null, `contact_id` resolved by phone digits, `source='flow'`, `sort_order=0`. Moves run the full stage engine (WD-DEAL-008) so flows can chain. Node executor: default name `{{contact_name}} — deal`, value digits/dot only after variable substitution, saves the deal id into variable `saveAs` (default `deal_id`), routes via port 1 (created) on success and port 2 (error) on any failure; the node's `ownerId` is forwarded as `owner_user_id`. Builder UI fields: Action (create / move), Pipeline stage (required), Deal name, Deal value, Save-as variable; the test panel logs "[CRM] ..." and skips the call.
- **Acceptance criteria:** Given action=move and a contact with an open deal, Then that deal is re-staged and `created=false`; given no open deal, Then a new deal is created and `created=true`; given a bad token, Then 401.
- **Source refs:** app/Http/Controllers/FlowNodeActionsController.php:1348-1457, node/services/flowService.js:5391-5445, app/Services/Flows/FlowNormalizer.php:86-120,787-797, resources/js/charts/user-flows-builder.js:3095-3118.

### WD-DEAL-029 — Messenger lead node creates a deal

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** channels (facebook) domain
- **Summary:** The Messenger `fb_lead` node optionally (default on, `createDeal !== false`) creates a deal after capturing a lead.
- **Rules & edge cases:** requires `access_sales_pipeline` on the plan (else logged and skipped); default pipeline, first stage by `sort_order, id`; deal: contact = the captured contact, title "{name or 'Facebook lead'} — Messenger" (cut 191), value 0, currency = pipeline currency, `owner_user_id` = the Facebook page's `user_id` (or null), `source='facebook'`. Failures are logged and never block the lead capture.
- **Acceptance criteria:** Given plan on, When an fb_lead node fires with a name, Then a deal "Ana — Messenger" exists in the first stage with source facebook.
- **Source refs:** app/Http/Controllers/Facebook/FacebookFlowNodeController.php:455-505.

### WD-DEAL-030 — REST API: list deals

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-035
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| GET api/v1/deals | api.v1.deals.index | Api\V1\DealController@index | api, auth.apikey, auth.apikey.throttle | query `page` (Laravel paginator), `per_page` int clamped 1..100 default 25, `pipeline_id`, `stage_id`, `status` (any string, not validated) | 200 `{data:[Deal...], meta:{page,per_page,total,last_page}}`; 403 `plan_feature_disabled` |

- **Rules:** ordered by `id` desc; workspace-scoped from the key; no search, no owner/contact/date filter, no sort option, no expand. Deal item shape in WD-DEAL-031. `meta` is a page-number scheme (no cursor, no links).
- **Acceptance criteria:** Given 30 deals, When `per_page=10&page=3`, Then `data` has 10 items, `meta={page:3,per_page:10,total:30,last_page:3}`; `per_page=500` is clamped to 100; `status=won` filters.
- **Source refs:** app/Http/Controllers/Api/V1/DealController.php:22-45, routes/api/v1/deals.php.
- **Port notes:** the target API uses cursor pagination and problem+json (`frontend-api-call`/`contracts-change` skills); keep a compat view only if WaDesk API clients matter.

### WD-DEAL-031 — REST API: show deal

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-035
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| GET api/v1/deals/{id} | api.v1.deals.show | DealController@show | api, auth.apikey, throttle | id numeric | 200 `{data:{id,title,pipeline_id,stage_id,stage(name),status,value(float major),value_minor(int),currency,contact_id,owner_user_id,source,expected_close_date(Y-m-d),lost_reason,won_at,lost_at,created_at,updated_at}}` (timestamps ISO-8601 with app tz offset); 404 `{error:{code:"not_found",message:"Deal not found."}}` |

- **Acceptance criteria:** Given a deal in another workspace, Then 404; given a won deal, Then `status:"won"` and `won_at` set.
- **Source refs:** DealController.php:47-54,166-188.

### WD-DEAL-032 — REST API: create deal

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-035
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| POST api/v1/deals | api.v1.deals.store | DealController@store | api, auth.apikey, throttle | `title` required string max191; `pipeline_id`, `stage_id`, `contact_id`, `owner_user_id` nullable integer; `value` nullable numeric 0..99999999; `currency` nullable string max10; `expected_close_date` nullable date | 201 `{data:<deal>}` (no meta); 422 `{error:{code:"unprocessable",message:"Pipeline has no stages."}}`; Laravel validation 422 |

- **Rules & edge cases:** pipeline = given (must be the workspace's) else the default (seeded on demand); QUIRK: an unknown/foreign `pipeline_id` silently falls back to the default pipeline; unknown `stage_id` silently falls to the first stage; unknown `contact_id` becomes null; `owner_user_id` is stored unvalidated and defaults to NULL (unlike the UI default of the actor; so no assignment notification unless a different owner is passed and the key's owner differs); `currency` default = pipeline currency; `source='api'`; `sort_order` default 0; cannot set `company_id`, `notes`, `meta`, `status`, `conversation_id`. The stage engine runs (status, notifications). Creating directly into a won stage yields a won deal.
- **Acceptance criteria:** Given `{title:"X"}`, Then 201 with `source:"api"`, default pipeline, first stage, `owner_user_id:null`; given a `stage_id` of a won stage, Then `status:"won"` and `won_at` set.
- **Source refs:** DealController.php:56-104.

### WD-DEAL-033 — REST API: update / advance deal

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-035
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| PUT api/v1/deals/{id} | api.v1.deals.update | DealController@update | api, auth.apikey, throttle | partial body (`sometimes`): `title` required string max191; `value` nullable numeric 0..99999999; `currency` nullable string max10; `stage_id`, `contact_id`, `owner_user_id` nullable integer; `expected_close_date` nullable date; `lost_reason` nullable string max191 | 200 `{data:<deal>}`; 404 not_found; 422 `{error:{code:"unprocessable",message:"Stage not in this deal's pipeline."}}`; Laravel validation 422 |

- **Rules & edge cases:** PUT behaves as PATCH. `value` null -> 0; empty `currency` ignored; `owner_user_id` falsy -> null; `lost_reason` can be set/cleared (QUIRK: when the same request moves the deal to an open stage, the stage hook nulls `lost_reason`); unknown `contact_id` -> null; foreign stage -> 422 (unlike the web PATCH); `stage_id` null/0 ignored. There is no `status` field: advance by `stage_id`; there are no won/lost/activity/task endpoints in the API. Notifications and flow triggers fire as for the UI.
- **Acceptance criteria:** Given `{stage_id:<won stage>}`, Then 200 with `status:"won"`; given a stage of another pipeline, Then 422 `unprocessable`; given `{value:null}`, Then `value:0`.
- **Source refs:** DealController.php:106-142.

### WD-DEAL-034 — REST API: delete deal

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Endpoints:**

| METHOD uri | route name | Controller@action | middleware | request | response |
| --- | --- | --- | --- | --- | --- |
| DELETE api/v1/deals/{id} | api.v1.deals.destroy | DealController@destroy | api, auth.apikey, throttle | none | 200 `{data:{deleted:true}}`; 404 not_found |

- **Rules:** same hard delete + activity cascade as WD-DEAL-013; no event.
- **Source refs:** DealController.php:144-153.

### WD-DEAL-035 — REST API cross-cutting: auth, throttle, envelope, errors, plan gate

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** api-keys domain
- **Summary:** Shared behavior of the five deal endpoints (routes auto-loaded from `routes/api/v1/deals.php`, prefix `api/v1`, names `api.v1.deals.*`).
- **Rules & edge cases:**
  1. Auth: `Authorization: Bearer wsk_...` or header `X-Api-Key`; the key is hashed (sha256) and looked up; failures: 401 `{error:{code:"missing_api_key"|"invalid_api_key",message}}`. The request runs "as" the key's owner user with the key's workspace as current (not persisted). `last_used_at` is updated. API key scopes are NOT checked; any valid key can read/write/delete deals.
  2. Throttle (`auth.apikey.throttle`): per key bucket `apiv1:{key id}`, 60-second sliding window, limit = plan `api_rate_limit_per_minute` (add-ons stacked) else system setting `security.api_rate_limit_per_minute` (default 600); 0/unlimited skips. Exceeded: 429 `{error:{code:"rate_limited",message}}` with headers `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` (also set on success).
  3. Success envelope `{data, meta?}` (`meta` only when non-empty: list has page info, others none; create returns 201). Error envelope `{error:{code,message,details?}}` with codes used here: `plan_feature_disabled` (403, "Your plan doesn't include the Sales Pipeline. Upgrade to unlock the deals API."), `not_found` (404), `unprocessable` (422), plus the key/throttle codes above.
  4. QUIRK: request validation failures are NOT wrapped in the `{error}` envelope: they use Laravel's default JSON 422 `{message, errors:{field:[...]}}` (no custom handler found; confirm live with the verify-parity skill).
  5. Plan check `ensurePlan` runs first on every action (including reads) via `PlanLimitGuard::hasFeature(workspace)`; platform-admin key owners bypass.
  6. Documented in the OpenAPI generated at `/developers/docs` (Scramble) with the tag "Deal": "Manage sales-pipeline deals — create, list, update and move deals between stages.".
  7. No Idempotency-Key support; no webhook events for deals (the webhooks API covers message/campaign/contact events only).
- **Acceptance criteria:**
  - Given no key, Then 401 `missing_api_key`. Given a revoked key, Then 401 `invalid_api_key`.
  - Given a plan without the feature, Then 403 `plan_feature_disabled` on GET and POST.
  - Given the per-minute limit exceeded, Then 429 with `Retry-After`.
- **Source refs:** app/Http/Middleware/AuthenticateApiKey.php, ApiPlanRateLimit.php, app/Http/Controllers/Api/V1/V1Controller.php, bootstrap/app.php:41-46, app/Providers/AppServiceProvider.php:203.
- **Port notes:** the target stack already defines problem+json, cursor pagination, Idempotency-Key and error codes; map `plan_feature_disabled` to its code; enforce key scopes (`deals:read`/`deals:write`).

### WD-DEAL-036 — AI CRM copilot deal tools (list/create/move + sales report)

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** ai domain
- **Summary:** The `/ai-crm` chat (and the WhatsApp staff channel) calls `CrmToolkit` tools. Only what it consumes from deals is specified here.
- **Access:** routes `GET ai-crm`, `POST ai-crm/message` (throttle 30/min), `POST ai-crm/reset`, `POST ai-crm/settings` under `workspace.role:manager` + `plan:access_ai_agents` (settings: admin). Write tools require confirm-before-act and are logged in the AI action log.
- **Tools consumed:**
  - `list_deals {status: open|won|lost|any (default open), stage: name fragment, limit (default 15, max 50)}` -> rows `{id,title,value(major),currency,status,stage}` workspace-wide (all pipelines), ordered id desc; stage fragment `LIKE` across all pipelines' stages.
  - `create_deal {title (required), value (major), contact_phone, stage (name fragment)}` -> default pipeline; stage = first LIKE match by sort_order else the first stage; contact found/created via `Contact::rememberPhone`; `value_minor=round(value*100)`, `currency` = pipeline currency, `owner_user_id` = the chatting user, `source='api'` (QUIRK: source `api`, not an AI source); title default "New deal" cut 191. Returns `{deal_id, stage, status}`.
  - `move_deal_stage {deal_id, stage}` -> deal's own pipeline; requires a name fragment match (else "No stage matching ..."); `update(stage_id)` so the stage engine runs; returns `{deal_id, stage, status}`; summary "Deal #N moved to "X" (status: won)".
  - `sales_report` (read) -> `{open_deals, open_pipeline_value, weighted_forecast (open only, value*prob/100), won_this_month, won_this_month_value, win_rate_pct}` workspace-wide, raw sums without currency conversion.
- **Acceptance criteria:** Given "move deal 7 to Won", Then the assistant asks to confirm, then the deal becomes won and the answer includes status won; given an unknown stage fragment, Then the tool returns a failure summary without changing the deal.
- **Source refs:** app/Services/AiCrm/CrmToolkit.php:60-105,436-605,1186-1197, AiCrmCopilotService.php:296-299, routes/web.php:1510-1522, app/Http/Controllers/AiCrmController.php.
- **Port notes:** expose the deal service as tool handlers behind the same permission; replace `source='api'` with `ai`.

### WD-DEAL-037 — Contact 360 consumption of deals and deal activities

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-CON-*
- **Summary:** The contact detail page (`ContactsController@show`) lists up to 50 deals (open first, then newest), the latest 40 deal activities and each deal as a timeline event, plus a rollup `{open_deals, won_value (sum of won value_minor/100, raw currency)}`. `Contact::deals()` orders open first then id desc. Contact delete does not touch deals.
- **Acceptance criteria:** Given a contact with 1 open and 1 won deal worth 100, Then the page lists the open one first with rollup open=1, won_value=100.
- **Source refs:** app/Http/Controllers/ContactsController.php:325-410, app/Models/Contact.php:60-75.

### WD-DEAL-038 — Company link (deals.company_id) and company 360 rollups

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** companies domain
- **Summary:** `deals.company_id` exists and is read by companies (list rollups: open count and won value; 360: up to 200 deals) and briefs, and unlinked when a company is deleted. QUIRK: no web, API, flow, AI or order writer ever sets `company_id` on a deal (only the demo seeder does), so company rollups are always empty in real data; `Contact->company_id` is the only live link.
- **Rules:** company delete sets `deals.company_id=null` (workspace-scoped), keeps deals. Won value = sum `value_minor` of won deals, no currency handling.
- **Acceptance criteria:** Given a company linked by seed to 2 deals, Then the company page lists them with stage names; deleting the company keeps the deals with null company.
- **Source refs:** app/Http/Controllers/CompaniesController.php, app/Models/Company.php:39-55, app/Services/Crm/BriefService.php:72-127.
- **Port notes:** add `companyId` to create/update DTOs and auto-inherit from the contact's company (improvement).

### WD-DEAL-039 — Other CRM surfaces that read or reference deals

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** CRM overlap
- **Summary (what is shared; not fully specified here):**
  - `/crm` dashboard (6 routes, plan + described role manager, no role middleware): `GET crm`, `GET crm/guide`, `GET crm/revenue`, `GET crm/revenue.csv`, `GET crm/revenue.pdf`, `POST crm/briefs`. Deal consumption: KPIs `open_deals` (count of open) and `open_value_minor` (raw sum, ALL pipelines, no conversion, shown in the InvoiceSetting currency) and `won_month_minor` (won with `won_at >= month start`, raw). The rest (payments, invoices, tasks) belongs to other domains.
  - Calendar (`GET calendar`): deals with `expected_close_date` inside the visible range appear as "deal" events (color `#0b7a4b`, done = won/lost, links to `/deals`).
  - Briefs (`POST crm/briefs` with subject_type contact|company|deal): deal brief shows value, status, ucfirst status; company/contact briefs list up to 6 recent deals and open count/value.
  - Tasks (`/tasks`): first-class table `tasks` with `related_type in contact,deal,company` + `related_id`; label shows the deal title. Different from deal timeline tasks (two parallel task systems, QUIRK).
  - Projects: `projects.deal_id` nullable (fillable) — the controller's create/update never writes it.
  - Payments: `payments.deal_id` nullable (PaymentsController accepts `deal_id integer`); Sales docs (proposals/estimates) `sales_docs.deal_id`; manual invoice builder lists 500 latest deals and stores `deal_id` only inside invoice `meta` (no invoices column).
  - Companies: see WD-DEAL-038. Contacts: WD-DEAL-037.
- **Acceptance criteria:** Given a deal with `expected_close_date` in the viewed month, Then the calendar shows a deal entry; given a won deal, Then it is marked done.
- **Source refs:** app/Http/Controllers/CrmController.php, CalendarController.php:63-79, BriefsController.php, TasksController.php, ProjectsController.php, PaymentsController.php:70-92, InvoicesController.php:98,125,192, routes/web.php:1448-1508.

### WD-DEAL-040 — Main-dashboard deal KPI card

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** dashboard domain
- **Summary:** `UserPagesController::dealStats` returns null unless the plan has the feature; otherwise `{open_count, open_value, won_month, win_rate}` with money converted to the workspace display currency (same conversion as the board; won-month = won since month start; win rate workspace-wide all pipelines) and formatted with `FormatSettings::formatIn`. Errors return null (card hidden).
- **Acceptance criteria:** Given plan on and 2 open deals of 100, Then the card shows 200.00 open value and `2` open count.
- **Source refs:** app/Http/Controllers/UserPagesController.php:739-785, resources/views/user/dashboard/index.blade.php:456.

### WD-DEAL-041 — Pipeline and stage editor (rename, reorder, add, delete, flag won/lost)

- **Status:** docs-only
- **Priority:** P1
- **Effort:** L
- **Depends on:** WD-DEAL-002
- **Summary:** The documentation (growth/deals.html, "Adjust your stages. Use the board's settings to rename, reorder, add, or remove stages ... mark which stages mean Won and Lost") and the flow-builder helper text ("Manage stages on the /deals board") promise a stage editor. NO route, controller, view or JS implements it. The settings modal contains only the auto-deal controls. Stages exist only as the seeded six and as rows edited directly in the database.
- **Rules to define for the port (WaDesk gives none):** stage ordering via `sort_order` ints; `probability` tinyint 0-100; `color` varchar(16) default `#25D366`; `is_won`/`is_lost` flags (code supports many per pipeline; "first by sort_order" is used by Mark Won/Lost); deletion of a stage that still holds deals is undefined in WaDesk (no FK, deals would orphan). Recommend: reassign-or-block on delete, at most one won and one lost stage, won stage probability 100, lost 0.
- **Acceptance criteria (target):** Given an admin, When a stage is renamed, reordered or recolored in settings, Then the board, drawer, flow-builder picker and reports reflect it; deleting a non-empty stage requires choosing a target stage.
- **Source refs:** Documentation/pages/growth/deals.html, resources/views/user/deals/index.blade.php:239-262, resources/js/charts/user-flows-builder.js:1576,3095.

### WD-DEAL-042 — Multiple pipelines (selector exists, creation does not)

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-DEAL-041
- **Summary:** The board shows a pipeline `<select>` when there is more than one, `?pipeline=` is honored, API/flow/inbox accept pipelines, but nothing creates a second pipeline (no route, no UI; only direct DB). `Pipeline.name` (varchar 120), `is_default`, `currency`, `sort_order` exist. Inconsistencies for multi-pipeline: reports and KPIs on dashboard are workspace-wide; `/deals/stages`, inbox, AI and Messenger always use the default; deleting is undefined.
- **Acceptance criteria (target):** Given two pipelines, When one is chosen on the board, Then only its stages/deals show and reports can be filtered by it.
- **Source refs:** app/Models/Pipeline.php, DealsController.php:32-36, views/user/deals/index.blade.php:60-67.

### WD-DEAL-043 — Lost reasons

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-DEAL-012
- **Summary:** `deals.lost_reason` is a free text varchar(191). There is no catalog, no required-reason setting, no reason chart or report. It can be written only by `POST /deals/{id}/lost {reason}`, the REST API `lost_reason`, or seeds. The drawer shows it read-only and never collects it. It is cleared when the deal reopens to an open stage.
- **Source refs:** DealsController.php:441-459, Deal.php saving hook, views/js (drawer line 352).

### WD-DEAL-044 — pipelines_limit plan quota

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Summary:** `packages.pipelines_limit` (int unsigned null = unlimited) is declared and listed in `Package::$fillable` but no code reads or enforces it (and no pipeline creation exists). There is also no limit on the number of deals or stages.
- **Source refs:** database/migrations/2026_06_13_100400_add_sales_pipeline_to_packages.php, app/Models/Package.php:146.

### WD-DEAL-045 — Demo seeding command (deals:demo)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Summary:** `php artisan deals:demo {workspace} {--fresh}` seeds 17 demo deals (tagged `meta.demo=true`) across the six stages with sources inbox/form/order/manual/shopify/woo, back-dated `created_at`/`won_at`/`lost_at`, owner = workspace owner; `--fresh` clears demo deals and their activities; skips when demo deals already exist; requires the six-stage ladder. A second seeder (DemoGapSeeder) creates deals with companies, notes and `expected_close_date`. Reference data only; port as a dev seed.
- **Source refs:** app/Console/Commands/SeedDemoDeals.php, database/seeders/DemoGapSeeder.php:215-245.

### WD-DEAL-046 — Workspace data wipe includes deals and activities

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Summary:** The expired-workspace retention wipe command clears `deals` and `deal_activities` (but not `pipelines`/`pipeline_stages`) with other operational tables. Pipelines and stages survive a wipe.
- **Source refs:** app/Console/Commands/WipeExpiredWorkspaces.php:31.

### WD-DEAL-047 — Empty, loading and error states + i18n inventory

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-DEAL-003
- **Summary:** Every state a deals screen can show.
- **States:** board column empty "No deals yet"; drawer loading "Loading…"; drawer load error shows the server message or "Failed to load"; no-activity text; no-contact dashed box; reports hero empty copy and leaderboard empty copy (see WD-DEAL-019); inbox panel "No deals yet. Create one"; drawer toasts: "Saved", "Marked Won", "Marked Lost", "Added", "Deal deleted", "Deal created", "Settings saved", "Deal moved", "Deal marked Won"/"Lost"; error toasts show the server message or "Could not move the deal."/"Could not create the deal."/"Could not save settings."; plan-blocked: paywall sheet (GET) or 403 toast. There is no skeleton, no pagination state, no offline state, no realtime indicator, no per-stage limit-reached state.
- **i18n:** Blade `__()` keys in `lang/*.json` (en, ar, bn, de, es, fr, he, hi, id, it, ...): "Sales Pipeline", "Sales", "Pipeline of opportunities", "Deals", "pipeline", "Reports", "Settings", "New deal", "Open pipeline", "Weighted forecast", "by probability", "Won · this month", "Win rate", "won vs lost", "Open deals", "in pipeline", "Search deals…", "All owners", "All sources", "Filter", "Clear", "Add deal", "Closed won", "Lost", "No deals yet", "Title", "Value", "Currency", "Stage", "Owner", "Me", "Expected close date", "Cancel", "Create deal", "Pipeline settings", "Turn new orders into deals automatically.", "Auto-create a deal from new orders", "Each new order lands in the default pipeline as an open deal.", "Only for orders above (blank = any value)", "Save", "Loading…", "Pipeline Reports", "Pipeline · Workspace", "Live", "of your closed deals were won.", "in play", "weighted forecast", "Back to board", "Distribution", "Pipeline value by stage", "Momentum", "Won vs lost", "6 mo", "agents", "won", "won value", "No won deals yet — close a few and they show up here.". QUIRK: the board JS strings (drawer labels "Customer", "Deal details", "Mark Won", "Mark Lost", "Activity", "Add to timeline", toasts, confirm text) and server messages (`ok:false` messages, notification titles) are hard-coded English and not translatable; also RTL is not handled in the drawer.
- **Acceptance criteria:** Given an empty pipeline, Then each column shows "No deals yet"; given a failing GET /deals/{id}, Then the drawer shows the message instead of "Loading…".
- **Source refs:** resources/views/user/deals/index.blade.php, reports.blade.php, resources/js/charts/user-deals-board.js, lang/en.json.
- **Port notes:** use the web i18n catalog with namespaced keys (`deals.*`), localize server errors via error codes, not messages.

## Data model

All tables are InnoDB utf8mb4_unicode_ci with **no foreign keys** (referential integrity is by application). Timestamps are nullable `timestamp` created_at/updated_at (no soft deletes). Verified with `SHOW CREATE TABLE` on the local reference DB (all four tables are empty there).

### deals
Purpose: one opportunity. Read/written by WD-DEAL-003..014, 022, 025..036. Volume: unbounded per workspace (board loads all).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | bigint unsigned AI PK | no | | |
| workspace_id | bigint unsigned | no | | tenant key |
| pipeline_id | bigint unsigned | no | | -> pipelines.id (no FK) |
| stage_id | bigint unsigned | no | | -> pipeline_stages.id |
| contact_id | bigint unsigned | yes | NULL | -> contacts.id; relation `withDefault` (null object) |
| company_id | bigint unsigned | yes | NULL | -> companies.id; never set by app writers (WD-DEAL-038) |
| conversation_id | bigint unsigned | yes | NULL | -> conversations.id; set by inbox create only |
| title | varchar(191) | no | | |
| value_minor | bigint | no | 0 | minor units, cast integer |
| currency | varchar(10) | no | 'INR' | free text, not upper-cased on write |
| owner_user_id | bigint unsigned | yes | NULL | -> users.id; not membership-validated |
| owner_team_id | bigint unsigned | yes | NULL | unused (no writer/reader) |
| expected_close_date | date | yes | NULL | cast date |
| status | varchar(16) | no | 'open' | `open|won|lost`, derived from stage by hook |
| lost_reason | varchar(191) | yes | NULL | free text |
| source | varchar(24) | no | 'manual' | `manual,inbox,order,shopify,woo,form,api,flow,facebook` |
| sort_order | int unsigned | no | 0 | always 0 in practice |
| notes | text | yes | NULL | unused by UI/API (demo seeder only) |
| meta | json | yes | NULL | cast array; `{order_id}`, `{demo:true}` |
| won_at | timestamp | yes | NULL | cast datetime |
| lost_at | timestamp | yes | NULL | cast datetime |
| created_at, updated_at | timestamp | yes | NULL | |

Indexes: `deals_workspace_id_status_index (workspace_id, status)`, `deals_pipeline_id_stage_id_index (pipeline_id, stage_id)`, `deals_contact_id_index`, `deals_owner_user_id_index`, `deals_company_id_index`. No index on `(workspace_id, source)`, `title`, `won_at`, `conversation_id`, or JSON `meta->order_id` (full scan for the order dedupe). Scopes: `forCurrentWorkspace` (workspace of the logged-in user or empty), `open()`. Relations: workspace, pipeline, stage, contact (withDefault), company (withDefault), owner (withDefault), activities (latest()). Accessors: `value_major` (minor/100 float), `value_display` (symbol + number_format 2). Enum constants: STATUSES, SOURCES.

### deal_activities
Purpose: timeline (notes/calls/messages/tasks/stage changes). Read/written by WD-DEAL-008, 010, 015..017, 037.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | bigint unsigned AI PK | no | | |
| deal_id | bigint unsigned | no | | -> deals.id |
| workspace_id | bigint unsigned | no | | |
| user_id | bigint unsigned | yes | NULL | author; null = System |
| type | varchar(24) | no | 'note' | `note,stage_change,call,message,task` |
| body | text | yes | NULL | **encrypted at rest** (Laravel `encrypted` cast) |
| meta | json | yes | NULL | stage_change `{from_stage_id,to_stage_id}` |
| due_at | timestamp | yes | NULL | tasks only |
| done_at | timestamp | yes | NULL | tasks only (toggle) |
| reminded_at | timestamp | yes | NULL | reminder idempotency |
| created_at, updated_at | timestamp | yes | NULL | |

Indexes: `(deal_id, created_at)`, `(workspace_id, type)`, `(due_at)`. The reminder sweep filters type/done/reminded/due without a matching composite index.

### pipelines
Columns: `id`, `workspace_id` bigint unsigned NOT NULL, `name` varchar(120) NOT NULL, `is_default` tinyint(1) NOT NULL default 0, `currency` varchar(10) NOT NULL default 'INR', `sort_order` int unsigned NOT NULL default 0, timestamps. Index `(workspace_id, is_default)`. No unique on one-default-per-workspace. Seed: "Sales Pipeline". Rows are created only by `ensureDefaultForWorkspace` (and seeders).

### pipeline_stages
Columns: `id`, `pipeline_id` bigint unsigned NOT NULL, `workspace_id` bigint unsigned NOT NULL, `name` varchar(120) NOT NULL, `sort_order` int unsigned NOT NULL default 0, `color` varchar(16) NOT NULL default '#25D366', `is_won` tinyint(1) NOT NULL default 0, `is_lost` tinyint(1) NOT NULL default 0, `probability` tinyint unsigned NOT NULL default 0 (0-255 possible, 0-100 by convention; no check), timestamps. Indexes `(pipeline_id, sort_order)`, `(workspace_id)`. No unique on name or on a single won/lost per pipeline. Casts: booleans, integers.

### Pivots / references (owned elsewhere, deal-aware)
- `contacts.company_id` (bigint unsigned null) and `deals.contact_id`: the contact link is many deals -> one contact; no pivot table. There is NO deal-to-user pivot (single `owner_user_id`; `owner_team_id` unused), no deal-to-company pivot, no deal-products/line-items table, no deal tags/labels table, no deal files table.
- `tasks.related_type varchar(16)` + `tasks.related_id bigint unsigned` (index `(related_type, related_id)`), values `contact|deal|company`.
- `projects.deal_id`, `payments.deal_id`, `sales_docs.deal_id` (all bigint unsigned null); invoices carry `deal_id` inside `meta`; `crm_briefs (subject_type varchar(16), subject_id)` with `deal`.
- `inbox_notifications` (user_id, workspace_id, type, title, body, data json, link, read_at): receives `deal_assigned|deal_won|deal_lost|deal_task_due`.
- `workspaces.deals_auto_from_orders` tinyint(1) NOT NULL default 0; `workspaces.deals_auto_min_minor` bigint NULL; `workspaces.currency` varchar(10) NULL.
- `packages.access_sales_pipeline` tinyint(1) NOT NULL default 0; `packages.pipelines_limit` int unsigned NULL (unused).
- `currencies` (name, code, symbol, precision, exchange_rate decimal(…,6), is_active) drives symbols and conversion.
- `flows.trigger_kind='deal_stage_changed'`, `flows.trigger_value = stage id`; `flow_subscribers` UNIQUE (flow_id, contact_id).
- `ai_crm_actions` logs AI write tools (including create_deal/move_deal_stage).

## Cross-domain contracts

- **Consumes (plan-limits domain):** `PlanLimitGuard::hasFeature(workspace, 'access_sales_pipeline')` plus package column; platform-admin bypass; middleware `plan:` with GET-passthrough paywall behavior (WD-DEAL-001).
- **Consumes (contacts, WD-CON-*):** `Contact::forCurrentWorkspace()->find(id)` for linking; contact name/phone fields (`name, first_name, last_name, country_code, mobile`) and `Contact::canonicalizePhone`; `Contact::rememberPhone` (AI); `contacts.company_id`. Exposes: `Contact::deals()` (open first, newest first) used by contact 360 and inbox panel; deals + deal activities in contact timelines.
- **Consumes (workspace/users):** workspace members via `workspace_user` for owner pickers, `workspaces.currency`, `owner_user_id` of workspaces for demo seeds.
- **Consumes (currencies/admin settings):** `currencies` table (symbol + `exchange_rate`), system setting `default_currency`, `FormatSettings::convert/formatIn`.
- **Consumes (inbox/notifications):** `NotificationDispatcher::notifyDealAssigned|notifyDealOutcome|notifyDealTaskDue` (4 notification types, dedupe 30 s, optional web push when `ti_pwa_enabled`). Exposes to inbox: `POST .../create-deal`, `GET .../deals`, `GET /deals/stages`, deep links `/deals?deal=ID`, and `deals.conversation_id` for "Open in inbox" (`/team-inbox?c=ID`). The inbox queue poll hosts the reminder sweep.
- **Exposes (flows domain):** trigger `deal_stage_changed` (value = stage id) fired by every stage update; `GET /deals/stages`; `POST /api/flow-node/deal-action` (Node token auth) for the Deal node with output ports created/error and variable `deal_id`. Consumes `FlowEnrollmentService::onDealStageChanged`.
- **Consumes (commerce/orders):** `WaOrder` created hook -> `OrderDealService`; order fields `workspace_id, id, total_minor, currency_code, customer_name, customer_phone`. HubSpot order sync is a separate push to HubSpot (not local deals).
- **Consumes (channels/facebook):** `fb_lead` node creates deals (WD-DEAL-029).
- **Exposes (AI domain):** `list_deals`, `create_deal`, `move_deal_stage`, `sales_report` tool contracts with the field shapes in WD-DEAL-036; AI action log rows.
- **Exposes (public API / developers):** `/api/v1/deals*` + OpenAPI tag "Deal".
- **Exposes (CRM overlap domains):** `deals.company_id` (companies rollups, briefs), `deals.expected_close_date` (calendar), won/open/won-month sums (CRM dashboard, main dashboard), `deal_id` references from tasks/projects/payments/sales docs/invoice meta, deletion without cascade to them.
- **Consumes (api-keys):** `AuthenticateApiKey` (sets current user/workspace), `ApiPlanRateLimit`.
- **Events/webhooks:** none emitted to outbound webhooks, no broadcast channel, no audit log (the `AuditableObserver` is attached only to Workspace, User, Package, Coupon, CreditPackage, Announcement, Order, Device).

## Open questions & quirks

- Documentation overpromises: stage rename/reorder/add/remove and won/lost flagging "in the board's settings" is not implemented (WD-DEAL-041); docs list "five ways" but code has six writers/nine source values; docs say an order's status change advances the deal ("paid/shipped close it won") but only the HubSpot deal is advanced, not the local deal; `mask_phone()` comments and the file header "Contact phone numbers are always masked" are false because masking is disabled globally.
- The "Open pipeline" and "Open deals" KPI tiles on the board are redundant; the reports hero says "won (mo)" and "Won · this month" for all-time won value.
- `deals.owner_team_id`, `deals.notes`, `deals.meta` (except order id/demo) have no UI/API.
- `invoices` has no `deal_id` column; the invoice builder lists deals and stores `deal_id` only in meta (any revenue-by-deal rollup is absent).
- Race conditions: the saving/updated hooks are not in a transaction with the activity row; drag-drop uses last-write-wins; auto-deal-from-order dedupe is a JSON search (not unique) so two simultaneous order hooks could double-create.
- Laravel's default 422 validation JSON is returned on every deals route; the API's `{error:{...}}` envelope covers only domain errors. Not confirmed live (local DB has no deals; log in as test@example.com to confirm).
- No timezone handling: `now()` and `startOfMonth()` use the app timezone, not a workspace timezone, for won-this-month and the 6-month chart; the `due_at` date input is interpreted in app timezone midnight.
- Board performance: unbounded loads, per-deal conversion in PHP, per-card N+1 avoided by `with()`; reports leaderboard is N+1 per leader; auto-deal contact resolution loads all workspace contacts.
- Inbox contact matching compares `contacts.mobile` digits to the conversation jid digits (national vs international formats may mismatch) while the other paths use `canonicalizePhone`.

## Differences to decide

| Id | WaDesk behavior | Recommendation for the port |
| --- | --- | --- |
| D-01 | Plan gate lets GET requests through (paywall overlay only); read JSON works without the plan | Enforce plan on reads too (403 `plan_feature_disabled`), keep a client-side upsell screen |
| D-02 | No role/permission gate on deals; viewers can create/move/delete | Introduce permission keys `deals.view/write/delete/report/settings`; map agent=view+write, manager=+delete+report, admin=+settings |
| D-03 | `ensureDefaultForWorkspace` silently relabels every `INR` deal/pipeline to the workspace (or order) currency on each call | Drop; migrate once; allow any currency per deal |
| D-04 | Board "Weighted forecast" includes the Won column at 100% and respects filters; reports forecast is open-only | Use open-only everywhere, unfiltered, same helper |
| D-05 | Board converts money into the workspace currency; reports, leaderboard, CRM dashboard and AI report sum raw mixed currencies under one symbol | Always convert via one FX service (SQL aggregate with rate table); show currency explicitly |
| D-06 | Board loads every deal in a pipeline with no pagination or per-stage totals endpoint | Per-stage cursor pagination (page size 25) + server aggregates (count, sum, weighted) per stage |
| D-07 | `sort_order` is always 0; drag within a column is a no-op; moved card appended at DOM end | Persist ordering (fractional index or gap-based rank) on drop with before/after ids |
| D-08 | Mark Lost never collects a reason; reason is free text; no catalog | Add lost-reason catalog (workspace settings, optional required) and a picker in the drawer and drag-to-lost dialog; keep `lost_reason` text for API |
| D-09 | Pipelines/stages cannot be created or edited (docs claim they can); `pipelines_limit` unenforced | Build the editor (WD-DEAL-041/042): CRUD, reorder, color, probability, won/lost flags (max one each), delete-with-reassign, enforce `pipelines_limit` |
| D-10 | Stage move is accepted from any stage to any stage with no required fields; no stage-change on create; no stage-change timeline on create; no flow trigger on create | Emit `deal.created` and `deal.stage_changed` outbox events on every placement, log the placement row |
| D-11 | Web PATCH silently ignores a foreign stage_id; API create silently falls back to default pipeline/first stage; API update returns 422 | Return 422 with a stable error code in all paths |
| D-12 | `owner_user_id` accepted for any integer, no membership check; API default owner null, UI default actor | Validate workspace membership; define one default (actor for UI, null or key owner for API, documented) |
| D-13 | Deleting a deal hard-deletes with no audit and leaves dangling references (tasks, projects, payments, docs, notifications) | Soft delete + audit + SET NULL FKs, outbox `deal.deleted`; keep activities for audit |
| D-14 | `company_id` is never settable; company rollups are dead | Add `companyId` to DTOs and inherit from the contact's company; expose company in the drawer |
| D-15 | Contact link can be set but not changed/removed in the UI | Allow change/unlink; show contact deep link |
| D-16 | Flow trigger is once per (flow, contact) forever and only fires when a contact is linked and only on update | Keep per-deal enrollment idempotency (flow, deal) instead of (flow, contact); fire on create; support pipeline-specific stages in the pickers |
| D-17 | `deal_stage_changed` picker and inbox/AI/Messenger use only the default pipeline | Let pickers choose a pipeline then a stage |
| D-18 | Auto-deal from order: no plan check, min value compared in raw minor across currencies, owner null, order status changes do not update the deal, contact search loads all contacts | Add plan check, compare in base currency, default owner rule, optional status-sync rule (paid -> won), indexed phone lookup |
| D-19 | Two task systems (deal timeline tasks vs `/tasks` table with `related_type=deal`) | Use one task model with `dealId`; show deal tasks in "My tasks"; keep the reminder job once |
| D-20 | Reminders run on inbox polls/heartbeat; due dates are midnight of a date; reopened task never re-reminds | BullMQ repeatable job; datetime due with tenant timezone; reset `remindedAt` on reopen or due change |
| D-21 | REST API: no scopes, validation 422 not in `{error}` envelope, page-number pagination, no webhooks for deals, no activity/won/lost endpoints | Use the repo's problem+json, cursor pagination, Idempotency-Key, `deals:read|write` scopes; add endpoints for activities and `won|lost`; emit `deal.*` webhook events |
| D-22 | Source `api` is used for AI copilot deals; `shopify/woo/form` sources have no writer | Add `ai` source; keep `shopify/woo/form` reserved for the integrations that will write them |
| D-23 | Hard-coded English strings in the JS drawer and server messages; no RTL in drawer | Translate through the web i18n catalog; return error codes |
| D-24 | Reports: no date range, no pipeline filter, mislabeled "this month", month label without year, no conversion funnel/cycle time | Add `from/to/pipelineId` filters, correct labels, and funnel + avg-days-to-close metrics (extensions) |
| D-25 | Plain deals fields missing: no tags, products/line items, attachments, multiple contacts, team owner (unused), custom fields | Out of parity scope; decide for product roadmap |
| D-26 | Activity body encrypted; no edit/delete of entries | Keep encryption; allow edit/delete of own notes with audit |

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET deals",
    "POST deals",
    "GET deals/reports",
    "GET deals/stages",
    "GET deals/contacts/search",
    "POST deals/settings",
    "GET deals/{deal}",
    "PATCH deals/{deal}",
    "DELETE deals/{deal}",
    "PATCH deals/{deal}/stage",
    "POST deals/{deal}/activity",
    "POST deals/{deal}/task/{activity}/done",
    "POST deals/{deal}/won",
    "POST deals/{deal}/lost",
    "GET api/v1/deals",
    "POST api/v1/deals",
    "GET api/v1/deals/{id}",
    "PUT api/v1/deals/{id}",
    "DELETE api/v1/deals/{id}",
    "POST api/flow-node/deal-action",
    "POST team-inbox/api/conversations/{id}/create-deal",
    "GET team-inbox/api/conversations/{id}/deals",
    "GET crm",
    "GET crm/guide",
    "GET crm/revenue",
    "GET crm/revenue.csv",
    "GET crm/revenue.pdf",
    "POST crm/briefs"
  ],
  "controllers": [
    "app/Http/Controllers/DealsController.php",
    "app/Http/Controllers/Api/V1/DealController.php",
    "app/Http/Controllers/CrmController.php"
  ],
  "services": [
    "app/Services/Deals/DealReminderService.php",
    "app/Services/Deals/OrderDealService.php"
  ],
  "models": ["Deal", "DealActivity", "Pipeline", "PipelineStage"],
  "tables": ["deals", "deal_activities", "pipelines", "pipeline_stages"],
  "views": [
    "resources/views/user/deals/index.blade.php",
    "resources/views/user/deals/reports.blade.php",
    "resources/views/user/crm/dashboard.blade.php",
    "resources/views/user/crm/guide.blade.php",
    "resources/views/user/crm/revenue.blade.php",
    "resources/views/user/crm/revenue_pdf.blade.php"
  ],
  "commands": ["deals:remind-tasks", "deals:demo"],
  "permissions": [],
  "middleware": ["app/Http/Middleware/EnforcePlanFeature.php"],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/user-deals-board.js",
    "resources/js/charts/user-deals-reports.js"
  ],
  "misc_files": [
    "app/Console/Commands/DealsRemindTasksCommand.php",
    "app/Console/Commands/SeedDemoDeals.php",
    "routes/api/v1/deals.php"
  ],
  "config_files": ["config/plan_gates.php"],
  "doc_pages": ["Documentation/pages/growth/deals.html"],
  "feature_map": {
    "WD-DEAL-001": ["GET deals"],
    "WD-DEAL-003": ["GET deals"],
    "WD-DEAL-007": ["PATCH deals/{deal}/stage"],
    "WD-DEAL-009": ["POST deals"],
    "WD-DEAL-010": ["GET deals/{deal}"],
    "WD-DEAL-011": ["PATCH deals/{deal}"],
    "WD-DEAL-012": ["POST deals/{deal}/won", "POST deals/{deal}/lost"],
    "WD-DEAL-013": ["DELETE deals/{deal}"],
    "WD-DEAL-014": ["GET deals/contacts/search"],
    "WD-DEAL-015": ["POST deals/{deal}/activity"],
    "WD-DEAL-016": ["POST deals/{deal}/task/{activity}/done"],
    "WD-DEAL-019": ["GET deals/reports"],
    "WD-DEAL-021": ["POST deals/settings"],
    "WD-DEAL-023": ["GET deals/stages"],
    "WD-DEAL-025": ["POST team-inbox/api/conversations/{id}/create-deal"],
    "WD-DEAL-026": ["GET team-inbox/api/conversations/{id}/deals"],
    "WD-DEAL-028": ["POST api/flow-node/deal-action"],
    "WD-DEAL-030": ["GET api/v1/deals"],
    "WD-DEAL-031": ["GET api/v1/deals/{id}"],
    "WD-DEAL-032": ["POST api/v1/deals"],
    "WD-DEAL-033": ["PUT api/v1/deals/{id}"],
    "WD-DEAL-034": ["DELETE api/v1/deals/{id}"],
    "WD-DEAL-039": ["GET crm", "GET crm/guide", "GET crm/revenue", "GET crm/revenue.csv", "GET crm/revenue.pdf", "POST crm/briefs"]
  }
}
```

## Port decisions

Recorded by the API port of deals and pipelines (pipelines and stages with an editor, deals, the board, the stage-change engine, the
timeline and tasks, lost reasons, reports). The default was to **fix clear bugs and keep intended behaviour**; every place the port
differs from WaDesk is listed here with the "Differences to decide" row it settles. Code: `apps/api/src/modules/crm/deals` and
`crm/pipelines`, contracts in `packages/contracts/src/deals-pipelines/`, migrations `20261003100000..100500_deal_*`, endpoints in
`docs/api/deals-pipelines.md`, tests in `apps/api/test/{unit,integration,e2e}/deals-pipelines`.

### Decided as recommended (fixes)

| Diff # | Decision | Where |
| --- | --- | --- |
| D-01 | The plan check covers reads too: a workspace whose plan lacks the sales pipeline gets `422 PLAN_FEATURE_LOCKED` (the repo's existing plan-lock code, with `feature: sales_pipeline` and the upgrade path) on every deals, pipelines, board, reports and lost-reason route. The flag is `features.sales_pipeline` on the plan (or an organization override); a plan that does not carry the key is NOT locked (every existing plan). It is not in the plan-form registry yet, see follow-ups. | WD-DEAL-001 |
| D-02 | Permissions are keys, not "any member": `record.deals.read/create/update/delete/report` (with a record scope on the deal's owner: all, team, own) and `record.pipelines.read/create/update/delete` (pipelines, stages, lost reasons and deal settings, one configuration resource). The names follow the repo's `record.<resource>.<action>`, not the spec's `deals.view/write`. Admin has all; the editable front-line preset (Agent / Counsellor) gets deals read/update on its own deals, create, and pipelines read. A viewer role with read keys cannot write (403). A deal outside the caller's scope is 404, never 403. | WD-DEAL-001 |
| D-03 | No currency "heal". The default pipeline is created with the workspace by a database trigger (and backfilled by the migration), so reading never writes. A deal's currency is its own and is never relabelled by any call. Changing it is an explicit PATCH that must carry the value in the new currency. A currency is a 3-letter code, upper-cased, and the number of decimals follows it (JPY 0, KWD 3, else 2). | WD-DEAL-002, 006 |
| D-04 | The forecast is value x stage probability over OPEN deals only, everywhere (board KPI, reports, per column), and the board's KPI strip is never changed by the board filters. | WD-DEAL-005, 019 |
| D-05 | Every total is exact per currency (`byCurrency: [{currency, amount}]`). `convertTo=XXX` adds one converted figure using `currencies.exchange_rate` (bigint arithmetic, half up, minor units of both currencies respected). A currency with no usable rate is listed in `unconverted` and `converted` is `null`: never treated as 1.0 (the board's WaDesk behaviour) and never summed raw under one symbol (its reports' behaviour). | WD-DEAL-005, 006, 019 |
| D-06 | The board is per-column keyset paging (25 cards by default, up to 100) plus SQL aggregates for each column's count, per-currency total and weighted total, so a column of any size costs one page. `GET /deals/board/stages/:stageId/deals` is "load more". The flat `GET /deals` list pages `(created_at, id)` at microsecond precision (no lost or repeated rows on ties). | WD-DEAL-003 |
| D-07 | The order inside a column persists: `deals.sort_order` is a gap-spaced bigint (new deals on top, newest first until a card is moved); `PATCH /deals/:id/stage` accepts `beforeDealId` / `afterDealId` and the drop takes the midpoint of its neighbours; a column whose gap has closed is renumbered in the same transaction (this bumps the other cards' `rowVersion`, rare). A reorder inside a column is not a stage change. | WD-DEAL-007 |
| D-08 | Lost-reason catalogue (`/deal-lost-reasons`, list/add/rename/deactivate/reorder/delete), a picker value `lostReasonId` on lost and on a drag into a lost stage, free text `reason` kept for API-style callers, and a workspace setting `lostReasonRequired` (422 `DEAL_LOST_REASON_REQUIRED` on button and drag alike). The deal keeps the reason NAME as text, so deleting or renaming a reason never rewrites history. A reason over 191 characters is 422, not truncated. Creating a deal straight into a lost stage does not require a reason (the create has no reason field). | WD-DEAL-012, 043 |
| D-09 | The editor WaDesk documented is built: create/rename/recolour/re-weight/reorder/delete pipelines and stages, exactly one default pipeline, at most one won and one lost stage per pipeline (won is 100%, lost 0%, by CHECK), unique names (any case), only an empty stage can change kind, deleting a stage with deals moves them to a stage of the same pipeline, deleting a pipeline with deals moves open/won/lost deals to the target's first open / won / lost stage (409 if the target lacks one), the default pipeline cannot be deleted, the last stage cannot be deleted. The foreign keys are NO ACTION, so the database refuses what the service forgets. `pipelines_limit` is enforced on create as the plan limit `pipelines` (422 `PLAN_LIMIT_REACHED`); see follow-ups for the registry. | WD-DEAL-041, 042, 044 |
| D-10 | A create is a placement: one `stage_change` timeline row (`from: null`), `deal.created`, `deal.stage_changed` (`fromStageId: null`) and `deal.won` / `deal.lost` when it starts there. Every real move writes exactly one timeline row, one audit row and `deal.stage_changed`, plus `deal.won`, `deal.lost` or `deal.reopened` on a status change. All in the writer's transaction. The timeline row stores the stage NAMES, so a deleted stage still reads (WaDesk showed `?`). | WD-DEAL-008 |
| D-11 | A stage of another pipeline is `422 DEAL_STAGE_MISMATCH` on create, move and reopen alike, and the database enforces it (composite FK `(org, pipeline, stage)`). There is no silent fallback to the default pipeline or the first stage; an unknown `pipelineId` on the board is 404; a contact, company or stage that is not in the workspace is 404 (WaDesk silently dropped the link). | WD-DEAL-007, 009, 011, 032, 033 |
| D-12 | An owner must be an ACTIVE member of the workspace (422 `DEAL_OWNER_INVALID`), also for a task assignee. Omitted on a staff create means the caller; `null` means no owner. | WD-DEAL-009, 011 |
| D-13 | Hard delete, as the repo's rule says (not soft delete), audited with what was deleted, `deal.deleted` event, the timeline cascades. The references from contacts, companies, conversations, owners, projects, sales docs and payments are `ON DELETE SET NULL` foreign keys, so nothing dangles. | WD-DEAL-013 |
| D-14 | `companyId` is on create and update; a deal linked to a contact with a company and no company of its own inherits it (an explicit company or `null` wins). Company rollups are not built (companies domain). | WD-DEAL-038 |
| D-15 | A contact can be linked, changed and unlinked after creation. | WD-DEAL-014 |
| D-16, D-17 | The flow trigger itself belongs to the flows domain. This port emits `deal.stage_changed` on every placement and move (create included) with the pipeline and stage uuids, so a flow can key its idempotency on `(flow, deal)` rather than WaDesk's `(flow, contact)`. `GET /pipelines` returns every pipeline with its stages for the builder and inbox pickers (not only the default pipeline). | WD-DEAL-023, 027 |
| D-19 | Timeline tasks keep their own rows but carry an assignee and a due timestamp, and `GET /deals/tasks` ("my tasks", overdue, done) lists them across deals. Merging with the separate `tasks` table is the tasks domain's decision. | WD-DEAL-015, 016 |
| D-20 | Task due dates are full timestamps with an offset (a bare date is not a valid `dueAt`, so nothing is silently read as midnight); reopening a task clears `reminded_at` so it can be reminded again. The reminder sweep's index (`idx_deal_activities_task_sweep`) is in place; the job itself is a follow-up. | WD-DEAL-016, 017 |
| D-22 | `ai` joins the source vocabulary (`manual, inbox, order, shopify, woo, form, api, flow, facebook, ai`), enforced by a CHECK. Staff-created deals are always `manual`; `DealsService.create(input, source)` takes the source for the other writers. | WD-DEAL-009 |
| D-23 | Server answers carry stable error codes (`DEAL_*`), never messages to parse. | WD-DEAL-047 |
| D-24 | Reports take `pipelineId`, `ownerId`, `from`, `to`, `convertTo`; "won this month" is this month in the workspace's time zone (`organizations.settings.timezone`, else UTC); the six-month trend is keyed `YYYY-MM` (year included); `avgDaysToClose` and lost-reason counts are added. A funnel (stage-to-stage conversion) is not built. | WD-DEAL-019, 020 |
| D-26 | The timeline body is encrypted at rest (AES-GCM through `CryptoService`, as WaDesk's cast did). Editing or deleting an entry is not built. | WD-DEAL-015 |

### Other decisions

| Decision | Where |
| --- | --- |
| A new stage without a probability starts at 0; it is placed after the last open stage so Won and Lost stay at the end (or before `beforeStageId`). | WD-DEAL-041 |
| Timeline types are `note, call, message, email, meeting, task` (WaDesk: `note, call, message, task`; `email` was a 422 there); `stage_change` is system-only. `dueAt` / `assigneeId` on anything but a task is 422 (WaDesk dropped them silently). | WD-DEAL-015 |
| A won deal that was lost drops the stale reason (WaDesk kept `lost_reason` when moving to won); `won_at` / `lost_at` are kept when the deal is moved to the stage it is already in. | WD-DEAL-008 |
| Marking a won deal won again, or a lost deal lost again without a reason, is a no-op (no row, no event); with a new reason it only replaces the reason. `POST /deals/:id/reopen` is new (WaDesk reopened by dragging). | WD-DEAL-012 |
| `status` and the won/lost stamps are a CHECK on the table, so a report counting `won_at` and one counting `status` cannot disagree. | WD-DEAL-008 |
| Every update takes `rowVersion` (409 `ROW_VERSION_CONFLICT`); the stage routes take it optionally (drag and drop is last write wins unless the client sends it). | WD-DEAL-011 |
| Board search matches the title, the contact's name and the company's name (WaDesk: title only); `unassigned` and `contactId` / `companyId` filters are added. | WD-DEAL-004 |
| Reads and writes use the record scope on the deal's OWNER; an unowned deal is visible only to scope `all`. | WD-DEAL-001 |

### Not built here (follow-ups)

| What | Why / where it goes |
| --- | --- |
| Public REST API `/public/v1/deals` (WD-DEAL-030..035) | The contacts port added no public-API pattern, and the existing `/public/v1` guard checks the key and signature but not scopes. It needs `deals:read` / `deals:write` key scopes first (D-21). The services take a `source`, so the controller is thin. |
| Overdue-task reminder job and the four owner notifications (WD-DEAL-017, 018) | Consumers of the outbox events (`deal.created` carries the owner, `deal.owner_changed`, `deal.won`, `deal.lost`) and a BullMQ sweep over `idx_deal_activities_task_sweep`; they belong with the notifications domain. |
| Auto-deal from orders and its settings (WD-DEAL-021, 022), inbox create/panel (025, 026), flow node (028), Messenger (029), AI tools (036) | Owned by the orders, inbox, flows, channels and AI domains; they call the deal service. |
| Registering `sales_pipeline` and `pipelines` in the plan registry (`PLAN_FEATURE_DEFS` / `PLAN_LIMIT_DEFS` in `@crm/contracts`) | The plan editor in `apps/web` renders and message-tests every registry key, so adding them needs the web messages in the same change. Until then they are set on a plan's JSON or an organization override. |
| Company 360 rollups, calendar and dashboard KPI cards (WD-DEAL-038..040), demo seeder (045) | Other domains consume `GET /deals?companyId=`, `GET /contacts/:id/deals` and `GET /deals/reports`. |
| Edit and delete of timeline entries; a funnel report | Out of the listed scope (D-24, D-26). |

### Follow-up closed: plan registry

`sales_pipeline` (feature, group `advanced`, **default true**) and `pipelines` (limit, group `workspace`, 0 = unlimited) are now in `PLAN_FEATURE_DEFS` /
`PLAN_LIMIT_DEFS`, so the platform plan editor renders them (messages in en and ar), the plan chips know the feature (last in the chip order), and
`DealsPlan` reads them through the registry's own `resolveFeature` / `resolveLimit` instead of raw JSON. A plan row that predates the keys keeps what it had
(not locked, not capped), which is why the feature defaults to on; the dev seed plans carry it (`pipelines`: Starter 2, Growth 10, Scale unlimited). The
create-plan contract still treats a flag the request omits as off (WD-PLAN-003 rule 2), so an API client that creates a plan must send `sales_pipeline: true`
to keep deals open on it; the web form ticks every feature by default.
