---
domain: bsp-billing-engine
code: BSP
title: BSP Reseller Billing Engine
threadwise_version: '1.7.0'
sources_read: 46
---

# BSP Reseller Billing Engine

## Overview

Reference can be run as a WhatsApp **reseller** (Business Solution Provider style). The platform owner
(super-admin) holds a Meta "Solution Partner" relationship with a Meta **extended credit line**. Each
customer workspace that connects a WhatsApp Business Cloud API (WABA) number chooses one of two
per-workspace billing modes:

- **meta_direct** ("I pay Meta directly", the default): the customer's own payment method is on Meta,
  Reference runs the classic plan system (monthly message allowance), and no per-message wallet charge occurs.
- **reseller** ("Bill me through us"): the platform's credit line is shared onto the customer's WABA
  so Meta invoices the platform; the customer pre-pays a money wallet inside Reference and every delivered
  message is charged from that wallet at the platform's per-country x category price. The platform's
  margin is customer price minus Meta wholesale cost.

The BSP code that survives in v1.7.0 (`app/Bsp/*`, `routes/bsp.php`, two Blade views, one table) is only
the **reseller-specific slice** of that story. The older, larger BSP add-on (separate rate cards, BSP
wallet, top-ups, usage events, accounts, markup) was **merged into the core wallet and then dropped**
(migration `2026_08_11_150000_drop_bsp_duplicate_wallet_tables`). What the BSP module owns now:

1. An admin console to store the Meta Solution-Partner credentials (Business ID, system-user token,
   extended-credit-line id, Graph API version, rates endpoint, auto-attach toggle and default currency).
2. Attaching / revoking the platform credit line on customer WABAs through Meta's Graph API, with one
   record per (workspace, WABA) in `bsp_credit_allocations` (attach one, attach all, auto-attach on
   connect, revoke).
3. The customer-side billing-mode choice (a POST on `/devices`, rendered as two cards on the WABA
   section), which flips `workspaces.bill_to_platform_credit` and attaches the credit line.
4. The reseller P&L dashboard (`/admin/bsp`): revenue vs Meta cost vs margin, this-month only, platform
   total and per-workspace, read from the per-message ledger `message_charges`.
5. A health probe and a legacy URL redirect.

Everything money-moving (wallet, message rates grid, top-up checkout, charge-on-delivery settle/refund,
launch precheck, low-balance alerts) is **owned by WALLET** (`wallet-message-billing`). This file
documents those pieces only where BSP behavior depends on them (features TW-BSP-012, -016, -017) and
records the exact contract so the two domains can be split between developers.

Actors: super-admin/admin (`EnsureUserIsAdmin`: Spatie role Super Admin or Admin, or legacy `users.role`
in `admin`/`A`); workspace admin (`EnsureWorkspaceRole:admin`) for the customer choice; Meta Graph API
as the external system. There are **no permission keys** and **no plan feature keys** for any BSP
screen; plans do not gate reselling. The routes are also **not** behind the IP allowlist middleware that
other `/admin/*` pages use.

Cross-domain links: WALLET (wallet, message_rates, message_charges, settle engine, payment gateways for
top-up), WADEV/WABA (WaProviderConfig rows holding the WABA id in the encrypted credentials blob; the
saved-hook that triggers auto-attach; the `/devices` page where the billing cards render), WSP (the
`workspaces.bill_to_platform_credit` and `currency` columns; admin workspace create/edit), SET
(`system_settings`, encrypted-keys list, currencies), PAYGW/CPN (gateway + currency conversion),
MOB/EXT (`is_bsp` / `billing_mode` fields exposed to mobile and the Chrome extension), ASHELL (admin
sidebar group "Billing").

## Feature index

| Id         | Feature                                                                    | Status      | Priority | Effort | Depends on             |
| ---------- | -------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------------------- |
| TW-BSP-001 | BSP health/status probe                                                    | implemented | P2       | S      | -                      |
| TW-BSP-002 | Billing navigation entries and legacy rate-cards redirect                  | implemented | P2       | S      | TW-BSP-003, TW-BSP-014 |
| TW-BSP-003 | Reseller billing console screen (Connect Meta and credit lines)            | implemented | P0       | M      | TW-BSP-004, TW-BSP-010 |
| TW-BSP-004 | Save Meta reseller connection settings                                     | implemented | P0       | S      | -                      |
| TW-BSP-005 | Meta credit-source adapter: configuration check and credit-line resolution | implemented | P0       | M      | TW-BSP-004             |
| TW-BSP-006 | Attach the credit line to one customer WABA                                | implemented | P0       | M      | TW-BSP-005             |
| TW-BSP-007 | Attach all connected WABAs (backfill and retry)                            | implemented | P1       | S      | TW-BSP-006             |
| TW-BSP-008 | Auto-attach when a WABA connection is saved                                | implemented | P1       | S      | TW-BSP-006             |
| TW-BSP-009 | Revoke a credit allocation                                                 | implemented | P1       | S      | TW-BSP-005             |
| TW-BSP-010 | Credit allocation register (attached accounts table)                       | implemented | P1       | S      | TW-BSP-006             |
| TW-BSP-011 | Customer billing-mode choice (meta_direct vs reseller)                     | implemented | P0       | M      | TW-BSP-006             |
| TW-BSP-012 | Reseller billing gate consumed by the message-billing engine               | implemented | P0       | L      | TW-BSP-011             |
| TW-BSP-013 | Admin-side workspace flag bill_to_platform_credit (create/edit)            | partial     | P2       | S      | TW-BSP-012             |
| TW-BSP-014 | Reseller P&L dashboard: platform totals                                    | implemented | P0       | M      | TW-BSP-016             |
| TW-BSP-015 | Reseller P&L dashboard: per-workspace table                                | implemented | P1       | S      | TW-BSP-014             |
| TW-BSP-016 | P&L data feed: revenue and Meta cost stamped per message                   | implemented | P0       | M      | TW-BSP-012, TW-BSP-017 |
| TW-BSP-017 | Meta wholesale cost source (live rates endpoint, sync, import)             | implemented | P1       | M      | TW-BSP-004             |
| TW-BSP-018 | Per-client and platform markup configuration                               | docs-only   | P2       | M      | TW-BSP-012             |
| TW-BSP-019 | Dedicated BSP wallet, top-up packages, usage events, rate-card tables      | dead-code   | P2       | S      | -                      |
| TW-BSP-020 | Alternative credit sources (aggregator, partner)                           | docs-only   | P2       | L      | TW-BSP-005             |
| TW-BSP-021 | Three-step share/attach and revoke-by-discovery Graph flows                | docs-only   | P2       | S      | TW-BSP-006             |

## Features

### TW-BSP-001 — BSP health/status probe

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** An admin-only JSON endpoint that confirms the BSP module is booted and reports a few facts about its configuration and table. It is a leftover from when BSP was a loadable add-on and is not linked from any UI.
- **Actors & access:** Authenticated admin (`auth` + `admin` middleware, i.e. `EnsureUserIsAdmin`). No permission key, no plan gate. Non-admins get HTTP 403 with the text "Admins only." Not behind the IP allowlist.
- **UX & screens:** No screen. Raw JSON only. Not referenced from the sidebar or any Blade view.
- **Endpoints:**

| Endpoint               | Route name         | Controller                                            | Middleware                           | Request | Response            |
| ---------------------- | ------------------ | ----------------------------------------------------- | ------------------------------------ | ------- | ------------------- |
| `GET admin/bsp/status` | `admin.bsp.status` | `App\Bsp\Http\Controllers\BspStatusController@status` | web, Authenticate, EnsureUserIsAdmin | none    | 200 JSON (see Data) |

- **Data:** Response keys: `ok` (always true), `module` ("bsp"), `booted` (true), `merged` (true, hard-coded to say pricing/wallet were merged into core), `enabled` (setting `bsp_enabled`, default true), `graph_version` (setting `bsp_graph_version`, default `v26.0`), `credit_allocations_table` (bool: table exists), `credit_allocations` (row count of `bsp_credit_allocations`, 0 if the table is missing), `meta_cost_column` (bool: `message_rates.meta_cost_minor` exists). Reads `system_settings`, `bsp_credit_allocations`, and the schema.
- **Rules & edge cases:**
  1. `enabled` reflects setting `bsp_enabled`, but nothing in the codebase ever writes that setting nor reads it to disable a route (QUIRK: it is informational only; the module cannot be switched off).
  2. The response never contains secrets (token is not echoed).
  3. Schema checks make it safe to call before migrations.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `bsp_enabled` (never set, default true), `bsp_graph_version`.
- **Acceptance criteria:**
  - Given a signed-in admin, When GET `admin/bsp/status`, Then the response is 200 JSON with `ok=true`, `module="bsp"`, and `credit_allocations` equal to the current row count.
  - Given a signed-in non-admin workspace user, When GET the same URL, Then the response is 403.
  - Given an unauthenticated visitor, When GET the URL, Then they are redirected to login.
  - Given the Graph version setting is blank/unset, When the probe runs, Then `graph_version` is `v26.0`.
- **Source refs:** `app/Bsp/Http/Controllers/BspStatusController.php`, `routes/bsp.php`.
- **Port notes:** Not needed as a product feature. If kept, expose as an admin-only `/admin/reseller/status` or fold into a generic module health endpoint. New home would be `apps/api/src/modules/billing/reseller/`. Drop the `enabled` flag or make it a real feature flag.

### TW-BSP-002 — Billing navigation entries and legacy rate-cards redirect

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-BSP-003, TW-BSP-014
- **Summary:** The admin sidebar exposes the reseller pages under the "Billing" group, the two BSP screens cross-link to each other and to the core "Message pricing" page, and the old `/admin/bsp/rate-cards` URL forwards to the core pricing page.
- **Actors & access:** Admin only (same middleware as every BSP route).
- **UX & screens:** `resources/views/components/admin/sidebar.blade.php` (Billing group): labels "Message pricing" (`/admin/settings/wallet-rules`, owned by WALLET), "Message income" (`/admin/bsp`, key `bsp`), "Reseller billing (Meta)" (`/admin/bsp/credit`, key `bsp-credit`). The P&L page header has three pills: "P&L" (active), "Rates & margin" (wallet-rules), "Connect Meta" (credit page). The credit page header has two buttons: "Message income" and "Message pricing", plus a breadcrumb Admin > Billing > "Meta credit & keys" where "Billing" links to the P&L dashboard.
- **Endpoints:**

| Endpoint                   | Route name                   | Controller                    | Middleware                           | Request | Response                                            |
| -------------------------- | ---------------------------- | ----------------------------- | ------------------------------------ | ------- | --------------------------------------------------- |
| `GET admin/bsp/rate-cards` | `admin.bsp.rate-cards.index` | Closure (in `routes/bsp.php`) | web, Authenticate, EnsureUserIsAdmin | none    | 302 redirect to route `admin.settings.wallet-rules` |

- **Data:** none.
- **Rules & edge cases:**
  1. The redirect is unconditional (no flash). The rate-card page it replaces was a separate BSP page; pricing and Meta cost now live on the core wallet-rules page.
  2. Sidebar highlighting uses `admin-key` values `bsp` and `bsp-credit`.
  3. There is no separate BSP wallet page; customers use the core wallet.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin, When GET `admin/bsp/rate-cards`, Then they are redirected to the Message pricing page.
  - Given an admin on the P&L dashboard, When they click "Connect Meta", Then they land on `admin/bsp/credit`.
  - Given a non-admin, When GET `admin/bsp/rate-cards`, Then 403.
- **Source refs:** `routes/bsp.php`, `resources/views/components/admin/sidebar.blade.php`, `resources/views/bsp/dashboard/index.blade.php`, `resources/views/bsp/credit/index.blade.php`, `Documentation/pages/bsp-billing/admin-pages.html`.
- **Port notes:** The redirect is only for legacy bookmarks; a fresh build can skip it. Nav entries belong to the admin shell (ASHELL); add "Message income" and "Reseller billing" under a Billing group.

