---
domain: coupons-credits-referral-currency
code: CPN
title: Coupons, Credit Packages, Referral/Affiliate and Currencies
threadwise_version: '1.7.0'
sources_read: 74
---

# Coupons, Credit Packages, Referral/Affiliate and Currencies

## Overview

This domain groups four small, platform-level "money levers" that sit around the checkout and the wallet. All four are configured by the super-admin (platform staff) and consumed by every workspace owner; none of them is tenant data. The admin CRUD screens are guarded only by "must be an admin user" plus the IP allow-list middleware; there are no granular permission keys and no plan gates for them.

1. **Coupons** (`coupons` table, admin `/admin/coupons`). Discount codes a customer types in the plan checkout. A single resolver (`Coupon::resolve`) applies every rule (active flag, start/expiry window, global redemption cap, per-user cap, first-purchase-only, currency lock, min order, plan restriction, percent-vs-fixed with a cap). The checkout runs the resolver twice: once as a non-binding AJAX preview, once inside `process()` where the result is binding. Redemptions are counted only when the order is finalized as paid.
2. **Credit packages** (`credit_packages` table, admin `/admin/credit-packages`). Admin-curated one-time top-up bundles ("price X buys N credits"). In v1.7.0 the product pivoted to a "money wallet" where users top up any amount, so the bundle grid on the wallet tab is switched off in code and the bundle checkout URL now redirects to the any-amount top-up. The admin CRUD, the bundle order/fulfilment path and a legacy self-confirm route still exist and must be understood (one of them is a security hole, see TW-CPN-017).
3. **Currencies** (`currencies` table, admin `/admin/currencies`, plus `FormatSettings` and `MoneyFormat` helpers). An admin-managed catalog (30 seeded) with symbol, decimals and an exchange rate relative to USD; a single platform default currency in `system_settings.default_currency`; per-workspace display currency; live-rate refresh from a free public API; and the conversion/format helpers used by every screen that shows money.
4. **Referral / affiliate** (`referrals` table, `users.referral_code`, `users.referred_by_user_id`, `CaptureReferral` middleware, `ReferralService`, `/affiliate-history`). Every user has a 10-character code; a `?ref=` link is remembered in a 30-day cookie; at registration the referee is attributed once to the referrer; the referrer is paid a fixed wallet bonus when the referee makes their FIRST paid order (not at signup). Users see history, KPIs, a chart and a CSV export.

Who uses it: super-admin / platform staff (coupon, package, currency admin; the affiliate reward amount), workspace owners (apply coupons at checkout, see their affiliate dashboard and referral link, choose a workspace currency), and end users of the mobile app (read-only mirrors through `Api/App/*` endpoints that belong to the MOB domain).

Plan tiers do not change this domain: coupons and credit packages are platform-level, currencies are platform-level, the affiliate program has no plan gate. The only tier-related interaction is that a coupon can be restricted to specific plan/add-on package ids.

Connections: PLAN (plan checkout, packages, orders), CHK (checkout controller and order finalization that call the coupon resolver and the referral payout), WALLET (`WalletService`, `wallet_transactions`, credit conversion settings; the referral bonus is a wallet credit), AUTH (registration, OTP, social signup, users table columns), MOB (mobile `coupon/available`, `affiliate/code`, `create-order`), I18N/SET (default currency also editable in general settings), WSP (workspace currency), INV/DEAL/CAT/STORE (consumers of currency symbol and `MoneyFormat`), NOTIF (audit trail rows), RBAC (no permission keys are used here).

Two ground truths that the rest of the file relies on:

- `wallet_credits` (users table) is the spendable balance and after the money-wallet pivot 1 credit == 1 minor unit of the platform currency. The referral reward setting is entered as money in the admin form and stored x100.
- `default_currency` is a key in `system_settings`; `Currency.exchange_rate` means "units of this currency per 1 USD".

## Feature index

| Id         | Feature                                                                            | Status      | Priority | Effort | Depends on |
| ---------- | ---------------------------------------------------------------------------------- | ----------- | -------- | ------ | ---------- |
| TW-CPN-001 | Admin coupon list, KPIs, filters                                                   | implemented | P1       | M      | -          |
| TW-CPN-002 | Create coupon                                                                      | implemented | P1       | M      | TW-CPN-001 |
| TW-CPN-003 | Edit coupon                                                                        | implemented | P1       | S      | TW-CPN-002 |
| TW-CPN-004 | Toggle coupon active                                                               | implemented | P1       | S      | TW-CPN-001 |
| TW-CPN-005 | Delete coupon                                                                      | implemented | P1       | S      | TW-CPN-001 |
| TW-CPN-006 | Coupon validation and discount engine                                              | implemented | P0       | M      | TW-CPN-002 |
| TW-CPN-007 | Checkout coupon preview (Apply button)                                             | implemented | P1       | S      | TW-CPN-006 |
| TW-CPN-008 | Binding coupon application and redemption counting at plan checkout                | implemented | P0       | M      | TW-CPN-006 |
| TW-CPN-009 | Admin credit package list                                                          | implemented | P2       | S      | -          |
| TW-CPN-010 | Create credit package                                                              | implemented | P2       | M      | TW-CPN-009 |
| TW-CPN-011 | Edit credit package                                                                | implemented | P2       | S      | TW-CPN-010 |
| TW-CPN-012 | Toggle credit package                                                              | implemented | P2       | S      | TW-CPN-009 |
| TW-CPN-013 | Delete credit package                                                              | implemented | P2       | S      | TW-CPN-009 |
| TW-CPN-014 | Credit bundle discovery for users (wallet tab, register step 3)                    | partial     | P2       | S      | TW-CPN-010 |
| TW-CPN-015 | Credit-package checkout routes (redirect to wallet top-up, legacy gateway process) | partial     | P2       | M      | TW-CPN-010 |
| TW-CPN-016 | Credit-package fulfilment into the wallet ledger                                   | implemented | P2       | S      | TW-CPN-015 |
| TW-CPN-017 | Legacy self-confirm credit checkout (/checkout, /checkout/complete)                | implemented | P2       | S      | TW-CPN-016 |
| TW-CPN-018 | Admin currency catalog list                                                        | implemented | P1       | S      | -          |
| TW-CPN-019 | Add currency                                                                       | implemented | P1       | S      | TW-CPN-018 |
| TW-CPN-020 | Update currency (route only, no UI)                                                | partial     | P1       | S      | TW-CPN-018 |
| TW-CPN-021 | Toggle currency active                                                             | implemented | P1       | S      | TW-CPN-018 |
| TW-CPN-022 | Delete currency (blocked for default)                                              | implemented | P1       | S      | TW-CPN-018 |
| TW-CPN-023 | Fetch live exchange rates                                                          | implemented | P1       | M      | TW-CPN-018 |
| TW-CPN-024 | Set platform default currency                                                      | implemented | P0       | S      | TW-CPN-018 |
| TW-CPN-025 | Seed 30 starter currencies at install                                              | implemented | P1       | S      | TW-CPN-019 |
| TW-CPN-026 | Currency conversion and display engine (FormatSettings, Currency::symbolFor)       | implemented | P0       | M      | TW-CPN-018 |
| TW-CPN-027 | Workspace display currency resolution and selection                                | implemented | P1       | S      | TW-CPN-026 |
| TW-CPN-028 | Minor-unit money helpers (MoneyFormat)                                             | implemented | P1       | S      | TW-CPN-026 |
| TW-CPN-029 | Referral code generation                                                           | implemented | P1       | S      | -          |
| TW-CPN-030 | Referral link capture (?ref cookie)                                                | implemented | P1       | S      | TW-CPN-029 |
| TW-CPN-031 | Referral code at registration (web form, OTP path, mobile API)                     | implemented | P1       | M      | TW-CPN-030 |
| TW-CPN-032 | Referral attribution (one referrer per referee)                                    | implemented | P1       | S      | TW-CPN-031 |
| TW-CPN-033 | Referral reward on referee's first paid order                                      | implemented | P1       | M      | TW-CPN-032 |
| TW-CPN-034 | Affiliate reward setting (admin wallet-rules save)                                 | implemented | P1       | S      | -          |
| TW-CPN-035 | Affiliate history dashboard                                                        | implemented | P2       | L      | TW-CPN-032 |
| TW-CPN-036 | Affiliate history CSV export                                                       | implemented | P2       | S      | TW-CPN-035 |
| TW-CPN-037 | Account affiliate tab and More-page affiliate counters                             | implemented | P2       | S      | TW-CPN-032 |
| TW-CPN-038 | Advertised 20% recurring affiliate commission                                      | docs-only   | P2       | S      | TW-CPN-033 |

## Features

### TW-CPN-001 — Admin coupon list, KPIs, filters

- **Status:** implemented
- **Priority:** P1 (expected by customers; admin cannot manage promotions without it)
- **Effort:** M
- **Depends on:** none
- **Summary:** The super-admin sees every coupon, newest first, 12 per page, with four KPI cards, status pill filters (All, Active, Disabled, Expired), a free-text search over code and description, an inline active switch per row and a row menu (Edit, Delete). Expired rows are dimmed.
- **Actors & access:** Platform admin only. Route middleware: authenticated, admin check (`isAdmin()`: Spatie role "Super Admin" or "Admin", or legacy `users.role` in admin/A), IP allow-list. No permission key, no plan gate. Blocked for writes in demo mode but GET works.
- **UX & screens:** `resources/views/admin/coupons/index.blade.php` (page key `admin-coupons-index`, JS `packages-index.js` provides the floating three-dot row menu that closes on outside click, Esc, scroll and resize). Header breadcrumb Admin > Coupons; title "Discount coupons"; "New coupon" button. Flash `success` banner. KPI cards: Total coupons (count of all), Active (`is_active = true`), Expired (`expires_at` not null and in the past), Total redemptions (sum of `uses_count`). Pill filters submit a GET form with `status` (`all|active|disabled|expired`, anything else behaves as all); pills show counts for All, Active and Expired. Search input `q` (placeholder mentions code or description). Table columns: Code (monospace, description truncated under it), Discount (percent shown as trimmed number + "%", fixed shown through `FormatSettings::currency` in the viewer's currency, note the coupon's own `currency_code` is NOT used for display), Uses (`uses_count / max_uses` or `/ infinity` when uncapped), Validity ("start -> end" with "now" and "forever" placeholders, or "forever" if both empty), Status toggle (auto-submits POST on change), row menu. Empty state: "No coupons match." with a link to create the first one. Footer: "Showing a-b of N coupons" and Laravel pagination links with one side page.
- **Endpoints:**

| Endpoint          | Route name          | Handler                      | Middleware                                   | Request                                                            | Response                                       |
| ----------------- | ------------------- | ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- |
| GET admin/coupons | admin.coupons.index | Admin\CouponController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | query `q` (string), `status` (all/active/disabled/expired), `page` | HTML view; query string preserved across pages |

- **Data:** reads `coupons`. Ordering `id DESC`. `paginate(12)`. Search is `code LIKE %q% OR description LIKE %q%` (no escaping of `%`/`_` wildcards). Status filter: `active` -> `is_active = 1`, `disabled` -> `is_active = 0`, `expired` -> `expires_at IS NOT NULL AND expires_at < now`. Expired filter does not exclude disabled rows. KPIs are global (unaffected by filter/search).
- **Rules & edge cases:**
  1. KPIs and pill counts ignore the current search text and status; only the table is filtered.
  2. "Expired" is computed against server `now()`; a disabled coupon that has also expired counts in both Disabled-filter membership and Expired KPI.
  3. The sidebar badge next to "Coupons" counts ACTIVE coupons only (regardless of expiry) and is hidden when 0.
  4. Delete confirmation text promises that workspaces which already redeemed the code keep their discount (nothing is clawed back).
  5. `uses_count` display uses number formatting; `max_uses` 0/null both render as infinity (validation forbids 0 on save).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none. Money display of fixed coupons depends on the viewer's workspace currency / `default_currency` (TW-CPN-026).
- **Acceptance criteria:**
  - Given 30 coupons exist, When the admin opens `/admin/coupons`, Then 12 rows are shown newest first with "Showing 1-12 of 30 coupons" and page links.
  - Given coupons with codes WELCOME10 and SAVE20, When the admin searches `save`, Then only SAVE20 is listed while the KPI strip still shows the global totals.
  - Given one coupon whose `expires_at` is yesterday, When the admin clicks the Expired pill, Then only that coupon is listed and its row is dimmed.
  - Given a non-admin authenticated user, When they open `/admin/coupons`, Then they receive HTTP 403 "Admins only".
  - Given no coupons exist, Then the empty state with the "create the first one" link is shown and all KPIs read 0.
- **Source refs:** app/Http/Controllers/Admin/CouponController.php; resources/views/admin/coupons/index.blade.php; resources/js/charts/packages-index.js; app/Models/Coupon.php; resources/views/components/admin/sidebar.blade.php; Documentation/pages/admin-panel/coupons-credits.html.
- **Port notes:** Nothing exists in this repo yet (billing module is a README only). Suggested home `apps/api/src/modules/billing/coupons` + `apps/web/.../admin/billing/coupons`. Coupons are platform-global (no tenant column, no RLS; guard by platform-admin permission). Use keyset or offset pagination with page size 12 to match. Escape LIKE wildcards in the port.

### TW-CPN-002 — Create coupon

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CPN-001
- **Summary:** Admin creates a discount code through a four-section form (Identity, Discount, Eligibility, Limits & behavior). The code is uppercased and unique; all rule fields feed the resolver in TW-CPN-006.
- **Actors & access:** Platform admin; same middleware as TW-CPN-001. Demo mode blocks the POST for demo users (`admin/coupons*`).
- **UX & screens:** `resources/views/admin/coupons/create.blade.php` + partial `_form.blade.php` (page key `admin-coupons-create`, JS `admin-coupons-form.js` turns the plan multi-select into a Tom Select with remove and clear buttons, unlimited options, search by text). Header has Cancel and "Create coupon" (submits form id `couponForm`). Validation errors are listed in a coral box "Please fix the following". Sections:
  - 01 Identity: Code (required, max 64, monospace, uppercase styling, hint "Uppercased on save"), Description (textarea, max 255, "shown to customer"), Admin note (textarea, max 1000, internal), Active toggle (default ON; sent as hidden 0 + checkbox 1).
  - 02 Discount: Type select (Percent default / Fixed amount), Amount (required, step 0.01, min 0), Max discount cap (percent only; blank = no cap), Currency lock select (options: "Any currency" blank + every ACTIVE currency as "symbol CODE", ordered by code; static fallback list INR/USD/EUR/GBP/AED when the catalog is empty), Minimum order amount (step 0.01).
  - 03 Eligibility: Applicable plans multi-select of active packages (`packages.status = 1`, ordered by `plan_amount`, labelled `pname`; empty = any plan), Starts at and Expires at (`datetime-local`).
  - 04 Limits and behavior: Max total redemptions (integer >= 1, blank = unlimited), Per-user limit (integer >= 1, blank = unlimited), First purchase only toggle (default OFF), Stackable with other coupons toggle (default OFF).
- **Endpoints:**

| Endpoint                 | Route name           | Handler                       | Middleware                                   | Request                                                                                                                                                                                                                            | Response                                           |
| ------------------------ | -------------------- | ----------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| GET admin/coupons/create | admin.coupons.create | Admin\CouponController@create | Authenticate, EnsureUserIsAdmin, IPAllowlist | -                                                                                                                                                                                                                                  | HTML form with `packages` and `currencies` options |
| POST admin/coupons       | admin.coupons.store  | Admin\CouponController@store  | same                                         | code, description, admin_note, type, amount, max_discount_amount, currency_code, min_order_amount, max_uses, per_user_limit, applicable_package_ids[], starts_at, expires_at, is_active, first_purchase_only, stackable_with_other | Redirect to index with flash "Coupon created."     |

- **Data:** inserts one `coupons` row. Validation rules (exact): `code` required string max 64 unique in `coupons.code`; `description` nullable string max 255; `admin_note` nullable string max 1000; `type` required in `percent,fixed`; `amount` required numeric min 0; `max_discount_amount` nullable numeric min 0; `currency_code` nullable string max 8; `min_order_amount` nullable numeric min 0; `max_uses` nullable integer min 1; `per_user_limit` nullable integer min 1; `applicable_package_ids` nullable array, each integer and existing in `packages.id`; `starts_at` nullable date; `expires_at` nullable date and `after_or_equal:starts_at`. Then `code` is uppercased; booleans `is_active`, `first_purchase_only`, `stackable_with_other` are coerced from the raw input (missing = false). `uses_count` starts at 0.
- **Rules & edge cases:**
  1. Uniqueness is on the raw submitted code BEFORE uppercasing, but the DB collation (utf8mb4_unicode_ci) is case-insensitive, so `save20` collides with `SAVE20`. In the port make uniqueness case-insensitive explicitly (citext or lower() unique index).
  2. Percent amount has no upper bound (150 is accepted; the engine caps the discount at the order amount). Add a max of 100 in the port only if product agrees; otherwise keep parity.
  3. `max_discount_amount` and `currency_code` are stored even for the wrong type; the engine only uses the cap for percent coupons and the currency lock for every type.
  4. `currency_code` is free text (max 8), not validated against the currency catalog.
  5. Dates are entered in the admin's browser-local `datetime-local` and stored as timestamps in the app timezone (no per-user timezone conversion).
  6. Audit: the model is observed by the generic auditable observer, so `coupon.created` is logged with the row as the resource.
  7. `applicable_package_ids` accepts plan AND add-on package ids (the packages table holds both); the picker lists only `status = 1` rows.
