---
domain: plans-subscriptions-trials
code: PLAN
title: Plans, subscriptions, trials, limits and feature gating
threadwise_version: '1.7.0'
sources_read: 96
---

# Plans, subscriptions, trials, limits and feature gating

## Overview

This domain is the product catalogue and the entitlement fence of Reference. A **package** (a.k.a. plan) is one row in `packages`: a price, a billing period, 48 numeric limit columns, about 70 on/off feature flags and some display fields. A workspace points at one package through `workspaces.plan`; everything the workspace may do (how many devices, contacts, flows; whether it can open Campaigns, AI agents, calling, a Shopify integration) is read back out of that row at request time. Around that core sit the customer-facing surfaces that sell and explain plans (public pricing page, in-app plan picker, free-trial bar, renewal bar, premium crown, upgrade paywall sheet, plan and usage panel) and the server-side layers that enforce them (trial hard gate, route-level feature gate, in-context count guard, delete-proof quota ledger, per-plan API rate limit).

Who uses it:

- **Platform super-admin** (`EnsureUserIsAdmin` + `IPAllowlist`, no finer permission key is checked on any of these routes): builds the tier ladder (Admin > Packages), edits the pricing FAQ, reads package analytics, the Financial and Premium dashboards.
- **Workspace owner / member**: sees the pricing page, the in-app plan picker and its trial and renewal bars, hits paywalls and limit errors, reads plan usage.
- **API client**: is throttled by the plan (`api_rate_limit_per_minute`) and can read plan, limits and usage through the v1 API (owned by API).
- **Machine**: a daily heartbeat-triggered command wipes data of workspaces whose paid plan lapsed beyond the plan's retention window.

Main flow end to end:

1. Admin creates packages in a 4-step wizard (basics and price, numeric limits, feature toggles, display and review) and flags one as the signup default. Free plans start a trial countdown at signup (length and default plan come from admin general settings).
2. A new workspace lands on the default plan (WSP/AUTH own the creation screens; the plan and trial resolution rules are described in TW-PLAN-008 and 016). A free plan with a positive trial length stamps `trial_ends_at`.
3. The user sees plans on the in-app plan picker (`/account/plans`) and public `/pricing`; a paid plan is bought through checkout (PAYGW owns checkout, gateways, order finalisation and the subscription lifecycle; on success the workspace's `plan` is switched, `trial_ends_at` cleared and `plan_ends_at` stamped from the package's duration).
4. While the workspace is on a free plan with a trial the bar counts down; when it ends every feature route bounces to the plan picker (trial hard gate) until a plan is bought. When a paid plan lapses (`plan_ends_at` passes) the workspace silently drops to the free package: paid flags lock, caps shrink, and the free message allowance stops applying (WALLET).
5. Every gated action asks the same question: is this flag or cap in the workspace's effective entitlements (per-workspace overrides, then plan, then add-ons; WSP owns the resolver, ADD owns the add-on merge)? Count caps (`PlanLimitGuard::check`) throw a structured error; whole pages (`plan:` route middleware, `config/plan_gates.php` path map) show a paywall sheet over the page for reads and hard-block mutations; navigation shows a gold crown or a dimmed locked row.
6. Admin watches subscriber counts and MRR on the Packages list, Package analytics, Financial and Premium dashboards.

How plan tiers change it: the seeded reference ladder is Starter (free, 1 device, 500 contacts, 1,000 messages a month) - Growth (19/month) - Pro (49/month, highlighted) - Enterprise (custom quote, everything unlimited and every flag on), each tier a superset of the one below; this ladder is only created by `PackageSeeder`, which the default `DatabaseSeeder` does NOT call, so a fresh reference database has zero packages.

Ownership seams (do not duplicate, reference):

- **WSP** owns `Workspace::package()`, `billingPackage()`, `effectiveLimit()`, trial/expiry predicates, per-workspace overrides (TW-WSP-010, TW-WSP-031), workspace creation and `WorkspaceProvisioner` (TW-WSP-001/002), admin edit-workspace plan grant (TW-WSP-026). This file documents what the plan side contributes (columns, semantics, who consumes them).
- **PAYGW** owns checkout, gateway drivers, `finalizeOrder` (plan switch, `plan_ends_at` maths, add-on grant), subscription lifecycle and reconciler (`SubscriptionService`, `SubscriptionReconciler`), order/billing history, invoices and the checkout settings screen (TW-PAYGW-007, 009 to 013, 026 to 030, 035 to 047).
- **ADD** owns add-on packages (`type='addon'`, `grants_json`, `workspace_addons`, admin/addons CRUD, add-on merge into limits, customer add-on tab; TW-ADD-025 to 035) and extension-contributed plan flags (TW-ADD-013/015).
- **CPN** owns coupons, credit packages, currencies and the conversion helpers used on price display. **WALLET** owns pay-per-message billing and what `planIsActive()` does to the free allowance. **AUTH** owns the register step 3 plan picker (TW-AUTH-009). **DASH** may also present admin dashboards; the Financial and Premium screens are documented here because they compute MRR straight from plans.

## Feature index

| Id          | Feature                                                              | Status      | Priority | Effort | Depends on              |
| ----------- | -------------------------------------------------------------------- | ----------- | -------- | ------ | ----------------------- |
| TW-PLAN-001 | Admin package catalogue list and KPI strip                           | implemented | P0       | M      | TW-PLAN-003             |
| TW-PLAN-002 | Package create/edit wizard (4 steps)                                 | implemented | P0       | L      | TW-PLAN-003, 006, 007   |
| TW-PLAN-003 | Package save: validation, slug, normalisation, mass-assignment gates | implemented | P0       | M      | -                       |
| TW-PLAN-004 | Package activate / deactivate toggle                                 | implemented | P1       | S      | TW-PLAN-001             |
| TW-PLAN-005 | Package delete with in-use guard                                     | implemented | P1       | S      | TW-PLAN-001             |
| TW-PLAN-006 | Numeric plan-limit catalogue and enforcement map                     | partial     | P0       | L      | TW-PLAN-017, 018        |
| TW-PLAN-007 | Feature-flag catalogue and enforcement map                           | partial     | P0       | L      | TW-PLAN-017, 019        |
| TW-PLAN-008 | Signup default plan, trial length and billing-scope settings         | implemented | P0       | S      | TW-PLAN-003             |
| TW-PLAN-009 | Pricing FAQ admin CRUD                                               | implemented | P2       | S      | -                       |
| TW-PLAN-010 | Public pricing page                                                  | implemented | P1       | M      | TW-PLAN-003             |
| TW-PLAN-011 | In-app plan picker (/account/plans)                                  | implemented | P0       | L      | TW-PLAN-003, 009        |
| TW-PLAN-012 | Cancel auto-renew                                                    | implemented | P1       | S      | TW-PLAN-011             |
| TW-PLAN-013 | Free-trial bar and renewal reminder bar                              | implemented | P1       | M      | TW-PLAN-016             |
| TW-PLAN-014 | Plan and usage panel (account Plan tab, API v1 me/usage)             | implemented | P1       | M      | TW-PLAN-006, 007        |
| TW-PLAN-015 | Trial-expiry hard gate                                               | implemented | P0       | M      | TW-PLAN-016             |
| TW-PLAN-016 | Plan and trial lifecycle states and transitions                      | implemented | P0       | M      | TW-PLAN-008, TW-WSP-010 |
| TW-PLAN-017 | Count limit guard and feature guard (PlanLimitGuard, error contract) | implemented | P0       | M      | TW-WSP-010              |
| TW-PLAN-018 | Delete-proof quota ledger (plan_usage)                               | implemented | P1       | M      | TW-PLAN-017             |
| TW-PLAN-019 | Route-level feature gate (plan middleware)                           | implemented | P0       | M      | TW-PLAN-017             |
| TW-PLAN-020 | Path-based paywall sheet (plan_gates)                                | implemented | P1       | M      | TW-PLAN-019             |
| TW-PLAN-021 | Premium crown and locked navigation                                  | implemented | P2       | S      | TW-PLAN-017             |
| TW-PLAN-022 | Per-plan customer API rate limit                                     | implemented | P1       | S      | TW-PLAN-003             |
| TW-PLAN-023 | Data-retention auto-wipe of lapsed workspaces                        | implemented | P2       | M      | TW-PLAN-016             |
| TW-PLAN-024 | Package analytics overview                                           | partial     | P2       | M      | TW-PLAN-001             |
| TW-PLAN-025 | Package analytics CSV export                                         | implemented | P2       | S      | TW-PLAN-024             |
| TW-PLAN-026 | Admin Financial dashboard                                            | implemented | P1       | M      | TW-PLAN-001             |
| TW-PLAN-027 | Admin Premium dashboard                                              | implemented | P2       | M      | TW-PLAN-001             |
| TW-PLAN-028 | Package display feature list (package_features)                      | dead-code   | P2       | S      | -                       |

## Features

### TW-PLAN-001 — Admin package catalogue list and KPI strip

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PLAN-003
- **Summary:** The super-admin's home for the tier ladder: a KPI strip (active, subscribed workspaces, MRR, total), a card grid previewing each plan and a detailed table with an inline active toggle and a row menu (edit, delete). Only real plans appear here; add-on packages (`type='addon'`) live on their own screen (ADD).
- **Actors & access:** super-admin only. Middleware `Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`. The seeded permission keys `packages.view/create/edit/delete` exist in the Spatie permission table but are NOT checked on any of these routes (QUIRK: any admin can do everything).
- **UX & screens:** `resources/views/admin/packages/index.blade.php` in the admin layout (page key `packages-index`, JS `packages-index.js` provides the floating three-dot row menu that closes on outside click, Escape, scroll and resize). Header: breadcrumb Admin > Packages, title "Subscription packages", buttons "Analytics" (to TW-PLAN-024) and "Add package" (to TW-PLAN-002). Flash `success` and `error` banners. KPI strip of four cards: Active packages (sub-line "N trial . M archived"), Workspaces subscribed ("across all plans"), MRR (active subs; sub-line "plan_amount x subscriptions"), Total packages ("in catalog"). Card grid (2 columns, 4 on large): each card shows `#id`, a pill (Free, Custom, or the capitalised `plan_unit`), the name, the price (Custom for custom quote; "Free" plus "/ N unit" when a duration is set for a free plan; otherwise the offer-aware price formatted in the package's own currency and "/ unit"), up to four bullets built from what is set (messages limit when greater than 0, "N devices . M users" when devices set with an infinity sign when seats is null, and Auto-reply, Flow builder, Analytics, Custom branding when those flags are on), an italic "No limits configured yet" when nothing qualifies, the workspace count (highlighted above 50) and an Edit link; the highlighted plan gets a thick border and a "Most popular" ribbon. Detailed table (min width 820): id, package (2-letter initials chip, name, "popular" and "default" badges, subtitle or "no subtitle"), price, duration ("N Unit"), subscribers, MRR cell (Free is 0; otherwise offer-aware price times count, shown "-" when 0), status toggle switch (submits the toggle form on change) and a row menu (Edit; Delete inside a confirm dialog titled "Delete package" whose text warns workspaces on the plan must be moved manually). Empty state: "No packages defined yet. Create the first one" link.
- **Endpoints:**

| Method uri         | Route name           | Action                        | Middleware                                   | Request | Response |
| ------------------ | -------------------- | ----------------------------- | -------------------------------------------- | ------- | -------- |
| GET admin/packages | admin.packages.index | AdminPagesController@packages | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | HTML     |

- **Data:** reads `packages` (only rows where `type = 'plan'` or NULL, ordered by `sort_order` then `plan_amount`) and raw `workspaces` grouped by the stored `plan` value (soft-deleted workspaces are counted because the query does not filter `deleted_at`). KPI maths: active = plans with `status` true; trial = plans with `free` true; archived = plans with `status` false; subscribed = workspaces whose `plan` value is IN the list of package NUMERIC ids; MRR = sum over paid (not `free`) and active plans of `chargeableAmount()` (offer price when greater than 0, else plan_amount; 0 for free or zero-priced) multiplied by the count of workspaces whose `plan` equals that numeric id.
- **Rules & edge cases:**
  1. QUIRK (counting split): `workspaces.plan` is written as the package SLUG (`plan_id`) at signup and as the numeric package ID by checkout and the admin workspace editor. Every count on this screen keys on the numeric id, so workspaces still holding a slug (for example every never-upgraded signup on `starter`) are NOT counted anywhere here, in the KPI strip, in the card footers or in MRR. A port must store one canonical plan reference (FK to the package) and count by it.
  2. QUIRK: MRR adds amounts in each package's own currency without conversion and then prints the total with the platform display currency symbol.
  3. The list is not paginated (O(10) rows expected).
  4. Ordering ties fall back to price ascending, so an unordered ladder still reads cheapest first.
  5. The MRR sub-line copy says plan_amount but the code uses the offer-aware chargeable amount (fixed after a bug where discounted plans overstated MRR).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** display currency symbol comes from `FormatSettings` (SET/CPN).
- **Acceptance criteria:**
  - Given three plans (one inactive, one free) and a legacy add-on package, when the admin opens the page, then the add-on is absent, total packages is 3, active is 2, trial is 1 and archived is 1.
  - Given a paid active plan priced 49 with offer 39 and two workspaces whose `plan` equals its numeric id, when the page renders, then its MRR cell shows 78 in the plan currency.
  - Given a workspace stored with the slug instead of the id, when the page renders, then (parity behaviour) that workspace is not counted; a corrected port must count it.
  - Given a non-admin user, when they open the URL, then they receive 403.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (packages), resources/views/admin/packages/index.blade.php, resources/js/charts/packages-index.js, app/Models/Package.php (scopePlans, chargeableAmount), Documentation/pages/admin-panel/plans-packages.html.
- **Port notes:** new `plans` module in billing (`apps/api/src/modules/plans`), admin UI under `apps/web` admin area. Store a single FK `workspace.plan_id` (never slug or id interchangeably) and compute subscriber counts and MRR with grouped SQL under platform scope (RLS bypass for platform admin role). Convert MRR to one reporting currency.

### TW-PLAN-002 — Package create/edit wizard (4 steps)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PLAN-003, TW-PLAN-006, TW-PLAN-007
- **Summary:** One guided form creates and edits a package: Basics and pricing, Limits, Features, then Display and review. A clickable stepper, Back/Next buttons and a live review panel keep a 100-field form navigable. Editing shows exactly the stored values.
- **Actors & access:** super-admin (same middleware as TW-PLAN-001).
- **UX & screens:** `resources/views/admin/packages/create.blade.php` serves both create (`package = null`) and edit; page key `admin-packages-create` / `admin-packages-edit` (both map to `admin-packages-create.js`). Header shows "Step N / total" (total is 5 when an installed extension contributed an Instagram group, else 4), Cancel, Back (disabled on step 1), Next, and on the last step the submit button ("Create package" or "Save changes"). The stepper nodes are clickable: going backwards is always allowed, going forwards runs validation of the current step first.
  - **Step 1 Basics:** Package type select (Plan - full subscription | Add-on - feature pack; defaults to the `?type=` query value else plan; choosing add-on redirects to the add-on list after save); Data retention days (number 0 to 3650, default 0, "0 = never"); Package name (required, max 120); Subtitle (max 191); Price (required, number 0 or more, step 0.01, hint "0 = free. Set Free plan toggle"); Offer price (optional, must be lower than Price); Currency (required, options are the ACTIVE currencies ordered by code, falling back to USD, INR, EUR when none); Billing period: number (required, 1 to 120) plus unit select (days, weeks, months, years; default 1 months); Plan description textarea (max 5000, "shown on pricing page"); six switch cards: Free plan, Lifetime, Active (checked by default on create), Default for signups, Highlight as popular, Custom quote. Each switch posts a hidden 0 plus a checkbox 1.
  - **Step 2 Limits:** grouped inputs (Messaging caps, Workspace caps, Content caps, AI and voice caps, Commerce and SLA, Other caps) of number inputs (min 0) with placeholder "infinity unlimited"; a stored 0 renders blank. Every input shows its column name as a tiny mono caption and an info hint ("Leave blank for unlimited; type a number to cap it"). Group membership and labels are listed in TW-PLAN-006.
  - **Step 3 Features:** grouped toggle switches (Messaging, Channels, Inbox and team, AI and calling, Commerce, Integrations, Advanced), all checked by default for a NEW package (unchecked means blocked); each shows label plus column name. A toggle is rendered only when its key is BOTH in the form's group map and in the controller's toggle list (see QUIRK in TW-PLAN-003).
  - **Step 4 (only with an extension that contributes Instagram fields):** Instagram toggles and caps pulled out of the generic groups.
  - **Final step Display and review:** CTA label (default "Get started", max 64), Sort order (number 0 or more, default 0, lower first), and a live "Review" panel built by JS from the form (name, subtitle, "CUR price (offer: x)", billing, flags list, "N cap(s) configured" or "all unlimited", "N enabled" features, CTA, sort order).
  - JS validation before advancing from step 1 only: name non-empty, price a number of 0 or more, duration at least 1, currency chosen; each failure shows an alert "Fix this first" with a message and focuses the field. The page scrolls to top on every step change.
  - Errors: a red box "Please fix the following" lists server validation errors; success and error flashes render above the form.
- **Endpoints:**

| Method uri                   | Route name            | Action                             | Middleware  | Request         | Response                                       |
| ---------------------------- | --------------------- | ---------------------------------- | ----------- | --------------- | ---------------------------------------------- |
| GET admin/packages/create    | admin.packages.create | AdminPagesController@packageCreate | admin group | none            | wizard (empty), currencies list                |
| GET admin/packages/{id}/edit | admin.packages.edit   | AdminPagesController@packageEdit   | admin group | none            | wizard for the row; 404 when the id is unknown |
| POST admin/packages          | admin.packages.store  | AdminPagesController@packageStore  | admin group | all form fields | redirect (see TW-PLAN-003)                     |
| PATCH admin/packages/{id}    | admin.packages.update | AdminPagesController@packageUpdate | admin group | all form fields | redirect (see TW-PLAN-003)                     |

- **Data:** reads `packages` (edit) and `currencies` (active, code/name/symbol). The edit route uses `findOrFail` on ANY package id, add-ons included.
- **Rules & edge cases:**
  1. The wizard field lists come from the controller's `planLimitColumns()` and `planFeatureToggles()` (core plus extension-contributed) and the blade's own group maps; a key must be in both to render (the "double gate").
  2. New package defaults: Active on, every feature toggle on, every limit blank (saved as 0), sort order 0, currency the first option (USD fallback), period 1 months, CTA "Get started".
  3. The CTA URL input was removed from the form ("plan buttons always go to checkout"), but the review panel still prints a CTA URL default of /checkout and the server still validates and stores `cta_url` when a client posts it; the docs advertise a CTA URL field (docs-only).
  4. The alternate legacy scripts `packages-create.js` and `packages-edit.js` (six-step wizard) are wired to page keys that no current blade uses (dead JS).
  5. The Instagram step and its inputs exist only when an installed extension manifest contributes an "Instagram" group (ADD).
  6. Edit shows the stored slug nowhere; the slug (`plan_id`) is immutable after creation.
- **Async & events:** on save the `Package` model's created/updated hooks record an in-app notification to the acting admin (noun "Plan", category billing, link /pricing) through the generic `LogsNotifications` trait (NOTIF); no audit-log entry is written for package changes.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the create wizard, when the admin leaves the name empty and clicks Next, then an alert "Fix this first" appears and the step does not advance.
  - Given a package with `device_limit = 0`, when its edit form opens, then the devices input is blank with the unlimited placeholder.
  - Given the admin submits offer 60 with price 50, when saved, then the server rejects with "The offer price must be lower than the plan price".
  - Given the last step, when the review panel renders, then it reflects unsaved edits made on earlier steps.
- **Source refs:** resources/views/admin/packages/create.blade.php, resources/js/charts/admin-packages-create.js, resources/js/charts/packages-create.js, resources/js/charts/packages-edit.js, app/Http/Controllers/AdminPagesController.php (packageCreate, packageEdit, planFeatureToggles, planLimitColumns), Documentation/pages/admin-panel/plans-packages.html.
- **Port notes:** implement the stepper as one React form with per-step zod validation from `@crm/contracts`; drive both the limit and the feature lists from a single server-side plan catalogue (TW-PLAN-006/007) so the "declared in one list but not the other" trap cannot recur. Keep a live review step.

### TW-PLAN-003 — Package save: validation, slug, normalisation, mass-assignment gates

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** The single persistence routine behind create and update. It derives a unique slug, validates price, offer and period, coerces blank limits to 0 and unchecked toggles to false, and silently drops keys that are not fillable.
- **Actors & access:** super-admin.
- **UX & screens:** the wizard of TW-PLAN-002. After save the admin is redirected to `admin.packages.index` with flash "Package created." or "Package updated."; when the saved package's `type` is `addon` the redirect goes to `admin.addons.index` with "Add-on created/updated." (ADD screen).
- **Endpoints:** POST admin/packages (`admin.packages.store`) and PATCH admin/packages/{id} (`admin.packages.update`), both handled by `AdminPagesController@packagePersist` through `packageStore` / `packageUpdate`; request fields as listed under Data.
- **Data:** writes `packages`. Validation rules: `pname` required string max 120; `subtitle` nullable max 191; `detail` nullable max 5000; `plan_id` nullable max 191 (rewritten server-side, see rule 1); `plan_amount` required numeric min 0; `offer_price` nullable numeric min 0 and strictly less than `plan_amount`; `currency` required max 10; `plan_duration` required integer 1..120; `plan_unit` required in days, weeks, months, years; `cta_label` nullable max 64; `cta_url` nullable max 255; `sort_order` nullable integer min 0; `free`, `lifetime`, `status`, `is_default`, `is_highlighted`, `is_custom_quote` nullable boolean; `type` nullable in plan, addon; `data_retention_days` nullable integer 0..3650; every limit column nullable integer min 0; every feature toggle nullable boolean.
- **Rules & edge cases:**
  1. Slug (`plan_id`, unique VARCHAR 255 NOT a number): on edit the row's existing slug is forced (never renamed); on create the posted value (or, when blank, the name) is slugified with underscores, falling back to `plan`, then made unique by appending `_2`, `_3` and so on. Because the slug is later stored in `workspaces.plan` (VARCHAR 32) a slug longer than 32 characters can truncate or fail in strict SQL mode (QUIRK; the form's max 191 is not aligned).
  2. Blank or null limit -> 0. The database columns are NOT NULL DEFAULT 0 for the original limit set and NULLABLE for the later ones; the save path writes 0 for every limit column so the UI promise "leave blank = unlimited" is realised as 0. Every limit consumer treats 0, null and negative as unlimited (TW-PLAN-017). Missing limit keys are defaulted to 0; missing feature toggles to false; missing basic flags to false.
  3. Toggles and basic flags are cast to boolean. `multipledevice` and `file_type_restrictions` are VARCHAR columns treated as boolean toggles (stored as 0/1 text).
  4. `type` falls back to plan; `data_retention_days` blank becomes 0; `sort_order` blank becomes 0.
  5. QUIRK (silent drop): only names in `Package::$fillable` (plus extension-contributed keys) are persisted. The validated toggle `access_whatsapp_pay` is NOT fillable, and the columns `auto_invoice`, `auto_invoice_max_monthly`, `auto_invoice_branding` are neither validated nor fillable, so an admin can render the "WhatsApp Pay" switch, save "successfully", and nothing changes; those gates therefore stay at their database default (closed) for every non-admin workspace. `access_instagram` is a validated toggle but not a column and not fillable unless the extension is installed.
  6. QUIRK (double-gate trap): columns `pipelines_limit`, `facebook_pages_limit`, `facebook_scheduled_posts_limit`, `tiktok_accounts_limit`, `tiktok_scheduled_posts_limit`, `telegram_bots_limit`, `line_channels_limit`, `wechat_channels_limit`, `viber_channels_limit`, and flags `access_line`, `line_broadcasts`, `access_wechat`, `wechat_broadcasts`, `access_viber`, `viber_broadcasts` exist in the schema and in `$fillable` but are in NEITHER the controller lists nor the wizard, so they can never be set from the UI: limits stay 0 (unlimited) and the LINE, WeChat and Viber channel flags stay 0 (channel blocked) for every plan unless set in the database.
  7. QUIRK: `access_wa_forms` and `access_wa_links` appear in the wizard's label map and group map but are not toggles (no column), so the switches never render; the routes gated by them (`plan:access_wa_forms`, `plan:access_wa_links`) resolve an unknown key to the fallback true and are open to every plan.
  8. Ordering of `sort_order` for ties falls back to price when listed.
  9. No audit log is written (only the generic model notification). Changing a package's limits takes effect immediately for every workspace on it (there is no versioning or grandfathering).
  10. The row is written with `create` or `update`; there is no optimistic locking, so two admins editing the same plan overwrite each other.
