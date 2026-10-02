---
domain: sales-proposals-estimates
code: PROP
title: Proposals and Estimates (SalesDoc engine)
wadesk_version: '1.7.0'
sources_read: 27
---

# Proposals and Estimates (SalesDoc engine)

## Overview

"AI-CRM Phase 7" added **Proposals** and **Estimates**: pre-invoice priced quotes. They are one engine, not two. A single table (`sales_docs`) and a single controller (`SalesDocsController`) serve both; the route group a request arrives on (`proposals` or `estimates`) fixes the `doc_type`. The two menu entries differ only in label, number prefix (`PRO-` / `EST-`), colour on the calendar and a line of intro copy.

Main flow, end to end: a workspace member opens `/proposals` or `/estimates`, clicks "+ New", fills a modal (title, buyer name, buyer email, company, valid-until, line items, one whole-document tax rate, notes) and creates a **draft** with a number such as `EST-0003` and a 40-character public token. The member sends the public link to the buyer over WhatsApp (button on the row; it needs a buyer phone, which the modal cannot capture, see D-01), or copies the "View" link. The buyer opens `/q/{token}` with no login, sees a read-only quote page and presses Accept or Decline. The status flips, `decided_at` is stamped, and the document owner and creator get an in-app (and optionally web-push) notification. On a sent or accepted document the staff user clicks "-> Invoice", which hands the totals to the invoicing engine and flips the quote to `invoiced`.

What is **not** there, although the user documentation advertises most of it: editing a document after creation, discounts, duplicate/revise, a contact picker, a deal link, PDF output, email sending, e-signature, templates, reminders, a "viewed" status, an audit trail, and scheduled expiry. See the `docs-only` and `dead-code` features and "Differences to decide".

Who uses it: workspace members (nav tier `admin`, but the routes have no role gate, see WD-PROP-001), the end customer (public page, token only), and the AI CRM copilot (three tools). Plan gating: route middleware `plan:access_sales_pipeline` (the same flag as deals, companies, tasks, projects, calendar). Conversion additionally needs the invoicing plan flag `auto_invoice`.