### TW-BSP-003 — Reseller billing console screen (Connect Meta and credit lines)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BSP-004, TW-BSP-010
- **Summary:** One admin page, titled "Meta credit & keys" (menu label "Reseller billing (Meta)"), where the reseller connects their Meta business, optionally turns on auto-attach, attaches credit lines to customers by hand or in bulk, sees every allocation, and follows a setup guide with links to Meta's docs.
- **Actors & access:** Admin only. Not plan-gated. No audit-log entry is written for any action on this page (QUIRK).
- **UX & screens:** `resources/views/bsp/credit/index.blade.php` (layout `x-layouts.admin`, page key `bsp-credit`). Sections:
  - Header with breadcrumb and two cross-links, then the standard flash component plus explicit success (green) and error (coral) banners from the session.
  - Amber notice "Optional, only for true reselling": explains this is only needed to have Meta bill the platform, needs Solution Partner status and an approved credit line, and that everything else works without it via wallet + Message pricing.
  - **Step 1 "Connect your Meta business"** with a status pill "Connected" (green) when the source is configured (token AND business id both non-empty) else "Not connected" (amber). Form fields: Meta Business ID (required star in UI, placeholder numeric), System-user token (password input, autocomplete off, placeholder says "stored, leave blank to keep" when a token already exists, else "paste token"), Extended credit line ID (optional, "auto if blank"), Graph API version (placeholder v25.0, client-side pattern `v` + 1-2 digits + `.` + 1-2 digits, help text says default v25.0), Meta rates endpoint (URL, optional, help says used by "Sync Meta costs" on Message pricing; blank means bundled rate card or CSV). Then the **Auto-attach** toggle card (border highlighted when ON) with a "Bill in" currency select ("Auto" + every currency code in the platform `currencies` table, sorted by code). Save button "Save connection".
  - **Step 2 "Attach one customer by hand"** (whole section at 60% opacity when not configured). Header shows a hint that changes with auto-attach state, and, only when configured, an "Attach all connected now" button with a JS confirm ("Attach your credit line to every connected number that is not attached yet?"). Empty state when no WABA numbers exist: text that no customer has connected a WhatsApp Business (Cloud API) number yet and it will appear once connected under `/devices`. Otherwise a form: "Customer's WhatsApp number" select (required; first option "Pick a connected number"; each option value is `workspaceId|wabaId`, label = workspace name, phone, "WABA ..." + last 4 of the WABA id), "Bill this number in" select (required; all platform currency codes; default = platform currency if present else first code), a red "Locked once attached" note (Meta will not allow changing currency later), and an "Attach credit line" button. Form controls are disabled when not configured, with a "Finish step 1 first" note.
  - **Credit lines in use** table (see TW-BSP-010).
  - Right sticky **Setup guide** panel: 3 numbered steps (Business ID location; System-user token with the three permission chips business_management, whatsapp_business_management, whatsapp_business_messaging and "token shows once"; Credit line prerequisites and how it is auto-read), a "Good to know" list (currency locked, attaching means Meta bills you but you still set customer prices, revoke any time so the customer pays Meta directly again), plus an outbound link card to Meta's Solution Partner overview. External links open in new tabs.
- **Endpoints:**

| Endpoint               | Route name               | Controller                        | Middleware                           | Request | Response                     |
| ---------------------- | ------------------------ | --------------------------------- | ------------------------------------ | ------- | ---------------------------- |
| `GET admin/bsp/credit` | `admin.bsp.credit.index` | `Admin\BspCreditController@index` | web, Authenticate, EnsureUserIsAdmin | none    | HTML view `bsp.credit.index` |

- **Data:** View inputs: `rows` (allocations, `id` desc, paginate 50), `configured` (source isConfigured), `businessId`, `creditId`, `tokenSet` (bool only, token never sent to the page), `graphVersion` (default v26.0), `ratesEndpoint`, `wabaAccounts` (see rules), `workspaceNames` (id to name map of ALL workspaces), `autoAttach` (bool), `autoAttachCurrency` (uppercased). Settings read: `bsp_meta_business_id`, `bsp_meta_extended_credit_id`, `bsp_meta_system_user_token`, `bsp_graph_version`, `bsp_meta_rates_endpoint`, `bsp_auto_attach_credit`, `bsp_auto_attach_currency`.
- **Rules & edge cases:**
  1. The WABA picker is built from every `wa_provider_configs` row with `provider='waba'`, newest first, that has a non-empty `waba_id` inside the decrypted credentials JSON; rows without a WABA id are silently skipped. It does **not** filter on `status`, so disconnected/pending rows appear too (QUIRK; the bulk attach in TW-BSP-007 does filter on `connected`).
  2. Picker label: workspace name (fallback "Workspace #<id>"), then two-space-dot-two-space separators, phone number (fallback display label) if any, then "WABA ..." + last 4 characters of the WABA id. One workspace with several numbers yields several entries.
  3. Currency lists come from the `currencies` table (all rows, active or not, uppercased, unique). If the table is empty it falls back to the signed-in admin's resolved currency (or USD). Meta only accepts 6 currencies (see TW-BSP-006), so most options will fail on attach (QUIRK).
  4. UI copy and placeholder mention v25.0 while the stored/served default is v26.0 (QUIRK, documentation says v25.0 too).
  5. The step-2 form is fully hidden (replaced by the empty state) when no WABA accounts exist even if configured, but "Attach all connected now" still shows when configured.
  6. Table pagination links appear only when more than 50 rows exist.
- **Async & events:** none on render.
- **External systems:** none on render (Meta is called only by the POST actions).
- **Settings:** see Data.
- **Acceptance criteria:**
  - Given an admin with no Meta settings saved, When they open the page, Then the pill reads "Not connected", step 2 is dimmed with disabled fields, and no "Attach all connected now" button is shown.
  - Given business id and token are saved, When the page loads, Then the pill reads "Connected", the token field is empty with a "stored, leave blank to keep" placeholder, and the token value never appears in the HTML.
  - Given two workspaces each connected a Cloud API number with a WABA id, When the admin opens the picker, Then both appear with workspace name, phone and WABA last 4.
  - Given a WABA config row without a `waba_id`, When the picker renders, Then that row is absent.
  - Given a non-admin, When they request the page, Then 403.
- **Source refs:** `app/Bsp/Http/Controllers/Admin/BspCreditController.php` (`index`, `connectedWabaAccounts`), `resources/views/bsp/credit/index.blade.php`, `Documentation/pages/bsp-billing/admin-pages.html`, `Documentation/pages/bsp-billing/meta-setup.html`.
- **Port notes:** New Next.js admin page under `apps/web` admin area (Billing > Reseller). API: `GET /admin/reseller/settings`, `GET /admin/reseller/allocations?cursor`, `GET /admin/reseller/waba-candidates`. Never return the token. The WABA id lives in an encrypted credentials blob in Reference; in the target, keep `waba_id` as a plain column on the WABA connection table so the picker is a simple query and filter on `status='connected'`. This page is platform-scope (super-admin pool), not tenant-scoped; the allocation table itself carries `workspace_id` and needs RLS treatment consistent with the platform tables ADR (0002/0007).

### TW-BSP-004 — Save Meta reseller connection settings

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** none
- **Summary:** The admin stores the Meta Solution-Partner credentials and reseller preferences. The system-user token is encrypted at rest and is never sent back to the browser; leaving it blank keeps the stored one.
- **Actors & access:** Admin only. No permission key. No audit-log write (QUIRK).
- **UX & screens:** Step 1 form on the credit page (TW-BSP-003). After save the admin is redirected back (`back()`) with success flash "Meta connection saved."
- **Endpoints:**

| Endpoint                         | Route name                  | Controller                               | Middleware                                  | Request                                                                                                                                                                                                                                                                                                                         | Response                                                                        |
| -------------------------------- | --------------------------- | ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST admin/bsp/credit/settings` | `admin.bsp.credit.settings` | `Admin\BspCreditController@saveSettings` | web (CSRF), Authenticate, EnsureUserIsAdmin | `bsp_meta_business_id` nullable string max 64; `bsp_meta_extended_credit_id` nullable string max 64; `bsp_meta_system_user_token` nullable string max 1000; `bsp_graph_version` nullable string max 12; `bsp_meta_rates_endpoint` nullable URL max 500; `bsp_auto_attach_credit` checkbox; `bsp_auto_attach_currency` free text | redirect back with `success` flash; validation errors redirect back with errors |

- **Data:** Writes `system_settings` rows (all type `string`): `bsp_meta_business_id`, `bsp_meta_extended_credit_id`, `bsp_graph_version`, `bsp_meta_rates_endpoint`, `bsp_meta_system_user_token` (encrypted through the `SystemSetting::ENCRYPTED_KEYS` list, decrypted on read; legacy plaintext rows still read), `bsp_auto_attach_credit` ("1"/"0"), `bsp_auto_attach_currency`. Settings are cached 30 minutes and the cache key is dropped on save.
- **Rules & edge cases:**
  1. Business id, credit id, and rates endpoint are trimmed and **overwritten with blank if the field is empty** (blank = clear). Only the token is protected: it is written only when a non-blank value is submitted, so there is **no way to delete the token** from the UI (QUIRK).
  2. Graph version blank becomes `v26.0`. The server only enforces max 12 chars; the `v<N>.<N>` pattern is client-side only.
  3. Rates endpoint must be a valid URL when supplied.
  4. Auto-attach checkbox: unchecked stores "0". Currency: all non-letters are stripped, uppercased, cut to 8 characters, stored blank if nothing remains ("Auto"). It is **not** validated against the platform currency list or Meta's six allowed currencies (QUIRK: an unsupported currency here makes every auto-attach fail later).
  5. Every call must pass type `string` to the settings setter because its default type is int (documented in code as a trap: it would zero ids/tokens).
  6. Saving does not verify credentials with Meta; "Connected" only means token and business id are non-empty.
  7. The token is also used by the admin-side live Meta rate fetch (TW-BSP-017).
- **Async & events:** none. No Meta call at save time. Setting cache invalidated.
- **External systems:** none at save.
- **Settings:** the seven keys above. Defaults: business id blank, credit id blank, token blank, graph version `v26.0`, rates endpoint blank, auto-attach `0`, auto-attach currency blank.
- **Acceptance criteria:**
  - Given a saved token, When the admin saves the form with the token field blank, Then the stored token is unchanged and business id changes are applied.
  - Given the form is submitted with a non-URL rates endpoint, When saved, Then validation fails and nothing is written.
  - Given graph version blank, When saved, Then the stored version is `v26.0`.
  - Given currency input "usd1", When saved, Then `bsp_auto_attach_currency` is stored as `USD`.
  - Given the token is saved, When inspecting the stored setting row, Then the value is ciphertext, not plaintext.
  - Given the admin unticks auto-attach and saves, Then `bsp_auto_attach_credit` is "0".
- **Source refs:** `app/Bsp/Http/Controllers/Admin/BspCreditController.php` (`saveSettings`), `app/Models/SystemSetting.php` (ENCRYPTED_KEYS, get/set), `resources/views/bsp/credit/index.blade.php`.
- **Port notes:** Store as platform settings in the settings module (SET) with envelope encryption for the token; expose write-only semantic for the token plus an explicit "clear token" action (an improvement, not Reference behavior). Validate currency against Meta's allowed list in the target. Emit an audit event (Reference does not).

### TW-BSP-005 — Meta credit-source adapter: configuration check and credit-line resolution

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BSP-004
- **Summary:** A pluggable "who funds the WABA" contract with one implementation (Meta Solution Partner, "Path A"). It says whether it is configured, finds the extended credit line id when the admin did not type one, and performs attach and revoke against the Graph API.
- **Actors & access:** Internal service; invoked by admin actions, the auto-attach hook, and the customer billing choice. Also used as a gate (`isConfigured`) by the customer billing-mode UI.
- **UX & screens:** None directly. Surfaces as the "Connected / Not connected" pill (TW-BSP-003) and as the enabled/disabled state of "Bill me through us" (TW-BSP-011).
- **Endpoints:** none (service class). Graph calls below.
- **Data:** Reads settings `bsp_credit_source` (default "meta"; any other value still resolves to the Meta source, since the resolver's match has only a default arm), `bsp_meta_business_id`, `bsp_meta_extended_credit_id`, `bsp_meta_system_user_token`, `bsp_graph_version`. May write back `bsp_meta_extended_credit_id` (string).
- **Rules & edge cases:**
  1. Contract: `name()` (returns "meta", stored on the allocation row), `isConfigured()`, `attach(wabaId, currency)` returning ok/allocation_config_id/error, `revoke(allocationConfigId)` returning ok/error.
  2. `isConfigured` = token non-empty AND business id non-empty. Credit id is not required.
  3. Credit-line resolution: use `bsp_meta_extended_credit_id` if set; else `GET {base}/{business_id}/extendedcredits?fields=id,legal_entity_name` (bearer token, JSON, 20 s timeout), take `data[0].id` (the first credit line only), **cache it back into the setting**, and use it. Failure (empty result or exception) is logged and yields null; attach then fails with "No Meta extended credit line found for this business."
  4. Base URL is `https://graph.facebook.com/{bsp_graph_version}`; the version string is trusted as stored.
  5. Not-configured attach error text tells the admin to set business id + token in Admin > BSP.
  6. `bsp_credit_source` is never written by any code, so only Path A exists (see TW-BSP-020).
  7. Graph responses are logged (first 300 or 400 characters of the body on failure). Tokens are never logged.