- **Async & events:** audit log row `coupon.created`. No queue, no mail.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given valid input `code=welcome10, type=percent, amount=10`, When the admin submits, Then a coupon `WELCOME10` is created with `uses_count=0`, `is_active` per the toggle, and the admin is redirected to the list with a success flash.
  - Given an existing coupon `SAVE20`, When the admin creates `save20`, Then validation fails with a uniqueness error and nothing is saved.
  - Given `starts_at` after `expires_at`, When submitted, Then validation fails on `expires_at`.
  - Given `max_uses=0`, When submitted, Then validation fails (min 1).
  - Given an `applicable_package_ids` value that does not exist, Then validation fails.
  - Given the currency catalog is empty, Then the currency lock dropdown offers the five fallback currencies.
- **Source refs:** app/Http/Controllers/Admin/CouponController.php; app/Models/Coupon.php; resources/views/admin/coupons/create.blade.php; resources/views/admin/coupons/_form.blade.php; resources/js/charts/admin-coupons-form.js; app/Observers/AuditableObserver.php; database/migrations/2026_05_21_010000_create_coupons_and_pricing_faqs.php; database/migrations/2026_05_21_081001_add_advanced_fields_to_coupons.php; Documentation/pages/admin-panel/coupons-credits.html.
- **Port notes:** Model as `coupons` (global, no `tenant_id`), money as `numeric(12,4)`. Store `applicable_package_ids` as a join table or `bigint[]` with FK integrity (Reference stores JSON without FK). Emit an audit + outbox row in the same transaction per repo rules. Reuse the repo's admin permission model instead of the `isAdmin()` shortcut.

### TW-CPN-003 — Edit coupon

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-002
- **Summary:** Admin edits any field of an existing coupon using the same form as create, with a header showing an Active/Disabled pill and "Redeemed N / max times, expires in ..." text.
- **Actors & access:** Platform admin. Same middleware. Demo mode blocks PATCH.
- **UX & screens:** `resources/views/admin/coupons/edit.blade.php` (page key `admin-coupons-edit`) includes `_form.blade.php` with the coupon bound. Header breadcrumb ends with the code; buttons Cancel and "Save changes". Sub-heading: "Redeemed {uses_count}{ / max_uses} times" plus "expires {relative time}" when an expiry is set. After saving the admin stays on the edit page (redirect back) with a flash "Coupon updated."; errors listed in the coral box.
- **Endpoints:**

| Endpoint                    | Route name           | Handler                       | Middleware                                   | Request                                   | Response                            |
| --------------------------- | -------------------- | ----------------------------- | -------------------------------------------- | ----------------------------------------- | ----------------------------------- |
| GET admin/coupons/{id}/edit | admin.coupons.edit   | Admin\CouponController@edit   | Authenticate, EnsureUserIsAdmin, IPAllowlist | id                                        | HTML form; 404 when missing         |
| PATCH admin/coupons/{id}    | admin.coupons.update | Admin\CouponController@update | same                                         | same fields as create (form spoofs PATCH) | back() with flash "Coupon updated." |

- **Data:** updates the `coupons` row; uniqueness rule ignores the row itself. Same validation as TW-CPN-002. `uses_count` is never editable from the UI.
- **Rules & edge cases:**
  1. QUIRK: the plan restriction cannot be cleared through the form. An empty multi-select submits no `applicable_package_ids` key, the validated array then lacks the key and `update()` leaves the old JSON in place. Only removing one of several plans works. The port must send an explicit empty list to clear the restriction.
  2. Blank numeric inputs arrive as empty strings, are converted to null by the framework, and DO overwrite the column with null (so clearing caps, limits and dates works).
  3. Changing `code` on an edited coupon changes what customers must type; existing orders keep their `coupon_code` snapshot and `coupon_id`.
  4. Lowering `max_uses` below `uses_count` is allowed and simply makes the coupon "fully used".
  5. Audit: `coupon.updated` with a compact change set (`updated_at` removed, strings over 500 chars replaced by a length marker); nothing is logged when no column changed.
- **Async & events:** audit log `coupon.updated`.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given coupon 5 with `max_uses=100`, When the admin clears the field and saves, Then `max_uses` becomes null (unlimited).
  - Given coupon 5 restricted to plans [1,2], When the admin removes both chips and saves in Reference, Then the restriction stays [1,2] (documented quirk); in the port it MUST become unrestricted.
  - Given a rename to a code that another coupon already uses, Then validation fails.
  - Given a missing id, Then HTTP 404.
  - Given nothing changed on save, Then no audit row is written.
- **Source refs:** app/Http/Controllers/Admin/CouponController.php; resources/views/admin/coupons/edit.blade.php; resources/views/admin/coupons/_form.blade.php; app/Observers/AuditableObserver.php.
- **Port notes:** Use PATCH semantics with explicit nulls; treat an empty array as "any plan". Optimistic-lock the row (repo has an optimistic-lock test harness) because two admins can edit concurrently.

### TW-CPN-004 — Toggle coupon active

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-001
- **Summary:** One-click enable/disable of a coupon from the list switch. Disabling stops new redemptions without deleting history.
- **Actors & access:** Platform admin; same middleware; demo mode blocks POST.
- **UX & screens:** the Status column switch in the list submits a tiny form on change; the page reloads with flash "Activated." or "Deactivated." The edit page also shows the current state pill.
- **Endpoints:**

| Endpoint                       | Route name           | Handler                       | Middleware                                   | Request | Response          |
| ------------------------------ | -------------------- | ----------------------------- | -------------------------------------------- | ------- | ----------------- |
| POST admin/coupons/{id}/toggle | admin.coupons.toggle | Admin\CouponController@toggle | Authenticate, EnsureUserIsAdmin, IPAllowlist | id      | back() with flash |

- **Data:** flips `coupons.is_active`.
- **Rules & edge cases:** 1. Not idempotent (each call flips). 2. Missing id -> 404. 3. Audit `coupon.updated` with `{is_active: ...}` change.
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active coupon, When the switch is toggled, Then `is_active` is false, the flash says "Deactivated." and the resolver now rejects the code with "This coupon is disabled."
  - Given a disabled coupon, When toggled, Then it is active and flash says "Activated."
  - Given a missing id, Then 404.
- **Source refs:** app/Http/Controllers/Admin/CouponController.php; resources/views/admin/coupons/index.blade.php.
- **Port notes:** Prefer an explicit `PUT /coupons/:id/active {value}` (idempotent) over a flip endpoint.

### TW-CPN-005 — Delete coupon

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-001
- **Summary:** Hard-deletes a coupon after a confirmation dialog. Past orders keep their discount because the order stores its own amount, `coupon_code` and `coupon_id` (no foreign key).
- **Actors & access:** Platform admin; same middleware. Demo mode blocks every DELETE.
- **UX & screens:** row menu "Delete" opens a danger confirmation "Delete coupon CODE? Workspaces that already redeemed it keep their discount." (title "Delete coupon", confirm text "Yes, delete"). On success flash "Coupon removed."
- **Endpoints:**

| Endpoint                  | Route name            | Handler                        | Middleware                                   | Request | Response                            |
| ------------------------- | --------------------- | ------------------------------ | -------------------------------------------- | ------- | ----------------------------------- |
| DELETE admin/coupons/{id} | admin.coupons.destroy | Admin\CouponController@destroy | Authenticate, EnsureUserIsAdmin, IPAllowlist | id      | back() with flash "Coupon removed." |

- **Data:** deletes the `coupons` row (no soft delete). `orders.coupon_id` has only an index, no FK, so it becomes a dangling id; `booking_templates.coupon_id` has an FK with `ON DELETE SET NULL`.
- **Rules & edge cases:**
  1. Per-user-limit counting keys on `orders.coupon_id`; if an admin deletes a code and re-creates the same text, the new coupon has a new id and every customer's usage resets to zero (loophole).
  2. The code returns to the pool and can be re-created.
  3. Shopify/Woo offer composers and booking templates that referenced the coupon lose it (booking template FK nulls).
  4. Audit `coupon.deleted`.
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a coupon used by 3 paid orders, When deleted, Then the orders still show their `coupon_code` and discount and the coupon no longer resolves.
  - Given a booking template pointing at the coupon, When the coupon is deleted, Then the template's `coupon_id` becomes null.
  - Given demo mode is on and a demo user, When they submit the delete, Then the request is rejected by the demo guard.
- **Source refs:** app/Http/Controllers/Admin/CouponController.php; app/Http/Middleware/DemoMode.php; app/Models/BookingTemplate.php; resources/views/admin/coupons/index.blade.php.
- **Port notes:** Prefer soft-delete or `archived_at` so the per-user-limit history survives; keep a code-reuse policy decision explicit (open question below).

### TW-CPN-006 — Coupon validation and discount engine

- **Status:** implemented
- **Priority:** P0 (every coupon feature depends on it)
- **Effort:** M
- **Depends on:** TW-CPN-002
- **Summary:** `Coupon::resolve(code, package, amount, user?, currency?, otherCoupons[])` decides whether a code applies and computes the discount, returning `{ok, message, coupon, discount}`. Messages are user-facing rejection strings.
- **Actors & access:** Called by any authenticated buyer through the web checkout preview and process paths, and by the mobile create-order endpoint (MOB domain). No permission key.
- **UX & screens:** surfaced as toasts on the checkout page (TW-CPN-007) and as a flash error on submit (TW-CPN-008). Exact rejection meanings, in evaluation order: (1) empty code "Enter a coupon code."; (2) unknown "Coupon X not recognised."; (3) inactive "This coupon is disabled."; (4) before `starts_at` "This coupon is not active yet."; (5) after `expires_at` "This coupon has expired."; (6) `uses_count >= max_uses` "This coupon is fully used."; (7) currency lock mismatch "only valid for payments in XXX"; (8) non-stackable with another different coupon "cannot be combined with another coupon"; (9) first-purchase-only violated "valid on your first purchase only"; (10) per-user limit reached "already used this coupon the maximum number of times"; (11) amount below `min_order_amount` "Order is below the coupon minimum."; (12) plan not in the allowed list "does not apply to this plan"; (13) computed discount <= 0 "Coupon yielded no discount."; success message "Coupon applied."
- **Endpoints:** none (model/service method). Callers: `POST checkout/{packageId}/apply-coupon`, checkout `process`, mobile `Api\App\BillingController@createOrder` (MOB).
- **Data:** reads `coupons`, and `orders` (`user_id`, `status = 'paid'`, `coupon_id`) for per-customer rules.
- **Rules & edge cases:**
  1. The input code is trimmed and uppercased; lookup is `UPPER(code) = code` so case never matters.
  2. Time window: `starts_at > now` rejects; `expires_at < now` rejects (expiry is inclusive to the second).
  3. Global cap: rejects when `uses_count >= max_uses` (null = unlimited). The counter is only incremented on paid (TW-CPN-008), so concurrent unpaid orders can exceed the cap; there is no reservation.
  4. Currency lock: when the coupon has a `currency_code` AND the caller passed a currency, both uppercased must match; when the caller passes no currency the lock is skipped.
  5. Stackability: the check only runs when the coupon is NOT stackable and `otherCoupons` contains a different non-empty code. QUIRK: no caller ever passes `otherCoupons` (the checkout has a single code input), so "stackable" is effectively unimplemented; the admin toggle has no observable effect.
  6. First purchase only: only evaluated when a user is passed; rejects if the user has ANY order with `status = 'paid'` (plan, add-on, credit bundle or wallet top-up all count), keyed on `user_id`, not workspace, although the admin hint says "workspaces".
  7. Per-user limit: counts the user's paid orders with this `coupon_id`; rejects when count >= limit. Only orders in status `paid` count, so a pending order does not consume a use.
  8. Minimum order: compares the raw caller `amount` (plan price for the billing period, in the ORDER currency, before tax) against `min_order_amount`; the coupon's own `currency_code` is not converted.
  9. Plan restriction: applies when the list is a non-empty array; the package id is compared as integers.
  10. Discount: percent -> `round(amount * pct / 100, 2)` then capped at `max_discount_amount` if that is set and > 0; fixed -> `round(amount_field, 2)` taken as-is in whatever currency the order is in (no conversion, even when the coupon has no currency lock). Finally `discount = min(discount, order amount)`; zero or negative rejects.
  11. All money is float-rounded to 2 decimals; there is no per-currency precision (a zero-decimal currency like JPY still rounds to 2 decimals).
  12. The rule order above matters for which message the customer sees first.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a 20% coupon capped at 50 and an order of 1000, When resolved, Then discount is 50.
  - Given a fixed 500 coupon and an order of 300, When resolved, Then discount is 300 (never above the order).
  - Given a coupon locked to INR and an order in USD, Then it is rejected with the currency message.
  - Given `first_purchase_only` and a user who has one paid order, Then rejected; with only pending/failed orders, Then accepted.
  - Given `per_user_limit=1` and the user already has one paid order with the coupon, Then rejected; after that order is refunded/failed it is not counted.
  - Given a plan-restricted coupon and a non-listed package, Then rejected with the plan message.
  - Given lower-case input " welcome10 ", Then it resolves the same coupon.
- **Source refs:** app/Models/Coupon.php; app/Http/Controllers/CheckoutController.php; app/Http/Controllers/Api/App/BillingController.php; app/Models/Order.php.
- **Port notes:** Implement as a pure domain function in `billing/coupons` with unit tests for every rule and an injectable clock. Decide (with product) whether to fix: (a) reservation of uses at order creation, (b) case-insensitive uniqueness, (c) real stacking, (d) precision per currency via TW-CPN-028. Keep the message wording stable (translation keys).

### TW-CPN-007 — Checkout coupon preview (Apply button)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-006
- **Summary:** On the plan checkout page the buyer types a code and clicks Apply; an AJAX call returns the resolved discount or a rejection reason, and the order summary recomputes subtotal, discount, tax and total in the browser.
- **Actors & access:** Authenticated user (any workspace member who can reach checkout). Returns 401 JSON "Log in first." if no user. Package must be active (`packages.status = 1`) else 404. No permission key.
- **UX & screens:** coupon card in `resources/views/checkout/show.blade.php` (owned by the CHK/PLAN domain, described here only for the coupon widget): input `#coupon-input` (uppercased), Apply button `#coupon-apply`, Enter key also applies. Success: discount row "Coupon - CODE" with negative amount, tax recomputed as `(subtotal - discount) * taxPct / 100`, total updated, toast with the server message. Failure: discount cleared, error toast. Network error: toast "Could not check coupon". Changing the payment currency clears the input and discount. The widget is hidden when the page is rendered in credit/wallet mode (`allowCoupon=false`).
- **Endpoints:**

| Endpoint                               | Route name                 | Handler                        | Middleware   | Request                                                                          | Response                                                                              |
| -------------------------------------- | -------------------------- | ------------------------------ | ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| POST checkout/{packageId}/apply-coupon | user.checkout.apply-coupon | CheckoutController@applyCoupon | Authenticate | JSON/form `code` (required, string, max 64), `amount` (required, numeric, min 0) | JSON `{ok, message, discount, code}` (`code` is the canonical uppercase code or null) |

- **Data:** reads `packages`, `coupons`, `orders` (via the engine). No writes.
- **Rules & edge cases:**
  1. `amount` is CLIENT-SUPPLIED (the page sends the displayed subtotal). The preview therefore can be gamed but is advisory; the binding recomputation happens server-side in TW-CPN-008.
  2. The preview currency for the currency-lock check is `workspace.currency`, else the package currency, else USD (note: the real order currency may differ if the buyer switched currency in the dropdown, so preview and process can disagree).
  3. The route has no throttle (unlike the public storefront coupon route), so codes can be enumerated by an authenticated user. Add throttling in the port.
  4. The preview does not reserve or increment anything.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `checkout.tax_rate` / tax label affect the client-side recompute only.
- **Acceptance criteria:**
  - Given a valid 10% coupon, When the buyer applies it on a 100 plan, Then the response is `{ok:true, discount:10, code:"WELCOME10"}` and the summary shows total = (100-10) + tax.
  - Given an expired coupon, Then `{ok:false, message:"This coupon has expired."}` and the summary is unchanged.
  - Given an unauthenticated call, Then 401 JSON "Log in first." (the route sits behind the authenticate middleware, so in practice a redirect/401).
  - Given an inactive plan id, Then 404.
- **Source refs:** app/Http/Controllers/CheckoutController.php; resources/views/checkout/show.blade.php; app/Models/Coupon.php.
- **Port notes:** In the port compute the amount server-side from `packageId + billing period + currency` and ignore any client amount; rate-limit per user.

### TW-CPN-008 — Binding coupon application and redemption counting at plan checkout

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-CPN-006
- **Summary:** When the buyer submits the plan checkout the coupon is re-resolved on the server against the authoritative price, the discount, tax and total are persisted on the `orders` row, and the coupon's `uses_count` is incremented atomically when (and only when) the order is finalized as paid.
- **Actors & access:** Authenticated buyer; the same logic runs for mobile create-order (MOB) and for offline/bank-transfer approvals (admin marks paid).
- **UX & screens:** field `coupon` (nullable string, max 64) on the checkout form; on rejection the user is sent back with the input preserved and a flash error carrying the resolver message.
- **Endpoints:** owned by CHK: `POST checkout/{packageId}` (`user.checkout.process`, `CheckoutController@process`) and callbacks/webhooks. Listed here for the coupon contract only, not claimed.
- **Data:** creates `orders` with `discount_amount`, `coupon_id`, `coupon_code`, `tax_rate`, `tax_amount`, `total_amount`, `amount` (= final billed total, post discount and tax), `base_amount_usd`. On paid finalization: `UPDATE coupons SET uses_count = uses_count + 1 WHERE id = order.coupon_id` inside the same DB transaction as the plan switch.
- **Rules & edge cases:**
  1. Authoritative amount = package `chargeableAmount()` (offer aware) converted into the order currency, then the billing period math (yearly etc.); the coupon is applied to that amount, tax on `max(0, amount - discount)`, total rounded to 2 decimals.
  2. If the resolver rejects, the order is NOT created; the buyer sees the reason.
  3. Increment happens once per finalization; `finalizeOrder` short-circuits if the order is already paid, so gateway callback + webhook duplicates do not double count.
  4. Counting covers every path that calls finalize: gateway callback, webhook, offline proof approval (`markPaidManually`), mobile app create-order (auto-marked paid).
  5. Recurring subscriptions: the gateway subscription is created for `order.amount` (the discounted total) in at least the Razorpay driver, so the coupon appears to discount every renewal, not just the first charge. Other drivers were not verified (open question).
  6. A 100% coupon yields total 0 (or tax-free zero); how gateways treat a zero-amount order was not verified (open question).
  7. Coupons apply to add-on packages too because the same package table and code path is used.
  8. The credit-package and wallet top-up checkouts have `allowCoupon=false`: coupons never apply there.