- **Async & events:** model created/updated notification to the acting admin (NOTIF). No queue.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new package named "Pro Plus" and no slug, when saved twice with the same name, then the slugs are `pro_plus` and `pro_plus_2`.
  - Given a plan with a blank `contacts_limit`, when saved, then the column stores 0 and contacts are unlimited.
  - Given an edit request that posts a different `plan_id`, when saved, then the stored slug is unchanged.
  - Given `offer_price` equal to `plan_amount`, when submitted, then validation fails with the offer-price message and nothing is written.
  - Given the `access_whatsapp_pay` switch on, when saved, then (parity) the column stays unchanged; a port should either persist it or remove the switch.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (packagePersist, PLAN_LIMIT_COLUMNS, PLAN_FEATURE_TOGGLES), app/Models/Package.php ($fillable, getFillable, $casts), database/migrations/2026_05_05_000008_create_packages_table.php, 2026_05_17_030000_extend_packages_schema.php.
- **Port notes:** make the catalogue (TW-PLAN-006/007) the single source for validation, persistence and the form; store limits as nullable integer with NULL = unlimited and reserve 0 for "none allowed" or keep 0 = unlimited but document it; add a DB unique constraint on slug per platform; do not accept a client-supplied slug on edit. Package is a platform-level (non-tenant) table: no org_id, no RLS, but admin-only access.

### TW-PLAN-004 — Package activate / deactivate toggle

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-PLAN-001
- **Summary:** One click flips `packages.status`; an inactive plan disappears from every buyer surface but keeps serving the workspaces already on it.
- **Actors & access:** super-admin.
- **UX & screens:** the switch in the detailed table of TW-PLAN-001; submits on change. Flash "Activated." or "Deactivated.".
- **Endpoints:**

| Method uri                      | Route name            | Action                             | Middleware  | Request | Response                 |
| ------------------------------- | --------------------- | ---------------------------------- | ----------- | ------- | ------------------------ |
| POST admin/packages/{id}/toggle | admin.packages.toggle | AdminPagesController@packageToggle | admin group | none    | redirect back with flash |

- **Data:** writes `packages.status` (boolean).
- **Rules & edge cases:**
  1. Workspaces already on an inactive plan keep their flags and limits: entitlement resolution ignores `status`. Inactive only hides the plan from: `/account/plans`, public `/pricing`, register step 3, the paywall plan cards, checkout (`checkout/{id}` requires `status = 1`, 404 otherwise) and the default-plan candidates.
  2. The toggle works on add-on rows too (same table) but the add-on screen has its own toggle.
  3. Flipping the plan that is `registration_default_plan_id` to inactive breaks signup resolution: `registration_default_plan_id` is looked up with `status = 1`, so it silently falls through to `is_default`, then first free plan, then the literal slug `starter` (see TW-PLAN-008).
  4. The model updated hook fires a "Plan updated" notification to the admin.
- **Async & events:** notification only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active plan, when the admin toggles it, then `status` becomes false, the flash reads "Deactivated." and the plan no longer appears on `/account/plans`.
  - Given a workspace on that plan, when it exercises a plan-gated action, then it is still governed by that plan's flags.
  - Given an unknown id, when posted, then 404.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (packageToggle), resources/views/admin/packages/index.blade.php.
- **Port notes:** expose `PATCH /admin/plans/:id { active }`; keep the hide-not-revoke semantics and add an admin warning when the plan is the signup default.

### TW-PLAN-005 — Package delete with in-use guard

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-PLAN-001
- **Summary:** Deleting a package is blocked while any workspace references it; otherwise the row is hard-deleted.
- **Actors & access:** super-admin. The row menu's Delete opens a confirm dialog ("Delete <name>? This cannot be undone. Workspaces currently on this plan will need to be moved manually.").
- **UX & screens:** row menu of TW-PLAN-001. Success redirects to the list with "Package deleted."; blocked deletes return back with an error "Cannot delete: N workspace(s) currently use this package.".
- **Endpoints:**

| Method uri                 | Route name             | Action                              | Middleware  | Request | Response |
| -------------------------- | ---------------------- | ----------------------------------- | ----------- | ------- | -------- |
| DELETE admin/packages/{id} | admin.packages.destroy | AdminPagesController@packageDestroy | admin group | none    | redirect |

- **Data:** counts `workspaces` where `plan` equals the package's numeric id; deletes the `packages` row (hard delete, no soft delete).
- **Rules & edge cases:**
  1. QUIRK: the guard compares `workspaces.plan` to the numeric id only. Workspaces whose `plan` holds the slug (signup default, PackageSeeder) are not counted, so a plan can be deleted while workspaces still point at its slug; those workspaces then resolve to NO package (null entitlements: fallback values apply, features open, limits unlimited) or, once `plan_ends_at` passes, the free package. Also soft-deleted workspaces are counted by this query (no `deleted_at` filter) so the guard can over-block.
  2. No check for subscriptions, orders, or add-on purchases referencing the package; `orders.package_id` and `subscriptions.package_id` are plain unsigned columns (no FK) and become dangling ("Plan #id" in order history).
  3. The delete works on add-on rows through this route as well.
  4. The docs suggest deactivating instead (TW-PLAN-004).
- **Async & events:** model deleted hook records a "Plan deleted" notification (severity warning, no link).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a plan used by 2 workspaces (by numeric id), when deleted, then the response is an error naming 2 workspaces and the row remains.
  - Given an unused plan, when deleted, then the row is gone and the list shows "Package deleted.".
  - Given a plan referenced only through slug-stored workspaces, when deleted, then (parity) it deletes; a port must block on any reference.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (packageDestroy), resources/views/admin/packages/index.blade.php, Documentation/pages/admin-panel/plans-packages.html.
- **Port notes:** use an FK `workspaces.plan_id references plans(id) on delete restrict`; prefer archive over delete; keep purchased-order history readable by snapshotting plan name on the order.

### TW-PLAN-006 — Numeric plan-limit catalogue and enforcement map

- **Status:** partial
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PLAN-017, TW-PLAN-018
- **Summary:** The complete list of numeric caps a package carries, what each means, its default, and (crucially) where Reference really enforces it. About half of the 48 caps (26) are stored, shown on the pricing page and editable, but nothing in the app reads them: the port must decide to enforce them or drop them. This entry is the contract for the plan-limit column set and the guard call sites.
- **Actors & access:** super-admin edits values (TW-PLAN-002); workspaces are bound by them.
- **UX & screens:** step 2 of the wizard groups the inputs (Messaging caps, Workspace caps, Content caps, AI and voice caps, Commerce and SLA, Other caps); the pricing pages render them as "N label" rows using the label map in `Package::featureCatalog()`; the plan and usage panel shows five meters (messages this month, contacts, connected numbers, team seats, flows).
- **Endpoints:** none (catalogue). Enforcement runs inside the endpoints named in the table.
- **Data:** `packages` numeric columns. Unless stated the DB default is 0 NOT NULL; "null" means nullable unsigned default NULL. Semantics everywhere: the guard treats null, 0 and any negative value as UNLIMITED; a per-workspace override or add-on may supply -1 for unlimited. Wizard group in brackets.