- **Async & events:** none (all synchronous HTTP inside the request that triggered it).
- **External systems:** Meta Graph API, bearer system-user token with `business_management` scope (docs also list whatsapp_business_management and whatsapp_business_messaging for the token). Endpoints: `GET /{business_id}/extendedcredits`. Timeouts 20 s (lookup, revoke) and 30 s (attach). No retry, no rate-limit handling beyond returning the error string.
- **Settings:** listed in Data.
- **Acceptance criteria:**
  - Given token and business id are set and no credit id, When an attach is attempted, Then the service calls extendedcredits, stores the first id in `bsp_meta_extended_credit_id`, and uses it.
  - Given business id is blank, When `isConfigured` is evaluated, Then it is false regardless of the token.
  - Given extendedcredits returns no rows, When attach is attempted, Then the result is an error "No Meta extended credit line found for this business." and no allocation id.
  - Given a credit id was typed by the admin, When attach is attempted, Then no extendedcredits lookup is made.
- **Source refs:** `app/Bsp/Services/CreditSource/CreditSourceContract.php`, `app/Bsp/Services/CreditSource/MetaSolutionPartnerCreditSource.php`, `app/Bsp/Services/CreditAllocationService.php` (`source`), `Documentation/pages/bsp-billing/meta-setup.html`, `Documentation/pages/bsp-billing/api-reference.html`.
- **Port notes:** Implement as a `CreditSourcePort` under `apps/api/src/infra/providers/` (the repo already has a providers module and a `provider-adapter` skill) with a `MetaSolutionPartnerCreditSource` adapter. Graph calls must run in a BullMQ worker or a bounded-timeout request, never inline in the WABA connect transaction. Use one Graph version constant configurable per platform.

### TW-BSP-006 — Attach the credit line to one customer WABA

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BSP-005
- **Summary:** The admin picks a connected customer number and a billing currency and shares the platform's Meta credit line onto that customer's WABA so Meta bills the platform. The result (attached or failed, allocation id, error) is recorded.
- **Actors & access:** Admin only for the manual path. The same service method is reused by TW-BSP-007, -008 and -011.
- **UX & screens:** Step 2 form on the credit page. Success flash: "Credit line attached to WABA <full waba id>." Failure flash: "Attach failed: <error text from Meta or local check>." Currency options and the red "Locked once attached" note per TW-BSP-003.
- **Endpoints:**

| Endpoint                       | Route name                | Controller                         | Middleware                                  | Request                  | Response                                                                                                          |
| ------------------------------ | ------------------------- | ---------------------------------- | ------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `POST admin/bsp/credit/attach` | `admin.bsp.credit.attach` | `Admin\BspCreditController@attach` | web (CSRF), Authenticate, EnsureUserIsAdmin | `account` = "workspaceId | wabaId" (primary), or legacy `workspace_id` int min 1 + `waba_id` string max 64; `currency` required string max 8 | redirect back with success or error flash |

- **Data:** Writes `bsp_credit_allocations` via updateOrCreate keyed on (`workspace_id`, `waba_id`): `allocation_config_id`, `credit_source` ("meta"), `currency` (upper-case), `status` (`attached` or `failed`), `last_error` (null on success), `attached_at` (now on success, null on failure), `revoked_at` (reset to null). Reads `bsp_credit_allocations`.
- **Rules & edge cases:**
  1. If `account` contains `|` it is split on the first pipe and overrides `workspace_id`/`waba_id` (int-cast workspace id). Validation then applies to the merged values: workspace_id integer >= 1, waba_id max 64, currency max 8. There is **no check that the workspace exists or that the WABA belongs to that workspace** (QUIRK: manual legacy fields could attach any WABA id string).
  2. WABA id trimmed; currency trimmed and upper-cased; if empty falls back to setting `bsp_base_currency` (never set anywhere) else `USD` (unreachable via the controller because currency is required).
  3. **Idempotent**: if an `attached` row already exists for the same workspace + WABA the existing row is returned and Meta is not called (the controller then shows the success flash).
  4. Otherwise one row per (workspace, WABA) is upserted: a previous `failed` or `revoked` row is overwritten and reused (allocation id, currency, timestamps replaced), so history of earlier attempts is lost. A failure creates a `failed` row with the error text.
  5. Meta only accepts these ISO codes for the credit-line currency: AUD, EUR, GBP, IDR, INR, USD. Any other code is rejected locally before calling Meta with an error listing the allowed codes and warning that the currency is locked after attach. The rejection is still stored as a `failed` row.
  6. Meta call: `POST {base}/{credit_line_id}/whatsapp_credit_sharing_and_attach` with `waba_id` and `waba_currency` as **query-string parameters** (not form body), bearer token, JSON, 30 s timeout. Success requires HTTP 2xx AND a non-empty `allocation_config_id` in the JSON; otherwise the error is Meta's `error.message` or "HTTP <status>". Exceptions (timeouts) become the error text.
  7. WABA currency and time zone are immutable on Meta's side once attached; to correct a mistake the admin must revoke and re-attach (per docs).
  8. The `$by` (acting admin id) is passed through but never stored (QUIRK: no attribution/audit).
  9. Log lines with prefix "[BSP-CREDIT]" record attach results (workspace, waba, status, alloc id).
- **Async & events:** Synchronous Graph call in the request (up to about 50 s worst case including credit-line lookup). No queued job, no event, no notification to the customer.
- **External systems:** Meta Graph `POST /{extended_credit_id}/whatsapp_credit_sharing_and_attach`. Requires Solution-Partner status and a system-user token. Meta errors surface verbatim to the admin.
- **Settings:** `bsp_base_currency` (read, never written, default USD), plus TW-BSP-004 keys.
- **Acceptance criteria:**
  - Given a configured connection and a picked number, When the admin submits with currency USD and Meta returns an allocation id, Then a row exists with status `attached`, the allocation id, `attached_at` set, and a success flash names the WABA.
  - Given the same WABA is already `attached` for the workspace, When the admin submits again, Then no request is sent to Meta and no duplicate row is created.
  - Given currency `THB`, When submitted, Then no Meta call is made, a `failed` row is stored with the allowed-currency message, and an error flash is shown.
  - Given Meta returns an error message, When the admin submits, Then the row is `failed` with `last_error` set and the flash shows "Attach failed:" plus that text.
  - Given a previously `failed` row for the same pair, When a later attempt succeeds, Then the same row is updated to `attached` and `last_error` is cleared.
  - Given the connection is not configured, When submitting, Then a `failed` row records the not-configured message.
- **Source refs:** `app/Bsp/Http/Controllers/Admin/BspCreditController.php` (`attach`), `app/Bsp/Services/CreditAllocationService.php` (`attach`), `app/Bsp/Services/CreditSource/MetaSolutionPartnerCreditSource.php`, `app/Bsp/Models/BspCreditAllocation.php`, `database/migrations/2026_08_11_120000_create_bsp_module_tables.php`, `Documentation/pages/bsp-billing/meta-setup.html`, `Documentation/pages/bsp-billing/api-reference.html`.
- **Port notes:** New table `reseller_credit_allocations` with tenant `workspace_id`, RLS, unique (workspace_id, waba_id), status enum, created_by. Put the Graph call in a worker job (`reseller.attach-credit`) triggered via the outbox with the attempt result written back; the admin UI polls. Validate that the WABA belongs to the workspace in the target (Reference does not). Keep the six-currency allow-list as configuration.

### TW-BSP-007 — Attach all connected WABAs (backfill and retry)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-BSP-006
- **Summary:** One click attaches the credit line to every currently connected customer WABA that is not already attached. It is also the retry path for failed or newly approved Meta status.
- **Actors & access:** Admin only. Button visible only when the connection is configured.
- **UX & screens:** "Attach all connected now" button in the step 2 header with a browser confirm dialog. Results flash: "Done, <n> attached, <n> failed, <n> already set up." If not configured the error flash says to connect the Meta credit line first (step 1).
- **Endpoints:**

| Endpoint                           | Route name                    | Controller                            | Middleware                                  | Request | Response                                           |
| ---------------------------------- | ----------------------------- | ------------------------------------- | ------------------------------------------- | ------- | -------------------------------------------------- |
| `POST admin/bsp/credit/attach-all` | `admin.bsp.credit.attach-all` | `Admin\BspCreditController@attachAll` | web (CSRF), Authenticate, EnsureUserIsAdmin | none    | redirect back with success (counts) or error flash |

- **Data:** Reads `wa_provider_configs` where `provider='waba'` and `status='connected'`; reads/writes `bsp_credit_allocations` through the attach service.
- **Rules & edge cases:**
  1. Returns immediately with an error when the source is not configured (no rows touched).
  2. Currency used for all = the auto-attach currency setting, else the resolved platform currency code (`FormatSettings::currencyFor()`, which in an admin request resolves through the signed-in admin's current workspace currency first, then `default_currency`; else USD). Not chosen per customer (QUIRK: a workspace's own currency is ignored here, unlike the customer choice path).
  3. Per config row: skip and count as "skipped" if the decrypted credentials have no WABA id; skip and count "skipped" if an `attached` row already exists for the workspace + WABA; otherwise call attach and count attached or failed. Failed and revoked rows are therefore retried.
  4. Executes sequentially in-request; each attach may make a Meta call, so large tenant counts can exceed the PHP timeout (QUIRK).
  5. Does not consider the workspace's billing mode: **meta_direct workspaces are attached too** (QUIRK).
  6. Two rows with the same WABA id under one workspace attach once (second is skipped as already attached).