- **Async & events:** audit rows for the order (order model is observed); referral payout attempt after commit (TW-CPN-033).
- **External systems:** payment gateway drivers charge `order.amount`.
- **Settings:** `checkout.tax_enabled`, `checkout.tax_rate`, `checkout.tax_label` (CHK), `pricing.yearly_discount_pct`.
- **Acceptance criteria:**
  - Given a 10% coupon and a 100 plan with 18% tax, When the buyer submits, Then the order has `discount_amount=10`, `tax_amount=16.2`, `total_amount=106.2`, `coupon_code` snapshot and status pending.
  - Given the gateway confirms payment twice (callback then webhook), Then `uses_count` increased by exactly 1.
  - Given `max_uses=1` and two buyers both create orders before either pays, Then both orders may be created (no reservation) and both paid finalizations succeed, taking `uses_count` to 2 (documented gap).
  - Given a coupon that became disabled after order creation but before payment, Then the paid finalization still counts the redemption (no re-validation at finalize).
  - Given an invalid coupon at submit, Then no order row is created and the flash contains the reason.
- **Source refs:** app/Http/Controllers/CheckoutController.php (process, finalizeOrder, markPaidManually, confirmOrderPayment); app/Http/Controllers/Api/App/BillingController.php; app/Models/Order.php; app/Services/Payment/Drivers/RazorpayDriver.php.
- **Port notes:** Home in the orders/checkout module (CHK). Use a conditional UPDATE `uses_count < max_uses` to make the cap race-safe; consider reserving on order creation and releasing on failure/expiry. Order rows need `coupon_id` + `coupon_code` snapshot columns and a FK with `ON DELETE SET NULL`.

### TW-CPN-009 — Admin credit package list

- **Status:** implemented
- **Priority:** P2 (bundles are retired from the user side in v1.7.0, admin CRUD still works)
- **Effort:** S
- **Depends on:** none
- **Summary:** The super-admin sees every credit bundle in display order with price, credits, computed credits per currency unit, badge and status, and can edit, enable/disable or delete each.
- **Actors & access:** Platform admin; middleware authenticated + admin + IP allow-list. Demo mode blocks writes and every delete for demo users. No permission key.
- **UX & screens:** `resources/views/admin/credit-packages/index.blade.php` (page key `credit-packages-index`). Title "Credit packages" with an intro that says bundles convert to a fixed credit count independent of the settings conversion rate (link to admin settings). "New package" button. `x-admin.flash` banner for the `status` session key. Table columns: Name (+ truncated description), Slug, Price (`price_display`, converted into the viewer's currency through `FormatSettings::display`), Credits (thousands separated), "Per <symbol>1" (credits per major unit of the package currency, one decimal; header symbol comes from the viewer's currency, so the label may not match the package currency), Badge, Status (Active/Disabled dot), Actions (Edit link, Enable/Disable button, Delete with confirm "Delete this package? Existing purchases keep their ledger rows."). Empty state "No credit packages yet" with hint that a package shows at `/checkout?package=<slug>` and on the wallet page (the wallet grid is switched off, see TW-CPN-014).
- **Endpoints:**

| Endpoint                  | Route name                  | Handler                                   | Middleware                                   | Request | Response                               |
| ------------------------- | --------------------------- | ----------------------------------------- | -------------------------------------------- | ------- | -------------------------------------- |
| GET admin/credit-packages | admin.credit-packages.index | Admin\AdminCreditPackagesController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | -       | HTML with all packages (no pagination) |

- **Data:** reads `credit_packages` ordered by `sort_order ASC, id ASC`. No filters, no search, no pagination. Seed rows in a fresh DB (from the create migration): Starter (price_minor 10000 INR, 5000 credits, sort 10), Growth (50000 INR, 27500 credits, badge "Most popular", featured, sort 20), Scale (100000 INR, 60000 credits, badge "Best value", sort 30).
- **Rules & edge cases:** 1. Rate shown = `credits / price_minor * 100` (credits per major unit). 2. `price_display` converts using stored exchange rates (TW-CPN-026), so a package priced in INR displays in USD for a USD workspace viewer. 3. QUIRK: nothing in the admin navigation links to `/admin/credit-packages` (the sidebar computes a package count into a variable but never renders a Credit packages entry; the Settings hub has no tile for it either), so the page is reachable only by typing the URL. The docs page says it lives under Billing & Plans in the sidebar; it does not in v1.7.0.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none directly.
- **Acceptance criteria:**
  - Given three seeded packages, When the admin opens the page, Then rows appear in sort order Starter, Growth, Scale with Growth's badge visible.
  - Given a disabled package, Then the row shows "Disabled" and the action button reads "Enable".
  - Given no packages, Then the empty state is shown.
- **Source refs:** app/Http/Controllers/Admin/AdminCreditPackagesController.php; app/Models/CreditPackage.php; resources/views/admin/credit-packages/index.blade.php; database/migrations/2026_05_07_140000_create_credit_packages_table.php; Documentation/pages/admin-panel/coupons-credits.html.
- **Port notes:** Given the product pivot to a money wallet, consider shipping only a reduced version (or omit until product confirms bundles are wanted). If ported: `billing/credit-packages`, global table, no RLS.

### TW-CPN-010 — Create credit package

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-CPN-009
- **Summary:** Admin defines a bundle: name, optional slug, price (whole currency units), currency, credits, badge, description, sort order, active and featured flags.
- **Actors & access:** Platform admin; same middleware; demo mode blocks the POST.
- **UX & screens:** `resources/views/admin/credit-packages/create.blade.php` + `_form.blade.php` (3-column layout). Sections: 01 Identity (Name required max 96; Slug optional, hint "leave blank to auto-generate"; Description textarea max 500 "shown on wallet page"), 02 Pricing (Price required numeric step 0.01 min 0, hint "whole currency units"; Currency select of ACTIVE catalog currencies "symbol CODE", default INR when present; Credits required integer min 1 max 100,000,000), 03 Display (Badge max 32 e.g. "Most popular"; Sort order 0-9999 default 0, "lower first"; Active toggle default ON; Featured toggle default OFF). Cancel and "Create package" buttons.
- **Endpoints:**

| Endpoint                         | Route name                   | Handler                                    | Middleware                                   | Request                                                                                                 | Response                                                    |
| -------------------------------- | ---------------------------- | ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| GET admin/credit-packages/create | admin.credit-packages.create | Admin\AdminCreditPackagesController@create | Authenticate, EnsureUserIsAdmin, IPAllowlist | -                                                                                                       | HTML form                                                   |
| POST admin/credit-packages       | admin.credit-packages.store  | Admin\AdminCreditPackagesController@store  | same                                         | name, slug, price_major, currency_code, credits, badge, description, is_active, is_featured, sort_order | Redirect to index, flash `status` "Credit package created." |