Ownership of ids: the engine and the public `/q/*` routes live in **WD-PROP-**. **WD-EST-** holds what is specific to the `estimates.*` route group and estimate-flavoured behaviour (labels, `EST-` sequence, the estimate-to-invoice story, the copilot's `estimate` doc type); where behaviour is identical, the EST entry says "same as WD-PROP-nnn" and lists only the differences, so nothing is specified twice.

Connected domains: deals-pipelines (WD-DEAL-038/039, dormant `sales_docs.deal_id`), contacts-attributes-tags (dormant `sales_docs.contact_id`), companies (company picker and display fallback), invoicing (convert target, `InvoiceService`), notifications-activity-audit (WD-NOTIF-015, the decision notification), ai-agents / CRM copilot (`CrmToolkit` quote tools), coupons-credits-referral-currency (currency symbols), plans-subscriptions-trials (`access_sales_pipeline`, `auto_invoice`), whatsapp-devices-baileys and whatsapp-cloud-api-waba (the send engine via `WhatsAppDispatcher`), wallet-message-billing (outbound message charge, not read), roles-permissions, workspaces-teams-tenancy, dashboards-analytics-charts (calendar).

## Feature index

| Id          | Feature                                                                                     | Status    | Priority | Effort | Depends on                      |
| ----------- | ------------------------------------------------------------------------------------------- | --------- | -------- | ------ | ------------------------------- |
| WD-PROP-001 | Plan gate, absent role gate and workspace scoping for `/proposals` and `/estimates`         | implemented | P0     | S      | plans-subscriptions-trials      |
| WD-PROP-002 | Unified SalesDoc data model (doc_type split, statuses, minor-unit money)                    | implemented | P0     | M      | WD-PROP-001                     |
| WD-PROP-003 | Proposals list page (columns, ordering, pagination, open-value total)                       | implemented | P0     | M      | WD-PROP-002                     |
| WD-PROP-004 | Lazy expiry of past-due drafts and sent documents                                           | partial   | P1       | S      | WD-PROP-003                     |
| WD-PROP-005 | Create a proposal (modal, validation, side effects)                                         | implemented | P0     | M      | WD-PROP-002, WD-PROP-006, WD-PROP-008 |
| WD-PROP-006 | Money math: minor units, rounding, whole-document tax, zero-decimal currencies              | implemented | P0     | M      | WD-PROP-002                     |
| WD-PROP-007 | Modal line-item editor with live totals preview                                             | implemented | P1       | S      | WD-PROP-005                     |
| WD-PROP-008 | Sequential numbering (`PRO-0001`)                                                           | implemented | P0     | S      | WD-PROP-002                     |
| WD-PROP-009 | Public token and share link                                                                 | implemented | P0     | S      | WD-PROP-002                     |
| WD-PROP-010 | Staff status change (mark sent, accept, reject)                                             | implemented | P0     | S      | WD-PROP-003                     |
| WD-PROP-011 | Send the public link over WhatsApp                                                          | partial   | P1       | M      | WD-PROP-009, whatsapp domains   |
| WD-PROP-012 | Convert to invoice                                                                          | implemented | P0     | M      | WD-PROP-010, invoicing          |
| WD-PROP-013 | Delete a document                                                                           | implemented | P1       | S      | WD-PROP-003                     |
| WD-PROP-014 | Public share page (read-only quote view)                                                    | implemented | P0     | M      | WD-PROP-009                     |
| WD-PROP-015 | Public accept                                                                               | implemented | P0     | S      | WD-PROP-014                     |
| WD-PROP-016 | Public decline                                                                              | implemented | P0     | S      | WD-PROP-014                     |
| WD-PROP-017 | "Quote decided" notification to owner and creator                                           | implemented | P1     | S      | WD-PROP-015, WD-NOTIF-012       |
| WD-PROP-018 | Public route hardening: throttle, CSRF, enumeration, caching, indexing                      | partial   | P1       | S      | WD-PROP-014                     |
| WD-PROP-019 | AI copilot tool `create_quote`                                                              | implemented | P2     | M      | WD-PROP-005, ai-agents          |
| WD-PROP-020 | AI copilot tool `list_quotes`                                                               | implemented | P2     | S      | WD-PROP-003, ai-agents          |
| WD-PROP-021 | AI copilot tool `send_quote`                                                                | implemented | P2     | S      | WD-PROP-011, ai-agents          |
| WD-PROP-022 | Calendar integration (valid-until events)                                                   | implemented | P2     | S      | WD-PROP-002, calendar           |
| WD-PROP-023 | Navigation entries, how-to panel, CRM guide hub and i18n                                    | implemented | P2     | S      | WD-PROP-003                     |
| WD-PROP-024 | Buyer PII and notes encrypted at rest                                                       | implemented | P1     | S      | WD-PROP-002                     |
| WD-PROP-025 | Links to company, contact, deal and project                                                 | partial   | P1       | M      | WD-PROP-002, contacts, deals    |
| WD-PROP-026 | Empty, error, flash and confirm states                                                      | implemented | P1     | S      | WD-PROP-003                     |
| WD-PROP-027 | Edit a document after creation                                                              | docs-only | P1       | M      | WD-PROP-005                     |
| WD-PROP-028 | Discount (document or line)                                                                 | dead-code | P1       | M      | WD-PROP-006                     |
| WD-PROP-029 | Duplicate / revise a sent document                                                          | docs-only | P2       | S      | WD-PROP-005                     |
| WD-PROP-030 | PDF, email, e-signature, templates, reminders, "viewed" tracking, audit trail               | docs-only | P1       | XL     | all above                       |
| WD-EST-001  | Estimates list page and route group (`/estimates`)                                          | implemented | P0     | S      | WD-PROP-003                     |
| WD-EST-002  | Create an estimate                                                                          | implemented | P0     | S      | WD-PROP-005                     |
| WD-EST-003  | Independent `EST-` number sequence                                                          | implemented | P0     | S      | WD-PROP-008                     |
| WD-EST-004  | Estimate status actions (mark sent, accept)                                                 | implemented | P0     | S      | WD-PROP-010                     |
| WD-EST-005  | Send an estimate over WhatsApp                                                              | partial   | P1       | S      | WD-PROP-011                     |
| WD-EST-006  | Estimate to invoice conversion                                                              | implemented | P0     | M      | WD-PROP-012                     |
| WD-EST-007  | Delete an estimate                                                                          | implemented | P1       | S      | WD-PROP-013                     |
| WD-EST-008  | Public page and decision flow for an estimate                                               | implemented | P0     | S      | WD-PROP-014..016                |
| WD-EST-009  | Estimate-specific copilot behaviour (`doc_type: estimate`, convert claim)                   | partial   | P2     | S      | WD-PROP-019..021                |

## Features

### WD-PROP-001 — Plan gate, absent role gate and workspace scoping for `/proposals` and `/estimates`

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** plans-subscriptions-trials, workspaces-teams-tenancy
- **Summary:** Both menus sit behind the `access_sales_pipeline` plan flag, evaluated by the route middleware `plan`. There is no role middleware: any authenticated workspace member can call every endpoint. Every query is scoped to the user's current workspace.
- **Actors & access:** authenticated workspace members of any role. Platform admins bypass the plan check (inside `PlanLimitGuard::hasFeature`). No permission key exists for sales documents (`WorkspacePermissions::PERMISSIONS` has none). Nav visibility is `tier: admin` and `feature: access_sales_pipeline` with `promo: true` (locked menu shown to plans without the flag), which is cosmetic only.
- **UX & screens:** on a plan without the flag, a GET still renders the list (with its data) and a paywall sheet (`<x-plan-paywall>`) slides over it; the page is not blocked.
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Notes |
| --- | --- | --- | --- | --- |
| all 6 `proposals*` and 6 `estimates*` routes | `user.proposals.*`, `user.estimates.*` | `SalesDocsController@*` | `web`, `auth`, `plan:access_sales_pipeline` | inside `Route::name('user.')` |

- **Data:** reads `packages` feature flag through `PlanLimitGuard::hasFeature($workspace, 'access_sales_pipeline')`; scope is `sales_docs.workspace_id = users.current_workspace_id` (cast to int, 0 when none).
- **Rules & edge cases:**
  1. Safe method (GET) on a plan without the flag: page renders and a paywall payload (`feature`, label "Sales pipeline") is shared to the view. The data is still listed.
  2. Unsafe method without the flag: JSON/AJAX request gets `403 {ok:false, error:"plan_feature_disabled", feature, message}`; a normal form post gets a redirect back with a `warning` flash saying the plan does not include Sales pipeline.
  3. A document of another workspace is a 404 (`findOrFail` inside the scope). A platform admin with no current workspace sees an empty list (workspace 0) and, if they create one, writes `workspace_id = 0` (QUIRK, see D-14).
  4. `config/plan_gates.php` lists only `deals` and `deals/*` for this flag; proposals/estimates are not in the path map, so the global paywall is triggered only by the middleware's shared view variable.
  5. Public routes (`/q/*`) are not plan gated, not workspace-state gated and not suspended-account gated.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package flag `access_sales_pipeline` (admin plan editor, default false; the migration `2026_06_13_100400` turned it on for existing paid tiers).
- **Acceptance criteria:**
  - Given a workspace whose plan lacks `access_sales_pipeline`, when a member POSTs a new proposal via fetch with `Accept: application/json`, then the response is 403 `plan_feature_disabled` and no row is written.
  - Given the same plan, when the member opens `/proposals`, then the page renders with the paywall sheet and existing rows.
  - Given a member of workspace A, when they PATCH the id of a workspace-B document, then the response is 404.
  - Given a user with role agent or viewer on a plan with the flag, when they call `POST /estimates`, then it succeeds (no role gate; recommended to change, D-02).
- **Source refs:** routes/web.php:1480-1491; app/Http/Middleware/EnforcePlanFeature.php; config/plan_gates.php; app/Support/UserNav.php; resources/views/components/user/header.blade.php:133-140; app/Support/WorkspacePermissions.php.
- **Port notes:** feature key `sales_pipeline` is the shared plan feature (see tasks.md and deals-pipelines.md follow-up that it is not yet in `PLAN_FEATURE_DEFS`). Gate with a real permission key (`salesdocs.view|create|send|convert|delete`) instead of nothing. RLS on `org_id`; no workspace-0 rows.

### WD-PROP-002 — Unified SalesDoc data model (doc_type split, statuses, minor-unit money)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PROP-001
- **Summary:** One table backs both modules. `doc_type` is `proposal` or `estimate`. Money is integer minor units in the document's own currency, frozen at creation. Line items live in a JSON column, not in a child table.
- **Actors & access:** internal.
- **UX & screens:** none (see data model section).
- **Endpoints:** none.
- **Data:** table `sales_docs` (full column list in "Data model"). Statuses: `draft`, `sent`, `accepted`, `rejected`, `expired`, `invoiced`. Item JSON shape: `[{description, qty, unit_price_minor, line_total_minor}]`.
- **Rules & edge cases:**
  1. Status vocabulary vs the docs: docs say "Declined" and show no "Invoiced"; code stores `rejected` (UI label "Rejected" in the list pill, "declined" in the public banner and notification) and `invoiced`. There is no `viewed` and no `converted` value.
  2. `currency` defaults `USD`, `currency_exponent` defaults 2 (0 for zero-decimal currencies, WD-PROP-006).
  3. `discount_minor` exists and is always 0 (WD-PROP-028). `contact_id` and `deal_id` exist and are never written (WD-PROP-025).
  4. `items_json` is `longtext` with an array cast; there is no per-item id, so items cannot be addressed individually.
  5. `invoice_id` is a plain bigint with no foreign key; it is set once on conversion and is the only guard against double conversion.
  6. No soft delete; delete is a hard delete (WD-PROP-013).
  7. `number` is nullable and has no unique index; `seq` has no unique index either (see WD-PROP-008).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the schema, when a proposal and an estimate exist in one workspace, then both rows are in `sales_docs`, distinguished by `doc_type`, and each has its own `seq`.
  - Given an item `{qty: 2, unit 15.50 USD}`, when stored, then `unit_price_minor = 1550`, `line_total_minor = 3100`.
  - Given two documents, when created in different workspaces, then their `public_token`s are different (unique index) and tokens are 40 chars.
- **Source refs:** app/Models/SalesDoc.php; database/migrations/2026_08_22_000500_create_sales_docs_table.php; live `SHOW CREATE TABLE sales_docs`.
- **Port notes:** the target stack prefers a child table `sales_doc_items` (uuid, position, description, qty numeric(18,4), unit_price_minor, line_total_minor) plus a `rowVersion`; keep the JSON shape only in the public/API contract. Add `UNIQUE (org_id, doc_type, seq)` and a partial unique on `number`. Use composite FKs to companies/contacts/deals/invoices (repo rule).

### WD-PROP-003 — Proposals list page (columns, ordering, pagination, open-value total)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PROP-002
- **Summary:** `/proposals` lists the workspace's proposals, 30 per page, grouped by a fixed status order, with an "Open value" total and a "+ New proposal" button.
- **Actors & access:** WD-PROP-001.
- **UX & screens:** `resources/views/user/salesdocs/index.blade.php` (shared with estimates), layout `x-layouts.user`, nav key `more`, JS page key `user-salesdocs-index`.
  - Header: eyebrow "CRM"; title "Your *proposals*"; intro "Pitch scope and price. Track sent / accepted, then convert the winner straight into an invoice."
  - Right side: "Open value" (sum of `total_minor` of status `sent` and `accepted`, formatted in the workspace currency with symbol and exponent) and a "+ New proposal" button.
  - Flash bars: green `success`, red `error`, red list of validation `$errors`.
  - A how-to panel (`x-crm.how-to`) with four steps: create, send, buyer accepts, "-> Invoice".
  - Table columns: Number (mono), Title / Buyer (title or an em dash; second line buyer name, else company name, else em dash), Total (right, `total_display`), Status (coloured pill, capitalised), Valid until (`d M Y` or em dash), Actions.
  - Row actions in order: Send (green WhatsApp button, confirm "Send this on WhatsApp to the buyer?"), View (opens `/q/{token}` in a new tab), Mark sent (status draft only), Accept (draft, sent, expired), "-> Invoice" (status sent or accepted and no `invoice_id`, confirm "Convert to a real invoice?"), Delete (an icon with a minus glyph, confirm "Delete?"). There is no Reject, no Edit, no copy-link button.
  - Empty state: one row, "No proposals yet - create your first one."
  - Pagination links when more than 30 rows.
  - No search, no filter, no sort control, no bulk action, no export, no status tabs.
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET `proposals` | `user.proposals.index` | `SalesDocsController@index` | auth, plan | `page` | HTML view (vars: docs, currency, exponent, openMinor, companies, members, me, type labels) |

- **Data:** reads `sales_docs` (workspace + doc_type); `companies` (id, name; 500 latest by id desc) for the modal select; workspace members (`workspace_user` joined to users, ordered by name) are loaded and passed to the view but the view never uses them (nor `me`).
- **Rules & edge cases:**
  1. Order is `FIELD(status,'draft','sent','accepted','rejected','expired','invoiced')` then `id` desc. So all drafts first, then sent, and so on, newest first within a status.
  2. Page size 30 (Laravel paginator, query-string `page`).
  3. Before reading, the page runs the lazy expiry write (WD-PROP-004), so a GET has a write side effect.
  4. "Open value" counts only `sent` + `accepted`, over all pages, not only the current page. It ignores `invoiced` (already invoiced value drops out).
  5. The company select is capped at the 500 newest companies; older companies cannot be chosen.
  6. Money display: symbol from the `currencies` table via `Currency::symbolFor` (cached 5 minutes; unknown code shows `CODE ` with a trailing space) plus `number_format(total / 10^exp, exp)` using en formatting (comma thousands, dot decimals), not the user's locale.
  7. Status pill colours: draft grey, sent blue, accepted green/mint, rejected coral, expired amber, invoiced deep-green tint. Unknown status falls back to grey.
  8. Buyer name and notes are decrypted per row (encrypted cast), so a list page decrypts up to 30 rows.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** workspace currency (`workspaces.currency`, default USD).
- **Acceptance criteria:**
  - Given 3 drafts, 2 sent and 1 accepted proposal, when the list loads, then drafts show first (newest first), then sent, then accepted, and "Open value" equals the sum of the 2 sent and the 1 accepted totals.
  - Given 31 proposals, when the list loads, then 30 rows show with a second page.
  - Given no proposals, when the list loads, then the empty row "No proposals yet..." shows.
  - Given an estimate in the same workspace, when `/proposals` loads, then the estimate is not listed.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:43-76; resources/views/user/salesdocs/index.blade.php; app/Models/Currency.php:36-44.
- **Port notes:** `GET /sales-docs?type=proposal&status=&q=&cursor=` with cursor pagination (repo rule), plus a totals endpoint. Recommend adding search (number, title, buyer) and status filter chips; keep the "open value" tile. Table lives in `apps/web/src/features/sales-docs-proposals/`.

### WD-PROP-004 — Lazy expiry of past-due drafts and sent documents

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PROP-003
- **Summary:** Expiry is not a scheduled job. Each time a staff user opens the list, documents of that type in `draft` or `sent` whose `valid_until` date is before today are bulk-updated to `expired`.
- **Actors & access:** whoever opens `/proposals` or `/estimates`.
- **UX & screens:** the status pill reads "Expired" (amber).
- **Endpoints:** side effect of `GET proposals` / `GET estimates`.
- **Data:** `UPDATE sales_docs SET status='expired' WHERE workspace + doc_type AND status IN (draft,sent) AND valid_until IS NOT NULL AND DATE(valid_until) < today`. `updated_at` is bumped by Eloquent query update.
- **Rules & edge cases:**
  1. QUIRK: the flip happens only on a staff list load. A document nobody lists stays `sent` forever; the public page keeps showing status `sent` and an active Accept button after the valid-until date.
  2. "Today" is the app timezone's date (`now()->toDateString()`), not the workspace's time zone, and `valid_until` is a date with no time. A document valid until today is still valid today.
  3. Only `draft` and `sent` expire. `accepted`, `rejected`, `invoiced` never do.
  4. An expired document is not dead: staff "Accept" is offered for `expired`, and the public Accept/Decline accept `expired` too (WD-PROP-015). Staff "Mark sent" is not offered for expired.
  5. Creating a document with a past `valid_until` is allowed (validation is only `date`); it flips to `expired` at the next list load.
  6. The model's `isExpired()` helper exists and is unused.
  7. No event, notification or webhook is emitted on expiry. No reminder before expiry.
  8. The docs promise "auto-marks stale quotes Expired"; in practice this is the only mechanism.
- **Async & events:** none (candidate for a daily sweep in the port).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a sent estimate with valid_until yesterday, when staff opens `/estimates`, then it shows Expired.
  - Given an accepted proposal with valid_until yesterday, when staff opens `/proposals`, then it stays Accepted.
  - Given a draft with valid_until today, when the list loads, then it stays Draft.
  - Given an expired proposal, when the buyer opens the public link and presses Accept, then it becomes Accepted (decision wins over expiry in WaDesk; see D-05).
- **Source refs:** app/Http/Controllers/SalesDocsController.php:47-51; app/Models/SalesDoc.php:82-86.
- **Port notes:** worker job `salesdoc-expiry-sweep` (daily, per-org timezone, outbox event `salesdoc.expired`); also evaluate expiry at read time on the public page so the buyer never sees a lapsed quote as open. Decide D-05.

### WD-PROP-005 — Create a proposal (modal, validation, side effects)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PROP-002, WD-PROP-006, WD-PROP-008
- **Summary:** "+ New proposal" opens a modal; Create posts one form and, on success, redirects back to the list with a green flash "Proposal created."
- **Actors & access:** WD-PROP-001.
- **UX & screens:** modal `#sd-modal` (max width 2xl, scrolls at 92vh), opened by `#sd-open`, closed by the X, Cancel, a click on the backdrop or Escape. Fields: Title (text, max 255, placeholder "e.g. Website redesign - Phase 1"), Buyer name (max 255), Buyer email (plain text input, max 255, no type=email), Company (select, "- none -" plus 500 newest), Valid until (date), Line items (rows of description, qty, unit price, remove x; "+ Add row"; starts with one row), Tax rate % (number 0-100 step 0.01, default 0), live Subtotal / Tax / Total readout, Notes (textarea, max 5000), Cancel and Create. **There is no buyer phone field, no owner field and no discount field** although the server accepts `buyer_phone` and `owner_id`.
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST `proposals` | `user.proposals.store` | `SalesDocsController@store` | auth, plan | see below | 302 back + flash `success` "Proposal created."; validation failure 302 back with `errors` and old input flashed (modal not reopened) |

  Request fields and validation (Laravel rules): `title` nullable string max 255; `buyer_name` nullable string max 255; `buyer_email` nullable string max 255 (not validated as an email); `buyer_phone` nullable string max 60; `company_id` nullable integer; `owner_id` nullable integer; `valid_until` nullable date; `tax_rate` nullable numeric 0..100; `notes` nullable string max 5000; `items` required array min 1; `items.*.description` required string max 255; `items.*.qty` required numeric min 0; `items.*.unit_price` required numeric min 0. `discount`, `contact_id`, `deal_id` are not accepted.
- **Data:** inserts one `sales_docs` row: `workspace_id` (current), `doc_type`, `number`, `seq`, `status=draft`, `title`, `company_id`, `owner_id` (request value, else the creator), `created_by`, buyer fields, `currency` and `currency_exponent` (workspace currency now), the four money fields, `tax_rate_bp`, `items_json`, `notes`, `valid_until`, `public_token`.
- **Rules & edge cases:**
  1. `company_id` that is not in the current workspace is silently set to null (no error).
  2. `owner_id` is not validated at all: any integer is stored, including a user outside the workspace (QUIRK, D-14). The UI never sends it, so owner = creator in practice.
  3. Item description is trimmed; items with a quantity of 0 or a unit price of 0 are accepted (a zero-value document is valid). There is no maximum on qty or price.
  4. Money rules are in WD-PROP-006; number allocation in WD-PROP-008; token in WD-PROP-009.
  5. The modal can remove every row; submitting then fails with the "items field is required" error. After any validation failure the page reloads with the error list at the top; the modal stays closed and the typed values are not restored (the form does not use old input). QUIRK.
  6. No notification, no webhook, no audit-log row, no outbox event on create. No plan quota on the number of documents.
  7. The create is not wrapped in a transaction or lock (WD-PROP-008).
  8. Creating does not send anything; status stays `draft` until a send or manual "Mark sent".
- **Async & events:** none.
- **External systems:** none.
- **Settings:** workspace currency.
- **Acceptance criteria:**
  - Given a valid body with one item, when POST `/proposals`, then a draft with number `PRO-0001` (first in the workspace) and a 40-char token exists, and the flash "Proposal created." shows.
  - Given an empty `items` array, when POST, then 302 back with a validation error and no row.
  - Given `tax_rate=101`, then validation fails; given `tax_rate=18.5`, then `tax_rate_bp=1850`.
  - Given a `company_id` of another workspace, then the row is created with `company_id` null and no error.
  - Given `unit_price=-1`, then validation fails.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:78-156; resources/views/user/salesdocs/index.blade.php:106-154.
- **Port notes:** `POST /sales-docs` with `Idempotency-Key`; contract in `packages/contracts/src/sales-docs-proposals/`; trim and require non-blank description; validate owner as an org member; validate buyer email as an email and phone as E.164; include `contactId`, `dealId`, `phone` in the UI (D-01). Return the created document (201) and let the web app redirect to a detail page.

### WD-PROP-006 — Money math: minor units, rounding, whole-document tax, zero-decimal currencies

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PROP-002
- **Summary:** Exact arithmetic recipe the server applies on create (and the copilot repeats). There is one tax rate for the whole document, no discount, tax-exclusive pricing.
- **Actors & access:** internal.
- **UX & screens:** see WD-PROP-007 for the client mirror.
- **Endpoints:** inside `POST proposals|estimates`.
- **Data:** `subtotal_minor`, `tax_minor`, `total_minor`, `tax_rate_bp`, `currency`, `currency_exponent`, `items_json`.
- **Rules & edge cases:**
  1. Currency is the workspace's `currency` (uppercased, default `USD`), read at create time and stored on the row. Changing the workspace currency later does not change existing rows. The copilot reads the currency from the invoice settings instead (`InvoiceSetting.currency`, default USD), a different source (D-12).
  2. Exponent is 0 for `JPY KRW VND IDR CLP ISK HUF XAF XOF PYG RWF UGX KMF`, else 2. Three-decimal currencies (BHD, KWD, OMR, JOD, TND) are treated as 2 decimals (QUIRK).
  3. `unit_price_minor = round(unit_price * 10^exp)` (PHP `round`, half away from zero).
  4. `line_total_minor = round(qty * unit_price_minor)`; qty is a float with any number of decimals.
  5. `subtotal_minor = sum(line_total_minor)`.
  6. `tax_rate_bp = round(tax_rate * 100)` (so 18.255 becomes 1826; max 10000); `tax_minor = round(subtotal_minor * tax_rate_bp / 10000)`.
  7. `total_minor = subtotal_minor + tax_minor`. `discount_minor` is always 0 and not subtracted.
  8. Tax is exclusive (added on top); there is no inclusive mode, no per-line tax, no per-line discount, no shipping, no multiple tax lines.
  9. Display: `symbol + number_format(minor / 10^exp, exp)`; the public page prints quantity with up to 2 decimals, trailing zeros trimmed (a quantity of 1.005 prints as 1.01 though it was stored and multiplied exactly).
  10. Rounding order differs from the client preview (no per-line rounding there), so the preview can differ from the saved total by a minor unit (D-10).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** workspace currency; `currencies` table (symbol).
- **Acceptance criteria:**
  - Given items `[2 x 15.50, 1 x 9.99]` and tax 10 in USD, then subtotal 4099, tax 410 (409.9 rounds to 410), total 4509.
  - Given workspace currency JPY and `unit_price=1500`, qty 3, then `unit_price_minor=1500`, `line_total_minor=4500`, exponent 0.
  - Given `qty=0.333` and `unit_price=3`, then `line_total_minor = round(0.333*300) = 100`.
  - Given tax 0 or empty, then `tax_minor=0` and the public page shows no Tax row.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:22, 32-41, 97-117; app/Services/AiCrm/CrmToolkit.php:692-700, 1028-1047; resources/views/user/salesdocs/public.blade.php:3-6, 82-93.
- **Port notes:** use integer or decimal arithmetic (no floats): round half away from zero per line, then tax on the sum; define exponent from ISO 4217 (include 3-decimal currencies); store `qty` as numeric. Keep this recipe as a pure function with golden tests; the same function must serve proposals, estimates and the copilot.

### WD-PROP-007 — Modal line-item editor with live totals preview

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PROP-005
- **Summary:** Client script that adds and removes rows and recomputes subtotal, tax and total as the user types.
- **Actors & access:** WD-PROP-001.
- **UX & screens:** `resources/js/charts/user-salesdocs-index.js` (registered under `user-salesdocs-index` in `resources/js/app.js`). Rows are a 12-column grid: description (6), qty (2, min 0, step 1), unit price (3, min 0, step 0.01), remove (1). One empty row exists on load. Description, qty and price are `required` in the browser.
- **Endpoints:** none.
- **Data:** none until submit; inputs are posted as `items[i][description|qty|unit_price]`.
- **Rules & edge cases:**
  1. Preview = sum of `qty * price` (floats) as subtotal, `tax = subtotal * rate / 100`, total = their sum; formatted with `toLocaleString` (browser locale) and the currency symbol, with the workspace exponent.
  2. Qty input has step 1, so the browser flags fractional quantities as invalid even though the server accepts them (the form cannot submit 0.5 hours without bypassing the step). QUIRK.
  3. Unit-price step is 0.01 regardless of exponent, so a JPY workspace still allows decimals that round at save.
  4. Empty qty or price counts as 0 in the preview.
  5. Row removal does not enforce a minimum of one row.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given one row qty 2 price 80 and tax 18, when typing, then Subtotal shows 160, Tax 28.80, Total 188.80 (USD).
  - Given the user clicks "+ Add row", then a new empty row appears and totals recompute.
  - Given Escape pressed with the modal open, then it closes.
- **Source refs:** resources/js/charts/user-salesdocs-index.js; resources/js/app.js:254.
- **Port notes:** React form with `react-hook-form`; compute the preview through the same shared money function as the server (WD-PROP-006) so preview equals saved total; allow fractional qty; step from currency exponent.

### WD-PROP-008 — Sequential numbering (`PRO-0001`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-002
- **Summary:** Each workspace gets its own running counter per document type; the visible number is a prefix plus the counter left-padded to 4 digits.
- **Actors & access:** internal.
- **UX & screens:** number shown in the list's first column and on the public cover.
- **Endpoints:** inside create.
- **Data:** `sales_docs.seq`, `sales_docs.number`.
- **Rules & edge cases:**
  1. `seq = max(seq for this workspace and doc_type) + 1` (0 + 1 for the first). Number = `PRO-` + zero-padded 4 digits (`PRO-0001`); beyond 9999 the number simply grows (`PRO-10000`).
  2. QUIRK: no lock, no transaction, no unique index: two concurrent creates can get the same `seq` and number.
  3. QUIRK: because the counter is `max(seq)`, deleting the newest document makes its number reusable (a public link or WhatsApp message already sent with that number now refers to a different document).
  4. Proposals and estimates have independent counters (`PRO-` and `EST-`). Workspaces are independent.
  5. No configurable prefix, format, year reset or starting number (unlike invoice series). The demo seeder uses seq `1000+i`.
  6. The copilot allocates the same way (same flaws).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an empty workspace, when two proposals are created, then they are `PRO-0001` and `PRO-0002`.
  - Given an estimate is created after those, then it is `EST-0001`.
  - Given `PRO-0002` is deleted and another proposal is created, then the new one is `PRO-0002` again (WaDesk behaviour; the port should not reproduce it, D-06).
- **Source refs:** app/Http/Controllers/SalesDocsController.php:124-131; app/Services/AiCrm/CrmToolkit.php:1055-1061; database/seeders/DemoGapSeeder.php:257.
- **Port notes:** use a per-org per-type counter row locked `FOR UPDATE` (or a Postgres sequence per org) so numbers are never reused or duplicated; unique index on `(org_id, doc_type, seq)`.

### WD-PROP-009 — Public token and share link

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-002
- **Summary:** Every document gets a random 40-character token at creation; the link `/q/{token}` is the only credential for the public page and the accept/decline posts.
- **Actors & access:** anyone holding the link.
- **UX & screens:** the list's View button opens it; the WhatsApp text contains it.
- **Endpoints:** see WD-PROP-014..016.
- **Data:** `public_token` varchar(64) unique, set once.
- **Rules & edge cases:**
  1. Token = Laravel `Str::random(40)` (alphanumeric, about 238 bits). Never regenerated, never revoked, no expiry date, no per-view counter. A deleted document returns 404 for its old link.
  2. The link is built from the app URL: `url('/q/' . token)`; there is no custom domain or short link.
  3. Anyone with the link sees buyer name, company, email, phone and notes (WD-PROP-014); treat the token as a bearer secret.
  4. The seeded demo rows use 32-char tokens.
  5. The token is returned by the copilot's `create_quote` summary (the link is shown in the chat).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `APP_URL`.
- **Acceptance criteria:**
  - Given a created proposal, then its link is `<app-url>/q/<40 chars>` and opens the public page with no login.
  - Given the document is deleted, when the link is opened, then 404.
  - Given a bad token, then 404.
- **Source refs:** app/Models/SalesDoc.php:95-98; app/Http/Controllers/SalesDocsController.php:151.
- **Port notes:** generate 32 bytes base64url; store a hash (SHA-256) and compare in constant time; add "regenerate link" and expiry fields; serve the page from the web app at `/q/[token]` (Next.js) backed by an unauthenticated API with its own rate limit.

### WD-PROP-010 — Staff status change (mark sent, accept, reject)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-003
- **Summary:** The only edit operation: a `PATCH` that sets the status to `sent`, `accepted` or `rejected`.
- **Actors & access:** WD-PROP-001.
- **UX & screens:** list buttons "Mark sent" (shown for draft) and "Accept" (shown for draft, sent, expired). There is no UI for `rejected`.
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| PATCH `proposals/{id}` (id numeric) | `user.proposals.update` | `SalesDocsController@update` | auth, plan | `status` in `sent,accepted,rejected` | 302 back + flash `success` "Proposal marked sent|accepted|rejected." or `error` "Unknown status." |

- **Data:** writes `status`; `sent_at = now()` when the new status is `sent` and `sent_at` is empty; `decided_at = now()` when `accepted` or `rejected`.
- **Rules & edge cases:**
  1. QUIRK: no transition guard. From any status (including `invoiced`, `accepted`, `rejected`) the PATCH can set any of the three values. Setting `invoiced` is not possible this way; the invoiced document can be set back to `accepted` while keeping `invoice_id`.
  2. Marking `sent` on an `accepted` document regresses it and leaves `decided_at` set; no field is cleared on any transition.
  3. `decided_at` is overwritten on every accept/reject call; `sent_at` is stamped once.
  4. Any other status value gets the flash "Unknown status." with a 302, not a 422. A missing `status` is the same.
  5. No notification is sent when staff accept or reject (only the public decision notifies, WD-PROP-017). No audit entry, no webhook.
  6. Marking `sent` does not send anything to the buyer.
  7. Cannot mark `expired`, `draft` or `invoiced` by hand.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a draft, when PATCH `status=sent`, then status `sent`, `sent_at` set, flash "Proposal marked sent."
  - Given a draft, when PATCH `status=accepted`, then `accepted` and `decided_at` set.
  - Given `status=bogus`, then 302 back with flash error "Unknown status." and no change.
  - Given a document in another workspace, then 404.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:158-176; resources/views/user/salesdocs/index.blade.php:83-88.
- **Port notes:** model an explicit state machine (`draft -> sent -> accepted|rejected|expired`, `accepted -> invoiced`, `rejected|expired -> sent` as "reopen") returning 409 `INVALID_TRANSITION`; store a status-history row per transition (WaDesk has none); expose Reject in the UI.

### WD-PROP-011 — Send the public link over WhatsApp

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-PROP-009, whatsapp-devices-baileys, whatsapp-cloud-api-waba, wallet-message-billing
- **Summary:** The green "Send" button posts to a route that logs a normal outbound `messages` row and hands it to `WhatsAppDispatcher` (workspace's own device or WABA), then marks the document sent. It cannot work from the UI as shipped because the create modal has no phone field.
- **Actors & access:** WD-PROP-001.
- **UX & screens:** row button "Send" with confirm "Send this on WhatsApp to the buyer?"; success flash "Proposal sent on WhatsApp to <digits>."; errors as flashes.
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST `proposals/{id}/send` | `user.proposals.send` | `SalesDocsController@sendWhatsApp` | auth, plan | none | 302 back + flash |

- **Data:** reads the document; inserts one `messages` row (`user_id`, `workspace_id`, `direction=out`, `to_number` digits, `body`, `status=pending`, then `sent` or `failed`, `failure_reason` truncated to 191, `sent_at`); updates the document (`status` draft to sent, `sent_at` first time).
- **Rules & edge cases:**
  1. Phone: all non-digits stripped from `buyer_phone`; empty gives flash "Add a buyer phone number first, then send." No country-code normalisation, no validation. Because the modal never captures `buyer_phone` (and no edit route exists), UI-created documents always hit this error (QUIRK D-01). Only the raw POST body, seeded data or older rows can have a phone.
  2. Message body (plain text, 3 lines): "<Type> <number>" plus " - <title>" when a title exists; "Total: <symbol amount>"; "View & accept: <public url>". The brand name is computed but unused. The body is not localised, not templated, and not a WhatsApp template message.
  3. Dispatch result `ok` false gives flash "Could not send: <engine error>" (or "no WhatsApp engine connected. Connect a device or WABA first."); an exception gives "Send failed: <message>"; in both cases the message row is `failed` and the document status is unchanged.
  4. On success: draft becomes sent; `sent_at` set only if empty; allowed on any status (an accepted or invoiced document can be re-sent, status unchanged).
  5. Free-form text is used even for WABA workspaces; outside the 24-hour window Meta requires a template (not read; open question).
  6. No recipient-opt-in or consent check; no wallet balance check in this controller (the dispatcher may charge; not read).
  7. No idempotency: a double click sends twice (a confirm dialog guards only the UI).
  8. The message is not attached to a conversation or contact explicitly (no `contact_id` set), though the dispatcher may create one.
- **Async & events:** the dispatcher call is synchronous inside the request; the engine may queue delivery.
- **External systems:** workspace WhatsApp engine (Baileys device or WABA Cloud API) through `WhatsAppDispatcher`.
- **Settings:** connected device/WABA of the workspace.
- **Acceptance criteria:**
  - Given a draft with phone `+1 (555) 010-1234`, when Send is confirmed and the engine accepts, then a message to `15550101234` is stored with the 3-line body, the document becomes sent, `sent_at` set.
  - Given no phone, then flash "Add a buyer phone number first, then send." and no message row.
  - Given the engine returns an error, then the message is `failed` with the reason and the document stays draft.
  - Given an already accepted document, when sent again, then status stays accepted.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:240-295; app/Models/SalesDoc.php:88-98.
- **Port notes:** in the target use the messaging module's outbound API (template message for WABA when outside the window); capture phone and contact in the form; a worker job with an idempotency key per (doc, attempt); record a `sent` status-history row. Add email as a second channel (D-08).

### WD-PROP-012 — Convert to invoice

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PROP-010, invoicing domain, plans-subscriptions-trials
- **Summary:** "-> Invoice" turns the quote into a real, numbered invoice through the existing `InvoiceService`, renders and (if configured) sends it, links the document to the invoice and sets it to `invoiced`.
- **Actors & access:** WD-PROP-001 plus invoicing plan flag `auto_invoice` (soft: absence returns null, shown as an error flash).
- **UX & screens:** button "-> Invoice" for status sent or accepted with no `invoice_id`; confirm "Convert to a real invoice?"; on success redirect to `user.invoices.index` with flash "Proposal converted to invoice <invoice number>." (falls back to `#<id>`).
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST `proposals/{id}/convert` | `user.proposals.convert` | `SalesDocsController@convert` | auth, plan | none | 302 to invoices index + flash; or back + `error` |

- **Data:** reads the document; `InvoiceService::issue` creates `invoices` (source `manual`, doc_type `tax_invoice`, trigger `manual`, status `issued`, `issued_at` now, buyer name/email/phone, currency and exponent, subtotal/discount/shipping 0/tax/total copied, `meta_json = {from_sales_doc: id, sales_doc_number}`), one `invoice_items` row per line (description, qty, `unit_price_minor`, `line_subtotal_minor` = line total, discount 0, **tax rate 0, tax amount 0** per line), and one `invoice_tax_summaries` row (label "Tax", rate = tax_rate_bp / 100, base = subtotal, amount = tax) only when `tax_minor > 0`. The document gets `invoice_id` and `status=invoiced`.
- **Rules & edge cases:**
  1. Guard: if `invoice_id` is already set, flash error "Already converted to invoice #<id>." (an invoice id, not its number).
  2. QUIRK: no status guard on the server. A draft, rejected or expired document can be converted by posting directly; the UI offers it only for sent and accepted. The docs say "once a quote is Accepted".
  3. `issue()` returns null when the workspace plan lacks `auto_invoice`; the controller then flashes "Invoicing is not available on your current plan." and nothing changes. A monthly cap `auto_invoice_max_monthly` only flags (`meta.quota_flag`), never blocks.
  4. Invoice number is allocated by the invoicing engine's series logic (not this domain).
  5. The tax appears only in the tax summary; item lines carry zero tax, so an invoice rendered per line shows untaxed lines plus a "Tax" summary line (totals still match).
  6. Buyer address, company, contact, deal and notes are not copied to the invoice; the only link back is `meta_json.from_sales_doc`. The docs claim linkage to the customer; it is not there (D-09).
  7. `renderAndSend` runs right after: renders and freezes the PDF, then, only if the invoice settings have a `send_sender`, sends it. Its result is ignored: a failed render or send is not shown, the document is still marked `invoiced`.
  8. No transaction spans the invoice creation and the document update; a crash in between leaves an invoice without a link and a document still convertible (duplicate invoice on retry). No double-click protection.
  9. No notification to the buyer is sent by this step beyond the invoicing send. No deal is moved or won.
- **Async & events:** invoice PDF render and optional WhatsApp send inline; invoicing's own events.
- **External systems:** invoicing engine, optional WhatsApp via the invoice sender.
- **Settings:** invoice settings (series, seller details, `send_sender`, currency), plan `auto_invoice`, `auto_invoice_max_monthly`.
- **Acceptance criteria:**
  - Given an accepted proposal total 4509 minor with tax 410, when converted, then an invoice with the same subtotal/tax/total exists, the document is `invoiced` with `invoice_id`, and the browser lands on the invoices list with the success flash.
  - Given an already converted document, when converting again, then flash "Already converted to invoice #<id>." and no new invoice.
  - Given a plan without `auto_invoice`, then flash "Invoicing is not available on your current plan." and the document is unchanged.
  - Given invoice rendering fails, then the document is still `invoiced` and no error is shown (WaDesk; the port should surface it, D-09).
- **Source refs:** app/Http/Controllers/SalesDocsController.php:178-238; app/Services/Invoice/InvoiceService.php:37-76, 162-205, 240-300.
- **Port notes:** call the invoicing module's `createFromSalesDoc(docId, idemKey)` inside one transaction with the status update; copy per-line tax data; require `accepted` (or allow "convert directly from sent" as an org setting); emit `salesdoc.invoiced`; copy contact/company/deal links; fail loudly on render/send problems and expose invoice status.

### WD-PROP-013 — Delete a document

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PROP-003
- **Summary:** Hard delete of any document in any status.
- **Actors & access:** WD-PROP-001 (no role gate).
- **UX & screens:** icon button (a minus glyph) with confirm "Delete?"; flash "Proposal deleted."
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| DELETE `proposals/{id}` | `user.proposals.destroy` | `SalesDocsController@destroy` | auth, plan | none | 302 back + flash success |

- **Data:** deletes the `sales_docs` row.
- **Rules & edge cases:**
  1. Deletes accepted and invoiced documents too; the invoice keeps `meta_json.from_sales_doc` pointing at a missing document. No soft delete, no confirmation of "invoiced" state, no audit entry.
  2. The public link then 404s.
  3. The number can be reused (WD-PROP-008).
  4. The notification rows that link to the list are unaffected.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a draft, when deleted, then the row is gone and the flash "Proposal deleted." shows.
  - Given an invoiced document, when deleted, then it is deleted and the invoice remains.
  - Given the deleted document's link, when opened, then 404.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:297-303.
- **Port notes:** hard delete is the repo's rule but audit it; block (409) delete of `invoiced` documents or force a reason; free-text number reuse must not happen.

### WD-PROP-014 — Public share page (read-only quote view)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PROP-009
- **Summary:** An unauthenticated, self-contained HTML page showing the quote and, while it is open, Accept and Decline buttons.
- **Actors & access:** anyone with the token. No login, no plan check.
- **UX & screens:** `resources/views/user/salesdocs/public.blade.php` (standalone, inline CSS, `lang="en"` hard-coded, max width 780).
  - Cover: eyebrow "<Brand> - <Proposal|Estimate>" (brand from `brand_name()` else app name), H1 = title or the type label, meta: number, status pill (coloured text on white), "Valid until d M Y" when set.
  - "Prepared for" card, shown only if buyer name, company name or buyer email exists: buyer name (bold), company, email, phone (phone shown only inside this card).
  - "Line items" card: columns Description, Qty (up to 2 decimals, zeros trimmed), Unit, Amount; empty message "No items."; totals block: Subtotal, Tax (rate trimmed, e.g. "Tax (18%)", only if tax > 0), grand Total. No discount row.
  - "Notes" card when notes exist (line breaks preserved, HTML escaped).
  - Banners: accepted (green, "You accepted this <type>. <Brand> has been notified and will follow up."), rejected (coral, "This <type> was declined. If this was a mistake, please contact <Brand>."), invoiced (green, "Accepted - an invoice has been issued for this <type>.").
  - "Your decision" card (only status draft, sent or expired): Accept button, Decline button (confirm "Decline this <type>?"), note "By accepting you confirm the scope and pricing above."
  - Footer: "This <type> was generated by <Brand>."
  - Responsive: side margins shrink under 640px. No print stylesheet, no PDF button, no download.
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET `q/{token}` | `salesdoc.public.show` | `SalesDocsController@publicShow` | `web`, `throttle:120,1` | none | HTML; 404 for an unknown token |

- **Data:** reads the document with company (decrypts buyer name/email/phone/notes). Session flash `decided` (set by accept/decline redirect).
- **Rules & edge cases:**
  1. A GET has no side effect: no "viewed" status, no view counter, no timestamp, no notification to staff.
  2. Draft documents are viewable and decidable by anyone with the token.
  3. The page shows the stored status, so a past-due `sent` document still looks open (WD-PROP-004).
  4. Wording uses `__()` with the app/session locale; the HTML `lang` is fixed to `en`. The page uses no workspace branding other than the platform brand name (no logo, no seller name or address, no tax id, no terms).
  5. Buyer PII is shown to the bearer of the link.
  6. Status pill labels are the capitalised raw status ("Rejected", "Invoiced").
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `brand_name()` (platform branding).
- **Acceptance criteria:**
  - Given a sent estimate, when its link is opened, then number, buyer, line items, totals and both buttons show.
  - Given an accepted proposal, then the green accepted banner shows and no buttons.
  - Given tax_minor 0, then no Tax row.
  - Given a deleted/unknown token, then 404.
- **Source refs:** resources/views/user/salesdocs/public.blade.php; app/Http/Controllers/SalesDocsController.php:305-310.
- **Port notes:** Next.js route `app/q/[token]/page.tsx`, server-rendered, `noindex`, `Cache-Control: no-store`; add seller identity (workspace name, logo, address, tax id), terms, print/PDF download, valid-until expiry state and locale from the buyer language; stamp `first_viewed_at` and a `viewed` status (D-04).

### WD-PROP-015 — Public accept

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-014
- **Summary:** The buyer presses Accept; the document becomes `accepted` and the page reloads with a banner.
- **Actors & access:** anyone with the token.
- **UX & screens:** form button on the public page; the redirect carries session flash `decided`.
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST `q/{token}/accept` | `salesdoc.public.accept` | `SalesDocsController@publicAccept` | `web` (CSRF applies), `throttle:120,1` | none | 302 to `q/{token}` with flash `decided=<status>`; 404 unknown token |

- **Data:** `status=accepted`, `decided_at=now()` only when the current status is `draft`, `sent` or `expired`.
- **Rules & edge cases:**
  1. If the document is already `accepted`, `rejected` or `invoiced`, nothing changes and the response is still a redirect with `decided` equal to the current status (so a repeated accept is idempotent; an accept after a decline shows the "declined" banner and does not flip it).
  2. QUIRK: `expired` (and a past-due unflipped `sent`) can be accepted; `valid_until` is not checked.
  3. No identity captured: no signer name, e-signature, IP, user agent or checkbox; the only record is `decided_at`. The docs' "recorded for your audit trail" is not implemented.
  4. The notification to staff is best-effort (WD-PROP-017); failures are swallowed.
  5. CSRF protection applies (the route is not on the exemption list); a visitor with cookies blocked or an expired session gets a 419 page.
  6. No terms-acceptance checkbox, no comment/reason field.
  7. Accepting does not auto-convert, does not create a deal, task, project or payment link.
- **Async & events:** in-app notification (WD-PROP-017). No outbound webhook, no email.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a sent proposal, when the buyer presses Accept, then the status is accepted, `decided_at` is set, the page shows the green banner and no buttons, and owner and creator are notified.
  - Given an accepted document, when the accept POST is replayed, then nothing changes and no second notification is created.
  - Given a rejected document, when Accept is posted, then it stays rejected.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:312-348; routes/web.php:210.
- **Port notes:** capture signer name, email, typed signature or checkbox, IP, user agent, timestamp in a `sales_doc_events` table; refuse (409 `EXPIRED`) when expired unless the org allows late acceptance; emit `salesdoc.accepted`; handle replay with a unique decision per document.

### WD-PROP-016 — Public decline

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-014
- **Summary:** Same mechanism as accept with status `rejected`.
- **Actors & access:** anyone with the token.
- **UX & screens:** Decline button with confirm "Decline this <type>?"; coral banner afterwards.
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| POST `q/{token}/decline` | `salesdoc.public.decline` | `SalesDocsController@publicDecline` | `web`, `throttle:120,1` | none | 302 to `q/{token}` with flash `decided` |

- **Data:** `status=rejected`, `decided_at=now()` from `draft`, `sent`, `expired`.
- **Rules & edge cases:** all of WD-PROP-015 rules 1-7 apply symmetrically. A declined document can still be accepted by staff via the "Accept" list button? No: the button shows only for draft, sent, expired; for `rejected` there is no UI action, but `PATCH status=accepted` works. The buyer cannot undo a decline (the page says to contact the brand). No reason is collected.
- **Async & events:** notification "Proposal declined" (WD-PROP-017).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a sent proposal, when Decline is posted, then `rejected`, `decided_at` set, the owner and creator notified "Proposal declined".
  - Given an invoiced document, when Decline is posted, then nothing changes.
  - Given a decline, when the buyer reloads, then the declined banner and no buttons show.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:318-348.
- **Port notes:** add optional reason text; same event table as WD-PROP-015.

### WD-PROP-017 — "Quote decided" notification to owner and creator

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PROP-015, WD-NOTIF-012
- **Summary:** After a public accept or decline that actually changed the status, the owner and creator each receive an in-app notification (and browser web push when enabled).
- **Actors & access:** document owner (`owner_id`) and creator (`created_by`), unique-ed, zero ids dropped.
- **UX & screens:** notification feed row: type `sales_doc_decided`; title "<Proposal|Estimate> accepted" or "declined"; body "<number> <title> - customer accepted|declined" (max 200 chars); link `/proposals` or `/estimates` (the list, not the document); data `{sales_doc_id, status}`.
- **Endpoints:** none (called from WD-PROP-015/016).
- **Data:** `inbox_notifications` row per recipient; optional web push when the system setting `ti_pwa_enabled` is on (title 100, body 180, tag `inbox-salesdoc_decided:<id>:<status>`).
- **Rules & edge cases:**
  1. Dedupe key `salesdoc_decided:<doc>:<status>` held 30 seconds in the cache; a repeat inside that window creates nothing (and the status guard in WD-PROP-015 already prevents repeats).
  2. Wrapped in try/catch; failures never block the decision.
  3. Only public decisions notify; staff-side accept/reject, send and convert do not.
  4. No email, no WhatsApp notification, no outbound webhook, no Slack/Trello. The owner of a document created via the UI is the creator, so they receive one notification (unique-ed).
  5. Per-user notification preferences are not consulted here (the dispatcher's `push` writes unconditionally; not verified further).
- **Async & events:** synchronous inside the request.
- **External systems:** Web Push (VAPID) via `WebPushService` when enabled.
- **Settings:** system setting `ti_pwa_enabled` (default false).
- **Acceptance criteria:**
  - Given owner A and creator B, when the buyer accepts, then A and B each get one notification titled "Proposal accepted" linking to `/proposals`.
  - Given owner = creator, then exactly one notification.
  - Given the notification service throws, then the accept still succeeds.
- **Source refs:** app/Services/Inbox/NotificationDispatcher.php:202-222, 253-287; app/Http/Controllers/SalesDocsController.php:335-343.
- **Port notes:** emit outbox event `salesdoc.accepted|rejected`; the notifications module consumes it (owner, creator, org admins by preference); deep-link to the document detail.

### WD-PROP-018 — Public route hardening: throttle, CSRF, enumeration, caching, indexing

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PROP-014
- **Summary:** What protects the three public routes and what does not.
- **Actors & access:** anonymous.
- **UX & screens:** none.
- **Endpoints:** `GET q/{token}`, `POST q/{token}/accept`, `POST q/{token}/decline`.
- **Data:** none.
- **Rules & edge cases:**
  1. Middleware group `throttle:120,1`: 120 requests per minute per client (by IP, Laravel default key), shared with the invoice (`i/*`) and brief (`b/*`) public routes of the same group, so one IP browsing invoices consumes the same bucket.
  2. Exceeding it returns 429.
  3. Unknown token returns 404 (same as a deleted one); no timing or content differences are specified.
  4. CSRF: the POSTs are normal `web` routes (token required, session cookie issued by the GET).
  5. No `noindex` meta, no `X-Robots-Tag`, no `Cache-Control: no-store`, no referrer policy are set by the view; the page contains buyer PII.
  6. No bot protection or captcha; no per-token rate limit.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 121 requests from one IP in a minute to `/q/*`, then the 121st returns 429.
  - Given a POST without a valid CSRF token, then 419.
  - Given a random 40-char token, then 404.
- **Source refs:** routes/web.php:197-212; bootstrap/app.php (CSRF exceptions list does not include `q/*`).
- **Port notes:** API throttle per IP and per token; `Cache-Control: no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`; for the accept/decline POST use a signed form token or double-submit instead of the session cookie.

### WD-PROP-019 — AI copilot tool `create_quote`

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** WD-PROP-005, ai-agents
- **Summary:** The CRM copilot (dashboard chat and WhatsApp-to-self) can create a proposal or an estimate from plain English. It is a `write` tool, so the copilot asks for confirmation first ("I'll create a proposal "<title>" with N line item(s).").
- **Actors & access:** the copilot's caller (manager or admin per the copilot's gating); the copilot's own plan flags.
- **UX & screens:** chat reply: "Created <Type> <number> for <symbol amount>. Share link: <url>".
- **Endpoints:** none (tool).
- **Data:** inserts the same row as WD-PROP-005.
- **Rules & edge cases:**
  1. Args: `doc_type` (`estimate` else proposal), `title`, `buyer_name`, `company_name`, `tax_rate`, `valid_until` (YYYY-MM-DD; unparsable ignored), `items[]` (description, qty default 1, `unit_price` major units). Requires at least one item; items with a blank description are skipped; no valid item gives "No valid line items."
  2. Company is linked by first case-insensitive substring match against the 300 newest companies (never creates one). Quantity and price are not clamped (negative values are accepted here, unlike the form). `tax_rate` is not clamped to 0..100.
  3. Currency comes from the invoice settings currency, not the workspace currency (D-12). Owner and creator are the copilot user.
  4. No `buyer_email`, `buyer_phone`, `notes` args, so a copilot-created document cannot be sent over WhatsApp until a phone is added (and nothing can add it).
  5. The result carries `subject_type=sales_doc`, `subject_id`, written to the copilot's audit log (the only audit trail sales documents get).
  6. Same unlocked numbering race (WD-PROP-008).
- **Async & events:** copilot audit entry.
- **External systems:** LLM provider (BYOK) for the conversation; none for the tool.
- **Settings:** copilot settings and keys (ai-agents domain).
- **Acceptance criteria:**
  - Given "create an estimate for Priya: 2 hours consulting at 80", when confirmed, then an `EST-` draft with total 16000 minor (USD) exists and the reply includes the link.
  - Given an item list with only blank descriptions, then the reply is "No valid line items." and no row.
  - Given `valid_until: "not a date"`, then the document is created with no valid-until.
- **Source refs:** app/Services/AiCrm/CrmToolkit.php:283-313, 1016-1089, 692-700; app/Services/AiCrm/AiCrmCopilotService.php:315-317.
- **Port notes:** call the sales-docs service (`SalesDocsService.create(input, source: 'ai')`), same validation as the API; keep `source` on the row (`manual|ai|api`).

### WD-PROP-020 — AI copilot tool `list_quotes`

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-PROP-003, ai-agents
- **Summary:** Read tool: lists up to 20 recent documents (optionally filtered by `doc_type`) with number, type, title, status, formatted total and public link.
- **Actors & access:** copilot caller.
- **UX & screens:** chat summary "N quote(s)." plus data rows.
- **Endpoints:** none.
- **Data:** `sales_docs` by workspace, newest first, limit 20; no status filter (despite the docs example "which estimates are still open").
- **Rules & edge cases:** unknown `doc_type` means all types; no lazy-expiry flip here; the link of every row is exposed to the model.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 25 documents, then 20 newest are returned.
  - Given `doc_type=estimate`, then only estimates.
  - Given none, then "0 quote(s)."
- **Source refs:** app/Services/AiCrm/CrmToolkit.php:315-325, 1091-1104.
- **Port notes:** add `status` filter and a `search` argument.

### WD-PROP-021 — AI copilot tool `send_quote`

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-PROP-011, ai-agents
- **Summary:** Write tool that finds a document by number or title and sends its link over WhatsApp, with the same message body as WD-PROP-011.
- **Actors & access:** copilot caller; confirmation required ("I'll send <number|title|the quote> to its buyer on WhatsApp.").
- **UX & screens:** "Sent <Type> <number> to <masked phone>." (phone masked to the last 4 digits).
- **Endpoints:** none.
- **Data:** inserts `messages`; updates status/`sent_at` as WD-PROP-011.
- **Rules & edge cases:**
  1. Lookup: `number LIKE %x%` (newest first) when a number is given, else `title LIKE %x%`; first match wins; no match gives "No matching proposal/estimate found."; ambiguous matches are not reported.
  2. Missing buyer phone gives "<Type> <number> has no buyer phone." (and the copilot cannot create documents with a phone, WD-PROP-019).
  3. Failure: "Could not send: <error>"; the document is unchanged.
  4. Uses a shared `dispatchWhatsApp` helper which logs a `messages` row exactly like the controller.
- **Async & events:** copilot audit entry.
- **External systems:** workspace WhatsApp engine.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `EST-0001` with a phone, when sent via the copilot, then the buyer gets the message and the document is sent.
  - Given a title fragment matching two documents, then the newest is sent (no disambiguation).
  - Given no match, then the stated error.
- **Source refs:** app/Services/AiCrm/CrmToolkit.php:340-355, 1106-1184.
- **Port notes:** require an exact number or an id; return candidates when ambiguous.

### WD-PROP-022 — Calendar integration (valid-until events)

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-PROP-002, calendar (dashboards-analytics-charts)
- **Summary:** The unified `/calendar` shows each document's `valid_until` date as an event, coloured by type.
- **Actors & access:** `plan:access_sales_pipeline` (calendar route).
- **UX & screens:** event label = title, else number; proposals purple `#6D28D9`, estimates amber `#B45309`; legend entries "Proposals" and "Estimates" in `resources/views/user/crm/calendar.blade.php`; click goes to the list page (`/proposals` or `/estimates`), not the document.
- **Endpoints:** part of `GET calendar` (owned by the calendar domain).
- **Data:** reads `sales_docs` where `valid_until` is inside the visible range (id, doc_type, number, title, valid_until, status, public_token), workspace-scoped; `done = status in accepted, invoiced, rejected`.
- **Rules & edge cases:** the calendar does not apply lazy expiry, so an overdue sent document shows as not done; documents without `valid_until` never appear; no event for `sent_at`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an estimate valid until the 15th, then the 15th shows an amber event.
  - Given the document is accepted, then the event is marked done.
  - Given no valid-until, then no event.
- **Source refs:** app/Http/Controllers/CalendarController.php:80-94; resources/views/user/crm/calendar.blade.php:5.
- **Port notes:** the calendar module reads `GET /sales-docs?validFrom&validTo` (new filter) and should deep-link to the document.

### WD-PROP-023 — Navigation entries, how-to panel, CRM guide hub and i18n

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-PROP-003
- **Summary:** Where the feature shows up in the product shell and which copy keys it uses.
- **Actors & access:** WD-PROP-001.
- **UX & screens:**
  - Sidebar items "Proposals" and "Estimates" (keys `proposals`, `estimates`, `/proposals`, `/estimates`, tier `admin`, `feature: access_sales_pipeline`, `promo: true`) in `resources/views/components/user/header.blade.php:133-140`.
  - CRM guide page `resources/views/user/crm/guide.blade.php` links to both ("Start with an estimate"; worked example creates `EST-0003`; flow "Estimate / Proposal, Customer accepts, Invoice, Payment, Project, Calendar").
  - i18n: strings go through `__()` with the JSON files `lang/*.json` (ar, bn, de, en, es, fr, he, hi, id, it, ja, ko, nl, pl, pt, ru, th, tr, ur, vi, zh-CN). Keys include "Your", "Open value", "New", "Number", "Title / Buyer", "Total", "Status", "Valid until", "Actions", "Send", "View", "Mark sent", "Accept", "-> Invoice", "Line items", "Add row", "Tax rate %", "Subtotal", "Tax", "Notes", "Cancel", "Create", "Prepared for", "Description", "Qty", "Unit", "Amount", "Your decision", "Decline", plus the longer sentences quoted in the features above and the how-to steps (which embed HTML bold tags). Status labels (`Draft`, `Sent`...) are `ucfirst` of the raw status and are not translated; notification titles, flash messages and the WhatsApp body are hard-coded English.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:** the labels "Proposal"/"Estimate" in flashes come from `typeLabel()` (English only); the page `<title>` is the plural type label.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a plan with the flag, then both menu entries show; without it they show locked.
  - Given locale `es`, then page chrome strings translate but status pills stay English.
  - Given the guide page, then "Start with an estimate" links to `/estimates`.
- **Source refs:** resources/views/components/user/header.blade.php:133-140; resources/views/user/crm/guide.blade.php; resources/views/user/crm/calendar.blade.php; lang/en.json (keys located by grep).
- **Port notes:** `apps/web/messages/*/sales-docs-proposals.json`; translate status labels and flash/notification copy.

### WD-PROP-024 — Buyer PII and notes encrypted at rest

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PROP-002
- **Summary:** `buyer_name`, `buyer_email`, `buyer_phone` and `notes` use Laravel's `encrypted` cast (AES with `APP_KEY`), stored as text.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** the four text columns hold ciphertext; `title` and `items_json` are plain.
- **Rules & edge cases:** no SQL search or sort on buyer fields (and the list has no search); rotating `APP_KEY` makes old rows undecryptable; the copilot lookup searches `title` and `number` only because buyer fields are ciphertext.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `APP_KEY`.
- **Acceptance criteria:**
  - Given a created document, then the DB value of `buyer_email` is not the plaintext.
  - Given the model, then reading returns plaintext.
  - Given the list page, then buyer names appear decrypted.
- **Source refs:** app/Models/SalesDoc.php:40-45.
- **Port notes:** AES-GCM through `CryptoService` with key id (as in tasks.md D-16); search on title/number only; never copy PII into audit or event payloads.

### WD-PROP-025 — Links to company, contact, deal and project

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-PROP-002, contacts-attributes-tags, deals-pipelines
- **Summary:** Only the company link is wired. `contact_id` and `deal_id` columns and a `contact()` relation exist but nothing writes them, and there is no project link at all.
- **Actors & access:** WD-PROP-001.
- **UX & screens:** Company select in the create modal (500 newest); list shows the company name only as a fallback when the buyer name is empty; the public page shows the company name in "Prepared for".
- **Endpoints:** `company_id` on `POST`.
- **Data:** `company_id` (validated to exist in the workspace, else nulled); `contact_id`, `deal_id` always null; no FK constraints on any of them; no cascade on delete of the target.
- **Rules & edge cases:**
  1. The documentation says "Pick the customer (an existing contact or company)" and "Link a quote to a deal so your pipeline value reflects quoted numbers"; neither exists.
  2. Deals, contacts and companies do not list their quotes (the company 360 and contact 360 do not read `sales_docs`; deals-pipelines WD-DEAL-039 notes the dangling `sales_docs.deal_id`).
  3. Accepting or converting does not move or win a deal, create a project or task, or update the contact.
  4. Deleting the company leaves a dangling `company_id`; `company` is a `withDefault` relation so the page does not crash.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a company in the workspace, when chosen, then the document stores its id and the public page shows its name.
  - Given a foreign company id, then it is silently dropped.
  - Given a document with a company deleted afterwards, then the list still renders (company shows blank).
- **Source refs:** app/Models/SalesDoc.php:67-80; app/Http/Controllers/SalesDocsController.php:119-122; resources/views/user/salesdocs/index.blade.php:66, 122.
- **Port notes:** implement `contactId`, `dealId` (picker in the modal, prefilled from a deal or contact page "New proposal"), composite FKs with `ON DELETE SET NULL`; show quotes on the deal, contact and company detail; on accept optionally move the deal to a stage and on convert link the invoice to the deal (decision D-07).

### WD-PROP-026 — Empty, error, flash and confirm states

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PROP-003
- **Summary:** The complete state catalogue the screens use.
- **Actors & access:** WD-PROP-001.
- **UX & screens:**
  - Empty: "No proposals yet - create your first one." (6-column row).
  - Loading: none (server rendered, full page reloads on every action; no spinners, no optimistic UI, no toast).
  - Success flashes: "Proposal created.", "Proposal marked sent|accepted|rejected.", "Proposal converted to invoice <n>.", "Proposal sent on WhatsApp to <digits>.", "Proposal deleted."
  - Error flashes: "Unknown status.", "Already converted to invoice #<id>.", "Invoicing is not available on your current plan.", "Add a buyer phone number first, then send.", "Could not send: <reason>", "Send failed: <message>", plan warning "Your plan doesn't include Sales pipeline. Upgrade to unlock this feature."
  - Validation: all errors in one red box above the table.
  - Confirm dialogs (browser `confirm`): Send, Convert, Delete, public Decline.
  - 404 page for another workspace's id or a bad token; 419 on a stale CSRF token; 429 on throttle.
- **Endpoints:** all.
- **Data:** none.
- **Rules & edge cases:** the flash text uses the type label of the document, so an estimate says "Estimate ...". Buttons are plain form posts, so a double click can submit twice.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an empty workspace, then the empty row shows.
  - Given a failed send, then the red flash with the reason shows and the page keeps its state.
  - Given a validation failure, then the red error box lists each message.
- **Source refs:** resources/views/user/salesdocs/index.blade.php:36-38, 96-98; resources/views/user/salesdocs/public.blade.php.
- **Port notes:** use toasts plus inline form errors; problem+json codes (`SALESDOC_ALREADY_INVOICED`, `INVALID_TRANSITION`, `NO_BUYER_PHONE`, `PLAN_FEATURE_DISABLED`); add loading and optimistic states.

### WD-PROP-027 — Edit a document after creation

- **Status:** docs-only
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-PROP-005
- **Summary:** The docs say a draft is "freely editable". There is no edit route, no edit form and no PATCH path for fields; `PATCH proposals/{id}` accepts only `status`. A mistake needs delete and recreate (which can reuse the number, WD-PROP-008).
- **Actors & access:** n/a.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** n/a.
- **Rules & edge cases:** this is also why `buyer_phone` cannot be added later (D-01). The docs tip "revise instead of editing a sent quote" assumes a duplicate action that does not exist (WD-PROP-029).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria (target):**
  - Given a draft, when its fields and items are edited, then totals recompute with WD-PROP-006 and `rowVersion` guards concurrent edits.
  - Given a sent document, when edited, then the system requires a new revision (clones) or warns the buyer link will change.
  - Given an invoiced document, then edit is refused (409).
- **Source refs:** routes/web.php:1484-1489; app/Http/Controllers/SalesDocsController.php:158-176; Documentation/pages/commerce/proposals-estimates.html.
- **Port notes:** build edit for `draft` (and a revision flow for `sent`), with status-history rows.

### WD-PROP-028 — Discount (document or line)

- **Status:** dead-code
- **Priority:** P1
- **Effort:** M
- **Depends on:** WD-PROP-006
- **Summary:** The docs promise "an optional discount". The column `discount_minor` exists, is copied to the invoice and is always 0; no input, no validation, no display, and the total formula ignores it.
- **Actors & access:** n/a.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** `sales_docs.discount_minor` (bigint, default 0).
- **Rules & edge cases:** the public page and list never show it. Invoice conversion passes `discountMinor` through, so adding a discount later must also keep `total = subtotal - discount + tax` consistent with invoicing.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria (target):**
  - Given a 10 percent document discount on a 1000 subtotal and 10 percent tax, then taxable base 900, tax 90, total 990 (decide taxable-base rule, D-03).
  - Given a per-line discount, then the line total reflects it and the invoice line carries `line_discount_minor`.
  - Given no discount, then behaviour is unchanged.
- **Source refs:** database/migrations/2026_08_22_000500_create_sales_docs_table.php:38; app/Http/Controllers/SalesDocsController.php:144, 220.
- **Port notes:** decide per D-03; implement both line-level and document-level discounts with percent or amount.

### WD-PROP-029 — Duplicate / revise a sent document

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-PROP-005
- **Summary:** The docs suggest "duplicate it, adjust, and send the new version"; no duplicate or revision route exists.
- **Actors & access:** n/a.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** n/a.
- **Rules & edge cases:** none in code.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria (target):**
  - Given a sent document, when "Duplicate" is used, then a draft with a new number and token and the same items exists, and the original keeps its status.
  - Given a revision of a sent document, then the old link shows "superseded by <number>".
  - Given a duplicate, then `sent_at`, `decided_at`, `invoice_id` are cleared.
- **Source refs:** Documentation/pages/commerce/proposals-estimates.html.
- **Port notes:** `POST /sales-docs/:id/duplicate` and `revisionOf` column.

### WD-PROP-030 — PDF, email, e-signature, templates, reminders, "viewed" tracking, audit trail

- **Status:** docs-only
- **Priority:** P1
- **Effort:** XL
- **Depends on:** all above
- **Summary:** The assignment lists these capabilities; the code has none of them for sales documents. Recorded here so nobody assumes they exist.
- **Actors & access:** n/a.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. **PDF:** none for quotes; only invoices render PDFs (`InvoiceService`). The public page has no print or download.
  2. **Email:** none. No mailable, no `buyer_email` use after storage (it is displayed only).
  3. **E-signature / audit of acceptance:** none (WD-PROP-015 rule 3).
  4. **Templates / reusable blocks / cover pages / sections / attachments:** none; line items only, plain notes. No "Terms" field (docs say "notes & terms").
  5. **Reminders / follow-ups / expiry warnings:** none; no scheduled command, no queue job, no schedule entry touches `sales_docs`.
  6. **Viewed tracking:** none (no status, no timestamp).
  7. **Status history:** none.
  8. **Audit log / outbound webhooks / flow triggers / REST API:** none for sales documents (the copilot writes its own audit rows; the public REST API has deal endpoints only).
  9. **Multi-currency per document:** the currency is the workspace's at creation; no picker, no FX.
  10. **Deposits, payment links, partial acceptance, optional line items:** none.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria (target, to be split into follow-up features):**
  - Given an accepted document, when "Download PDF" is used, then a PDF with seller, buyer, items, totals, terms, and signature block is produced.
  - Given a sent document with a valid-until in 3 days, then a reminder is sent to the buyer once.
  - Given the first public view, then the status becomes `viewed` and the owner is notified once.
- **Source refs:** whole `app/` grep for `SalesDoc|sales_docs|salesdoc` (only SalesDocsController, SalesDoc, CrmToolkit, AiCrmCopilotService, NotificationDispatcher, CalendarController, Pipeline stage name); Documentation/pages/commerce/proposals-estimates.html.
- **Port notes:** treat each as its own feature in the target roadmap; PDF through a worker job and `media` storage; email through the mail provider adapter.

### WD-EST-001 — Estimates list page and route group (`/estimates`)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-003
- **Summary:** The same page and behaviour as WD-PROP-003, scoped to `doc_type=estimate`. The doc type is derived from the route name (a name containing `estimates`).
- **Actors & access:** WD-PROP-001.
- **UX & screens:** same view. Differences: title "Your *estimates*"; intro "Quote a price before you invoice. Send, get accepted, convert to a real invoice in one click."; button "+ New estimate"; empty state "No estimates yet - create your first one."; row actions post to `user.estimates.*`; the "Open value" and ordering rules are identical.
- **Endpoints:**

| Method + URI | Route name | Controller@action | Middleware | Request | Response |
| --- | --- | --- | --- | --- | --- |
| GET `estimates` | `user.estimates.index` | `SalesDocsController@index` | auth, plan | `page` | HTML |
| POST `estimates` | `user.estimates.store` | `@store` | auth, plan | WD-PROP-005 | 302 + "Estimate created." |
| PATCH `estimates/{id}` | `user.estimates.update` | `@update` | auth, plan | `status` | 302 |
| POST `estimates/{id}/convert` | `user.estimates.convert` | `@convert` | auth, plan | none | 302 to invoices |
| POST `estimates/{id}/send` | `user.estimates.send` | `@sendWhatsApp` | auth, plan | none | 302 |
| DELETE `estimates/{id}` | `user.estimates.destroy` | `@destroy` | auth, plan | none | 302 |

- **Data:** same table, filter `doc_type='estimate'`.
- **Rules & edge cases:**
  1. QUIRK: the `{id}` routes (update, convert, send, destroy) do not check `doc_type`. `PATCH /estimates/12` works on a proposal with id 12 and vice versa; only the labels in the flash message follow the document's real type. The type-scoping applies to index and store only.
  2. The route group for proposals and estimates is generated by one loop; the two groups are otherwise identical.
- **Async & events:** same as WD-PROP-003/004.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given proposals and estimates in one workspace, when `/estimates` loads, then only estimates list and "Open value" sums only estimates.
  - Given proposal id 7, when `DELETE /estimates/7` is posted, then it is deleted (WaDesk; the port should return 404).
  - Given an empty workspace, then "No estimates yet - create your first one."
- **Source refs:** routes/web.php:1480-1491; app/Http/Controllers/SalesDocsController.php:24-30, 43-76, 159-163.
- **Port notes:** one controller `SalesDocsController` with `:type` path segment (`/sales-docs/estimates`) or a `type` filter; enforce `doc_type` on every id route (D-13).

### WD-EST-002 — Create an estimate

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-005
- **Summary:** Same creation as WD-PROP-005 with `doc_type=estimate`, prefix `EST-`, flash "Estimate created."
- **Actors & access:** WD-PROP-001.
- **UX & screens:** modal title "New estimate"; otherwise identical (no phone field, D-01). The CRM guide's worked example (add the customer's name and number, two lines, total 15,000, create gives `EST-0003`) describes a phone field that the modal lacks.
- **Endpoints:** `POST estimates` (table in WD-EST-001).
- **Data:** as WD-PROP-005.
- **Rules & edge cases:** identical validation and money rules (WD-PROP-005/006); sequence is independent (WD-EST-003).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid body to `POST /estimates`, then a draft `EST-0001` exists with `doc_type=estimate`.
  - Given the same body to `POST /proposals`, then `PRO-0001` exists.
  - Given an empty items list, then a validation error.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:78-156; resources/views/user/crm/guide.blade.php:162-163.
- **Port notes:** one create endpoint parameterised by type.

### WD-EST-003 — Independent `EST-` number sequence

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-008
- **Summary:** Estimates number from `EST-0001` using `max(seq)+1` over `(workspace, doc_type=estimate)`; independent from proposals.
- **Actors & access:** internal.
- **UX & screens:** number column.
- **Endpoints:** inside create.
- **Data:** `seq`, `number`.
- **Rules & edge cases:** all of WD-PROP-008 (no lock, reuse after deleting the newest, no unique index). The copilot allocates the same way.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 2 proposals and 0 estimates, when an estimate is created, then it is `EST-0001`.
  - Given `EST-0003` is the highest and is deleted, then the next estimate is `EST-0003` (WaDesk).
  - Given two workspaces, then each starts at `EST-0001`.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:124-131.
- **Port notes:** as WD-PROP-008.

### WD-EST-004 — Estimate status actions (mark sent, accept)

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-010
- **Summary:** Same as WD-PROP-010 through `PATCH estimates/{id}`; flash "Estimate marked <status>."
- **Actors & access:** WD-PROP-001.
- **UX & screens:** same buttons.
- **Endpoints:** `PATCH estimates/{id}`.
- **Data:** as WD-PROP-010.
- **Rules & edge cases:** unrestricted transitions; unknown status gives "Unknown status."; see WD-EST-001 rule 1 about the missing `doc_type` check.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a draft estimate, when "Accept" is used, then flash "Estimate marked accepted." and `decided_at` is set.
  - Given `status=expired`, then "Unknown status."
  - Given an invoiced estimate, when PATCHed to accepted, then it is changed (WaDesk).
- **Source refs:** app/Http/Controllers/SalesDocsController.php:158-176.
- **Port notes:** state machine as in WD-PROP-010.

### WD-EST-005 — Send an estimate over WhatsApp

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PROP-011
- **Summary:** As WD-PROP-011 with the message first line "Estimate EST-0001" (plus title). The flagship docs example "send Priya the estimate" works only through the copilot and only when a buyer phone exists (it cannot).
- **Actors & access:** WD-PROP-001.
- **UX & screens:** same Send button; flash "Estimate sent on WhatsApp to <digits>."
- **Endpoints:** `POST estimates/{id}/send`.
- **Data:** as WD-PROP-011.
- **Rules & edge cases:** identical to WD-PROP-011.
- **Async & events:** as WD-PROP-011.
- **External systems:** workspace WhatsApp engine.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an estimate with a phone and a connected engine, then the message "Estimate EST-0001 - <title> / Total: <amount> / View & accept: <url>" is sent and the estimate becomes sent.
  - Given no phone, then "Add a buyer phone number first, then send."
  - Given no engine, then "Could not send: no WhatsApp engine connected. Connect a device or WABA first." (or the engine error).
- **Source refs:** app/Http/Controllers/SalesDocsController.php:245-295.
- **Port notes:** as WD-PROP-011.

### WD-EST-006 — Estimate to invoice conversion

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** WD-PROP-012
- **Summary:** The headline sales story ("Quote a price before you invoice. Send, get accepted, convert to a real invoice in one click"): estimate to invoice via WD-PROP-012, flash "Estimate converted to invoice <number>."
- **Actors & access:** WD-PROP-001 plus `auto_invoice`.
- **UX & screens:** "-> Invoice" button for sent/accepted estimates.
- **Endpoints:** `POST estimates/{id}/convert`.
- **Data:** as WD-PROP-012.
- **Rules & edge cases:** same as WD-PROP-012 (including no status guard, per-line tax 0, tax summary line, no deal/contact link, ignored render/send errors, no transaction). The copilot docs example "Convert estimate #12 to an invoice" has no tool behind it (WD-EST-009).
- **Async & events:** invoice render and send.
- **External systems:** invoicing.
- **Settings:** invoicing settings.
- **Acceptance criteria:**
  - Given an accepted estimate with 2 lines and 10 percent tax, when converted, then the invoice has 2 items, a tax summary of 10 percent and the same total; the estimate is `invoiced`.
  - Given the estimate is already converted, then "Already converted to invoice #<id>."
  - Given a plan without `auto_invoice`, then "Invoicing is not available on your current plan."
- **Source refs:** app/Http/Controllers/SalesDocsController.php:178-238.
- **Port notes:** as WD-PROP-012.

### WD-EST-007 — Delete an estimate

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** WD-PROP-013
- **Summary:** Hard delete; flash "Estimate deleted."
- **Actors & access:** WD-PROP-001.
- **UX & screens:** same icon and confirm.
- **Endpoints:** `DELETE estimates/{id}`.
- **Data:** deletes the row.
- **Rules & edge cases:** as WD-PROP-013.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an estimate, when deleted, then flash "Estimate deleted." and its link 404s.
  - Given the highest-numbered estimate deleted, then the number is reused.
  - Given an invoiced estimate deleted, then the invoice remains.
- **Source refs:** app/Http/Controllers/SalesDocsController.php:297-303.
- **Port notes:** as WD-PROP-013.

### WD-EST-008 — Public page and decision flow for an estimate

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** WD-PROP-014..016
- **Summary:** The same `/q/{token}` page; every label uses "estimate" (eyebrow "<Brand> - Estimate", "Accept this estimate", "You accepted this estimate...", "This estimate was declined...", footer "This estimate was generated by <Brand>."). Notification title "Estimate accepted|declined" linking to `/estimates`.
- **Actors & access:** anyone with the token.
- **UX & screens:** as WD-PROP-014.
- **Endpoints:** `GET q/{token}`, `POST q/{token}/accept`, `POST q/{token}/decline` (WD-PROP-014..016; one home).
- **Data:** as WD-PROP-015/016.
- **Rules & edge cases:** the page's type comes from the document, not from the URL, so `/q/{token}` is the same URL for both. Wrong type labels cannot occur.
- **Async & events:** WD-PROP-017.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a sent estimate, when the buyer accepts, then the banner says "You accepted this estimate."
  - Given the owner, then the notification title is "Estimate accepted" with link `/estimates`.
  - Given an estimate link and a proposal link, then both use the same route shape.
- **Source refs:** resources/views/user/salesdocs/public.blade.php; app/Services/Inbox/NotificationDispatcher.php:205-221.
- **Port notes:** one public route; `type` returned by the API.

### WD-EST-009 — Estimate-specific copilot behaviour (`doc_type: estimate`, convert claim)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** WD-PROP-019..021
- **Summary:** The copilot creates, lists and sends estimates through the quote tools with `doc_type=estimate` (the tool description says "estimate for a quick quote"). The user docs also promise "convert an accepted estimate into an invoice" and "Convert estimate #12 to an invoice" from chat; there is no convert tool (the toolset has `create_invoice` which takes buyer and items, not a document id), so that claim is docs-only.
- **Actors & access:** copilot caller.
- **UX & screens:** copilot confirmation "I'll create a estimate ..." grammar is built from the type word.
- **Endpoints:** none.
- **Data:** as WD-PROP-019.
- **Rules & edge cases:** an estimate created via chat gets `EST-` numbering; "which estimates are still open?" is answerable only from the 20 most recent documents with their status (no filter).
- **Async & events:** copilot audit.
- **External systems:** LLM provider.
- **Settings:** copilot settings.
- **Acceptance criteria:**
  - Given "create an estimate for Priya: 2 hours consulting at 80", then an `EST-` draft is created after confirmation.
  - Given "convert estimate EST-0001 to an invoice", then in WaDesk the copilot has no tool for it (target: add `convert_quote`).
  - Given "send the estimate to Priya", then WD-PROP-021 applies.
- **Source refs:** app/Services/AiCrm/CrmToolkit.php:283-355; Documentation/pages/ai/ai-crm-copilot.html:86-87, 127-133; app/Services/AiCrm/AiCrmCopilotService.php:315-317.
- **Port notes:** add `convert_quote` and a status filter in the ai-agents tool registry.

## Data model

### `sales_docs` (live DDL checked)

Purpose: both proposals and estimates. Read and written by WD-PROP-003..013, 015..017, 019..022, WD-EST-001..008. Row volume: tens to low thousands per workspace. No soft delete. `created_at`/`updated_at` timestamps.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| id | bigint unsigned auto | no | | PK |
| workspace_id | bigint unsigned | no | | indexed; the tenant key |
| doc_type | varchar(20) | no | `proposal` | `proposal` or `estimate` |
| number | varchar(40) | yes | | `PRO-0001` / `EST-0001`, not unique |
| seq | bigint unsigned | no | 0 | per (workspace, doc_type), `max+1`, not unique |
| status | varchar(20) | no | `draft` | `draft, sent, accepted, rejected, expired, invoiced` (no DB enum or check) |
| title | varchar(255) | yes | | plain text |
| contact_id | bigint unsigned | yes | | indexed, never written |
| company_id | bigint unsigned | yes | | indexed; written; no FK |
| deal_id | bigint unsigned | yes | | indexed, never written |
| buyer_name | text | yes | | encrypted cast |
| buyer_email | text | yes | | encrypted cast; not validated as an email |
| buyer_phone | text | yes | | encrypted cast; never captured by the UI |
| currency | varchar(8) | no | `USD` | workspace currency at create |
| currency_exponent | tinyint unsigned | no | 2 | 0 for the zero-decimal list |
| subtotal_minor | bigint | no | 0 | sum of line totals |
| discount_minor | bigint | no | 0 | always 0 |
| tax_minor | bigint | no | 0 | |
| total_minor | bigint | no | 0 | subtotal + tax |
| tax_rate_bp | int unsigned | no | 0 | basis points, whole document |
| items_json | longtext | yes | | array cast: `[{description, qty, unit_price_minor, line_total_minor}]` |
| notes | text | yes | | encrypted cast, max 5000 on input |
| valid_until | date | yes | | date only |
| sent_at | timestamp | yes | | first send/mark-sent |
| decided_at | timestamp | yes | | last accept/reject (staff or public) |
| invoice_id | bigint unsigned | yes | | set on conversion, no FK |
| public_token | varchar(64) | yes | | UNIQUE `sales_docs_public_token_unique` |
| owner_id | bigint unsigned | yes | | not validated as a member |
| created_by | bigint unsigned | yes | | |

Indexes: PK; unique `public_token`; `(workspace_id, doc_type, status)`; single-column indexes on `workspace_id`, `contact_id`, `company_id`, `deal_id`. No FKs. Seeded rows exist only if the demo seeder ran (the reference DB: no workspace data, see "Open questions").

### Tables written by side effects (owned elsewhere)

- `messages` (WD-PROP-011, 021): outbound WhatsApp row, columns `user_id, workspace_id, direction, to_number, body, status, failure_reason, sent_at`.
- `invoices`, `invoice_items`, `invoice_tax_summaries` (WD-PROP-012): created by `InvoiceService`; `invoices.meta_json.from_sales_doc` is the back-reference.
- `inbox_notifications` (WD-PROP-017): `type=sales_doc_decided`.
- `currencies` (read for symbols), `workspaces.currency` (read), `invoice_settings.currency` (read by the copilot), `companies` (read), `workspace_user` and `users` (read for the unused members list), `packages` (plan flags).

### Target data model hints

`sales_docs` plus `sales_doc_items` plus `sales_doc_events` (status history: type, actor kind user/buyer/system, ip, user agent, signer name, at) plus `source` and `rowVersion`; money as `bigint` minor units, `qty numeric(18,4)`, `tax_rate_bp int`; token stored hashed with `token_expires_at` and `first_viewed_at`; composite FKs `(org_id, company_id)`, `(org_id, contact_id)`, `(org_id, deal_id)`, `(org_id, invoice_id)`; unique `(org_id, doc_type, seq)`.

## Cross-domain contracts

Consumes:

- **plans-subscriptions-trials:** feature flag `access_sales_pipeline` (route gate, soft for GET) and `auto_invoice` plus cap `auto_invoice_max_monthly` (conversion).
- **workspaces-teams-tenancy:** `users.current_workspace_id` scope; `workspaces.currency` at create; member list.
- **companies (CRM):** company id validation, picker (500 newest) and name display.
- **invoicing:** `InvoiceService::issue(InvoiceDraft)` and `renderAndSend(Invoice)`; `InvoiceDraft` fields used: source `manual`, docType `tax_invoice`, currency, exponent, buyer name/email/phone, items (description, qty, unit_price_minor, line_subtotal_minor, line_discount_minor 0, tax_rate 0, tax_amount_minor 0), taxSummary (one "Tax" line), subtotal, discount, shipping 0, tax, total, trigger `manual`, meta `from_sales_doc`.
- **whatsapp-devices-baileys / whatsapp-cloud-api-waba / wallet-message-billing:** `WhatsAppDispatcher::send(Message)`; a `messages` row per send.
- **notifications-activity-audit:** `NotificationDispatcher::notifySalesDocDecided`; web push via `ti_pwa_enabled`.
- **coupons-credits-referral-currency:** `Currency::symbolFor`.
- **platform-settings-branding:** `brand_name()` on the public page.

Exposes:

- **calendar (dashboards-analytics-charts):** `sales_docs.valid_until` events.
- **ai-agents (copilot):** tools `create_quote`, `list_quotes`, `send_quote` (live in `CrmToolkit`; they write `sales_docs` directly, bypassing the controller).
- **invoicing:** `invoices.meta_json.from_sales_doc` back-reference.
- **deals-pipelines / contacts-attributes-tags:** dormant `deal_id`, `contact_id` columns; nothing consumes them (WD-DEAL-039).
- **Not exposed:** no outbound webhook events, no REST API (`/api/v1`) endpoints, no flow-builder trigger or node, no workspace data export entry were found for sales documents.

## Open questions & quirks

- The reference DB's seeded admin has no workspace, so `/proposals` could not be exercised live; all behaviour here is from code and the DDL. The live table had no data to sample (not queried beyond DDL and counts).
- `WhatsAppDispatcher`, `InvoiceSender` and the wallet charge for the outbound message were not read; whether a send is billed, queued or window-restricted is unknown.
- QUIRK: `members` and `me` are passed to the index view and never used; `owner_id` is accepted by the server and absent from the form.
- QUIRK: the controller doc says the doc type is "fixed per route group", but only index and store honour it (WD-EST-001 rule 1).
- QUIRK: the model's `isExpired()` and `contact()` are unused; `sales_docs.contact_id`/`deal_id`/`discount_minor` are dead.
- QUIRK: the delete icon is a minus glyph, easily mistaken for a collapse control.
- QUIRK: the controller computes `$brand` in `sendWhatsApp` and never uses it.
- The user docs (`commerce/proposals-estimates.html`) overstate: contact picker, discount, notes and terms, currency picker, editable drafts, duplicate, deal link, auto-expiry, accept audit trail and "linked back to the customer" on the invoice. The copilot docs overstate "convert estimate #12" (no tool).
- Plan docs: `config/plan_gates.php` has no proposals/estimates entries; the paywall comes from the middleware's shared view data.

## Differences to decide

| Id | WaDesk behaviour | Why it matters | Recommendation |
| --- | --- | --- | --- |
| D-01 | The create modal has no buyer phone field, and there is no edit route, so the Send button always fails for UI-created documents. Copilot-created ones also lack a phone. | The headline "send on WhatsApp" flow is broken out of the box. | Fix: capture phone (E.164) and contact in create/edit; derive from the linked contact. |
| D-02 | No role or permission gate (any agent or viewer can create, send, convert, delete); nav shows the entries to `admin` tier only. | Privilege and data exposure. | Fix: permission keys `salesdocs.view/create/send/convert/delete` mapped to manager+ by default; agents read-only. |
| D-03 | One whole-document tax rate, tax-exclusive, no discount, no per-line tax; invoice lines get zero tax. | Cannot quote mixed rates (GST slabs, VAT); docs promise a discount. | Change: per-line tax rate and per-line plus document discount; copy to invoice lines. Keep the whole-doc rate as a default. |
| D-04 | No `viewed` status and no view tracking; docs and the assignment expect it. | Sales follow-up signal. | Add `first_viewed_at`, a `viewed` event (not a status that blocks others) and an owner notification. |
| D-05 | Expired documents can still be accepted publicly; expiry runs only when a staff user opens the list; the public page shows a past-due `sent` as open. | Legal and trust: buyer accepts a lapsed price. | Fix: daily sweep plus read-time check; public page shows "expired" and blocks accept (409) unless the owner extends or reopens. |
| D-06 | Numbering is `max+1` without lock or unique index, and a deleted newest number is reused. | Duplicate or reused document numbers. | Fix: locked counter and unique index; never reuse; configurable prefix and padding. |
| D-07 | Accept and convert do not touch deals, contacts, projects or payments; `deal_id`/`contact_id` unused. | Pipeline value and 360 views miss quotes. | Add links and events: on accept optionally advance the deal; show quotes on deal/contact/company; carry links to the invoice. |
| D-08 | Delivery is WhatsApp text only; no email, no PDF, no template message. | Many buyers need email/PDF; WABA outside 24h needs templates. | Add email send and a quote PDF; use a WABA template when outside the window. |
| D-09 | Convert has no status guard, no transaction, ignores render/send failures, copies no links, and the invoice shows "#id" not number on repeat. | Duplicate invoices, silent failures. | Fix: require `accepted` (setting to allow `sent`), one transaction, idempotency key, surface invoice send state, copy contact/company/deal. |
| D-10 | Client preview math (no per-line rounding, locale formatting, qty step 1) differs from server math. | Total shown vs saved can differ by one minor unit; fractional qty blocked. | Fix: one shared money function; step by qty precision. |
| D-11 | Public accept captures nothing but `decided_at`; no signer, IP, comment, terms checkbox; decision can be repeated or contradicted by staff. | No proof of acceptance. | Add signer name/checkbox/typed signature, IP, UA, immutable event row; make a buyer decision final unless staff reopen. |
| D-12 | Currency source differs: controller uses `workspaces.currency`, copilot uses `invoice_settings.currency`. | A chat-created estimate can be in a different currency than a form-created one. | Fix: one org currency setting (plus an optional per-document currency). |
| D-13 | `{id}` routes ignore `doc_type` (an `/estimates/{id}` call can act on a proposal). | Cross-type edits, wrong labels. | Fix: enforce type on every id route or drop the type from the path. |
| D-14 | `owner_id` not validated (any user id, even outside the workspace); a platform admin with no workspace writes `workspace_id = 0`. | Data integrity and leakage. | Fix: owner must be an org member; require an org context. |
| D-15 | Staff status PATCH allows any transition, no history, accept by staff does not notify, `rejected` has no UI. | Ghost states, unauditable. | Fix: explicit state machine, history table, Reject button, notify consistently. |
| D-16 | Public page lacks `noindex`, `no-store`, seller identity, terms; shows buyer email and phone to link holders; token is a long-lived bearer secret with no revoke. | Privacy and brand. | Fix: headers, seller block, regenerate/revoke link, optional expiry, hide phone. |
| D-17 | Status labels, flash messages, notification text and the WhatsApp body are English only. | i18n/RTL parity. | Translate all user-visible strings; localise the public page and message body per buyer language. |
| D-18 | List has no search, filter, bulk action, export; "Open value" counts only sent+accepted. | Usability at volume. | Add search (number, title), status chips, date range, CSV export; keep the tile and add counts by status. |
| D-19 | The create form's error handling reloads the page, loses input and keeps the modal closed. | Poor UX. | Inline validation in the modal with preserved state. |
| D-20 | Hard delete of any status including invoiced; no audit, outbox event or webhook for any sales-document change. | No trace, integration gaps. | Audit every write; emit `salesdoc.created/sent/accepted/rejected/expired/invoiced/deleted` outbox events and webhooks; block deleting `invoiced`. |

## Coverage

```json wadesk-coverage
{
  "routes": [
    "GET proposals",
    "POST proposals",
    "PATCH proposals/{id}",
    "POST proposals/{id}/convert",
    "POST proposals/{id}/send",
    "DELETE proposals/{id}",
    "GET estimates",
    "POST estimates",
    "PATCH estimates/{id}",
    "POST estimates/{id}/convert",
    "POST estimates/{id}/send",
    "DELETE estimates/{id}",
    "GET q/{token}",
    "POST q/{token}/accept",
    "POST q/{token}/decline"
  ],
  "controllers": ["app/Http/Controllers/SalesDocsController.php"],
  "services": [],
  "models": ["SalesDoc"],
  "tables": ["sales_docs"],
  "views": [
    "resources/views/user/salesdocs/index.blade.php",
    "resources/views/user/salesdocs/public.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": ["app/Http/Middleware/EnforcePlanFeature.php"],
  "node_files": [],
  "js_assets": ["resources/js/charts/user-salesdocs-index.js"],
  "misc_files": [],
  "config_files": [],
  "doc_pages": ["Documentation/pages/commerce/proposals-estimates.html"],
  "feature_map": {
    "WD-PROP-001": ["GET proposals", "POST proposals", "PATCH proposals/{id}", "POST proposals/{id}/convert", "POST proposals/{id}/send", "DELETE proposals/{id}"],
    "WD-PROP-003": ["GET proposals"],
    "WD-PROP-005": ["POST proposals"],
    "WD-PROP-010": ["PATCH proposals/{id}"],
    "WD-PROP-011": ["POST proposals/{id}/send"],
    "WD-PROP-012": ["POST proposals/{id}/convert"],
    "WD-PROP-013": ["DELETE proposals/{id}"],
    "WD-PROP-014": ["GET q/{token}"],
    "WD-PROP-015": ["POST q/{token}/accept"],
    "WD-PROP-016": ["POST q/{token}/decline"],
    "WD-EST-001": ["GET estimates"],
    "WD-EST-002": ["POST estimates"],
    "WD-EST-004": ["PATCH estimates/{id}"],
    "WD-EST-005": ["POST estimates/{id}/send"],
    "WD-EST-006": ["POST estimates/{id}/convert"],
    "WD-EST-007": ["DELETE estimates/{id}"],
    "WD-EST-008": ["GET q/{token}", "POST q/{token}/accept", "POST q/{token}/decline"]
  }
}
```

## Port decisions

Recorded by the API port of proposals and estimates. The default was to **fix clear bugs and keep intended behaviour**; every place the
port differs from WaDesk is listed here with the "Differences to decide" row it settles. Code: `apps/api/src/modules/crm/sales-docs`,
contracts in `packages/contracts/src/sales-docs/`, migrations `20261006100000_sales_docs_reshape.sql` and
`20261006100100_sales_docs_permissions.sql`, endpoints in `docs/api/sales-proposals-estimates.md`, tests in
`apps/api/test/{unit,integration,e2e}/sales-docs`.

### Decided as recommended (fixes)

| Diff # | Decision | Where |
| ------ | -------- | ----- |
| D-01 | The buyer is captured: `buyerName`, `buyerEmail` (validated) and `buyerPhone` (E.164) on create and edit, and default to the linked contact's (a deal brings its contact and company). Sending has three channels (`email`, `whatsapp`, `link`) and a missing recipient is `422 SALESDOC_NO_RECIPIENT`, not a flash that always fires. | WD-PROP-005, 011 |
| D-02 | Permissions are keys, not "any member": `record.sales-docs.read/create/update/send/convert/delete/settings` (one set for both kinds: it is one engine), registered in `permission_defs`, granted to Admin (all) and to the Agent / Counsellor preset (read, update, send on `own`; create). The record scope is on the PEOPLE of the document: `own` = owned by me or created by me, `team` adds teammates, `all` is everyone; out of scope is 404. The plan gate is the shared `sales_pipeline` feature through `SalesPipelineGuard` (no new plan key), and covers reads (`422 PLAN_FEATURE_LOCKED`); the buyer's public page is not plan gated. | WD-PROP-001 |
| D-03 | Pricing has a per-line discount (percent or amount), a per-line tax rate (absent follows the document's default rate), a document discount (percent or amount) and tax added on top. The document discount is spread over the lines by largest remainder so a mixed-rate document taxes each line on what it costs. The invoice port receives the per-line tax rate and amount (WaDesk invoices got zero tax per line and a summary line). The currency decides the decimals (0, 2 or 3). | WD-PROP-006, 028 |
| D-04 | `viewed` is a status: the buyer's first open of a sent document moves it to `viewed` (`first_viewed_at`, a timeline row, `salesdoc.viewed` once); later opens only count (`view_count`, `last_viewed_at`). A viewed document is decided, expired and revised like a sent one. The owner notification is a consumer of the event (notifications domain). | WD-PROP-030 |
| D-05 | Expiry is a worker sweep (every 5 minutes, per organization time zone, `SKIP LOCKED`) with a timeline row, an audit row and `salesdoc.expired`, and the buyer's page and the accept route test the date at read time, so a lapsed document is never shown as open and **cannot be accepted** (`409 SALESDOC_EXPIRED`; staff cannot accept it either). A document is valid through the whole of its valid-until day in the workspace's zone. Drafts do not expire. `extend` (new date) and `revise` bring a lapsed document back. | WD-PROP-004 |
| D-06 | Numbers come from `sales_doc_counters`: one row per organization and type, allocated with one `INSERT .. ON CONFLICT DO UPDATE .. RETURNING` (the row lock serialises concurrent creators, a rollback gives the number back, nothing lowers it), with `UNIQUE (org_id, doc_type, seq)` and `UNIQUE (org_id, number)`. A deleted number is never reused. The prefix (`PRO`, `EST`), the padding (4) and the first number are per-organization settings that shape only the next numbers. The allocator is tested from 12 concurrent connections. | WD-PROP-008, WD-EST-003 |
| D-07 | `contact_id`, `company_id`, `deal_id` are real links (composite foreign keys, `ON DELETE SET NULL`), set on create and edit and filterable; `GET /contacts/:id/sales-docs` and `GET /deals/:id/sales-docs` list them. `POST /sales-docs/:id/convert/deal` creates and links a deal (title, total, currency, contact, company, owner, in the default pipeline's first stage). The invoice port receives the contact, company and deal ids so the invoice can carry the same links. **Not done:** accepting does not move the deal to a stage automatically (an organization setting for it is a follow-up). | WD-PROP-025 |
| D-08 | Email is real: the link, total and validity are mailed through the mail port (the transaction is not held open across the send; a transport failure is `502 SALESDOC_SEND_FAILED` and the document is unchanged). WhatsApp emits `salesdoc.delivery_requested` and marks the document sent; the delivery adapter belongs to the messaging domain (**TODO**, nothing reaches the buyer until it exists). The PDF is a print-optimised, escaped HTML page (`GET /sales-docs/:id/print`, and the buyer's `/print`): the repo has no PDF library, so a server-side PDF file is a follow-up. | WD-PROP-011, 030 |
| D-09 | Conversion to an invoice needs `accepted`, runs through `SALES_DOC_INVOICE_PORT` **inside one transaction** with the link back and the status `converted` (composite foreign key `(org_id, invoice_id)`), carries an idempotency key per document and the per-line tax, links and buyer, and fails loudly (a failure in the port rolls everything back, nothing is swallowed). Twice is `409 SALESDOC_ALREADY_CONVERTED`. The invoicing module binds the token (`InvoiceConversionService` in `modules/crm/invoicing`, which builds a DRAFT invoice linked by `quote_id`); a deployment without a binding answers `501 SALESDOC_INVOICING_UNAVAILABLE`. Allowing "convert directly from sent" as an organization setting is not built. | WD-PROP-012, WD-EST-006 |
| D-10 | One pure money function in `@crm/contracts` (`computeSalesDoc`) serves the API and the form preview; one rounding rule (half up to the minor unit at the step an amount is produced), exact `bigint` arithmetic, quantities with up to 4 decimals, the decimals of the currency. Golden tests cover the spec's examples and 300 random documents for the invariants. | WD-PROP-006, 007 |
| D-11 | A buyer decision needs the signer's name (2-120 characters) and a consent flag; an email, a drawn PNG signature and a comment are optional. Signer, signature, comment, IP, user agent, revision and time go into an append-only timeline row (signer, signature and comment encrypted at rest, never copied to an audit row or an outbox event); `accepted_revision` binds the decision to the revision shown. The same decision again is a replay (`replay: true`, one event); the opposite one is `409 SALESDOC_ALREADY_DECIDED`; staff revise to start again. | WD-PROP-015, 016 |
| D-12 | One currency source: `organizations.settings.currency`, else the default pipeline's, else `USD`, and a per-document `currency` (fixed while draft unless the lines are re-sent with it). Copilot and form writers use the same service. | WD-PROP-006, 019 |
| D-13 | One engine, no per-type paths: `kind` is a body field and a filter, every `:id` is a uuid in one table, so an id can never be applied to the other kind. | WD-EST-001 |
| D-14 | The owner must be an active member of the workspace (`422 SALESDOC_OWNER_INVALID`; omitted = the caller, `null` = nobody); every request has an organization (RLS), so there are no `workspace_id = 0` rows. | WD-PROP-005, 001 |
| D-15 | An explicit status machine (`nextStatus` in `sales-doc-rules.ts`, unit-tested against the whole status x action matrix) answers `409 SALESDOC_INVALID_TRANSITION`; every transition writes a timeline event; staff can record an acceptance or a decline (`POST /:id/accept`, `/decline`) in the timeline as theirs, and emit the same events as a buyer decision (`by: staff`). | WD-PROP-010 |
| D-16 | The public link is 256 random bits (43 base64url characters), looked up by SHA-256 (the plaintext is stored only encrypted, so staff can copy the link again), with an optional expiry (workspace default `linkTtlDays`, or per link), `regenerate` and `revoke`. The page is `no-store`, `noindex`, `no-referrer`, shows the seller's name and the terms, and **hides the buyer's email and phone**. Unknown, malformed and draft tokens are 404; revoked or expired links are `410`. Throttled per IP and per link. **Not done:** the seller's logo, address and tax id on the page and the print (they live in the workspace settings domain). | WD-PROP-009, 014, 018 |
| D-17 | The API answers stable codes and data, not prose; the web owns the wording and translations. The email body is English only (a follow-up with the localization domain). | WD-PROP-023 |
| D-18 | The list has a cursor (microsecond keyset), search (number, title, contact and company name), filters (kind, status, owner, mine, contact, company, deal, currency, valid-until window) and `GET /sales-docs/counts` (per status, open value per currency). **Not done:** CSV export. | WD-PROP-003 |
| D-19 | A validation failure is `422` with one detail per field path (`lines.2.unitPrice`) and `SALESDOC_AMOUNT_INVALID` for amounts, so a form keeps its input and shows errors inline. | WD-PROP-005 |
| D-20 | Every write is audited and emits an outbox event in the same transaction (`salesdoc.created / updated / sent / delivery_requested / viewed / accepted / declined / expired / revised / extended / converted / deleted`); accepted and converted documents cannot be deleted (`409 SALESDOC_NOT_DELETABLE`); a deleted document keeps no trace in the numbering. The event payloads hold identifiers only. Webhooks are a consumer of the outbox. | WD-PROP-013 |

### Decisions the spec did not list

| Decision | Why |
| -------- | --- |
| Statuses are `draft, sent, viewed, accepted, declined, expired, converted` (WaDesk: `rejected`, `invoiced`, no `viewed`). Enforced by a CHECK, with CHECKs that the stamps agree (`decided_at` on a decided document, `sent_at` on an open one, `first_viewed_at` on a viewed one) and that `total = subtotal - discount + tax`. | The vocabulary of the docs and the code disagreed; the database now refuses a row that is not one of them. |
| The lines are rows (`sales_doc_items`: qty `numeric(18,4)`, unit price, discount, tax rate, the computed amounts), not a JSON column. | Addressable lines, a CHECK per line, and the shape the invoice port wants. |
| Revisions: `revise` keeps the current content in `sales_doc_revisions` (snapshot, total) and raises `revision`; the next edit works on the draft. Duplicate is the other path (a new document, optionally the other kind). | WD-PROP-029 "duplicate / revise", and the buyer's link keeps pointing at the same document. An accepted document is final. |
| The timeline is `sales_doc_events`, append-only (a trigger refuses any update except the foreign key clearing the actor of a deleted user). | D-11 / D-15: proof of what happened. |
| Buyer name, email, phone and notes are encrypted at rest (AES-GCM through `CryptoService`) as WaDesk's cast did, and are not searched; the search covers the number, the title and the linked contact's and company's names. | WD-PROP-024. |
| A draft is not public: its token answers 404 until the document is sent. | A half-written price should not be reachable by a link that was copied early. |
| `viewed` does not block anything: a sent or a viewed document is accepted, declined, expired and revised the same way. | It is a follow-up signal (D-04), not a gate. |
| Templates of default terms and notes (`sales_doc_templates`, one default per kind, a name unique per kind) apply on create; a duplicate does not apply one. | The "templates" of WD-PROP-030. |
| `terms` is a field of the document. | The docs promised "notes & terms"; WaDesk had only notes. |
| The module settings (prefix, padding, start, default validity, link lifetime) are their own table and capability (`record.sales-docs.settings`). | Numbering is configuration, not a per-user preference. |

### Follow-ups (not built)

* **Server-side PDF** (a worker job writing to media storage). Today: the print-optimised HTML page.
* **WhatsApp delivery**: a subscriber of `salesdoc.delivery_requested` in the messaging domain (template message outside the 24 h window,
  delivery result back onto the timeline).
* **Notifications** (WD-PROP-017): built for the buyer's decision (`SalesDocNotificationConsumer`: owner and creator, deep link to the
  document). Still to do: `salesdoc.viewed / expired` and the org admins by preference.
* **AI copilot tools** (WD-PROP-019..021): call `SalesDocsService.create(input, 'ai')`; add `convert_quote` (WD-EST-009).
* **Calendar** (WD-PROP-022): read `GET /sales-docs?validFrom&validTo` and deep-link to the document.
* The seller block (logo, address, tax id) on the public page and the print; localization of the email and the public page.
* An organization setting to advance a deal on accept (D-07), to allow converting from `sent` (D-09), and late acceptance (D-05).
* Reminders before expiry; CSV export; deposits, payment links and optional line items (WD-PROP-030 items 9, 10).