- **Async & events:** synchronous loop; no job.
- **External systems:** Meta Graph (per TW-BSP-006), one call per unattached WABA.
- **Settings:** `bsp_auto_attach_currency`, TW-BSP-004 keys.
- **Acceptance criteria:**
  - Given 3 connected WABAs of which 1 is already attached, When the admin confirms, Then two attach attempts are made and the flash reports attached/failed counts summing to 2 and skipped 1.
  - Given the connection is not configured, When the admin posts, Then an error flash appears and no allocation rows change.
  - Given a WABA with a `failed` row, When run again and Meta now accepts, Then that row becomes `attached`.
  - Given a config row for a disconnected WABA, When run, Then it is not touched.
- **Source refs:** `app/Bsp/Services/CreditAllocationService.php` (`attachAllConnected`, `autoCurrency`), `app/Bsp/Http/Controllers/Admin/BspCreditController.php` (`attachAll`), `resources/views/bsp/credit/index.blade.php`.
- **Port notes:** Implement as a queued batch job with progress reporting and per-item results, and skip workspaces whose billing mode is not reseller (a deliberate fix; decide with product since Reference attaches everyone).

### TW-BSP-008 — Auto-attach when a WABA connection is saved

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-BSP-006
- **Summary:** When the admin turns on "Auto-attach when a customer connects", any Cloud API connection that becomes `connected` gets the platform credit line shared automatically, once, so the admin never attaches by hand.
- **Actors & access:** System hook, no user action. Enabled by the admin toggle (TW-BSP-004).
- **UX & screens:** The toggle card on the credit page. No customer-visible UI. Result appears as a row in the allocation table.
- **Endpoints:** none. Registered as a model `saved` callback on `WaProviderConfig` in `AppServiceProvider` (fires on every create/update of a WA provider config row).
- **Data:** Reads `wa_provider_configs` row (`provider`, `status`, decrypted `waba_id`); reads/writes `bsp_credit_allocations`.
- **Rules & edge cases:**
  1. Runs only when `bsp_auto_attach_credit` = "1", the config's provider is `waba`, its status is exactly `connected`, the source is configured, and a non-empty WABA id exists in the credentials.
  2. **Attempts once per (workspace, WABA)**: skipped if any allocation row (attached, failed or revoked) already exists, so repeated saves/health pings do not hit Meta, and a revoked WABA is never re-attached automatically. Retry is the explicit "Attach all connected now" button.
  3. Currency = `bsp_auto_attach_currency` else platform currency (see TW-BSP-007 rule 2) else USD. Workspace currency not used.
  4. Does not check the workspace's billing mode: **every** connecting WABA workspace is attached when the toggle is on, including meta_direct customers. Documentation says "any customer who selects reseller billing", but the code is broader (QUIRK).
  5. Never throws: any exception is logged as a warning ("auto-attach skipped") so a billing convenience cannot break the connect flow. The hook itself is also wrapped and errors go to `error_log`.
  6. Because the callback fires on every save, the Meta call runs synchronously inside whatever request or job saved the config (connect, health check, status change).
- **Async & events:** Triggered by Eloquent `saved` event on `WaProviderConfig`; synchronous. Logging prefix "[BSP-CREDIT]".
- **External systems:** Meta Graph (as TW-BSP-006).
- **Settings:** `bsp_auto_attach_credit` (default off), `bsp_auto_attach_currency` (default blank = auto).
- **Acceptance criteria:**
  - Given auto-attach ON and a configured connection, When a customer's WABA config becomes `connected`, Then an allocation row exists for that workspace + WABA (attached or failed).
  - Given auto-attach OFF, When a WABA connects, Then no allocation row is created.
  - Given a `failed` row already exists, When the config is saved again, Then no new Meta call is made.
  - Given Meta is unreachable, When the config is saved, Then the save still succeeds and no exception surfaces.
  - Given a WABA config saved with status `pending`, When saved, Then nothing happens.
- **Source refs:** `app/Providers/AppServiceProvider.php` (WaProviderConfig saved hook), `app/Bsp/Services/CreditAllocationService.php` (`maybeAutoAttach`), `resources/views/bsp/credit/index.blade.php`.
- **Port notes:** In the target emit an outbox event `whatsapp.connection.connected` from the WABA connection module (WABA) and let the reseller module subscribe and enqueue a job. Do not couple to a model hook. Decide whether to gate on workspace billing mode.

### TW-BSP-009 — Revoke a credit allocation

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-BSP-005
- **Summary:** The admin can stop sharing the credit line with a customer WABA. Meta then no longer bills the platform for that WABA, and the customer pays Meta directly again.
- **Actors & access:** Admin only. Confirm dialog in the UI ("Revoke this credit allocation?").
- **UX & screens:** A "Revoke" button (coral outline) on rows whose status is `attached` in the allocation table; other rows show a dash. Flash on success: "Credit allocation revoked." On failure: "Revoke failed: <error>."
- **Endpoints:**

| Endpoint                            | Route name                | Controller                         | Middleware                                  | Request                   | Response                                               |
| ----------------------------------- | ------------------------- | ---------------------------------- | ------------------------------------------- | ------------------------- | ------------------------------------------------------ |
| `POST admin/bsp/credit/{id}/revoke` | `admin.bsp.credit.revoke` | `Admin\BspCreditController@revoke` | web (CSRF), Authenticate, EnsureUserIsAdmin | path `id` (allocation id) | redirect back with flash; 404 if the id does not exist |

- **Data:** Reads the allocation by primary key (`findOrFail`). On success sets `status='revoked'`, `revoked_at=now()`, `last_error=null`. On failure only sets `last_error` (status stays `attached`).
- **Rules & edge cases:**
  1. Calls Meta `DELETE {base}/{allocation_config_id}` (bearer, 20 s timeout). An empty allocation id fails locally with "No allocation id to revoke."
  2. The route accepts any allocation id, not just `attached` ones (the UI only offers the button for attached rows); revoking an already revoked row re-calls Meta and may fail there.
  3. Revoking does **not** change `workspaces.bill_to_platform_credit`. A customer still in reseller mode keeps being charged from the wallet per message after revoke while Meta bills them directly (QUIRK: possible double billing; nothing reconciles the two).
  4. Revoke does not notify the customer.
  5. Documentation describes revoke as a 3-step Graph flow (discover the config, delete it, confirm status DELETED); the code only performs the single DELETE (see TW-BSP-021).
  6. Log prefix "[BSP-CREDIT]" for success/failure.
- **Async & events:** synchronous Graph call.
- **External systems:** Meta Graph `DELETE /{allocation_config_id}`.
- **Settings:** connection keys from TW-BSP-004.
- **Acceptance criteria:**
  - Given an `attached` allocation, When the admin confirms revoke and Meta returns 2xx, Then the row becomes `revoked` with `revoked_at` set and the button disappears.
  - Given Meta returns an error, When revoke is attempted, Then the row stays `attached`, `last_error` holds the message, and an error flash appears.
  - Given an unknown id, When posted, Then a 404 is returned.
  - Given a revoked row, When "Attach all connected now" or a manual attach runs later for the same pair, Then the row is reused and set back to `attached` (auto-attach will not do it).
- **Source refs:** `app/Bsp/Services/CreditAllocationService.php` (`revoke`), `app/Bsp/Services/CreditSource/MetaSolutionPartnerCreditSource.php` (`revoke`), `app/Bsp/Http/Controllers/Admin/BspCreditController.php`.
- **Port notes:** In the target also offer (product decision) to flip the workspace back to meta_direct or warn when revoking a reseller workspace. Add an audit event and the acting admin id.

### TW-BSP-010 — Credit allocation register (attached accounts table)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-BSP-006
- **Summary:** A paged table on the credit page that lists every credit-line allocation attempt with workspace, WABA tail, Meta allocation id, currency, status and a revoke action.
- **Actors & access:** Admin only.
- **UX & screens:** Section "Credit lines in use" on `resources/views/bsp/credit/index.blade.php`. Columns: Workspace (name, or "#<id>" if the workspace no longer exists), WABA ("..." + last 6 characters), Alloc ID (Meta `allocation_config_id` or a dash), Currency, Status (pill: green `attached`, grey `revoked`, coral `failed`; a coral "!" with the error text as tooltip whenever `last_error` is set), Action (Revoke button for `attached`). Empty state: "No accounts attached yet. Finish steps 1 and 2 above." Pagination 50 per page with standard links; ordered by id descending. No filters, search or export.
- **Endpoints:** rendered by `GET admin/bsp/credit` (TW-BSP-003).
- **Data:** `bsp_credit_allocations` columns `id`, `workspace_id`, `waba_id`, `allocation_config_id`, `credit_source`, `currency`, `status` (`attached`|`revoked`|`failed`, declared in model constant `STATUSES`, default `attached` at the database level), `last_error` text, `attached_at`, `revoked_at`, timestamps. Workspace names from `workspaces.name`.
- **Rules & edge cases:**
  1. Unique per (workspace, WABA) is enforced only by the upsert logic; the table has plain indexes on `workspace_id` and `waba_id` and **no unique constraint**, so concurrent attaches can create duplicates (QUIRK).
  2. Status `failed` may coexist with `last_error` retained; a later success clears it. A revoked row keeps its old `allocation_config_id`.
  3. The workspace-name map loads all workspaces (`pluck id => name`) even for one page (efficiency issue at scale).
  4. `credit_source` is stored but not shown.
  5. There is no FK from `workspace_id`, so rows survive workspace deletion (shown as "#id").
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 60 allocation rows, When the admin opens the page, Then 50 are shown newest first with a pager.
  - Given a `failed` row with an error, When displayed, Then the pill reads `failed` and a "!" with the error tooltip is present.
  - Given a row for a deleted workspace, When displayed, Then the workspace column reads "#<id>".
  - Given an `attached` row, Then a Revoke button is shown; given `revoked`, Then only a dash.
- **Source refs:** `app/Bsp/Models/BspCreditAllocation.php`, `app/Bsp/Http/Controllers/Admin/BspCreditController.php` (`index`), `resources/views/bsp/credit/index.blade.php`, table `bsp_credit_allocations`.
- **Port notes:** Drizzle table with unique (workspace_id, waba_id), FK to workspaces with ON DELETE CASCADE (Reference has none), cursor pagination, index on status. Volume: one row per WABA number, small (hundreds to low thousands).

### TW-BSP-011 — Customer billing-mode choice (meta_direct vs reseller)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BSP-006
- **Summary:** After a workspace connects a WhatsApp Business (Cloud API) number, its admin sees two cards asking who bills for messages: "I pay Meta directly" or "Bill me through <brand>". Choosing reseller flips the workspace into pay-per-message wallet billing and immediately attaches the platform credit line to its WABAs.
- **Actors & access:** Workspace admin role (`EnsureWorkspaceRole:admin`) acting on their current workspace. No plan gate. Available only if the workspace has at least one WABA account row and the card is rendered on the WABA engine section of `/devices`.
- **UX & screens:** `resources/views/user/devices/_waba_section.blade.php` (owned by WADEV; only the billing card block is described here). Card block titled "How do you want to be billed for messages?" with two submit buttons (each its own POST form). Card A "I pay Meta directly": active border and an "Active" badge when the workspace is not reseller; text says the customer's own payment method is on Meta and they only need an active plan. Card B "Bill me through <brand>" (brand from the platform brand name): active badge when reseller; when the platform credit line is not configured the button is disabled (form submit blocked) and shows a "Not available yet" badge. Flash messages: on reseller "Billing set: we bill you per message from your wallet."; on meta_direct "Billing set: Meta bills you directly."; when unavailable "Reseller billing is not available yet, the platform's Meta credit line is not set up."; no workspace: an error "No active workspace." under key `workspace`.
- **Endpoints:**

| Endpoint                    | Route name                  | Controller                         | Middleware                                   | Request                                         | Response                                                       |
| --------------------------- | --------------------------- | ---------------------------------- | -------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `POST devices/billing-mode` | `user.devices.billing-mode` | `DevicesController@setBillingMode` | web, Authenticate, EnsureWorkspaceRole:admin | `mode` required, in `meta_direct` or `reseller` | redirect back with `success`/`error` flash or validation error |