- **Data:** inserts `credit_packages`. Validation: `name` required string max 96; `slug` nullable string max 96 `alpha_dash` unique in `credit_packages.slug`; `price_major` required numeric min 0 max 10,000,000; `currency_code` required string exactly 3 chars AND in the list of active currency codes offered by the dropdown (fallback list INR, USD, EUR, GBP, AED if the catalog has no active currency); `credits` required integer min 1 max 100,000,000; `badge` nullable max 32; `description` nullable max 500; `is_active` and `is_featured` optional boolean; `sort_order` nullable integer 0..9999. `price_minor = round(price_major * 100)` (ALWAYS x100, regardless of the currency's real decimals).
- **Rules & edge cases:**
  1. Slug auto-generation (model `saving` hook): when the slug is empty and a name exists, slugify the name (fallback "package"), and append `-2`, `-3`, ... until unique among other rows.
  2. `alpha_dash` allows uppercase, digits, dash, underscore; the checkout route constraint was widened to `[A-Za-z0-9_-]+` for exactly this reason.
  3. QUIRK: `price_minor = major * 100` for every currency, so a 3-decimal currency (KWD) or 0-decimal currency (JPY, IDR) is mispriced relative to its real minor unit; downstream code that converts back does /100 consistently, so the internal loop is consistent but not ISO-correct (see TW-CPN-028).
  4. `sort_order`/flags default to 0/true/false at DB level when omitted.
  5. Price 0 is allowed (`min:0`), which would create a free bundle (and `rate` accessor returns 0).
  6. Audit: `creditpackage.created` via the generic observer.
  7. There is no uniqueness check that a slug does not collide with reserved route words; the route pattern is under `/checkout/credits/{slug}` so collisions are impossible.
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given name "Starter Pack" and blank slug, When saved, Then slug is `starter-pack` and if that exists `starter-pack-2`.
  - Given price 499.50 and currency INR, Then `price_minor=49950`.
  - Given currency code `XXX` not in the active list, Then validation fails.
  - Given credits 0, Then validation fails.
  - Given a slug `bad slug!`, Then `alpha_dash` fails.
- **Source refs:** app/Http/Controllers/Admin/AdminCreditPackagesController.php; app/Models/CreditPackage.php; resources/views/admin/credit-packages/create.blade.php; resources/views/admin/credit-packages/_form.blade.php.
- **Port notes:** Store `price_minor` bigint with the currency's real exponent from the currency catalog (TW-CPN-028) and document the difference; slug unique index; audit + outbox in the same transaction.

### TW-CPN-011 — Edit credit package

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CPN-010
- **Summary:** Same form as create, bound to an existing bundle; saves and returns to the list.
- **Actors & access:** Platform admin; demo mode blocks the PUT.
- **UX & screens:** `resources/views/admin/credit-packages/edit.blade.php`; price is prefilled as `price_minor / 100` with two decimals; on save the admin is redirected to the list with flash "Credit package updated."
- **Endpoints:**

| Endpoint                            | Route name                   | Handler                                    | Middleware                                   | Request               | Response                     |
| ----------------------------------- | ---------------------------- | ------------------------------------------ | -------------------------------------------- | --------------------- | ---------------------------- |
| GET admin/credit-packages/{id}/edit | admin.credit-packages.edit   | Admin\AdminCreditPackagesController@edit   | Authenticate, EnsureUserIsAdmin, IPAllowlist | id                    | HTML, 404 if missing         |
| PUT admin/credit-packages/{id}      | admin.credit-packages.update | Admin\AdminCreditPackagesController@update | same                                         | same fields as create | Redirect to index with flash |

- **Data:** updates the row; slug uniqueness ignores the row itself.
- **Rules & edge cases:** 1. Editing price or credits does not touch already-issued wallet ledger rows or existing orders (they carry their own amounts). 2. If the admin clears the slug the model re-generates one from the name on save (the slug rule allows null). 3. Changing a slug breaks any bookmarked `/checkout/credits/{slug}` URL (which just redirects to wallet top-up anyway). 4. Audit `creditpackage.updated`.
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given package 2 priced 500 INR, When the admin changes price to 600, Then `price_minor=60000` and the list shows the new price.
  - Given a slug already used by another package, Then validation fails.
  - Given an unknown id, Then 404.
- **Source refs:** app/Http/Controllers/Admin/AdminCreditPackagesController.php; resources/views/admin/credit-packages/edit.blade.php; resources/views/admin/credit-packages/_form.blade.php.
- **Port notes:** As TW-CPN-010; add an optimistic-lock version column.

### TW-CPN-012 — Toggle credit package

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CPN-009
- **Summary:** Enable or disable a bundle from the list; disabled bundles disappear from user-facing lists and cannot be checked out, but past purchases are untouched.
- **Actors & access:** Platform admin; demo mode blocks POST.
- **UX & screens:** Enable/Disable text button in the row; redirect to list with flash "Package activated." or "Package deactivated."
- **Endpoints:**

| Endpoint                               | Route name                   | Handler                                    | Middleware                                   | Request | Response          |
| -------------------------------------- | ---------------------------- | ------------------------------------------ | -------------------------------------------- | ------- | ----------------- |
| POST admin/credit-packages/{id}/toggle | admin.credit-packages.toggle | Admin\AdminCreditPackagesController@toggle | Authenticate, EnsureUserIsAdmin, IPAllowlist | id      | Redirect to index |

- **Data:** flips `credit_packages.is_active`.
- **Rules & edge cases:** 1. A disabled package makes `creditProcess` return 404 and `WalletService::topupViaPackage` throw "not active" (so an order created while active but paid after disabling cannot be credited; see TW-CPN-016). 2. Audit `creditpackage.updated`.
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active package, When toggled, Then it is disabled and no longer returned by the active scope.
  - Given a disabled package, When toggled, Then flash says "Package activated."
- **Source refs:** app/Http/Controllers/Admin/AdminCreditPackagesController.php; app/Models/CreditPackage.php.
- **Port notes:** Use an explicit set-active endpoint.

### TW-CPN-013 — Delete credit package

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CPN-009
- **Summary:** Hard-deletes a bundle after confirmation; ledger rows and orders keep their own copies of price and credits.
- **Actors & access:** Platform admin; demo mode blocks every DELETE.
- **UX & screens:** danger confirm "Delete credit package"; success flash "Credit package deleted."
- **Endpoints:**

| Endpoint                          | Route name                    | Handler                                     | Middleware                                   | Request | Response          |
| --------------------------------- | ----------------------------- | ------------------------------------------- | -------------------------------------------- | ------- | ----------------- |
| DELETE admin/credit-packages/{id} | admin.credit-packages.destroy | Admin\AdminCreditPackagesController@destroy | Authenticate, EnsureUserIsAdmin, IPAllowlist | id      | Redirect to index |

- **Data:** deletes the `credit_packages` row. `orders.credit_package_id` is indexed but has no FK (dangling id remains). `wallet_transactions.subject_type/subject_id` still point at the deleted class/id. An order that is still pending when its package is deleted can no longer be credited (fulfilment does `find()` and silently skips when null, see TW-CPN-016).
- **Rules & edge cases:** docs advise disabling instead of deleting to keep names on record. Audit `creditpackage.deleted`.
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a package with past purchases, When deleted, Then those wallet ledger rows remain and still show their description.
  - Given a missing id, Then 404.
- **Source refs:** app/Http/Controllers/Admin/AdminCreditPackagesController.php; app/Models/WalletTransaction.php.
- **Port notes:** Prefer archive (soft delete) so pending orders can still be fulfilled and history stays joinable.

### TW-CPN-014 — Credit bundle discovery for users (wallet tab, register step 3)

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CPN-010
- **Summary:** Active bundles are loaded for the account wallet tab and the register step-3 page, but the wallet bundle grid is hard-disabled in the view and the register link now lands on the any-amount top-up. Only the register step 3 "Top up message credits" link remains visible.
- **Actors & access:** Authenticated users (workspace owners) on `/account?tab=wallet` and `/register/plan`.
- **UX & screens:** `resources/views/user/account/index.blade.php` contains a "Top up credits" bundle grid (featured card highlighted with a mint border, badge pill floating on top, price display, "N credits", description, CTA "Get N credits" linking to `user.checkout.credits.show`) wrapped in a condition that is literally false, so it never renders (comment says hidden in the money-wallet model). `resources/views/auth/register/_step3_form.blade.php` shows "Need extra sends past your allowance? Top up message credits" linking to the first active bundle's credit checkout URL, or to `/account?tab=wallet` when no bundle exists. The admin sidebar computes the `credit_packages` total into a variable but renders no entry that uses it (dead code).
- **Endpoints:** covered by TW-CPN-015 (redirect target). The page routes (`GET account`, `GET register/plan`) belong to other domains and are not claimed here.
- **Data:** reads `credit_packages` (`active()` = `is_active = 1`, `ordered()` = `sort_order, id`).
- **Rules & edge cases:** 1. `AccountController@index` and `AuthController@showPlanStep` still query the packages even though the grid is off (dead work). 2. QUIRK: docs and the admin index copy still say bundles appear on the wallet and in checkout; that is no longer true. 3. The register link's package slug is only used to seed the amount in the wallet top-up.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active bundle, When a user opens the wallet tab, Then no bundle grid appears (parity with v1.7.0).
  - Given at least one active bundle, When a new user reaches register step 3, Then the "Top up message credits" link points to that bundle's checkout URL which redirects to the wallet top-up with the amount prefilled.
  - Given no active bundle, Then that link points to `/account?tab=wallet`.
- **Source refs:** app/Http/Controllers/AccountController.php; app/Http/Controllers/AuthController.php; resources/views/user/account/index.blade.php; resources/views/auth/register/_step3_form.blade.php; resources/views/components/admin/sidebar.blade.php.
- **Port notes:** Decide with product whether bundles come back; if not, skip entirely. If yes, render bundles inside the wallet top-up flow (WALLET domain).

### TW-CPN-015 — Credit-package checkout routes (redirect to wallet top-up, legacy gateway process)

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-CPN-010
- **Summary:** `GET /checkout/credits/{slug}` no longer shows a bundle checkout: it redirects to `/checkout/wallet` (any-amount top-up), seeding `?amount=` with the bundle's price in whole units. `POST /checkout/credits/{slug}` still creates a real gateway order for the bundle and is reachable by a crafted request.
- **Actors & access:** Authenticated user (route middleware `Authenticate`; no workspace-role gate, no plan gate). The POST requires an active package and a current workspace ("No workspace context." error otherwise).
- **UX & screens:** no UI posts to the POST route in v1.7.0 (the shared checkout view is only re-pointed at it in unreachable code after the redirect). The unreachable code documents the intended UI: shared `checkout.show` with item name = package name, sub = "N message credits", coupon disabled, one-time only (no auto-renew), change link to the wallet tab.
- **Endpoints:**

| Endpoint                     | Route name                    | Handler                          | Middleware   | Request                                                                                                                                                | Response                                                                                                             |
| ---------------------------- | ----------------------------- | -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| GET checkout/credits/{slug}  | user.checkout.credits.show    | CheckoutController@creditShow    | Authenticate | slug matches `[A-Za-z0-9_-]+`                                                                                                                          | 302 to `/checkout/wallet[?amount=<round(price_minor/100)>]` (also when the slug does not exist, then without amount) |
| POST checkout/credits/{slug} | user.checkout.credits.process | CheckoutController@creditProcess | Authenticate | gateway_id (required, exists in payment_gateways), currency (nullable max 10), customer_name/email, billing_company/address/city/postal/country/tax_id | redirect to gateway, inline form, or back with error; 404 for unknown/inactive slug                                  |

- **Data:** `creditProcess` creates an `orders` row: `credit_package_id`, `package_id = NULL`, order currency = requested currency else package currency else workspace currency else USD, amount = `price_minor/100` converted from package currency into order currency (`FormatSettings::convert`), tax from `checkout.tax_enabled` and `checkout.tax_rate` applied on top, `base_amount_usd`, `status pending`. No coupon fields.
- **Rules & edge cases:**
  1. The selected gateway must be active and accept the currency (`acceptsCurrency`), else an error flash names the gateway.
  2. Always a one-time charge (never a subscription).
  3. On instant `paid` the order is finalized and the user lands on `/account?tab=wallet` with "Payment received. Credits added to your wallet."; on `failed` the order is marked failed with the reason.
  4. The redirect ignores package currency: a 10 USD bundle becomes `?amount=10` in the workspace currency's top-up form.
  5. The web callback for a credit order also redirects to the wallet tab with the credits message.
- **Async & events:** gateway callback/webhook -> `finalizeOrder` (TW-CPN-016).
- **External systems:** the selected payment gateway driver (`PaymentGatewayManager`), owned by PAYGW.
- **Settings:** `checkout.tax_enabled`, `checkout.tax_rate`.
- **Acceptance criteria:**
  - Given an active bundle `growth` priced 500, When a user opens `/checkout/credits/growth`, Then they are redirected to `/checkout/wallet?amount=500`.
  - Given an unknown slug, Then the redirect goes to `/checkout/wallet` without an amount.
  - Given a POST with a valid gateway for an active bundle, Then a pending order with `credit_package_id` is created and the gateway flow starts.
  - Given a POST for a disabled bundle, Then 404.
- **Source refs:** app/Http/Controllers/CheckoutController.php (creditShow, creditProcess, callback); routes/web.php.
- **Port notes:** In the port implement only the any-amount top-up (WALLET). If bundles return, model them as a top-up preset that pre-fills the top-up amount and grants bonus credits.

### TW-CPN-016 — Credit-package fulfilment into the wallet ledger

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CPN-015
- **Summary:** When a credit-package order is confirmed paid, the buyer's wallet is credited with the bundle's fixed credit count and the paid money is recorded as a currency-kind ledger row, in one transaction.
- **Actors & access:** System (gateway callback, webhook, mobile confirm, admin manual approval) acting for the order's user.
- **UX & screens:** buyer sees a flash "Payment received. Credits added to your wallet." on the wallet tab.
- **Endpoints:** none owned (fulfilment inside `CheckoutController::finalizeOrder`).
- **Data:** `WalletService::topupViaPackage(user, package, paymentRef)`: locks the user row, then in one transaction (a) `wallet_currency_minor += package.price_minor`, (b) `wallet_credits += package.credits`, (c) sets `wallet_currency_code` to the package currency only if the user has none, (d) inserts a `wallet_transactions` row kind `currency`, type `topup`, source `package.purchase`, subject = this package, description "Top-up - <name> (<credits> credits)", meta with slug, currency, payment reference; (e) inserts a `credit` earn row (amount = credits, `balance_after`) with the same source, meta including price_minor and the currency-tx id. It throws if the package is inactive.
- **Rules & edge cases:**
  1. `finalizeOrder` is idempotent (already-paid orders return immediately).
  2. The order stores no snapshot of credits/price: fulfilment re-reads the package at payment time, so an admin price/credit change between checkout and payment changes what is granted; a deleted package silently grants nothing; a disabled package makes `topupViaPackage` throw inside the finalize transaction which rolls the whole finalization back (order stays pending/paid inconsistently depending on the caller). Treat as open issue.
  3. The credit granted is the bundle's fixed count, not the `credits_per_currency_minor` conversion.
  4. Referral payout is attempted after commit for the buyer (TW-CPN-033); a bundle purchase counts as a "first paid order".
- **Async & events:** none queued; ledger rows are the audit trail.
- **External systems:** none.
- **Settings:** none (bundle-defined).
- **Acceptance criteria:**
  - Given a paid order for the Starter bundle (price 100 INR, 5000 credits), Then the buyer's `wallet_credits` increases by 5000, `wallet_currency_minor` by 10000, and two ledger rows exist (currency topup, credit earn).
  - Given the same order finalized twice, Then only one set of ledger rows exists.
  - Given the package was disabled before payment, Then no credits are granted and the failure is logged (Reference rolls back; port should snapshot instead).
- **Source refs:** app/Services/WalletService.php; app/Http/Controllers/CheckoutController.php; app/Models/WalletTransaction.php.
- **Port notes:** Wallet ledger lives in WALLET; this domain only supplies the package snapshot. Snapshot `credits` and `price` on the order at creation.

### TW-CPN-017 — Legacy self-confirm credit checkout (/checkout, /checkout/complete)

- **Status:** implemented
- **Priority:** P2 (do NOT port as-is)
- **Effort:** S
- **Depends on:** TW-CPN-016
- **Summary:** An older top-up page `GET /checkout?package=<slug>` and its `POST /checkout/complete` that credits the wallet immediately with no payment. Both routes are registered OUTSIDE the authenticated route group.
- **Actors & access:** Route middleware list is empty (public). `index` reads `auth()->user()` softly; `complete` uses `Auth::user()` and passes it to the wallet service.
- **UX & screens:** `resources/views/checkout/index.blade.php` (page key `checkout-index`, JS `charts/checkout-index.js` is not claimed here): stepper "Choose plan, Checkout, Confirmation", account/billing form fields, order summary with the resolved package (by `?package=` slug if active, else the first active bundle by sort order, else "No package selected" with a link to the wallet tab), tax line from the admin checkout tax settings, and a hidden-field form `POST /checkout/complete` with `package_slug` whose button reads "Pay X - add N credits". `checkout.success` and `checkout.failed` pages exist but belong to CHK.
- **Endpoints:**

| Endpoint               | Route name        | Handler                          | Middleware | Request                                                         | Response                                                                       |
| ---------------------- | ----------------- | -------------------------------- | ---------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| GET checkout           | checkout.index    | CheckoutPagesController@index    | (none)     | `package` slug query                                            | HTML                                                                           |
| POST checkout/complete | checkout.complete | CheckoutPagesController@complete | (none)     | package_slug (required, max 96), payment_ref (nullable max 191) | redirect to `checkout.success` with flash "Top-up complete - N credits added." |

- **Data:** `complete` resolves an ACTIVE package by slug (404 otherwise) and calls `WalletService::topupViaPackage` for the current user with the client-supplied `payment_ref` as a free-text reference.
- **Rules & edge cases:**
  1. QUIRK / SECURITY DEFECT: any logged-in user can POST `/checkout/complete` with a bundle slug and receive the bundle's credits and currency balance for free (no gateway, no signature check). A guest hits a type error (500) because `Auth::user()` is null. The route comment states the "self-confirm" path was meant to be replaced by a PSP but the route was not removed; `creditProcess` (TW-CPN-015) was built as the real replacement.
  2. Nothing links to `/checkout` in the current UI except the admin empty-state hint and `checkout.failed`'s retry button.
  3. `success`/`failed` pages show the user's latest paid or failed/pending/cancelled order and belong to CHK.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `checkout.tax_*`, `pricing.refund_*` displayed in the page text.
- **Acceptance criteria:**
  - Given the port, When a user calls any equivalent "complete top-up" endpoint without a verified provider payment, Then it MUST be rejected (parity with Reference is explicitly NOT desired).
  - Given Reference 1.7.0, When an authenticated user posts an active slug, Then credits are added and they are redirected to the success page (documented defect).
- **Source refs:** app/Http/Controllers/CheckoutPagesController.php; resources/views/checkout/index.blade.php; routes/web.php; app/Services/WalletService.php.
- **Port notes:** Do not port. If a "checkout summary" page is wanted, make it read-only and require the real payment flow. Record as a security finding for the parity tracker (wontfix / do-not-port).

### TW-CPN-018 — Admin currency catalog list

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** The admin lists the currency catalog (12 per page, code ascending) with KPI cards, a search box, the current platform default flagged with a badge, and the actions for adding, toggling, deleting, refreshing rates and choosing the default.
- **Actors & access:** Platform admin; middleware authenticated + admin + IP allow-list; demo mode blocks writes to `admin/currencies*`. No permission key.
- **UX & screens:** `resources/views/admin/currencies/index.blade.php` (page key `admin-currencies-index`). Header "Platform currencies", breadcrumb "Admin - System - Localization". Buttons "Fetch live rates" and "Add currency" (toggles the add form). Flash `success` and `error` banners. KPI cards: Total, Active, System default (uppercase code), Inactive. "System default" card with a select of ALL active currencies (label "CODE - name (symbol)", current default preselected) and "Set default". Add-currency form hidden by default. Catalog table columns: Code (+ "Default" badge on the default row), Name, Symbol, Rate (`1 USD -> x`, 4 decimals), Decimals, Active (On/Off pill button submitting the toggle form), row action Delete (hidden for the default currency; confirm "Delete CODE? Any prices saved in this currency will become orphaned."). Search form `q` matches code, name or symbol substring. Empty state: `No matches for "q".` or "No currencies yet." Pagination links under the table.
- **Endpoints:**

| Endpoint             | Route name             | Handler                        | Middleware                                   | Request           | Response |
| -------------------- | ---------------------- | ------------------------------ | -------------------------------------------- | ----------------- | -------- |
| GET admin/currencies | admin.currencies.index | Admin\CurrencyController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | query `q`, `page` | HTML     |

- **Data:** reads `currencies` ordered by code, paginated 12 with query string preserved; KPI counts are global; default code = `strtoupper(system_settings.default_currency, fallback "USD")`.
- **Rules & edge cases:** 1. The default selector lists only active currencies. 2. QUIRK: there is no edit UI for a row (name, symbol, precision and rate can only be changed by Fetch live rates); see TW-CPN-020. 3. If `default_currency` was corrupted (see TW-CPN-024) the "Default" badge appears on no row. 4. The docs page claims editing exists ("same fields apply when editing an existing row"), the code does not offer it.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `default_currency` (system setting).
- **Acceptance criteria:**
  - Given 30 seeded currencies, When the admin opens the page, Then 12 rows show in code order, KPIs read Total 30 / Active 30 / default USD / Inactive 0 and USD carries the Default badge.
  - Given a search for `rup`, Then Indian Rupee, Indonesian Rupiah and Pakistani Rupee are listed.
  - Given the default currency row, Then no Delete button is shown for it.
- **Source refs:** app/Http/Controllers/Admin/CurrencyController.php; app/Models/Currency.php; resources/views/admin/currencies/index.blade.php; Documentation/pages/admin-panel/localization.html.
- **Port notes:** Home `apps/api/src/modules/admin/currencies` or a `platform-settings` module (SET). Global table, no RLS.

### TW-CPN-019 — Add currency

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-018
- **Summary:** The admin adds a currency with name, ISO code, symbol, decimals, exchange rate against USD and an active flag.
- **Actors & access:** Platform admin; same middleware; demo mode blocks POST.
- **UX & screens:** collapsible form in the index page: Name (required, max 120), ISO code (required, max 10, uppercase styling), Symbol (max 20, optional), Decimals (required 0-6, default 2), Exchange rate "1 USD = ?" (required, step 0.000001, min 0.000001, default 1), "Active immediately" checkbox (checked). Success flash "Currency added."
- **Endpoints:**

| Endpoint              | Route name             | Handler                        | Middleware                                   | Request                                                 | Response          |
| --------------------- | ---------------------- | ------------------------------ | -------------------------------------------- | ------------------------------------------------------- | ----------------- |
| POST admin/currencies | admin.currencies.store | Admin\CurrencyController@store | Authenticate, EnsureUserIsAdmin, IPAllowlist | name, code, symbol, precision, exchange_rate, is_active | back() with flash |

- **Data:** inserts `currencies`. Validation: `name` required string max 120; `code` required string max 10 unique in `currencies.code`; `symbol` nullable string max 20; `precision` required integer 0..6; `exchange_rate` required numeric min 0.000001; `is_active` nullable boolean (defaults true when absent on create). The model mutator trims and uppercases `code` before saving. Column `exchange_rate` is `decimal(16,6)`.
- **Rules & edge cases:** 1. Uniqueness is validated on the raw input (before uppercase), but MySQL collation makes `usd` collide with `USD` at the DB level (500 rather than a validation error in that race). 2. No ISO-4217 format check (any 10 chars). 3. After creating, the format cache is flushed. 4. Audit action `admin.currency.created` with meta code and rate.
- **Async & events:** audit log entry (explicit `Audit::log`).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given name "Swiss Franc", code `chf`, precision 2, rate 0.88, When submitted, Then a currency `CHF` exists, active, and the flash says "Currency added."
  - Given an existing `USD`, When adding `USD`, Then validation fails.
  - Given rate 0, Then validation fails.
- **Source refs:** app/Http/Controllers/Admin/CurrencyController.php; app/Models/Currency.php; app/Support/FormatSettings.php.
- **Port notes:** Enforce `^[A-Z]{3}$` (or allow crypto up to 10 if product wants) and case-insensitive uniqueness.

### TW-CPN-020 — Update currency (route only, no UI)

- **Status:** partial
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-018
- **Summary:** A PATCH endpoint that updates all fields of a currency exists and is audited, but no screen in v1.7.0 calls it. The docs describe editing as if it were available.
- **Actors & access:** Platform admin; same middleware; demo mode blocks PATCH.
- **UX & screens:** none (missing edit affordance). The port should add an inline edit for name, symbol, decimals, rate and active.
- **Endpoints:**

| Endpoint                    | Route name              | Handler                         | Middleware                                   | Request                                                 | Response                              |
| --------------------------- | ----------------------- | ------------------------------- | -------------------------------------------- | ------------------------------------------------------- | ------------------------------------- |
| PATCH admin/currencies/{id} | admin.currencies.update | Admin\CurrencyController@update | Authenticate, EnsureUserIsAdmin, IPAllowlist | name, code, symbol, precision, exchange_rate, is_active | back() with flash "Currency updated." |

- **Data:** same validation as create; `code` uniqueness ignores the row; `is_active` defaults to false when absent (so a request that omits the flag deactivates the currency).
- **Rules & edge cases:** 1. Changing a code orphans everything that stored the old code (workspaces, packages, deals, orders). No cascade. 2. The default currency's code can be changed here without updating `default_currency` (breaks the default). 3. Format cache flushed; audit `admin.currency.updated` with before/after of code, rate and is_active.
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given currency 5, When PATCH with a new rate 84.1, Then the rate is stored and the audit meta contains before/after rate.
  - Given a PATCH without `is_active`, Then the currency becomes inactive.
  - Given a code that another row uses, Then validation fails.
- **Source refs:** app/Http/Controllers/Admin/CurrencyController.php; Documentation/pages/admin-panel/localization.html.
- **Port notes:** Forbid changing `code` once used (or make code immutable) and block deactivating the default currency.

### TW-CPN-021 — Toggle currency active

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-018
- **Summary:** Turn a currency On/Off from the list. Inactive currencies vanish from every currency picker.
- **Actors & access:** Platform admin; demo mode blocks POST.
- **UX & screens:** the On/Off pill in the Active column; flash "Activated." or "Deactivated."
- **Endpoints:**

| Endpoint                          | Route name              | Handler                         | Middleware                                   | Request | Response          |
| --------------------------------- | ----------------------- | ------------------------------- | -------------------------------------------- | ------- | ----------------- |
| POST admin/currencies/{id}/toggle | admin.currencies.toggle | Admin\CurrencyController@toggle | Authenticate, EnsureUserIsAdmin, IPAllowlist | id      | back() with flash |

- **Data:** flips `currencies.is_active`; flushes the format cache; audit `admin.currency.activated` / `admin.currency.deactivated`.
- **Rules & edge cases:**
  1. Toggling the current DEFAULT currency off is allowed. It stays default in settings but disappears from the default selector, and `FormatSettings::convert` then treats its rate as 1.0 (rates map only includes active currencies), silently corrupting conversions. The port must forbid it.
  2. Inactive currencies are hidden from: workspace settings currency select, checkout currency dropdown, plan and add-on forms, coupon and credit-package selectors, admin general settings, mobile payment-gateway list, mobile billing currency lookup fallback.
  3. Existing data priced in an inactive currency keeps rendering with its symbol (`Currency::symbolFor` reads all rows), but conversion into or out of it uses rate 1.0 (see TW-CPN-026).
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given an active currency, When toggled, Then it no longer appears in the plan form currency select.
  - Given the default currency, When toggled off, Then (Reference) it is allowed; (port) it must be refused with an explanatory error.
- **Source refs:** app/Http/Controllers/Admin/CurrencyController.php; app/Support/FormatSettings.php.
- **Port notes:** Idempotent set-active endpoint; validation "cannot deactivate default".

### TW-CPN-022 — Delete currency (blocked for default)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-018
- **Summary:** Hard-deletes a currency unless it is the current platform default.
- **Actors & access:** Platform admin; demo mode blocks every DELETE.
- **UX & screens:** Delete button (not rendered for the default row) with a danger confirm; on the default row a direct request returns flash error "Cannot delete the system default currency. Change the default first."; success "Currency removed."
- **Endpoints:**

| Endpoint                     | Route name               | Handler                          | Middleware                                   | Request | Response          |
| ---------------------------- | ------------------------ | -------------------------------- | -------------------------------------------- | ------- | ----------------- |
| DELETE admin/currencies/{id} | admin.currencies.destroy | Admin\CurrencyController@destroy | Authenticate, EnsureUserIsAdmin, IPAllowlist | id      | back() with flash |

- **Data:** deletes the `currencies` row. Comparison is `strtoupper(row.code) == strtoupper(default_currency)`. No usage check: workspaces, plans, coupons, packages, deals, invoices that reference the code are left dangling ("orphaned"), and money in that currency then renders as a bare number with two decimals and no symbol.
- **Rules & edge cases:** audit `admin.currency.deleted` (with id, code, name snapshot) or `admin.currency.delete_blocked` (result failure, reason `is_system_default`); format cache flushed.
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** `default_currency`.
- **Acceptance criteria:**
  - Given the default USD, When a DELETE is sent for it, Then it is rejected with the error flash and a failure audit row.
  - Given a non-default unused currency, When deleted, Then it is gone and the list shows "Currency removed."
  - Given a workspace whose currency was deleted, Then its money displays without a symbol (parity) - the port should block deletion when in use.
- **Source refs:** app/Http/Controllers/Admin/CurrencyController.php; app/Support/Audit.php.
- **Port notes:** Add an "in use" guard (workspaces, plans, gateways, deals) and prefer deactivate.

### TW-CPN-023 — Fetch live exchange rates

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CPN-018
- **Summary:** One button pulls the current USD-based rates from a free public API and bulk-updates every catalog currency whose code appears in the response.
- **Actors & access:** Platform admin; demo mode blocks POST. No throttle.
- **UX & screens:** "Fetch live rates" button on the currency page; results as flash: "Updated N currencies from open.er-api.com." or an error ("Rate provider returned HTTP X", "Rate provider returned no rates.", "Fetch failed: <message>").
- **Endpoints:**

| Endpoint                          | Route name                   | Handler                             | Middleware                                   | Request | Response          |
| --------------------------------- | ---------------------------- | ----------------------------------- | -------------------------------------------- | ------- | ----------------- |
| POST admin/currencies/fetch-rates | admin.currencies.fetch-rates | Admin\CurrencyController@fetchRates | Authenticate, EnsureUserIsAdmin, IPAllowlist | none    | back() with flash |

- **Data:** for each row in `currencies` (active or not) whose uppercase code exists in the provider's `rates` map, sets `exchange_rate` to the float rate (updates `updated_at`). Currencies missing from the response are left untouched. USD's own rate from the API is 1 so USD stays at 1.
- **Rules & edge cases:** 1. HTTP timeout 12 seconds; non-2xx aborts with the status in the message; empty/invalid `rates` aborts; any exception is caught and reported. 2. Existing rates are untouched on failure. 3. Rates are stored with 6-decimal precision. 4. No history of past rates. 5. Not scheduled: there is no cron/command that refreshes rates automatically (docs advertise only the button). 6. Cache flush after success. 7. Audit `admin.currency.rates_fetched` (provider, updated count) or `admin.currency.rates_fetch_failed` with the error text.
- **Async & events:** audit log. No queue.
- **External systems:** GET `https://open.er-api.com/v6/latest/USD`, no API key, no auth, free tier rate limit unknown (open question); failure surfaced to the admin.
- **Settings:** none (provider URL hard-coded).
- **Acceptance criteria:**
  - Given the provider returns rates for 25 of 30 catalog currencies, When the admin clicks the button, Then 25 rows are updated and the flash reads "Updated 25 currencies from open.er-api.com."
  - Given the provider returns HTTP 500, Then no rate changes and the flash shows the HTTP status.
  - Given the provider times out, Then the error flash contains "Fetch failed" and an audit failure row is written.
- **Source refs:** app/Http/Controllers/Admin/CurrencyController.php; Documentation/pages/admin-panel/localization.html.
- **Port notes:** Implement as a provider adapter (`FxRateProvider` port) called from a worker job, optionally on a daily schedule, with a manual "refresh now" button; store a rate-history table for audit; do not hard-code the vendor URL.

### TW-CPN-024 — Set platform default currency

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-CPN-018
- **Summary:** The admin chooses the single platform-wide fallback currency used for display when a workspace has no currency of its own and for new workspaces created by the admin tools.
- **Actors & access:** Platform admin; demo mode blocks POST.
- **UX & screens:** "System default" card select + "Set default" button; flash "Default currency set to XXX."
- **Endpoints:**

| Endpoint                      | Route name               | Handler                             | Middleware                                   | Request                                                         | Response          |
| ----------------------------- | ------------------------ | ----------------------------------- | -------------------------------------------- | --------------------------------------------------------------- | ----------------- |
| POST admin/currencies/default | admin.currencies.default | Admin\CurrencyController@setDefault | Authenticate, EnsureUserIsAdmin, IPAllowlist | code (required, string max 10, must exist in `currencies.code`) | back() with flash |

- **Data:** writes `system_settings.default_currency` (uppercased) and flushes the format cache; audit `admin.currency.default_changed` (previous, now).
- **Rules & edge cases:**
  1. QUIRK / probable DEFECT (static analysis, verify with the parity tool): the controller calls the settings setter without a type argument, and the setter's default type is `int`. The setter overwrites the row's `type` to `int`; on read the value is cast to int, so "INR" becomes 0 and `strtoupper((string) 0)` yields "0". Effects: the index page shows no default badge, `FormatSettings::currencyFor` finds no currency, money renders as a bare 2-decimal number, and delete-protection for the default silently stops working. The other writer of the same key (admin general settings) sets type `string` correctly and would repair it. The port must store text.
  2. The chosen currency need not be active (validation only checks existence); an inactive default breaks conversion (see TW-CPN-021).
  3. The same setting is editable in admin general settings (`default_currency`, `max:8`, no existence check, no cache flush, no audit): two writers with different validation. The port should have one writer.
  4. `system_settings` reads are cached 30 minutes by the settings service; the admin write clears the format caches but relies on the settings service for its own cache invalidation.
  5. Existing workspaces that already have a `currency` are unaffected; those with null currency switch display currency immediately.
- **Async & events:** audit log.
- **External systems:** none.
- **Settings:** `default_currency` (default "USD" when unset).
- **Acceptance criteria:**
  - Given INR is active, When the admin sets it as default, Then `default_currency` reads back as text `INR`, the list shows the Default badge on INR, and a workspace without currency now displays amounts in rupees.
  - Given a code that does not exist, Then validation fails.
  - Given the default changes, Then an audit row records previous and new.
- **Source refs:** app/Http/Controllers/Admin/CurrencyController.php; app/Models/SystemSetting.php; app/Http/Controllers/AdminPagesController.php; app/Support/FormatSettings.php.
- **Port notes:** Model `default_currency` as a typed platform setting (string) in SET; validate that the currency exists and is active; invalidate caches through the settings service, not ad hoc.

### TW-CPN-025 — Seed 30 starter currencies at install

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-019
- **Summary:** The web installer runs `CurrencySeeder`, which upserts 30 common currencies (USD base 1.0) with symbols, decimals and static exchange rates, all active. The local reference DB shows the table empty (seeder not run there), so this is documented from code.
- **Actors & access:** System at install time (INST domain).
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** upsert by `code`. Set (code, name, symbol, decimals, rate per 1 USD): USD US Dollar $ 2 1.0; EUR 2 0.92; GBP 2 0.79; INR 2 83.25; AED 2 3.673 (Arabic-script symbol); SAR 2 3.75; CAD CA$ 1.36; AUD A$ 1.53; JPY 0 149; CNY 2 7.25; HKD HK$ 7.82; SGD S$ 1.35; MYR RM 4.70; IDR Rp 0 15700; THB 2 36.2; PHP 2 56.5; VND 0 24500; KRW 0 1350; TRY 2 32.5; EGP E-pound 2 47.5; ZAR R 18.5; NGN 2 1600; KES KSh 129; BRL R$ 5.10; MXN MX$ 17.3; ARS AR$ 950; CLP CLP$ 0 920; COP CO$ 0 4000; PKR 2 278; BDT 2 110. All rows `is_active = true`; re-running the seeder overwrites name, symbol, decimals, rate and reactivates them.
- **Rules & edge cases:** 1. Symbols are written as unicode escapes so the file stays ASCII; the port should store proper UTF-8. 2. The installer step order: roles, packages, currencies, payment gateways, translation providers, checkout defaults (which creates two demo coupons), guidebook, legal pages. 3. `default_currency` is not seeded here (falls back to USD via the reader default). 4. Re-running the seeder resets admin-edited rates (open question about idempotence intent).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** creates none.
- **Acceptance criteria:**
  - Given a fresh install, When the seeder runs, Then 30 active currencies exist with USD rate exactly 1.
  - Given the seeder is run again, Then no duplicate codes are created.
  - Given JPY, Then precision is 0.
- **Source refs:** database/seeders/CurrencySeeder.php; app/Http/Controllers/InstallController.php.
- **Port notes:** Provide as a seed migration or seed script; use `ON CONFLICT DO NOTHING` so re-seeding never overwrites admin edits.

### TW-CPN-026 — Currency conversion and display engine (FormatSettings, Currency::symbolFor)

- **Status:** implemented
- **Priority:** P0 (every money display and every cross-currency price uses it)
- **Effort:** M
- **Depends on:** TW-CPN-018
- **Summary:** `App\Support\FormatSettings` and `Currency::symbolFor` are the single authority for turning an amount plus a currency code into text and for converting between currencies using the stored USD-based rates. 76 files (controllers, models, views) call it.
- **Actors & access:** Internal helper used by every screen, API and email that shows money.
- **UX & screens:** no screen. Observable output: symbol + grouped number with the currency's decimals, e.g. rupee symbol + "16,732.50"; when a currency has no symbol the code plus a space is used.
- **Endpoints:** none.
- **Data:** reads `currencies` (`code`, `symbol`, `precision`, `exchange_rate`, `is_active`), `workspaces.currency`, `system_settings.default_currency`.
- **Rules & edge cases:**
  1. `currencyFor(workspace?)`: when no workspace is passed and a user is logged in, use that user's current workspace; target code = workspace currency if set, else `default_currency` (fallback USD); returns the catalog row (cached 60 s per code) or null if the code is not in the catalog.
  2. `currency(amount, ws?)`: no target currency -> plain number with 2 decimals; else `number_format(amount, precision, '.', ',')` prefixed by the symbol (or `CODE ` when the symbol is empty).
  3. `display(amount, fromCode?, ws?)`: converts from `fromCode` into the target when different, else formats as is; the canonical "show money stored in currency X in the viewer's currency" call.
  4. `formatIn(amount, code)`: formats strictly in that currency, no conversion (invoices, receipts, historical documents); unknown or missing code -> plain 2-decimal number.
  5. `convert(amount, from, to)`: same code -> unchanged; otherwise `amount / rate(from) * rate(to)` rounded to 2 decimals. Rates come from ACTIVE currencies only (cached 60 s). QUIRK: a code that is inactive or missing from the map is silently treated as rate 1.0 (USD parity); a from-rate <= 0 returns the amount unchanged. Rounding to 2 decimals happens even for 0-decimal targets.
  6. `symbol(ws?)` returns the target symbol (or `CODE `; `$` when nothing is configured); `symbolFor(code)` returns the symbol or the bare code (no trailing space) or empty for null.
  7. `Currency::symbolFor(code)` (used by deals, payments, sales docs, AI CRM toolkit, reports): symbol map cached 5 minutes, fallback `CODE ` with a trailing space; empty string for empty input.
  8. Cache invalidation `flushCache()` clears the rates map and the per-code entries for currencies currently in the table; it does NOT clear the 5-minute symbol map, so an edited symbol can be stale for up to 5 minutes, and a deleted currency's per-code entry can linger up to 60 s.
  9. No locale-aware formatting: decimal point `.` and thousands `,` always.
  10. `exchange_rate` semantics = units of the currency per 1 USD (the model's docblock says the opposite; the UI and the math are authoritative).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `default_currency`; per-workspace currency column.
- **Acceptance criteria:**
  - Given USD rate 1 and INR rate 83.25, When `convert(100, USD, INR)`, Then 8325.00.
  - Given INR precision 2 and symbol rupee, When `currency(16732.5)` for an INR workspace, Then "rupee 16,732.50".
  - Given JPY precision 0, When `currency(1500.4)` for a JPY workspace, Then "yen 1,500".
  - Given the source currency was deactivated, When `convert(100, THB, USD)`, Then the result is 100 (rate treated as 1) - documented parity gap; the port should raise or use the last known rate.
  - Given no currency catalog and no workspace currency, Then amounts render as plain 2-decimal numbers.
- **Source refs:** app/Support/FormatSettings.php; app/Models/Currency.php; app/Models/Deal.php; app/Models/Payment.php; app/Models/SalesDoc.php; app/Http/Controllers/CheckoutController.php; app/Http/Controllers/PricingController.php.
- **Port notes:** Implement as a `CurrencyService` in `packages/` shared lib (pure functions taking a rate table) plus a cached loader. Use `Intl.NumberFormat` with the currency's own exponent, `bigint`/decimal math rather than floats, and fail loudly on missing rates. Keep per-request memoization instead of Laravel cache keys.

### TW-CPN-027 — Workspace display currency resolution and selection

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-026
- **Summary:** Each workspace has an optional currency that drives price display, the base currency of checkout and the currency of its wallet UI; when null the platform default applies. The workspace owner picks it in Settings; admins can set it in the workspace admin screens.
- **Actors & access:** Workspace owner (the settings form is disabled for non-owners; a non-owner submit is silently ignored with a message "Only the workspace owner can edit these."). Platform admin through admin workspace create/edit (free text max 8). No permission key; not plan gated.
- **UX & screens:** `resources/views/user/settings/index.blade.php` general pane: Currency select of active currencies "CODE - name (symbol)", helper text "Used on plan checkout, invoices, and wallet display". The route `POST settings` (`user.settings.update`, `UserPagesController@settingsUpdate`) also saves workspace name and timezone and belongs to the workspace domain; it is referenced here only for the currency contract.
- **Endpoints:** none claimed (see Cross-domain contracts).
- **Data:** column `workspaces.currency` varchar(10) nullable (no default); validation on the settings route: nullable string max 10 and must exist in `currencies.code` (inactive currencies are accepted by the validator even though the dropdown hides them); stored uppercase; the format cache is flushed on save. Admin workspace forms accept any string up to 8 chars without catalog validation.
- **Rules & edge cases:**
  1. Signup-created workspaces are NOT stamped with a currency (null), so they follow the platform default and change when the admin changes it; admin-provisioned workspaces are stamped with `default_currency` at creation and never follow later default changes.
  2. Checkout base currency = workspace currency, else package currency, else USD; the buyer can override the currency on the checkout page from the list of active catalog currencies that at least one active gateway accepts.
  3. Lifetime spend on the account page converts each paid order into the current workspace currency.
  4. Changing the workspace currency does not convert historical data; documents keep their own currency.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `default_currency`.
- **Acceptance criteria:**
  - Given a workspace with currency null and platform default USD, Then money renders with the dollar symbol; When the admin sets the default to INR, Then it renders in rupees with no workspace change.
  - Given an owner selects EUR, Then `workspaces.currency = EUR` and the next page shows euro amounts.
  - Given a non-owner submits the form, Then nothing changes and the message says only the owner can edit.
  - Given a code not in the catalog, Then validation fails.
- **Source refs:** app/Http/Controllers/UserPagesController.php (settingsUpdate); resources/views/user/settings/index.blade.php; app/Support/AdminWorkspaceProvisioner.php; app/Http/Controllers/Admin/WorkspacesController.php; app/Support/FormatSettings.php; database/migrations/2026_05_17_020100_add_currency_to_workspaces.php.
- **Port notes:** Column on the workspace (org) settings in WSP; validate against active currencies only; keep the null-follows-default semantics.

### TW-CPN-028 — Minor-unit money helpers (MoneyFormat)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-026
- **Summary:** `App\Support\MoneyFormat` converts between decimal strings and integer minor units using the true ISO-4217 exponent, and provides display helpers for invoices. It is used by the invoice model and the Woo/Shopify/own-store invoice mappers.
- **Actors & access:** Internal helper (INV domain consumer). No route.
- **UX & screens:** none; shows in invoice totals.
- **Endpoints:** none.
- **Data:** none stored; operates on values.
- **Rules & edge cases:**
  1. Exponent 0 for BIF, CLP, DJF, GNF, IDR, ISK, JPY, KMF, KRW, MGA, PYG, RWF, UGX, VND, VUV, XAF, XOF, XPF, HUF, TWD; exponent 3 for BHD, IQD, JOD, KWD, LYD, OMR, TND; every other code is 2 (unknown or empty codes default to 2). QUIRK: this hard-coded list differs from the catalog's `precision` column: the seeded catalog marks CLP, COP, IDR, JPY, KRW and VND as 0-decimal, while this list omits COP and additionally lists HUF and TWD (which the seeder does not create). Two sources of truth for decimals.
  2. `toMinor(decimal, ccy)`: strips everything except digits, dot and minus, casts to float and multiplies by 10^exponent, rounded to an integer (so "1,500.50" and "$19.99" both parse).
  3. `display(minor, ccy)`: delegates to the storefront product formatter (`WaProduct::formatCurrency`), which ALWAYS divides by 100 and uses a small hard-coded symbol table (INR, USD, EUR, GBP, AED, KES, NGN, CRC, BRL, ZAR, PHP, IDR, MXN, SGD, MYR, THB, VND, EGP, PKR, BDT, LKR; other codes print as the code). QUIRK: `toMinor` uses the true exponent but `display` always divides by 100, so a JPY invoice stored as 1500 minor units renders as a magnitude of 15, and a KWD amount of 1.500 (stored 1500) renders as 15. `majorString` is exponent-aware and is used for PDF columns.
  4. `majorString(minor, ccy)`: exponent-aware number with thousands separators and no symbol.
  5. The credit-package `price_minor` and the referral/wallet minor values use x100 regardless of currency (see TW-CPN-010).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given IDR, When `toMinor("15000")`, Then 15000; given KWD "1.500" -> 1500; given USD "19.99" -> 1999.
  - Given `majorString(150000, "IDR")`, Then "150,000".
  - Given `majorString(1500, "KWD")`, Then "1.500".
  - Port acceptance: `display` must use the same exponent as `toMinor` (parity gap intentionally not reproduced).
- **Source refs:** app/Support/MoneyFormat.php; app/Models/WaProduct.php; app/Models/Invoice.php; app/Services/Invoice/Mappers/WooInvoiceMapper.php; app/Services/Invoice/Mappers/ShopifyInvoiceMapper.php; app/Services/Invoice/Mappers/OwnStoreInvoiceMapper.php.
- **Port notes:** Put in the shared money utilities used by INV; drive the exponent from one table (prefer the catalog's `precision`/ISO data) and add golden tests for 0/2/3-decimal currencies.

### TW-CPN-029 — Referral code generation

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** Every user gets a unique referral code automatically on creation: 10 characters from a confusion-free alphabet.
- **Actors & access:** System (user model creating hook); also lazily generated by the mobile affiliate-code endpoint if a legacy user has none.
- **UX & screens:** the code is shown on the account affiliate tab, the affiliate history page and in the layout's JS bootstrap (`referralCode`). Users without a code display "NO-CODE" on the account tab.
- **Endpoints:** none claimed (mobile `GET api/app/affiliate/code` is MOB; it returns the code and link `<app url>/register?ref=<code>` and generates one when empty).
- **Data:** `users.referral_code` varchar(16) nullable UNIQUE, `users.referred_by_user_id` bigint nullable FK to users (on delete set null).
- **Rules & edge cases:**
  1. Alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0, O, 1, I, L); length 10; drawn with a cryptographic random; loop until no existing user has the code.
  2. Generated only when the code is empty at creation; never regenerated or rotated; there is no UI to change it.
  3. The code is the only thing shared; the link format is `/register?ref=<CODE>`.
  4. Existing users created before the migration have null codes until first touched by the mobile endpoint (the migration does not backfill; open question).
  5. A "code" is per USER, not per workspace.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a new user is created without a code, Then `referral_code` is 10 characters from the alphabet and unique.
  - Given a collision on a generated code, Then a new code is drawn.
  - Given a user with an existing code, Then the code never changes.
- **Source refs:** app/Models/User.php; database/migrations/2026_05_07_120000_create_wallet_and_referrals_tables.php; app/Http/Controllers/Api/App/ContentController.php; resources/views/components/layouts/user.blade.php.
- **Port notes:** Store on the identity user (AUTH); unique index; generate with `crypto.randomInt`. Backfill in the migration.
- **Port status (2026-10-06):** built. One code per user in `referral_codes` (unique per user), issued on `auth.signup_completed` and lazily on the first `/v2/me/referral` read (the lazy path is the backfill; no migration guesses codes). QUIRK fixed: none lost.

### TW-CPN-030 — Referral link capture (?ref cookie)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-029
- **Summary:** Any request carrying `?ref=CODE` drops a 30-day cookie so the code survives browsing the marketing site until the visitor registers.
- **Actors & access:** Anonymous or logged-in visitors; middleware runs in the web group after locale, tenant-domain, maintenance and impersonation middleware.
- **UX & screens:** none directly; the registration form pre-fills its optional "Referral code" field from `?ref=`, else the cookie, else old input (uppercased, maxlength 16).
- **Endpoints:** middleware `app/Http/Middleware/CaptureReferral.php` on all web routes.
- **Data:** cookie `threadwise_ref`, value = sanitised code, TTL 30 days (43,200 minutes), HttpOnly, SameSite Lax, Secure when the request is HTTPS.
- **Rules & edge cases:**
  1. Sanitisation: strip every character that is not A-Z or 0-9 (case-insensitive), uppercase, drop silently if empty or longer than 16.
  2. Last-touch wins: a later `?ref=` overwrites the cookie (last-click, not first-touch).
  3. The cookie is set even when the code matches no user; validity is checked only at registration.
  4. The cookie is queued so it rides on any response including JSON.
  5. The cookie is cleared (forgotten) after a successful attribution at registration.
  6. The middleware also captures on authenticated requests; nothing prevents a logged-in user from setting the cookie.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a visit to `/pricing?ref=abcd-1234`, Then a cookie `threadwise_ref=ABCD1234` is set for 30 days with HttpOnly and SameSite=Lax.
  - Given `?ref=` longer than 16 characters after sanitising, Then no cookie is set.
  - Given `?ref=***`, Then no cookie is set.
  - Given a second visit with a different code, Then the cookie value is replaced.
- **Source refs:** app/Http/Middleware/CaptureReferral.php; bootstrap/app.php; resources/views/auth/_register_form.blade.php.
- **Port notes:** Next.js middleware on the marketing/public app sets the cookie (edge-safe) and the API reads it (or accepts it in the register payload). Keep 30 days and last-touch.

### TW-CPN-031 — Referral code at registration (web form, OTP path, mobile API)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CPN-030
- **Summary:** The referral code is collected from the register form field, the cookie, or the mobile `refer_code` parameter and carried through the optional WhatsApp-OTP step until the account exists, then attribution runs (TW-CPN-032).
- **Actors & access:** Anonymous registrants (web) and mobile app registrants. Registration itself belongs to AUTH; this feature is only the referral slice.
- **UX & screens:** `resources/views/auth/_register_form.blade.php` (partial of the register page): optional field "Referral code" (name `ref`, max 16, uppercase, monospace, placeholder inviting a friend's code) prefilled from query/cookie/old input. Validation rule on the web register: `ref` nullable string max 16. When the admin has registration OTP enabled the pending signup (including `ref`) is kept in the session with a hash of the OTP until verified, then finalized.
- **Endpoints:** owned by AUTH: `POST register`, `GET/POST register/verify`, `POST api/app/register`. Not claimed here.
- **Data:** on the account creation path: `ref` input else cookie value -> `ReferralService::findReferrer(code, excludeUserId: newUser.id)` -> if found `attribute(...)` and forget the cookie.
- **Rules & edge cases:**
  1. A code that matches no user is silently ignored; registration never fails because of the referral.
  2. Web: the `ref` form value takes precedence over the cookie; both are uppercased on use; the value is NOT re-sanitised (only trimmed and uppercased by `findReferrer`).
  3. Mobile app registration reads `refer_code` and wraps the whole attribution in a try/catch so nothing can block signup; the cookie logic does not apply and there is no cookie to clear.
  4. QUIRK: social sign-in (Google/Facebook style provider callback) never attributes referrals, so referred users who register via a social provider are lost.
  5. QUIRK: `AuthController::registerAccount` (with its own copy of the attribution block) is not routed; only `AuthPagesController::register` and the finalize step are live.
  6. Attribution happens after the user row is created and before the `Registered` event; the referee is the new user, so self-referral is impossible by construction (a user cannot know their own code before it exists).
- **Async & events:** none directly.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a visitor with cookie `threadwise_ref=ABCDE12345` who registers with an empty form field, Then attribution uses the cookie code and the cookie is cleared.
  - Given the form field holds another user's code and the cookie holds a different one, Then the form field wins.
  - Given an unknown code, Then registration succeeds with no referral row.
  - Given the OTP flow is on, Then the code survives the verify step and attribution happens once the account is created.
  - Given mobile registration with `refer_code`, Then attribution happens; with an invalid code, Then registration still returns 201.
- **Source refs:** app/Http/Controllers/AuthPagesController.php; app/Http/Controllers/AuthController.php; app/Http/Controllers/Api/App/AuthController.php; resources/views/auth/_register_form.blade.php; app/Services/ReferralService.php.
- **Port notes:** Pass the referral code in the sign-up command; also support social sign-up (parity gap worth fixing) by storing the code in the OAuth state.
- **Port status (2026-10-06):** built. Social sign-up now carries the code: the web server adds the `crm_ref` cookie to the social callback and `referralCode` is accepted by `POST /auth/social/:provider/callback` (Reference QUIRK 4 not reproduced). The cookie is not cleared after a social sign-up (the API does not say whether the callback created an account).

### TW-CPN-032 — Referral attribution (one referrer per referee)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-CPN-031
- **Summary:** `ReferralService::findReferrer` resolves a code to a user and `attribute` links the new user to that referrer exactly once, creating an unpaid `referrals` row. No reward is paid at signup.
- **Actors & access:** System at registration.
- **UX & screens:** result visible as a row in the referrer's history (status "No payout" until the referee pays).
- **Endpoints:** none.
- **Data:** `referrals` insert: `referrer_user_id`, `referred_user_id` (UNIQUE), `code_used` (uppercased raw code input), `credits_awarded = 0`, `award_transaction_id = NULL`, `created_at = now`. Also sets `users.referred_by_user_id` on the referee.
- **Rules & edge cases:**
  1. `findReferrer`: trims, uppercases, exact match on `users.referral_code`; empty -> null; optionally excludes a given user id.
  2. `attribute`: returns null when referrer id equals referee id; returns the existing row when the referee is already attributed (idempotent, race-safe through the DB unique key; there is no explicit catch for a unique violation so a concurrent duplicate would throw); otherwise runs in a transaction.
  3. Once attributed there is no re-attribution, edit or admin override path.
  4. `code_used` stores what the visitor typed (uppercased), not the referrer's canonical code; the column is varchar(16).
  5. Referrer accounts that are later deleted cascade-delete their referral rows (FK cascade both ways), and referee deletion removes the row.
  6. The referrer and referee can be in different workspaces; no workspace restriction; suspended or unverified referrers still qualify (no status check).
- **Async & events:** none (no notification to the referrer at signup).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given user B registers with A's code, Then one referrals row exists with `credits_awarded=0` and B's `referred_by_user_id = A`.
  - Given attribution is called twice for B, Then still one row.
  - Given B registers with B's own (impossible) code or A == B, Then no row is created.
  - Given a code in lowercase, Then it resolves case-insensitively.
- **Source refs:** app/Services/ReferralService.php; app/Models/Referral.php; app/Models/User.php; database/migrations/2026_05_07_120000_create_wallet_and_referrals_tables.php.
- **Port notes:** `referrals` table keyed by tenant-less user ids (identity domain) - decide with AUTH whether referrer/referee are users or orgs; unique index on referee; handle unique violation gracefully.
- **Port status (2026-10-06):** built. Consumer of `referral.attributed`; `referrals` gained `referrer_org_id`/`referred_org_id` (migration 20261031100000). Referee = user (org, id); idempotent via UNIQUE(referred_user_id).

### TW-CPN-033 — Referral reward on referee's first paid order

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-CPN-032
- **Summary:** The referrer receives a fixed wallet bonus (setting `referral_signup_credits`, default 100 minor units = 1.00 of the platform currency) the first time the referee has ANY order finalized as paid. It was moved off signup to stop free-account farming.
- **Actors & access:** System, invoked at the end of `CheckoutController::finalizeOrder` for the order's buyer after the order transaction commits; wrapped in try/catch so it can never break checkout (failures are logged as warnings).
- **UX & screens:** referrer sees the bonus as a wallet credit (description "Referral bonus - <referee email> started a paid plan with your code") and in affiliate history as status Paid with credits and a wallet tx id.
- **Endpoints:** none.
- **Data:** `rewardOnFirstPayment(referee)`: finds the referee's referral with `award_transaction_id IS NULL`; loads the referrer (skips if missing or same user); payout = max(0, int(`referral_signup_credits`, default 100)); returns if payout <= 0. In one transaction: `WalletService::creditAccount(referrer, payout, source "referral.paid", subject = referee, description, meta {referee_id, code_used})` (adds to `users.wallet_credits`, writes a `credit` earn ledger row) and updates the referral with `credits_awarded = payout` and `award_transaction_id`.
- **Rules & edge cases:**
  1. Idempotent by the stamped `award_transaction_id`; a second order or a renewal never pays again.
  2. The trigger fires for ANY order finalized paid: plan, add-on, credit bundle, wallet top-up, offline approval, and mobile create-order (auto-marked paid). There is no minimum amount, no check that the order is a subscription, and free/100%-discounted orders count if finalized. The description text says "started a paid plan", which is inaccurate for top-ups.
  3. The payout is credited as `wallet_credits` 1:1 (1 credit == 1 minor unit); the stored setting is minor units, the admin form is in major money (TW-CPN-034).
  4. Ledger source is `referral.paid`; the affiliate history "Recent payouts" panel filters on `referral.signup` (legacy) so new payouts do not appear there (TW-CPN-035).
  5. Referral rows stay unpaid forever if the referee never pays; there is no expiry window.
  6. Two concurrent finalizations of two different orders for the same referee could both pass the `IS NULL` check because the read is not locked (the transaction re-reads nothing); the ledger could double-credit in that race (open question; port must lock the referral row).
  7. No notification to the referrer.
- **Async & events:** wallet ledger row `referral.paid`; log warning on failure.
- **External systems:** none.
- **Settings:** `referral_signup_credits` (int minor units, default 100; the admin UI shows it divided by 100 with two decimals).
- **Acceptance criteria:**
  - Given B was referred by A and pays their first order, Then A's wallet increases by the configured payout, the referral shows `credits_awarded=payout` and `award_transaction_id` set.
  - Given B pays a second order, Then no additional credit.
  - Given the setting is 0, Then nothing is paid and the referral stays unpaid (and will be re-evaluated on later orders).
  - Given B was not referred, Then nothing happens.
  - Given the wallet service throws, Then checkout still succeeds and a warning is logged.
- **Source refs:** app/Services/ReferralService.php; app/Http/Controllers/CheckoutController.php (finalizeOrder); app/Services/WalletService.php; app/Models/Referral.php.
- **Port notes:** Implement as a domain event handler consuming an `order.paid` outbox event (audit + outbox in same tx), locking the referral row `FOR UPDATE`; credit via the WALLET ledger. Consider a minimum order amount, subscription-only rule, and a maximum payout window as product options (parity default: none).
- **Port status (2026-10-06):** built. Consumer of `paygw.order.paid`, row locked FOR UPDATE, credits the referrer's WORKSPACE wallet (`earn`, `referral.paid`, key `referral:<id>`), audit + `referral.rewarded`. QUIRK kept for parity: any paid order counts, including zero-total ones (decision for the owner: a minimum amount or subscription-only rule). Ledger description carries no referee name or email (hardening).

### TW-CPN-034 — Affiliate reward setting (admin wallet-rules save)

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** none
- **Summary:** The admin sets the referral bonus as money on the Wallet rules settings page; the same form also saves credits-per-message and the top-up conversion rate (WALLET domain values).
- **Actors & access:** Platform admin; middleware authenticated + admin + IP allow-list; demo mode blocks `admin/settings*`.
- **UX & screens:** `resources/views/admin/settings/wallet-rules.blade.php` (owned by WALLET/SET; only the form contract is described here). KPI card "Signup reward" shows `credPerSignup / 100` in the platform currency symbol; form field "Signup reward (symbol)" step 0.01 min 0 max 100000 prefilled with the stored value / 100, hint "Money added to the referrer's wallet the moment their referee finishes signup" (QUIRK: text says signup; behavior is first paid order). Footer summary: "<amount> is added to the referrer's wallet - enough for N messages" where N = payout / credits_per_message.
- **Endpoints:**

| Endpoint                      | Route name                      | Handler                                      | Middleware                                   | Request                                                                                                                                                       | Response                                                                            |
| ----------------------------- | ------------------------------- | -------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| POST admin/settings/affiliate | admin.settings.affiliate.update | AdminPagesController@settingsAffiliateUpdate | Authenticate, EnsureUserIsAdmin, IPAllowlist | referral_signup_credits (required numeric 0..100000), credits_per_message (required integer 1..1000), credits_per_currency_minor (nullable numeric 0..100000) | redirect to `admin.settings.wallet-rules` with flash `status` "Wallet rules saved." |

- **Data:** writes `system_settings`: `referral_signup_credits` = round(input * 100) as int; `credits_per_message` int; `credits_per_currency_minor` float only when the field is filled (blank never zeroes it). Read defaults: 100, 1, 0.1.
- **Rules & edge cases:** 1. Values of the first key are minor units of the platform currency but the label says "credits"; unit mismatch is pervasive (see TW-CPN-035). 2. The settings service caches reads for 30 minutes; the write updates the row and cache key through the setter. 3. No audit row is written for this save (open question). 4. The other two keys are documented in WALLET; this feature owns only the reward key.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `referral_signup_credits`, plus `credits_per_message`, `credits_per_currency_minor` (WALLET).
- **Acceptance criteria:**
  - Given the admin enters 2.50, Then `referral_signup_credits` is stored as 250 and the form shows 2.50 on reload.
  - Given `credits_per_message` 0, Then validation fails.
  - Given `credits_per_currency_minor` left blank, Then the stored rate is unchanged.
  - Given 100001 as reward, Then validation fails.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingsAffiliateUpdate, settingWalletRules); resources/views/admin/settings/wallet-rules.blade.php; app/Models/SystemSetting.php; Documentation/pages/admin-panel/system-settings.html.
- **Port notes:** Store the reward as an integer minor amount in a typed platform setting; expose in the WALLET rules screen; audit the change.
- **Port status (2026-10-06):** covered by the wallet rules screen: every save is logged with old and new value; the 0..100,000 bound was missing in our contract and is now enforced.

### TW-CPN-035 — Affiliate history dashboard

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** TW-CPN-032
- **Summary:** A user page listing everyone they referred, with KPI cards, a signups-and-credits chart over time, top codes, a searchable paginated table, a share-link panel, a recent-payouts panel and a how-it-works checklist. Live filtering uses the same URL with `partial=1` returning JSON.
- **Actors & access:** Any authenticated user (route `Authenticate` only, under the "More" section; no workspace role or plan gate). Data is scoped to `referrer_user_id = current user`, not to the workspace.
- **UX & screens:** `resources/views/user/affiliate-history/index.blade.php` (page key `user-affiliate-history-index`, JS `resources/js/charts/user-affiliate-history-index.js`, chart lib ApexCharts) and row partial `_rows.blade.php`.
  - Sub-header: back link to `/more`, title "Affiliate history", range select (Last 7 days, Last 30 days, Last 90 days, All time), "Export CSV" link (TW-CPN-036), "Copy share link" button (copies the referral URL; toast "Share link copied!" or "Could not copy.").
  - KPI strip (5 cards): Signups (lifetime) with delta vs previous matching window ("+N% vs prev" coloured); Credits earned (lifetime sum of `credits_awarded`); Signups (30d) with "+credits30d"; Avg per signup (rounded lifetime credits / lifetime signups); Your code with "+N credits per signup" (N = the raw reward setting).
  - Volume chart: bar (signups) + line (credits) with a dual axis, bucket tabs Daily/Weekly/Monthly; ticks capped at 10 labels.
  - Top codes: top 5 codes by signups in range with signup count, credits sum and a proportional bar (min 2%).
  - Table: columns When (date + relative), Referee (avatar gradient initials, name, email), Code used, Credits ("+N credits"), Status (Paid when `credits_awarded > 0`, else "No payout"), Wallet tx ("tx-<id>" or dash). Search input (220 ms debounce, matches referee name, email or code used, case-insensitive), Reset button (clears search only), footer "Showing a-b of N" with Prev/Next and a window of +-2 page buttons, hidden when there are no rows. Empty states with copy ("No referrals match the current filters..." / "No signups found. Share your code to start earning.").
  - Side panel: share link card (code, "+N credits per signup", full URL, Copy link), Recent payouts (up to 8: "+N credits", relative time, balance after) or empty state, "How it works" checklist (share link, friend signs up, credits land in wallet, and "credits spend at N per message" only when the workspace bills per message).
- **Endpoints:**

| Endpoint              | Route name                   | Handler                          | Middleware   | Request                                                                                          | Response                                                                                                                                                                                                          |
| --------------------- | ---------------------------- | -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET affiliate-history | user.affiliate-history.index | AffiliateHistoryController@index | Authenticate | `range` (7d/30d/90d/all, default 90d), `bucket` (daily/weekly/monthly), `q`, `page`, `partial=1` | HTML page; with `partial=1` JSON `{ok, data:{rows, rowsHtml, stats, volume, topCodes, payouts, page, pageCount, total, shownFrom, shownTo, filters, referralCode, referralUrl, signupReward, creditsPerMessage}}` |

- **Data:** reads `referrals` (+ referee `users` name/email), `wallet_transactions`, `system_settings` (`referral_signup_credits`, `credits_per_message`). Ranges: 7d, 30d, 90d, all (from 2020-01-01; treated as 1825 days for bucketing); unknown value falls back to 90d. Default bucket: daily if range <= 14 days, weekly if <= 90, else monthly (chosen only when `bucket` is absent). Page size 20; page clamped to [1, pageCount]; all rows in range are loaded, then filtered/paginated in PHP memory.
- **Rules & edge cases:**
  1. Stats are computed over the unfiltered range (search does not change them). Delta % = (current - previous window of equal length) / previous * 100, rounded; if previous is 0 then +100 when current > 0 else 0.
  2. Bucket series: daily = one point per day for the whole range (a 90-day "daily" chart has 90 points; labels "D" for <= 7 days else "M d"); weekly = `ceil(days/7)` weeks starting Monday; monthly = `ceil(days/30)` months labelled "M". Points are anchored to today going backwards.
  3. QUIRK: the JS omits `bucket` from the query when Daily is selected (treating daily as its own default) but the server default for a 90-day range is weekly, so choosing Daily on the 90-day range returns weekly data.
  4. QUIRK: "Recent payouts" filters ledger rows with source `referral.signup` (the pre-change signup payout), but current payouts are written with `referral.paid`, so the panel only shows legacy rows.
  5. QUIRK: money shown as "credits" are minor units of the platform currency (100 == 1.00); the account tab divides by 100 and shows currency, this page does not (unit inconsistency).
  6. The avatar gradient is picked from a 5-entry palette using the referee id modulo 5; initials from the first and last word of the name; name falls back to "User #id"; email falls back to a dash.
  7. Timestamps are shown in the server timezone (app timezone), not the workspace timezone.
  8. Pagination and search happen after loading every referral in range; expected volume per user is small (docs: "thousands at most").
  9. When `partial=1`, `rowsHtml` is server-rendered HTML for the table body and the JS swaps it in and re-renders pagination and the chart.
- **Async & events:** none (no websockets).
- **External systems:** none (ApexCharts bundled).
- **Settings:** `referral_signup_credits`, `credits_per_message`; pay-per-message mode (`bsp_pay_per_message` / workspace billing mode) toggles one checklist line.
- **Acceptance criteria:**
  - Given a user with 45 referrals in the last 90 days, When they open the page, Then the table shows 20 rows, footer "Showing 1-20 of 45", and Next goes to page 2 without a full reload.
  - Given a search `gmail`, Then only referees whose name, email or code contains it are listed and KPIs are unchanged.
  - Given range 7d, Then default bucket is daily with 7 points; range all, then monthly.
  - Given a referral with `credits_awarded=0`, Then status "No payout" and wallet tx dash; with a paid referral, status Paid and `tx-<id>`.
  - Given a user with no referrals, Then KPIs read 0, delta 0%, empty states are shown and the footer is hidden.
  - Given an unauthenticated visit, Then redirect to login.
- **Source refs:** app/Http/Controllers/AffiliateHistoryController.php; resources/views/user/affiliate-history/index.blade.php; resources/views/user/affiliate-history/_rows.blade.php; resources/js/charts/user-affiliate-history-index.js; app/Models/Referral.php; app/Models/WalletTransaction.php.
- **Port notes:** `apps/web/.../account/affiliate` + `GET /me/referrals?range=&q=&cursor=` in a `growth/referrals` module; do the search/pagination in SQL; fix the bucket default and payouts source; render money with the platform currency consistently. Charts library is a choice; the data shape above is the contract.
- **Port status (2026-10-06):** built as ONE Affiliate screen at `/account/affiliate` (merges the account tab and this page). Fixes: a named bucket is always honoured, payouts read `referral.paid`, one unit (hundredths + currency code) everywhere, search and pagination in SQL with a cursor. Intended: UTC buckets; daily series capped at the latest 366 points; monthly buckets are calendar months.

### TW-CPN-036 — Affiliate history CSV export

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CPN-035
- **Summary:** Downloads the referral rows of the selected range as a CSV.
- **Actors & access:** Authenticated user; only their own referrals.
- **UX & screens:** "Export CSV" link in the page header; the link's href is updated by JS when the range select changes (ignores search and bucket).
- **Endpoints:**

| Endpoint                     | Route name                    | Handler                           | Middleware   | Request                               | Response                                                                              |
| ---------------------------- | ----------------------------- | --------------------------------- | ------------ | ------------------------------------- | ------------------------------------------------------------------------------------- |
| GET affiliate-history/export | user.affiliate-history.export | AffiliateHistoryController@export | Authenticate | `range` (7d/30d/90d/all, default 90d) | streamed `text/csv; charset=UTF-8` attachment `affiliate-history-YYYYMMDD-HHMMSS.csv` |

- **Data:** columns `id, created_at (ISO 8601), referee_name, referee_email, code_used, credits_awarded, wallet_tx_id`, ordered newest first, no pagination limit (all rows in range).
- **Rules & edge cases:** 1. `credits_awarded` is the raw stored minor-unit integer (100 means 1.00 money). 2. The search text is not applied. 3. Uses PHP CSV quoting; no BOM (spreadsheet apps may mangle UTF-8 names). 4. No audit row for the export. 5. Referee email is included (personal data of referees) - keep consent/PII policy in mind.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 3 referrals in range, When exporting, Then a header row plus 3 rows are returned newest first.
  - Given range `7d`, Then only referrals from the last 7 days are exported.
  - Given no referrals, Then only the header row is returned.
- **Source refs:** app/Http/Controllers/AffiliateHistoryController.php; resources/js/charts/user-affiliate-history-index.js.
- **Port notes:** Stream from the API with the same columns; prefix a BOM or document encoding; apply the same filters as the list.
- **Port status (2026-10-06):** built. Same columns (`id` is the uuid), UTF-8 BOM, newest first, formula-safe cells, `credits_awarded` in hundredths, max 100,000 rows.

### TW-CPN-037 — Account affiliate tab and More-page affiliate counters

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CPN-032
- **Summary:** Inside the Account page (Affiliate tab) users see their code, copy-link button, three stat cards and the 50 most recent referrals; the More hub shows two counters on its Affiliate history card.
- **Actors & access:** Authenticated user (account page owned by the account/wallet domains; this feature documents only the referral content).
- **UX & screens:** `resources/views/user/account/index.blade.php` pane `affiliate`: card "Your affiliate code" with the code (or "NO-CODE"), copy: "Share your unique link. Every new sign-up earns you <reward>, deposited straight into your wallet." where the reward is `referral_signup_credits / 100` formatted in the PLATFORM default currency without conversion (`formatIn`) for every viewer; "Copy link" button copies `<app url>/register?ref=<code>`; link shown below. Three stats: Sign-ups (30d), Sign-ups (total) (both computed from the 50 most recent rows only, so totals cap at 50), Earned (sum of `credits_awarded` / 100 shown as money in the viewer's currency, with "= N messages" = earned / credits_per_message). Table "Recent referrals": user (name, else email, else "User #id"), code used, joined date, status pill (always "active"), earned "+amount". Empty state "No referrals found. Share your link and new signups will appear here." Tab title in JS: "Affiliate program - 20% recurring commission for every paid plan you refer" (see TW-CPN-038). `resources/views/user/more/index.blade.php` Affiliate history card shows the count of referrals and the sum of `credits_awarded` (raw), computed in `UserPagesController` `more`.
- **Endpoints:** none claimed (`GET account` and `GET more` belong to other domains).
- **Data:** `referrals` for the current user (limit 50, newest first); `system_settings` reward and credits-per-message.
- **Rules & edge cases:** 1. QUIRK: the "Sign-ups (total)" card is `count()` of the 50-row list, not a true lifetime count (the history page has the true count). 2. QUIRK: the status pill is hard-coded "active" even when the referral has not paid. 3. The reward text is the platform reward at first payment, not per sign-up. 4. Unit conventions differ between this tab (money) and the history page (credits).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `referral_signup_credits`, `credits_per_message`, `default_currency`.
- **Acceptance criteria:**
  - Given a user with 60 referrals, Then the tab lists 50 and the total card shows 50.
  - Given a user without a code (legacy), Then the tab shows "NO-CODE".
  - Given reward setting 250 and default currency USD, Then the copy shows $2.50 for every viewer regardless of workspace currency.
- **Source refs:** app/Http/Controllers/AccountController.php; app/Http/Controllers/UserPagesController.php; resources/views/user/account/index.blade.php; resources/views/user/more/index.blade.php; resources/js/charts/user-account-index.js.
- **Port notes:** In the port, merge this tab and the history page into one Affiliate screen backed by the same API and unit conventions.
- **Port status (2026-10-06):** merged into the Affiliate screen. `lifetimeCount` is a true count (Reference capped it at 50); the status shows paid or pending (Reference hard-coded active); reward shown in the platform currency.

### TW-CPN-038 — Advertised 20% recurring affiliate commission

- **Status:** docs-only
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-CPN-033
- **Summary:** The account page's JS header copy for the Affiliate tab promises "20% recurring commission for every paid plan you refer"; no code computes a percentage or a recurring commission. The only implemented reward is the one-time fixed bonus of TW-CPN-033.
- **Actors & access:** none (copy only).
- **UX & screens:** subtitle string in `resources/js/charts/user-account-index.js` for the `affiliate` tab; global search entry "Affiliate - Code, referrals, commissions" in `resources/js/threadwise.js`.
- **Endpoints:** none.
- **Data:** none: there is no commission table, no percentage setting, no renewal hook. Subscription renewals do not call `ReferralService`.
- **Rules & edge cases:** 1. Do not port the claim; decide whether a percentage/recurring commission is a product goal (would need a commission ledger, payout rules, clawbacks and admin controls). 2. Docs page for the Account area also describes the fixed reward accurately ("reward amount set by the platform owner... 100 credits by default"), and the auth docs claim the referral is counted at signup (inaccurate: it is paid on first purchase).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port, Then no UI copy may promise a percentage commission unless a commission feature is built.
  - Given Reference 1.7.0, When a referred user renews a plan, Then the referrer receives nothing further.
- **Source refs:** resources/js/charts/user-account-index.js; resources/js/threadwise.js; Documentation/pages/account/account-billing.html; Documentation/pages/security/authentication.html.
- **Port notes:** Track as a product decision; if wanted, design a separate `affiliate_commissions` ledger.

## Data model

All four owned tables are platform-global except `referrals` (keyed by user ids). None has soft deletes. Timestamps are `timestamp NULL` set by the ORM unless noted. Row volumes are small (coupons: tens; credit_packages: single digits; currencies: about 30 to 200; referrals: grows with signups, thousands to hundreds of thousands).

- **Port status (2026-10-06):** PRODUCT DECISION: not ported. No UI copy promises a percentage or recurring commission; a commission feature would need its own ledger, payout rules and clawbacks (`affiliate_commissions`) and a new decision.

### coupons

Purpose: platform discount codes (TW-CPN-001..008). Written by the admin CRUD and by the paid-order finalization (`uses_count`). Read by the resolver, mobile "available coupons", Shopify/Woo offer composers.

- `id` bigint PK.
- `code` varchar(64) NOT NULL, UNIQUE (`coupons_code_unique`), stored UPPERCASE; DB collation `utf8mb4_unicode_ci` makes it case-insensitive.
- `description` varchar(255) NULL (customer-facing); `admin_note` text NULL (internal).
- `type` varchar(16) NOT NULL default `percent`; values `percent` | `fixed`.
- `amount` decimal(12,4) NOT NULL default 0 (percent value or currency units).
- `currency_code` varchar(8) NULL (currency lock, uppercase compare; free text).
- `max_discount_amount` decimal(14,4) NULL (cap, effective only for percent).
- `min_order_amount` decimal(12,4) NULL.
- `max_uses` int unsigned NULL (global cap); `per_user_limit` int unsigned NULL; `uses_count` int unsigned NOT NULL default 0 (incremented atomically at paid finalization).
- `applicable_package_ids` JSON NULL (array of `packages.id`; null or empty = any plan). No FK.
- `starts_at`, `expires_at` timestamp NULL.
- `is_active` tinyint NOT NULL default 1; `first_purchase_only` tinyint default 0; `stackable_with_other` tinyint default 0 (no runtime effect, see TW-CPN-006).
- Indexes: PK; unique `code`; composite (`is_active`, `expires_at`).
- Referenced by: `orders.coupon_id` (index only, no FK, plus snapshot `orders.coupon_code`), `booking_templates.coupon_id` (FK, ON DELETE SET NULL). Seed rows (installer, only when the table is empty): WELCOME10 (10% off, description "10% off your first plan purchase") and SAVE20 (20% off any plan), both active, unlimited.
- Audit: generic observer writes `coupon.created|updated|deleted`.

### credit_packages

Purpose: admin-defined one-time credit bundles (TW-CPN-009..016).

- `id` bigint PK; `name` varchar(96) NOT NULL; `slug` varchar(96) NOT NULL UNIQUE (auto-generated from name when blank).
- `price_minor` bigint unsigned NOT NULL (price x100 in the package currency); `currency_code` varchar(3) NOT NULL default `INR`.
- `credits` bigint unsigned NOT NULL (fixed credits granted).
- `badge` varchar(32) NULL; `description` text NULL (validated max 500).
- `is_active` tinyint NOT NULL default 1; `is_featured` tinyint default 0; `sort_order` int unsigned default 0.
- Indexes: PK, unique `slug`, (`is_active`, `sort_order`).
- Derived (not stored): `price_display` (converted to viewer currency), `rate` = credits / price_minor, `credits_per_major` = rate x 100.
- Referenced by `orders.credit_package_id` (index, no FK) and by `wallet_transactions.subject_type = 'App\Models\CreditPackage'` with `subject_id`. Seeded rows by migration: Starter (10000 INR, 5000 credits, sort 10), Growth (50000 INR, 27500, badge "Most popular", featured, sort 20), Scale (100000 INR, 60000, badge "Best value", sort 30).
- Audit: `creditpackage.created|updated|deleted`.

### currencies

Purpose: currency catalog with symbol, decimals and USD-based rate (TW-CPN-018..028).

- `id` bigint PK; `name` varchar(120) NOT NULL; `code` varchar(10) NOT NULL UNIQUE (trimmed + uppercased by a model mutator); `symbol` varchar(20) NULL.
- `precision` tinyint unsigned NOT NULL default 2 (0..6, display decimals); `exchange_rate` decimal(16,6) NOT NULL default 1.000000 (units of this currency per 1 USD; must be > 0 by validation); `is_active` tinyint NOT NULL default 1.
- Indexes: PK, unique `code`, (`is_active`, `code`).
- Cached: rates map 60 s, per-code row 60 s, symbol map 300 s. Seeded with 30 rows by `CurrencySeeder` (TW-CPN-025).
- Related setting: `system_settings.default_currency` (string). Related columns: `workspaces.currency` varchar(10) NULL, `packages.currency` varchar(8) NOT NULL default INR, `orders.currency` varchar(10), `users.wallet_currency_code` varchar(3) default INR (all owned elsewhere).

### referrals

Purpose: one row per referred user (attribution + payout state) (TW-CPN-032, 033, 035..037).

- `id` bigint PK; `referrer_user_id` bigint unsigned NOT NULL FK users ON DELETE CASCADE, INDEX; `referred_user_id` bigint unsigned NOT NULL FK users ON DELETE CASCADE, UNIQUE (`referrals_referred_user_id_unique`, race-safe one-referrer-per-user).
- `code_used` varchar(16) NOT NULL, INDEX (what the referee entered, uppercased).
- `credits_awarded` int unsigned NOT NULL default 0 (0 until the first-payment payout; then the payout in minor units). QUIRK: int (max about 4.29 billion).
- `award_transaction_id` bigint unsigned NULL (wallet_transactions.id of the payout; NULL = unpaid; no FK).
- `created_at` timestamp NOT NULL default current_timestamp (no `updated_at`; the model disables timestamps).
- Ordering everywhere: `created_at DESC`.

### Columns and settings owned elsewhere but behavior-relevant here

- `users.referral_code` varchar(16) NULL UNIQUE; `users.referred_by_user_id` bigint NULL FK users ON DELETE SET NULL; `users.wallet_credits`, `wallet_currency_minor`, `wallet_currency_code` (WALLET).
- `orders`: `coupon_id`, `coupon_code`, `discount_amount` decimal(12,4), `tax_*`, `total_amount`, `credit_package_id`, `package_id`, `currency`, `base_amount_usd`, `status` (`paid` drives coupon counting and referral payout).
- `wallet_transactions`: referral payouts use `kind=credit`, `type=earn`, `source=referral.paid`, `subject_type=User`, `subject_id=referee`; package purchases use `source=package.purchase`.
- `system_settings` keys used: `default_currency` (string, default USD), `referral_signup_credits` (int minor units, default 100), `credits_per_message` (int, default 1), `credits_per_currency_minor` (float, default 0.1), `checkout.tax_enabled`, `checkout.tax_rate`, `checkout.tax_label`, `pricing.yearly_discount_pct`.
- Cookie `threadwise_ref` (30 days) - not stored server-side.

## Cross-domain contracts

Consumes:

- **AUTH**: user creation hook (referral code), registration flows (`ref` field, OTP pending-registration payload, mobile `refer_code`) that call `ReferralService::findReferrer/attribute`; `EnsureUserIsAdmin` (`isAdmin()`), `IPAllowlist` and demo-mode middleware for the admin screens.
- **CHK / PLAN**: `CheckoutController::process`, `finalizeOrder`, `markPaidManually`, `confirmOrderPayment` call `Coupon::resolve`, increment `coupons.uses_count`, create orders with coupon/credit-package columns, and call `ReferralService::rewardOnFirstPayment`; the checkout page hosts the coupon widget; `availableCheckoutCurrencies` filters the catalog by gateway support.
- **WALLET**: `WalletService::creditAccount` (referral payout), `WalletService::topupViaPackage` (bundle fulfilment), `wallet_transactions` ledger, wallet rules settings page (`credits_per_message`, `credits_per_currency_minor`), `MessageBillingService::payPerMessageFor` (checklist line on the affiliate page).
- **SET**: `SystemSetting::get/set` (typed settings, 30-minute cache), general settings page (second writer of `default_currency`), `Audit::log` and `AuditableObserver` from NOTIF.
- **PAYGW**: `PaymentGatewayManager`, gateway `acceptsCurrency` / `supported_currencies`; the Razorpay driver bills `order.amount` (post-discount) for subscriptions.
- **WSP**: `workspaces.currency`, admin workspace forms, `AdminWorkspaceProvisioner` (stamps default currency), settings route `POST settings` (owner-only currency save).

Exposes:

- **`Coupon::resolve`** (TW-CPN-006) to CHK, MOB (`Api\App\BillingController@createOrder`), and potentially any future checkout; **`coupons`** rows to MOB (`GET api/app/coupon/available` lists active, in-window, not fully used coupons with fields id, code, coupon_code, description, discount_type percentage|fixed, amount, currency_code, min_amount, max_discount, expiry_date), to the Shopify/WooCommerce offer composers (active coupons, first 100 by code) and to appointment booking templates (`booking_templates.coupon_code` / `coupon_id`).
- **`FormatSettings` / `Currency::symbolFor` / `MoneyFormat`** to virtually every domain that renders money (DEAL, INV, SALES, CAT, STORE, CHK, PLAN, WALLET, DASH, MOB, EXT, AIAG toolkits) and to INV invoice mappers.
- **Currency catalog** (`currencies` active rows) to PLAN (plan and add-on forms), PAYGW (gateway forms), SET (general settings), WSP (workspace settings), MOB (payment gateway and billing endpoints), coupon and credit-package forms.
- **Referral data**: `users.referral_code`, `referrals` to MOB (`GET api/app/affiliate/code` returns `refer_code` and `referral_link`, generating a code for users lacking one), to `UserPagesController@more` counters and to the account Affiliate tab; `ReferralService::rewardOnFirstPayment` to CHK.
- **`CaptureReferral` middleware** to the whole web stack (public site, marketing pages and auth pages).
- Events: none dispatched (no Laravel events or queued jobs in this domain); audit rows via the auditable observer (`coupon.*`, `creditpackage.*`) and explicit `admin.currency.*` audit actions.

## Open questions & quirks

Cross-domain items intentionally left to other domains (deliberately NOT in this file's coverage):

- `GET api/app/coupon/available`, `GET api/app/affiliate/code`, `GET api/app/credits` (MOB); `GET api/credits` (EXT extension API); their behavior that touches this domain is captured in Cross-domain contracts.
- `wa_coupons` table, `WaCoupon` model, `WaCouponController` routes `GET/POST store/coupons`, `PUT/DELETE store/coupons/{id}` and `POST s/{slug}/coupon` (merchant storefront coupons; CHK/STORE). They are a completely separate coupon system (workspace-scoped, minor-unit amounts, free-shipping flag, `usage_limit`/`used_count`, flat vs percent) that shares no code with `Coupon`.
- `admin/bsp/credit*` routes and `bsp_credit_allocations` (BSP credit line) share only the word "credit" with credit packages.
- `GET checkout/success`, `GET checkout/failed` (CHK); `GET/POST checkout/{packageId}`, `POST checkout/{order}/proof`, `GET/POST checkout/wallet` (any-amount wallet top-up; WALLET/CHK); `GET account`, `GET more`, `POST settings`, `GET register`, `POST register` (other domains).
- `resources/views/admin/settings/wallet-rules.blade.php` and `AdminPagesController@settingWalletRules` / `messageRatesUpdate` (WALLET); only the affiliate save route is claimed here.

Defects and surprises (verify with the parity tool before rebuilding):

1. QUIRK/SECURITY: `POST /checkout/complete` (and `GET /checkout`) are outside the auth group and grant a bundle's credits for free to any logged-in user; guests cause a 500. Do not port (TW-CPN-017).
2. QUIRK (probable defect): "Set default currency" calls the settings setter with its implicit `int` type, so the stored default reads back as 0 (see TW-CPN-024). Static analysis only; the reference DB has no `default_currency` row and no currencies (seeder not run locally).
3. QUIRK: referral bonus is paid on the referee's FIRST PAID ORDER of any kind (including wallet top-ups, bundle purchases, offline approvals and the mobile create-order that auto-marks orders paid), not at signup, yet admin copy, docs (authentication page) and the settings key name still say "signup". The history page "Recent payouts" reads the legacy source `referral.signup`, so new payouts never appear there.
4. QUIRK: unit confusion. `referral_signup_credits` is stored in minor money units and credited 1:1 to `wallet_credits`; the admin form shows money (value/100); the history page and CSV show the raw number labelled "credits"; the account tab shows money. Wallet-rules help text mentions `workspaces.wallet_credits` while the code uses `users.wallet_credits`.
5. QUIRK: `stackable_with_other` has no effect (only one code can be entered). Docs advertise combining coupons.
6. QUIRK: the coupon plan restriction cannot be cleared from the edit form (TW-CPN-003); `first_purchase_only` looks at the USER's paid orders (hint text says workspaces); `max_uses` is not reserved (cap can be exceeded by concurrent unpaid orders); redemption is counted at paid time without re-validating the coupon; deleting and re-creating a code resets per-user usage.
7. QUIRK: the preview endpoint trusts a client-supplied `amount` and has no throttle; preview currency logic can differ from the process currency.
8. QUIRK: coupon discount on recurring gateway subscriptions: at least Razorpay creates the subscription plan with the discounted `order.amount`, so the discount repeats on every renewal (other drivers unverified).
9. UNVERIFIED: how gateways handle a zero-total order when a 100% coupon is applied; whether percent > 100 should be blocked; API rate limit of open.er-api.com; whether re-running `CurrencySeeder` (which overwrites rates and re-activates rows) is intended.
10. Docs vs code: (a) currency editing is advertised but no edit UI exists (route only); (b) docs say credit packages appear in checkout, on the wallet and in the admin sidebar under Billing & Plans - the wallet grid is disabled (`false &&`), the checkout URL redirects to the any-amount top-up, and no admin nav entry links to the page; (c) docs and UI copy claim a "20% recurring commission" which is not implemented (TW-CPN-038); (d) docs say referrals are counted at sign-up; (e) the currency page copy says the default propagates through `FormatSettings::currency()` but the display cache (60 s and 300 s) delays it.
11. QUIRK: two writers of `default_currency` with different validation (currency page: must exist; general settings: any string max 8, no cache flush, no audit). Also `admin.currencies.update` and `toggle` allow deactivating or renaming the default.
12. QUIRK: `MoneyFormat::display` assumes 2 decimals while `toMinor`/`majorString` use ISO exponents; the credit-package price is always x100; `FormatSettings::convert` rounds to 2 decimals and treats unknown or inactive currencies as rate 1.0; the currency model docblock describes the rate as value of 1 unit in USD (inverse of actual usage).
13. QUIRK: `credits_awarded` is `int unsigned` and `code_used` `varchar(16)` (raw uppercased input, could contain surrounding characters); the cookie middleware strips non-alphanumerics but the form path does not.
14. Dead or duplicate code: `AuthController::registerAccount` (referral block, unrouted); the unreachable body of `CheckoutController::creditShow` after its redirect; the account wallet bundle grid guarded by `false &&`; `$creditPackagesCount` in the admin sidebar; `AccountController`/`AuthController` still query credit packages that are never rendered; `Coupon::resolve`'s `$otherCoupons` argument is never populated.
15. MOB observation for the MOB writer: `Api\App\BillingController@createOrder` immediately marks the order paid via `markPaidManually` (no gateway verification), which also increments coupon `uses_count` and can trigger the referral payout.
16. Referral payout race: two concurrent paid finalizations for the same referee can both read `award_transaction_id IS NULL` (no row lock) and double-credit; the unique key protects only attribution.
17. Reference DB state: `currencies` is empty locally and `referrals` has 0 rows, `coupons` has the 2 installer coupons and `credit_packages` the 3 migration seeds; behavior for populated currencies is derived from code.
18. Permissions: no RBAC permission keys guard any screen in this domain (only `isAdmin()`); the port must decide the platform-permission names (for example `platform.billing.manage`) rather than copying Reference's binary admin check.
19. OBSERVED by the Playwright twin (2026-10-06, reference instance): Reference's coupon and currency text columns turn four-byte characters into `?` (an emoji is stored as `??`), its string trimming also removes a trailing zero-width joiner, its code upper-casing is ASCII only, a whole-number field refuses `007` (silent summary box), amounts and rates accept exponent notation and a leading plus sign and answer 500 when a number overflows the column (`amount` 2147483647, rate 999999999999), a rate with more than six decimals is rounded silently, a currency code takes any text up to ten characters, a partial currency update without the active flag switches the currency off, and a hyphenated or lower-case `?ref=` value fills the register box raw and then wins over the cleaned cookie, so the referral is lost (rule 2 of TW-CPN-031).

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET admin/coupons",
    "POST admin/coupons",
    "GET admin/coupons/create",
    "PATCH admin/coupons/{id}",
    "DELETE admin/coupons/{id}",
    "GET admin/coupons/{id}/edit",
    "POST admin/coupons/{id}/toggle",
    "POST checkout/{packageId}/apply-coupon",
    "GET admin/credit-packages",
    "POST admin/credit-packages",
    "GET admin/credit-packages/create",
    "PUT admin/credit-packages/{id}",
    "DELETE admin/credit-packages/{id}",
    "GET admin/credit-packages/{id}/edit",
    "POST admin/credit-packages/{id}/toggle",
    "GET checkout/credits/{slug}",
    "POST checkout/credits/{slug}",
    "GET checkout",
    "POST checkout/complete",
    "GET admin/currencies",
    "POST admin/currencies",
    "POST admin/currencies/default",
    "POST admin/currencies/fetch-rates",
    "PATCH admin/currencies/{id}",
    "DELETE admin/currencies/{id}",
    "POST admin/currencies/{id}/toggle",
    "POST admin/settings/affiliate",
    "GET affiliate-history",
    "GET affiliate-history/export"
  ],
  "controllers": [
    "app/Http/Controllers/Admin/CouponController.php",
    "app/Http/Controllers/Admin/AdminCreditPackagesController.php",
    "app/Http/Controllers/Admin/CurrencyController.php",
    "app/Http/Controllers/AffiliateHistoryController.php",
    "app/Http/Controllers/CheckoutPagesController.php"
  ],
  "services": [
    "app/Services/ReferralService.php",
    "app/Support/MoneyFormat.php",
    "app/Support/FormatSettings.php"
  ],
  "models": ["Coupon", "CreditPackage", "Currency", "Referral"],
  "tables": ["coupons", "credit_packages", "currencies", "referrals"],
  "views": [
    "resources/views/admin/coupons/_form.blade.php",
    "resources/views/admin/coupons/create.blade.php",
    "resources/views/admin/coupons/edit.blade.php",
    "resources/views/admin/coupons/index.blade.php",
    "resources/views/admin/credit-packages/_form.blade.php",
    "resources/views/admin/credit-packages/create.blade.php",
    "resources/views/admin/credit-packages/edit.blade.php",
    "resources/views/admin/credit-packages/index.blade.php",
    "resources/views/admin/currencies/index.blade.php",
    "resources/views/user/affiliate-history/_rows.blade.php",
    "resources/views/user/affiliate-history/index.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": ["app/Http/Middleware/CaptureReferral.php"],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/admin-coupons-form.js",
    "resources/js/charts/user-affiliate-history-index.js",
    "resources/js/charts/packages-index.js"
  ],
  "misc_files": [],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/admin-panel/coupons-credits.html",
    "Documentation/pages/admin-panel/localization.html"
  ],
  "feature_map": {
    "TW-CPN-001": ["GET admin/coupons"],
    "TW-CPN-002": ["GET admin/coupons/create", "POST admin/coupons"],
    "TW-CPN-003": ["GET admin/coupons/{id}/edit", "PATCH admin/coupons/{id}"],
    "TW-CPN-004": ["POST admin/coupons/{id}/toggle"],
    "TW-CPN-005": ["DELETE admin/coupons/{id}"],
    "TW-CPN-006": [],
    "TW-CPN-007": ["POST checkout/{packageId}/apply-coupon"],
    "TW-CPN-008": [],
    "TW-CPN-009": ["GET admin/credit-packages"],
    "TW-CPN-010": ["GET admin/credit-packages/create", "POST admin/credit-packages"],
    "TW-CPN-011": ["GET admin/credit-packages/{id}/edit", "PUT admin/credit-packages/{id}"],
    "TW-CPN-012": ["POST admin/credit-packages/{id}/toggle"],
    "TW-CPN-013": ["DELETE admin/credit-packages/{id}"],
    "TW-CPN-014": [],
    "TW-CPN-015": ["GET checkout/credits/{slug}", "POST checkout/credits/{slug}"],
    "TW-CPN-016": [],
    "TW-CPN-017": ["GET checkout", "POST checkout/complete"],
    "TW-CPN-018": ["GET admin/currencies"],
    "TW-CPN-019": ["POST admin/currencies"],
    "TW-CPN-020": ["PATCH admin/currencies/{id}"],
    "TW-CPN-021": ["POST admin/currencies/{id}/toggle"],
    "TW-CPN-022": ["DELETE admin/currencies/{id}"],
    "TW-CPN-023": ["POST admin/currencies/fetch-rates"],
    "TW-CPN-024": ["POST admin/currencies/default"],
    "TW-CPN-025": [],
    "TW-CPN-026": [],
    "TW-CPN-027": [],
    "TW-CPN-028": [],
    "TW-CPN-029": [],
    "TW-CPN-030": [],
    "TW-CPN-031": [],
    "TW-CPN-032": [],
    "TW-CPN-033": [],
    "TW-CPN-034": ["POST admin/settings/affiliate"],
    "TW-CPN-035": ["GET affiliate-history"],
    "TW-CPN-036": ["GET affiliate-history/export"],
    "TW-CPN-037": [],
    "TW-CPN-038": []
  }
}
```