| Key (wizard label)                                                                                                                                                                                                | Default        | Enforced by (`check` = live row count vs cap when creating row N+1)                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| device_limit (Devices) [Workspace]                                                                                                                                                                                | 1              | `check` on every connect path: WaConnectController (3 sites), DevicesController (3), mobile DeviceController (3); count = devices plus WABA provider configs of the workspace |
| monthly_messages_limit (Messages / month) [Messaging]                                                                                                                                                             | 0              | NOT a hard block. Free monthly allowance consumed before wallet credits (WALLET `OverflowBilling`, `MessageBillingService`); usage meter; schedule preview; extension API     |
| contacts_limit [Workspace]                                                                                                                                                                                        | 0              | `check` in ContactsController create and import (live contact count)                                                                                                          |
| broadcast_limit [Messaging]                                                                                                                                                                                       | 0              | `check` in BroadcastsController create (live broadcasts count)                                                                                                                |
| template_limit [Content]                                                                                                                                                                                          | 0              | `check` in TemplatesController create (live WaTemplate count)                                                                                                                 |
| total_campaigns_limit (Total campaigns) [Messaging]                                                                                                                                                               | 0              | `checkQuota` (ledger metric `campaign`) in WaCampaignsController and mobile CampaignController (TW-PLAN-018)                                                                  |
| user_seat_limit (Team seats) [Workspace]                                                                                                                                                                          | 0              | `check` in WorkspaceMembersController invite (count of `workspace_user` rows); meter counts users whose `current_workspace_id` is the workspace (different number, QUIRK)     |
| tags_limit [Workspace]                                                                                                                                                                                            | 0              | `check` in TeamInboxController tag create                                                                                                                                     |
| flow_limit [Content]                                                                                                                                                                                              | 0              | `check` at four FlowsController sites (create, duplicate, import, template clone)                                                                                             |
| autoreply_limit (Keyword auto-replies) [Content]                                                                                                                                                                  | 0              | `check` in AutoReplyController create                                                                                                                                         |
| scheduled_campaign_limit [Messaging]                                                                                                                                                                              | 0              | `check` in ScheduledController store (count of ALL the workspace's scheduled messages)                                                                                        |
| workspaces_per_owner_limit [Workspace]                                                                                                                                                                            | null           | `check` in WorkspacesController@store using the CURRENT workspace's plan and the count of workspaces the user owns; mobile WorkspaceController and `User` also read it        |
| routing_rules_limit [Other]                                                                                                                                                                                       | null           | `check` in TeamInboxController rule create                                                                                                                                    |
| saved_replies_limit (Quick replies) [Content]                                                                                                                                                                     | null           | `check` in TeamInboxController saved-reply create                                                                                                                             |
| ai_agents_limit [AI]                                                                                                                                                                                              | null           | `check` in TeamInboxController AI agent create                                                                                                                                |
| appointments_limit (Appointments / month) [Commerce]                                                                                                                                                              | null           | `check` in AppointmentController create against appointments whose start is in the current calendar month (includes future ones)                                              |
| webhooks_limit (Outbound webhooks) [Other]                                                                                                                                                                        | null           | `check` in WebhooksController create                                                                                                                                          |
| ai_token_limit_monthly (AI tokens / month) [AI]                                                                                                                                                                   | null           | read by AIADM (`AiTokenMeter`, `AiUsageController`, settings tab) when the workspace falls back to admin AI keys                                                              |
| api_rate_limit_per_minute (API rate limit / min) [Other]                                                                                                                                                          | 0 NOT NULL     | `ApiPlanRateLimit` (TW-PLAN-022); 0 means use the global default, NOT unlimited                                                                                               |
| sms_monthly_limit [Messaging]                                                                                                                                                                                     | 0              | `check` (with the month's outbound count) in SmsCampaignRunner and SmsBroadcastRunner: on breach the campaign or broadcast is set to failed                                   |
| email_monthly_limit [Messaging]                                                                                                                                                                                   | 0              | same, in EmailCampaignRunner                                                                                                                                                  |
| groups_limit, campaign_messages_limit, automation_messages_limit, broadcast_size_limit, active_campaign_limit, flow_steps_limit, chatbot_limit, daily_media_size_allowance, drip_campaigns_limit                  | 0 (drip: null) | DECLARED ONLY: no web code reads them (groups_limit is echoed by the mobile plan payload)                                                                                     |
| waba_calling_minutes_monthly, ai_voice_minutes_monthly, ai_chat_messages_monthly, ai_training_sources_limit, chatbot_widgets_limit, storefronts_limit, sla_policies_limit, translation_chars_monthly              | null           | DECLARED ONLY: nothing enforces or meters them                                                                                                                                |
| pipelines_limit, facebook_pages_limit, facebook_scheduled_posts_limit, tiktok_accounts_limit, tiktok_scheduled_posts_limit, telegram_bots_limit, line_channels_limit, wechat_channels_limit, viber_channels_limit | null / 0       | DECLARED ONLY and not settable from the admin UI (TW-PLAN-003 rule 6)                                                                                                         |
| auto_invoice_max_monthly                                                                                                                                                                                          | 0              | read by INV `InvoiceService` (monthly auto-invoice cap; 0 = unlimited); not settable from the admin UI                                                                        |

- **Rules & edge cases:**
  1. `check` compares the CURRENT count with the cap and blocks when `used >= limit`, that is when creating row N+1; a live-count cap frees a slot when a row is deleted (unlike the ledger, TW-PLAN-018).
  2. The core list is `PLAN_LIMIT_COLUMNS` (38 keys) in the admin controller; installed extensions may add limits (ADD). The public and account plan lists render every catalogue limit with 0 shown as "Unlimited" and null hidden (the compare table shows a dash for null).
  3. Add-ons stack limits onto the plan (TW-ADD-031); per-workspace overrides may set any of the 38 limit keys with -1 as unlimited (TW-WSP-031); platform-admin-owned workspaces are unlimited for every key.
  4. Workspace-level `cap_monthly_messages`, `cap_daily_messages`, `cap_devices`, `cap_users` columns exist on `workspaces` (edited on the admin workspace form) but no code reads them (declared only, WSP).
  5. `data_retention_days` is a package column but not a limit (TW-PLAN-023).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `security.api_rate_limit_per_minute` (default 600) backs the API cap; `credits_per_message` and pay-per-message mode change how `monthly_messages_limit` behaves (WALLET).
- **Acceptance criteria:**
  - Given a plan with `contacts_limit = 500` and a workspace with 500 contacts, when it creates a 501st contact or imports, then the request fails with the plan-limit error (TW-PLAN-017).
  - Given a plan with `contacts_limit = 0`, when the workspace creates contacts, then no limit applies.
  - Given a workspace on a plan with `waba_calling_minutes_monthly = 10`, when it places 30 minutes of calls, then (parity) nothing blocks it; a port that enforces it must add metering.
  - Given SMS sends above `sms_monthly_limit`, when the campaign runner starts, then the campaign is marked failed with the limit message.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (PLAN_LIMIT_COLUMNS), app/Models/Package.php (featureCatalog, $fillable), app/Services/PlanLimitGuard.php, controllers named in the table, database/migrations/2026_05_05_000008, 2026_05_17_030000, 2026_05_21_075220, 2026_06_13_100400, 2026_06_24_140000, 2026_08_15_000200, 2026_08_16_000200, 2026_08_16_000500, 2026_08_16_000700, 2026_08_20_100600, 2026_08_27_100100, 2026_08_30_000700 (and the *_plan_columns migrations for LINE, WeChat, Viber).
- **Port notes:** model limits as a typed JSONB `limits` object or a `plan_limits(plan_id, key, value)` table with a shared TypeScript key registry in `@crm/contracts`; add a `used` provider per key so the plan and usage panel and the guard share one counting function. Enforce inside the owning module's service in the same transaction as the insert to avoid the read-then-write race (Reference counts and inserts separately; two concurrent creates can both pass).

### TW-PLAN-007 — Feature-flag catalogue and enforcement map

- **Status:** partial
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PLAN-017, TW-PLAN-019
- **Summary:** The full list of boolean capabilities a package can grant and the way each is enforced: route middleware, in-context guard, display-only paywall, or nothing at all. The DB default for most flags is OFF (a plan must opt in) except the group added in 2026_05_17 (default ON). The wizard pre-ticks everything for a new package.
- **Actors & access:** admin edits (TW-PLAN-002); workspaces are gated.
- **UX & screens:** step 3 groups (Messaging, Channels, Inbox and team, AI and calling, Commerce, Integrations, Advanced); pricing surfaces render the capability labels from the catalogue (`Package::featureCatalog()`), enabled ones first; the plan and usage panel splits 31 curated flags into unlocked and locked lists.
- **Endpoints:** none owned. Route-level enforcement is by the `plan:<key>[,<key>]` alias of `EnforcePlanFeature` (TW-PLAN-019); routes carrying it: access_sales_pipeline 48, access_facebook 23, access_telegram 23, access_tiktok 17, access_wa_storefront 16, access_waba_calling 14, auto_invoice 13, access_line 13, access_ai_chat_assistant 12, facebook_posts 12, access_lead_finder 9, access_appointment_booking 9, access_wechat 9, access_viber 6, access_wa_forms 10, access_wa_links 6, access_ai_voice_agent 7, access_chatbot_widgets 7, line_broadcasts 8, telegram_broadcasts 8, viber_broadcasts 8, wechat_broadcasts 5, tiktok_posts 5, integration_trello 5, integration_slack 4, access_sms 4, access_whatsapp_pay 4, access_ai_agents 4 (`ai-crm`), tiktok_inbox 2, access_analytics 2, access_team_performance 2, access_kanban_view 1, access_sla_policies 1.
- **Data:** `packages` tinyint(1) columns. Enforcement column below: R = route middleware, G = in-context guard (throws or silently degrades), P = display-only path paywall (`config/plan_gates.php`), N = nav lock and crown, "-" = declared only (nothing reads it).

| Key (label)                                                                                                                                                                                                                                                                                  | DB default                      | Enforcement                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| autoreply (Auto-reply system), bulkmessage (Bulk messaging)                                                                                                                                                                                                                                  | 0                               | - (only the mobile content API echoes them)                                                                                                                             |
| schedulemessage (Scheduled messages)                                                                                                                                                                                                                                                         | 0                               | G ScheduledController; P scheduled/*; crown                                                                                                                             |
| campaign (Campaigns)                                                                                                                                                                                                                                                                         | 0                               | G WaCampaignsController and mobile CampaignController; P wa-campaigns/*                                                                                                 |
| autoflow (Flow builder / Flow automation)                                                                                                                                                                                                                                                    | 0                               | P flows/*; N; crown. NO server block on flow POSTs (only `flow_limit`)                                                                                                  |
| broadcast (Broadcasts)                                                                                                                                                                                                                                                                       | 0                               | G BroadcastsController (2 sites); P broadcasts/*; crown                                                                                                                 |
| template (Templates)                                                                                                                                                                                                                                                                         | 0                               | G TemplatesController; P templates/*; N                                                                                                                                 |
| chatgpt_suggestion (AI reply suggestions), access_carousel_templates, access_drip_campaigns, role_based_permissions, access_call_recording, access_ai_generate, access_flows_commerce, access_data_residency, facebook_inbox, tiktok_comments, auto_invoice_branding, file_type_restrictions | 0 (file_type_restrictions NULL) | -                                                                                                                                                                       |
| ads (Meta Ads integration)                                                                                                                                                                                                                                                                   | 0                               | - (declared only; the Meta Ads pages are gated by `access_ctwa` paths)                                                                                                  |
| access_ctwa (Click-to-WhatsApp ads)                                                                                                                                                                                                                                                          | 0                               | P meta-ads/*; N                                                                                                                                                         |
| access_keyword_replies                                                                                                                                                                                                                                                                       | 1                               | G AutoReplyController (7 sites); P auto-reply/*; crown                                                                                                                  |
| access_edit_messages, access_internal_notes, access_message_reactions                                                                                                                                                                                                                        | 1                               | - (no server check found)                                                                                                                                               |
| access_routing_rules                                                                                                                                                                                                                                                                         | 1                               | G TeamInboxController; crown                                                                                                                                            |
| access_business_hours                                                                                                                                                                                                                                                                        | 1                               | crown only (no server check)                                                                                                                                            |
| access_team_performance                                                                                                                                                                                                                                                                      | 1                               | R team-inbox/analytics/team and /ai-agents; crown                                                                                                                       |
| access_kanban_view                                                                                                                                                                                                                                                                           | 1                               | R team-inbox/kanban; crown                                                                                                                                              |
| access_sla_policies                                                                                                                                                                                                                                                                          | 0                               | R team-inbox/sla; crown                                                                                                                                                 |
| access_appointment_booking                                                                                                                                                                                                                                                                   | 1                               | R appointments/booking-types etc (9); G AppointmentController, BookingApiController; P appointments/*; N                                                                |
| access_outbound_webhooks                                                                                                                                                                                                                                                                     | 1                               | G WebhooksController; P webhooks/*; N                                                                                                                                   |
| access_ai_agents                                                                                                                                                                                                                                                                             | 1                               | R ai-crm (4 routes); G TeamInboxController, Facebook composer and post controllers, `AiAgentService` (runtime silently skips the agent, no error); P ai-assistants/*; N |
| access_ai_chat_assistant                                                                                                                                                                                                                                                                     | 0                               | R ai-training/* API (12 routes; QUIRK: the AI-training page routes use the chat-assistant flag while the path map uses `access_ai_training`)                            |
| access_ai_voice_agent                                                                                                                                                                                                                                                                        | 0                               | R ai-assistants/* (7); crown                                                                                                                                            |
| access_ai_training                                                                                                                                                                                                                                                                           | 0                               | P ai-training/*; N; crown (route level uses access_ai_chat_assistant)                                                                                                   |
| allow_byok_ai_keys                                                                                                                                                                                                                                                                           | 0                               | G via `effectiveLimit` in SettingsTabsController (hides the AI keys tab), `AiKeyResolver` (user keys take precedence only when on)                                      |
| access_waba_calling                                                                                                                                                                                                                                                                          | 0                               | R wa-calling and call-logs (14); P; crown                                                                                                                               |
| access_wa_storefront                                                                                                                                                                                                                                                                         | 0                               | R catalog and store (16); P store/_, catalog/_; N                                                                                                                       |
| access_whatsapp_pay                                                                                                                                                                                                                                                                          | 0                               | R store payments (4). NOT persistable from the wizard (TW-PLAN-003 rule 5) so effectively closed                                                                        |
| access_chatbot_widgets                                                                                                                                                                                                                                                                       | 0                               | R chatbot-widgets (7); P; N; crown                                                                                                                                      |
| access_sales_pipeline                                                                                                                                                                                                                                                                        | 0                               | R 48 deal, company, project, task, calendar routes; G API v1 DealController, TeamInbox, flow nodes, UserPagesController; P deals/*; N                                   |
| access_analytics                                                                                                                                                                                                                                                                             | 0                               | R analytics and analytics/export; P analytics/*; crown                                                                                                                  |
| access_lead_finder                                                                                                                                                                                                                                                                           | 0                               | R lead-finder (9); N; crown                                                                                                                                             |
| access_translation                                                                                                                                                                                                                                                                           | 0                               | G AccountController (translation settings), ConversationTranslationService (feature quietly off)                                                                        |
| remove_branding                                                                                                                                                                                                                                                                              | 0                               | G AccountController (custom footer save), `BrandingFooterService` (custom or no footer only when on; otherwise the platform footer is forced)                           |
| access_proxy_isolation                                                                                                                                                                                                                                                                       | 0                               | G DevicesController (2 sites)                                                                                                                                           |
| multipledevice (Multi-device sending)                                                                                                                                                                                                                                                        | NULL                            | G ChatController (`canMultiDevice`)                                                                                                                                     |
| integration_shopify, integration_woocommerce, integration_hubspot                                                                                                                                                                                                                            | 1                               | G in each controller (3, 3, 1 sites); P shopify/_, woocommerce/_, hubspot/*                                                                                             |
| integration_google_calendar                                                                                                                                                                                                                                                                  | 1                               | G AppointmentController, GoogleCalendarOAuthController; P google-account/*; crown                                                                                       |
| integration_google_sheets                                                                                                                                                                                                                                                                    | 1                               | -                                                                                                                                                                       |
| integration_slack, integration_trello                                                                                                                                                                                                                                                        | 0                               | R slack/* (4) and trello/* (5); G inbound webhook handlers drop the event and log "blocked: plan lacks ..." when off                                                    |
| access_facebook (+ facebook_posts, facebook_comments, facebook_ai_agent)                                                                                                                                                                                                                     | 0                               | R facebook/* (23) and facebook posts (12); G FacebookConnectController, flow node, ingest service                                                                       |
| access_tiktok (+ tiktok_inbox, tiktok_posts)                                                                                                                                                                                                                                                 | 0                               | R tiktok* (17, 2, 5); G TiktokConnectController                                                                                                                         |
| access_telegram (+ telegram_broadcasts)                                                                                                                                                                                                                                                      | 0                               | R (23, 8); G TelegramConnectController; N                                                                                                                               |
| access_line, line_broadcasts, access_wechat, wechat_broadcasts, access_viber, viber_broadcasts                                                                                                                                                                                               | 0                               | R (13, 8, 9, 5, 6, 8); G connect controllers; N. NOT settable from the wizard (TW-PLAN-003 rule 6)                                                                      |
| access_sms                                                                                                                                                                                                                                                                                   | 0                               | R sms/* (4); G WaConnectController                                                                                                                                      |
| access_email                                                                                                                                                                                                                                                                                 | 0                               | G EmailCampaignRunner and `WorkspaceEngine` (email engine off); N                                                                                                       |
| auto_invoice                                                                                                                                                                                                                                                                                 | 0                               | R invoices routes (13); G `InvoiceService` (INV). NOT settable from the wizard                                                                                          |
| access_instagram (+ extension flags)                                                                                                                                                                                                                                                         | n/a                             | column absent unless the Instagram add-on is installed (ADD)                                                                                                            |
| access_wa_forms, access_wa_links                                                                                                                                                                                                                                                             | no column                       | R on wa-forms (10) and wa-links (6) routes but the key resolves to the fallback true, so open to every plan                                                             |
| access_whatsapp_warmer, ai_voice_reply                                                                                                                                                                                                                                                       | no column                       | G in WarmerController / AiVoiceReplyService; unknown key resolves true, so open                                                                                         |

- **Rules & edge cases:**
  1. Resolution of a flag for a workspace: per-workspace override (limit keys only via the admin endpoint), then billing package column, then the caller's fallback (true for `hasFeature` and `feature`), then add-ons (WSP/ADD). A NULL package value (for example `multipledevice`) is "not set" and so takes the fallback true; an unknown key is always allowed.
  2. `hasFeature` returns false only when there is no workspace at all; platform admins (Spatie role Super Admin or Admin, or legacy `users.role` admin/A) and workspaces owned by a platform admin always pass.
  3. Enforcement by page path (`plan_gates.php`) never blocks a POST: only routes with the `plan:` middleware or controllers that call the guard do (TW-PLAN-019/020). The paywall is advisory for reads.
  4. The seeded ladder (PackageSeeder, not run by default) keeps an explicit true/false for a 43-flag set: Starter gets autoreply, broadcast, schedulemessage, template, access_keyword_replies; Growth adds bulk, campaign, flows, ads, drip, five integrations, kanban, notes, reactions, edit messages, business hours, appointment booking, webhooks, chatbot widgets; Pro adds the AI suite, carousel templates, storefront, commerce flows, analytics, routing rules, team performance, CTWA, translation, calling, call recording, SLA policies; Enterprise has every flag on.
  5. Extension-contributed flags are merged into the same lists (ADD).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `billing_plan_scope` decides which package is read (WSP).
- **Acceptance criteria:**
  - Given a plan without `access_sla_policies`, when a workspace POSTs to `team-inbox/sla`, then it receives 403 JSON `plan_feature_disabled` (AJAX) or a back-redirect warning.
  - Given the same workspace GETs `team-inbox/sla`, then the page renders with the paywall sheet over it (no redirect).
  - Given `access_ai_agents` off, when an inbound message would trigger the AI agent, then the agent silently does not run and no error is raised.
  - Given a key that has no column (`access_wa_links`), when a workspace opens `wa-links`, then it is allowed.
  - Given a platform-admin-owned workspace, when any flag is asked, then the answer is true.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (PLAN_FEATURE_TOGGLES), app/Models/Package.php (featureCatalog), app/Services/PlanUsage.php (FEATURE_LABELS), app/Http/Middleware/EnforcePlanFeature.php, config/plan_gates.php, app/Support/UserNav.php, routes/*.php (`plan:` middleware), controllers listed above, database/seeders/PackageSeeder.php, Documentation/pages/security/plan-enforcement.html.
- **Port notes:** ship one `entitlements` registry (`@crm/contracts` enum) with each key's default, group, label and enforcement mode; a NestJS `@RequirePlanFeature('key')` guard plus a service method for in-context checks; ignore-by-default is dangerous, so make unknown keys throw at build time. Decide per flag whether to enforce (Reference leaves about 20 flags unenforced).

### TW-PLAN-008 — Signup default plan, trial length and billing-scope settings

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-PLAN-003
- **Summary:** Three platform settings decide what a brand-new workspace gets and how plans apply across an owner's workspaces: the default plan, the free-trial length in days and the plan scope (per workspace or per account).
- **Actors & access:** super-admin on the general settings screen (`admin.settings.general`, PATCH `admin.settings.general.update`, both owned by SET; this entry documents the plan-side fields only).
- **UX & screens:** `resources/views/admin/settings/general.blade.php`, card "Signups and free trial": select "Default plan for new signups" (options: "Auto - first active free plan" plus every ACTIVE plan-type package labelled "Free trial" or "Paid plan", value = the package slug); number "Free trial length (days)" 0 to 365 (help: only applies when the default plan is free; 0 = a free plan with no expiry, no countdown); select "Plan scope" (Per workspace - each workspace billed separately (default); Per account - an owner's plan unlocks all their workspaces).
- **Endpoints:** none owned (settings save is SET).
- **Data:** `system_settings` keys `registration_default_plan_id` (string slug, default empty; validated `exists:packages,plan_id`, max 64), `registration_trial_days` (int 0 to 365, default 14) and `billing_plan_scope` (workspace|account, default workspace).
- **Rules & edge cases:**
  1. Plan resolution at workspace creation (web step 2 and the mobile `WorkspaceProvisioner`, WSP): (1) the setting's package if it exists and is active; else (2) the first active package flagged `is_default` (no ordering, so an arbitrary one when several are flagged); else (3) the first active package that is free (`free` true, or amount 0 and not custom quote) by sort order; else (4) the literal slug `starter` even if no such package exists. The slug, not the id, is stored in `workspaces.plan`.
  2. The dropdown validation `exists:packages,plan_id` also accepts an add-on's slug, although only plans are listed; an inactive default silently falls through (rule 1).
  3. Trial: only when the resolved package is free (`isFreePlan`: `free` flag or zero price without custom quote) AND `registration_trial_days` is above 0: `trial_ends_at = now + days` and `billing_cycle = 'trial'`. A paid default plan never starts a trial; a free plan with 0 days has no expiry and no bar.
  4. The scope switch changes which package feeds every entitlement check: under `account` the owner's highest-priced non-free package across all workspaces they own is used (so a purchase on any workspace lifts all and a second trial is never blocked).
  5. Changing the trial length does NOT touch existing workspaces; a migration once backfilled trial windows for existing free workspaces (2026_05_29).
  6. The billing cycle label stays `trial` after the workspace buys a plan (checkout never rewrites it; informational only).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the three keys above; also `default_currency` for display.
- **Acceptance criteria:**
  - Given the default plan is the free Starter and trial days is 14, when a workspace is created, then `trial_ends_at` is 14 days ahead and `billing_cycle` is `trial`.
  - Given the default plan is a paid plan, when a workspace is created, then no trial is stamped.
  - Given the setting is empty and no plan is flagged default, when a workspace is created, then it takes the first active free plan by sort order.
  - Given `billing_plan_scope = account` and an owner with one paid workspace, when a sibling free workspace opens a paid feature, then it is allowed.
- **Source refs:** resources/views/admin/settings/general.blade.php, app/Http/Controllers/AdminPagesController.php (settingGeneral, settingGeneralUpdate), app/Http/Controllers/AuthController.php (storeWorkspace), app/Services/WorkspaceProvisioner.php, database/migrations/2026_05_29_150000_add_trial_ends_at_to_workspaces.php, Documentation/pages/getting-started/plans-trial.html.
- **Port notes:** keep the four-step fallback but store the default as a plan FK and refuse to deactivate the default plan; a per-org `entitlement_scope` setting drives the resolver; trial days configurable per plan is a cleaner model than a global.

### TW-PLAN-009 — Pricing FAQ admin CRUD

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** Admin maintains the question and answer accordion shown on the in-app plan picker, the homepage FAQ slider and the mobile app FAQ. One page with an add form and an editable row per FAQ.
- **Actors & access:** super-admin (admin group middleware). No permission key.
- **UX & screens:** `resources/views/admin/pricing-faqs/index.blade.php` (breadcrumb Admin > Billing settings > Pricing FAQs, title "Pricing FAQs", subtitle "lowest sort order shows first"). "New FAQ" card: question input (required), answer textarea (required, plain text, "markdown not supported"), sort order number (0 to 9999, placeholder "auto"), "Shows on" select (Pricing page, Homepage slider, Both), Active switch (on by default), "Add FAQ". Below, one form per existing FAQ with the same fields plus Save, a separate toggle form and a delete form (confirm "Delete FAQ", "Yes, delete"). Empty state "No FAQs yet. Add one above.". Rows ordered by `sort_order` then id. The Billing settings screen shows the FAQ count and links here.
- **Endpoints:**

| Method uri                          | Route name                 | Action                             | Middleware                                   | Request                                               | Response                           |
| ----------------------------------- | -------------------------- | ---------------------------------- | -------------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| GET admin/pricing-faqs              | admin.pricing-faqs.index   | Admin\PricingFaqController@index   | Authenticate, EnsureUserIsAdmin, IPAllowlist | none                                                  | HTML                               |
| POST admin/pricing-faqs             | admin.pricing-faqs.store   | Admin\PricingFaqController@store   | admin group                                  | question, answer, sort_order?, placement?, is_active? | back with "FAQ created."           |
| PATCH admin/pricing-faqs/{id}       | admin.pricing-faqs.update  | Admin\PricingFaqController@update  | admin group                                  | same                                                  | back with "FAQ updated."           |
| POST admin/pricing-faqs/{id}/toggle | admin.pricing-faqs.toggle  | Admin\PricingFaqController@toggle  | admin group                                  | none                                                  | back "Activated." / "Deactivated." |
| DELETE admin/pricing-faqs/{id}      | admin.pricing-faqs.destroy | Admin\PricingFaqController@destroy | admin group                                  | none                                                  | back "FAQ removed."                |

- **Data:** `pricing_faqs` (id, question varchar 255, answer text, sort_order smallint unsigned default 0, is_active bool default 1, placement varchar 16 default `pricing`, timestamps; index on `is_active, sort_order`). Validation: question required max 255, answer required max 5000, sort_order integer 0..9999 nullable, placement in pricing, home, both (null becomes pricing).
- **Rules & edge cases:**
  1. Active flag = the checkbox is present (`is_active` truthy); unchecking and saving deactivates; on update a missing checkbox therefore turns the FAQ OFF.
  2. New FAQ without a sort order gets the current maximum plus one (1 when the table is empty).
  3. Readers: in-app plan picker shows ALL active FAQs regardless of placement (`active` scope orders by sort then id); the homepage slider component takes placement `home` or `both`; the mobile app content API returns global active FAQs. QUIRK: the PUBLIC `/pricing` page does NOT read this table: its FAQ block is a page-scoped CMS component with its own editable defaults, so FAQs saved with placement "Pricing page" appear only on `/account/plans` (the doc says "pricing page").
  4. `CheckoutController@pricing` also loads FAQs but has no route (dead method).
  5. Seeded by `CheckoutDefaultsSeeder` with six answers (switch plans any time with proration, quota overflow uses wallet credits, 7-day refund, yearly 20 percent off, use any of 30 gateways, free Starter tier); the copy hard-codes numbers such as 7 days and 20 percent that the admin settings can change independently.
  6. Delete is a hard delete; no audit entry.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the admin adds an FAQ without sort order while max is 6, when saved, then it gets sort order 7 and is active.
  - Given an FAQ is toggled off, when a workspace opens `/account/plans`, then it is not listed.
  - Given an FAQ with placement `home`, when the homepage renders, then it appears in the slider.
  - Given an answer of 5001 characters, when submitted, then validation fails.
- **Source refs:** app/Http/Controllers/Admin/PricingFaqController.php, app/Models/PricingFaq.php, resources/views/admin/pricing-faqs/index.blade.php, resources/views/components/frontend/faq-slider.blade.php, app/Http/Controllers/PricingController.php, database/migrations/2026_05_21_010000_create_coupons_and_pricing_faqs.php, 2026_06_24_170000_add_placement_to_pricing_faqs.php, database/seeders/CheckoutDefaultsSeeder.php.
- **Port notes:** small CMS table; make placement a text-array or enum set; have the public pricing page read the same table so admins have one place; sanitise on render (plain text) and localise per locale later.

### TW-PLAN-010 — Public pricing page

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PLAN-003
- **Summary:** The unauthenticated marketing page at `/pricing`: an editable hero, a plan-card strip generated from live packages (with a Monthly and Yearly switch) and CMS-editable FAQ and closing call to action. Plan cards mirror `/account/plans` so visitors and customers see the same offer.
- **Actors & access:** anyone; response is `NoStoreResponse` (not cached). The hero and section order are edited inline by admins through the frontend content editor (CMS owns the editor and `fc()` helpers).
- **UX & screens:** `resources/views/frontend/pricing.blade.php` (layout `x-layouts.frontend`, page key `frontend-pricing`): hero kicker, headline ("Simple, honest, and flat.") and intro (default copy states "14-day free trial. No credit card." as static text unrelated to the trial-days setting), then sections `pricing-strip`, `faq` (scope pricing) and `cta-final` rendered in the admin-defined order and visibility. `resources/views/components/frontend/pricing-strip.blade.php`: optional header (skipped here), the Monthly/Yearly pill switch, a card per plan and an optional "Honest about pricing" footer (skipped here). Each card: plan number ("Plan . 01" by index), badge (free or popular), name, tagline, price and period, three lists (Volume, Features, Support) with check or dash rows, CTA button. If no packages exist and no plans prop is passed, three hard-coded prototype tiers (Starter, Pro, Scale with editable copy keys) are shown.
- **Endpoints:**

| Method uri  | Route name       | Action                     | Middleware                  | Request | Response |
| ----------- | ---------------- | -------------------------- | --------------------------- | ------- | -------- |
| GET pricing | frontend.pricing | FrontendController@pricing | NoStoreResponse (web group) | none    | HTML     |

- **Data:** `Package::publicPricingCards()` = ALL packages with `status = true` (plans AND add-ons; no type filter) ordered by `sort_order`, `id`, each mapped by `toPricingCard(index)`. Settings: `pricing.yearly_toggle_enabled`, `pricing.yearly_discount_pct` (default 20), `default_currency`.
- **Rules & edge cases:**
  1. Price: custom quote shows "Custom" with period "contact sales"; free or zero-price shows "Free" with period "forever" for lifetime else "/month"; otherwise the offer-aware `chargeableAmount()` converted from the package currency into the platform default currency (`FormatSettings::convert`) and formatted by the platform formatter. Period label from `plan_unit` and `plan_duration` ("/month", "/3 months", "/year"); lifetime shows "one-time".
  2. Yearly price on the card = the converted monthly-equivalent times (1 minus discount percent); lifetime plans never discount. QUIRK: unlike `/account/plans` and checkout it ignores `isNativelyYearly()`, so a plan authored in years gets the discount applied to an already-yearly price on this page while checkout charges the plan as authored.
  3. Volume list: up to four of device_limit, monthly_messages_limit, user_seat_limit, contacts_limit, broadcast_limit, worded "N label" or "Unlimited label" for 0 (null skipped). Features: enabled catalogue capabilities first (max 7) then up to 3 greyed-out not-included rows. Add-on cards list only what the add-on grants (non-zero `grants_json.limits`, -1 as "Unlimited", enabled capability columns up to 8). Support list: "Docs and community" always plus "Priority support" when the plan is highlighted or has `access_sla_policies`.
  4. Tagline = subtitle, else the plain-text `detail`. CTA label = `cta_label` or "Talk to sales" (custom), "Start free" (free), "Get started", each followed by an arrow. CTA href: custom quote goes to `cta_url` or `/contact`; free goes to `register`; paid goes to `user.checkout.show` (guests bounce through login first).
  5. The switch renders only when the admin toggle is on AND at least one card has a distinct yearly price; on load it selects Yearly and rewrites every CTA to append `?period=yearly`; clicking Monthly removes it. `highlighted` styles the popular plan.
  6. QUIRK: add-on packages appear in this strip as ordinary plan cards (the strip does not filter type).
  7. The hard-coded "14-day free trial" copy is not driven by `registration_trial_days`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `pricing.yearly_toggle_enabled` (default true), `pricing.yearly_discount_pct` (default 20), `default_currency`, CMS keys `pricing.hero.*`, `pricing-strip.*`.
- **Acceptance criteria:**
  - Given two active plans and one inactive, when a visitor opens `/pricing`, then two cards render in sort order.
  - Given a plan with `offer_price` lower than price, when rendered, then the card shows the offer as the price.
  - Given the yearly toggle is disabled in settings, when the page renders, then no switch appears and CTAs carry no period parameter.
  - Given no packages, when the page renders, then the three prototype tiers appear.
- **Source refs:** app/Http/Controllers/FrontendController.php (pricing), resources/views/frontend/pricing.blade.php, resources/views/components/frontend/pricing-strip.blade.php, app/Models/Package.php (publicPricingCards, toPricingCard, featureCatalog, periodLabel), resources/js/charts/pricing-index.js (in-app twin).
- **Port notes:** public Next.js route reading a cached `GET /public/plans` (no auth, RLS not applicable); filter to plan-type only; compute prices from one shared pricing function used by public page, plan picker and checkout so the three cannot disagree.

### TW-PLAN-011 — In-app plan picker (/account/plans)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PLAN-003, TW-PLAN-009
- **Summary:** The authenticated plans page: validity banner, Monthly/Yearly switch, plan cards with the current plan marked, upgrade-only buying, an add-ons section, a full comparison table and the FAQ. It is the destination of every "Buy Now", crown, locked nav row, paywall and trial redirect.
- **Actors & access:** any authenticated user (`Authenticate` only; no workspace-role gate, so agents can view it), platform admins included. It is reachable while the trial is expired (`account*` is on the trial gate's allow-list).
- **UX & screens:** `resources/views/pricing/index.blade.php` (layout `x-layouts.user`, nav key `more`, page key `pricing-index` with `pricing-index.js`; partial `pricing/_features.blade.php`). Sections:
  - Hero "Pricing that grows with you"; a Monthly/Yearly switch (with "save N%") shown only when `pricing.yearly_toggle_enabled` is on.
  - Flash success and error banners.
  - Validity banner (mutually exclusive, in this order): plan expired ("Your plan expired on <date>. Paid features are paused - renew below to restore them."); paid plan with an end date ("Your plan is active until <date> (<relative>)." or, with an active subscription, "Your plan auto-renews on <date>" plus a "Cancel auto-renew" form with a confirm); free trial ("Free trial ends on <date> (<relative>). Choose a plan to keep your workspace active.").
  - Empty state when no plans: "No plans configured yet - ask your admin to create one at /admin/packages/create".
  - Plan cards (grid 1 to 4 columns by count, items aligned to start): the highlighted plan is a dark card with a pulsing "MOST POPULAR" chip; each card has name, price with "/ month", subtitle, a state button and a feature checklist (from `Package::featureCatalog()`: numeric limits first ("Unlimited" for 0, "12.5k" style for at least 1000, null skipped), then enabled capabilities; first 7 visible, "Show all N features" pure-CSS expander with an internal scroll of 340px).
  - Button states: **Current plan** (green, inert); **Talk to sales** (custom quote, links to `/support`, label `cta_label`); **Continue free** (free plan, links to `/team-inbox`); **Downgrade unavailable** (a paid plan cheaper than the current plan, disabled with the tooltip "Downgrades are not available online. Contact support to move to a lower plan."); otherwise an enabled link to `user.checkout.show/<id>` (with `?period=yearly` when the switch is enabled) labelled "Upgrade to <name>" when pricier than the current plan, else the plan's `cta_label`, else "Choose <name>".
  - Add-ons section (when any active add-on exists): cards with price, period ("one-time" for lifetime), up to 6 grant bullets and a "Buy add-on" (or `cta_label`) button to checkout (ADD owns the content rules).
  - "Compare features" table (only when 2 or more plans): rows are every catalogue limit that at least one plan sets (value or "unlimited" or dash) followed by every capability at least one plan enables (check or dash), the highlighted plan's column tinted, collapsed behind "Show all N features" when there are more than 12 rows; header note "All plans include unlimited campaigns and templates" is static text.
  - FAQ accordion of all active `pricing_faqs` (first open).
- **Endpoints:**

| Method uri        | Route name    | Action                  | Middleware   | Request | Response |
| ----------------- | ------------- | ----------------------- | ------------ | ------- | -------- |
| GET account/plans | account.plans | PricingController@index | Authenticate | none    | HTML     |

- **Data:** active plan-type packages ordered `sort_order`, `plan_amount`; active add-ons; current package id from the scope-aware `billingPackage()` (slug or id tolerant); current plan amount; `plan_ends_at`, `planExpired()`, `trial_ends_at` (only when `onTrial()`); the workspace's latest ACTIVE or PAST_DUE `subscriptions` row; workspace currency (fallback default currency); the four pricing settings; active FAQs.
- **Rules & edge cases:**
  1. Upgrade/downgrade classification uses `plan_amount` (the stable tier ranking), not the offer price, and skips free and custom-quote plans; when the workspace has no current package every paid plan is buyable with the plain button label, and when its current plan is the free package (amount 0) every paid plan counts as an upgrade and reads "Upgrade to <name>". The block is UI-only here and repeated server-side by checkout (PAYGW, "Downgrades are not available online").
  2. Prices are shown in each PLAN'S own currency without conversion (deliberate: a 120000 IDR plan is charged in IDR); the public strip instead converts to the platform default currency (TW-PLAN-010).
  3. Displayed price: `chargeableAmount()`; yearly shown as the per-month equivalent of `amount x 12 x (1 - pct/100)`; for a plan authored in years the yearly figure is the amount itself, so in Monthly mode such a plan shows its whole-year price labelled "/ month" (QUIRK) and in Yearly mode amount divided by 12.
  4. The page initially renders in Yearly mode when the toggle is enabled (prices and links); `pricing-index.js` swaps prices from data attributes and re-points every checkout link when the switch flips, and returns immediately when the switch is absent.
  5. A plan flagged `free` links to team inbox rather than any action: "choosing" free does nothing (the workspace stays on its current plan).
  6. Custom quote plans never self-checkout.
  7. Because it runs under the global web middleware the page works for a trial-expired workspace, which is the recovery path.
- **Async & events:** none (the terminating `ReconcileSubscription` middleware runs after the response for signed-in users, PAYGW).
- **External systems:** none.
- **Settings:** `pricing.yearly_toggle_enabled`, `pricing.yearly_discount_pct`, `pricing.refund_enabled`, `pricing.refund_days` (loaded but only the checkout page shows the refund copy), `default_currency`.
- **Acceptance criteria:**
  - Given a workspace on Pro (49), when it opens the page, then Pro shows "Current plan", Starter-priced paid plans show "Downgrade unavailable" and a pricier plan shows "Upgrade to <name>".
  - Given the workspace plan expired yesterday, when it opens the page, then the red expired banner shows and the current-plan badge follows the FREE package (because `package()` downgrades on expiry).
  - Given an active subscription, when the page renders, then it shows the auto-renew message and a Cancel auto-renew button.
  - Given the yearly toggle is off, when the page renders, then no switch appears and links carry no period.
  - Given fewer than two plans, when rendered, then no comparison table shows.
- **Source refs:** app/Http/Controllers/PricingController.php (index), resources/views/pricing/index.blade.php, resources/views/pricing/_features.blade.php, resources/js/charts/pricing-index.js, app/Models/Package.php (featureCatalog, chargeableAmount, isNativelyYearly), Documentation/pages/getting-started/plans-trial.html.
- **Port notes:** `apps/web` route `/billing/plans`; server returns a `PlansViewModel` (plans, current plan, validity, subscription, add-ons, FAQ) so the client never re-derives upgrade/downgrade; move the downgrade rule into the API so checkout and the picker share it.

### TW-PLAN-012 — Cancel auto-renew

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-PLAN-011
- **Summary:** A workspace manager stops the automatic renewal of the workspace's subscription. The paid period keeps running until `plan_ends_at`, after which the plan lapses to free.
- **Actors & access:** workspace role manager or higher (hierarchy owner > admin > manager > agent > viewer; platform admins bypass). Agents and viewers are redirected to team inbox with a warning.
- **UX & screens:** "Cancel auto-renew" text button on the plans page validity banner and on the renewal reminder bar (TW-PLAN-013); both confirm with "Cancel auto-renew? Your plan stays active until it expires, then will not renew." Result flash: success "Auto-renew cancelled. Your plan stays active until it expires." or error "No workspace context." / "No active subscription to cancel.".
- **Endpoints:**

| Method uri                       | Route name                  | Action                               | Middleware                                | Request | Response                 |
| -------------------------------- | --------------------------- | ------------------------------------ | ----------------------------------------- | ------- | ------------------------ |
| POST account/subscription/cancel | account.subscription.cancel | PricingController@cancelSubscription | Authenticate, EnsureWorkspaceRole:manager | none    | redirect back with flash |

- **Data:** finds the workspace's latest `subscriptions` row with status `active` or `past_due`; loads the `payment_gateways` row by the subscription's `gateway` slug; calls the driver's `cancelSubscription(gateway_subscription_id, gateway_customer_id, gateway_plan_id)`; then `SubscriptionService::cancel` sets `status = canceled`, `canceled_at = now`.
- **Rules & edge cases:**
  1. Best effort at the gateway: a failed status result is only logged; an exception is caught and logged; the local row is ALWAYS marked canceled so it is no longer treated as renewing (the admin may need to reconcile in the gateway dashboard).
  2. `plan_ends_at` is untouched: the customer keeps the paid time.
  3. Only one subscription (the latest active) is cancelled; a `pending` row (first charge not confirmed) is not cancelled by this action.
  4. There is no reactivate action; the customer must buy the plan again (a new pending subscription is created only when checkout runs the recurring path).
  5. No email is sent and no audit entry is written.
  6. Subscriptions without a gateway subscription id (one-time purchases never create an active row) cannot be cancelled here.
- **Async & events:** log lines `[SUBSCRIPTION] gateway cancel failed`, `cancel threw`, `canceled`. A later gateway "canceled" webhook is idempotent.
- **External systems:** the payment gateway's cancel-subscription API (credentials and driver in PAYGW).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a manager and an active subscription, when they cancel, then the row is `canceled` with a timestamp and the flash confirms; `plan_ends_at` is unchanged.
  - Given the gateway call errors, when they cancel, then the local row is still canceled.
  - Given no active subscription, when posted, then the error "No active subscription to cancel." shows.
  - Given an agent, when posted, then redirected to team inbox with a role warning.
- **Source refs:** app/Http/Controllers/PricingController.php (cancelSubscription), app/Services/Payment/SubscriptionService.php (cancel), app/Models/Subscription.php, app/Http/Middleware/EnsureWorkspaceRole.php.
- **Port notes:** POST `/billing/subscription/cancel` guarded by a `billing.manage` permission; do the gateway call through the payment provider adapter and record the outcome on the subscription so a failed remote cancel is visible instead of silently local-only.

### TW-PLAN-013 — Free-trial bar and renewal reminder bar

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PLAN-016
- **Summary:** A slim dark, non-dismissible banner across the top of the customer app. While the workspace is on a free trial it counts down and pushes "Connect Channel" and "Buy Now"; when the trial is over it says so; in the last 7 days of a paid plan it warns of expiry (or of the automatic renewal) with the matching action.
- **Actors & access:** every signed-in workspace member except platform admins (Super Admin or Admin role, or legacy `users.role` admin, A, super-admin, platform-admin).
- **UX & screens:** `resources/views/components/trial-bar.blade.php`, mounted twice in `resources/views/components/layouts/user.blade.php` (topbar layout and sidebar layout). Two mutually exclusive bars:
  - **Trial bar** (visible when `onTrial()`, that is a free plan and `trial_ends_at` set): in-trial text "You have N day(s) to explore this Trial account. Connect your preferred channel to unlock all features." with buttons "Connect Channel" (to `/devices`) and "Buy Now" (plans page); after the end: "Your free trial has ended. Buy a plan to unlock all features." with "Buy Now". N = whole days rounded UP with a floor of 1, so the last day reads "1 day".
  - **Renewal bar** (visible when not on trial, `plan_ends_at` in the future and within 7 days): with an active or past_due subscription: "Your plan auto-renews in N day(s) on <date>." plus "Manage plan" and "Cancel auto-renew" (POST, confirm); without: "Your plan expires in N day(s) on <date>. Renew to keep your features." plus "Renew now".
- **Endpoints:** none owned (Cancel auto-renew posts to TW-PLAN-012).
- **Data:** reads `workspaces.trial_ends_at`, `plan_ends_at`, `subscriptions` (status active/past_due, latest), `orders` (last paid order's package), `packages`.
- **Rules & edge cases:**
  1. The bars are hidden for paid plans outside the 7-day window, for free plans with no expiry, and for admins.
  2. "Renew now" tries to resolve the plan to send the user straight to its checkout: `billingPackage()`, else `package()`, else the package of the workspace's latest paid order; it links to checkout only when that plan is buyable (not free, lifetime, custom quote). QUIRK: the code guards on a route named `checkout.show` which does not exist (the real name is `user.checkout.show`), so the branch never runs and "Renew now" always opens the plans page.
  3. Both bars read the (scope-aware) billing package, so under account-wide billing a paid sibling workspace removes the trial bar.
  4. There are no emails, in-app notifications or push messages for trial or plan expiry anywhere in the app; these bars are the only reminder. (The notification-preference event `payment_failed` exists in the workspace preferences catalogue but no code fires it.)
  5. Copy is static ("14 days" is not mentioned) and the bar has no close control by design.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none (trial length is set at signup, TW-PLAN-008).
- **Acceptance criteria:**
  - Given a trial ending in 36 hours, when a member opens any page, then the bar reads "2 days".
  - Given the trial ended, when they open the plans page, then the bar shows the ended text and one Buy Now button.
  - Given a paid plan expiring in 5 days with no subscription, when a member opens any page, then "Your plan expires in 5 days" shows with "Renew now".
  - Given a platform admin, when they open any page, then no bar shows.
- **Source refs:** resources/views/components/trial-bar.blade.php, resources/views/components/layouts/user.blade.php, app/Models/Workspace.php (onTrial, trialExpired), Documentation/pages/getting-started/plans-trial.html.
- **Port notes:** render from a single `/billing/status` payload (`state`, `daysLeft`, `renewalAt`, `autoRenew`, `renewUrl`); fix the renew link; consider adding the missing emails (Reference has none).

### TW-PLAN-014 — Plan and usage panel (account Plan tab, API v1 me/usage)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PLAN-006, TW-PLAN-007
- **Summary:** A single service, `PlanUsage::summary`, answers "what plan is this workspace on, how much has it used this month and which features are unlocked". It feeds the account Plan tab (and the same numbers back the public API `me` and `usage` endpoints), so UI and API can never disagree.
- **Actors & access:** signed-in members for the tab; API clients with a key for the API (API domain owns the routes `GET api/v1/me`, `GET api/v1/usage`).
- **UX & screens:** `resources/views/components/plan-usage.blade.php` mounted in `resources/views/user/account/index.blade.php` (pane `plan`, `?tab=plan`, with `:detailed="true"`). Hero card: "Current plan", plan name (or "Free"), an "active" chip, "Message quota resets <date> . N days left this cycle", a "Plan valid until <date> . N days" pill when `plan_ends_at` exists, buttons "Top up wallet" (`/account?tab=wallet`) and "Upgrade plan" (`/account/plans`); a big meter "Messages used . <Month Year>" (used / limit or "/ Unlimited", bar turns coral at 90 percent or more, unlimited shows a short muted bar) with helper text ("N messages remaining", plus "extra sends bill from wallet credits" at zero, or "Your plan has no monthly message cap."). Four tiles: Wallet balance (money), Features unlocked (N of 31, links to plans), Sent this month, Days left in cycle. Detailed section "Usage and limits - This billing cycle": five meters (Messages this month, Contacts, Connected numbers, Team seats, Flows) with used, limit and percent bar; "What <plan> includes": the 31 curated flags in unlocked and locked lists and a footer "N more features unlock on a higher plan" with "Compare plans". Empty state "No active plan yet" with "View plans" when no workspace resolves.
- **Endpoints:** none owned here (tab is part of `GET account`, API routes belong to API/MOB).
- **Data:** reads `messages` (outbound, current engine, this calendar month) plus `inbox_messages` (outbound, current engine, conversations of the workspace, this month), counts of `contacts`, `devices`, users whose `current_workspace_id` is the workspace and `flows`, the owner's wallet, `plan_ends_at`.
- **Rules & edge cases:**
  1. Limits come through `effectiveLimit` (overrides and add-ons respected); a limit of 0 or below is shown as unlimited; percent is capped at 100.
  2. The "cycle" is the CALENDAR month, not the plan anniversary: the allowance resets on the first of the month regardless of purchase date; `valid_until` is the separate subscription expiry (a yearly plan shows a date a year out while quota still resets monthly).
  3. Meter counts differ from enforcement counts: connected numbers counts `Device` rows only (enforcement adds WABA provider configs), seats counts users currently switched into the workspace (enforcement counts `workspace_user` rows).
  4. `billing_mode` is `wallet` in pay-per-message or reseller mode (WALLET) else `plan`; wallet money = credits times the minor-units-per-credit rate; `amount_per_message` = credits per message times that rate.
  5. Only the messages meter is time-boxed to the month; other meters are lifetime totals.
  6. The label list of 31 flags is fixed and curated (broadcast, campaign, autoflow, schedulemessage, autoreply, keyword replies, template, carousel, drip, CTWA, analytics, kanban, routing, business hours, SLA, appointments, AI agents, AI chat, AI voice, AI training, calling, call recording, storefront, commerce flows, chatbot widgets, webhooks, translation and the Shopify, WooCommerce, HubSpot, Google Calendar integrations).
  7. The API `me` maps the five meter keys to limits (0 becomes null = unlimited) and `features` to the unlocked flags only.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `credits_per_message`, currency settings.
- **Acceptance criteria:**
  - Given a plan with 1,000 messages and 400 sent this month, when the tab renders, then it shows 400 / 1,000 and 600 remaining.
  - Given a limit of 0, when rendered, then "Unlimited" shows with no percent.
  - Given a yearly plan valid until next year, when rendered, then "Plan valid until" shows the far date while the cycle line shows the next month start.
  - Given the API `usage` call, when made, then its numbers equal the tab's.
- **Source refs:** app/Services/PlanUsage.php (summary, FEATURE_LABELS, LIMIT_METERS), resources/views/components/plan-usage.blade.php, resources/views/user/account/index.blade.php, app/Http/Controllers/Api/V1/AccountController.php.
- **Port notes:** expose `GET /billing/usage` and reuse it for the public API; compute message usage from the outbox or a monthly rollup rather than counting message tables on every request; align the meter counts with the enforcement counts.

### TW-PLAN-015 — Trial-expiry hard gate

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PLAN-016
- **Summary:** When a workspace's free trial has run out, every feature route bounces to the plan picker until a plan is bought, while billing, account, support and public pages stay reachable. It fails open on any error.
- **Actors & access:** every authenticated web request except platform admins. Registered as a GLOBAL web-group middleware (`EnsureTrialActive`, alias `trial` exists but unused).
- **UX & screens:** browser page: redirect to `account.plans` with the warning "Your free trial has ended. Choose a plan to keep using your workspace."; AJAX/JSON: HTTP 402 with `message`, `upgrade_url` (the plans URL) and `trial: "expired"`. The navigation still shows every feature so users see what they would unlock.
- **Endpoints:** none (middleware).
- **Data:** reads `workspaces.trial_ends_at` and the resolved billing package via `trialExpired()`.
- **Rules & edge cases:**
  1. Skips entirely when the app is not installed (no `storage/installed` marker), when nobody is signed in, and for platform admins (Super Admin or Admin role, or `users.role` in admin, A, super-admin, platform-admin; this list is wider than `PlanLimitGuard`'s admin list, which lacks the last two).
  2. Allowed route-name globs (trial-expired users can still open): `account*`, `*checkout*`, `*payment*`, `*invoice*`, `*support*`, `register*`, `verification*`, `*workspaces*`, `logout`, `frontend.*`, `home`.
  3. Blocks only when `trialExpired()`: on a free plan (billing package free or none) with `trial_ends_at` set and in the past. Paid plans (even lapsed ones, which drop to the free package but have `trial_ends_at` cleared) and free plans without a trial are never blocked by this gate.
  4. Fails OPEN: any exception lets the request through.
  5. QUIRK: it is attached to the web group only, so the public REST API (`api/v1`, API key), the mobile API (`api/app`) and the Node-bridge endpoints are NOT covered; a trial-expired workspace can keep sending through them.
  6. QUIRK: matching uses route names, so an unnamed route is never on the allow-list; for example the unnamed `POST payment/callback/{gateway}` is blocked for a session-carrying user with an expired trial (a cross-site gateway POST drops the session so usually pass).
  7. Workspace switching stays allowed so the user can move to another workspace.
  8. Under `billing_plan_scope = account`, `trialExpired()` follows the owner's best plan so one paid workspace lifts all.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `billing_plan_scope`; trial length at signup.
- **Acceptance criteria:**
  - Given a workspace on the free plan with `trial_ends_at` yesterday, when a member opens `/team-inbox`, then they are redirected to `/account/plans` with the warning.
  - Given the same workspace, when they open `/account/plans`, `/checkout/5` or `/support`, then the pages load.
  - Given a JSON request to a feature endpoint, when the trial is over, then 402 with `upgrade_url`.
  - Given a platform admin in that workspace, when they open any page, then no block.
  - Given a database error while resolving the workspace, when a request arrives, then it passes through.
- **Source refs:** app/Http/Middleware/EnsureTrialActive.php, bootstrap/app.php (web middleware list), app/Models/Workspace.php (trialExpired), Documentation/pages/getting-started/plans-trial.html, Documentation/pages/security/plan-enforcement.html.
- **Port notes:** implement as a NestJS guard on the authenticated API plus a Next.js middleware redirect; apply it to the API and mobile channels too unless product wants the Reference leak; keep the allow-list as route metadata (`@AllowWhenTrialExpired()`) instead of name globs; keep fail-open only for internal errors, not for missing data.

### TW-PLAN-016 — Plan and trial lifecycle states and transitions

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PLAN-008, TW-WSP-010
- **Summary:** A testable state model for what a workspace can do at any moment. The states are derived at read time from `plan`, `trial_ends_at` and `plan_ends_at`; nothing flips them on a schedule. This entry is the contract across the domain files (WSP owns the resolver, PAYGW owns the writers).
- **Actors & access:** derived state; writers are signup (WSP), checkout and webhooks (PAYGW), admin workspace edit (WSP-026).
- **UX & screens:** trial bar, renewal bar, plans page banner, locked features and crowns reflect the state.
- **Endpoints:** none.
- **Data:** `workspaces.plan` (slug or numeric package id), `trial_ends_at`, `plan_ends_at` (NULL = never expires: free, lifetime, custom quote, legacy), `billing_cycle` (informational: `monthly`, `trial`, admin-set `quarterly|annual|custom`), `data_wiped_at`; `subscriptions.status` (`pending`, `active`, `past_due`, `canceled`, `expired`).
- **Rules & edge cases:** states and their behaviour (entitlements come from the resolved package; "free package" = first package with `free = true` by sort order, else slug `starter`):

| State               | Condition                                        | Entitlements                                                                    | Gate effect                                                                                                                |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| No plan             | `plan` empty or unresolvable                     | none resolved: every flag falls back to true and every cap to unlimited (QUIRK) | free-plan predicates true, no trial                                                                                        |
| Free, in trial      | free package and `trial_ends_at` in the future   | the free package's flags and limits                                             | trial bar counts down; features usable within limits                                                                       |
| Free, trial expired | free package and `trial_ends_at` in the past     | free package                                                                    | hard gate on all feature web routes (TW-PLAN-015); message allowance stops (`planIsActive()` false, sends bill the wallet) |
| Free, no expiry     | free package and `trial_ends_at` NULL            | free package                                                                    | never blocked                                                                                                              |
| Paid, active        | paid package and (`plan_ends_at` NULL or future) | the paid package plus add-ons and overrides                                     | none; renewal bar in the last 7 days                                                                                       |
| Paid, lapsed        | `plan_ends_at` in the past                       | the FREE package (paid flags lock, caps shrink); `planIsActive()` false         | no hard gate (trial cleared), but paid-only features are locked and paywalls show; wallet pays for sends                   |
| Wiped               | `data_wiped_at` set                              | `plan` NULL, `plan_ends_at` still past so the free package applies              | data deleted (TW-PLAN-023)                                                                                                 |

Transitions and who performs them:

1. Signup to Free-in-trial or Paid: TW-PLAN-008 (default plan resolution; only a free default starts the trial).
2. Free/lapsed to Paid, active: an order is finalised paid (PAYGW): `plan` set to the package's numeric id, `trial_ends_at` NULL, `plan_ends_at` = base plus the package duration where base is the later of now and the current end date (early renewal keeps unused days); free, lifetime and custom-quote packages get NULL. A yearly billing choice on a 1-month plan adds a year; multi-unit packages use their own duration.
3. Renewal: a gateway webhook (or the cron-free reconciler, PAYGW-029/030) extends `plan_ends_at` by one cycle or to the gateway's period end, never backwards; the terminating `ReconcileSubscription` middleware polls only subscriptions that are pending, past_due or within 3 days of the end, at most every 6 hours per subscription, and only the Razorpay driver implements the poll.
4. Payment failure sets the subscription to past_due but leaves `plan_ends_at` alone; a cancel keeps the paid period.
5. Admin grant: editing a workspace's plan resets `trial_ends_at` to NULL and stamps `plan_ends_at` (explicit date, else package duration) only when the plan actually changes; supplying only a date corrects the end date (WSP-026).
6. Lapse: purely time-based, when `plan_ends_at` passes; there is no job, no notification and no email at the moment of lapse.
7. Wipe: TW-PLAN-023.
8. Downgrades are not available online (checkout refuses a cheaper plan than the current one); a downgrade only happens by lapse or by an admin.
9. Under `billing_plan_scope = account` the resolved package is the owner's highest-priced paid package across all their workspaces.
10. `billing_cycle` is set to `trial` at signup and never updated by checkout (QUIRK, cosmetic).

- **Async & events:** none scheduled for state changes; `ReconcileSubscription` (web traffic driven) and the daily wipe are the only background touches.
- **External systems:** payment gateways (PAYGW).
- **Settings:** `registration_default_plan_id`, `registration_trial_days`, `billing_plan_scope`, `pricing.recurring_enabled`.
- **Acceptance criteria:**
  - Given a free-plan workspace with `trial_ends_at` in 3 days, when a paid order is finalised, then `plan` is the paid package, `trial_ends_at` is NULL and `plan_ends_at` is one cycle ahead.
  - Given a paid workspace with `plan_ends_at` one day in the past and no renewal, when it opens a paid-only feature, then it is treated as on the free package (feature locked, paywall) and its sends are billed to the wallet.
  - Given a paid workspace renewing 10 days before the end, when the renewal lands, then the new end is the old end plus one cycle.
  - Given a lifetime package purchase, when finalised, then `plan_ends_at` is NULL.
  - Given `billing_plan_scope = account`, when the owner buys a plan on workspace A, then workspace B (free, trial expired) is unblocked.
- **Source refs:** app/Models/Workspace.php (package, billingPackage, onFreePlan, onTrial, trialExpired, planExpired, planIsActive, freePackage), app/Http/Controllers/CheckoutController.php (finalizeOrder), app/Services/Payment/SubscriptionService.php, app/Services/Payment/SubscriptionReconciler.php, app/Http/Middleware/ReconcileSubscription.php, app/Http/Controllers/Admin/WorkspacesController.php (update), tests/Feature/SubscriptionReconcilerTest.php.
- **Port notes:** implement `EntitlementsService.stateOf(org)` returning an enum plus reasons and cover the table with contract tests; put the timestamps on a `subscriptions`/`org_plans` table (period start, end, status) instead of overloading three workspace columns; emit `plan.trial_expired` and `plan.lapsed` events through the outbox so notifications and emails (missing in Reference) can be added.

### TW-PLAN-017 — Count limit guard and feature guard (PlanLimitGuard, error contract)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-WSP-010
- **Summary:** The single entry point controllers call to enforce a plan: `check` (a numeric cap against a live row count), `checkQuota` (a cap against the delete-proof ledger, TW-PLAN-018), `feature` (throws when a flag is off) and `hasFeature` (boolean). Every violation surfaces as one structured error.
- **Actors & access:** any workspace member performing a limited action; platform admins bypass.
- **UX & screens:** on web forms the user is sent back with a red flash carrying the message; on JSON or `api/*` requests the response is 422 with a body the client can render as an upgrade prompt.
- **Endpoints:** none owned; call sites are listed in TW-PLAN-006 and TW-PLAN-007. Error response contract: HTTP 422 JSON `{ ok: false, error: "plan_limit_reached", reason: "limit_reached" | "quota_reached" | "feature_disabled", key, used, limit, message }` when the request expects JSON or the path starts with `api/`; otherwise redirect back with `error` flash equal to the message.
- **Data:** none written; reads effective entitlements (`Workspace::effectiveLimit`) and the counts passed in by callers.
- **Rules & edge cases:**
  1. `check(workspace, key, used)`: no workspace or bypass user -> allowed; limit null, 0 or negative -> allowed (unlimited); `used < limit` -> allowed; else throw with `reason = limit_reached`. Callers pass the CURRENT count (before insert), so the block happens when creating row N+1.
  2. `feature(workspace, key)`: allowed when the effective value is truthy (fallback true when the key is undefined); else throws `reason = feature_disabled` with the message "This feature isn't available on your current plan. Upgrade to unlock it.".
  3. `hasFeature` returns false only when there is no workspace; bypass users get true.
  4. Bypass = the ACTING user has Spatie role Super Admin or Admin, or legacy `users.role` admin or A. Separately `effectiveLimit` itself returns true and -1 for workspaces OWNED by a platform admin. `EnsureTrialActive` uses a wider admin list (adds super-admin and platform-admin).
  5. Message texts: limit reached: "You've reached your plan's limit of N <label>. Upgrade your plan to add more, or delete an existing one to free up space."; quota reached: "You've reached your plan's limit of N <label>. Upgrade your plan to create more." (never suggests deleting because deleting does not free ledger allowance); when the limit number is unknown the sentence omits it. `<label>` = the key without a trailing `_limit`, underscores turned to spaces, lower-cased and pluralised (`device_limit` becomes "devices", `total_campaigns_limit` becomes "total campaigns").
  6. Race: callers count then insert without a lock, so parallel creates can overshoot a cap by the concurrency level.
  7. Background runners (SMS campaigns and broadcasts, email campaigns) catch the exception, set the campaign to `failed` and log a warning instead of surfacing it.
  8. Two different error shapes exist for a disabled feature: this guard answers 422 `plan_limit_reached` with reason feature_disabled; the `plan:` route middleware answers 403 `plan_feature_disabled` (TW-PLAN-019). A port should unify them.
- **Async & events:** none (log lines only in runners).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `flow_limit = 3` and 3 flows, when the user creates a 4th, then 422 or a back-redirect with "You've reached your plan's limit of 3 flows...".
  - Given `flow_limit = 0`, when the user creates flows, then no error.
  - Given a platform admin session, when any cap is exceeded, then no error.
  - Given the plan lacks `access_keyword_replies`, when the user saves a keyword reply, then 422 JSON `reason: "feature_disabled"`.
  - Given an SMS campaign over `sms_monthly_limit`, when the runner starts, then the campaign becomes `failed`.
- **Source refs:** app/Services/PlanLimitGuard.php, app/Exceptions/PlanLimitReachedException.php, controllers and services listed in TW-PLAN-006/007.
- **Port notes:** NestJS `EntitlementsService.assertWithinLimit(orgId, key, delta)` executed inside the creating transaction (advisory lock or counter row) and an exception filter mapping to problem+json with a stable code `plan.limit_reached` / `plan.feature_disabled`; keep the admin bypass as a platform-role check, not an implicit workspace flag.

### TW-PLAN-018 — Delete-proof quota ledger (plan_usage)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PLAN-017
- **Summary:** For caps where "create 5, delete 5, create 5 again" must not beat the limit, Reference counts creations in an increment-only ledger keyed by billing period instead of counting live rows. Buying or renewing a plan starts a fresh allowance automatically. Today only Campaigns use it.
- **Actors & access:** workspace members creating campaigns; the guard throws for non-admins.
- **UX & screens:** the campaign create fails with the quota message ("You've reached your plan's limit of N total campaigns. Upgrade your plan to create more."); no other UI.
- **Endpoints:** none owned; enforcement in `WaCampaignsController` create (`checkQuota(total_campaigns_limit, metric campaign)`) and the mobile campaign create.
- **Data:** table `plan_usage` (id, workspace_id, metric varchar 64, period varchar 64, count unsigned int default 0, timestamps; UNIQUE `(workspace_id, metric, period)`; index on workspace_id). Only metric `campaign` exists, bumped by the `TracksPlanQuota` model trait on the `created` event of `WpCampaign` (constant `PLAN_QUOTA_METRIC = 'campaign'`).
- **Rules & edge cases:**
  1. Period key = `<billing package id or 0>|<plan_ends_at as Ymd or 0>`. It changes when the plan (package) changes OR the end date moves (renewal, admin edit, lapse to the free package), so a new plan cycle re-opens the allowance with no reset job. Free or lifetime plans (no end date) use one stable period.
  2. `checkQuota(workspace, key, metric, seedFromLive)`: limit null or 0 or negative -> allowed; on the first ever meter for that workspace and metric, adopt the current live count as the starting value (so an existing install starts at its true usage); read the current-period counter; `used < limit` -> allowed else throw `reason = quota_reached`.
  3. `bump(workspaceId, metric, qty)`: atomic update-then-insert; on a lost insert race it retries as a plain increment; a zero quantity or missing workspace is ignored.
  4. `seedIfFirstEver` does nothing if ANY row exists for that workspace and metric (so later periods legitimately start at 0 even though old rows remain).
  5. The trait has no `deleted` hook by design: deleting a campaign never frees allowance; only upgrading (new period) does.
  6. Fail-open: if the `plan_usage` table does not exist the ledger reads 0 and skips writes, so a missing migration never 500s a create.
  7. QUIRKs: a lapse to the free package or an admin edit of `plan_ends_at` changes the period and silently resets the counter; downgrading and re-upgrading to the same package with the same end date returns to the OLD counter; the adoption count is passed by the caller as ALL live campaigns (including finished ones).
  8. Counting happens for every code path that creates a `WpCampaign` (web, API, import, seeders) because the hook is on the model, but the CHECK exists only in the two controllers above; other creators are counted without being checked.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `total_campaigns_limit` per plan or override.
- **Acceptance criteria:**
  - Given `total_campaigns_limit = 2`, when the workspace creates 2 campaigns, deletes both and creates a third, then the third is blocked with the quota message.
  - Given the workspace buys a different plan, when it creates a campaign, then the counter for the new period starts at 0.
  - Given a workspace with 5 existing campaigns and no ledger rows, when it first hits the check with a limit of 5, then the ledger is seeded with 5 and the create is blocked.
  - Given the table is missing, when a campaign is created, then the create succeeds.
- **Source refs:** app/Services/PlanUsage.php (period, usage, bump, seedIfFirstEver), app/Services/PlanLimitGuard.php (checkQuota), app/Models/Concerns/TracksPlanQuota.php, app/Models/WpCampaign.php, app/Http/Controllers/WaCampaignsController.php, database/migrations/2026_07_25_100000_create_plan_usage_table.php.
- **Port notes:** a `plan_usage(org_id, metric, period_start, count)` table with RLS and a unique key, incremented in the same transaction as the create (outbox not needed); key the period on subscription period id rather than package id plus end date so admin edits do not reset it; generalise the metric list to any cap that should be non-refundable.

### TW-PLAN-019 — Route-level feature gate (plan middleware)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PLAN-017
- **Summary:** Whole feature areas are protected declaratively with the route middleware alias `plan:<key>[,<key>...]` (class `EnforcePlanFeature`). Reads still load, with a paywall sheet over them; every mutation is blocked hard before the controller runs.
- **Actors & access:** authenticated workspace members on routes carrying the middleware; platform admins pass through the guard.
- **UX & screens:** blocked mutation via a form: back with a warning flash "Your plan doesn't include <label>. Upgrade to unlock this feature."; via AJAX/JSON: HTTP 403 `{ ok: false, error: "plan_feature_disabled", feature, message }` with the same message. A safe request (GET/HEAD/OPTIONS) is allowed to render: the middleware shares `planPaywall = { feature, label }` with the views so `x-plan-paywall` slides up over the page (TW-PLAN-020).
- **Endpoints:** the routes carrying `plan:` are counted per key in TW-PLAN-007 (about 320 route entries across Sales CRM, channels, calling, AI, storefront, analytics, Slack, Trello, invoices).
- **Data:** none.
- **Rules & edge cases:**
  1. Multiple keys (`plan:a,b`) require ALL; the first missing key decides the response and the shared label.
  2. No signed-in user -> passes (auth middleware handles it). No current workspace -> `hasFeature` false -> mutations are blocked.
  3. Mutation = any non-safe method. The check runs before the controller, so the action can never run server-side even if the UI is bypassed.
  4. QUIRK: for safe methods the request is NOT redirected and JSON GET endpoints on gated routes still return their data; only HTML pages get a paywall overlay. The class comment and the docs describe a redirect to /pricing; the code does not redirect.
  5. Label map for 11 keys (WhatsApp calling, call recording, AI voice agent, AI chat assistant, AI agents, AI training, WhatsApp storefront, Sales pipeline, SLA policies, translation, Instagram automation); any other key is turned into words by stripping `access_` and replacing underscores.
  6. Unknown or column-less keys resolve to the fallback true, so a route gated by such a key is open (`access_wa_forms`, `access_wa_links`).
  7. Under account-wide billing the check reads the owner's best plan.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a workspace without `access_sales_pipeline`, when it POSTs to `deals`, then 403 JSON (AJAX) or a back redirect with the warning and no deal is created.
  - Given the same workspace opens `GET deals`, then the page renders with the paywall sheet and no redirect.
  - Given a route gated by two keys and the plan has only one, when accessed by POST, then blocked with the label of the missing key.
  - Given a platform admin, when accessing any gated route, then allowed.
- **Source refs:** app/Http/Middleware/EnforcePlanFeature.php, bootstrap/app.php (alias `plan`), routes/*.php (`plan:` middleware), Documentation/pages/security/plan-enforcement.html.
- **Port notes:** Nest `@RequirePlanFeature(...keys)` decorator with a guard; return problem+json 403 `plan.feature_disabled` for every method including GET on data endpoints (fixing the read leak) while the Next.js page decides between paywall overlay and content; make unknown keys a compile-time error.

### TW-PLAN-020 — Path-based paywall sheet (plan_gates)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PLAN-019
- **Summary:** A slide-up bottom sheet appears over any feature page whose plan flag is off, listing the actual plans that unlock it so the user can upgrade on the spot. Which feature a page needs comes from the route middleware or from a config map of URL globs.
- **Actors & access:** signed-in workspace members (never platform admins, never on unmapped pages).
- **UX & screens:** `resources/views/components/plan-paywall.blade.php`, mounted once at the bottom of the user layout (`layouts/user.blade.php`). Overlay (dark scrim, sheet up to 920px wide, max 94vh, scrollable): lock icon, "Premium feature", "<Feature label> is not on your plan", "Pick a plan below that includes it - upgrade and unlock this feature instantly.", a flex row of plan cards (price and "/ mo", subtitle cut at 70 characters, "Popular" chip for highlighted, a button "Choose <plan>" or "Continue free" or "Talk to sales"), then "Go back" (to `/dashboard`) and "Compare all plans" links. No inline JS; the slide-up is a CSS animation in the theme stylesheet.
- **Endpoints:** none.
- **Data:** `config/plan_gates.php` (44 path-glob to feature-key entries: meta-ads, wa-campaigns, broadcasts, scheduled, templates, auto-reply, flows, ai-assistants, ai-training, wa-calling, call-logs, store, catalog, deals, chatbot-widgets, appointments, webhooks, analytics, shopify, woocommerce, hubspot, google-account, each with a `/*` twin); active packages whose column for that feature equals 1, ordered by `sort_order` then `plan_amount`.
- **Rules & edge cases:**
  1. Feature source priority: the shared `planPaywall` variable set by `EnforcePlanFeature`; else the first glob in the config matching the request path (`request()->is`).
  2. Shown only when a user, a workspace and a feature exist, the user is not a platform admin (role check), and `hasFeature` is false.
  3. Plan cards are queried only when the packages table actually has a column named after the feature; unmapped keys (for example a column-less flag) show the sheet with no cards.
  4. QUIRK: the card query has no type filter, so add-on packages (which mirror their granted flags onto columns) can appear as "plans that unlock it"; the price uses the package currency symbol with no conversion and `chargeableAmount()` rounded to whole units, and always says "/ mo" whatever the period.
  5. The map is display-only: it never blocks a POST (only the `plan:` middleware or in-context guards do). Paths without a config entry get no paywall even when the plan lacks the capability (only crowns).
  6. Capability features with no page of their own (Kanban view, reactions, notes, carousel, BYOK keys, roles, business hours, drip, AI suggestions, residency, commerce flows, generate-with-AI, call recording, AI voice or chat) are gated in context instead.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a plan without `campaign`, when the user opens `/wa-campaigns`, then the sheet shows "Campaigns is not on your plan" (label derived) with the plans that have `campaign = 1`.
  - Given a plan that includes the feature, when the page opens, then no sheet.
  - Given a platform admin, when the page opens, then no sheet.
  - Given the sheet's "Go back", when clicked, then the user lands on the dashboard.
- **Source refs:** resources/views/components/plan-paywall.blade.php, config/plan_gates.php, resources/views/components/layouts/user.blade.php, app/Http/Middleware/EnforcePlanFeature.php, Documentation/pages/getting-started/plans-trial.html.
- **Port notes:** a `<PlanPaywall feature>` client component fed by a `GET /billing/plans?unlocks=<key>` query; drive path-to-feature mapping from route metadata instead of a separate config; filter to plan-type packages.

### TW-PLAN-021 — Premium crown and locked navigation

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-PLAN-017
- **Summary:** A small gold crown next to a feature's label (and dimmed "locked" rows in the sidebar layout) tells users which features their plan does not include; clicking goes to the plan picker. Nothing shows for platform admins or for unlocked features.
- **Actors & access:** signed-in workspace members.
- **UX & screens:** `resources/views/components/plan-crown.blade.php`: props `feature` (a key or an array), `any` (for arrays: any vs all, default all), `size` (sm, md, lg), `label` (tooltip override; default "Premium feature - upgrade your plan to unlock"), `link` (false renders a span when already inside an anchor). Renders a glowing gold crown SVG with a slow shine animation and hover lift; link target `/account/plans`. Used next to nav items in the topbar header (any nav item with a `feature` key), on More-page cards (Analytics, Broadcasts, Auto Reply, Warmer, Scheduled, Google account, Appointments, AI call assistant, Call logs, Chatbot widget, AI training, AI usage, Flow analytics, Lead finder, Webhooks) and on Team Inbox settings rows (routing rules, SLA policies, Kanban, AI auto-reply, AI voice calling, AI assistant wizard, business hours, webhooks, team analytics). In the sidebar layout, `UserNav` marks a `feature`-tagged item `locked`: the row is muted (no active state) and points to `/account/plans` instead of its own route.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Uses the same `PlanLimitGuard::hasFeature` predicate as the servers, so UI and enforcement agree; admin detection follows Super Admin or Admin role or legacy admin role columns.
  2. Locked rows are muted, not hidden ("hiding a page reads as the page disappeared").
  3. Only nav items carrying a `feature` key participate: Templates, Flow builder and flow analytics, AI agents, AI training, chatbot widgets, appointments, Meta ads (CTWA), CRM dashboard and deals, Lead finder, the channel entries (Facebook, Telegram, LINE, Viber, WeChat, Email), Catalog and Webhooks.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a plan without `access_ai_training`, when the nav renders, then the AI Training entry shows a crown that links to `/account/plans`.
  - Given a plan with the flag, when it renders, then no crown.
  - Given the sidebar layout, when an item is locked, then the row is dimmed and its click opens the plans page.
  - Given a platform admin, when the nav renders, then no crowns.
- **Source refs:** resources/views/components/plan-crown.blade.php, app/Support/UserNav.php, resources/views/components/user/header.blade.php, resources/views/components/user/sidebar-rail.blade.php, resources/views/user/more/index.blade.php, resources/views/user/team-inbox/index.blade.php.
- **Port notes:** send `locked` and `requiredFeature` on the nav payload from the API; a `<PlanBadge>` component; keep it a pure function of entitlements.

### TW-PLAN-022 — Per-plan customer API rate limit

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-PLAN-003
- **Summary:** Requests to the customer REST API (`/api/v1`) are throttled per minute by a limit read from the caller's plan, with a global default when the plan has none.
- **Actors & access:** API clients authenticated by workspace API key (`AuthenticateApiKey`, then middleware alias `auth.apikey.throttle` = `ApiPlanRateLimit`); the API domain owns the routes.
- **UX & screens:** none; the plan form has the field "API rate limit / min (0 = default)" (TW-PLAN-006).
- **Endpoints:** none owned (57 of the 60 `api/v1/*` routes carry it; the three `sheets-addon` routes do not).
- **Data:** reads `packages.api_rate_limit_per_minute` through `effectiveLimit` (add-ons stack, overrides win), `system_settings.security.api_rate_limit_per_minute` (default 600), cache/rate-limiter store.
- **Rules & edge cases:**
  1. Resolution: plan value below 0 (platform-admin -1 or add-on -1) means unlimited (no throttle); plan value above 0 is the limit; plan value 0 or blank falls back to the global setting; a global value of 0 (or negative coerced to 0) means unlimited.
  2. The bucket is per API KEY (`apiv1:<key id>`), not per workspace: several keys on one workspace each get the full limit.
  3. Window: the limiter counts hits for 60 seconds from the first hit (a fixed window; the code comment says sliding).
  4. Over the limit: HTTP 429 JSON `{ error: { code: "rate_limited", message: "Rate limit of N requests/minute for your plan exceeded. Retry in Ns." } }` with headers `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining: 0`. Under the limit: responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining`.
  5. If the API-key middleware did not resolve a key, the request passes untouched (it was already rejected).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** package field, `security.api_rate_limit_per_minute` (admin security screen, SET/API).
- **Acceptance criteria:**
  - Given a plan with limit 60 and a key that makes 61 calls in a minute, when the 61st arrives, then 429 with Retry-After.
  - Given a plan limit of 0 and a global default of 600, when a key makes 601 calls, then the 601st is throttled.
  - Given a platform-admin-owned workspace, when it calls, then no throttling.
  - Given two keys on one workspace, when each makes 60 calls, then neither is throttled.
- **Source refs:** app/Http/Middleware/ApiPlanRateLimit.php, bootstrap/app.php (alias `auth.apikey.throttle`), database/migrations/2026_06_24_140000_add_api_rate_limit_to_packages.php.
- **Port notes:** Nest throttler guard keyed by API key id with a Redis sliding window and plan-derived limit; also return standard `RateLimit-*` headers; decide key vs org scope explicitly.

### TW-PLAN-023 — Data-retention auto-wipe of lapsed workspaces

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-PLAN-016
- **Summary:** A package may carry `data_retention_days`. When a workspace's paid plan has been expired for longer than that, a daily job deletes its data and detaches the plan. It is opt-in per plan (0 means never) and destructive.
- **Actors & access:** machine. Runs at most once per 24 hours, triggered by the Node bridge heartbeat (`POST api/node-heartbeat` handled by `WaConnectController@nodeHeartbeat`, WADEV/NODE domain), which calls the artisan command with `--force`. An operator can also run `php artisan workspaces:wipe-expired` (dry run unless `--force`).
- **UX & screens:** admin sets the value on the package form ("Data retention (days after expiry)", 0 to 3650, hint "0 = never"); no screen lists or previews wipes; the command prints a per-workspace line (dry-run "would wipe" or "WIPED") and a total.
- **Endpoints:** none owned (heartbeat route belongs to NODE/WADEV).
- **Data:** reads `packages` where `data_retention_days > 0`; workspaces on that plan (`plan` equals the package slug OR the numeric id as a string), with `data_wiped_at` NULL, `plan_ends_at` not NULL and older than now minus N days. Deletes (children first, each table guarded by existence): `inbox_messages` and `conversation_participants` of the workspace's conversations, `wp_campaign_contacts`, `broadcast_contacts`, `messages` (when it has `workspace_id`), then every row with the workspace id in `contacts`, `contact_groups`, `conversations`, `wpcampaigns`, `broadcasts`, `flows`, `flow_subscribers`, `scheduled_messages`, `wa_templates`, `keyword_replies`, `deals`, `deal_activities`, `wa_orders`, `ai_agents`, `ai_training_sources`, `ai_chat_assistants`, `ai_call_assistants`, `appointments`, `saved_replies`, `attributes`, `chatbot_widgets`, `incoming_webhooks`, `devices`, `wa_provider_configs`. With `--force` it then stamps `workspaces.data_wiped_at = now` and sets `plan = NULL`.
- **Rules & edge cases:**
  1. Only workspaces whose paid plan has an end date can be wiped; free-trial-expired workspaces (no `plan_ends_at`) are never wiped.
  2. Exactly once per workspace (the `data_wiped_at` stamp excludes it next time); `plan_ends_at` stays in the past so the workspace remains on the free package.
  3. The workspace shell, owner, members, orders, subscriptions, wallet, invoices, tags, companies, tasks, custom fields, media files and integrations settings are NOT deleted; hard deletes with no backup, no soft delete, no audit entry, no notification to the customer and no advance warning.
  4. Deleting `devices` rows does not tell the Node bridge to close sockets or purge Baileys auth folders (WADEV must handle it).
  5. Add-on packages can carry retention days in the database, but they never match a workspace, and the add-on form has no field for it (docs claim it; ADD-035).
  6. Cache lock `wipe-expired-daily-lock` (24h) prevents repeats; a failure is logged as `[HEARTBEAT] data-retention wipe failed` and swallowed.
  7. No scheduler is used: if no Node bridge heartbeats arrive, the wipe never runs.
- **Async & events:** heartbeat-triggered command; log lines `[WIPE-EXPIRED]`.
- **External systems:** Node bridge heartbeat.
- **Settings:** per-package `data_retention_days`.
- **Acceptance criteria:**
  - Given a plan with retention 30 and a workspace whose plan ended 31 days ago, when the daily job runs, then its conversations, contacts and devices are deleted, `data_wiped_at` is set and `plan` becomes NULL.
  - Given retention 0, when the job runs, then nothing is deleted.
  - Given the dry-run command, when run, then it prints "would wipe" lines and deletes nothing.
  - Given a workspace already wiped, when the job runs again, then it is skipped.
- **Source refs:** app/Console/Commands/WipeExpiredWorkspaces.php, app/Http/Controllers/WaConnectController.php (nodeHeartbeat), resources/views/admin/packages/create.blade.php, database/migrations/2026_06_18_000200_create_addon_packages_and_retention.php, Documentation/pages/admin-panel/addons.html.
- **Port notes:** BullMQ repeatable job (`plans:retention-sweep`) with a dry-run flag, a soft-delete/grace step, an outbox event `org.data_wiped` for audit, a customer warning email N days before, and a real object-store purge; scope deletion by `org_id` under a service role.

### TW-PLAN-024 — Package analytics overview

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-PLAN-001
- **Summary:** An admin dashboard about how each plan performs: KPI cards, MRR trend for the top plans, plan share donut, per-package leaderboard, upgrade paths, cancellation reasons and feature adoption over a 30, 90 or 365 day window. Several metrics are proxies or always empty because the data model lacks the signals (cancellations, reasons).
- **Actors & access:** super-admin (admin group middleware).
- **UX & screens:** `resources/views/admin/packages/analytics.blade.php` (page key `packages-analytics`, `packages-analytics.js` draws ApexCharts). Header: breadcrumb Admin > Packages > Analytics, a package select (All packages or each plan name), a days select (Last 30 days, Last 90 days, This year = 365) that auto-submit a GET form, and a green "Export CSV" button (TW-PLAN-025). Six KPI cards: Total MRR, Subscribers (sub-line "+N net new"), ARPA, LTV avg (sub-line), churn % (sub-line "N cancelled/new"), Trial to paid (sub-line "of N trials"). Panels: "MRR by package" stacked area chart (weekly buckets, y axis in thousands "k"), "Plan share" donut, "Leaderboard" table (Package with price label, Subscribers, Net new, MRR, ARPA, Churn (amber above 0, coral at 5 percent or more), Avg LTV, Trend arrow up, flat or down), "Where do upgrades come from?" bars (from to, count, kind upgrade, downgrade or cancel), "Why people leave" list ("No cancellations on record yet." when empty), "Feature adoption" bars (8 features). Charts show "No revenue in the selected window." or "No subscribers yet." placeholders.
- **Endpoints:**

| Method uri                            | Route name               | Action                                | Middleware  | Request                                                               | Response |
| ------------------------------------- | ------------------------ | ------------------------------------- | ----------- | --------------------------------------------------------------------- | -------- |
| GET admin/packages/analytics/overview | admin.packages.analytics | AdminPagesController@packageAnalytics | admin group | `days` (30, 90, 365; anything else becomes 90), `package` (plan name) | HTML     |

- **Data:** reads `packages` (plan type), `workspaces` (not soft-deleted) grouped by stored `plan` (blank becomes `free`), `orders` (status `paid` filtered by `created_at` inside the window; cancellations by `updated_at`) and, for adoption, existence-checked tables.
- **Rules & edge cases:**
  1. "Total MRR" is NOT recurring revenue: it is the sum of PAID order totals in the window across all packages (renewals and one-offs), unconverted across currencies. ARPA = that sum divided by the count of all non-deleted workspaces (free ones included); LTV = ARPA times 28 (a hard-coded months constant).
  2. Churn and cancellations count orders with status `cancelled`, a status that never exists (orders are `pending`, `paid`, `failed`, `refunded`; admin cancel writes `failed`), so churn, cancellations, the cancel bucket and the trend "down" are always 0.
  3. "Trial to paid" = paid orders in window divided by (paid orders plus workspaces whose stored plan value is `free` or `trial`); signups on slug `starter` never count as trials, so it usually reads 0 or 100.
  4. MRR chart: first three plans in sort order, weekly buckets (`max(4, round(days/7))`), each bucket the paid order total for that package divided by 1000, one decimal.
  5. Subscribers per package: the leaderboard looks up `workspaces.plan` by the lower-cased plan NAME only; the donut and CSV fall back to the slug. Workspaces stored by numeric id (every purchased plan) match neither, so they are missing from subscriber counts (see Open questions).
  6. Upgrade paths: per workspace, consecutive paid orders with a different `package_id` form a transition; upgrade or downgrade is decided by comparing package ids (creation order), not price. A synthetic "Trial -> First paid" row counts distinct workspaces with any paid order in the window (renewals included).
  7. Cancellation reasons read `workspaces.cancellation_reason`, a column that does not exist, so the list is always empty.
  8. Feature adoption = distinct workspaces with a row in `messages`, `wpcampaigns`, `wa_templates`, `flows`, `meta_campaigns`, `shopify_integrations`, `woocommerce_integrations`, `hubspot_integrations` divided by ALL workspaces (label says paying workspaces).
  9. The package select only echoes back and feeds the export link: the on-page numbers ignore it.
  10. Everything is wrapped in try/catch and degrades to zeros.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** brand name for the export.
- **Acceptance criteria:**
  - Given 30, 90 or 365 in `days`, when the page loads, then the window and labels follow; any other value behaves as 90.
  - Given paid orders in the window, when the page renders, then Total MRR equals their totals and ARPA equals that over the workspace count.
  - Given no orders, when the page renders, then charts show placeholders and KPIs read 0.
  - Given the package filter set, when the page renders, then (parity) the numbers are unchanged.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (packageAnalytics), resources/views/admin/packages/analytics.blade.php, resources/js/charts/packages-analytics.js, Documentation/pages/admin-panel/plans-packages.html.
- **Port notes:** replace proxies with real SaaS metrics from a `subscriptions` and `subscription_events` history (new, upgrade, downgrade, cancel with reason); compute MRR from active subscription prices normalised to monthly and to one currency; run as materialised daily rollups.

### TW-PLAN-025 — Package analytics CSV export

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-PLAN-024
- **Summary:** Downloads the same window numbers as one self-describing CSV.
- **Actors & access:** super-admin.
- **UX & screens:** the "Export CSV" link on the analytics page (outside the filter form so it downloads instead of re-submitting) carrying the current `days` and `package`.
- **Endpoints:**

| Method uri                          | Route name                      | Action                                      | Middleware  | Request           | Response                                    |
| ----------------------------------- | ------------------------------- | ------------------------------------------- | ----------- | ----------------- | ------------------------------------------- |
| GET admin/packages/analytics/export | admin.packages.analytics.export | AdminPagesController@packageAnalyticsExport | admin group | `days`, `package` | streamed `text/csv; charset=UTF-8` download |

- **Data:** same queries as TW-PLAN-024.
- **Rules & edge cases:**
  1. Filename: `<brand-slug>-package-analytics-<days>d-<YYYYMMDD-HHMM>.csv` with the brand from `app_name`.
  2. Sections: a comment header (title, "Window (days)", "Package filter" (name or all), "Generated at" ISO 8601), a "Summary" block (Total MRR (window), Total subscribers, ARPA, LTV (avg, ARPAx28), Churn %, New paid orders, Cancellations) with two-decimal numbers, then "Per-plan leaderboard" with columns `plan_id` (numeric id), `plan_slug`, `name`, `subscribers`, `mrr`, `arpa`, `ltv`, `net_new`, `cancellations`, `churn_pct`.
  3. The package filter restricts only the leaderboard rows (exact name match); the summary stays global.
  4. Subscribers here use name OR slug (unlike the page's name-only), so the CSV can differ from the screen.
- **Async & events:** none (streamed).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given `days=30`, when downloaded, then the window line says 30 and the filename carries `30d`.
  - Given `package=Pro`, when downloaded, then the leaderboard has one row.
  - Given no data, when downloaded, then zeros and headers are still present.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (packageAnalyticsExport), resources/views/admin/packages/analytics.blade.php.
- **Port notes:** stream with a Nest `StreamableFile`; share the metric service with the page so the two can never diverge.

### TW-PLAN-026 — Admin Financial dashboard

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PLAN-001
- **Summary:** The revenue control centre for the platform owner: revenue, MRR, ARR, refunds and outstanding KPIs plus revenue over time, gateway share, top paying workspaces, order status mix and the latest orders. Documented in the billing-finance doc.
- **Actors & access:** super-admin (admin group middleware). (Also referenced by DASH and PAYGW; the order data itself is PAYGW's.)
- **UX & screens:** `resources/views/admin/financial/index.blade.php` (page key `admin-financial`, ApexCharts via `admin-financial.js` reading a window object). Header window select (7d, 30d default, 90d, 1y) auto-submitting a GET form, links "Invoices" and "Order history", a (non-functional) search box. Five KPI cards: Revenue (with +/- percent chip against the previous equal-length window), MRR (active), ARR (projected), Refunds, Outstanding. Charts: "Revenue" area (daily paid revenue and daily refunds, total in the header), Payment methods donut, Order status donut. Tables: Top paying workspaces (10 rows, each links to admin workspace detail; empty text "No paid orders yet in this window."), Recent orders (8 rows: order number, workspace, plan or a dash, amount, status badge, relative time; empty "No orders yet.").
- **Endpoints:**

| Method uri          | Route name      | Action                          | Middleware                                   | Request                     | Response |
| ------------------- | --------------- | ------------------------------- | -------------------------------------------- | --------------------------- | -------- |
| GET admin/financial | admin.financial | Admin\FinancialController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `window` (7d, 30d, 90d, 1y) | HTML     |

- **Data:** `orders` (money is `COALESCE(total_amount, amount)`), `workspaces` joined to `packages`, `packages`.
- **Rules & edge cases:**
  1. Windows are inclusive day ranges ending today; the comparison window is the immediately preceding one of the same length; delta = (now - prev)/prev x 100 rounded to 2 decimals, 100 when prev is 0 and now above 0.
  2. Revenue = paid orders by `paid_at`; refunds = orders with status `refunded` by `updated_at` (nothing in the app ever sets `refunded` except a booking edge case, so usually 0, see PAYGW-047); outstanding = `pending` orders created in the window.
  3. MRR = sum over workspaces JOINED to packages on `packages.id = workspaces.plan` (numeric id only) where the package is not free and is active, of the offer-aware price (offer price when above 0, else plan_amount), independent of the window and of the workspace's `plan_ends_at` (a lapsed workspace still counts). Workspaces stored with a slug are omitted (QUIRK). ARR = MRR x 12.
  4. All money sums add amounts in different currencies unconverted and print the platform display currency symbol; the recent-orders amount uses the same symbol (an earlier hard-coded dollar sign was fixed).
  5. Top paying workspaces: group paid orders by workspace, order by sum desc, limit 10; a missing workspace shows "Workspace #id".
  6. Charts degrade to a single "No data" slice when empty.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** display currency (SET/CPN).
- **Acceptance criteria:**
  - Given paid orders of 100 and 50 in the last 30 days and 60 in the prior 30, when the page loads at default, then Revenue is 150 with a +150 percent chip.
  - Given two active paid plans with subscribers stored by id, when rendered, then MRR equals the sum of their offer-aware prices per workspace and ARR is 12 times that.
  - Given a pending order created 5 days ago, when rendered, then Outstanding includes it.
  - Given an unknown `window`, when rendered, then the 30 day window is used.
- **Source refs:** app/Http/Controllers/Admin/FinancialController.php, resources/views/admin/financial/index.blade.php, resources/js/charts/admin-financial.js, Documentation/pages/admin-panel/billing-finance.html.
- **Port notes:** analytics module with materialised revenue rollups per reporting currency; MRR from active subscriptions, not from a join on the workspace plan pointer; add refund events when refunds exist.

### TW-PLAN-027 — Admin Premium dashboard

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-PLAN-001
- **Summary:** Tracks the subscription base: paid vs free workspaces, ARPU and trial-to-paid conversion, the plan mix, revenue by plan, new paid signups per day, the most popular plans and a table of every plan with its workspace count and revenue.
- **Actors & access:** super-admin.
- **UX & screens:** `resources/views/admin/premium/index.blade.php` (page key `admin-premium`, `admin-premium.js`). Header: window select (7d, 30d default, 90d, 1y), links to Packages and "New plan". Four KPI cards: Paid workspaces, Free workspaces, ARPU, Trial to paid (with change chip). Charts: plan distribution donut, revenue by plan bar, new paid signups area. Panels: "Most popular plans" (top 5 by orders, fixed to the last 90 days regardless of the window, empty "No paid orders in last 90 days.") and "All plans" table (name, price, duration, workspaces, MRR, window revenue, active badge, Edit link; empty "No plans defined yet.").
- **Endpoints:**

| Method uri        | Route name    | Action                        | Middleware                                   | Request  | Response |
| ----------------- | ------------- | ----------------------------- | -------------------------------------------- | -------- | -------- |
| GET admin/premium | admin.premium | Admin\PremiumController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `window` | HTML     |

- **Data:** `workspaces`, `packages`, `orders`, `users`.
- **Rules & edge cases:**
  1. Paid workspaces = workspaces whose `plan` is in the ids of NON-free packages (any type); free = total workspaces minus paid; so slug-stored workspaces count as free.
  2. ARPU = MRR / paid workspaces where MRR is computed as in TW-PLAN-026.
  3. Conversion = distinct workspaces with a paid order in the window divided by users created in the window, times 100 to 2 decimals, compared to the previous window.
  4. Plan distribution joins workspaces to packages on the numeric id and labels everything unmatched as "Free" (so slug-stored workspaces appear as Free).
  5. Revenue by plan groups paid orders by package name ("Unknown" when unmatched; add-on or wallet orders with no package are "Unknown").
  6. New paid signups per day = distinct workspaces with a paid order that day (renewals included).
  7. The All plans table lists plan-type packages by price descending with MRR = offer-aware price times workspace count.
  8. Money uses the platform display symbol without currency conversion.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** display currency.
- **Acceptance criteria:**
  - Given 3 workspaces on a paid plan (by id) and 7 on Free, when the page loads, then Paid is 3 and Free is 7.
  - Given 10 signups and 2 workspaces paying in the window, when rendered, then conversion reads 20.00 percent.
  - Given no paid orders in 90 days, when rendered, then the "Most popular plans" empty text shows.
- **Source refs:** app/Http/Controllers/Admin/PremiumController.php, resources/views/admin/premium/index.blade.php, resources/js/charts/admin-premium.js, Documentation/pages/admin-panel/billing-finance.html.
- **Port notes:** same analytics module as TW-PLAN-026; use the plan FK for joins; define "paid workspace" as an active non-free subscription.

### TW-PLAN-028 — Package display feature list (package_features)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** An early design stored plan bullet points as separate `package_features` rows (name, icon, status) referenced by a comma-separated id list in `packages.pfeatures_id`. No admin screen edits either, no web view renders them; only the seeder fills `package_features` and the mobile plan payload reads them.
- **Actors & access:** none (no route, no UI).
- **UX & screens:** none. The web plan cards are generated from the boolean and numeric columns (`Package::featureCatalog()`), and the `detail` text field.
- **Endpoints:** none.
- **Data:** `package_features` (id, name varchar 255, icon varchar 255 null, status bool default 1, timestamps), `packages.pfeatures_id` (varchar 255 null, CSV of ids). `PackageSeeder` inserts ten names (WhatsApp number, Contacts, Messages / month, Flows + auto-replies, Team inbox, Shopify / WooCommerce, AI assist, WhatsApp Catalog, SSO + SCIM, Priority support) but never links them to a package.
- **Rules & edge cases:**
  1. `Package::features()` returns the `PackageFeature` rows for the CSV ids (empty collection when the CSV is empty); `getFeaturesArray()` splits and trims.
  2. The mobile app billing and content endpoints call `->features()->pluck('title')`, but the table has `name` not `title`, so the payload would carry nulls if a package ever had ids (MOB domain, observed).
  3. The model still emits a generic created/updated/deleted notification if rows were ever changed ("Plan feature").
  4. `PackageSeeder` also seeds `cta_url` values like `/checkout?plan=starter` that match no route.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a fresh install, when the pricing pages render, then bullets come from the catalogue, not `package_features`.
  - Given a package with `pfeatures_id = "1,2"`, when `features()` is called, then it returns the two rows (parity, unused).
- **Source refs:** app/Models/PackageFeature.php, app/Models/Package.php (features, getFeaturesArray), database/seeders/PackageSeeder.php, database/migrations/2026_05_05_000008_create_packages_table.php.
- **Port notes:** do not port; if bullet lists are wanted, use a JSONB `highlights` array on the plan edited in the wizard.

## Data model

Platform-level (non-tenant) tables owned here. There is no `org_id`; in the port these are platform catalogue tables outside RLS, writable only by the platform admin role. Workspace-scoped counters (`plan_usage`) carry the tenant key.

### packages

Purpose: one row per plan (`type = 'plan'`) or add-on (`type = 'addon'`, ADD). Read by every entitlement check, all pricing surfaces and admin analytics; written by TW-PLAN-002/003/004 (and ADD for add-ons).

- Keys and indexes: `id` bigint PK; `plan_id` varchar(255) NOT NULL UNIQUE (the slug); index `(status, sort_order)`; index `type`. No soft delete.
- Identity and price: `type` varchar(16) default `plan`; `grants_json` JSON null (add-on grants `{features:[...], limits:{key:int}}`); `pname` varchar(255); `pfeatures_id` varchar(255) null (dead, TW-PLAN-028); `plan_unit` varchar(255) null (`days|weeks|months|years`; seeded rows use singular `month`; consumers match by prefix except the add-on window code which needs the plural); `plan_duration` int null; `plan_amount` decimal(12,2) default 0; `offer_price` decimal(12,2) null (must be lower than plan_amount when set; wins over the amount for charging when above 0); `currency` varchar(8) default `INR` in the schema (form default USD).
- Flags: `free` (bool), `lifetime` (bool), `status` (bool default 1), `is_default` (bool), `is_highlighted` (bool), `is_custom_quote` (bool), `data_retention_days` uint default 0.
- Display: `sort_order` int default 0, `detail` text, `cta_label` varchar(255), `cta_url` varchar(255) (no UI), `subtitle` text.
- Numeric limits (48 columns; NOT NULL default 0 for the original set, nullable unsigned for later additions): see the table in TW-PLAN-006 (includes the channel and calling caps).
- Boolean features (tinyint(1); default 0 except the 2026_05_17 group default 1): see TW-PLAN-007 (71 tinyint columns beyond the six basic flags, including channel and integration flags); `multipledevice` and `file_type_restrictions` are VARCHAR(255) NULL used as booleans; `access_whatsapp_pay`, `auto_invoice`, `auto_invoice_max_monthly`, `auto_invoice_branding` exist but are not fillable.
- Semantics: `isFreePlan()` = `free` OR (amount 0 and not custom quote); `chargeableAmount()` = 0 for free or amount 0, else offer price when above 0, else plan_amount; `isNativelyYearly()` = `plan_unit` starts with "year"; `periodLabel()` builds "/month", "/3 months".
- Volume: tens of rows.

### package_features

Legacy display bullets (TW-PLAN-028): `id`, `name`, `icon` null, `status` default 1, timestamps. Seeded with 10 rows; no reader in the web app.

### subscriptions

A recurring subscription mirrored from a gateway (lifecycle rules in PAYGW-029/030; cancel action in TW-PLAN-012). Columns: `id`; `workspace_id` bigint NOT NULL; `user_id` null; `package_id` null; `plan_id` varchar(255) null (holds the package numeric id as text); `gateway` varchar(255) NOT NULL (gateway slug); `gateway_subscription_id`, `gateway_plan_id`, `gateway_customer_id` varchar(255) null; `billing_cycle` varchar(255) default `monthly` (`monthly|yearly`); `status` varchar(255) default `pending` (`pending | active | past_due | canceled | expired`; "active" for entitlement display purposes means active or past_due); `amount` decimal(12,2); `currency` varchar(8) default `USD`; `current_period_end` timestamp null; `renewals_count` uint default 0; `meta` JSON (`{order_id, order_number}`); `canceled_at` null; timestamps. Indexes: `(gateway, gateway_subscription_id)`, `(workspace_id, status)`, `workspace_id`, `user_id`, `gateway_subscription_id`. Read here by the plan picker, the renewal bar and cancel; written by PAYGW and TW-PLAN-012. No FKs.

### plan_usage

Delete-proof quota ledger (TW-PLAN-018): `id`, `workspace_id` bigint, `metric` varchar(64), `period` varchar(64), `count` uint default 0, timestamps; UNIQUE `(workspace_id, metric, period)`, index `workspace_id`. One row per workspace, metric and billing period; tiny.

### pricing_faqs

Marketing FAQ rows (TW-PLAN-009): `id`, `question` varchar(255), `answer` text, `sort_order` smallint unsigned default 0, `is_active` bool default 1, `placement` varchar(16) default `pricing` (`pricing|home|both`), timestamps; index `(is_active, sort_order)`. Read by the plan picker (all active), the homepage slider (placement home or both) and the mobile FAQ.

### Workspace columns touched here (owned by WSP)

`workspaces.plan` varchar(32) NOT NULL default `starter` (slug from signup or numeric package id from checkout/admin), `plan_overrides` JSON null (limit-key overrides, -1 unlimited), `trial_ends_at` timestamp null, `plan_ends_at` timestamp null (NULL = never expires), `billing_cycle` varchar(20) default `monthly`, `cap_monthly_messages`, `cap_daily_messages`, `cap_devices`, `cap_users` (unused), `data_wiped_at` timestamp null (indexed), `currency` varchar(10) null.

### Settings keys (system_settings)

`registration_default_plan_id` (string), `registration_trial_days` (int 14), `billing_plan_scope` (workspace|account), `pricing.yearly_toggle_enabled` (bool true), `pricing.yearly_discount_pct` (int 20), `pricing.refund_enabled` (bool true), `pricing.refund_days` (int 7), `pricing.recurring_enabled` (bool true), `security.api_rate_limit_per_minute` (int 600); the reference database only has `pricing.yearly_discount_pct = 20`, `pricing.refund_days = 7` and the checkout tax and country keys seeded.

## Cross-domain contracts

Consumes:

- **WSP**: `Workspace::package()`, `billingPackage()`, `effectiveLimit()`, `onTrial()`, `trialExpired()`, `planExpired()`, `planIsActive()`, `ownedByPlatformAdmin()` (TW-WSP-010); overrides endpoint and the workspace-edit plan grant (TW-WSP-031, TW-WSP-026); workspace creation and `WorkspaceProvisioner` (TW-WSP-001, 002); the workspace role hierarchy used by `EnsureWorkspaceRole`.
- **PAYGW**: checkout, `finalizeOrder`, subscription lifecycle and reconciler, gateway drivers (`cancelSubscription`), orders, invoices, checkout settings (tax, refund, yearly, recurring switches).
- **ADD**: add-on packages, `grants_json`, `workspace_addons`, add-on merge into `effectiveLimit`, extension-contributed plan features and limits merged into the wizard lists and `Package::getFillable`.
- **CPN / SET**: `FormatSettings` (currency conversion and display), the currencies list for the wizard, `SystemSetting`, brand name helpers, general settings screen that saves the signup settings.
- **WALLET**: `planIsActive()` decides whether the plan's free monthly allowance applies vs wallet billing; `MessageBillingService::payPerMessageFor`.
- **NOTIF**: `LogsNotifications` model hook (Package created, updated, deleted) and the audit log (order and settings actions are audited, package changes are not).
- **AUTH**: register step 3 plan picker (TW-AUTH-009) lists packages and links to checkout.
- **CMS**: frontend content editor (`fc()`), page layout, FAQ component scope for `/pricing`.
- **NODE/WADEV**: heartbeat route that triggers the daily wipe.
- **RBAC**: seeded permission keys `packages.*`, `billing.*`, `platform.billing.view` (declared, unenforced).

Exposes:

- To every gated domain: `PlanLimitGuard::check`, `checkQuota`, `feature`, `hasFeature`; `PlanLimitReachedException` and its 422 JSON contract; the `plan:` route middleware alias (`EnforcePlanFeature`); the key registry in TW-PLAN-006/007 (each channel and feature domain must register its plan flag and limit columns here); `TracksPlanQuota` + `PlanUsage::bump/usage` for delete-proof caps.
- To API/MOB: `PlanUsage::summary()` (plan, meters, unlocked features) for `api/v1/me`, `api/v1/usage` and the mobile summaries; `ApiPlanRateLimit`.
- To marketing and checkout: `Package::publicPricingCards()`, `toPricingCard()`, `featureCatalog()`, `chargeableAmount()`, `isNativelyYearly()`, `periodLabel()`, active scopes `active()`, `plans()`, `addons()`.
- To WSP admin screens: `AdminPagesController::planLimitColumns()` and `planFeatureToggles()` (override form, add-on form, migrations).
- To all user pages: `EnsureTrialActive` (global web middleware), `ReconcileSubscription` (terminating middleware), `x-trial-bar`, `x-plan-paywall`, `x-plan-crown`, `x-plan-usage` components, `config/plan_gates.php`.

## Open questions & quirks

1. **Dual plan reference (highest impact).** `workspaces.plan` holds the package SLUG at signup and the numeric package ID after checkout or an admin edit. Entitlement resolution tolerates both, but the admin Packages list, delete guard, Package analytics, Financial and Premium dashboards join or count on the numeric id only, so slug-stored workspaces (all never-upgraded signups) are missing from subscriber counts, MRR and paid/free splits, and can be orphaned by deleting their plan. The port must use a single FK.
2. **Fresh reference DB has no packages.** `PackageSeeder` (Starter, Growth, Pro, Enterprise with plan-specific flags) is not called by `DatabaseSeeder`; the reference database is empty of packages and package_features. Signup then falls back to the literal slug `starter` with no package row (entitlements fall back to open and unlimited). The seed data is a useful default ladder for the port.
3. **About 20 boolean flags and 26 numeric caps are declared but never enforced** (lists in TW-PLAN-006/007), yet they are sold on pricing pages. Decide per item whether to enforce or remove.
4. **Admin UI double-gate trap:** limit and flag columns must be in both the controller lists and the wizard maps; `pipelines_limit`, the Facebook/TikTok/Telegram/LINE/WeChat/Viber caps, `access_line/wechat/viber` and their broadcast flags cannot be set from the UI; `access_whatsapp_pay`, `auto_invoice*` are not fillable so their switches do nothing; `access_wa_forms`/`access_wa_links` render no switch and their routes are always open. As written LINE, WeChat and Viber cannot be enabled for any non-admin plan without direct database edits.
5. **Read leak on gated routes:** `EnforcePlanFeature` lets GET (including JSON) through and only overlays a paywall on HTML; the docs and class comment describe a redirect to /pricing that the code does not do. Path-map paywalls never block POSTs.
6. **Trial gate coverage:** applies to web routes only; API key, mobile and Node-bridge traffic keep working after the trial ends.
7. **Two inconsistent admin-bypass lists** (`PlanLimitGuard`/crown: Super Admin, Admin, role admin or A; `EnsureTrialActive`/trial bar/paywall: also super-admin and platform-admin), plus a third mechanism (workspace owned by a platform admin returns true and -1 from `effectiveLimit`).
8. **Unlimited semantics:** 0, null and negative all mean unlimited for count guards, but 0 means "use global default" for the API rate limit and 0 blanks render as empty inputs; add-on stacking on a 0 base lowers an unlimited plan (ADD-031). Port needs one rule.
9. **Possible add-on flag merge bug (unverified):** `effectiveLimit` merges add-ons by base type; flags whose model cast is missing (for example `access_waba_calling`, `access_ai_*`, `access_sales_pipeline`, `access_translation`, `access_wa_storefront`) may resolve as integers, in which case an add-on that "grants" them takes the numeric branch and grants nothing. Needs a live check with the `threadwise-verify-parity` skill.
10. **Currency inconsistencies:** plan picker and paywall show package currency unconverted, public pricing converts to the platform default currency, admin dashboards sum mixed currencies with one symbol; checkout charges in the package currency unless a supported currency is requested.
11. **Public pricing shows add-ons** as plan cards, register step 3 lists add-ons (uses `Package::active()` without a type filter), the paywall plan list may include add-ons, and `Workspace::freePackage()` (first `free = true` row by sort order, no type filter) could pick a free add-on. Filter by `type = 'plan'` everywhere.
12. **Renewal reminder link bug:** references route name `checkout.show` that does not exist, so "Renew now" always opens the plans page.
13. **No lifecycle messaging:** no email, in-app or push notification for trial ending, trial ended, plan expiring, plan lapsed, payment failed or wipe warning. The workspace notification preference `payment_failed` is defined with defaults but no code emits it.
14. **Package admin lacks audit and permission checks:** no `Audit::log` for package create, update, toggle or delete; the seeded `packages.*` and `billing.*` permission keys are unused. Notifications go only to the acting admin.
15. **Analytics that cannot work:** cancellations use order status `cancelled` (never written), reasons use a nonexistent `workspaces.cancellation_reason`, "Total MRR" is paid order revenue, LTV is ARPA x 28, the package filter is ignored on the page, upgrade vs downgrade compares ids not prices (TW-PLAN-024).
16. **Docs vs code:** docs say there are about thirty feature toggles (there are about 70 flag columns, 66 in the admin form's list), list a CTA URL field (removed from the form), say per-workspace overrides live on the workspace detail page (no form posts to the endpoint, WSP-031), say "Default for signups" auto-places new workspaces (the admin setting takes precedence and `is_default` is only a fallback, TW-PLAN-008), describe the Invoices window default as this month (code default is all time, PAYGW), and say plans show "Choose Pro" style buttons (true for non-upgrade cases only).
17. **Field length mismatch:** package slug allowed up to 191 characters but `workspaces.plan` is VARCHAR(32).
18. **Unused code:** `CheckoutController@pricing` (no route), `packages-create.js` and `packages-edit.js` (unused page keys), `Package::formatPrice/monthly_price/yearly_price`, workspace `cap_*` columns, `PlanUsage::period` caching, `EnsureTrialActive` alias `trial`. Mobile plan payload reads `->pluck('title')` on `package_features` (column is `name`).
19. **Race and concurrency:** counts then insert without locks let caps overshoot; package edits have no optimistic locking; MRR and stats are computed live with unindexed grouping (fine at Reference scale).
20. **Out-of-domain items observed and left to owners:** `Api\App\BillingController` plan endpoints (MOB), `register/plan` routes (AUTH-009), `admin.workspaces.overrides` (WSP-031), `account/invoices/{id}` and `account?tab=orders` (PAYGW-035/036), `account?tab=addons` (ADD-033), `admin/checkout-settings` (PAYGW-007), `admin/order-history`, `admin/billing-history`, `admin/invoices` (PAYGW-037 to 046), `admin/addons` (ADD-025 to 030), `x-message-pricing` (WALLET), `ExtensionRegistry::planFeatures` (ADD-013).

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET admin/packages",
    "POST admin/packages",
    "GET admin/packages/create",
    "GET admin/packages/analytics/overview",
    "GET admin/packages/analytics/export",
    "GET admin/packages/{id}/edit",
    "PATCH admin/packages/{id}",
    "DELETE admin/packages/{id}",
    "POST admin/packages/{id}/toggle",
    "GET admin/pricing-faqs",
    "POST admin/pricing-faqs",
    "PATCH admin/pricing-faqs/{id}",
    "DELETE admin/pricing-faqs/{id}",
    "POST admin/pricing-faqs/{id}/toggle",
    "GET account/plans",
    "POST account/subscription/cancel",
    "GET pricing",
    "GET admin/financial",
    "GET admin/premium"
  ],
  "controllers": [
    "app/Http/Controllers/PricingController.php",
    "app/Http/Controllers/AdminPagesController.php",
    "app/Http/Controllers/Admin/PricingFaqController.php",
    "app/Http/Controllers/Admin/FinancialController.php",
    "app/Http/Controllers/Admin/PremiumController.php",
    "app/Http/Controllers/FrontendController.php"
  ],
  "services": ["app/Services/PlanLimitGuard.php", "app/Services/PlanUsage.php"],
  "models": ["Package", "PackageFeature", "Subscription", "PricingFaq"],
  "tables": ["packages", "package_features", "subscriptions", "plan_usage", "pricing_faqs"],
  "views": [
    "resources/views/admin/packages/index.blade.php",
    "resources/views/admin/packages/create.blade.php",
    "resources/views/admin/packages/analytics.blade.php",
    "resources/views/admin/pricing-faqs/index.blade.php",
    "resources/views/admin/financial/index.blade.php",
    "resources/views/admin/premium/index.blade.php",
    "resources/views/pricing/index.blade.php",
    "resources/views/pricing/_features.blade.php",
    "resources/views/frontend/pricing.blade.php",
    "resources/views/components/frontend/pricing-strip.blade.php",
    "resources/views/components/plan-crown.blade.php",
    "resources/views/components/plan-paywall.blade.php",
    "resources/views/components/plan-usage.blade.php",
    "resources/views/components/trial-bar.blade.php"
  ],
  "commands": ["workspaces:wipe-expired"],
  "permissions": [
    "packages.view",
    "packages.create",
    "packages.edit",
    "packages.delete",
    "billing.view",
    "billing.invoices",
    "billing.refund",
    "billing.cards",
    "platform.billing.view"
  ],
  "middleware": [
    "app/Http/Middleware/EnsureTrialActive.php",
    "app/Http/Middleware/EnforcePlanFeature.php",
    "app/Http/Middleware/ReconcileSubscription.php",
    "app/Http/Middleware/ApiPlanRateLimit.php"
  ],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/admin-packages-create.js",
    "resources/js/charts/packages-create.js",
    "resources/js/charts/packages-edit.js",
    "resources/js/charts/packages-index.js",
    "resources/js/charts/packages-analytics.js",
    "resources/js/charts/pricing-index.js",
    "resources/js/charts/admin-financial.js",
    "resources/js/charts/admin-premium.js"
  ],
  "misc_files": ["app/Exceptions/PlanLimitReachedException.php"],
  "config_files": ["config/plan_gates.php"],
  "doc_pages": [
    "Documentation/pages/getting-started/plans-trial.html",
    "Documentation/pages/admin-panel/plans-packages.html",
    "Documentation/pages/admin-panel/billing-finance.html",
    "Documentation/pages/security/plan-enforcement.html"
  ],
  "feature_map": {
    "TW-PLAN-001": ["GET admin/packages"],
    "TW-PLAN-002": ["GET admin/packages/create", "GET admin/packages/{id}/edit"],
    "TW-PLAN-003": ["POST admin/packages", "PATCH admin/packages/{id}"],
    "TW-PLAN-004": ["POST admin/packages/{id}/toggle"],
    "TW-PLAN-005": ["DELETE admin/packages/{id}"],
    "TW-PLAN-009": [
      "GET admin/pricing-faqs",
      "POST admin/pricing-faqs",
      "PATCH admin/pricing-faqs/{id}",
      "DELETE admin/pricing-faqs/{id}",
      "POST admin/pricing-faqs/{id}/toggle"
    ],
    "TW-PLAN-010": ["GET pricing"],
    "TW-PLAN-011": ["GET account/plans"],
    "TW-PLAN-012": ["POST account/subscription/cancel"],
    "TW-PLAN-024": ["GET admin/packages/analytics/overview"],
    "TW-PLAN-025": ["GET admin/packages/analytics/export"],
    "TW-PLAN-026": ["GET admin/financial"],
    "TW-PLAN-027": ["GET admin/premium"]
  }
}
```