- **Data:** Writes `workspaces.bill_to_platform_credit` (boolean, default false) with `forceFill`; reads/writes `bsp_credit_allocations` via the attach service; reads `wa_provider_configs` (workspace's `provider='waba'`, `status='connected'` rows), `workspaces.currency`.
- **Rules & edge cases:**
  1. Reseller is refused (no flag change) if the credit source is not configured (token and business id). The guard is wrapped in `class_exists` of the BSP service, so removing the BSP code disables the guard.
  2. On reseller: set flag true, then for each connected WABA row with a non-empty WABA id call attach with currency = workspace currency, else platform currency, else USD. This is an explicit choice so it is **not gated on the global auto-attach toggle**. Attach failures are swallowed (logged "[BSP] setBillingMode attach failed" as warnings) and the success flash is shown anyway; the customer cannot see whether Meta attach worked (failures show only in the admin table).
  3. Because attach is idempotent per (workspace, WABA), repeated choice clicks are safe; a previous `failed` row is retried; a `revoked` row is reused.
  4. Switching back to meta_direct only flips the flag to false. The credit line is **not** revoked (QUIRK: Meta keeps billing the platform while the customer is on plan billing, so the platform absorbs cost).
  5. The default for every new workspace is meta_direct (column default false); there is no prompt that forces a choice.
  6. The workspace currency chosen for the credit line is locked by Meta after attach; a workspace with a currency Meta does not accept (anything outside AUD, EUR, GBP, IDR, INR, USD) records a failed allocation and still becomes a reseller workspace (QUIRK).
  7. Multiple WABA numbers in one workspace are all attached in one action (sequential Graph calls inside the request).
  8. Effects on charging and the customer wallet are described in TW-BSP-012.
- **Async & events:** synchronous Graph calls inside the request; no notification; no audit entry for the flag change (QUIRK).
- **External systems:** Meta Graph via TW-BSP-005/006.
- **Settings:** none beyond connection settings; brand name for the card label.
- **Acceptance criteria:**
  - Given a workspace admin with a connected WABA and a configured platform credit line, When they choose "Bill me through <brand>", Then `bill_to_platform_credit` becomes true, an allocation row for each WABA is attempted, and the success flash appears.
  - Given the platform credit line is not configured, When they submit `mode=reseller` directly, Then the flag is unchanged and the "not available yet" error is shown.
  - Given a reseller workspace, When they choose "I pay Meta directly", Then the flag becomes false and existing allocation rows are unchanged.
  - Given a workspace member without the admin role, When they POST, Then access is denied by the role middleware.
  - Given `mode=foo`, When posted, Then validation rejects it.
- **Source refs:** `app/Http/Controllers/DevicesController.php` (`setBillingMode`, `currentWorkspace`), `routes/web.php` (devices group), `resources/views/user/devices/_waba_section.blade.php`, `app/Models/Workspace.php` (`billsToPlatform`), `Documentation/pages/bsp-billing/customer-flow.html`, `Documentation/pages/bsp-billing/overview.html`.
- **Port notes:** Store a `billing_mode` enum (`meta_direct`|`reseller`) on the workspace rather than a boolean; write an audit event and enqueue the attach as a job. Route belongs with the devices/WABA UI (WADEV/WABA) but its logic lives in the reseller module. The customer-facing wallet top-up steps in the docs (checkout/wallet, quick chips 500/1000/2000/5000, bundles, low-balance alert) are WALLET features.

### TW-BSP-012 — Reseller billing gate consumed by the message-billing engine

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-BSP-011
- **Summary:** The per-workspace reseller flag (or the platform-wide "pay-per-message" toggle) switches a workspace from classic plan-quota billing to prepaid wallet billing: every delivered message is charged from the workspace owner's wallet at the per-country x category price, failed deliveries are refunded, and campaigns are blocked at launch when the wallet is empty. The engine itself is owned by WALLET; this entry fixes the behavior the reseller model depends on.
- **Actors & access:** System (engine); admin controls the global toggle on the core Message pricing page; workspace admin controls the per-workspace mode (TW-BSP-011); super-admin can set the flag on workspace create (TW-BSP-013).
- **UX & screens:** No BSP-owned screen. Visible effects: the pay-per-message switch on `admin/settings/wallet-rules` (WALLET), the wallet tab and "top up to send" blocks for customers (WALLET), and `is_bsp` / `billing_mode` fields in mobile/extension payloads (MOB/EXT).
- **Endpoints:** none owned. (Settle points: the seven delivery-status handlers listed in the billing-engine doc; those routes belong to WABA, BCAST, CAMP, SCHED, CHAT and the NODE bridge.)
- **Data:** `workspaces.bill_to_platform_credit`; setting `bsp_pay_per_message` ("1"/"0", default "0", saved from the Message pricing form); `users.wallet_credits`, `users.wallet_currency_minor`; `wallet_transactions`; `message_charges`; `message_rates`.
- **Rules & edge cases:**
  1. **Mode function**: pay-per-message is true for a workspace when its `bill_to_platform_credit` is true, else follows the global `bsp_pay_per_message` (default off). A reseller workspace is always pay-per-message regardless of the global toggle; a meta_direct workspace is only wallet-billed if the global toggle is on (docs say meta_direct is "never charged", but the code lets the global toggle override it: QUIRK).
  2. **Charge on delivery** (`settleDelivered`, one row per `wamid`, unique index; idempotent under webhook replays and concurrent workers): price = `MessageCreditRate::creditsFor(phone, category)`; free (status `free`, cost still stamped) when the price is 0, or when NOT pay-per-message and still inside the plan's free monthly quota (count of the workspace's `message_charges` rows this month, plan must be active; unlimited or 0 limit = always free), or when the owner id is missing, or the wallet holds 0 credits at delivery. Otherwise charged = min(price, balance), so the wallet never goes below zero and a partial charge is possible; the money wallet is reduced by the same money value; a `wallet_transactions` spend row (source `message.sent`) and a `message_charges` row (status `charged`, credits, `revenue_minor`, `cost_minor`, `wallet_tx_id`) are written in one DB transaction with owner row lock. Owner-is-admin workspaces are never billed (skipped without a row).
  3. **Refund on failure** (`settleFailed`): only rows in status `charged` are reversed: credits and money returned to the owner, a `wallet_transactions` refund row (source `message.refund`), the charge row becomes `refunded`. Free rows and repeated calls are no-ops.
  4. **Launch precheck** (`precheck(workspace, count)`): admin-owned workspaces and workspaces with no owner pass. A non-pay-per-message workspace with quota left passes. Otherwise it blocks only when the wallet credit balance is 0 or less, with the message "Your message wallet is empty. Top up to start sending."; the returned `need` is a flat `credits_per_message` (min 1) times count and is informational (QUIRK: a wallet with 1 credit passes a 10,000-message blast).
  5. **Legacy pre-send path** (`OverflowBilling`, plan-quota-first with wallet overflow): when pay-per-message, the plan limit and plan expiry are ignored and the wallet is the only gate; when not, an expired plan raises "plan_expired" and quota-then-wallet overflow applies. In pay-per-message mode a failed debit raises limit key `wallet_empty` ("Your message wallet is out of balance. Top up to keep sending."). This path stamps `bsp_revenue_minor` / `bsp_cost_minor` into the wallet transaction meta, while the delivery path stamps the same values on `message_charges` (two parallel ledgers; the P&L reads only `message_charges`: QUIRK, messages debited only through the legacy path never reach the dashboard).
  6. Low-balance alert after each spend when the balance is at or below setting `wallet_low_balance_threshold` (default 20), throttled to one per owner per 6 hours by cache key.
  7. `revenue_minor` = charged credits x `minorPerCredit`, where `minorPerCredit` = 100 / `credits_per_currency_minor` (0 if that setting is not positive). The shipped default of `credits_per_currency_minor` is 0.1, which makes one credit worth 1000 minor units, while its own description text says "10 credits per major unit" and the docs claim "1 unit = 1 money-cent". The documented money model only holds if the admin sets the value to 100 (QUIRK, the P&L revenue figure, the dashboard wallet-balance column and the wallet display all depend on it; the reference DB still has 0.1).
  8. The optional "seed" action on the Message pricing save stores starter rates (India marketing, US marketing 12, etc.) as whole-currency x 100 (India marketing 1.00, US 12.00), which is consistent with the 1 credit = 1 minor unit model; rates are stored in `message_rates.credits` and the customer-visible unit is money.
- **Async & events:** Runs inside delivery-status webhooks/handlers (sync in request), DB transaction with row lock, duplicate-key race handled by re-fetching the existing charge row. Low-balance notification via wallet alerts (WALLET/NOTIF).
- **External systems:** none directly (Meta delivery webhooks feed it).
- **Settings:** `bsp_pay_per_message` (default 0), `per_country_credits_enabled` (default 0; OFF makes every message use the flat `credits_per_message`), `credits_per_message` (default 1), `credits_per_currency_minor` (default 0.1), `wallet_low_balance_threshold` (default 20).
- **Acceptance criteria:**
  - Given a reseller workspace with a funded wallet, When a delivered status arrives for a wamid, Then exactly one `message_charges` row (status `charged`) is created and the wallet decreases by the priced amount; When the same status arrives again, Then no second charge occurs.
  - Given a charged message, When Meta later reports it failed, Then the credits are returned, a refund wallet transaction exists, and the row status is `refunded`; When failed arrives again, Then nothing changes.
  - Given a reseller workspace with an empty wallet, When a delivered status arrives, Then a `free` row is written and the wallet stays at zero.
  - Given a reseller workspace with an empty wallet, When a campaign launches, Then the precheck blocks it with the top-up message.
  - Given a meta_direct workspace inside its plan quota and the global toggle off, When delivery arrives, Then the row is `free` and no wallet debit occurs.
  - Given price 0 for a service reply, When delivered, Then the row is `free` with cost stamped.
- **Source refs:** `app/Services/MessageBillingService.php`, `app/Services/OverflowBilling.php`, `app/Services/MessageCreditRate.php`, `app/Models/MessageCharge.php`, `app/Models/Workspace.php`, `Documentation/pages/bsp-billing/billing-engine.html`, `Documentation/pages/bsp-billing/overview.html`. (Files owned by WALLET; listed for the reseller contract.)
- **Port notes:** Implement once in the wallet module (`apps/api/src/modules/billing/`), expose a `BillingModePort.isPayPerMessage(workspaceId)` used by campaign preflight and settle handlers. Keep `wamid` unique per tenant with an upsert, use `SELECT ... FOR UPDATE` on the wallet row inside a Postgres transaction, and route failed-delivery refunds through the outbox. Make the precheck compare the balance against the real estimated cost (Reference only checks for zero). Unify the two ledgers (Reference has both `message_charges` and per-transaction `bsp_*` meta).

### TW-BSP-013 — Admin-side workspace flag bill_to_platform_credit (create/edit)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-BSP-012
- **Summary:** The super-admin console can set the same workspace column when creating a workspace, but the toggle carries a different label and meaning there, and the edit form silently resets it.
- **Actors & access:** Admin (with IP allowlist) on `admin/workspaces` routes (owned by WSP/ASHELL). No BSP route is claimed for this feature.
- **UX & screens:** `resources/views/admin/workspaces/create.blade.php`: a toggle labelled "Bill to platform credit" with help "Comp the first month from <brand>". The detail page edit form (`admin/workspaces/detail.blade.php`) has no such field.
- **Endpoints:** `POST admin/workspaces` and `PUT admin/workspaces/{id}` (`Admin\WorkspacesController@store` / `@update`) read `bill_to_platform_credit` with a boolean cast. Not claimed here (owned by WSP).
- **Data:** `workspaces.bill_to_platform_credit` boolean default false.
- **Rules & edge cases:**
  1. QUIRK: the label says "comp the first month from platform credit" (a free-month concept) but the column now means "reseller wallet billing" (TW-BSP-012); ticking it at creation makes the new workspace a reseller workspace.
  2. QUIRK: the update handler writes `boolean('bill_to_platform_credit')` and the edit form does not post the field, so **every admin edit of a workspace resets it to false**, silently converting a reseller workspace to meta_direct (the attached credit line stays).
  3. Creation via this form does not attach a credit line.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an admin creating a workspace with the toggle on, Then the workspace is in reseller mode.
  - Given a reseller workspace, When an admin saves the edit form without touching billing, Then in Reference the flag becomes false (behavior to preserve only if parity is required; the port should treat this as a defect and keep the value).
  - Given the toggle is on at creation, Then no `bsp_credit_allocations` row is created.
- **Source refs:** `app/Http/Controllers/Admin/WorkspacesController.php` (store, update), `resources/views/admin/workspaces/create.blade.php`, `resources/views/admin/workspaces/detail.blade.php`, migration `2026_05_21_071210_add_admin_fields_to_workspaces.php`.
- **Port notes:** Belongs to WSP; expose `billing_mode` explicitly in the admin workspace form and never default it from an absent field.

### TW-BSP-014 — Reseller P&L dashboard: platform totals

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BSP-016
- **Summary:** The admin landing page for the reseller module ("Message income", page title "BSP Dashboard", H1 "Reseller P&L") shows this month's revenue, Meta cost, margin, wallet float held, number of billed messages and how many billed messages had no Meta cost recorded.
- **Actors & access:** Admin only. Two URLs render the same page.
- **UX & screens:** `resources/views/bsp/dashboard/index.blade.php`. Header nav pills (P&L, Rates & margin, Connect Meta). Eyebrow "This month" plus date range "dd Mon - dd Mon" (first of the month to today). Intro sentence explaining revenue/cost/margin with a link to Wallet rules. Four KPI tiles: "Revenue (charged)", "Meta cost", "Margin (profit)" (green), "Wallet float held". Below, two smaller tiles: "Billed messages" and "No Meta cost set" (amber border and coral number when greater than 0). When unpriced count is above 0 an amber banner says N billed message(s) had no Meta cost for their country/category, so margin counts them as pure revenue, and links to "Wallet rules > Sync Meta costs".
- **Endpoints:**

| Endpoint                  | Route name                  | Controller                           | Middleware                           | Request | Response                        |
| ------------------------- | --------------------------- | ------------------------------------ | ------------------------------------ | ------- | ------------------------------- |
| `GET admin/bsp`           | `admin.bsp.dashboard`       | `Admin\BspDashboardController@index` | web, Authenticate, EnsureUserIsAdmin | none    | HTML view `bsp.dashboard.index` |
| `GET admin/bsp/dashboard` | `admin.bsp.dashboard.alias` | same                                 | same                                 | none    | same page                       |

- **Data:** Reads `message_charges` (`status`, `created_at`, `revenue_minor`, `cost_minor`, `workspace_id`), `users.wallet_currency_minor`, `users.wallet_credits`, `currencies` (symbol/code). Totals: messages = count of rows with status `charged` created between the first day of the current month 00:00 and now; revenue = sum of `revenue_minor` over those rows; cost = sum of `cost_minor` (nulls count as 0); margin = revenue minus cost; unpriced = charged rows in window whose `cost_minor` is null; wallet float = sum of `users.wallet_currency_minor` over **all** users (also computed but not displayed: `free_msgs` = count of `free` rows in window; `wallet_credits_out` = sum of `users.wallet_credits`).
- **Rules & edge cases:**
  1. Window is fixed to the current month in the application time zone; there is no date picker, filter or export and no previous-month view (QUIRK/limitation).
  2. Only `charged` rows count, so `free` and `refunded` messages never inflate revenue. A message refunded later in the same month disappears from totals; a message charged one month and refunded the next changes the earlier month's totals only if the window were re-queried (rows are dated by charge creation).
  3. Unknown Meta cost (null) is treated as zero cost, so margin equals revenue for those messages; the amber banner is the only signal.
  4. Money display: minor units divided by 100 with 2 decimals and thousand separators, prefixed by the currency symbol (falls back to the code). The currency used is `FormatSettings::currencyFor()` for the signed-in admin, which resolves the admin's current-workspace currency before the platform default (QUIRK: it can differ from the platform base currency). A currency with a precision other than 2 is still rendered with 2 decimals and a /100 divisor.
  5. "Wallet float held" mixes every user's wallet money regardless of the customer's billing mode, the wallet currency code, or whether the user is an admin.
  6. No caching; live aggregate queries on `message_charges` (indexed on workspace_id + created_at and status) run on each request.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none on this page. Depends on `credits_per_currency_minor` only for the per-workspace balance column (TW-BSP-015).
- **Acceptance criteria:**
  - Given charged rows of revenue 10000 and cost 7200 (minor) this month, When the admin opens the page, Then Revenue shows 100.00, Meta cost 72.00 and Margin 28.00 in the display currency.
  - Given refunded and free rows this month, When the page loads, Then they are excluded from revenue, cost and the billed count.
  - Given 3 charged rows with null cost, When the page loads, Then "No Meta cost set" shows 3 in coral and the amber banner appears.
  - Given no charged rows this month, When the page loads, Then all tiles show zero and the per-workspace table shows the empty message.
  - Given the alias URL `admin/bsp/dashboard`, When opened, Then the same page renders.
- **Source refs:** `app/Bsp/Http/Controllers/Admin/BspDashboardController.php`, `app/Bsp/Services/ReportService.php` (`platformTotals`), `resources/views/bsp/dashboard/index.blade.php`, `app/Support/FormatSettings.php`, `Documentation/pages/bsp-billing/admin-pages.html`.
- **Port notes:** Build as a reporting query (read replica per ADR 0013 candidate) over the charges table with an explicit period filter and a stored platform currency. Keep the exclusion of free/refunded rows. Add month picker and CSV export (not in Reference). Platform-scope page for the super-admin pool.

### TW-BSP-015 — Reseller P&L dashboard: per-workspace table

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-BSP-014
- **Summary:** A table under the totals that shows, for each workspace with billed messages this month, message count, revenue, Meta cost, margin and the owner's current wallet balance, ordered by top spender.
- **Actors & access:** Admin only (same page/route as TW-BSP-014).
- **UX & screens:** Table titled "Per-workspace (this month)" with columns Workspace, Msgs, Revenue, Meta cost (muted), Margin (green, medium weight), Wallet balance; horizontally scrollable. Empty state: "No billed messages this month yet." (colspan of all columns).
- **Endpoints:** rendered by `GET admin/bsp` and `GET admin/bsp/dashboard`.
- **Data:** From `message_charges` grouped by `workspace_id` for status `charged` rows in the month window: count, sum revenue, sum cost, ordered by revenue descending, limited to 100 rows. Workspace name from `workspaces.name` (fallback "Workspace #<id>"). Wallet balance = the workspace owner's (`workspaces.owner_user_id`) `users.wallet_credits` multiplied by `MessageCreditRate::minorPerCredit()` and formatted like other money values (0 if the owner is missing).
- **Rules & edge cases:**
  1. Limited to the top 100 revenue workspaces; no pagination, sorting controls, search or drill-down (QUIRK/limitation).
  2. Workspaces whose messages were all free/refunded do not appear.
  3. Per-workspace margin uses the same null-cost-as-zero rule as TW-BSP-014.
  4. The owner-credit lookup runs one query per workspace (N+1 up to 100).
  5. Wallet balance is the owner's balance, not per workspace, so a user owning several workspaces shows the same balance on each row.
  6. Balance depends on `credits_per_currency_minor` (see TW-BSP-012 rule 7); with the shipped default the displayed money value is 1000x the credit count in minor units.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `credits_per_currency_minor`.
- **Acceptance criteria:**
  - Given workspace A revenue 500 and B revenue 900 this month, When the table renders, Then B appears above A.
  - Given a workspace with a deleted record, When it has charged rows, Then its name shows as "Workspace #<id>".
  - Given more than 100 billed workspaces, When the page loads, Then only the top 100 by revenue are listed.
  - Given a workspace with only refunded rows, Then it is not listed.
- **Source refs:** `app/Bsp/Services/ReportService.php` (`perWorkspace`), `resources/views/bsp/dashboard/index.blade.php`.
- **Port notes:** Add cursor pagination, month filter and sortable columns; join owners in a single query; show balance per wallet (the wallet may belong to a user or workspace in the target model).

### TW-BSP-016 — P&L data feed: revenue and Meta cost stamped per message

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-BSP-012, TW-BSP-017
- **Summary:** Every delivered message writes one immutable-ish ledger row carrying what the customer paid (revenue) and Meta's wholesale cost, which the P&L then sums. This is the data contract between the billing engine (WALLET) and the reseller dashboard.
- **Actors & access:** System; consumed by the admin dashboard.
- **UX & screens:** none (data only). Surfaced via TW-BSP-014/015 and the "No Meta cost set" warning.
- **Endpoints:** none.
- **Data:** `message_charges` (owned by WALLET): `workspace_id`, `user_id` (wallet owner), `provider` (waba, twilio, ...), `wamid` (unique), `to_country` (ISO2 from the recipient number), `category` (marketing, utility, authentication, service, or null), `source` (feature that sent it), `credits`, `revenue_minor` (bigint, default 0), `cost_minor` (bigint, null = unknown), `status` enum `free`|`charged`|`refunded` (default `charged`), `wallet_tx_id`, `meta` JSON, timestamps. `message_rates` (owned by WALLET): `country_code` (2 chars, blank = any country), `category` (blank = any category), `credits` (customer price), `meta_cost_minor` nullable (Meta wholesale cost), `currency` nullable (currency of the cost), `is_active`, unique on (country_code, category).
- **Rules & edge cases:**
  1. Cost lookup uses most-specific-wins across active rate rows: country+category, then country with any category, then any country with the category, then the global default row; the first row that has a non-null cost wins, else cost is null (unknown), which is distinct from 0 (free). Category is normalized to marketing/utility/authentication/service, anything else maps to blank (default row).
  2. The rate and cost maps are cached for 5 minutes under `message_rates_map` and `message_rates_cost_map`; the pricing admin forgets both on save/sync/import, so an edit applies within one request but plain DB edits lag up to 5 minutes.
  3. Cost is stamped even on `free` rows, but the P&L ignores free rows. On a partial charge (wallet held less than the price) `cost_minor` is the full cost while revenue is only what was charged, which understates margin (QUIRK).
  4. `message_rates.currency` records the currency of `meta_cost_minor` but the engine and the dashboard never convert: they assume costs are already in the platform display currency (the sync/import routes convert into the platform currency before saving, so this holds only if the platform currency never changes after data entry).
  5. The customer price is not derived from cost; there is no markup rule. Margin = customer price minus cost only because the admin typed both.
  6. Idempotency and refund transitions are in TW-BSP-012; a refund flips status but keeps revenue/cost values, which is why the report filters on status.
  7. The legacy pre-send debit path stamps `bsp_revenue_minor`/`bsp_cost_minor` in `wallet_transactions.meta` but does not write `message_charges` (see TW-BSP-012 rule 5).
- **Async & events:** written inside delivery webhooks; cache invalidation on admin edits.
- **External systems:** none.
- **Settings:** `per_country_credits_enabled` (OFF = flat `credits_per_message` price for every message, cost lookup still works), `credits_per_message`.
- **Acceptance criteria:**
  - Given a rate row for IN + marketing with cost 72 minor, When an India marketing message is charged, Then the ledger row has cost 72.
  - Given no rate row carries a cost for the destination, When charged, Then `cost_minor` is null and the dashboard counts it as unpriced.
  - Given a specific US row without a cost but a global default row with a cost, When a US message is charged, Then the cost of the default row is used (first non-null wins in specificity order).
  - Given the admin edits a cost on the pricing page, When the next message is charged, Then the new cost is used.
- **Source refs:** `app/Services/MessageBillingService.php`, `app/Services/MessageCreditRate.php`, `app/Models/MessageCharge.php`, `database/migrations/2026_08_11_140000_add_bsp_cost_to_message_rates.php`, `app/Bsp/Services/ReportService.php`.
- **Port notes:** Owned in the wallet module; keep `cost_minor` nullable and record `cost_currency` on each ledger row so a later platform currency change does not corrupt history (Reference does not).

### TW-BSP-017 — Meta wholesale cost source (live rates endpoint, sync, import)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-BSP-004
- **Summary:** The reseller fills Meta's cost column on the pricing page by syncing from a live rates endpoint (using the reseller's system-user token), from a bundled reference rate card, or by importing a CSV. The BSP-owned part is the two settings that turn on the live pull; the buttons live on the core pricing page.
- **Actors & access:** Admin (with IP allowlist) on the WALLET-owned routes `POST admin/settings/message-rates`, `POST admin/settings/message-rates/sync-meta`, `POST admin/settings/message-rates/import` (not claimed by BSP).
- **UX & screens:** "Sync Meta costs" and "Import my rate card" on `admin/settings/wallet-rules` (WALLET). BSP settings: "Meta rates endpoint" and the token on TW-BSP-003. Flash on sync: synced N added M updated in the platform currency with source and version; error when both live fetch and the bundled file fail.
- **Endpoints:** owned by WALLET (see routes list there).
- **Data:** Writes `message_rates.meta_cost_minor` and `.currency`; creates missing rows with `credits` 0 and `is_active` true; never overwrites the customer price on existing rows.
- **Rules & edge cases:**
  1. Live pull happens only when both `bsp_meta_rates_endpoint` and the system-user token are set: GET with bearer token, JSON, 20 s timeout. Non-200, exception or unparsable payload silently falls back to the bundled dataset (`resources/data/meta-rate-card.json`), reporting the source as "bundled reference".
  2. Accepted live payloads: an object with `rates` = list of {country, currency, marketing, utility, authentication} plus optional `version`; or a flat list (top level or under `data`) of {country|country_code, currency, category, rate|amount|price} which is folded per country (currency default USD; categories restricted to marketing, utility, authentication).
  3. Each amount is converted from its native currency into the platform currency with the app converter (unknown currency converts 1:1) and stored as minor units (x100, rounded, not below 0). Country `*` in the dataset means the blank any-country default row. Country must be 2 letters.
  4. `service` never receives a Meta cost (stays null).
  5. CSV import: file required, csv/txt, max 4096 KB; header case-insensitive; "wide" shape (Marketing/Utility/Authentication columns, no category column) or "long" shape (country_code, category, meta_cost|cost|rate|price, optional credits and currency); country cell accepts ISO code, name or calling code (unresolvable rows are skipped); blank country/category = any. Result flash counts added, updated, skipped.
  6. The sync overwrites every existing cost, including hand-edited ones.
  7. The token is sent to whatever URL the admin configured (no host allow-list), so the endpoint is trusted.
  8. There is no scheduled refresh; Meta rate changes (quarterly per docs) require the admin to press sync again.
- **Async & events:** synchronous; forgets the rate caches on completion.
- **External systems:** admin-defined rates endpoint (any HTTPS URL returning the shapes above); Meta itself exposes no confirmed public pricing endpoint in this code (open question). Bundled dataset shipped in the app.
- **Settings:** `bsp_meta_rates_endpoint`, `bsp_meta_system_user_token`, platform default currency.
- **Acceptance criteria:**
  - Given endpoint and token are set and the endpoint returns the `rates` shape, When the admin presses "Sync Meta costs", Then cost columns update from that data and the flash names source "Meta (live)".
  - Given the endpoint is blank, When syncing, Then the bundled dataset is used and the source is "bundled reference".
  - Given a wide-format CSV with a Marketing column, When imported, Then a row per country x marketing is upserted with cost converted to the platform currency.
  - Given sync runs, Then existing customer prices (`credits`) are unchanged.
- **Source refs:** `app/Http/Controllers/AdminPagesController.php` (`messageRatesUpdate`, `messageRatesSyncMeta`, `messageRatesImport`, `fetchLiveMetaRates`, `settingWalletRules`), `app/Services/MessageCreditRate.php`, `database/migrations/2026_08_11_140000_add_bsp_cost_to_message_rates.php`, `Documentation/pages/bsp-billing/api-reference.html`, `Documentation/pages/bsp-billing/admin-pages.html`.
- **Port notes:** Rate grid, import and sync are WALLET features; BSP only supplies the credentials. In the target restrict the endpoint URL to https, add a scheduled refresh job, and keep per-row `cost_currency`.

### TW-BSP-018 — Per-client and platform markup configuration

- **Status:** docs-only
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-BSP-012
- **Summary:** The docs say customers are charged "Meta rate + your configured markup". In code there is no markup engine: the customer price is a number the admin types per country x category on the pricing page, and margin is only reported.
- **Actors & access:** none (no code path).
- **UX & screens:** none. The dropped BSP tables once had `markup_type` (percent|fixed) and `markup_value` per account plus a platform default markup setting (from the original add-on migration), but no screen or service uses them in v1.7.0.
- **Endpoints:** none.
- **Data:** none live. Historical only: `bsp_accounts.markup_type`, `markup_value` (dropped).
- **Rules & edge cases:**
  1. Docs pages (api-reference section 7) promise automatic markup; treat as advertised-only.
  2. A rebuild that wants markup must add it as a new feature (percent/fixed on cost with per-workspace override) and decide precedence against explicit price rows.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the Reference reference, When searching for a markup setting or field in the admin UI, Then none exists (parity means not building it).
  - Given a product decision to add markup, When the admin sets 20 percent on cost 100, Then a customer price of 120 is derived unless an explicit price row exists (new behavior, not Reference parity).
  - Given the pricing page, Then customer price and Meta cost are two independent inputs.
- **Source refs:** `Documentation/pages/bsp-billing/api-reference.html`, `Documentation/pages/bsp-billing/overview.html`, `database/migrations/2026_08_11_120000_create_bsp_module_tables.php`, `database/migrations/2026_08_11_150000_drop_bsp_duplicate_wallet_tables.php`.
- **Port notes:** Do not build for parity. If desired later, add columns to the pricing table, not a parallel BSP account table.

### TW-BSP-019 — Dedicated BSP wallet, top-up packages, usage events and rate-card tables

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** An earlier BSP add-on created its own wallet ledger, top-up bundles, per-message usage events, rate cards and per-workspace accounts. Those were folded into the core wallet and the create-migration is followed by a drop-migration, so none of these tables exist after a normal migrate.
- **Actors & access:** none.
- **UX & screens:** none. Only a code comment on the legacy rate-card URL and the redirect (TW-BSP-002) remains.
- **Endpoints:** none (the old `admin/bsp/rate-cards` page is now just a redirect).
- **Data:** Dropped tables: `bsp_rate_cards`, `bsp_accounts`, `bsp_wallet_ledger`, `bsp_usage_events`, `bsp_topup_packages`, `bsp_topups` (the `order_id` migration for top-ups is a no-op once the table is gone). Replaced by `wallet_transactions`, `message_rates` (+ `meta_cost_minor`, `currency`), `message_charges`, and the core top-up checkout.
- **Rules & edge cases:**
  1. Both migrations run in order on fresh installs (create then drop), leaving only `bsp_credit_allocations`.
  2. The `down()` of the drop migration is a stub, so the change is one way.
  3. Do not recreate these tables in the port.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a fresh migrate, When listing tables, Then none of the six dropped tables exist and `bsp_credit_allocations` does.
  - Given the port, When reviewing schema, Then no parallel BSP wallet exists and reseller billing uses the core wallet.
  - Given `message_rates` on migrate, Then `meta_cost_minor` and `currency` columns exist.
- **Source refs:** `database/migrations/2026_08_11_120000_create_bsp_module_tables.php`, `database/migrations/2026_08_11_130000_add_order_id_to_bsp_topups.php`, `database/migrations/2026_08_11_140000_add_bsp_cost_to_message_rates.php`, `database/migrations/2026_08_11_150000_drop_bsp_duplicate_wallet_tables.php`.
- **Port notes:** Informational only; ensures nobody ports the abandoned schema.

### TW-BSP-020 — Alternative credit sources (aggregator, partner)

- **Status:** docs-only
- **Priority:** P2
- **Effort:** L
- **Depends on:** TW-BSP-005
- **Summary:** The credit-source contract was designed so an aggregator (Path B) or partner (Path C) could fund WABAs instead of Meta's credit line, but only the Meta Solution Partner implementation (Path A) exists.
- **Actors & access:** none.
- **UX & screens:** none; the setting `bsp_credit_source` has no UI.
- **Endpoints:** none.
- **Data:** allocation rows have a `credit_source` column ("meta" today; comment mentions "aggregator").
- **Rules & edge cases:**
  1. The resolver returns the Meta source for every setting value, so an unknown value silently behaves as Meta.
  2. The rest of the billing engine (wallet, rates, metering) is source-agnostic by design; only attach/revoke differs.
- **Async & events:** none.
- **External systems:** none implemented.
- **Settings:** `bsp_credit_source` (default meta; not settable).
- **Acceptance criteria:**
  - Given `bsp_credit_source` is any value, When the source is resolved, Then the Meta implementation is used.
  - Given a new adapter is added later, When attach is invoked, Then the allocation row records that adapter's `name()`.
  - Given Reference parity, Then only Meta is required.
- **Source refs:** `app/Bsp/Services/CreditSource/CreditSourceContract.php`, `app/Bsp/Services/CreditAllocationService.php`.
- **Port notes:** Keep the port interface but ship only the Meta adapter.

### TW-BSP-021 — Three-step share/attach and revoke-by-discovery Graph flows

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-BSP-006
- **Summary:** The API reference page documents an older three-call share-and-attach sequence and a three-call revoke (find the allocation config, delete it, confirm DELETED). The code uses only the single-call attach and single-call delete by stored allocation id.
- **Actors & access:** none.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Documented but unimplemented: `GET /{waba_id}?fields=owner_business_info`, `POST /{credit_line}/whatsapp_credit_sharing?receiving_business_id=`, `POST /{credit_line}/whatsapp_credit_attach`, `GET /{credit_line}/owning_credit_allocation_configs?receiving_business_id=`, `GET /{allocation_config_id}?fields=request_status`.
  2. Revoke requires the stored `allocation_config_id`; an allocation row that lacks it cannot be revoked (no discovery fallback).
- **Async & events:** none.
- **External systems:** Meta Graph (documentation only).
- **Settings:** none.
- **Acceptance criteria:**
  - Given the code, When attaching, Then only `whatsapp_credit_sharing_and_attach` is called.
  - Given an allocation with no allocation id, When revoking, Then the error "No allocation id to revoke." is returned.
  - Given parity scope, Then the alternate flows are not required.
- **Source refs:** `Documentation/pages/bsp-billing/api-reference.html`, `app/Bsp/Services/CreditSource/MetaSolutionPartnerCreditSource.php`.
- **Port notes:** Optional hardening: add a discovery fallback for revoke when the id is missing.

## Data model

### `bsp_credit_allocations` (owned)

Purpose: one record per (workspace, WABA) attempt to share the platform credit line onto a customer WABA. Written by TW-BSP-006/-007/-008/-011/-009, read by TW-BSP-003/-010.

| Column                     | Type               | Null | Default    | Notes                                               |
| -------------------------- | ------------------ | ---- | ---------- | --------------------------------------------------- |
| `id`                       | bigint unsigned PK | no   | auto       | ordering key for the register                       |
| `workspace_id`             | bigint unsigned    | no   | none       | no FK in Reference (add FK cascade in the port)        |
| `waba_id`                  | varchar(64)        | no   | none       | Meta WhatsApp Business Account id (trimmed)         |
| `allocation_config_id`     | varchar(64)        | yes  | null       | Meta id returned by attach; required to revoke      |
| `credit_source`            | varchar(16)        | yes  | null       | adapter name, "meta"                                |
| `currency`                 | varchar(8)         | no   | `USD`      | upper-case code, locked at Meta after attach        |
| `status`                   | varchar(16)        | no   | `attached` | enum by convention: `attached`, `revoked`, `failed` |
| `last_error`               | text               | yes  | null       | last Meta/local error, cleared on success           |
| `attached_at`              | timestamp          | yes  | null       | set on success                                      |
| `revoked_at`               | timestamp          | yes  | null       | set on revoke; reset to null on re-attach           |
| `created_at`, `updated_at` | timestamp          | yes  | null       |                                                     |

Indexes: PK, `workspace_id`, `waba_id`. No unique key (logical uniqueness on workspace_id + waba_id by upsert; add a real unique). Model: `App\Bsp\Models\BspCreditAllocation` (fillable all fields, timestamp casts, constant `STATUSES`). Volume: one row per connected WABA; rows are never deleted. Seeded reference DB: 0 rows.

### Columns and tables touched but owned elsewhere

- `workspaces.bill_to_platform_credit` (tinyint(1) not null default 0; bool cast; the reseller flag) and `workspaces.currency` (varchar(10) null): WSP.
- `system_settings` keys used by BSP (string type unless noted): `bsp_meta_business_id` (default ""), `bsp_meta_extended_credit_id` (""), `bsp_meta_system_user_token` (encrypted, ""), `bsp_graph_version` (`v26.0`), `bsp_meta_rates_endpoint` (""), `bsp_auto_attach_credit` ("0"), `bsp_auto_attach_currency` (""), `bsp_pay_per_message` ("0", written by the pricing page), `bsp_enabled` (read only, default true), `bsp_credit_source` (read only, default "meta"), `bsp_base_currency` (read only, default "USD"). None of these are seeded in the reference DB.
- `wa_provider_configs` (WADEV/WABA): `workspace_id`, `provider` ('waba' for Cloud API), `status` (`connected` required for bulk/auto attach), `credentials_json` (encrypted; `waba_id` inside), `phone_number`, `display_label`.
- `message_charges` and `message_rates` (WALLET): columns as described in TW-BSP-016; `message_rates.meta_cost_minor` and `.currency` were added by the BSP merge migration.
- `users.wallet_credits`, `users.wallet_currency_minor`, `wallet_transactions` (WALLET).
- `currencies` (SET/CPN): `code`, `symbol`, `precision`, `exchange_rate`.

### Dropped historical tables

`bsp_rate_cards`, `bsp_accounts`, `bsp_wallet_ledger`, `bsp_usage_events`, `bsp_topup_packages`, `bsp_topups`: created then dropped (TW-BSP-019).

## Cross-domain contracts

- **Consumes WALLET (`wallet-message-billing`):** `MessageBillingService` (settleDelivered, settleFailed, precheck, payPerMessageFor), `OverflowBilling`, `MessageCreditRate` (price/cost resolution, `minorPerCredit`), tables `message_charges`, `message_rates`, `wallet_transactions`, user wallet columns; the Message pricing page (`admin/settings/wallet-rules`, `message-rates*` routes, `bsp_pay_per_message` toggle); customer top-up checkout (`/checkout/wallet`, `/account?tab=wallet`). **Exposes to WALLET:** the reseller flag semantics (TW-BSP-012), the Meta rates endpoint + token settings (TW-BSP-017), and the P&L view of `message_charges` (TW-BSP-014/-015).
- **Consumes WADEV/WABA:** `WaProviderConfig` rows (WABA id in decrypted credentials, `status`, phone) and its `saved` event for auto-attach; the `/devices` WABA section that hosts the billing cards. **Exposes:** `CreditAllocationService::attach/maybeAutoAttach/source()->isConfigured()`, and the `POST devices/billing-mode` route (claimed here) whose handler sits in `DevicesController`.
- **Consumes WSP:** `workspaces.bill_to_platform_credit`, `workspaces.currency`, `Workspace::billsToPlatform()`; **exposes** the flag write via the customer choice and receives admin create/edit writes (TW-BSP-013).
- **Consumes SET:** `system_settings` cache/encryption (`SystemSetting::ENCRYPTED_KEYS` includes `bsp_meta_system_user_token`), `currencies`, `FormatSettings::currencyFor/convert`, brand name helper.
- **Consumes ASHELL:** admin layout, flash component, sidebar "Billing" group entries.
- **Exposes to MOB and EXT:** `is_bsp` and `billing_mode` ("wallet" for reseller/pay-per-message, "plan" otherwise) in the mobile content/wallet payloads and the Chrome-extension API (`Api/App/ContentController`, `Api/App/WalletController`, `Api/ExtensionApiController`, `PlanUsage`), all computed from `payPerMessageFor`.
- **Consumes NOTIF:** low-balance wallet alerts (via WALLET). No BSP notification or audit-log entry exists for attach, revoke, settings save or mode change.
- **Node bridge (NODE):** no BSP code in `node/`; delivery-status callbacks that call settle come from Node routes owned by NODE/BCAST/CAMP/SCHED/CHAT.

## Open questions & quirks

1. QUIRK: default Graph version is `v26.0` in code, `v25.0` in the UI placeholder/help text and in all docs pages.
2. QUIRK: the code comment on the dashboard controller says figures come from `wallet_transactions`, but the report service reads `message_charges`. The docs page says `message_charges`; the code is authoritative.
3. QUIRK: no permission keys or plan gates; only "is admin". BSP admin routes skip the IP allowlist middleware that `/admin/*` (bootstrap group) applies to other admin pages.
4. QUIRK: no audit-log entries or acting-admin attribution for any BSP action (the `$by` argument is dropped).
5. QUIRK: auto-attach and "attach all" attach every connected WABA, including meta_direct workspaces; docs say only customers who choose reseller. Revoke and switching back to meta_direct never coordinate (TW-BSP-009, -011).
6. QUIRK: the credit page lets the admin pick any currency in the `currencies` table but Meta accepts only AUD, EUR, GBP, IDR, INR, USD; others become `failed` rows.
7. QUIRK: Meta network calls run inline in web requests and in the WaProviderConfig `saved` hook (no queue, no retry, no backoff, up to 20 to 30 s each).
8. QUIRK: `credits_per_currency_minor` default 0.1 contradicts the documented money model (1 credit = 1 minor unit), which affects revenue stamping and the dashboard wallet-balance column (TW-BSP-012 rule 7).
9. QUIRK: admin workspace edit resets `bill_to_platform_credit` to false; the create form labels it "Bill to platform credit / comp the first month" (TW-BSP-013).
10. QUIRK: `message_rates.currency` records the cost currency but nothing converts on read; a platform currency change corrupts P&L comparisons.
11. QUIRK: dashboard shows this month only, no filters/export; per-workspace limited to 100; currency shown is the signed-in admin's, not necessarily the platform base.
12. QUIRK: precheck only blocks on a zero balance; `need` is informational.
13. Setting `bsp_enabled`, `bsp_credit_source` and `bsp_base_currency` are read but never written (dead configuration); the status probe reports `enabled` that cannot be turned off.
14. Docs-only or dead items: markup (TW-BSP-018), separate BSP wallet/top-ups (TW-BSP-019), aggregator/partner sources (TW-BSP-020), three-step Graph flows (TW-BSP-021). Docs also say "Auto-attach: any customer who selects reseller billing gets your credit line", but the code attaches on any WABA connect when the toggle is on. Docs' customer flow describes wallet top-up chips and "Not available yet" copy; the top-up part is WALLET.
15. Open question: no code verifies that Meta's extended credit line currency or the WABA's existing currency match; a WABA that already has its own payment method or a different currency may reject the attach with an opaque Graph error that is surfaced verbatim.
16. Open question: the "live" rates endpoint has no default; whether Meta publishes such a public endpoint is not established by the code (the admin must supply a URL).
17. Boundary note: `POST devices/billing-mode` is claimed here although its controller (`DevicesController`) and the card partial (`_waba_section.blade.php`) belong to WADEV; the routes `admin/settings/message-rates*`, `admin/settings/wallet-rules`, and the workspace admin create/edit routes are deliberately left to WALLET and WSP. Files `MessageBillingService.php`, `OverflowBilling.php`, `MessageCreditRate.php`, `MessageCharge.php` are documented here as contracts but should be listed in WALLET's coverage.
18. Open question: `app/Bsp/*` files are a "bsp_files" manifest group (not in controllers/models manifests); the port should treat the whole folder as one module.

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET admin/bsp/status",
    "GET admin/bsp/rate-cards",
    "GET admin/bsp/credit",
    "POST admin/bsp/credit/settings",
    "POST admin/bsp/credit/attach",
    "POST admin/bsp/credit/attach-all",
    "POST admin/bsp/credit/{id}/revoke",
    "GET admin/bsp",
    "GET admin/bsp/dashboard",
    "POST devices/billing-mode"
  ],
  "controllers": [],
  "services": [
    "app/Bsp/Http/Controllers/Admin/BspCreditController.php",
    "app/Bsp/Http/Controllers/Admin/BspDashboardController.php",
    "app/Bsp/Http/Controllers/BspStatusController.php",
    "app/Bsp/Models/BspCreditAllocation.php",
    "app/Bsp/Services/CreditAllocationService.php",
    "app/Bsp/Services/CreditSource/CreditSourceContract.php",
    "app/Bsp/Services/CreditSource/MetaSolutionPartnerCreditSource.php",
    "app/Bsp/Services/ReportService.php"
  ],
  "models": [],
  "tables": ["bsp_credit_allocations"],
  "views": [
    "resources/views/bsp/credit/index.blade.php",
    "resources/views/bsp/dashboard/index.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": [],
  "js_assets": [],
  "misc_files": [],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/bsp-billing/overview.html",
    "Documentation/pages/bsp-billing/meta-setup.html",
    "Documentation/pages/bsp-billing/billing-engine.html",
    "Documentation/pages/bsp-billing/customer-flow.html",
    "Documentation/pages/bsp-billing/admin-pages.html",
    "Documentation/pages/bsp-billing/api-reference.html"
  ],
  "feature_map": {
    "TW-BSP-001": ["GET admin/bsp/status"],
    "TW-BSP-002": ["GET admin/bsp/rate-cards"],
    "TW-BSP-003": ["GET admin/bsp/credit"],
    "TW-BSP-004": ["POST admin/bsp/credit/settings"],
    "TW-BSP-005": [],
    "TW-BSP-006": ["POST admin/bsp/credit/attach"],
    "TW-BSP-007": ["POST admin/bsp/credit/attach-all"],
    "TW-BSP-008": [],
    "TW-BSP-009": ["POST admin/bsp/credit/{id}/revoke"],
    "TW-BSP-010": [],
    "TW-BSP-011": ["POST devices/billing-mode"],
    "TW-BSP-012": [],
    "TW-BSP-013": [],
    "TW-BSP-014": ["GET admin/bsp", "GET admin/bsp/dashboard"],
    "TW-BSP-015": [],
    "TW-BSP-016": [],
    "TW-BSP-017": [],
    "TW-BSP-018": [],
    "TW-BSP-019": [],
    "TW-BSP-020": [],
    "TW-BSP-021": []
  }
}
```
