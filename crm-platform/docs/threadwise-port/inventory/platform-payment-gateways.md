---
domain: platform-payment-gateways
code: PAYGW
title: Platform payment gateways, checkout, order and billing history
threadwise_version: '1.7.0'
sources_read: 140
---

# Platform payment gateways, checkout, order and billing history

## Overview

This domain is how the **platform owner (super-admin) gets paid by workspaces**. A workspace owner buys a subscription plan, a plan add-on or tops up the prepaid wallet; the money moves through one of 33 pluggable payment-gateway drivers that the super-admin configures once, platform-wide. Everything a workspace charges ITS OWN customers for (storefront, invoices, WhatsApp Pay, booking deposits) is a different domain (CHK, INV, SALES, APPT), although those domains re-use the driver library owned here.

Actors:

- **Super-admin** (`EnsureUserIsAdmin` + `IPAllowlist`, no finer permission key is checked on any of these routes): configures gateways and checkout/tax/company settings, reviews offline payment proofs, browses order history, billing history, platform invoices and analytics.
- **Workspace owner / any logged-in user with a current workspace**: opens checkout for a plan, add-on or wallet top-up, pays at the gateway, uploads proof for offline payments, sees the result in Account, downloads a per-order invoice.
- **Payment provider** (machine): returns the buyer to `/payment/callback/{slug}` and posts async notifications to `/payment/webhook/{slug}` (CSRF-exempt, signature-checked per gateway).
- **Mobile app** (MOB domain): uses the same gateway rows, the same `orders` table and the same fulfilment method through `/api/app/*` endpoints (not claimed here, see Cross-domain contracts).

Main flow end to end:

1. Admin opens Admin > Payment gateways. All 33 driver-backed rows already exist (seeded / self-healed, inactive, sandbox). Admin pastes credentials (encrypted at rest, secrets never echoed back), picks mode, sort order and a currency whitelist, saves, then Activates (blocked until every required credential is present).
2. A workspace user picks a plan and lands on `/checkout/{packageId}`: price converted to the chosen currency, yearly/period maths, tax from checkout settings, only active gateways that accept that currency are offered, optional auto-renew toggle and coupon preview.
3. Submit creates an `orders` row (`pending`, number `WSN-yymmdd-XXXXXX`) and asks the driver to `initiate()` (or `createSubscription()` for auto-renew). The driver returns a redirect, an inline HTML form/script, or a terminal result.
4. The buyer pays at the provider and is returned to `/payment/callback/{slug}`; the driver verifies with the provider API/signature. In parallel the provider may POST `/payment/webhook/{slug}`. A paid result runs `finalizeOrder`: order paid, plan switched (or add-on granted, or wallet credited), coupon use counted, referral bonus paid.
5. Auto-renewing plans live on as a `subscriptions` row: renewals/cancellations/failures arrive by webhook, and a cron-free reconciler polls the gateway when the plan is near expiry.
6. Offline / bank-transfer orders stay `pending` until the buyer uploads proof and the admin approves (which runs the same fulfilment) or rejects.
7. Admin reads the outcome in Order history, Billing history, Invoices (all are just different slices of the `orders` table) plus two analytics screens.

Plan tiers: the checkout itself is not plan-gated (a trial-expired workspace can still reach `*checkout*`, `*payment*`, `*invoice*` routes through `EnsureTrialActive`). Whether a recurring plan is auto-renewable is decided by the plan (free / lifetime / custom-quote / zero-price never recur; yearly never recurs), the gateway (11 drivers support it) and two switches (`pricing.recurring_enabled` platform-wide, per-purchase `auto_renew` checkbox).

Global conventions worth knowing before reading the entries:

- Amounts on `orders` are decimal major units. Most drivers multiply by 100 for the provider (no zero-decimal-currency handling except Midtrans, Duitku, CinetPay, LigdiCash, which round to integers). See QUIRKs.
- Nearly every driver refuses to start unless the buyer has an email (order user email). Several send hard-coded placeholder phone/address values.
- `gateway_payload` (JSON) accumulates the provider's raw responses on the order; wallet top-ups keep their grant amount in it.
- Statuses are only `pending | paid | failed | refunded`. Nothing in this domain ever writes `refunded`.
- Order and gateway state changes by admin are audit-logged (`admin.payment_gateway.*`, `admin.order.*`, `admin.checkout_settings.updated`), payment fulfilment itself is not.

Connections: PLAN (packages, `Workspace::package()`, plan_ends_at, add-ons, `WorkspaceAddon`), CPN (coupons, credit packages, currency conversion `FormatSettings`, referral payout), WALLET (`WalletService::topup*`), MOB (`Api/App/*` payment, wallet, billing endpoints), CHK/APPT (re-use the driver library with merchant credentials), NOTIF (`Audit::log`), DASH (`admin/financial`, `admin/premium` read `orders`), SET (media disk for proofs, `SystemSetting`), AUTH (Account page shell).

## Feature index

| Id           | Feature                                                                                 | Status      | Priority | Effort | Depends on    |
| ------------ | --------------------------------------------------------------------------------------- | ----------- | -------- | ------ | ------------- |
| TW-PAYGW-001 | Gateway catalogue, registry and seeded rows                                             | implemented | P0       | M      | -             |
| TW-PAYGW-002 | Admin gateway list screen                                                               | implemented | P0       | M      | 001           |
| TW-PAYGW-003 | Save gateway configuration                                                              | implemented | P0       | M      | 001, 005      |
| TW-PAYGW-004 | Activate / deactivate with required-field guard                                         | implemented | P0       | S      | 003           |
| TW-PAYGW-005 | Per-gateway credential schema                                                           | implemented | P0       | L      | 001           |
| TW-PAYGW-006 | Supported-currency whitelist and available checkout currencies                          | implemented | P1       | S      | 003           |
| TW-PAYGW-007 | Checkout, tax and billing-identity settings                                             | implemented | P1       | M      | -             |
| TW-PAYGW-008 | Driver contract, PaymentResult and HTTP conventions                                     | implemented | P0       | L      | 001           |
| TW-PAYGW-009 | Plan checkout page                                                                      | implemented | P0       | L      | 004, 006, 007 |
| TW-PAYGW-010 | Coupon preview at checkout                                                              | implemented | P1       | S      | 009           |
| TW-PAYGW-011 | Place order and start payment                                                           | implemented | P0       | L      | 008, 009      |
| TW-PAYGW-012 | Auto-renew subscription start                                                           | implemented | P1       | L      | 011, 029      |
| TW-PAYGW-013 | Offline and bank-transfer gateways with payment proof                                   | implemented | P1       | M      | 011           |
| TW-PAYGW-014 | Stripe driver                                                                           | implemented | P0       | M      | 008           |
| TW-PAYGW-015 | Razorpay driver                                                                         | implemented | P0       | M      | 008           |
| TW-PAYGW-016 | PayPal driver                                                                           | implemented | P0       | M      | 008           |
| TW-PAYGW-017 | Paddle driver, built-in overlay page and return catcher                                 | implemented | P1       | M      | 008           |
| TW-PAYGW-018 | Lemon Squeezy driver                                                                    | partial     | P2       | M      | 008           |
| TW-PAYGW-019 | Mollie driver                                                                           | partial     | P2       | M      | 008           |
| TW-PAYGW-020 | Paystack and Flutterwave drivers                                                        | implemented | P1       | M      | 008           |
| TW-PAYGW-021 | Square, Braintree and Authorize.Net drivers                                             | implemented | P2       | L      | 008           |
| TW-PAYGW-022 | India drivers: Paytm, PhonePe, Cashfree, PayU, Instamojo                                | implemented | P1       | L      | 008           |
| TW-PAYGW-023 | Asia / MENA drivers: Midtrans, Duitku, Xendit, Tap, HyperPay, SSLCommerz                | implemented | P2       | L      | 008           |
| TW-PAYGW-024 | Other regional drivers: iyzico, PayTR, Fondy, Skrill, 2Checkout, Coinbase, Mercado Pago | partial     | P2       | L      | 008           |
| TW-PAYGW-025 | West-Africa drivers: CinetPay and LigdiCash                                             | implemented | P2       | M      | 008           |
| TW-PAYGW-026 | Payment return callback                                                                 | implemented | P0       | L      | 011           |
| TW-PAYGW-027 | Payment webhook receiver                                                                | implemented | P0       | L      | 008           |
| TW-PAYGW-028 | Order fulfilment (finalizeOrder)                                                        | implemented | P0       | L      | 026, 027      |
| TW-PAYGW-029 | Subscription lifecycle and webhook events                                               | implemented | P1       | L      | 012, 027      |
| TW-PAYGW-030 | Subscription reconciler (cron-free)                                                     | implemented | P1       | M      | 029           |
| TW-PAYGW-031 | Wallet top-up checkout (any amount)                                                     | implemented | P0       | M      | 008, 028      |
| TW-PAYGW-032 | Credit-package checkout (retired bundles)                                               | dead-code   | P2       | S      | 031           |
| TW-PAYGW-033 | Legacy /checkout mock pages and self-confirm                                            | partial     | P2       | S      | -             |
| TW-PAYGW-034 | Mobile in-app payment confirmation entry points                                         | partial     | P1       | M      | 028           |
| TW-PAYGW-035 | Buyer order-history pane and lifetime spend                                             | implemented | P0       | S      | 028           |
| TW-PAYGW-036 | Buyer per-order invoice                                                                 | implemented | P1       | S      | 007           |
| TW-PAYGW-037 | Admin order history                                                                     | implemented | P1       | M      | 028           |
| TW-PAYGW-038 | Awaiting-approval queue: approve / reject offline payments                              | implemented | P1       | M      | 013, 028      |
| TW-PAYGW-039 | Admin cancel pending order                                                              | implemented | P2       | S      | 037           |
| TW-PAYGW-040 | Admin order analytics                                                                   | partial     | P2       | M      | 037           |
| TW-PAYGW-041 | Admin billing history                                                                   | implemented | P1       | M      | 028           |
| TW-PAYGW-042 | Admin billing analytics                                                                 | implemented | P2       | M      | 041           |
| TW-PAYGW-043 | Platform invoices list                                                                  | implemented | P1       | M      | 028           |
| TW-PAYGW-044 | Manual invoice creation                                                                 | implemented | P2       | S      | 043           |
| TW-PAYGW-045 | Invoice row actions: mark paid, void, delete                                            | implemented | P2       | S      | 043           |
| TW-PAYGW-046 | Platform invoice view and print                                                         | implemented | P1       | M      | 043, 007      |
| TW-PAYGW-047 | Refunds and chargebacks                                                                 | docs-only   | P1       | M      | 028           |
| TW-PAYGW-048 | Driver library reuse by merchant, booking and mobile flows                              | implemented | P0       | S      | 008           |

## Features

### TW-PAYGW-001 — Gateway catalogue, registry and seeded rows

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** none
- **Summary:** A fixed catalogue of 33 payment gateways (slug to driver class) with display name and one-line description. Every catalogue entry always has a `payment_gateways` row, so the admin never "installs" a gateway: they only configure and activate it.
- **Actors & access:** super-admin reads it through the gateway screen (TW-PAYGW-002); the checkout page and mobile endpoints read active rows. No workspace scoping: gateways are platform-wide.
- **UX & screens:** no dedicated screen; the catalogue drives `resources/views/admin/payment-gateways/index.blade.php`.
- **Endpoints:** none of its own (see 002-004).
- **Data:** table `payment_gateways` (see Data model). Registry constants in `PaymentGatewayManager`: `DRIVER_MAP` (slug to driver) and `GATEWAY_META` (name, description). Slugs (33): stripe, razorpay, paypal, bank_transfer, offline, mollie, paystack, flutterwave, paytm, square, braintree, twocheckout, coinbase, mercadopago, iyzico, paddle, lemonsqueezy, authorize_net, sslcommerz, instamojo, phonepe, cashfree, payu, midtrans, duitku, xendit, tap, hyperpay, paytr, fondy, skrill, cinetpay, ligdicash. Reference DB has 32 rows (ligdicash is created lazily, see rule 3); all inactive, sandbox mode.
- **Rules & edge cases:**
  1. `PaymentGatewaySeeder` uses first-or-create by slug so re-running never overwrites credentials, mode or activation. New rows are `is_active=false`, `mode=sandbox`, `supported_currencies` pre-filled from a per-gateway whitelist map (see TW-PAYGW-006), bank_transfer and offline get an empty list (= any currency). Existing rows with NULL currencies are back-filled.
  2. Seeder sort orders: stripe 1, paypal 2, razorpay 3, paytm 4, mollie 5, paystack 6, flutterwave 7, square 8, braintree 9, twocheckout 10, coinbase 11, mercadopago 12, iyzico 13, paddle 14, authorize_net 15, sslcommerz 16, instamojo 17, phonepe 18, cashfree 19, payu 20, midtrans 21, duitku 22, xendit 23, tap 23 (duplicate), hyperpay 24, paytr 25, fondy 26, skrill 27, cinetpay 28, bank_transfer 29, offline 30, lemonsqueezy 31.
  3. Self-heal: every time the admin list loads, `ensureCatalogRows()` creates a row for any catalogue slug missing from the table (inactive, sandbox, sort = current max + 1, name/description from `GATEWAY_META`). This is how ligdicash (not in the seeder) and any future driver appear. Never touches existing rows.
  4. A driver-less slug cannot be resolved: `driver($slug)` throws for unknown slug, `driverFromModel` throws for a row whose slug is not in `DRIVER_MAP`.
  5. `activeGateways(currency?)` returns active rows ordered by `sort_order`, then `id`; when a currency is given, rows whose whitelist is non-empty and lacks the currency are dropped.
  6. `installableSlugs()` (catalogue minus existing rows) exists but nothing calls it: leftover of an "Add gateway" picker.
  7. QUIRK: the seeder header and docs say "30 gateways"; the registry has 33 and the seeded 5 "top" gateways (stripe, razorpay, paypal, bank_transfer, offline) are described as fully tested, the rest as ported.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a fresh database, when the seeder runs twice, then 32 rows exist (33 after the first admin page load), all inactive and sandbox, and no credential column changed on the second run.
  - Given a catalogue slug with no row, when an admin opens the gateway list, then the row is created inactive with sort_order max+1 and appears in the list.
  - Given an unknown slug in a webhook URL, when `POST /payment/webhook/nope` is called, then the response is 404 JSON `{ok:false}`.
- **Source refs:** app/Services/Payment/PaymentGatewayManager.php; app/Models/PaymentGateway.php; database/seeders/PaymentGatewaySeeder.php; migrations 2026_05_17_040000_create_payment_gateways_table.php; Documentation/pages/admin-panel/payment-gateways.html.
- **Port notes:** Suggested home `apps/api/src/modules/billing/payments/` with a `PaymentGatewayRegistry` (slug to adapter class implementing a port, follow the `provider-adapter` skill; `apps/api/src/infra/providers/payments/easebuzz.port.ts` is the existing single-gateway port and is far narrower than this contract). `payment_gateways` is PLATFORM data, not tenant data: no `org_id`, no RLS, only super-admin routes may write it (identity pools); tenant code only reads active rows through a service. Build the catalogue as code (not a UI-installed thing) and the row as config; do not port the "30 vs 33" copy drift.

### TW-PAYGW-002 — Admin gateway list screen

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PAYGW-001
- **Summary:** Admin > Payment gateways: a filterable list of every gateway as a collapsible card showing status, mode, region tags and a credentials form. Header KPIs count total, active, India and crypto gateways.
- **Actors & access:** super-admin only (`Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`). No per-permission key.
- **UX & screens:** `resources/views/admin/payment-gateways/index.blade.php` (layout `x-layouts.admin`, page key `admin-payment-gateways-index`, JS `resources/js/charts/admin-payment-gateways-index.js`).
  - Header: breadcrumb Admin > Payment gateways; title; sub-copy "N drivers shipped ... Credentials encrypted at rest".
  - Flash strip for `success` / `error`.
  - KPI strip (4): Total (count), Active (count active), India region count, Crypto count.
  - Category tabs with live counts: All, Popular, India, Asia, MENA, Europe, US/CA, Africa, LATAM, Crypto, Offline. Category membership is a hard-coded slug map in the view (a gateway can be in several: e.g. popular = stripe, paypal, razorpay, paddle, lemonsqueezy, square, braintree, mollie, authorize_net; india = razorpay, instamojo, cashfree, paytm, phonepe, payu; asia = xendit, midtrans, duitku, paytm, phonepe, sslcommerz, hyperpay, tap; africa = paystack, flutterwave, cinetpay; latam = mercadopago; mena = hyperpay, tap, paytr, iyzico, fondy; europe = mollie, paddle, stripe, paytr, iyzico, fondy; us = stripe, paypal, square, braintree, authorize_net, twocheckout; crypto = coinbase; offline = offline, bank_transfer). A gateway in no map (e.g. ligdicash, skrill) is tagged `other` and only appears under All. Tab and search filtering is client-side and conjunctive.
  - Search box "Filter by name or slug".
  - Per gateway a card, collapsed by default (not persisted): name, Active/Disabled badge, mode badge (amber sandbox, coral live), "Keys saved" badge when any decrypted credential is non-empty, up to 3 category badges, `slug: x · description`, an Activate/Disable button (own form) and a chevron. Clicking the header (outside buttons/forms/links) toggles the form.
  - Expanded form: credential fields per schema (TW-PAYGW-005: text, password, textarea, select), Mode select (Sandbox/Live), Sort order (number, min 0), Supported currencies pill grid with a live selected count and hint "none = all", and a Save button.
  - Empty states: no gateways at all (tells the admin to run the seeder; unreachable in practice because of self-heal), and a client-side "No gateways in this category" block.
  - Password fields are rendered EMPTY with a "saved, leave blank to keep" placeholder when a value exists. Text/textarea/select fields are pre-filled with the stored value (QUIRK: non-password secrets such as key ids and merchant ids are therefore visible in the page source).
  - The credentials of ALL gateways are decrypted and attached to every card server-side on each page load (secrets only leave in the DOM for non-password field types).
- **Endpoints:**

| Method uri                 | Route name                   | Action                               | Middleware                                   | Response |
| -------------------------- | ---------------------------- | ------------------------------------ | -------------------------------------------- | -------- |
| GET admin/payment-gateways | admin.payment-gateways.index | Admin\PaymentGatewayController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | HTML     |

- **Data:** reads `payment_gateways` (ordered `sort_order`, then `name`), `currencies` (active, ordered by code, for the pill grid). Writes only through self-heal (TW-PAYGW-001).
- **Rules & edge cases:**
  1. Order is `sort_order`, then name (not id).
  2. The currency pill grid lists only ACTIVE currencies from the platform currency table; a code stored on a gateway but since deactivated as a currency is not shown and is dropped on the next save.
  3. Filtering state is not persisted and not in the URL.
  4. The `api/app/admin/payment-gateways*` mobile admin endpoints (MOB) expose the same list/show/update/toggle logic to the app.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 33 gateways of which 2 active, when the page loads, then KPI Total=33, Active=2 and each card is collapsed.
  - Given the India tab is clicked and "raz" typed in search, then only Razorpay is visible; clearing search shows all India gateways.
  - Given a saved secret_key, when the card is opened, then the secret input is empty with the "leave blank to keep" placeholder and the badge "Keys saved" is shown.
  - Given a non-admin user, when opening the URL, then the response is 403 "Admins only.".
- **Source refs:** app/Http/Controllers/Admin/PaymentGatewayController.php; resources/views/admin/payment-gateways/index.blade.php; resources/js/charts/admin-payment-gateways-index.js; routes/admin.php (payment-gateways group); Documentation/pages/admin-panel/payment-gateways.html.
- **Port notes:** Next.js admin page under the platform-admin app. Do not ship decrypted secrets to the browser at all in the port (return `hasValue` booleans per field instead); Reference leaks non-password fields. Server-side category tags can be a `region_tags` array on the catalogue rather than a view constant.

### TW-PAYGW-003 — Save gateway configuration

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PAYGW-001, TW-PAYGW-005
- **Summary:** Saving a gateway card stores mode, sort order, currency whitelist and merges submitted credentials into the encrypted credential blob. Blank inputs never erase an existing credential.
- **Actors & access:** super-admin only.
- **UX & screens:** the expanded card form of TW-PAYGW-002; on success the page reloads with flash "<Gateway name> settings saved."
- **Endpoints:**

| Method uri                        | Route name                    | Action                                | Middleware                                   | Request                    | Response                                                                                                                        |
| --------------------------------- | ----------------------------- | ------------------------------------- | -------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| PATCH admin/payment-gateways/{id} | admin.payment-gateways.update | Admin\PaymentGatewayController@update | Authenticate, EnsureUserIsAdmin, IPAllowlist | `mode` (required, `sandbox | live`), `sort_order`(nullable int >= 0),`supported_currencies`(nullable array of strings max 10),`credentials` (nullable array) | redirect back with flash |

- **Data:** writes `payment_gateways.credentials` (encrypted JSON string), `mode`, `sort_order`, `supported_currencies` (JSON list). Reads the driver credential schema for the slug.
- **Rules & edge cases:**
  1. Credentials are stored as ONE ciphertext: the whole key/value JSON (unicode preserved) encrypted with the app key (Laravel `Crypt`, hidden from serialization). Decrypt failure (for example after an app key change) silently returns an empty map, which shows in the UI as no keys saved.
  2. Merge rule: start from the decrypted existing map; for each key that the driver's schema declares AND is present in the submission with a non-empty string, overwrite; everything else is kept. Keys not in the schema are ignored (cannot be injected). CONSEQUENCE: a credential can never be cleared from the UI, only replaced.
  3. `supported_currencies` missing from the request is saved as an empty array (accept all), so a form without the pills would wipe the whitelist. Codes are stored as submitted (the pills submit uppercase); matching later is case-insensitive.
  4. `sort_order` falls back to the current value when blank.
  5. Saving does not change `is_active`, and saving does NOT re-check required fields (only activation does).
  6. Audit: `admin.payment_gateway.updated` with resource = gateway row and meta: mode, list of credential KEYS that were set in this submission (never values), supported currencies.
  7. Unknown id: 404. Gateway with an unknown slug: schema is empty, so nothing merges but mode/sort/currencies still save.
- **Async & events:** audit-log row only.
- **External systems:** none (no call to the provider to validate keys).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a stored Stripe secret, when the admin saves with the secret field blank and mode=live, then the secret is unchanged and mode is live.
  - Given the admin types a new webhook secret, when saved, then only that key is overwritten and the audit meta lists `credential_keys_set:["webhook_secret"]` without any value.
  - Given the request has `mode=production`, when saved, then validation fails with a mode error and nothing is written.
  - Given a submission with `credentials[evil_key]=x`, when saved, then `evil_key` is not stored.
- **Source refs:** app/Http/Controllers/Admin/PaymentGatewayController.php; app/Models/PaymentGateway.php (setEncryptedCredentials/getDecryptedCredentials); app/Support/Audit.php.
- **Port notes:** Encrypt secrets with the platform envelope-encryption helper (KMS/app key with key id in the row) rather than one blob; store credentials as JSONB ciphertext per field or one bytea, but keep the "blank keeps" semantics and ADD an explicit "clear this field" action. Emit an audit row in the same transaction (audit+outbox rule). Validate mode with a shared zod enum in `@crm/contracts`.

### TW-PAYGW-004 — Activate / deactivate with required-field guard

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-PAYGW-003
- **Summary:** A header button flips `is_active`. Activation is refused (with the missing field keys) when any credential the driver marks required is empty, so a half-configured gateway never appears at checkout.
- **Actors & access:** super-admin only.
- **UX & screens:** Activate/Disable button in the card header (its own POST form). Flash "Activated." / "Deactivated." or the error "Configure required fields first: key1, key2" (raw credential keys, not labels).
- **Endpoints:**

| Method uri                              | Route name                    | Action                                | Middleware                                   | Response                 |
| --------------------------------------- | ----------------------------- | ------------------------------------- | -------------------------------------------- | ------------------------ |
| POST admin/payment-gateways/{id}/toggle | admin.payment-gateways.toggle | Admin\PaymentGatewayController@toggle | Authenticate, EnsureUserIsAdmin, IPAllowlist | redirect back with flash |

- **Data:** `payment_gateways.is_active`.
- **Rules & edge cases:**
  1. The guard runs only when going inactive to active. Deactivation always succeeds.
  2. Required = fields whose schema entry has `required: true` (TW-PAYGW-005); "empty" is PHP `empty()` on the stored value, so the string "0" also fails.
  3. Blocked attempt writes audit `admin.payment_gateway.toggle_blocked` (result failure, meta `missing_keys`).
  4. Success writes `admin.payment_gateway.activated` or `.deactivated`.
  5. Gateways with all-optional schema (PhonePe: every field optional; the driver falls back at initiate time) can be activated with nothing set and then fail at the first payment (`phonepe_credentials_missing`). Braintree's `plan_id` is optional and only enables auto-renew.
  6. There is no mode/"live" guard and no test-connection: a gateway can be live-activated with sandbox keys.
  7. Deactivating a gateway does not touch in-flight orders, existing subscriptions, or webhooks: callbacks/webhooks still resolve inactive gateway rows (they look up by slug regardless of `is_active`), and renewals of existing subscriptions keep working.
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given Stripe with no secret_key, when Activate is clicked, then it stays inactive, the flash lists `secret_key`, and a `toggle_blocked` audit row exists.
  - Given all required fields present, when Activate is clicked, then the row is active and the gateway appears on `/checkout/{package}` for a supported currency.
  - Given an active gateway with a live subscription, when it is disabled, then renewal webhooks for that slug are still processed.
- **Source refs:** app/Http/Controllers/Admin/PaymentGatewayController.php (toggle); Documentation/pages/admin-panel/payment-gateways.html (guardrail section).
- **Port notes:** Implement as a domain rule on the gateway aggregate; for the port consider also refusing to activate `live` without a configured webhook secret (Reference enforces that later, at webhook time, see TW-PAYGW-027).

### TW-PAYGW-005 — Per-gateway credential schema

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PAYGW-001
- **Summary:** Each driver declares the credential fields the admin form must render (key, label, type, required, hint, options). This schema drives the form, the merge whitelist (003), the activation guard (004) and the webhook-secret requirement (027).
- **Actors & access:** super-admin (form); server (guards).
- **UX & screens:** rendered inside the cards of TW-PAYGW-002. Types: `text`, `password` (never pre-filled), `textarea` (full width), `select` (with `options`). `hint` shows under the field; `placeholder` when present. An empty schema shows "No credentials required, manual / out-of-band confirmation" (schema-less drivers; in practice none, bank_transfer and offline have fields).
- **Endpoints:** none.
- **Data:** stored keys inside `payment_gateways.credentials`. Schema table (`*` = required, `p` = password type, `t` = text, `a` = textarea):

| Slug          | Fields (key: label)                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| stripe        | publishable_key (t), secret_key* (p), webhook_secret (p)                                                         |
| razorpay      | key_id* (t), key_secret* (p), webhook_secret (p)                                                                 |
| paypal        | client_id* (t), client_secret* (p)                                                                               |
| bank_transfer | beneficiary_name*, bank_name*, account_number*, ifsc_or_swift* (all t), branch (t), notes (a, shown to buyer)    |
| offline       | instructions* (a, shown to buyer)                                                                                |
| mollie        | api_key* (p; live_ / test_)                                                                                      |
| paystack      | public_key* (t), secret_key* (p)                                                                                 |
| flutterwave   | public_key* (t), secret_key* (p), encryption_key (p), secret_hash (p, webhook verif-hash)                        |
| paytm         | merchant_id* (t), merchant_key* (p), website* (t)                                                                |
| square        | application_id* (t), access_token* (p), location_id* (t), webhook_signature_key (p)                              |
| braintree     | merchant_id* (t), public_key* (t), private_key* (p), plan_id (t, enables auto-renew)                             |
| twocheckout   | merchant_code* (t), secret_key* (p), buy_link_secret* (p)                                                        |
| coinbase      | api_key* (p), webhook_secret (p)                                                                                 |
| mercadopago   | access_token* (p), public_key* (t), webhook_secret (p)                                                           |
| iyzico        | api_key* (t), secret_key* (p)                                                                                    |
| paddle        | api_key* (p), product_id* (t), client_token (t), webhook_secret (p)                                              |
| lemonsqueezy  | api_key* (p), store_id* (t), variant_id* (t), signing_secret (p)                                                 |
| authorize_net | api_login_id* (t), transaction_key* (p), signature_key (p)                                                       |
| sslcommerz    | store_id* (t), store_password* (p)                                                                               |
| instamojo     | api_key* (t), auth_token* (p), salt (p)                                                                          |
| phonepe       | client_id, client_secret (p), client_version, merchant_id, salt_key (p), salt_index (all optional; v2 vs legacy) |
| cashfree      | app_id* (t), secret_key* (p)                                                                                     |
| payu          | merchant_key* (t), merchant_salt* (p)                                                                            |
| midtrans      | server_key* (p), client_key* (t)                                                                                 |
| duitku        | merchant_code* (t), api_key* (p)                                                                                 |
| xendit        | secret_key* (p), public_key* (t), webhook_token (p)                                                              |
| tap           | secret_key* (p), publishable_key* (t)                                                                            |
| hyperpay      | access_token* (p), entity_id* (t)                                                                                |
| paytr         | merchant_id* (t), merchant_key* (p), merchant_salt* (p)                                                          |
| fondy         | merchant_id* (t), payment_key* (p)                                                                               |
| skrill        | merchant_id* (t, the Skrill email), secret_word* (p)                                                             |
| cinetpay      | api_key* (t), site_id* (t), secret_key (p, hint "for webhook verification" but never used)                       |
| ligdicash     | api_key* (t), api_token* (p), store_name (t)                                                                     |

- **Rules & edge cases:**
  1. `credentialFieldsFor(slug)` is static per driver class; unknown slug returns an empty schema.
  2. The webhook-secret introspection (027) picks fields whose key, label or hint contains "webhook", "ipn", "signing", or both "signature" and "key". That set is: stripe.webhook_secret, razorpay.webhook_secret, coinbase.webhook_secret, mercadopago.webhook_secret, paddle.webhook_secret, flutterwave.secret_hash, lemonsqueezy.signing_secret, authorize_net.signature_key, square.webhook_signature_key, xendit.webhook_token, instamojo.salt (hint mentions webhook), cinetpay.secret_key (hint mentions webhook).
  3. PayPal, Mollie, Paystack, Cashfree, PayU, Midtrans, Duitku, 2Checkout, Braintree, SSLCommerz, Tap, HyperPay, PayTR, Fondy, Skrill, iyzico, PhonePe, Paytm, Ligdicash, bank_transfer and offline have no webhook-secret field, so the fail-closed check (027) does not apply to them.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the Razorpay card, then it shows Key ID and Key secret as required and Webhook secret as optional with the hint about X-Razorpay-Signature.
  - Given the Bank Transfer card, then notes is a textarea and account_number is required.
  - Given a driver added to the catalogue with a new field, when the admin page loads, then the new field renders and is merged/guarded without further code.
- **Source refs:** app/Services/Payment/Drivers/*.php (`credentialFields`), app/Services/Payment/PaymentGatewayManager.php (`credentialFieldsFor`).
- **Port notes:** Model as a zod schema per adapter exported from the adapter module (single source for form, merge whitelist, required guard). The UI form should be generated from it.

### TW-PAYGW-006 — Supported-currency whitelist and available checkout currencies

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-PAYGW-003
- **Summary:** Each gateway carries an optional whitelist of ISO currency codes. Checkout offers only currencies that some active gateway accepts and only those gateways that accept the chosen currency.
- **Actors & access:** super-admin edits (003); buyers see the effect at checkout.
- **UX & screens:** pill grid in the gateway card (multi-select, live count). At checkout a currency dropdown appears only when more than one currency is available.
- **Endpoints:** none of its own (used by 009, 031).
- **Data:** `payment_gateways.supported_currencies` JSON array; `currencies` table (`is_active`, `code`), `system_settings.default_currency`.
- **Rules & edge cases:**
  1. `acceptsCurrency(code)`: empty/NULL list accepts everything; otherwise case-insensitive membership.
  2. Available checkout currencies = active platform currencies (ascending by code, uppercase, unique; if none active, just the default currency setting, default USD) intersected with the union of whitelists of ACTIVE gateways. If any active gateway has an empty whitelist, or the union is empty, all enabled currencies are available. If the intersection is empty it falls back to all enabled currencies.
  3. Seeder whitelists (initial values, editable): stripe 35 codes (USD EUR GBP JPY CAD AUD CHF INR BRL MXN SGD HKD NOK SEK DKK PLN CZK RON HUF NZD MYR THB PHP IDR TRY ZAR KES NGN AED SAR EGP ILS KRW TWD CNY); paypal 26 codes; razorpay INR; paytm INR; mollie EUR USD GBP CHF SEK NOK DKK PLN CZK HUF RON; paystack NGN GHS ZAR USD KES; flutterwave NGN USD KES EUR GBP GHS ZAR TZS UGX RWF XOF XAF; square USD CAD GBP AUD JPY EUR; braintree 18 codes; twocheckout 23; coinbase USD EUR GBP BTC ETH USDC; mercadopago BRL ARS MXN CLP COP PEN UYU; iyzico TRY USD EUR GBP; paddle 25; authorize_net USD CAD EUR GBP AUD; sslcommerz BDT; instamojo, phonepe, cashfree, payu INR; midtrans IDR; duitku IDR; xendit IDR PHP USD VND MYR THB; tap KWD SAR AED BHD QAR OMR JOD EGP USD EUR GBP; hyperpay SAR AED USD EUR GBP BHD KWD QAR OMR JOD EGP; paytr TRY USD EUR GBP; fondy EUR USD GBP UAH PLN CZK RON HUF RUB; skrill 15 codes; cinetpay XOF XAF CDF GNF USD; bank_transfer, offline, lemonsqueezy, ligdicash: empty (lemonsqueezy/ligdicash were added later and get [] via self-heal; note ligdicash always sends XOF regardless).
  4. The checkout accepts a `currency` field from the client; `process()` re-checks `acceptsCurrency` for the chosen gateway and rejects with "<Gateway> does not support <CUR>.".
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `default_currency` (system setting, default USD).
- **Acceptance criteria:**
  - Given Razorpay (INR only) is the only active gateway, when a buyer opens checkout with `?currency=USD`, then the currency falls back to the package/workspace currency and no currency dropdown is shown.
  - Given Stripe and Razorpay both active, then the dropdown offers the union of their whitelists intersected with active platform currencies.
  - Given a POST with currency=EUR to a gateway whose whitelist lacks EUR, then the order is not created and the error "does not support EUR" shows.
- **Source refs:** app/Models/PaymentGateway.php (acceptsCurrency); app/Http/Controllers/CheckoutController.php (availableCheckoutCurrencies); app/Services/Payment/PaymentGatewayManager.php (activeGateways); database/seeders/PaymentGatewaySeeder.php.
- **Port notes:** keep the whitelist on the gateway row (JSONB array of char(3)); compute availability in a service reused by plan checkout, wallet top-up and the mobile settings endpoint. Consider making the whitelist a provider capability constant rather than admin data.

### TW-PAYGW-007 — Checkout, tax and billing-identity settings

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** none
- **Summary:** One admin form controls everything soft about pricing and checkout: tax on/off/rate/label, refund guarantee copy, yearly-billing toggle and discount, platform-wide auto-renew switch, the country dropdown, and the company identity + logo printed on every invoice.
- **Actors & access:** super-admin only.
- **UX & screens:** `resources/views/admin/checkout-settings/index.blade.php`. Fields and validation:
  - `tax_enabled` (checkbox), `tax_rate` (required int 0..100), `tax_label` (required string max 32).
  - `refund_enabled` (checkbox), `refund_days` (required int 0..365).
  - `yearly_toggle_enabled` (checkbox), `yearly_discount_pct` (required int 0..100).
  - `recurring_enabled` (checkbox).
  - `countries` (textarea, one per line).
  - Company identity: `company_name` (max 160), `company_address` (max 500), `company_tax_id` (64), `company_reg_no` (64), `company_email` (email, 160), `company_phone` (40), `company_logo` (image png/jpg/jpeg/svg/webp, max 1024 KB), `remove_logo` (checkbox).
  - Success flash "Checkout settings saved."; form shows the current uploaded logo and the effective logo URL.
- **Endpoints:**

| Method uri                   | Route name                     | Action                                  | Middleware                                   | Response                 |
| ---------------------------- | ------------------------------ | --------------------------------------- | -------------------------------------------- | ------------------------ |
| GET admin/checkout-settings  | admin.checkout-settings.index  | Admin\CheckoutSettingsController@index  | Authenticate, EnsureUserIsAdmin, IPAllowlist | HTML                     |
| POST admin/checkout-settings | admin.checkout-settings.update | Admin\CheckoutSettingsController@update | same                                         | redirect back with flash |

- **Data:** `system_settings` keys: `checkout.tax_enabled` (bool, default true), `checkout.tax_rate` (int, default 18 in UI/checkout, 0 in `process()` fallback), `checkout.tax_label` (default "GST" on this form, "Tax" at checkout), `pricing.refund_enabled` (true), `pricing.refund_days` (7), `pricing.yearly_toggle_enabled` (true), `pricing.yearly_discount_pct` (20), `pricing.recurring_enabled` (true), `checkout.countries` (JSON list), `billing.company/address/tax_id/reg_no/email/phone` (strings), `billing.logo` (path on the `public` disk). Related but NOT edited here: `payment.require_webhook_secret` (default true, read by TW-PAYGW-027; no UI anywhere sets it).
- **Rules & edge cases:**
  1. Unchecked checkboxes are absent from the POST so they save as false.
  2. Countries: split on any newline sequence, trimmed, blanks dropped, de-duplicated, stored as JSON. When the stored list is empty, the checkout falls back to India, United States, United Kingdom, Other.
  3. Logo: a new upload replaces the path and is stored on the `public` disk under `billing/`; "remove" clears the path (invoices then fall back to the brand logo, then the company wordmark). Uploading and ticking remove together: remove wins.
  4. `Brand::billing()` supplies the invoice header: company falls back to the app name; `Brand::invoiceLogoUrl()` = billing logo else brand logo.
  5. Audit `admin.checkout_settings.updated` with the toggles and numbers and `country_count`.
  6. QUIRK: tax label/rate defaults differ between the form (GST, 18) and `process()` (rate 0 when the setting row is missing); a fresh install with no saved row therefore SHOWS 18% at checkout (`show()` uses 18) but BILLS tax computed with `process()` default of 0 when tax is enabled but the rate row is missing. Port: single source of defaults.
  7. QUIRK: the pricing page and refund copy ("7-day money-back guarantee") on the checkout view is partly hard-coded; only the refund box under the summary reads `refund_days`. No refund flow exists (TW-PAYGW-047).
- **Async & events:** audit row.
- **External systems:** none.
- **Settings:** listed above.
- **Acceptance criteria:**
  - Given tax_enabled=off, when a buyer opens checkout, then no tax line is shown and the order stores tax_rate 0.
  - Given a 5 MB logo upload, when saved, then validation fails on `company_logo` and nothing changes.
  - Given countries "India\nIndia\n Germany", when saved and checkout opened, then the dropdown shows India and Germany once each.
- **Source refs:** app/Http/Controllers/Admin/CheckoutSettingsController.php; resources/views/admin/checkout-settings/index.blade.php; app/Support/Brand.php (billing, invoiceLogoUrl); Documentation/pages/admin-panel/billing-finance.html.
- **Port notes:** owner of the same settings in the port could be SET/PLAN; wherever they land, expose one typed settings object read by checkout, invoices and the mobile app. Route ownership overlap with PLAN (pricing settings) is likely: keep one implementation.

### TW-PAYGW-008 — Driver contract, PaymentResult and HTTP conventions

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PAYGW-001
- **Summary:** Every gateway driver extends one abstract class and speaks one result type, so checkout, callback, webhook, subscriptions, mobile and merchant flows are gateway-agnostic. Drivers use plain HTTP calls (no vendor SDKs).
- **Actors & access:** internal service layer.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** a driver is constructed from a `PaymentGateway` row (mode, decrypted credentials). It receives an `Order` (order_number, amount, currency, package, user, workspace_id, billing fields) and never writes to it.
- **Rules & edge cases:**
  1. Required methods: `credentialFields()` (static), `initiate(order, callbackUrl)`, `handleCallback(payload)`. Optional: `handleWebhook(payload)` (default calls `handleCallback`), `verifyWebhookSignature(rawBody, sigHeader)` (default true), `verify(order)` (default failed `verify_not_implemented`), and the recurring set: `supportsRecurring()` (default false), `createSubscription`, `parseSubscriptionWebhook` (normalised event or null), `fetchSubscription` (poll), `cancelSubscription`, `handleSubscriptionCallback` (default = handleCallback).
  2. `PaymentResult` has `status` (`pending|paid|failed`), `redirectUrl`, `html`, `gatewayOrderId`, `gatewayPaymentId`, `payload`, `error`. Constructors: `redirect(url, gatewayOrderId?, payload?)` (pending), `form(html, gatewayOrderId?, payload?)` (pending), `paid(paymentId?, orderId?, payload?)`, `failed(reason, payload?)`. Error strings are machine-ish (`stripe_secret_key_missing`, `paypal_status: X`) and are stored verbatim in `orders.failure_reason` and shown to the buyer as "Payment failed: <reason>".
  3. Normalised subscription event shape: `{type: created|renewed|canceled|payment_failed, subscription_id, payment_id?, period_end? (unix or ISO), order_id?, gateway_plan_id?}`; poll shape `{status: active|past_due|canceled|expired|pending, period_end?, paid_count?}`.
  4. Billing interval helper `planInterval(order)` maps package `plan_unit` (days/weeks/months/years, anything else = month) and `plan_duration` (min 1) to interval day|week|month|year + count; cycle label yearly only for year.
  5. HTTP: 45 s timeout constant; JSON/form helpers return `[success, body, status, error]`; exceptions are caught in drivers and turned into `failed('<slug>_exception: msg')`. CinetPay and LigdiCash additionally retry twice with 500 ms back-off and connect timeout 20-30 s; CinetPay falls back to DNS-over-HTTPS and pins the IP on resolve failure.
  6. `isLive()` is `mode === 'live'`; `cred(key)` reads the decrypted credential. Most drivers pick sandbox vs live base URL from mode; Paddle picks from the API-key prefix instead.
  7. QUIRK: `verifyWebhookSignature` defaults to accept-all and most drivers accept when their optional secret is blank or the header is absent (see 027), so signature strength varies by driver.
  8. Drivers never persist anything except through the caller; some render Blade views (razorpay-form, bank-transfer, offline, razorpay-subscription-form) for inline HTML, others build HTML strings inline (Braintree Drop-in, Cashfree JS, Hyperpay widget, Midtrans Snap, PayU, Skrill, PayTR iframe, Authorize.Net, Square post-subscription message).
- **Async & events:** none directly.
- **External systems:** every driver; see 014-025.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a driver whose provider call throws, when `initiate` runs, then a `failed('<slug>_exception: ...')` result is returned rather than an exception.
  - Given a driver without `createSubscription`, when the caller requests recurring, then `failed('recurring_not_supported')` is returned.
  - Given a redirect result, then status is `pending` and `redirectUrl` is non-empty.
- **Source refs:** app/Services/Payment/AbstractGatewayDriver.php; app/Services/Payment/PaymentResult.php; app/Services/Payment/PaymentGatewayManager.php.
- **Port notes:** Define a `PaymentProviderPort` in `apps/api/src/infra/providers/payments/` generalising `easebuzz.port.ts`: `initiate`, `verifyCallback` (server-side confirmation, never trust redirect params), `parseWebhook` (verify signature MANDATORY, return normalised event), optional `subscriptions` capability object (`create`, `cancel`, `fetch`, `parseEvent`), `capabilities` (recurring, zero-decimal currencies, hosted-vs-inline) and `minorUnits(amount, currency)` with a proper ISO 4217 exponent table (Reference lacks it). Use the `provider-adapter` and `webhook-handler` skills.

### TW-PAYGW-009 — Plan checkout page

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PAYGW-004, TW-PAYGW-006, TW-PAYGW-007
- **Summary:** `/checkout/{packageId}` shows the buyer their order summary and everything needed to pay: billing details, currency, active gateways, optional auto-renew and coupon, tax and total. Changing currency re-prices and re-lists gateways in place without a reload.
- **Actors & access:** any authenticated user (`Authenticate`); requires a current workspace to actually pay (see 011). Reachable while the trial is expired (`EnsureTrialActive` allows `*checkout*`). Add-on packages use the same page.
- **UX & screens:** `resources/views/checkout/show.blade.php` (layout `x-layouts.user`, page key `checkout-show`, inline script, no bundled JS).
  - 3-step breadcrumb (Choose plan, Checkout, Confirmation), title "Complete your order", hard-coded reassurance copy ("7-day money-back guarantee. Cancel any time. Cards, UPI, netbanking, and wallets accepted."; static regardless of settings).
  - Step 1 Account: full name (required in the browser, prefilled with user name), email (required in the browser, prefilled). The server treats both as optional (falls back to the user's own name/email).
  - Step 2 Billing address: company/workspace (prefilled with workspace name), address, city, postal code, country select (from `checkout.countries`), tax id (placeholder "GSTIN / VAT / EIN").
  - Currency card: only when more than one available currency; a select that fires an AJAX `?ajax=1` call to re-price and rebuild the gateway list without clearing typed billing fields.
  - Step 3 Payment method: radio cards (first gateway pre-checked) showing name, description and a mode badge (the buyer sees "sandbox"/"live"). When no active gateway accepts the currency: an amber notice "No payment gateway is configured for <CUR> yet. Ask your admin to activate one at /admin/payment-gateways" and the Pay button is replaced by a disabled "No gateway configured".
  - Auto-renew checkbox (checked by default) shown only when `recurringEligible`: explains that unchecking buys one cycle with no future charge.
  - Coupon row (input + Apply) unless the flow disables coupons (wallet/credits).
  - Order summary sidebar: item name, "Billed for <duration unit | 12 months | one-time> · subtitle", Change link (to `account.plans`), Subtotal, coupon discount row (hidden until applied), tax row (only when rate > 0, "<label> (<pct>%)"), Total today, Pay button "Pay <amount>" with lock icon, Terms/Privacy links (`legal_url`), and an optional "<N>-day money-back" box when refunds are enabled and days > 0.
  - Hidden inputs: `currency`, `period`. The form posts to `user.checkout.process` (or an override URL for wallet flows).
- **Endpoints:**

| Method uri               | Route name         | Action                  | Middleware   | Request                                | Response          |
| ------------------------ | ------------------ | ----------------------- | ------------ | -------------------------------------- | ----------------- |
| GET checkout/{packageId} | user.checkout.show | CheckoutController@show | Authenticate | query `currency?`, `period?` (`monthly | yearly`), `ajax?` | HTML, or JSON when `ajax` truthy |

- **Data:** reads `packages` (status = 1, else 404), `workspaces` (currency, current plan), `system_settings`, gateways (006). `whereNumber('packageId')`.
- **Rules & edge cases:**
  1. Package not active (`status != 1`): 404. Unauthenticated (only reachable if middleware missed): redirect to login with "Log in to continue.".
  2. Downgrade guard: if the workspace has a current billing package, the target is not an add-on, is a different plan, is not a free plan and not custom-quote, and its `plan_amount` is strictly lower than the current plan's, redirect to `account.plans` with "Downgrades are not available online. Contact support to move to a lower plan." Re-buying the same plan (renewal) and equal-priced plans are allowed. This guard exists ONLY here (see QUIRK in 011).
  3. Currency: `?currency=` is used only if it is in the available list (006); otherwise package currency, else workspace currency, else USD. If the resolved currency is not in the list it is prepended to it.
  4. Amount = package `chargeableAmount()` (offer/discounted price, PLAN) converted with `FormatSettings::convert` from the package currency when it differs, then passed through the period maths (011 rule for `billingPeriodFor` / `amountForPeriod`).
  5. Tax preview = amount x integer tax pct (0 when tax disabled), rounded to 2 decimals; total = amount + tax. The tax shown is an estimate; coupon discount is not applied server-side here.
  6. `recurringEligible` = `pricing.recurring_enabled` AND period is not yearly AND package is not free, lifetime, custom-quote AND `plan_amount > 0`. It does not check whether the chosen gateway can recur (the box is harmless for one-time-only gateways).
  7. AJAX response shape: `{ok:true, currency, amountRaw, amountFmt, taxPct, taxFmt, totalRaw, totalFmt, gateways:[{id,name,description,mode}]}`; formatted strings come from `FormatSettings::formatIn`. The page rebuilds the radios (first checked), disables Pay when the list is empty.
  8. Coupon preview and totals in the browser are optimistic; the server recomputes everything on submit.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `checkout.*` and `pricing.*` keys (007), `default_currency`.
- **Acceptance criteria:**
  - Given a workspace on a $99 plan, when it opens the checkout of a $49 plan, then it is redirected to Plans with the downgrade message.
  - Given package priced in INR and an active gateway supporting INR and USD, when the buyer picks USD in the dropdown, then price, tax and total update via AJAX and the typed address fields survive.
  - Given no active gateway accepts the chosen currency, then the notice is shown and the Pay button is disabled.
  - Given a yearly-eligible monthly plan opened with `?period=yearly`, then the amount is 12 x monthly x (1 - yearly discount) and the auto-renew checkbox is hidden.
- **Source refs:** app/Http/Controllers/CheckoutController.php (show, pricingJson, availableCheckoutCurrencies, billingPeriodFor, amountForPeriod); resources/views/checkout/show.blade.php; app/Support/FormatSettings.php.
- **Port notes:** Next.js page in the workspace app; price quote should be a single API `POST /billing/checkout/quote` returning subtotal/discount/tax/total/gateways/eligibility so the same code serves web and mobile (`resolveAmount` in the mobile controller duplicates part of it). RLS: the quote reads platform data (packages, gateways) and tenant data (workspace currency, current plan). Do not hard-code the marketing copy.

### TW-PAYGW-010 — Coupon preview at checkout

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-PAYGW-009
- **Summary:** The buyer types a coupon and gets an instant discount preview. It is advisory only: the coupon is validated again, authoritatively, when the order is placed.
- **Actors & access:** authenticated user.
- **UX & screens:** coupon input + Apply button on the checkout page (Enter key also applies). Success/failure appears as a toast (`window.toast`); empty input clears the discount. The discount row, tax and total update client-side using `(subtotal - discount) x tax pct`.
- **Endpoints:**

| Method uri                             | Route name                 | Action                         | Middleware   | Request                                                           | Response                                                                                  |
| -------------------------------------- | -------------------------- | ------------------------------ | ------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| POST checkout/{packageId}/apply-coupon | user.checkout.apply-coupon | CheckoutController@applyCoupon | Authenticate | `code` (required string max 64), `amount` (required numeric >= 0) | JSON `{ok, message, discount, code}`; 401 `{ok:false,message:"Log in first."}` if no user |

- **Data:** reads package (status 1, else 404) and calls `Coupon::resolve(code, package, amount, user, currency)` (rules owned by CPN: active window, max uses, minimum order amount, applies-to-plan, currency lock, per-user use).
- **Rules & edge cases:**
  1. The `amount` is supplied by the client (the current subtotal); the server does not recompute it, so the preview can be faked, but it is never trusted for billing.
  2. Preview currency = workspace currency, else package currency, else USD. QUIRK: the binding check in `process()` uses the ORDER currency (chosen currency, else package currency first), so a coupon that is currency-locked can preview OK and be rejected on submit or vice versa.
  3. The wallet and credit checkout flows disable the coupon UI and point `couponUrl` to `#`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a valid 20% code and subtotal 100, when Apply is clicked, then the response is ok with discount 20 and the summary shows a coupon row and recomputed total.
  - Given an expired code, when Apply is clicked, then `ok:false` with the reason message and no discount row.
  - Given an unauthenticated request, then 401 JSON "Log in first.".
- **Source refs:** app/Http/Controllers/CheckoutController.php (applyCoupon); app/Models/Coupon.php (resolve, CPN); resources/views/checkout/show.blade.php (inline script); Documentation/pages/account/account-billing.html.
- **Port notes:** coupon domain belongs to CPN; this feature is just the quote endpoint's `coupon` parameter. Make preview and binding use the same currency and the same server-computed subtotal.

### TW-PAYGW-011 — Place order and start payment

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PAYGW-008, TW-PAYGW-009
- **Summary:** Submitting checkout creates a pending `orders` row with the full price breakdown and billing snapshot, then hands it to the chosen gateway driver, which yields a redirect, an inline payment form, or an immediate paid/failed outcome.
- **Actors & access:** authenticated user with a current workspace (else "No workspace context.").
- **UX & screens:** the checkout form submit; outcomes are (a) browser redirect to the provider, (b) an inline HTML page (bank details, Razorpay modal, Braintree Drop-in, PayU auto-post form and similar) returned as the response body, (c) flash + redirect to `account?tab=orders` ("Payment received. Your plan is now active."), (d) back with an error ("Payment failed: <reason>", "Payment provider error. Try again or pick a different gateway.", "That gateway is not currently available.", "<Gateway> does not support <CUR>.", or the coupon's rejection message with old input kept).
- **Endpoints:**

| Method uri                | Route name            | Action                     | Middleware   | Request                                                                                                                                                                                                                                                                                                                                                                                                                              | Response                      |
| ------------------------- | --------------------- | -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| POST checkout/{packageId} | user.checkout.process | CheckoutController@process | Authenticate | `gateway_id` (required int, exists in payment_gateways), `currency` (nullable string max 10), `customer_name` (nullable max 191), `customer_email` (nullable email max 191), `billing_company` (max 191), `billing_address` (max 255), `billing_city` (max 120), `billing_postal` (max 32), `billing_country` (max 80), `billing_tax_id` (max 64), `coupon` (nullable max 64), `period` (nullable max 16), `auto_renew` (any truthy) | redirect / inline HTML / back |

- **Data:** creates `orders` (see Data model); reads `packages`, `payment_gateways`, `coupons` (via `Coupon::resolve`), `workspaces`, `users`.
- **Rules & edge cases:**
  1. Order number `WSN-<yymmdd>-<6 random upper alphanumerics>`, regenerated until unique. Status starts `pending`.
  2. Currency: request currency, else package currency, else workspace currency, else USD (uppercase). NOTE the package's OWN currency wins over the workspace currency: an IDR plan is charged in IDR. `acceptsCurrency` is enforced.
  3. Amount: `chargeableAmount()` converted from the package currency if different; period maths: `billingPeriodFor` returns `monthly` for add-ons, free, lifetime, custom-quote or free-plan packages; `yearly` when the package is natively yearly (plan_unit years) whether or not the toggle is on; otherwise `yearly` only if the request period is `yearly` AND `pricing.yearly_toggle_enabled`. `amountForPeriod`: monthly unchanged; yearly on a natively-yearly package unchanged (price is already yearly); yearly conversion = amount x 12 x (1 - `pricing.yearly_discount_pct`/100), rounded to 2 dp.
  4. Coupon: re-resolved server side (binding); failure returns back with the message. Discount is subtracted BEFORE tax.
  5. Tax: rate = `checkout.tax_rate` when `checkout.tax_enabled` else 0; `tax_amount = round((amount - discount) x rate / 100, 2)`; `total = (amount - discount) + tax`. Persisted: `amount = total` (what the gateway charges), `total_amount = total`, `discount_amount`, `tax_rate`, `tax_amount`, `coupon_id`, `coupon_code`, `base_amount_usd` = total converted to USD (2 dp). `exchange_rate` is never written.
  6. Billing snapshot: `customer_name`/`customer_email` default to the user, `billing_company` defaults to the workspace name, the rest nullable.
  7. `billing_period` (`monthly|yearly`) and `auto_renew` (bool from checkbox; absent = false) are stored on the order.
  8. Driver choice: recurring path (TW-PAYGW-012) or `initiate(order, callbackUrl)` where `callbackUrl = route('payment.callback', slug)`. Any thrown exception marks the order `failed` with the exception message and shows the generic provider error (message not shown to buyer).
  9. If the result carries `gatewayOrderId`, the order gets `gateway_order_id` and `gateway_payload` = the driver payload (overwrite). A `paid` result is finalised immediately (028); a `failed` result stores `failure_reason` + payload and returns back; a pending result stores `checkout_order_id` in the session (used by callback fallback) then redirects (`redirectUrl`) or returns the inline HTML; neither = "Payment provider did not return a usable response."
  10. QUIRK: the downgrade guard lives only in `show()`. A direct POST can purchase a cheaper plan than the current one (this simply re-prices the workspace plan). Port: enforce server-side in the order service.
  11. QUIRK: not idempotent. Each submit creates a new order; double submits and abandoned checkouts leave `pending` orders forever (no expiry sweeper). Admin can cancel them one by one (039). Port: idempotency key per (workspace, package, cart hash) and an expiry job.
  12. QUIRK: a free / zero-priced package has no free path: total 0 goes to the driver and the provider rejects it. Free plans are switched through the Plans page (PLAN), not checkout.
  13. QUIRK: no per-user rate limit or order cap on this endpoint.
  14. Zero/unsupported amounts, and provider-specific rounding (integer-only Midtrans, Duitku, CinetPay, LigdiCash) are handled inside each driver.
- **Async & events:** no queue. Side effects on paid: 028. Session flag `checkout_order_id`.
- **External systems:** the chosen provider, see 014-025.
- **Settings:** `checkout.tax_*`, `pricing.yearly_*`, `pricing.recurring_enabled`, `default_currency`.
- **Acceptance criteria:**
  - Given a monthly $49 plan, tax 18%, coupon 10 off, when the buyer pays with Stripe in USD, then the order stores discount 10, tax 7.02, total 46.02 and Stripe is asked to charge 46.02.
  - Given a submit for a gateway that is inactive, then no order row is created (the check precedes creation) and the buyer sees "That gateway is not currently available."
  - Given the provider API times out, then the order ends `failed` with the exception text in `failure_reason` and the buyer sees the generic provider error.
  - Given a natively yearly plan with `period=monthly` posted, then the order still bills the plan price once and `billing_period` is `yearly`.
  - Given the workspace-less user, then "No workspace context." and no order.
- **Source refs:** app/Http/Controllers/CheckoutController.php (process, billingPeriodFor, amountForPeriod); app/Models/Order.php; migrations 2026_05_17_040100_create_orders_table.php, 2026_05_21_020000_extend_orders_for_checkout.php, 2026_07_10_000000_add_billing_period_to_orders.php, 2026_07_22_100000_add_auto_renew_to_orders.php; Documentation/pages/account/account-billing.html.
- **Port notes:** target `apps/api/src/modules/billing/orders/` (tenant table `payment_orders` with `org_id`, composite PK `(org_id, id)`, RLS forced; store money as integer minor units + currency exponent instead of decimal(12,2)/(12,4)). Emit outbox events `order.created|paid|failed` in the same transaction; do NOT call the provider inside the DB transaction (create order, commit, call provider, then update by conditional UPDATE). Add idempotency-key support (repo convention) and rate limit.

### TW-PAYGW-012 — Auto-renew subscription start

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-PAYGW-011, TW-PAYGW-029
- **Summary:** For eligible plans the buyer can opt into automatic renewal: instead of a one-time charge the driver creates a recurring subscription at the provider, and a pending `subscriptions` row tracks it until the first charge confirms.
- **Actors & access:** buyer (checkbox); platform switch `pricing.recurring_enabled`.
- **UX & screens:** the "Auto-renew this plan" checkbox on checkout (009). Explanatory copy: pay once, plan runs to the end of the cycle then expires.
- **Endpoints:** part of `POST checkout/{packageId}` (011).
- **Data:** creates `subscriptions` row (status `pending`, gateway slug, billing_cycle `monthly|yearly`, amount = order amount, currency, `meta.order_id`/`order_number`, plus gateway ids when known).
- **Rules & edge cases:**
  1. `shouldRecur` = `pricing.recurring_enabled` AND driver `supportsRecurring()` AND package not free/lifetime/custom-quote AND `plan_amount > 0`. Final decision also requires the buyer's `auto_renew` AND period not yearly. Otherwise the plain one-time `initiate()` runs.
  2. Recurring-capable drivers (11): Stripe, Razorpay, PayPal, Mollie, Paystack, Flutterwave, Paddle, Square, Braintree (only when the optional `plan_id` credential is set), Authorize.Net, Lemon Squeezy. The admin settings screen copy says "Stripe / Razorpay / PayPal" only; the code supports all 11.
  3. `createSubscription` has the same return contract as `initiate`. On any non-failed result the controller calls `SubscriptionService::recordPending` (reuse an existing pending row for the same order id and gateway) with the gateway subscription id extracted from the result payload (explicit `gateway_subscription_id`, Stripe `subscription`, or an `id` starting `sub_` (Razorpay) or `I-` (PayPal), or `is_subscription` + gatewayOrderId), plus `gateway_plan_id` and `gateway_customer_id` (`customer`).
  4. Failure to record the row is logged and swallowed: the payment continues but renewals cannot be matched (they will not renew the plan).
  5. QUIRK: the recurring price is `order->amount` = the FIRST-cycle total after coupon discount and tax. The provider plan is created with that amount, so a one-time coupon discount and the tax rate at purchase time apply to every renewal. Port: price the recurring plan from the list price and apply coupon duration rules explicitly.
  6. QUIRK: some providers get a fresh plan/product created for every checkout (Razorpay plan, PayPal product + plan, Paystack plan, Flutterwave payment plan, Square catalogue plan), so the provider accumulates orphan plans.
  7. Yearly purchases never recur (one 12-month payment), free/lifetime/custom never recur.
- **Async & events:** renewals by provider webhook (029) or reconciler (030).
- **External systems:** per-driver subscription APIs (014-025).
- **Settings:** `pricing.recurring_enabled` (default true).
- **Acceptance criteria:**
  - Given a monthly plan, Stripe, recurring enabled and the box checked, then the driver's `createSubscription` runs, a pending subscription row exists with `meta.order_id` and the buyer is redirected to Stripe.
  - Given the box unchecked, then a one-time charge runs and no subscription row is created.
  - Given Braintree without `plan_id`, then `supportsRecurring()` is false and the purchase is one-time.
  - Given `pricing.recurring_enabled=off`, then the checkbox is hidden and every purchase is one-time.
- **Source refs:** app/Http/Controllers/CheckoutController.php (process, shouldRecur, extractSubscriptionId); app/Services/Payment/SubscriptionService.php (recordPending); app/Models/Subscription.php; Documentation/pages/getting-started/plans-trial.html.
- **Port notes:** subscription is a billing concept shared with PLAN (which owns plan state); keep the table in this module or PLAN but one owner. Provider-specific plan objects should be cached per (provider, price) rather than created per checkout.

### TW-PAYGW-013 — Offline and bank-transfer gateways with payment proof

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-011
- **Summary:** Two manual gateways. Bank Transfer shows the admin's bank details with the order number as reference; Offline shows free-text instructions ("contact sales"). The order stays pending until the buyer uploads a receipt and an admin approves it.
- **Actors & access:** buyer (proof upload): the order's own user, or any user whose current workspace is the order's workspace, or a platform admin. Admin review: 038.
- **UX & screens:** inline pages returned by `process()`.
  - `resources/views/checkout/bank-transfer.blade.php`: "Wire the payment", amount, rows for beneficiary, bank, account number, IFSC/SWIFT, branch (each only if set), notes, and a boxed reminder to use the order number as reference; includes the proof form; footer link "I've sent the payment, submit proof later" to Account > Orders.
  - `resources/views/checkout/offline.blade.php`: "Contact us to complete this order" with order number, amount, currency, the instructions text and the proof form.
  - `resources/views/checkout/partials/proof-form.blade.php`: multipart form: file (JPG/PNG/WEBP/PDF, up to 4 MB, required), Reference / UTR (max 120), Note (max 1000), error banner.
- **Endpoints:**

| Method uri                  | Route name          | Action                         | Middleware   | Request                                                                                                                                               | Response                                                                                                        |
| --------------------------- | ------------------- | ------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| POST checkout/{order}/proof | user.checkout.proof | CheckoutController@submitProof | Authenticate | multipart `proof` (required file, mimes jpeg,jpg,png,webp,pdf, max 4096 KB), `payment_reference` (nullable max 120), `proof_note` (nullable max 1000) | redirect to `account?tab=orders` with "Payment proof submitted. We will verify and activate your plan shortly." |

- **Data:** `orders.payment_proof_path` (stored under `payment-proofs/` on the media disk), `payment_reference`, `proof_note`, `proof_submitted_at`; gateway credentials `bank_transfer.*`, `offline.instructions`.
- **Rules & edge cases:**
  1. Drivers make no network call. `initiate` renders the view, `gatewayOrderId` = the order number; `handleCallback` always returns failed `awaiting_admin_verification`, but the callback route is never hit for these gateways.
  2. Upload allowed only while `status = pending` AND gateway slug is `offline` or `bank_transfer`; otherwise back with "Payment proof can no longer be submitted for this order." (a rejected order is `failed`, so a rejection is final: the buyer must place a new order).
  3. A user outside the three allowed groups gets 403. Unknown order id 404.
  4. Re-uploading while pending overwrites the fields and timestamp; the previous file is NOT deleted (orphan files).
  5. Submitting proof does not change `status`; it only flips `proof_submitted_at`, which is what makes the order appear in the admin "Awaiting approval" panel (038). Orders with no proof are not shown there but still appear in the order history and can be marked paid from the row (038).
  6. The proof file is shown to the admin by `media_url(path)`; there is no access control beyond the storage disk visibility (QUIRK: on a public disk the URL is guessable-adjacent; use signed URLs in the port).
  7. Works for wallet top-up orders too: approval runs the same fulfilment which credits the wallet.
- **Async & events:** none; no notification is sent to the admin or buyer (QUIRK: admins must poll the queue).
- **External systems:** none.
- **Settings:** the gateway credential fields; media disk (SET).
- **Acceptance criteria:**
  - Given a pending bank-transfer order, when the buyer uploads a 2 MB PDF with reference "UTR123", then `proof_submitted_at` is set and the order shows in Awaiting approval.
  - Given a 6 MB image, then the upload is rejected with a validation error and nothing is stored.
  - Given an order already `paid`, when a proof is posted, then "can no longer be submitted".
  - Given a user from another workspace who is not the buyer nor admin, then 403.
- **Source refs:** app/Services/Payment/Drivers/BankTransferDriver.php; app/Services/Payment/Drivers/OfflineDriver.php; app/Http/Controllers/CheckoutController.php (submitProof); resources/views/checkout/bank-transfer.blade.php; resources/views/checkout/offline.blade.php; resources/views/checkout/partials/proof-form.blade.php; migrations 2026_06_05_120000_add_payment_proof_to_orders.php.
- **Port notes:** store proofs in object storage (MinIO) with per-org prefix and signed read URLs; virus/size/MIME checks; emit `order.proof_submitted` outbox event to notify platform admins (NOTIF). Consider making bank details per currency.

### TW-PAYGW-014 — Stripe driver

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PAYGW-008
- **Summary:** Card payments through Stripe Checkout Sessions (hosted page), one-time and recurring, with plain REST calls.
- **Actors & access:** buyer (redirected); admin configures publishable key, secret key, webhook secret.
- **UX & screens:** buyer is redirected to `session.url`; returns to `/payment/callback/stripe?session_id=cs_...` (success) or `?cancelled=1`.
- **Endpoints:** provider calls: `POST https://api.stripe.com/v1/checkout/sessions` (basic auth, secret key, form-encoded), `GET /v1/checkout/sessions/{id}`, `DELETE /v1/subscriptions/{id}`. Inbound: `/payment/callback/stripe`, `/payment/webhook/stripe` (header `Stripe-Signature`).
- **Data:** stores session id in `orders.gateway_order_id`, the payment intent id in `gateway_payment_id`, the full session JSON in `gateway_payload`.
- **Rules & edge cases:**
  1. One-time session: mode `payment`, one line item with inline `price_data` (currency lowercased, `unit_amount = round(amount x 100)`, product name = package name else "<app name> plan"), `client_reference_id` = order number, metadata `order_id` and `workspace_id`, success url `{callback}?session_id={CHECKOUT_SESSION_ID}`, cancel url `{callback}?cancelled=1`.
  2. Callback: `cancelled` set gives failed `cancelled_by_user`; missing session id gives `missing_session_id`; otherwise fetch the session and require `payment_status = paid` (then paid with payment intent id, payload = session); else failed `payment_status: <x>`.
  3. Webhook signature: if `webhook_secret` is blank OR the header is absent the request is accepted; otherwise HMAC-SHA256 of `"<t>.<rawBody>"` must equal the `v1` value. QUIRK: no timestamp tolerance check (replayable).
  4. Recurring (`supportsRecurring` = true): Checkout Session mode `subscription` with inline `price_data[recurring][interval|interval_count]` (from package plan unit/duration) and subscription metadata `order_id`/`workspace_id`. Event mapping: `invoice.paid` / `invoice.payment_succeeded` with a subscription id: `created` when `billing_reason = subscription_create` else `renewed` (period end from first line period end, else invoice `period_end`; order id from subscription/line metadata); `invoice.payment_failed`: `payment_failed`; `customer.subscription.deleted`: `canceled`; `checkout.session.completed` in subscription mode: `created`.
  5. Cancel = immediate `DELETE /v1/subscriptions/{id}` (no cancel-at-period-end); local plan window is left to expire.
  6. The Stripe session for a subscription has no payment intent at completion, so `gateway_payment_id` is empty for recurring orders.
  7. QUIRK: one-time Stripe orders are confirmed only by the buyer's return (callback); the async webhook cannot finalise them (see 027). If the buyer closes the tab after paying the order stays pending forever.
  8. QUIRK: amount is always x100 (wrong for zero-decimal currencies such as JPY/KRW which the default whitelist allows: charge would be 100x too high). Port: exponent table.
  9. Mobile PaymentSheet flow (customer + ephemeral key + payment intent) lives in the MOB endpoint `api/app/stripe/create-payment-intent`, not here.
- **Async & events:** webhook `payment.webhook` for subscription events.
- **External systems:** Stripe REST API; secret key in admin gateway credentials.
- **Settings:** credentials `publishable_key`, `secret_key*`, `webhook_secret`; mode is informational (key prefix decides test/live at Stripe).
- **Acceptance criteria:**
  - Given a paid Checkout Session, when the buyer returns with `session_id`, then the driver fetches it, sees `paid`, and the order is finalised with `gateway_payment_id` = the payment intent.
  - Given `cancelled=1`, then the order is marked failed with reason `cancelled_by_user`.
  - Given a webhook with a valid `t=..,v1=..` header for `invoice.paid` (subscription_create), then a `created` event activates the subscription.
  - Given a tampered body and a configured webhook secret, then the webhook is rejected 403 `signature_mismatch`.
- **Source refs:** app/Services/Payment/Drivers/StripeDriver.php; Documentation/pages/admin-panel/payment-gateways.html.
- **Port notes:** use Stripe Checkout with `client_reference_id` + metadata; verify webhook with the official signature scheme including a 5-minute tolerance, and finalise one-time orders from `checkout.session.completed` too (idempotently), not only from the browser return.

### TW-PAYGW-015 — Razorpay driver

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PAYGW-008
- **Summary:** Indian cards, UPI, netbanking and wallets via Razorpay Standard Checkout (modal), one-time and recurring.
- **Actors & access:** buyer; admin credentials key id, key secret, webhook secret.
- **UX & screens:** `resources/views/checkout/razorpay-form.blade.php` (blank page "Opening Razorpay..." that loads `checkout.razorpay.com/v1/checkout.js` and opens the modal with key, amount, currency, brand name, order number, order id). On success a hidden form posts `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` to the callback; on dismiss the browser goes to `{callback}?cancelled=1`. `resources/views/checkout/razorpay-subscription-form.blade.php` does the same for a subscription id (posts payment id, subscription id, signature).
- **Endpoints:** provider: `POST /v1/orders`, `POST /v1/plans`, `POST /v1/subscriptions`, `GET /v1/subscriptions/{id}`, `POST /v1/subscriptions/{id}/cancel` (basic auth key id/secret). Inbound: callback (POST from the form) and webhook (header `X-Razorpay-Signature`).
- **Data:** `gateway_order_id` = Razorpay order id (`order_...`) or subscription id (`sub_...`); `gateway_payment_id` = `pay_...`; payload = Razorpay order/subscription JSON (or callback payload plus `is_subscription`).
- **Rules & edge cases:**
  1. Order: amount = round(amount x 100), currency uppercased, receipt = order number, notes carry order id and workspace id.
  2. Callback verification is signature only (no API fetch, no amount check): HMAC-SHA256(`order_id|payment_id`, key_secret) for orders; HMAC-SHA256(`payment_id|subscription_id`, key_secret) for subscriptions. Missing params fail as `missing_razorpay_params` / `missing_razorpay_sub_params`; mismatch `razorpay_signature_mismatch`. The dismiss redirect (`cancelled=1`, no params) therefore fails with `missing_razorpay_params`, and the order is marked failed.
  3. Order lookup at the callback uses `razorpay_order_id` or `razorpay_subscription_id` (matched to `gateway_order_id`), so the callback works without a session.
  4. Recurring: plan (period daily/weekly/monthly/yearly, interval = plan duration, item name = package name, amount minor, currency) then subscription (`total_count` 120 monthly / 10 yearly / 520 weekly / 3650 daily, `customer_notify` 1). `gatewayOrderId` = `sub_...` so `recordPending` stores it immediately, and `gateway_plan_id` is kept.
  5. Events: `subscription.charged` becomes `renewed` (first charge AND every renewal; the controller treats a still-pending local row as the activation), period end = `current_end`; `subscription.cancelled` / `.completed` = `canceled`; `subscription.halted` / `.pending` = `payment_failed`.
  6. `fetchSubscription` (used by the reconciler, 030): status map active/authenticated/completed to active, pending/halted to past_due, cancelled to canceled, expired to expired, else pending; returns `current_end` and `paid_count`. Razorpay is the ONLY driver that implements polling.
  7. Cancel: `cancel_at_cycle_end = 0` (immediate).
  8. Webhook signature: HMAC-SHA256 of the raw body with `webhook_secret`; accepted when the secret is blank or the header absent. But the controller rejects Razorpay webhooks outright unless `webhook_secret` is set (027).
  9. Only INR is in the seeded whitelist; the driver itself passes any currency.
- **Async & events:** subscription webhooks; reconciler.
- **External systems:** Razorpay REST API, `checkout.razorpay.com` JS.
- **Settings:** credentials `key_id*`, `key_secret*`, `webhook_secret`.
- **Acceptance criteria:**
  - Given a valid signature over `order_id|payment_id`, when the callback posts, then the order is paid with the payment id.
  - Given a wrong signature, then the order is failed with `razorpay_signature_mismatch`.
  - Given a `subscription.charged` webhook for an active local subscription, then the workspace plan window is extended by one cycle (or to `current_end`).
  - Given the buyer dismisses the modal, then the order is marked failed and the buyer lands on Orders with the failure message.
- **Source refs:** app/Services/Payment/Drivers/RazorpayDriver.php; resources/views/checkout/razorpay-form.blade.php; resources/views/checkout/razorpay-subscription-form.blade.php.
- **Port notes:** treat a dismissed modal as "cancelled", not "failed" (do not burn the order); support `payment.captured` webhook to finalise when the browser never returns; store the Razorpay plan id per package to avoid creating a plan per checkout.
- **Port status (billing hardening):** the Razorpay plan id is cached per account, price and cadence (`gateway_plan_cache`), and replaced once if the provider no longer has it. `payment.captured` that carries an `invoice_id` belongs to a subscription charge and is ignored as a payment (the subscription event settles it). Recurring add-ons and the grace period are documented in `docs/api/addons-extension-registry.md` and `docs/api/plans-subscriptions-trials.md`.

### TW-PAYGW-016 — PayPal driver

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PAYGW-008
- **Summary:** PayPal Checkout (Orders v2, capture on return) and PayPal Subscriptions (billing plans), sandbox or live by the gateway mode.
- **Actors & access:** buyer; admin credentials client id and secret.
- **UX & screens:** redirect to the PayPal approval link; return to `/payment/callback/paypal?token=<orderId>` (or `?subscription_id=I-...`, or `?cancelled=1`).
- **Endpoints:** base `api-m.sandbox.paypal.com` or `api-m.paypal.com`: `POST /v1/oauth2/token` (client credentials), `POST /v2/checkout/orders`, `POST /v2/checkout/orders/{id}/capture`, `POST /v1/catalogs/products`, `POST /v1/billing/plans`, `POST /v1/billing/subscriptions`, `GET /v1/billing/subscriptions/{id}`, `POST /v1/billing/subscriptions/{id}/cancel`.
- **Data:** `gateway_order_id` = PayPal order id or subscription id (`I-...`); `gateway_payment_id` = capture id (one-time) or the subscription id.
- **Rules & edge cases:**
  1. Order intent CAPTURE, purchase unit reference = order number, amount formatted 2 decimals, description = package name, shipping preference NO_SHIPPING, user action PAY_NOW, return/cancel URLs from the callback URL (`?cancelled=1`).
  2. Callback: cancelled gives `cancelled_by_user`; subscription id present routes to subscription confirmation; else `token` is required and the driver captures the order now (money moves at return), success only when status `COMPLETED`.
  3. Subscription: creates a product ("<app> subscription", SERVICE/SOFTWARE), a plan (`interval_unit` uppercase, `total_cycles` 0 = infinite, fixed price, `auto_bill_outstanding`, failure threshold 1) and a subscription with `custom_id` = order id and `SUBSCRIBE_NOW`; a product + plan is created per checkout.
  4. Subscription confirmation: `GET` subscription; status `ACTIVE` or `APPROVED` gives paid with `current_period_end = billing_info.next_billing_time`.
  5. Events: `PAYMENT.SALE.COMPLETED` (requires `billing_agreement_id`) `renewed`; `BILLING.SUBSCRIPTION.ACTIVATED` `created` (period end next billing time, order id from `custom_id`); `.CANCELLED`/`.EXPIRED` `canceled`; `.PAYMENT.FAILED`/`.SUSPENDED` `payment_failed`.
  6. Cancel posts reason "Cancelled by user"; HTTP 204 = ok.
  7. QUIRK (security): the driver has NO webhook signature verification and PayPal has no webhook-secret credential, so the fail-closed rule (027) does not apply: any unauthenticated POST shaped like `PAYMENT.SALE.COMPLETED` with a known `I-...` id will renew that subscription. Port: verify with PayPal's verify-webhook-signature API.
  8. QUIRK: one-time PayPal orders are confirmed only by the buyer return (which captures); a buyer who approves and never returns leaves an uncaptured PayPal order.
- **Async & events:** subscription webhooks.
- **External systems:** PayPal REST API v1/v2.
- **Settings:** credentials `client_id*`, `client_secret*`; mode selects the base URL.
- **Acceptance criteria:**
  - Given approval and return with `token`, when the capture returns `COMPLETED`, then the order is paid with the capture id.
  - Given the buyer cancels on PayPal, then the return has `cancelled=1` and the order is failed `cancelled_by_user`.
  - Given a recurring checkout and approval, when the return carries `subscription_id` and PayPal reports ACTIVE, then the pending subscription is activated with the next billing time as period end.
- **Source refs:** app/Services/Payment/Drivers/PayPalDriver.php; Documentation/pages/admin-panel/payment-gateways.html.
- **Port notes:** add `webhook_id` credential + signature verification; handle `CHECKOUT.ORDER.APPROVED` / `PAYMENT.CAPTURE.COMPLETED` webhooks to finalise without the browser; reuse one PayPal product/plan per price.

### TW-PAYGW-017 — Paddle driver, built-in overlay page and return catcher

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-008
- **Summary:** Paddle Billing (merchant of record): a transaction is created with an inline non-catalogue price and the buyer pays in a Paddle.js overlay that the app itself hosts, so payment works without any Paddle "default payment link" configuration.
- **Actors & access:** buyer; admin credentials API key, product id (required), client-side token (optional but needed for the overlay), webhook secret.
- **UX & screens:** `resources/views/payment/paddle-checkout.blade.php` (public, `noindex`): spinner "Opening secure checkout...", loads `cdn.paddle.com/paddle/v2/paddle.js`, initialises with the client token, sets the environment, opens the overlay for the transaction; retries up to about 6 s waiting for the library, an "Open payment window" retry button, a "Cancel and go back" link to Orders, order number; on `checkout.completed` the browser goes to the success URL (`/payment/callback/paddle?_ptxn=<txn>`).
- **Endpoints:**

| Method uri                          | Route name              | Action                            | Middleware    | Response                                   |
| ----------------------------------- | ----------------------- | --------------------------------- | ------------- | ------------------------------------------ |
| GET payment/paddle/checkout/{order} | payment.paddle.checkout | CheckoutController@paddleCheckout | none (public) | HTML overlay page or redirect with a flash |

Provider: `POST {base}/transactions`, `GET {base}/transactions/{id}`, `POST {base}/subscriptions/{id}/cancel`.

- **Data:** `gateway_order_id` = transaction id (`txn_...`); `gateway_payload` = Paddle transaction data.
- **Rules & edge cases:**
  1. Base URL is chosen by the API-key prefix (`pdl_sdbx_` sandbox, `pdl_live_` production), falling back to the admin mode toggle; the overlay environment mirrors it. API key and client token are cleaned (drop `Bearer ` prefix, quotes and every non printable ASCII byte incl. NBSP/zero-width/BOM). A `pdl_` key whose length is not 69 (or legacy 50) is rejected with an explanatory "key incomplete" error before calling Paddle. The message hints when the Client-side token was pasted into the API key field.
  2. Transaction body: one item with inline price (description = "Order #n", product id, `billing_cycle` null, unit price = amount x 100 as a string, currency uppercased), `custom_data` order id/number. With a client token configured the buyer is redirected to the in-app overlay route (`?txn=`), otherwise to Paddle's own returned checkout URL (works only if the dashboard default payment link is a real checkout).
  3. Overlay route: unknown order gives redirect "Order not found."; already paid gives redirect to Orders "This order is already paid."; a gateway that is not the Paddle driver gives "This order is not a Paddle payment."; missing txn or client token gives "Paddle checkout is not fully configured (client-side token missing). Contact support." It also sets `checkout_order_id` in the session so the callback works in incognito.
  4. Return catcher: middleware `PaddleReturnRedirect` (prepended to the web group) forwards ANY web GET carrying `?_ptxn=` (except payment callback/webhook paths) to `/payment/callback/paddle?_ptxn=...`, fixing Paddle's "default payment link" landing on the marketing homepage. `_ptxn` is also an order-match hint in the callback.
  5. Callback: `transaction_id` or `_ptxn` required; if the request itself says `status=completed|paid` the driver returns PAID WITHOUT verifying; otherwise it calls `GET /transactions/{id}` and pays on `completed|paid`, else returns a `pending` result with the real Paddle status as error. QUIRK (security): a buyer can call `/payment/callback/paddle?_ptxn=<their own pending order's txn id>&status=completed` and be marked paid without paying. Port: always verify with the API (or webhook), never trust the query.
  6. A `pending` callback result is treated as a failure by the controller (026): the order is marked failed with the Paddle status text.
  7. Webhook signature header used by Paddle is `Paddle-Signature` (`ts=..;h1=..`, HMAC-SHA256 of `ts:body`), but the controller never forwards that header, so the check is skipped (accepted). The controller still requires `webhook_secret` to be set (027).
  8. `transaction.completed` (one-time) is reported paid but carries no order id in a field the controller's hint list reads, so it does not finalise the order; only the callback does.
  9. Recurring: transaction with a real `billing_cycle` (interval + frequency) and `collection_mode` automatic, redirect to Paddle's returned checkout URL (NOT the overlay). Events: `transaction.completed` with `subscription_id` `renewed`; `subscription.created`/`.activated` `created` (period end = current billing period end); `subscription.canceled` `canceled`; `transaction.payment_failed` `payment_failed`. Cancel with `effective_from = next_billing_period`.
- **Async & events:** subscription webhooks.
- **External systems:** Paddle Billing API (`api.paddle.com` / `sandbox-api.paddle.com`), Paddle.js CDN.
- **Settings:** credentials `api_key*`, `product_id*`, `client_token`, `webhook_secret`.
- **Acceptance criteria:**
  - Given a client token, when a buyer checks out with Paddle, then they land on `/payment/paddle/checkout/{order}?txn=...` and the overlay opens for that transaction.
  - Given Paddle redirects to `/?_ptxn=txn_1`, then the middleware forwards to `/payment/callback/paddle?_ptxn=txn_1` which verifies via API and finalises.
  - Given an API key of the wrong length, then checkout fails with the "incomplete key" message and no Paddle call is made.
- **Source refs:** app/Services/Payment/Drivers/PaddleDriver.php; app/Http/Controllers/CheckoutController.php (paddleCheckout); app/Http/Middleware/PaddleReturnRedirect.php; resources/views/payment/paddle-checkout.blade.php.
- **Port notes:** keep the hosted-overlay approach (Paddle.js inline checkout in a Next.js route, environment from the key prefix); verify via API or signed `transaction.completed` webhook keyed on `custom_data.order_id`.

### TW-PAYGW-018 — Lemon Squeezy driver

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-PAYGW-008
- **Summary:** Hosted checkout via Lemon Squeezy with a custom price on a pre-created variant. Subscription events work; one-time confirmation does not have a working path in the code.
- **Actors & access:** buyer; admin credentials API key, store id, variant id (all required), signing secret.
- **UX & screens:** redirect to the checkout URL; return to `/payment/callback/lemonsqueezy`.
- **Endpoints:** `POST https://api.lemonsqueezy.com/v1/checkouts` (JSON:API headers), `DELETE /v1/subscriptions/{id}`. Inbound webhook.
- **Data:** `gateway_order_id` = checkout id.
- **Rules & edge cases:**
  1. Checkout body: `custom_price` = amount x 100, `product_options.redirect_url` = callback, `checkout_data.email` (order email, else user email), `checkout_data.custom` order id/number/workspace, store + variant relationships. `initiate` and `createSubscription` are the same call: whether the result is recurring is determined by the variant's product configuration at Lemon Squeezy, while the app treats it as recurring only when `auto_renew` and eligibility say so.
  2. `handleCallback` ALWAYS returns `pending`; the controller turns a pending callback into a failed order (026). QUIRK: every one-time Lemon Squeezy purchase is marked failed on return.
  3. Webhook: signature is HMAC-SHA256 of the body compared with the header `X-Signature`; the controller does not forward `X-Signature` (027), so with a signing secret set the driver sees no header and REJECTS (403 `signature_mismatch`), and with no secret set the controller's fail-closed rule rejects it (403 `webhook_secret_not_configured`). Net effect with defaults: no Lemon Squeezy webhook is ever accepted, so recurring events never arrive; only the reconciler (which has no poller for this driver) or an admin manual approval can help. The only way through is to set `payment.require_webhook_secret` = false and leave the signing secret blank (unauthenticated).
  4. `order_created` with status `paid` maps to paid but carries no order-id hint field; subscription events (`subscription_created`, `subscription_payment_success|recovered`, `subscription_cancelled|expired`, `subscription_payment_failed`) carry `meta.custom_data.order_id` and would match through the pending subscription row.
  5. Cancel: DELETE subscription (Lemon Squeezy cancels at period end on its side).
- **Async & events:** webhook (blocked by 3).
- **External systems:** Lemon Squeezy API v1.
- **Settings:** credentials as above.
- **Acceptance criteria:**
  - Given valid credentials, when a buyer starts checkout, then a checkout URL is created for the variant with the order total as custom price.
  - Given a one-time purchase and the buyer returns, then (as built) the order is marked failed although paid: the port must NOT reproduce this, it must confirm through the signed webhook or the API.
- **Source refs:** app/Services/Payment/Drivers/LemonSqueezyDriver.php; app/Http/Controllers/CheckoutController.php (webhook header list).
- **Port notes:** implement properly with signature header `X-Signature`, order matching by `meta.custom_data.order_id`, and idempotent finalisation on `order_created` (status paid) and `subscription_payment_success`.

### TW-PAYGW-019 — Mollie driver

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-PAYGW-008
- **Summary:** Mollie hosted payments (iDEAL, cards, Bancontact, SEPA, Klarna). Recurring works through a mandate-first flow; one-time payments cannot reach the paid state through the controller as written.
- **Actors & access:** buyer; admin credential `api_key` (live_/test_).
- **UX & screens:** redirect to Mollie checkout; return to `/payment/callback/mollie?order_number=...`.
- **Endpoints:** `https://api.mollie.com/v2` `POST /payments`, `GET /payments/{id}`, `POST /customers`, `POST /customers/{id}/subscriptions`, `DELETE /customers/{id}/subscriptions/{id}`. Webhook URL passed per payment = `route('payment.webhook','mollie')`.
- **Data:** `gateway_order_id` = payment id (`tr_...`); recurring keeps the customer id (`cst_...`) in the subscription row.
- **Rules & edge cases:**
  1. Payment: amount formatted 2 decimals in the order currency (default EUR), description "Order #n", redirect URL with `order_number`, metadata order id/number.
  2. Redirect carries no payment id, so `handleCallback` returns `pending` and the controller marks the order failed (026). The Mollie webhook posts `id=tr_...`; `handleWebhook` verifies via API and returns paid, but the controller cannot map the flat `id` to an order (the hint list does not include it), so the order is never finalised. QUIRK: one-time Mollie purchases never activate a plan without admin approval.
  3. Recurring: create customer (name/email from the buyer), then a first payment with `sequenceType=first` and the customer (metadata `recurring=1`); on return the local pending subscription makes the controller call `handleSubscriptionCallback` which reads the stored payment id, requires `paid`, then creates the Mollie subscription (interval `N days|weeks|months`, year = `12 months`, description "Sub <order number>" unique per customer, webhook URL) and returns paid with the subscription id as order id, customer id and `nextPaymentDate` as period end. This path works.
  4. `parseSubscriptionWebhook` fetches the posted payment to see a `subscriptionId`: paid = `renewed`, otherwise `payment_failed`; a non-subscription payment returns null.
  5. Cancel needs the stored customer id (context); missing gives `mollie_cancel_context_missing`.
  6. `verify(order)` re-checks a payment by id (not called by any web flow).
- **Async & events:** webhooks.
- **External systems:** Mollie API v2 (bearer API key).
- **Settings:** `api_key*`.
- **Acceptance criteria:**
  - Given a recurring purchase, when the first payment is paid and the buyer returns, then a Mollie subscription is created and the local subscription becomes active with the next payment date.
  - Given a one-time purchase (as built), after paying at Mollie the buyer returns to an order marked failed: the port must instead confirm via the webhook matched on the stored payment id.
- **Source refs:** app/Services/Payment/Drivers/MollieDriver.php.
- **Port notes:** on redirect return look the order up by our own `order_number` query param and re-fetch the payment by the stored `gateway_order_id`; implement the webhook with the id lookup.

### TW-PAYGW-020 — Paystack and Flutterwave drivers

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-008
- **Summary:** The two pan-African gateways: Paystack (cards, bank, USSD, mobile money in NG/GH/ZA/KE) and Flutterwave (Rave standard payments), both one-time and recurring.
- **Actors & access:** buyer; admin credentials.
- **UX & screens:** hosted-page redirects; return to `/payment/callback/{paystack|flutterwave}`.
- **Endpoints:** Paystack `https://api.paystack.co`: `POST /transaction/initialize`, `GET /transaction/verify/{ref}`, `POST /plan`, `GET /subscription/{code}`, `POST /subscription/disable`. Flutterwave `https://api.flutterwave.com/v3`: `POST /payments`, `GET /transactions/{id}/verify` or `/transactions/verify_by_reference`, `POST /payment-plans`, `GET /subscriptions`, `PUT /subscriptions/{id}/cancel`. Both bearer secret key.
- **Data:** `gateway_order_id` = Paystack `reference` (`<order>_<unix>`) / Flutterwave `tx_ref` (`FLW_<order>_<unix>`, `FLWSUB_...` for recurring); `gateway_payment_id` = transaction id.
- **Rules & edge cases:**
  1. Both REQUIRE a buyer email (`paystack_customer_email_missing`, `flutterwave_customer_email_missing`).
  2. Paystack initialize: email, amount x 100 (kobo), currency (default NGN), reference, callback URL, metadata order id/number. Verify: `data.status = success` and top-level `status = true` gives paid with `data.id`.
  3. Callback order lookup: neither `reference`, `trxref`, `tx_ref` nor `transaction_id` is in the controller's hint list, so the order is found only through the session (`checkout_order_id`). A buyer returning in a different browser/device gets "Order not found." and is redirected to Plans, even though they paid. QUIRK.
  4. Paystack webhook signature = HMAC-SHA512 of the raw body with the secret key vs header `x-paystack-signature` (forwarded); if a header is missing the request is rejected. `charge.success` maps to paid, but no order-id hint field matches the payload so the one-time order is not finalised from the webhook (QUIRK, 027).
  5. Paystack recurring: create a Plan (interval daily/weekly/monthly/annually, amount, currency) then initialize WITH the plan; the plan code is the join key until `subscription.create` supplies `subscription_code`. Events: `subscription.create` created (period end next payment date); `invoice.update|create` renewed/payment_failed by `status = success` or `paid = true` (needs `subscription.subscription_code`); `invoice.payment_failed`; `subscription.disable|not_renew` canceled. Cancel needs the subscription's `email_token` (fetched first) then disable.
  6. Flutterwave payment link: `payment_options` fixed to `card,mobilemoney,ussd,banktransfer`, customer email/name, customizations title/description, meta order id/number. A specific User-Agent and `Accept: application/json` are sent to get past Flutterwave's Cloudflare bot challenge; failures produce a diagnostic message (wrong key type FLWSECK vs FLWPUBK, or an HTML edge block).
  7. Flutterwave callback: `status=cancelled` fails; verify by `transaction_id` else `tx_ref`; success requires top-level `status = success` and `data.status = successful`.
  8. Flutterwave webhook: header `verif-hash` compared verbatim (NOT HMAC) with `secret_hash`; blank hash accepts. `charge.completed` + successful maps to paid (no order-id hint match).
  9. Flutterwave recurring: create a payment plan then a hosted charge with `payment_plan`; the PLAN id doubles as the subscription id (`gateway_subscription_id`). Rebill events are `charge.completed` carrying `payment_plan`; `subscription.cancelled` cancels. Cancel looks up the first subscription for the plan then cancels it. QUIRK: because the plan id is the join key, two workspaces never share a plan (a plan is created per checkout), otherwise renewals would mix.
- **Async & events:** webhooks; reconciler has no poll for these.
- **External systems:** Paystack and Flutterwave APIs.
- **Settings:** Paystack `public_key*`, `secret_key*`; Flutterwave `public_key*`, `secret_key*`, `encryption_key`, `secret_hash`.
- **Acceptance criteria:**
  - Given a successful Paystack verify for the returned reference, then the order is paid with the transaction id.
  - Given a Flutterwave transaction `successful`, when the buyer returns, then the order is finalised and their plan applied.
  - Given the buyer's session is lost, then (as built) Paystack/Flutterwave returns show "Order not found."; the port must match by our own reference.
  - Given a Paystack webhook with a bad HMAC, then 403.
- **Source refs:** app/Services/Payment/Drivers/PaystackDriver.php; app/Services/Payment/Drivers/FlutterwaveDriver.php.
- **Port notes:** put our order number inside the provider reference so it can be parsed on return/webhook; verify server-to-server; Flutterwave webhook should use the documented `verif-hash` header (constant-time compare) and match by `tx_ref`.

### TW-PAYGW-021 — Square, Braintree and Authorize.Net drivers

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** TW-PAYGW-008
- **Summary:** The three US/CA-centric card processors, one-time and recurring.
- **Actors & access:** buyer; admin credentials.
- **UX & screens:** Square: redirect to a Square payment link. Braintree: inline Drop-in page (script from `js.braintreegateway.com`, cardholder name required, a "Pay Now" button that posts `payment_method_nonce`, `order_number`, `amount` and CSRF to the callback). Authorize.Net: an auto-submitted form to the Accept Hosted page.
- **Endpoints:** Square `connect.squareup(sandbox).com/v2` (`Square-Version: 2024-01-18`): `POST /online-checkout/payment-links`, `GET /orders/{id}`, `GET /payments/{id}`, `POST /catalog/batch-upsert`, `POST /customers`, `POST /subscriptions`, `POST /subscriptions/{id}/cancel`. Braintree XML gateway `api(.sandbox).braintreegateway.com:443/merchants`: `client_token`, `transactions`, `customers`, `subscriptions`, `subscriptions/{id}/cancel`. Authorize.Net `api(test).authorize.net/xml/v1/request.api` (JSON) + hosted page `accept.authorize.net/payment/payment`.
- **Data:** Square `gateway_order_id` = Square order id; Braintree = subscription id (recurring) / transaction id; Authorize.Net = order number initially, ARB subscription id for recurring.
- **Rules & edge cases:**
  1. Square one-time: payment link with an idempotency key, one line item = "Order #n", `redirect_url` = callback, no shipping/tips; callback needs `orderId`/`order_id` and requires order `state = COMPLETED` (`transactionId`/`checkoutId` alone gives pending). Webhook signature = base64 HMAC-SHA256 of `notificationUrl + rawBody` with `webhook_signature_key` (header `x-square-hmacsha256-signature`, forwarded); `payment.created|updated` with `COMPLETED` maps to paid.
  2. Square recurring: catalogue batch-upsert (subscription plan + variation with cadence DAILY/WEEKLY/MONTHLY/ANNUAL and static price), create customer (email required), create subscription; the result is an inline HTML message "Subscription created ... Square emailed your first invoice; pay it to activate", a pending `PaymentResult::form` carrying the subscription id, customer id, plan variation id. The plan only activates when Square's `invoice.payment_made` webhook arrives (mapped `renewed`, which activates a pending subscription). `subscription.updated` with CANCELED/DEACTIVATED maps to canceled.
  3. Braintree one-time: creates a client token via XML, renders the Drop-in page; callback posts the nonce, looks the ORDER up by the posted `order_number`, charges `sale` for the ORDER's amount with `submit-for-settlement`; statuses authorized, submitted_for_settlement, settled, settling count as paid. No currency/merchant-account selection: the Braintree account's default currency applies. Webhook: `bt_signature|bt_payload` in the form body verified with HMAC-SHA1 keyed by `sha256(sha256(privateKey) + publicKey)`; `transaction_settled` = paid, `transaction_settlement_declined` = failed, `disbursement` = paid (QUIRK: a disbursement notification is treated as a paid payment).
  4. Braintree recurring only when the optional `plan_id` credential is set: at return the nonce is vaulted (customer + payment method token), then a subscription is created against `plan_id` with the price overridden by the order amount; status Active or Pending gives paid with the subscription id. Events `subscription_charged_successfully` renewed, `_unsuccessfully` payment_failed, `subscription_canceled|expired` canceled. Cancel via API.
  5. Authorize.Net one-time: `getHostedPaymentPageRequest` for an `authCaptureTransaction` with invoice number = order number, return URL and cancel URL, then a self-submitting form. Callback requires `transId`/`x_trans_id` and response code 1, then verifies with `getTransactionDetails` (settledSuccessfully, capturedPendingSettlement, authorizedPendingCapture = paid; voided, declined, expired, failedReview = failed; other = pending). QUIRK: if the details lookup itself fails it falls back to TRUSTING the query string and returns paid.
  6. Authorize.Net webhooks: header `X-ANET-Signature` (HMAC-SHA512 with hex key) is NOT forwarded by the controller, so the driver's signature check never runs (accepted). Events authcapture/capture/priorAuthCapture verify then map paid; void and refund map to failed.
  7. Authorize.Net recurring: after the hosted payment, `createCustomerProfileFromTransaction` then `ARBCreateSubscription` starting one interval later (`totalOccurrences` 9999); if either step fails the driver still returns PAID for the first charge with `recurring_setup` = failed/no_profile/arb_failed in the payload (buyer gets the plan for one cycle, never renews). Renewal detection: `authcapture` event whose transaction belongs to a subscription (looked up through `getTransactionDetails`) maps to renewed.
- **Async & events:** webhooks (Square, Braintree, Authorize.Net).
- **External systems:** Square, Braintree, Authorize.Net.
- **Settings:** see TW-PAYGW-005.
- **Acceptance criteria:**
  - Given a Square order state COMPLETED at return, then the order is paid with the first tender id.
  - Given a Braintree nonce posted for a pending order, then a submitted_for_settlement sale marks it paid.
  - Given an Authorize.Net return with `transId` and code 1 and a settled transaction, then the order is finalised.
  - Given a Braintree webhook with a bad signature, then 403.
- **Source refs:** app/Services/Payment/Drivers/SquareDriver.php; app/Services/Payment/Drivers/BraintreeDriver.php; app/Services/Payment/Drivers/AuthorizeNetDriver.php.
- **Port notes:** prefer one library per provider in the adapter; never fail-open on verification; charge the amount the SERVER stores for the order (Braintree already does) and validate the nonce order belongs to the current session/order token, not a posted `order_number`.

### TW-PAYGW-022 — India drivers: Paytm, PhonePe, Cashfree, PayU, Instamojo

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-PAYGW-008
- **Summary:** Five Indian gateways (UPI, cards, netbanking, wallets), all one-time only.
- **Actors & access:** buyer; admin credentials.
- **UX & screens:** Paytm and PhonePe and Instamojo: redirect; Cashfree: inline page loading `sdk.cashfree.com/js/v3/cashfree.js` and calling checkout with the payment session; PayU: inline auto-submitting form to the PayU `_payment` URL.
- **Endpoints:** Paytm `securegw(-stage).paytm.in`: `/theia/api/v1/initiateTransaction`, `/theia/api/v1/showPaymentPage`, `/v3/order/status`. PhonePe: v2 OAuth `identity-manager/v1/oauth/token`, `/checkout/v2/pay`, `/checkout/v2/order/{id}/status` (Authorization `O-Bearer`), or legacy `/pg/v1/pay`, `/pg/v1/status/{mid}/{txn}` with `X-VERIFY`. Cashfree `api(sandbox).cashfree.com/pg/orders` (`x-api-version 2023-08-01`). PayU `secure(sandboxsecure).payu.in/_payment`. Instamojo `(test|www).instamojo.com/api/1.1/payment-requests/`.
- **Data:** provider order ids are stored in `gateway_order_id`: Paytm `PAYTM_<order>_<unix>`, PhonePe `PP_<order>_<unix>` (63 chars max), Cashfree `CF_<order>_<unix>`, PayU txnid `PAYU_<order>_<unix>` (also `udf1` = order number, `udf2` = numeric order id), Instamojo payment-request id.
- **Rules & edge cases:**
  1. Paytm: order id + callback, checksum = AES-128-CBC of (sha256(body|salt) + salt) with a fixed IV under the merchant key; the callback re-verifies `CHECKSUMHASH` then confirms with the order-status API (`resultCode 01` or TXN_SUCCESS = paid, PENDING pending); only if the status API is unreachable does it fall back to the posted `STATUS = TXN_SUCCESS`.
  2. PhonePe: uses the v2 flow whenever both `client_id` and `client_secret` are present (OAuth token, `PG_CHECKOUT` with `redirectUrl`, `expireAfter` 1200, amount in paise; states COMPLETED paid, PENDING pending) else the legacy salt flow (base64 payload, `sha256(payload + endpoint + salt)###index`); the legacy callback re-verifies `x-verify` when supplied then queries status by transaction id (`PAYMENT_SUCCESS` paid, `PAYMENT_PENDING` pending). All fields are optional in the schema (QUIRK: activation guard cannot protect PhonePe).
  3. Cashfree: needs buyer email; customer phone is a HARD-CODED placeholder `9999999999`; return URL contains `order_id={order_id}`; callback fetches the order (`PAID` = paid); webhook signature `x-webhook-signature`-style `timestamp.signature` HMAC (not forwarded by the controller, so never checked). `PAYMENT_SUCCESS_WEBHOOK` maps to paid.
  4. PayU: needs buyer email; phone hard-coded `9999999999`; request hash = sha512 over the documented pipe string incl. udf1/udf2 and salt; the callback recomputes the reverse hash from the posted fields and requires `status = success`. The controller matches the order sessionless via `txnid` or the echoed `udf2` (PayU's cross-site POST drops the session cookie). Failure return uses `?status=failed`.
  5. Instamojo: needs email; payment request with webhook URL, `allow_repeated_payments` false, `send_email` false; callback needs `payment_id` and `payment_request_id`, fetches the payment and requires status `Credit`; webhook MAC = HMAC-SHA1 of the sorted, `|`-joined POST values with the `salt`, taken from the body.
  6. Whitelists default to INR only; Paytm/Instamojo/PayU/Cashfree amounts are formatted 2 decimals in the order currency.
- **Async & events:** webhooks only used to reinforce.
- **External systems:** the five providers.
- **Settings:** see TW-PAYGW-005.
- **Acceptance criteria:**
  - Given a PayU success POST with a valid reverse hash, then the order is paid even though the session cookie is absent.
  - Given a PayU POST with a tampered amount, then `payu_hash_mismatch` and the order is failed.
  - Given Cashfree status PAID, then the order is finalised with `cf_order_id` as the payment id.
  - Given PhonePe with only legacy credentials, then the legacy flow is used.
- **Source refs:** app/Services/Payment/Drivers/PaytmDriver.php; PhonepeDriver.php; CashfreeDriver.php; PayuDriver.php; InstamojoDriver.php.
- **Port notes:** the UPI providers all need mobile numbers: collect a real phone at checkout instead of placeholders; use PhonePe v2 only.

### TW-PAYGW-023 — Asia / MENA drivers: Midtrans, Duitku, Xendit, Tap, HyperPay, SSLCommerz

- **Status:** implemented
- **Priority:** P2
- **Effort:** L
- **Depends on:** TW-PAYGW-008
- **Summary:** Six regional gateways for Indonesia, SE Asia, the Gulf and Bangladesh, all one-time.
- **Actors & access:** buyer; admin credentials.
- **UX & screens:** Midtrans: redirect URL or an inline Snap page (`snap.pay` with finish/pending/error/close callbacks appending `transaction_status`); Duitku, Xendit, Tap, SSLCommerz: redirect; HyperPay: inline page with the `paymentWidgets` form (brands VISA MASTER AMEX MADA).
- **Endpoints:** Midtrans Snap `app(.sandbox).midtrans.com/snap/v1/transactions` + Core `api(.sandbox).midtrans.com/v2/{id}/status`. Duitku `api-(sandbox|prod).duitku.com/api/merchant/createInvoice` and `/transactionStatus`. Xendit `api.xendit.co/v2/invoices`. Tap `api.tap.company/v2/charges`. HyperPay `eu-(test|prod).oppwa.com/v1/checkouts` and `paymentWidgets.js`. SSLCommerz `(sandbox|securepay).sslcommerz.com/gwprocess/v4/api.php` and validator API.
- **Data:** ids: Midtrans `MID_<order>_<unix>`; Duitku `DTK<order>-<6 digits>`; Xendit external id `<order>_<unix>` (also echoed as `xendit_ext` on the success URL); Tap charge id; HyperPay checkout id; SSLCommerz `SSL_<order>_<unix>`.
- **Rules & edge cases:**
  1. Midtrans: needs email; `gross_amount` is ROUNDED to an integer (IDR only); finish callback URL carries `order_id`; callback fetches the status (`settlement`, or `capture` with fraud `accept` = paid; `pending` pending). Webhook (`order_id` is in the controller's hint list, so this one DOES finalise from the webhook) recomputes `sha512(order_id + status_code + gross_amount + server_key)` and compares to `signature_key` from the payload.
  2. Duitku: amount integer (< 1 rejected `duitku_invalid_amount`), invoice expires in 60 minutes, request signed `sha256(merchantCode + timestamp + apiKey)` with headers, email falls back to `customer@example.com`, phone from the user; webhook URL is the platform webhook; webhook verifies `md5(merchantCode + amount + merchantOrderId + apiKey)` (`merchantOrderId` is in the hint list, so it finalises); callback and `verify()` call `transactionStatus` (`00` paid, `01` pending).
  3. Xendit: needs email; invoice with success/failure redirect URLs; callback looks the invoice up by `xendit_ext` (`PAID`/`SETTLED` paid, otherwise pending, or failed when `status=failed`); webhook uses the static `x-callback-token` compared to `webhook_token` (forwarded; missing header rejects when a token is set), `PAID|SETTLED` maps to paid (order not matched by the hint list, so the webhook cannot finalise on its own).
  4. Tap: needs email; charge with `source.id = src_all`, redirect + post URLs, reference = order number; callback and webhook both re-fetch the charge by id (`CAPTURED` = paid), so the webhook needs no signature.
  5. HyperPay: amount 2 decimals, `paymentType DB`, merchant transaction id = order number; the widget posts back with `resourcePath`; callback fetches it and classifies the result code by regex (success groups `000.000.` / `000.100.1`, pending `000.3`/`000.6`). The seeded description mentions STC Pay but nothing STC-specific is coded.
  6. SSLCommerz: needs email, phones/address are placeholders (`0000000000`, `N/A`), default currency BDT, success url = callback (POST), `status=failed|cancelled` variants; callback needs `val_id` and validates via the validator API (`VALID`/`VALIDATED`); IPN verifies `verify_sign` (MD5 over sorted `verify_key` fields + md5(store password)).
- **Async & events:** webhooks (Midtrans, Duitku effective; the rest reinforcing).
- **External systems:** the six providers.
- **Settings:** see TW-PAYGW-005.
- **Acceptance criteria:**
  - Given a Duitku webhook with a valid md5 signature and resultCode 00, then the matching order (by `merchantOrderId`) is finalised without the buyer returning.
  - Given a Midtrans webhook with a wrong `signature_key`, then the driver returns failed and the order is not finalised.
  - Given a Tap return with `tap_id` whose charge is CAPTURED, then the order is paid.
  - Given a Midtrans order of 149.99 IDR, then `gross_amount` is 150.
- **Source refs:** app/Services/Payment/Drivers/MidtransDriver.php; DuitkuDriver.php; XenditDriver.php; TapDriver.php; HyperpayDriver.php; SslcommerzDriver.php.
- **Port notes:** with a proper currency-exponent table IDR/VND amounts become integers everywhere; collect real customer phone/address for SSLCommerz.

### TW-PAYGW-024 — Other regional drivers: iyzico, PayTR, Fondy, Skrill, 2Checkout, Coinbase Commerce, Mercado Pago

- **Status:** partial
- **Priority:** P2
- **Effort:** L
- **Depends on:** TW-PAYGW-008
- **Summary:** Seven remaining gateways (Turkey, Eastern Europe, wallets, global cards, crypto, LatAm). Several cannot reach the paid state from the controller as written (Skrill, Coinbase) and Mercado Pago trusts query parameters.
- **Actors & access:** buyer; admin credentials.
- **UX & screens:** iyzico: redirect to `paymentPageUrl` or inline `checkoutFormContent`; PayTR: inline page with the secure iframe; Fondy, 2Checkout, Coinbase, Mercado Pago: redirect; Skrill: auto-post form to `pay.skrill.com`.
- **Endpoints:** iyzico `(sandbox-)api.iyzipay.com/payment/iyzipos/checkoutform/...`; PayTR `paytr.com/odeme/api/get-token` + iframe; Fondy `pay.fondy.eu/api/checkout/url/`; Skrill `pay.skrill.com`; 2Checkout `secure.2checkout.com/checkout/buy` + REST `api.2checkout.com/rest/6.0/orders/{ref}`; Coinbase `api.commerce.coinbase.com/charges`; Mercado Pago `api.mercadopago.com/checkout/preferences`, `/v1/payments/{id}`.
- **Data:** ids: iyzico token; PayTR `PAYTR_<order>_<unix>`; Fondy `FONDY_<order>_<unix>`; Skrill `<order>_<unix>`; 2Checkout the ORDER NUMBER; Coinbase charge code; Mercado Pago preference id.
- **Rules & edge cases:**
  1. iyzico: needs email; authenticates with `IYZWS key:base64(sha1(key + random + secret + PKI string))`, header `x-iyzi-rnd`; buyer identity number is the placeholder `11111111111`, surname `User`, addresses `N/A`, installments `[1]`; callback fetches the checkout form detail by `token` (SUCCESS = paid). Sandbox/prod by mode. Seeded currencies TRY, USD, EUR, GBP.
  2. PayTR: needs email; hash = base64 HMAC-SHA256 of the documented concatenation + salt with merchant key; installments disabled, `timeout_limit` 30, phone `0000000000`, address `N/A`, `test_mode` from mode (also `debug_on`); amount in kurus; the return handler recomputes `hash` over `merchant_oid + salt + status + total_amount` (`success` paid). QUIRK: PayTR's real notification is a server POST that expects the plain body `OK`; the platform webhook always answers JSON `{ok:true}`, so PayTR retries until timeout.
  3. Fondy: signature = sha1 of `paymentKey|` + all non-empty request fields sorted by key joined with `|`; return verifies the full posted signature then `order_status = approved` = paid; `server_callback_url` is the platform webhook. The posted `order_id` IS in the WEBHOOK order-hint list (not in the return/callback list).
  4. Skrill: form fields incl. `merchant_fields` order_id/order_number; the return returns pending; the status URL posts `md5sig` verified as `md5(merchant_id + transaction_id + upper(md5(secret_word)) + mb_amount + mb_currency + status)`, status `2` paid, `0` pending. QUIRK: return is pending (order marked failed) and the webhook's echoed `order_id` is the numeric DB id which never equals `gateway_order_id`, so Skrill orders never activate automatically.
  5. 2Checkout: Buy-Link with `dynamic=1`, order-ext-ref = order number, price/currency/qty, 1 hour expiration, `signature = HMAC-SHA256` over length-prefixed fields with the Buy Link secret; the return needs `refno` and calls the REST order API (auth header `X-Avangate-Authentication code/date/hash` with HMAC-MD5): `COMPLETE|AUTHRECEIVED` paid, `PENDING` pending. IPN webhook: HMAC-MD5 over length-prefixed values with the secret key vs `HASH`; `ORDERSTATUS COMPLETE|AUTHRECEIVED` = paid. The return carries no order id hint, so it needs the session.
  6. Coinbase: fixed-price charge in local currency, metadata, redirect/cancel URLs `?status=success|cancelled`; the return is `pending` unless cancelled (so the order is marked failed on return); webhook `charge:confirmed|completed` = paid, `charge:pending` pending, `charge:failed` failed; signature `X-CC-Webhook-Signature` HMAC-SHA256 (forwarded; a missing header rejects when a secret is set). The webhook body carries `event.data.code`, which the hint list does not read, so nothing finalises the order. QUIRK: crypto orders never activate without admin approval.
  7. Mercado Pago: preference with `external_reference` = order number, back URLs `?status=approved|rejected|pending`, `auto_return approved`, sandbox uses `sandbox_init_point`; the return is trusted on the query: `status=approved` AND a `payment_id` = PAID with no API check (QUIRK: forgeable, port must verify via `/v1/payments/{id}`); webhook `type=payment` fetches the payment, `approved` paid; header `x-signature` (`ts`, `v1`, manifest `id:<data.id>;ts:<ts>;`) is not forwarded so unchecked.
- **Async & events:** webhooks.
- **External systems:** the seven providers.
- **Settings:** see TW-PAYGW-005.
- **Acceptance criteria:**
  - Given a Fondy return with a valid signature and `order_status=approved`, then the order is paid.
  - Given a 2Checkout return with `refno`, then the REST order status `COMPLETE` marks the order paid.
  - Given (as built) a Skrill return, then the order shows failed; the port must confirm through the signed status_url.
  - Given a Mercado Pago return without a real payment, then the port must not accept it.
- **Source refs:** app/Services/Payment/Drivers/IyzicoDriver.php; PaytrDriver.php; FondyDriver.php; SkrillDriver.php; TwocheckoutDriver.php; CoinbaseDriver.php; MercadopagoDriver.php.
- **Port notes:** for the crypto and wallet-style async gateways design the order as "awaiting confirmation" with a webhook-driven transition instead of an immediate paid/failed at return.

### TW-PAYGW-025 — West-Africa drivers: CinetPay and LigdiCash

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-PAYGW-008
- **Summary:** Mobile-money and card gateways for francophone West Africa, integer XOF-style amounts, one-time.
- **Actors & access:** buyer; admin credentials.
- **UX & screens:** redirect to the provider payment page.
- **Endpoints:** CinetPay `https://api-checkout.cinetpay.com/v2/payment` and `/payment/check`. LigdiCash `https://app.ligdicash.com/pay/v01/redirect/checkout-invoice/create` and `/confirm`.
- **Data:** CinetPay transaction id `CINET-<order>-<unix>` (order number sanitised); LigdiCash invoice token in `gateway_order_id`.
- **Rules & edge cases:**
  1. CinetPay: needs buyer email; amount is a rounded integer; for XOF, XAF, CDF, GNF it is rounded to a multiple of 5; full name split into first/last; customer address/city/country/zip come from the billing fields with placeholders (`N/A`, `CI`, `00000`); phone from the user (several possible attributes); `channels ALL`; `notify_url` = platform webhook. Requests retry twice; on a DNS resolution failure the driver resolves the host through DNS-over-HTTPS (Cloudflare then Google) and pins the IP, and reports a specific "CinetPay API DNS is missing (NXDOMAIN)" error when the resolver says so. The return needs `transaction_id` or `cpm_trans_id`, calls `/payment/check` (`code 00` and `ACCEPTED` = paid). The webhook (`cpm_trans_id`) re-checks by API. No signature is verified even though `secret_key` says "for webhook verification" (QUIRK: unused credential); the controller's hint list cannot match `cpm_trans_id` so the webhook cannot finalise on its own.
  2. LigdiCash: always sends XOF (logs a warning if the order currency differs, but does NOT convert: a non-XOF amount is sent as if it were XOF); integer amount, must be > 0; header `Apikey` + bearer token; invoice with item, customer names/email, `external_id` = order number, cancel/return URLs = callback, `callback_url` = platform webhook; success requires `response_code 00` and a `response_text` payment URL; the return/webhook confirm by `invoiceToken` (`status = completed` and code 00). LigdiCash tokens ARE in the controller hint list (`token`, `invoiceToken`), so the webhook finalises orders.
  3. LigdiCash is not in the seeder and has no whitelist by default; it appears via the self-heal (001).
- **Async & events:** webhooks.
- **External systems:** CinetPay, LigdiCash.
- **Settings:** see TW-PAYGW-005.
- **Acceptance criteria:**
  - Given a CinetPay XOF order of 1234, then the amount sent is 1235.
  - Given a LigdiCash `completed` confirmation, then the order is finalised with the request id as payment id.
  - Given the DNS name for CinetPay cannot be resolved locally but DoH returns an IP, then the request is retried against that IP.
- **Source refs:** app/Services/Payment/Drivers/CinetpayDriver.php; LigdicashDriver.php.
- **Port notes:** LigdiCash should reject non-XOF orders (or convert) instead of relabelling.

### TW-PAYGW-026 — Payment return callback

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PAYGW-011
- **Summary:** The URL every gateway sends the buyer back to. It finds the order, asks the driver to confirm the payment, and either fulfils the order or marks it failed, then lands the buyer on their Orders/Wallet tab with a message.
- **Actors & access:** anyone with the link (the route is public, CSRF-exempt, GET and POST); the buyer normally.
- **UX & screens:** no page; a redirect to `/account/plans` ("Order not found."), or `user.account` with `tab=orders` (or `tab=wallet` for top-ups) and a success/error flash: "Payment received. Your plan is now active.", "Payment received. Money added to your wallet.", "Payment received. Credits added to your wallet.", "Payment did not complete: <reason or unknown>".
- **Endpoints:**

| Method uri                      | Route name       | Action                      | Middleware                              | Response |
| ------------------------------- | ---------------- | --------------------------- | --------------------------------------- | -------- |
| GET payment/callback/{gateway}  | payment.callback | CheckoutController@callback | none (CSRF exempt `payment/callback/*`) | redirect |
| POST payment/callback/{gateway} | -                | CheckoutController@callback | none                                    | redirect |

- **Data:** reads gateway by slug (404 if unknown), `orders`, `subscriptions`; writes `orders` (failed path) or via 028.
- **Rules & edge cases:**
  1. Payload = query string merged with POST body.
  2. Order resolution, first match wins: `gateway_order_id` equal to the first present of `session_id`, `razorpay_order_id`, `razorpay_subscription_id`, `subscription_id`, `token`, `txnid` (PayU), `merchantTransactionId` (PhonePe), `merchantOrderId` (Duitku), `_ptxn` (Paddle); else numeric `udf2` (PayU echoes our order id); else the session value `checkout_order_id`. No match: redirect to Plans with "Order not found.". QUIRK: gateways whose return carries a different key (Paystack `reference`, Flutterwave `tx_ref`, Mollie, Coinbase, Xendit `xendit_ext`, PayTR, Fondy, Skrill, 2Checkout `refno`, SSLCommerz `tran_id`, Cashfree/Midtrans `order_id`, Instamojo, Tap, Square, Authorize.Net, Mercado Pago) depend on the session cookie. Buyers who complete on another device/browser get "Order not found." although charged.
  3. If a pending `subscriptions` row exists for the same gateway and order (status pending or active), the driver's `handleSubscriptionCallback` runs (Braintree, Authorize.Net, Mollie override it), else `handleCallback`. Driver exceptions become a failed result `callback_exception: <msg>`.
  4. `paid`: run fulfilment (028). Then: wallet top-up (`wallet_topup_minor` > 0 and no credit package) redirects to the wallet tab; a credit-package order redirects to the wallet tab; a plan/add-on order first calls `activateSubscriptionForOrder` (finds the pending/active subscription of this order and activates it with the gateway subscription id from the payload `subscription` or `is_subscription` + gatewayOrderId, customer id from `customer`, period end from `current_period_end` or PayPal `billing_info.next_billing_time`), then redirects to Orders.
  5. ANY other status (including `pending`) marks the order `failed` with `failure_reason` = result error (may be null) and merges the result payload, then redirects to Orders with "Payment did not complete: <reason>". QUIRK: asynchronous gateways whose driver reports `pending` on return (Mollie one-time, Coinbase, LemonSqueezy, Skrill, Xendit without `xendit_ext`, Square/Authorize.Net without ids, Paddle without txn) get their order marked failed at return. A later webhook can still flip a failed order to paid (027) because finalisation only checks `status != paid`.
     5b. QUIRK: the callback never checks the order's current status first. Replaying a return for an already paid order with a failing payload (for example `?cancelled=1` on a Stripe order) overwrites `status` from `paid` to `failed` (the plan stays applied, the record lies).
  6. QUIRK (security): Paddle and Mercado Pago drivers accept `status` values straight from the query string (see 017, 024); Authorize.Net falls back to the query string when its lookup fails (021).
  7. The callback URL passed to providers is `route('payment.callback', slug)` and each driver appends its own query keys.
- **Async & events:** none (synchronous). Emits nothing.
- **External systems:** whatever the driver calls to confirm.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a Stripe return with a valid `session_id` and a paid session, then the order becomes paid, the plan applies, and the buyer sees "Payment received. Your plan is now active." on Orders.
  - Given a return whose order cannot be resolved, then the buyer lands on Plans with "Order not found.".
  - Given a wallet top-up order paid, then the buyer lands on the wallet tab with the money message.
  - Given the driver returns `pending`, then (as built) the order shows failed with the flash "Payment did not complete: unknown"; the port must keep such orders `pending` ("awaiting confirmation").
- **Source refs:** app/Http/Controllers/CheckoutController.php (callback, activateSubscriptionForOrder); routes/web.php (payment callback routes); bootstrap/app.php (CSRF exceptions).
- **Port notes:** `GET /api/payments/return/:provider` in NestJS: resolve order strictly by OUR order token embedded in the return URL (e.g. `?o=<opaque token>`), then confirm server-to-server, never mark an order failed from a `pending` result, never downgrade a paid order, and make the transition a conditional UPDATE. Emit outbox `order.paid`.

### TW-PAYGW-027 — Payment webhook receiver

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PAYGW-008
- **Summary:** One endpoint per gateway slug receives asynchronous provider notifications. It authenticates them (fail-closed for gateways that have a signing secret), routes subscription lifecycle events to the subscription service, and otherwise tries to mark the matching order paid.
- **Actors & access:** payment providers (unauthenticated, CSRF-exempt `payment/webhook/*`).
- **UX & screens:** none. Responses: `404 {ok:false}` unknown slug; `403 {ok:false,error:"webhook_secret_not_configured"}`; `403 {ok:false,error:"signature_mismatch"}`; otherwise always `200 {ok:true}`.
- **Endpoints:**

| Method uri                     | Route name      | Action                     | Middleware | Response |
| ------------------------------ | --------------- | -------------------------- | ---------- | -------- |
| POST payment/webhook/{gateway} | payment.webhook | CheckoutController@webhook | none       | JSON     |

- **Data:** reads `payment_gateways`, `subscriptions`, `orders`; writes through 028/029.
- **Rules & edge cases:**
  1. Fail-closed: when setting `payment.require_webhook_secret` is true (DEFAULT true; nothing in the UI changes it) and the gateway's schema declares webhook-signing fields (rule in 005) but none is populated, the request is rejected 403 before any parsing. Gateways with no such field are not affected.
  2. Signature header forwarded to the driver = the first present of `Stripe-Signature`, `X-Razorpay-Signature`, `Paypal-Transmission-Sig`, `x-paystack-signature`, `X-CC-Webhook-Signature`, `x-callback-token`, `x-square-hmacsha256-signature`, `verif-hash`; otherwise null. Headers used by other providers (`Paddle-Signature`, `X-Signature` (Lemon Squeezy), `X-ANET-Signature`, Mercado Pago `x-signature`, Cashfree, ...) are NOT forwarded, so those drivers see null. Most drivers accept null (Paddle, Mercado Pago, Authorize.Net, Cashfree, Stripe, Razorpay); Lemon Squeezy rejects null. Body-signed providers (Braintree, 2Checkout, Instamojo, SSLCommerz) verify from the raw body; Midtrans, Duitku, Skrill, Fondy, PayU, PayTR, Paytm verify inside `handleWebhook`/`handleCallback`.
  3. Subscription first: `parseSubscriptionWebhook(payload)`; a non-null event goes to the subscription handler (029), errors are logged and swallowed, response 200.
  4. Otherwise `handleWebhook` (default = `handleCallback`). The order is then looked up by `gateway_order_id` equal to the first present of `data.object.id`, `payment.order_id`, `resource.id`, `merchantOrderId`, `order_id`, `token`, `invoiceToken`. If found, the result is `paid` and the order is not yet paid: finalise (028). Any other outcome is silently ignored and still returns 200.
  5. Which gateways can therefore finalise a ONE-TIME order from a webhook alone (static analysis): Midtrans (`order_id`), Duitku (`merchantOrderId`), Fondy (`order_id`), LigdiCash (`token`). For every other gateway the one-time confirmation depends on the browser return (026), or, for recurring purchases, on subscription events.
  6. Always answering 200 stops provider retries even when the order could not be matched (lost event).
  7. There is no webhook event log, no de-duplication and no retry queue. Two deliveries (or webhook + callback racing) can both pass the `status != paid` check (see 028).
  8. Fail-closed message for admins is only in logs (`[CHECKOUT] webhook rejected ...`).
- **Async & events:** synchronous processing inside the request.
- **External systems:** every provider's webhook.
- **Settings:** `payment.require_webhook_secret` (system setting, default true), gateway webhook credentials.
- **Acceptance criteria:**
  - Given Stripe with no webhook secret and the default setting, when a webhook arrives, then 403 `webhook_secret_not_configured`.
  - Given Stripe with a secret and a body altered after signing, then 403 `signature_mismatch`.
  - Given a valid Duitku callback for a pending order, then the order is finalised and the response is `{ok:true}`.
  - Given an unknown gateway slug, then 404 `{ok:false}`.
  - Given a valid webhook that matches no order, then still 200.
- **Source refs:** app/Http/Controllers/CheckoutController.php (webhook, webhookSecretMissing, webhookSecretState); bootstrap/app.php (CSRF exceptions); Documentation/pages/admin-panel/payment-gateways.html (webhook section).
- **Port notes:** `POST /webhooks/payments/:provider` per the `webhook-handler` skill: verify signature first (mandatory per provider, constant-time), persist the raw event in a `payment_webhook_events` table keyed by provider event id (unique), enqueue processing on the worker (BullMQ), return 200 fast; retry on failure; match orders by our own order reference stored in provider metadata for EVERY provider.

### TW-PAYGW-028 — Order fulfilment (finalizeOrder)

- **Status:** implemented
- **Priority:** P0
- **Effort:** L
- **Depends on:** TW-PAYGW-026, TW-PAYGW-027
- **Summary:** The single method that turns a confirmed payment into value: marks the order paid and applies it to the workspace (plan switch or add-on grant) or credits the wallet, counts the coupon use, and pays the referrer.
- **Actors & access:** internal; invoked by the callback (026), webhook (027), subscription events (029), admin approval/"mark paid" on order history (038) and the mobile endpoints (034).
- **UX & screens:** none.
- **Endpoints:** none of its own.
- **Data:** writes `orders`, `workspaces` (`plan`, `trial_ends_at`, `plan_ends_at`), `workspace_addons`, `coupons.uses_count`, wallet via WalletService; reads `packages`, `users`, `credit_packages`.
- **Rules & edge cases:**
  1. Guard: if the in-memory order status is already `paid`, do nothing. QUIRK: not concurrency-safe. A callback and a webhook processed simultaneously both pass the guard and both apply (wallet credit twice, plan window stacked twice, coupon counted twice). Port: `UPDATE orders SET status='paid' WHERE id=? AND status<>'paid'` and act only when a row was updated.
  2. Inside one DB transaction: order gets `status=paid`, `gateway_payment_id`, `gateway_payload` = existing payload merged with the result payload, `paid_at=now`, `failure_reason=null`.
  3. Legacy credit-package order (`credit_package_id` set): wallet credited via `topupViaPackage` (WALLET).
  4. "Add any amount" top-up (`credit_package_id` empty and `gateway_payload.wallet_topup_minor` > 0): `WalletService::topup(user, minor, 'wallet.topup', 'topup.conversion', 'Wallet top-up', {order: number})` where user = the order's user (the wallet is per user, not per workspace).
  5. Plan/add-on order (workspace and package set): package resolved by `packages.plan_id = order.package_id (string)` first, else by primary key. Add-on packages (type addon): create an active `workspace_addons` row (starts now; ends = now + duration for days/weeks/years, else months; free, lifetime and custom-quote add-ons have no end = lifetime); the current plan and trial are NOT touched. Plan packages: `plan_ends_at` = null for free, lifetime and custom-quote plans; otherwise base = the LATER of now and the current `plan_ends_at` (paying early never loses days) plus: 1 year when the order period is `yearly` and the plan is a base 1-month plan; else the plan's own duration x unit (day/week/year prefixes, default month). Then `plan` = order package id, `trial_ends_at` = null (lifts the trial bar and the trial gate), `plan_ends_at` as computed.
  6. Coupon: `coupons.uses_count` atomically incremented when the order has a coupon id.
  7. After the transaction, best-effort referral payout `ReferralService::rewardOnFirstPayment(buyer)` (pays the referrer once per referee on their first paid purchase; failures are logged as warnings, never break checkout).
  8. If the workspace or package cannot be found the order is still marked paid and nothing is applied (silent).
  9. QUIRK: no receipt email, no in-app notification, no audit row, no outbox event. Admins learn about revenue only from dashboards.
  10. `markPaidManually(order, reviewerId, reference)`: no-op if paid; stamps `reviewed_by`/`reviewed_at`; then fulfils with gateway payment id = reference or `manual-<order id>` and payload `{manual:true, reviewed_by}`.
- **Async & events:** none (all inline); referral payout after commit.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a pending monthly plan order and a workspace whose plan ends in 10 days, when the order is finalised, then `plan_ends_at` = the old end + 1 month, the trial is cleared and the order has `paid_at`.
  - Given an add-on order, then a `workspace_addons` row is active and `workspace.plan` is unchanged.
  - Given a wallet top-up order with `wallet_topup_minor` = 5000, then the buyer wallet gains 5000 minor units once.
  - Given the order is finalised twice sequentially, then the second call changes nothing.
  - Given a coupon on the order, then its `uses_count` grows by exactly 1.
- **Source refs:** app/Http/Controllers/CheckoutController.php (finalizeOrder, markPaidManually); app/Services/WalletService.php; app/Models/WorkspaceAddon.php; app/Services/ReferralService.php.
- **Port notes:** implement as a domain service `OrderFulfilmentService.fulfil(orderId)` run on the worker after the webhook/return transitions the order (outbox `order.paid` consumer), idempotent by order id; PLAN owns the "apply plan to workspace" function it calls (`plan_ends_at` stacking rule above is the behavior to reproduce), WALLET owns credit posting with idempotency key = order id (matches billing design unique `(org_id, idempotency_key)`).

### TW-PAYGW-029 — Subscription lifecycle and webhook events

- **Status:** implemented
- **Priority:** P1
- **Effort:** L
- **Depends on:** TW-PAYGW-012, TW-PAYGW-027
- **Summary:** Keeps local `subscriptions` in step with the provider: activation on first charge, one more plan cycle on each renewal, cancellation, past-due marking. The provider is the clock; there is no Laravel scheduler in the loop.
- **Actors & access:** internal (webhook, callback, reconciler, plan-cancel page).
- **UX & screens:** none here. The buyer-facing cancel button lives on the plans page (`POST account/subscription/cancel`, PLAN domain, role `manager`): it cancels at the provider best-effort then locally, flash "Auto-renew cancelled. Your plan stays active until it expires." or "No active subscription to cancel.".
- **Endpoints:** none of its own (uses 027).
- **Data:** `subscriptions` (see Data model). Status constants: `pending`, `active`, `past_due`, `canceled`, `expired`. `Subscription::active()` scope = active + past_due.
- **Rules & edge cases:**
  1. Matching an event to a row: `(gateway, gateway_subscription_id)` latest; else by event `order_id` in `meta.order_id`; else by `gateway_plan_id` (Paystack, Flutterwave). If a row is found but has no gateway subscription id yet, it is filled from the event. No match: logged, ignored.
  2. `created`: finalise the pending ORDER first (plan window = now + one cycle), THEN activate. Order matters: activating first sets `plan_ends_at` to the gateway period, and finalising then stacked a second cycle (the "51/58 days" bug the code documents).
  3. `renewed`: if the local row is still `pending` treat as activation (same order as `created`) else `renew`.
  4. `activate(sub, attrs)`: fills gateway ids, `status=active`, `current_period_end`, then aligns the workspace window only if the gateway's period end is later than the current one (never shortens).
  5. `renew(sub, periodEnd?)`: `status=active`, `renewals_count + 1`, `current_period_end`; workspace `plan_ends_at` becomes the gateway period end when given (never earlier than now/current end) else one package cycle added to max(now, current end); also sets `plan` from `sub.plan_id`, clears `trial_ends_at`. Logged.
  6. `cancel`: `status=canceled`, `canceled_at=now`; the paid window is NOT shortened (the plan runs out at `plan_ends_at`).
  7. `markPastDue`: `status=past_due`; access continues (no dunning email); only real cancel/expiry ends it.
  8. `finalizePendingOrderFor(sub)`: finds `meta.order_id`, and if that order is not paid finalises it with payment id = gateway subscription id.
  9. A workspace can hold several subscription rows; the Plans-page cancel uses the latest active/past_due one.
  10. `Subscription.package` relation, `billing_cycle` `monthly|yearly`.
  11. Provider cancel is implemented for 11 recurring drivers (`cancelSubscription`), see 014-021; drivers differ on immediate vs end-of-period.
- **Async & events:** webhook-driven; reconciler (030) as safety net.
- **External systems:** provider cancel APIs.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a pending subscription and a `created` event, then the order is paid, the plan window is one cycle from now, and the subscription is active with the gateway id stored.
  - Given an active subscription and a `renewed` event with a period end 30 days ahead, then `renewals_count` +1 and `plan_ends_at` moves to that date.
  - Given a `payment_failed` event, then the subscription is `past_due` and the workspace plan is unchanged.
  - Given a `canceled` event, then `canceled_at` is set and `plan_ends_at` is untouched.
- **Source refs:** app/Services/Payment/SubscriptionService.php; app/Http/Controllers/CheckoutController.php (handleSubscriptionEvent, finalizePendingOrderFor); app/Models/Subscription.php; app/Http/Controllers/PricingController.php (cancelSubscription); migrations 2026_06_04_150000_create_subscriptions_table.php.
- **Port notes:** table `subscriptions` per org with RLS; a `SubscriptionService` on the worker consuming normalised events; unique `(provider, provider_subscription_id)`; store provider event ids for idempotency; renewal must be idempotent per provider payment id (Reference relies only on gateway period end).

### TW-PAYGW-030 — Subscription reconciler (cron-free)

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-029
- **Summary:** A safety net for missing renewal webhooks: while a subscribed user browses the app, after the response is sent the reconciler polls the gateway for subscriptions that are pending or near/after expiry and applies any renewal it finds.
- **Actors & access:** internal; triggered by any authenticated web request of a user with a current workspace.
- **UX & screens:** none.
- **Endpoints:** none. Middleware `ReconcileSubscription` (appended to the web group, `terminate()` hook only, never adds latency; wrapped in try/catch).
- **Data:** reads `subscriptions`, `workspaces.plan_ends_at`; writes via 029; throttle flag in the cache.
- **Rules & edge cases:**
  1. `reconcileWorkspace(wsId)`: every subscription of the workspace in status pending, active or past_due; failures logged as warnings.
  2. `reconcile(sub)` outcomes: `skip_terminal`, `skip_no_ws`, `skip_healthy` (an active plan that is more than 3 days from `plan_ends_at` and has an end date; pending/past_due/no end date are always interesting), `skip_throttled` (cache add of `subrecon:<id>` for 6 hours makes concurrent requests poll once), `no_gateway_sub` (empty gateway subscription id: a one-time purchase), `skip_no_driver`, `skip_poll_failed` (driver cannot poll or the call failed), `gateway_canceled` / `gateway_expired` (local status set, `canceled_at` set once, paid window untouched), `renewed`, `up_to_date`.
  3. Renewal applied only when the gateway `period_end` is strictly later than the workspace `plan_ends_at`: pending rows are activated, others renewed.
  4. QUIRK: only the Razorpay driver implements `fetchSubscription`; for every other provider this is a no-op that still consumes the 6 h throttle.
  5. Cost control by design: healthy mid-cycle plans cost nothing.
  6. Runs only where the user is logged in: a workspace with no web traffic is never reconciled.
- **Async & events:** post-response hook.
- **External systems:** provider `fetchSubscription`.
- **Settings:** constants: throttle 6 hours, lookahead 3 days.
- **Acceptance criteria:**
  - Given a Razorpay subscription within 3 days of expiry whose provider `current_end` is later, when the owner loads any page, then the plan window is extended and no webhook was needed.
  - Given a healthy plan with 20 days left, then no provider call is made.
  - Given two simultaneous requests, then the provider is polled once.
- **Source refs:** app/Services/Payment/SubscriptionReconciler.php; app/Http/Middleware/ReconcileSubscription.php; bootstrap/app.php (web middleware append); app/Services/Payment/Drivers/RazorpayDriver.php (fetchSubscription).
- **Port notes:** replace with a repeatable BullMQ job in the worker (`worker-job` skill) scanning subscriptions whose `plan_ends_at` is within 3 days or status pending/past_due, calling provider `fetch`, per-subscription lock; do not tie to web traffic. Implement `fetchSubscription` for every recurring adapter.

### TW-PAYGW-031 — Wallet top-up checkout (any amount)

- **Status:** implemented
- **Priority:** P0
- **Effort:** M
- **Depends on:** TW-PAYGW-008, TW-PAYGW-028
- **Summary:** The buyer adds any amount of money to their prepaid wallet through the same gateway checkout used for plans. Money is credited only after the gateway confirms.
- **Actors & access:** authenticated user; wallet business rules (rates, balance) belong to WALLET.
- **UX & screens:** the shared `checkout/show` page re-pointed with overrides: item "Add money to wallet", stub package "Wallet top-up", Change link to `account?tab=wallet`, no coupon, no auto-renew. Amount rides the URL (`?amount=`). Success returns to the wallet tab with "Payment received. Money added to your wallet.".
- **Endpoints:**

| Method uri           | Route name                   | Action                                | Middleware   | Request                                                                                                    | Response               |
| -------------------- | ---------------------------- | ------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------- | ---------------------- |
| GET checkout/wallet  | user.checkout.wallet.show    | CheckoutController@walletTopupShow    | Authenticate | query `amount`, `currency?`, `ajax?`                                                                       | HTML / JSON            |
| POST checkout/wallet | user.checkout.wallet.process | CheckoutController@walletTopupProcess | Authenticate | `amount` (required numeric >= 1), `gateway_id`, `currency`, `customer_*`, `billing_*` (same limits as 011) | redirect / inline HTML |

- **Data:** creates `orders` with `package_id` null, `credit_package_id` null, `gateway_payload = {wallet_topup_minor}`; wallet credit in WALLET tables.
- **Rules & edge cases:**
  1. Show: amount in the workspace (base) currency, minimum 1 in that currency, else redirect to `account?tab=wallet` with "Enter an amount of at least <1 formatted> to add to your wallet."
  2. Process: bill in the chosen supported currency (default = base currency): amount converted from base; tax added ON TOP using the same settings; `total = amount + tax`. `base_amount_usd` from the total.
  3. Wallet grant = the PRE-TAX billed amount converted to the PLATFORM currency (`default_currency`) x 100 (minor units; 1 minor money unit = 1 credit), stored in `gateway_payload.wallet_topup_minor` and MERGED (never overwritten) with the driver payload. Tax is not credited.
  4. Gateway, currency and failure handling are identical to 011 (inactive gateway, unsupported currency, provider error, pending redirect). Top-ups are always one-time.
  5. Finalisation (028) calls `WalletService::topup` for the order's user (wallet per user).
  6. No maximum amount and no coupon.
  7. QUIRK: the same order table is used, so top-ups count as `package_id IS NULL` orders. Order History and Billing screens label them "Add-on"/"New" (037, 041).
  8. Offline gateways work: admin approval credits the wallet.
- **Async & events:** as 026/027.
- **External systems:** the gateway.
- **Settings:** tax settings (007), `default_currency`.
- **Acceptance criteria:**
  - Given 1000 INR requested with 18% tax paid by Razorpay in INR (platform currency INR), then the order total is 1180 and the wallet gains 100000 minor units.
  - Given amount 0.50, then the show page redirects with the minimum error.
  - Given the buyer pays in USD while the base is INR, then the wallet is credited the converted pre-tax value expressed in platform-currency minor units.
- **Source refs:** app/Http/Controllers/CheckoutController.php (walletTopupShow, walletTopupProcess); resources/views/checkout/show.blade.php; app/Services/WalletService.php.
- **Port notes:** WALLET decides where top-up ledger rows live; this feature is only the "create payment order + credit on confirm" flow. Use the order id as wallet idempotency key.

### TW-PAYGW-032 — Credit-package checkout (retired bundles)

- **Status:** dead-code
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-PAYGW-031
- **Summary:** Fixed credit bundles were retired in favour of "add any amount". The old bundle URLs redirect to the wallet top-up with the bundle price pre-filled.
- **Actors & access:** authenticated user.
- **UX & screens:** no screen (GET redirects). The unreachable rest of `creditShow` still contains a full render path (kept "for reference").
- **Endpoints:**

| Method uri                   | Route name                    | Action                           | Middleware   | Response                                                                          |
| ---------------------------- | ----------------------------- | -------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| GET checkout/credits/{slug}  | user.checkout.credits.show    | CheckoutController@creditShow    | Authenticate | 302 to `/checkout/wallet?amount=<price_minor/100 rounded>` when the bundle exists |
| POST checkout/credits/{slug} | user.checkout.credits.process | CheckoutController@creditProcess | Authenticate | as 011 with a credit-package order                                                |

- **Data:** `credit_packages` (active by slug, else 404) referenced by `orders.credit_package_id`.
- **Rules & edge cases:**
  1. The slug constraint is `[A-Za-z0-9_-]+`.
  2. The POST is still live and functional (validates like 011 without coupon/period, one-time only, tax on top, fulfils through `topupViaPackage` granting the bundle's credits and currency) but nothing in the UI posts to it.
  3. GET for an unknown slug yields no seed but still redirects (the query is a plain lookup of the price).
- **Async & events:** as 026.
- **External systems:** gateway.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a bundle with price 500.00, when its old link is opened, then the browser lands on `/checkout/wallet?amount=500`.
  - Given a POST to the credit process route, then an order with `credit_package_id` is created and paid orders credit the bundle.
- **Source refs:** app/Http/Controllers/CheckoutController.php (creditShow, creditProcess); app/Models/CreditPackage.php (CPN).
- **Port notes:** do not port the bundle purchase; keep only the redirect for legacy links if links ever existed (they will not in the new product). Credit-package admin CRUD belongs to CPN.

### TW-PAYGW-033 — Legacy /checkout mock pages and self-confirm

- **Status:** partial
- **Priority:** P2
- **Effort:** S
- **Depends on:** none
- **Summary:** Early-sprint static checkout, success and failed pages plus a "complete" endpoint that credits a credit package to the wallet with no payment at all. They are still routable but are not linked from the live flows. Do not port.
- **Actors & access:** `checkout` and `checkout/complete` have no `Authenticate` middleware (the controller reads the session user).
- **UX & screens:** `resources/views/checkout/index.blade.php` (mock with fake plan table and coupon codes `VETRICK20`, `FIRST10`; the Pay button fakes a 1-in-8 failure), `checkout/success.blade.php` (server passes the user's latest PAID order, but the JS overwrites the display with hard-coded rupee plans and a random invoice number, plus confetti), `checkout/failed.blade.php` (hard-coded reason table from `?reason=`, random `PAY_xxxx` reference). Page scripts `checkout-index.js`, `checkout-success.js`, `checkout-failed.js`.
- **Endpoints:**

| Method uri             | Route name        | Action                           | Middleware | Response                                                                   |
| ---------------------- | ----------------- | -------------------------------- | ---------- | -------------------------------------------------------------------------- |
| GET checkout           | checkout.index    | CheckoutPagesController@index    | none       | HTML (credits + resolved credit package by `?package=`, else first active) |
| POST checkout/complete | checkout.complete | CheckoutPagesController@complete | none       | redirect to `checkout.success`                                             |
| GET checkout/success   | checkout.success  | CheckoutPagesController@success  | none       | HTML                                                                       |
| GET checkout/failed    | checkout.failed   | CheckoutPagesController@failed   | none       | HTML (latest failed/pending/cancelled order of the user)                   |

- **Data:** reads `credit_packages`, `orders`; `complete` writes wallet via `topupViaPackage`.
- **Rules & edge cases:**
  1. `complete` validates `package_slug` (required, max 96) and `payment_ref` (nullable, max 191), then credits the user's wallet immediately (no gateway, no verification), flashing "Top-up complete · N credits added.". QUIRK (security): any logged-in user can POST it and receive free wallet credit; a guest hits a type error (500).
  2. The success page's real order data is shadowed by mock data in JS: never a reliable receipt.
  3. `failed()` looks for statuses `failed`, `pending`, `cancelled` (the last never exists).
  4. These routes sit in the top-level `checkout` prefix but the dynamic `checkout/{packageId}` routes are numeric-constrained, so no clash.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Port requirement (negative): the new product MUST NOT expose any endpoint that credits a wallet or activates a plan without a confirmed payment. A regression test posts to a `complete`-style route as an authenticated user and expects 404/403.
  - Given a real gateway payment completes, then the buyer sees the real result on Orders (not these pages).
- **Source refs:** app/Http/Controllers/CheckoutPagesController.php; resources/views/checkout/index.blade.php, success.blade.php, failed.blade.php; resources/js/charts/checkout-index.js, checkout-success.js, checkout-failed.js; routes/web.php.
- **Port notes:** replace with one real "payment result" page rendering the actual order by token (status, amount, next steps) for success/failed/pending.

### TW-PAYGW-034 — Mobile in-app payment confirmation entry points

- **Status:** partial
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-028
- **Summary:** Two public methods on the checkout controller were written so the mobile app (MOB domain, `/api/app/*`) can reuse the exact web fulfilment. Only one of them is actually called: `markPaidManually`. The gateway-confirm method `confirmOrderPayment` has no caller.
- **Actors & access:** internal API; callers are Sanctum-authenticated MOB routes and the admin approve action.
- **UX & screens:** none.
- **Endpoints:** none owned. Related MOB routes (not claimed here): `POST api/app/create-order`, `razorpay/verify`, `paystack/verify`, `paypal/capture-order`, `stripe/create-payment-intent`, `wallet/topup`, `wallet/topup/confirm`, `GET api/app/payment-gateway-settings`, `api/app/admin/payment-gateways*`.
- **Data:** orders, subscriptions.
- **Rules & edge cases:**
  1. `confirmOrderPayment(order, payload)` (dead code, no caller): already-paid returns paid `{already_paid:true}`; resolves the gateway by `gateway_slug` (else `gateway_id`) or returns failed `gateway_not_found`; runs `driver->handleCallback(payload)` (signature/API check inside the driver); paid: fulfil (028) and, for non-credit orders, activate any pending subscription; else the order is set `failed` with the reason and merged payload; returns the `PaymentResult`. Exceptions become failed `callback_exception`.
  2. `markPaidManually(order, reviewerId, reference)` is called by (a) the admin approve/"mark paid" action (038) and (b) the mobile `create-order` endpoint, which creates an order and IMMEDIATELY marks it paid and activates the plan with reference `app-order-<id>` and no payment verification at all (QUIRK, security: the mobile endpoint grants plans for free; MOB must instead create a pending order and confirm it against the provider).
  3. The mobile helper endpoints for Razorpay verify, Paystack verify and PayPal capture only return `verified` / `paid` booleans; none of them fulfils an order. The mobile wallet top-up uses `driver->verify(order)` as a fallback (the only web-reachable use of `verify()`), and the app's wallet order create passes a `meta` array although the `orders` table has no `meta` column (so it is not persisted; MOB to verify).
  4. Mobile Stripe/Razorpay/PayPal/Paystack helpers keep secret keys server-side and return only public identifiers; the public-settings endpoint lists active gateways with public keys and supported currencies only.
- **Async & events:** none.
- **External systems:** as drivers.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a mobile client, when it posts a valid Razorpay signature for its pending order to the confirmation endpoint, then the order is paid once and the plan applies exactly like the web flow (target behavior; Reference only has this via the unused method).
  - Given the same payload twice, then the second call returns paid without a second fulfilment.
  - Given `create-order` without payment evidence, then the port must leave the order pending.
- **Source refs:** app/Http/Controllers/CheckoutController.php (confirmOrderPayment, markPaidManually); app/Http/Controllers/Api/App/BillingController.php; MobilePaymentController.php; WalletController.php.
- **Port notes:** expose `PaymentConfirmationService.confirm(orderId, providerPayload)` used by web return, webhook worker and mobile; remove the instant-approve path.

### TW-PAYGW-035 — Buyer order-history pane and lifetime spend

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-PAYGW-028
- **Summary:** Account > Order history lists the signed-in user's own purchases (plans, add-ons and wallet top-ups) with status, amounts and a per-order invoice link, and a lifetime-spend headline.
- **Actors & access:** any authenticated user; scoped to `orders.user_id = current user` (NOT to the workspace: an owner sees their purchases across workspaces, a teammate sees none of the owner's).
- **UX & screens:** pane `data-pane="orders"` of `resources/views/user/account/index.blade.php` (route `GET account?tab=orders`; the route itself is claimed by the account/auth domain). Header "Past orders" with `N orders · <lifetime> total`. Empty state "No orders yet. Browse plans". Table columns: Invoice (order number), Plan (package name else "Plan #<package id>", coupon code chip), Date (`M j, Y` created), Amount (order amount in its own currency, with sub-line "-x disc" and "+y tax"), Status badge (paid mint, failed and refunded coral, others grey), Action "Download invoice" (036). Flash messages from the payment flow arrive here.
- **Endpoints:** rendered by `AccountController@index` (`GET account`, `user.account`, not claimed).
- **Data:** `orders` for the user, `package` relation, newest first, limit 100 (no pagination). Lifetime total: sum of `total_amount` over ALL paid orders of the user; when all paid orders share one currency the raw sum in that currency, else each order converted to the workspace currency (fallback default currency) and summed.
- **Rules & edge cases:**
  1. Pending and failed orders are listed (abandoned checkouts included); there is no "pay now" or "retry" action for a pending online order.
  2. Wallet top-up orders (package null) render as "Plan #" with an empty id (QUIRK, no label for top-ups).
  3. The amount shown is `amount` (the charged total), so discount and tax sub-lines are informational.
  4. The displayed count is the number of listed rows (max 100), not the total.
  5. Tab query `?tab=orders` opens the pane.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a user with 3 paid USD orders of 49 each, then the header shows `3 orders · $147.00 total`.
  - Given paid orders in USD and INR, then the lifetime total is converted into the workspace currency.
  - Given a user with no orders, then the empty state links to Plans.
- **Source refs:** app/Http/Controllers/AccountController.php (index); resources/views/user/account/index.blade.php; Documentation/pages/account/account-billing.html.
- **Port notes:** `GET /billing/orders` (org-scoped or user-scoped by requirement; prefer org-scoped with role check because teammates cannot currently see workspace purchases); cursor pagination per repo convention. Include a label for wallet top-up orders and a "retry / cancel" action for pending ones.

### TW-PAYGW-036 — Buyer per-order invoice

- **Status:** implemented
- **Priority:** P1
- **Effort:** S
- **Depends on:** TW-PAYGW-007
- **Summary:** A printable HTML invoice for one order, branded with the platform's company identity; users save it as PDF via the browser print dialog.
- **Actors & access:** authenticated user; only the order's `user_id` (else 403 "Not your order."); 401 when unauthenticated; 404 unknown id. Reachable while the trial is expired.
- **UX & screens:** `resources/views/user/invoice/show.blade.php` (standalone HTML page, print CSS hides the action bar): "Back to orders" link and "Print / Save as PDF" button; header with invoice logo (or company wordmark) plus legal company name, address, email, phone, tax id (with the tax label), reg no; "Invoice", order number, created date, status chip; Billed to (customer name/email, company, address, city + postal, country, tax id); Payment block (gateway payment reference and "Paid on" time when set; the gateway name is deliberately hidden from buyers); a single line item (package name else "Plan #id", subtitle, "duration unit", qty 1, amount = `amount + discount - tax` formatted in the order currency); subtotal, discount, tax (label + rate), total; "All amounts shown in <CUR>"; footer thank-you line "for support or refunds within N days, reply to <billing email or support_email>" (refund days from settings; no clause when no email configured).
- **Endpoints:**

| Method uri                | Route name            | Action                     | Middleware   | Response |
| ------------------------- | --------------------- | -------------------------- | ------------ | -------- |
| GET account/invoices/{id} | user.invoice.download | InvoiceController@download | Authenticate | HTML     |

- **Data:** reads `orders` with package, workspace, user; company identity via `Brand::billing()` (007).
- **Rules & edge cases:**
  1. Wallet top-up orders print "Plan #" as the line item (no package).
  2. QUIRK: the subtotal line is derived (`amount + discount - tax`) which equals the pre-discount price only because `amount` already includes tax.
  3. Invoice number is the order number (there is no separate invoice numbering/sequence for platform orders).
  4. Works for any status, including pending and failed orders.
  5. The mobile app has `GET api/app/orders/invoice/{id}/download` (MOB) for the same purpose.
- **Async & events:** none (no emailed invoice/receipt exists).
- **External systems:** none.
- **Settings:** `billing.*` and refund days.
- **Acceptance criteria:**
  - Given the buyer's own paid order, when the invoice is opened, then it shows the company identity, billed-to block, totals and the "Paid on" time.
  - Given another user's order id, then 403.
  - Given no company logo configured, then the brand logo or the company wordmark shows.
- **Source refs:** app/Http/Controllers/InvoiceController.php; resources/views/user/invoice/show.blade.php; app/Support/Brand.php; Documentation/pages/account/account-billing.html.
- **Port notes:** generate a real PDF server-side (worker) with a gapless invoice number sequence per legal entity if tax law requires it (Reference has none); org-scoped access with a billing role rather than user-scoped.

### TW-PAYGW-037 — Admin order history

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-028
- **Summary:** Admin > Order history: every order across all workspaces, with a five-card KPI strip, type filter pills, search, a time window and 12-row pagination, plus a queue of payments awaiting approval.
- **Actors & access:** super-admin only.
- **UX & screens:** `resources/views/admin/order-history/index.blade.php` (breadcrumb Admin > Order history).
  - Window select (auto-submit): Last 90 days (`90d`, default), This year (`this_year`), All time (`all`); an Analytics link (040); an "Export CSV" button that has NO handler (dead control).
  - KPI strip: Total orders (count in window with a change vs the previous equal window, labelled "QoQ" regardless of window), Upgrades (count of PAID orders paid in the window, "+<symbol><short> MRR added"), Downgrades (always 0, "-<sym>0 MRR", placeholder), Add-on bundles (paid orders with no package), Cancellations (failed + refunded orders updated in the window, "-<sym><short> MRR lost").
  - Filter pills: All, New subscription, Upgrade, Downgrade, Add-on, Cancel; search "order #, workspace, plan" (matches order number, customer email, workspace name only; plan is not searched).
  - Awaiting-approval panel (038) above the table.
  - Table (12 per page, newest created first, query string kept): Order #, Date (`Y-m-d`), Workspace, Type badge, Plan / item (package name + unit, sub-line `plan_<slug>` or gateway slug; paid package-less orders read "Add-on"), MRR delta (+amount for paid, -amount for failed/refunded, dash otherwise, in the order currency), Total (`total_amount` else `amount`), Status pill; pending rows show inline "Mark paid" and "Cancel" actions (039); footer "Showing a-b of N orders" and pager.
  - Empty state "No orders in this window."
- **Endpoints:**

| Method uri              | Route name                | Action                             | Middleware                                   | Request                       | Response |
| ----------------------- | ------------------------- | ---------------------------------- | -------------------------------------------- | ----------------------------- | -------- |
| GET admin/order-history | admin.order-history.index | Admin\OrderHistoryController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `window`, `type`, `q`, `page` | HTML     |

- **Data:** reads `orders` (+ workspace, user, package), users (for the analytics only).
- **Rules & edge cases:**
  1. Window: end = end of today; days = 90 (default and any unknown value), `this_year` = days since 1 January (min 1), `all` = 5 years. The previous window is the same number of days immediately before.
  2. Window filter uses `created_at`; the KPI paid figures use `paid_at`; cancellation KPIs use `updated_at`.
  3. Type filter semantics: `new` and `upgrade` both = status paid (indistinguishable); `downgrade` = status pending (nonsense mapping); `addon` = package null; `cancel` = failed or refunded. Row type badge (`typeFor`): paid + package = "Renewal", paid without package = "New", pending = "Pending", failed = "Failed", refunded = "Refunded". QUIRK: the pills and the badges use different vocabularies.
  4. Money in the KPI strip is summed across currencies WITHOUT conversion and prefixed with the platform currency symbol (`FormatSettings::symbol()`), so mixed-currency platforms get nonsense totals (per-row amounts are formatted in the order's own currency).
  5. `MRR delta` is simply the order total, not a recurring-revenue delta.
  6. Total-orders delta: `((now - prev)/prev) x 100` rounded to 1 decimal; prev = 0 gives 100% if now > 0 else 0.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 30 orders in the last 90 days, then the table shows 12 per page across 3 pages and the header count is 30.
  - Given search "acme", then only orders whose number, customer email or workspace name contain it are listed.
  - Given a pending order older than the window, then it is excluded from the table but still appears in the awaiting-approval queue when it has proof.
- **Source refs:** app/Http/Controllers/Admin/OrderHistoryController.php; resources/views/admin/order-history/index.blade.php; Documentation/pages/admin-panel/billing-finance.html.
- **Port notes:** build correct semantics: real order kinds (`new`, `renewal`, `upgrade`, `downgrade`, `add_on`, `wallet_topup`) computed at order creation and stored, KPI money converted to a reporting currency (base_amount_usd already exists in the order for this), CSV export implemented. RLS: platform-admin reads across orgs through an admin-only role/bypass.

### TW-PAYGW-038 — Awaiting-approval queue: approve / reject offline payments

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-013, TW-PAYGW-028
- **Summary:** Offline and bank-transfer orders with an uploaded proof appear in a queue at the top of Order history; the admin views the proof and approves (which activates the plan or credits the wallet) or rejects with a note.
- **Actors & access:** super-admin only.
- **UX & screens:** "Awaiting approval (N)" panel in `admin/order-history/index.blade.php`, shown only when there is at least one entry (max 50, newest proof first, independent of window, filter and pagination): order number, workspace and gateway, amount (total in order currency), payment reference, "View proof" link (media URL, new tab), proof note (truncated with title), Approve button and Reject button (reject prompts "Reason (optional)" via a JS prompt and posts it as `review_note`).
- **Endpoints:**

| Method uri                            | Route name                  | Action                               | Middleware                                   | Request                                 | Response        |
| ------------------------------------- | --------------------------- | ------------------------------------ | -------------------------------------------- | --------------------------------------- | --------------- |
| POST admin/order-history/{id}/approve | admin.order-history.approve | Admin\OrderHistoryController@approve | Authenticate, EnsureUserIsAdmin, IPAllowlist | none                                    | back with flash |
| POST admin/order-history/{id}/reject  | admin.order-history.reject  | Admin\OrderHistoryController@reject  | same                                         | `review_note` (nullable string max 500) | back with flash |

- **Data:** reads/writes `orders` (`reviewed_by`, `reviewed_at`, `review_note`, `status`, `failure_reason`); fulfilment (028).
- **Rules & edge cases:**
  1. Queue predicate: `status = pending` AND `proof_submitted_at` not null.
  2. Approve: if already paid, info flash "Order X is already paid."; else `markPaidManually(order, admin id, payment_reference)` (stamps reviewer, fulfils the order with gateway payment id = the buyer's reference or `manual-<id>`), audit `admin.order.approved` (layer platform; meta order number, amount, currency), flash "Order X approved, plan activated." The action works for ANY non-paid status (including failed and rejected orders) and for any gateway, not only offline ones; the pending-row "Mark paid" button in the table (037) posts to the same route.
  3. Reject: sets `status=failed`, `failure_reason=rejected_by_admin`, `review_note` (default null), reviewer stamps, audit `admin.order.rejected`, flash "Order X rejected."; there is no state check (a paid order can be "rejected" to failed by a crafted request: QUIRK, the plan remains).
  4. No notification to the buyer either way (QUIRK), no undo.
- **Async & events:** audit rows.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a pending bank-transfer order with proof, when the admin approves, then the order is paid, the workspace plan is active with the correct end date and the queue no longer lists it.
  - Given a reject with note "Amount mismatch", then the order is failed, `review_note` stored, and the buyer's Orders pane shows it as failed.
  - Given an already paid order, when approve is posted, then nothing changes and an info message shows.
- **Source refs:** app/Http/Controllers/Admin/OrderHistoryController.php (approve, reject); resources/views/admin/order-history/index.blade.php.
- **Port notes:** state machine with guarded transitions (`pending -> paid|rejected`), notification to the buyer via outbox, audit in the same transaction; forbid rejecting paid orders.

### TW-PAYGW-039 — Admin cancel pending order

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-PAYGW-037
- **Summary:** Cancels an abandoned or stuck pending order (for example an unfinished gateway checkout) so it stops counting as outstanding or overdue.
- **Actors & access:** super-admin only.
- **UX & screens:** "Cancel" button (with browser confirm "Cancel this pending order? It will be marked failed and drop out of outstanding.") on pending rows in Order history.
- **Endpoints:**

| Method uri                           | Route name                 | Action                              | Middleware                                   | Response        |
| ------------------------------------ | -------------------------- | ----------------------------------- | -------------------------------------------- | --------------- |
| POST admin/order-history/{id}/cancel | admin.order-history.cancel | Admin\OrderHistoryController@cancel | Authenticate, EnsureUserIsAdmin, IPAllowlist | back with flash |

- **Data:** `orders.status=failed`, `failure_reason=cancelled_by_admin`, reviewer stamps; audit `admin.order.cancelled`.
- **Rules & edge cases:**
  1. Paid orders: info "already paid, cancel is only for pending orders." Non-pending (failed/refunded): info "is not pending."
  2. Success flash "Order X cancelled."
  3. Nothing is sent to the gateway (no provider-side cancel or subscription cancel).
  4. A late webhook or callback can still mark a cancelled order paid (finalisation only checks `status != paid`).
- **Async & events:** audit.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a pending order, when cancelled, then status is failed with `cancelled_by_admin` and the Cancellations KPI increments.
  - Given a paid order, then it is unchanged with an info message.
- **Source refs:** app/Http/Controllers/Admin/OrderHistoryController.php (cancel).
- **Port notes:** use a distinct `cancelled` status instead of overloading `failed`; auto-expire pending orders with a worker job.

### TW-PAYGW-040 — Admin order analytics

- **Status:** partial
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-PAYGW-037
- **Summary:** A read-only analytics page over orders: KPIs, new-vs-cancel motion chart, order-type mix, top "add-on" SKUs, a conversion funnel, top markets and a six-month cohort heat-map. Several panels are estimates.
- **Actors & access:** super-admin only.
- **UX & screens:** `resources/views/admin/order-history/analytics.blade.php`, JS `resources/js/charts/order-history-analytics.js` (ApexCharts). The window `<select>` in the header (Last 30 days / 90 days (selected) / This year) is NOT wired to a form or script (dead control); the URL parameter `window` (`90d` default, `this_year`, `all`) is the only way. Sections: 6 KPIs (Total orders with "QoQ" delta, Net new MRR = sum of paid, Lost MRR, Avg order value = paid sum / paid count rounded, Add-on attach % = package-less paid orders / all orders, Conversion % = paid orders / signups in window); "Daily order motion" stacked bars (new above, cancels drawn negative) auto-bucketed daily (<=31 days), weekly (<=100), monthly (<=400), quarterly; "Order type mix" donut (Renewal / Add-on / Cancel counters); "Add-ons sold" top 5 SKUs by paid spend where SKU = the gateway slug of package-less paid orders, "<Name> add-on"; "Conversion funnel" (Pricing page visits = signups x 10, Sign-ups (real), Trials started = 70% of signups, Active in trial = 78% of trials, Converted = distinct paying workspaces); "By country" top 6 by `users.country_code` (empty in practice: the column is absent on most installs, guarded by a schema check); "Cohort retention" heat-map of the last 6 monthly workspace-signup cohorts (percentage still not soft-deleted at month N).
- **Endpoints:**

| Method uri                        | Route name                    | Action                                 | Middleware                                   | Response |
| --------------------------------- | ----------------------------- | -------------------------------------- | -------------------------------------------- | -------- |
| GET admin/order-history/analytics | admin.order-history.analytics | Admin\OrderHistoryController@analytics | Authenticate, EnsureUserIsAdmin, IPAllowlist | HTML     |

- **Data:** aggregates over `orders`, `users`, `workspaces`.
- **Rules & edge cases:**
  1. Funnel visits/trials/active are fabricated proportions (docs admit "rough estimates"); downgrades are not tracked.
  2. Money is summed across currencies without conversion, symbol from the platform currency.
  3. Buckets/windows as in 037; cohort retention counts workspaces not deleted by the end of each month offset (a "retention" proxy, not paid retention).
  4. `resources/js/charts/billing-history-*.js` are unrelated mock scripts (see TW-PAYGW-042).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given paid orders 10 in the window and 40 signups, then Conversion shows 25%.
  - Given `window=all`, then the motion chart is bucketed by quarter.
  - Given no add-on orders, then "No add-on orders in this window." shows.
- **Source refs:** app/Http/Controllers/Admin/OrderHistoryController.php (analytics helpers); resources/views/admin/order-history/analytics.blade.php; resources/js/charts/order-history-analytics.js; Documentation/pages/admin-panel/billing-finance.html.
- **Port notes:** DASH domain style: compute from order events/warehouse tables, convert money via `base_amount_usd`; drop fabricated funnel stages or source them from real analytics.

### TW-PAYGW-041 — Admin billing history

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-028
- **Summary:** Admin > Billing history is the payment-event ledger: charges, failures and refunds across all workspaces, with KPIs, an auto-bucketed trend chart, status pills, gateway filter and search.
- **Actors & access:** super-admin only.
- **UX & screens:** `resources/views/admin/billing-history/index.blade.php` + `resources/js/charts/admin-billing-history-index.js`.
  - Window select: 7d, 30d, 90d (default), 1y, all.
  - KPI strip (5): Gross revenue (paid in window + change chip vs previous window), Successful charges (count + "x% success rate" = paid / (paid + failed)), Failed ("to retry / dunning"), Refunds issued (count + amount), Chargebacks (always 0: disputes are not modelled).
  - Trend chart "Daily charges & refunds" (area chart, charges from `paid_at`, refunds from `updated_at`).
  - Status pills: All, Successful (`paid`), Failed, Refunded, Pending; Gateway dropdown (only slugs present in orders); search "order #, workspace, customer" (order number, customer name/email, workspace name/slug).
  - Table 12 per page, newest created first: Date+time, Order #, Workspace (link icon to workspace detail) + customer email, Gateway (capitalised slug), Plan (package name or dash), Amount (negative for refunded, order currency), Status pill; tinted rows for failed/refunded. Empty "No payment events match."
- **Endpoints:**

| Method uri                | Route name                  | Action                               | Middleware                                   | Request                                    | Response |
| ------------------------- | --------------------------- | ------------------------------------ | -------------------------------------------- | ------------------------------------------ | -------- |
| GET admin/billing-history | admin.billing-history.index | Admin\BillingHistoryController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `window`, `status`, `gateway`, `q`, `page` | HTML     |

- **Data:** `orders` (created_at window for the list; paid_at for gross and paid counts; updated_at for failed/refunded).
- **Rules & edge cases:**
  1. "Payment events" are orders: no separate payment-attempt/ledger table exists, so retries and multiple attempts are invisible.
  2. Money summed as `COALESCE(total_amount, amount)` across currencies with the platform currency symbol (same flaw as 037).
  3. Because a gateway callback flips a pending order to failed, "Failed" mixes real declines with abandoned/pending-callback cases (026 quirk).
  4. Gross change chip: `((now-prev)/prev)` 1 decimal; prev 0 gives +100% when now > 0.
  5. Refund figures are always 0 unless an order is manually set to `refunded` outside the app (nothing in the app does, 047).
  6. Trend buckets: daily <= 31 days, weekly (Monday-anchored) <= 100, monthly <= 400, quarterly beyond.
  7. `resources/js/charts/billing-history-index.js` is an unused mock (random data) registered in `app.js` but referenced by no view.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 100 paid and 20 failed orders in 30 days, then success rate shows 83.3%.
  - Given gateway=stripe and status=failed, then only failed Stripe orders are listed and the query string persists across pages.
  - Given window=all, then the trend is quarterly.
- **Source refs:** app/Http/Controllers/Admin/BillingHistoryController.php; resources/views/admin/billing-history/index.blade.php; resources/js/charts/admin-billing-history-index.js, billing-history-index.js; Documentation/pages/admin-panel/billing-finance.html.
- **Port notes:** ideal port: a `payment_attempts`/`payment_events` table fed by the webhook events table so failures, retries and refunds are real; keep 12/page semantics or use cursor pagination.

### TW-PAYGW-042 — Admin billing analytics

- **Status:** implemented
- **Priority:** P2
- **Effort:** M
- **Depends on:** TW-PAYGW-041
- **Summary:** Companion analytics page: six KPIs, a cash-flow trend (charges, refunds, failed), gateway share donut, top paying workspaces and an order-status mix donut.
- **Actors & access:** super-admin only.
- **UX & screens:** `resources/views/admin/billing-history/analytics.blade.php` + `resources/js/charts/admin-billing-history-analytics.js`. Window select 7d/30d/90d/1y (form auto-submit; `all` accepted by the URL). KPIs: Gross revenue (+ delta chip), Net revenue (gross minus refunds, and net %), Auth success (paid / (paid+failed) with counts), Failed (amount + events), Refunds (amount + events), Chargebacks (0 disputes, placeholder). Sections: Cash flow area chart; Gateway share donut (paid sum per gateway slug, capitalised labels, descending); Top paying workspaces (top 10 by paid sum, count and total with 2 decimals, row links to `admin.workspaces.detail`, fallback name "Workspace #id"); Order status mix donut (count by status for orders created in the window). Empty state "No paid orders yet in this window."
- **Endpoints:**

| Method uri                          | Route name                      | Action                                   | Middleware                                   | Response |
| ----------------------------------- | ------------------------------- | ---------------------------------------- | -------------------------------------------- | -------- |
| GET admin/billing-history/analytics | admin.billing-history.analytics | Admin\BillingHistoryController@analytics | Authenticate, EnsureUserIsAdmin, IPAllowlist | HTML     |

- **Data:** aggregates over `orders`, `workspaces`.
- **Rules & edge cases:**
  1. Same window/bucket/currency caveats as 041.
  2. Unused `resources/js/charts/billing-history-analytics.js` is a static mock (hard-coded gateway and currency donuts) that no view loads.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given paid orders via Stripe 300 and Razorpay 100, then the gateway donut shows 75/25 in that order.
  - Given a workspace with 3 paid orders totalling 147, then it appears in top payers with count 3.
- **Source refs:** app/Http/Controllers/Admin/BillingHistoryController.php (analytics helpers); resources/views/admin/billing-history/analytics.blade.php; resources/js/charts/admin-billing-history-analytics.js, billing-history-analytics.js.
- **Port notes:** DASH overlap: the Financial dashboard (`admin/financial`) reads the same data; share one reporting service.

### TW-PAYGW-043 — Platform invoices list

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-028
- **Summary:** Admin > Invoices turns each order into a billing document: a list with status pills, KPIs, window and search. There is no separate invoice table; "invoices" ARE `orders` rows.
- **Actors & access:** super-admin only.
- **UX & screens:** `resources/views/admin/invoices/index.blade.php` + `resources/js/charts/invoices-index.js`.
  - Header "All invoices", "Export CSV" (dead) and "Manual invoice" (opens modal, 044).
  - KPI strip: Total invoices (all-time count), Paid (count + percent), Outstanding (pending count + "<sym><short> due"), Overdue (pending older than 15 days), This month (paid sum this month with MoM % chip).
  - Status pills: All, Paid, Outstanding, Overdue, Refunded, Void; window select: All time (default), This month, Last month, This quarter, This year; search (order number, customer email, workspace name).
  - Table (12 per page): Invoice # (order number), Issue date (created_at), Due date, Workspace + owner, Item (package name or "Add-on" + unit), Amount (order currency), Status badge (paid; outstanding <= 15 days; overdue > 15 days with days-late; refunded; void = failed), PDF/view icon, row menu (View, Open workspace, and for non-paid rows Mark as paid (pending only), Void, Delete).
  - QUIRK: the view also contains a hidden block (`@if(false)`) of mock rows with dead menu items (Email to owner, Regenerate PDF, Issue refund, Send reminder, Send dunning email, Charge again, Write off, Suspend workspace); the copy "PDF invoices generated by <app>... send a copy to the workspace owner" advertises capabilities that do not exist (docs-only): no PDF generation, no email, no reminders, no refund.
- **Endpoints:**

| Method uri         | Route name           | Action                         | Middleware                                   | Request                         | Response |
| ------------------ | -------------------- | ------------------------------ | -------------------------------------------- | ------------------------------- | -------- |
| GET admin/invoices | admin.invoices.index | Admin\InvoicesController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | `status`, `window`, `q`, `page` | HTML     |

- **Data:** `orders` (+ workspace); workspace list for the modal.
- **Rules & edge cases:**
  1. Status mapping: paid = paid; outstanding = pending; overdue = pending and created more than 15 days ago (fixed, no per-customer terms); refunded = refunded; void = failed. QUIRK: the Due date column just repeats the issue date (`created_at`) and an overdue row prints "Nd late" where N = days since creation (not since day 15).
  2. Window default is ALL TIME (the docs say "this month"; the code comment explains a this-month default hid rows while the badges counted all).
  3. Currency handling as 037 (KPI money unconverted).
  4. Bug-prone: `Overdue` includes abandoned checkouts of any gateway since they are just old pending orders.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a pending order created 20 days ago, then its badge is "overdue" and it counts in Overdue.
  - Given filter status=void, then only failed orders show.
  - Given the default window, then rows older than this month are visible.
- **Source refs:** app/Http/Controllers/Admin/InvoicesController.php; resources/views/admin/invoices/index.blade.php; resources/js/charts/invoices-index.js; Documentation/pages/admin-panel/billing-finance.html.
- **Port notes:** if a real invoice entity is wanted (PDF, numbering, email), create `platform_invoices` generated from paid orders; otherwise keep this as a filtered order view. Ownership overlap with INV (workspace-facing invoicing) is name only.

### TW-PAYGW-044 — Manual invoice creation

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-PAYGW-043
- **Summary:** The admin can issue an off-platform bill to a workspace (for example a custom quote): it is stored as an order stamped `gateway_slug = manual`.
- **Actors & access:** super-admin only.
- **UX & screens:** "Manual invoice" modal on the invoices page: workspace select (all workspaces by name), customer name, customer email, description, amount, currency (3 letters, default = platform currency), status (pending or paid), issue date. Success flash "Manual invoice <number> created." and redirect to the invoice view.
- **Endpoints:**

| Method uri          | Route name           | Action                         | Middleware                                   | Request                                                                                                                                                                                                                                                      | Response                            |
| ------------------- | -------------------- | ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| POST admin/invoices | admin.invoices.store | Admin\InvoicesController@store | Authenticate, EnsureUserIsAdmin, IPAllowlist | `workspace_id` (required int, exists), `customer_name` (nullable max 191), `customer_email` (nullable email max 191), `description` (required max 500), `amount` (required numeric 0.01..9999999), `currency` (required size 3), `status` (required `pending | paid`), `issued_at` (nullable date) | redirect to `admin.invoices.view` |

- **Data:** creates `orders`: new order number, workspace, `user_id` = the workspace owner user, `gateway_slug=manual`, currency uppercased, `amount = total_amount = amount`, status, `paid_at` = issue date when paid, customer name (default workspace name) and email, `gateway_payload = {manual:true, description, issued_by: admin id}`; `created_at` set to the issue date (back-dating allowed).
- **Rules & edge cases:**
  1. No tax, discount or package, no plan is applied even when created as `paid`, no wallet credit, no coupon.
  2. The description is only kept in `gateway_payload` (the invoice view shows it as the line "Order <no>" plus package name if any: QUIRK, the description is not displayed on the printed invoice).
  3. Manual orders show up in every revenue KPI (billing history, order history "Add-on"/paid) because they are ordinary paid orders.
  4. No audit row is written (unlike order approve/cancel).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** default currency.
- **Acceptance criteria:**
  - Given workspace W, amount 250, currency EUR, status pending, when submitted, then a pending manual order exists and the browser opens its invoice view.
  - Given amount 0, then validation fails.
  - Given issue date last month, then `created_at` equals it and it appears in last month's window.
- **Source refs:** app/Http/Controllers/Admin/InvoicesController.php (store); resources/views/admin/invoices/index.blade.php (modal); resources/js/charts/invoices-index.js.
- **Port notes:** store as a distinct `kind = manual` with the description in a real column and print it on the invoice; add audit; exclude from subscription/plan logic unless a plan is explicitly attached.

### TW-PAYGW-045 — Invoice row actions: mark paid, void, delete

- **Status:** implemented
- **Priority:** P2
- **Effort:** S
- **Depends on:** TW-PAYGW-043
- **Summary:** Row menu actions on the platform invoices list to settle, cancel or remove an unpaid invoice.
- **Actors & access:** super-admin only.
- **UX & screens:** row menu entries (only for non-paid rows) with confirm dialogs: "Void this invoice? It stays on record but is cancelled." and "Permanently delete this invoice? This cannot be undone."; flash messages "Invoice X marked as paid.", "Invoice X voided.", "Invoice X deleted." or errors "A paid invoice cannot be voided, issue a refund instead." / "A paid invoice cannot be deleted, void or refund it instead.".
- **Endpoints:**

| Method uri                         | Route name               | Action                            | Middleware                                   | Response               |
| ---------------------------------- | ------------------------ | --------------------------------- | -------------------------------------------- | ---------------------- |
| POST admin/invoices/{id}/mark-paid | admin.invoices.mark-paid | Admin\InvoicesController@markPaid | Authenticate, EnsureUserIsAdmin, IPAllowlist | back with status flash |
| POST admin/invoices/{id}/void      | admin.invoices.void      | Admin\InvoicesController@void     | same                                         | back with flash        |
| DELETE admin/invoices/{id}         | admin.invoices.destroy   | Admin\InvoicesController@destroy  | same                                         | redirect to the list   |

- **Data:** `orders.status` / `paid_at` / row deletion.
- **Rules & edge cases:**
  1. `mark-paid` only flips `status=paid` and sets `paid_at` (if empty). It does NOT run fulfilment: unlike Order history "approve" (038) the plan is NOT activated, coupon not counted, wallet not credited. QUIRK: two different "mark paid" behaviors on the same order for the same admin.
  2. `void` blocks paid rows; sets `failed` (shown as void).
  3. `delete` blocks paid rows and hard-deletes the row (including proof path reference; the file remains).
  4. No audit rows are written for these three actions.
  5. Void/delete of a pending online-gateway order does not tell the gateway; a late webhook can still mark it paid.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a pending manual invoice, when marked paid, then status is paid with `paid_at` set and no plan change occurs.
  - Given a paid invoice, when void or delete is attempted, then the error message shows and the row is unchanged.
  - Given a pending invoice deleted, then the row is gone and the admin lands on the list.
- **Source refs:** app/Http/Controllers/Admin/InvoicesController.php (markPaid, void, destroy).
- **Port notes:** unify with 038 (one `markPaid` domain action with an option `applyFulfilment`), add audit rows, soft-delete with retention (hard delete with audit is the repo rule: hard-delete is fine if audited).

### TW-PAYGW-046 — Platform invoice view and print

- **Status:** implemented
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-043, TW-PAYGW-007
- **Summary:** A full tax-invoice style page for one order for the admin, printable to PDF from the browser.
- **Actors & access:** super-admin only.
- **UX & screens:** `resources/views/admin/invoices/view.blade.php` + `resources/js/charts/invoices-view.js` (page key `invoices-view`; `emailInvoice()` there is a placeholder alert and nothing invokes it). Print CSS isolates the invoice (A4, hides the admin shell). Top bar: breadcrumb, Print and Download PDF (both call `window.print()`), admin-only banner (invoice no, gateway, payment reference, issued/settled info, "paid in full" or status). Document: company header (logo, name, address, tax id "Tax invoice"), INVOICE number/issue date/paid date/status badge; Bill to (billing company, else customer name, else workspace name, else owner; email; address lines; tax id); Payment block (method = gateway name or "Manual", transaction id, captured-at, currency, coupon code); a line table (description = package name else "Plan purchase", "Order <no>" reference, qty, unit, total); Subtotal, Discount (with coupon code), tax line (label + rate), Total, Amount paid (= total if paid else 0), Balance due; notes "Thank you for your business..."; "Need help?" with billing email and phone; footer with company and reg no and "computer-generated invoice, no signature required".
- **Endpoints:**

| Method uri              | Route name          | Action                        | Middleware                                   | Response |
| ----------------------- | ------------------- | ----------------------------- | -------------------------------------------- | -------- |
| GET admin/invoices/{id} | admin.invoices.view | Admin\InvoicesController@show | Authenticate, EnsureUserIsAdmin, IPAllowlist | HTML     |

- **Data:** order + workspace + user + gateway relations; `Brand::billing()`.
- **Rules & edge cases:**
  1. Currency symbol from a 10-entry map (USD, EUR, GBP, INR, AUD, CAD, AED, SGD, ZAR, BRL), else `<CODE> `.
  2. `total = total_amount or (amount - discount + tax)`; `paid amount` is the total only when status is `paid`; `balance = max(0, total - paid)`.
  3. Invoice number = order number (or `INV-<id>`); issue date = `created_at`.
  4. Route constraint numeric id.
  5. For refunded orders the amount paid is 0 and balance equals total (no refund line).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `billing.*`, `checkout.tax_label`.
- **Acceptance criteria:**
  - Given a paid order with coupon and 18% tax, then the page shows discount, tax and Amount paid = total with Balance due 0.
  - Given a pending order, then Amount paid is 0 and Balance due equals the total.
  - Given print, then only the invoice document is rendered on A4.
- **Source refs:** app/Http/Controllers/Admin/InvoicesController.php (show, badge); resources/views/admin/invoices/view.blade.php; resources/js/charts/invoices-view.js; app/Support/Brand.php.
- **Port notes:** share one invoice renderer between the buyer (036) and admin views; server-side PDF.

### TW-PAYGW-047 — Refunds and chargebacks

- **Status:** docs-only
- **Priority:** P1
- **Effort:** M
- **Depends on:** TW-PAYGW-028
- **Summary:** Reference advertises refunds (a "money-back guarantee" line, a Refunds KPI, a refunded status, "Issue refund" menu entries, and the docs say "paid invoices are refunded instead of voided elsewhere") but no code path refunds a payment or sets an order to `refunded`.
- **Actors & access:** none (no working path).
- **UX & screens:** only static text: refund guarantee copy on checkout (007/009) and invoice footer (036); KPI cards Refunds/Chargebacks (041/042; chargebacks hard-coded to 0); a refunded status pill and colours; "Issue refund" items inside the disabled mock block of the invoices list (043).
- **Endpoints:** none.
- **Data:** `orders.status` enum includes `refunded` (model constant), nothing writes it (the booking flow writes a `refunded` status on its own booking orders that reuse the table, APPT). No refund columns, no provider refund calls anywhere in the drivers (only a Authorize.Net webhook branch that maps a refund notification to a failed result without changing anything).
- **Rules & edge cases:**
  1. A refund today is a manual operation in the provider dashboard; the platform order stays `paid` and the plan keeps running.
  2. Provider refund webhooks are ignored (or mapped to failed results which the controller discards).
  3. `Order::STATUSES` = pending, paid, failed, refunded.
  4. Refund window settings (`pricing.refund_enabled/days`) are copy only.
- **Async & events:** none.
- **External systems:** none implemented.
- **Settings:** `pricing.refund_enabled`, `pricing.refund_days` (display only).
- **Acceptance criteria:**
  - Given the Reference baseline, when an admin looks for a way to refund an order, then none exists (documented gap).
  - Port target: given a paid order, when an admin issues a full or partial refund through a provider adapter, then a refund record is created, the order shows refunded/partially refunded, wallet/plan effects are reversed per policy, and billing KPIs update.
- **Source refs:** app/Models/Order.php; app/Http/Controllers/Admin/BillingHistoryController.php; resources/views/admin/invoices/index.blade.php; Documentation/pages/admin-panel/billing-finance.html.
- **Port notes:** add `refund()` to the provider port with `refunds` table (amount, reason, provider_refund_id, status) and webhook handling for provider-initiated refunds/chargebacks; decide reversal policy for plans and wallet credit with the business.

### TW-PAYGW-048 — Driver library reuse by merchant, booking and mobile flows

- **Status:** implemented
- **Priority:** P0
- **Effort:** S
- **Depends on:** TW-PAYGW-008
- **Summary:** The 33 drivers are not only for platform checkout. Other domains construct the same drivers with different credentials or feed them their own orders. The port must keep the adapter layer independent of where the credentials and order come from.
- **Actors & access:** internal.
- **UX & screens:** none.
- **Endpoints:** none owned.
- **Data:** consumers: `wa_merchant_gateways` (a workspace's own gateway credentials, CHK) build a TRANSIENT non-persisted `PaymentGateway` row (`toTransientPaymentGateway`) so `driverFromModel` works unchanged; `CustomerPaymentService` (CHK) builds a transient in-memory order adapter with the fields the drivers read (email, phone, amount, currency, order number, billing_*, package null) and calls `initiate`, `verifyWebhookSignature`, `handleWebhook`, `handleCallback` and `verify`; booking deposits (APPT) create real `orders` rows numbered `BK-XXXXXXXXXX` with `gateway_payload.booking`, call `initiate`, and confirm through `/b/pay/callback/{gateway}`; mobile (034, MOB) reads the same gateway rows.
- **Rules & edge cases:**
  1. Drivers must not assume the order is a platform plan order: `optional($order->package)` and `optional($order->user)` are read defensively, so a null package/user is legal.
  2. Drivers read these order fields: `order_number`, `id`, `amount`, `currency`, `user` (email, name, phone), `customer_email/name`, `billing_address/city/postal/country`, `workspace_id`, `package` (name, plan unit/duration), `gateway_order_id`, `gateway_payment_id`, `email`.
  3. `route('payment.webhook', slug)` is baked into several drivers' initiate payloads (Mollie, Cashfree, Instamojo, SSLCommerz, Tap, Fondy, Skrill, CinetPay, LigdiCash, Mercado Pago, Square notification URL, PhonePe legacy callback, Duitku) so merchant flows that use the same driver ALSO point provider notifications at the platform webhook, not the merchant webhook (CHK's own `wa/checkout/webhook/{slug}` is used only where the caller supplies its own notify URL). Port: pass `notifyUrl` into `initiate`.
  4. Platform webhook lookup uses the platform `payment_gateways` row for credentials, so merchant-credential webhooks cannot verify there.
- **Async & events:** none.
- **External systems:** as drivers.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a transient gateway with merchant credentials, when `initiate` runs with an adapter order, then the provider is called with the merchant's keys and nothing is written to `payment_gateways`.
  - Given a null `package`, when a driver builds its description, then it falls back to "<app> plan" or "Order #n" without error.
- **Source refs:** app/Models/WaMerchantGateway.php; app/Services/Checkout/CustomerPaymentService.php; app/Http/Controllers/BookingPaymentController.php; app/Http/Controllers/BookingApiController.php.
- **Port notes:** the adapter port takes `(credentials, mode, orderRef, amountMinor, currency, payer, urls{return, cancel, notify}, metadata)` with NO reference to plans or workspaces; one adapter registry serves platform billing (credentials from platform secrets), merchant checkout (credentials per org, CHK) and booking deposits (APPT).

## Data model

Three tables are owned here. All are PLATFORM-scoped in Reference (no tenant RLS); `orders.workspace_id` and `subscriptions.workspace_id` are plain columns without foreign keys. The reference database is seeded with 32 gateway rows and no orders or subscriptions.

### `payment_gateways` (model `PaymentGateway`)

Catalogue + configuration of each gateway. Rows: about 33, one per slug; written only by super-admin and the self-heal; read on every checkout/webhook/mobile settings call.

| Column                                                                                                | Type / default                | Behavior                                                                                                |
| ----------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| id                                                                                                    | bigint PK                     | referenced by `orders.gateway_id`                                                                       |
| slug                                                                                                  | varchar(64), UNIQUE           | key into `DRIVER_MAP`; used in callback/webhook URLs                                                    |
| name                                                                                                  | varchar(120)                  | display                                                                                                 |
| description                                                                                           | varchar(500) null             | shown at checkout and in the card                                                                       |
| is_active                                                                                             | tinyint(1) default 0          | shown at checkout only when 1; guarded by required credentials                                          |
| credentials                                                                                           | text null                     | Laravel-encrypted JSON of all credential values (hidden from serialization); "empty" on decrypt failure |
| mode                                                                                                  | varchar(16) default `sandbox` | `sandbox                                                                                                | live`; picks provider base URL in most drivers |
| extra_config                                                                                          | JSON null                     | cast to array; not used by any code path found                                                          |
| supported_currencies                                                                                  | JSON null                     | list of ISO codes; empty/null = any                                                                     |
| sort_order                                                                                            | smallint unsigned default 0   | ascending display order (tie-break id)                                                                  |
| created_at, updated_at                                                                                | timestamp null                |                                                                                                         |
| Indexes: unique(slug); (is_active, sort_order). Read by features 001-006, 009-011, 026-027, 034, 048. |

### `orders` (model `Order`)

One row per purchase attempt: plan purchase, add-on, wallet top-up, manual admin invoice, and (shared, see Open questions) booking deposits and mobile wallet top-ups. Volume: grows with every checkout attempt including abandoned ones. UNIQUE order_number; no FKs.

| Column                                                                                                                                                                                     | Type / default                | Behavior                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                                                                                                                                                                         | bigint PK                     |                                                                                                                                                            |
| order_number                                                                                                                                                                               | varchar(32) UNIQUE            | `WSN-yymmdd-XXXXXX` (platform), `BK-XXXXXXXXXX` (booking); used as invoice number and provider reference                                                   |
| workspace_id                                                                                                                                                                               | bigint                        | buying workspace; index (workspace_id, status)                                                                                                             |
| user_id                                                                                                                                                                                    | bigint                        | buyer (wallet owner, invoice owner); order-history scope                                                                                                   |
| package_id                                                                                                                                                                                 | bigint null                   | plan/add-on; NULL for wallet top-ups and manual invoices                                                                                                   |
| billing_period                                                                                                                                                                             | varchar(16) default `monthly` | `monthly                                                                                                                                                   | yearly` (plan checkout) |
| auto_renew                                                                                                                                                                                 | tinyint(1) default 1          | buyer choice (checkbox); column default differs from checkout (absent = false)                                                                             |
| credit_package_id                                                                                                                                                                          | bigint null                   | legacy credit bundle                                                                                                                                       |
| coupon_id, coupon_code                                                                                                                                                                     | bigint null, varchar(64) null | binding coupon; `coupons.uses_count` incremented on paid                                                                                                   |
| gateway_id                                                                                                                                                                                 | bigint null                   | FK-less link to `payment_gateways.id`                                                                                                                      |
| gateway_slug                                                                                                                                                                               | varchar(64) null              | `manual` for admin invoices; the order history/billing filters group by it                                                                                 |
| currency                                                                                                                                                                                   | varchar(10)                   | billed currency (uppercase)                                                                                                                                |
| amount                                                                                                                                                                                     | decimal(12,2)                 | amount CHARGED (post-discount, post-tax)                                                                                                                   |
| discount_amount                                                                                                                                                                            | decimal(12,4) default 0       |                                                                                                                                                            |
| tax_rate                                                                                                                                                                                   | decimal(5,2) default 0        | percent                                                                                                                                                    |
| tax_amount                                                                                                                                                                                 | decimal(12,4) default 0       |                                                                                                                                                            |
| total_amount                                                                                                                                                                               | decimal(12,4) default 0       | equals `amount` for checkout orders                                                                                                                        |
| customer_name, customer_email                                                                                                                                                              | varchar(191) null             | billing snapshot (defaults from user)                                                                                                                      |
| billing_company/address/city/postal/country/tax_id                                                                                                                                         | varchar null                  | snapshot printed on invoices                                                                                                                               |
| base_amount_usd                                                                                                                                                                            | decimal(12,2) null            | total converted to USD at order time                                                                                                                       |
| exchange_rate                                                                                                                                                                              | decimal(16,6) null            | declared but NEVER written                                                                                                                                 |
| status                                                                                                                                                                                     | varchar(16) default `pending` | `pending                                                                                                                                                   | paid                    | failed | refunded`; `refunded` never set by the platform |
| gateway_order_id                                                                                                                                                                           | varchar(191) null, indexed    | provider-side id used to match returns/webhooks (or order number for offline gateways)                                                                     |
| gateway_payment_id                                                                                                                                                                         | varchar(191) null             | provider payment/capture id or manual reference                                                                                                            |
| gateway_payload                                                                                                                                                                            | JSON null                     | merged provider payloads; `wallet_topup_minor` for wallet orders; `manual`, `description`, `issued_by` for manual invoices; `booking` for booking deposits |
| failure_reason                                                                                                                                                                             | text null                     | machine-ish error string, `cancelled_by_admin`, `rejected_by_admin`                                                                                        |
| payment_proof_path, payment_reference, proof_note, proof_submitted_at                                                                                                                      |                               | offline proof (013)                                                                                                                                        |
| reviewed_by, reviewed_at, review_note                                                                                                                                                      |                               | admin review (038/039)                                                                                                                                     |
| paid_at                                                                                                                                                                                    | timestamp null                | drives revenue windows                                                                                                                                     |
| created_at, updated_at                                                                                                                                                                     | timestamp null                | created_at = issue date; updated_at used for failed/refunded reporting windows                                                                             |
| Indexes: unique(order_number); (workspace_id, status); package_id; gateway_order_id; coupon_id; credit_package_id. Written by 011, 013, 026-028, 031, 038, 039, 044, 045; read by 035-046. |

### `subscriptions` (model `Subscription`)

Live recurring subscriptions per workspace. Small volume.

| Column                                                              | Type / default            | Behavior                                                                                                                            |
| ------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| id                                                                  | bigint PK                 |                                                                                                                                     |
| workspace_id                                                        | bigint                    | index (workspace_id, status)                                                                                                        |
| user_id, package_id                                                 | bigint null               |                                                                                                                                     |
| plan_id                                                             | varchar null              | package id as string                                                                                                                |
| gateway                                                             | varchar                   | gateway slug                                                                                                                        |
| gateway_subscription_id                                             | varchar null              | join key for renewal webhooks; index (gateway, gateway_subscription_id); for Flutterwave = plan id; Paystack code first = plan code |
| gateway_plan_id, gateway_customer_id                                | varchar null              | provider plan/customer ids (cancel context)                                                                                         |
| billing_cycle                                                       | varchar default `monthly` | `monthly                                                                                                                            | yearly` |
| status                                                              | varchar default `pending` | `pending                                                                                                                            | active  | past_due | canceled | expired` |
| amount, currency                                                    | decimal(12,2), varchar(8) | first-cycle charge (post-discount, post-tax)                                                                                        |
| current_period_end                                                  | timestamp null            | provider paid-through date                                                                                                          |
| renewals_count                                                      | int unsigned default 0    |                                                                                                                                     |
| meta                                                                | JSON null                 | `{order_id, order_number}` (pending-row lookup key)                                                                                 |
| canceled_at                                                         | timestamp null            |                                                                                                                                     |
| Read/written by 012, 026, 027, 029, 030 and the PLAN cancel action. |

## Cross-domain contracts

Consumes:

- PLAN: `Package` (type plan/addon, `status`, `plan_amount`, `currency`, `plan_unit` days/weeks/months/years, `plan_duration`, `free`, `lifetime`, `is_custom_quote`, `plan_id`, `chargeableAmount()` offer-aware price, `isFreePlan()`, `isNativelyYearly()`), `Workspace` (`currency`, `plan`, `trial_ends_at`, `plan_ends_at`, `billingPackage()`, `package()` auto-downgrade on expiry), `WorkspaceAddon` (active add-on rows), plans page `account/plans`, and the `EnsureTrialActive` allow-list for checkout/payment/invoice routes.
- CPN: `Coupon::resolve()` (validity, min amount, plan scope, currency lock, per-user use), `FormatSettings::convert/formatIn/symbol`, active `currencies`, `ReferralService::rewardOnFirstPayment`, `CreditPackage` (legacy bundles).
- WALLET: `WalletService::topup(user, minor, ...)` and `topupViaPackage` (wallet is per user); wallet tab `account?tab=wallet`.
- SET: `SystemSetting` keys listed in TW-PAYGW-007, media disk (`media_disk()`, `media_url()`) for proofs, `Brand` (logo, company identity), `legal_url`.
- NOTIF: `Audit::log()` (`admin.payment_gateway.*`, `admin.order.*`, `admin.checkout_settings.updated`).
- AUTH/ASHELL: `Authenticate`, `EnsureUserIsAdmin`, `IPAllowlist`, admin layout `x-layouts.admin`, user layout, Account page shell.
- CORE: application-key encryption (`Crypt`), cache (reconciler throttle), HTTP client, `system_settings`.

Exposes:

- To MOB: active gateway list with public keys, `orders` rows, `markPaidManually()`, driver `verify()`, order history data (`api/app/orders/history`, invoice download).
- To CHK / APPT: the driver library and `PaymentGatewayManager` (`driverFromModel`, transient gateways) and the webhook URL baked into some drivers (see 048).
- To PLAN: `orders` (purchase history), `subscriptions`, `SubscriptionService` events, plan-fulfilment trigger (`finalizeOrder` calls the plan-window rule), cancel-subscription driver call (`PricingController@cancelSubscription`, `account/subscription/cancel`).
- To DASH: `orders` is the source of `admin/financial` and `admin/premium` (revenue, MRR proxies, refunds, outstanding).
- To SALES/INV: nothing (workspace-customer payments are separate: `payments` table, `PaymentLedger`).
- To NOTIF: audit entries only; no notifications are emitted by this domain.

## Open questions & quirks

Ownership decisions and overlaps:

1. `PaymentsController` (`GET/POST payments`, `user.payments.*`, view `user/payments/index.blade.php`, `payments-index.js`, model `Payment`, table `payments`, `PaymentLedger`) is NOT claimed here. It is the workspace-side "record money-in against an invoice/deal" ledger with aging (plan feature `auto_invoice`, role admin), i.e. a workspace charging ITS customers: it belongs to SALES/INV. Same for `WorkspacePaymentConfig` (WhatsApp Pay direct-pay config, CHK) and `WaMerchantGateway` (CHK).
2. The plan checkout routes (`checkout/{packageId}`, apply-coupon, proof), wallet top-up (`checkout/wallet`), legacy credit bundles and `payment/callback|webhook|paddle` are claimed here because they are the gateway execution path and share `finalizeOrder`. PLAN, CPN or WALLET authors may also list them; the business rules of plans (window maths inputs), coupons and wallet ledger live there.
3. `admin/checkout-settings` is claimed here (tax/refund/yearly/recurring/company identity used by checkout and invoices); PLAN may claim it as "pricing settings". `admin/invoices*` (platform invoices) is claimed here because the invoice is an `orders` row; INV is a different (workspace) domain.
4. `POST account/subscription/cancel` and `GET account`/`account/plans` are not claimed (PLAN/AUTH); their effects on drivers and orders are described in 029/035.
5. `admin/financial`, `admin/premium` (DASH), all `api/app/*` including `api/app/admin/payment-gateways*` and `api/app/payment-gateway-settings` (MOB), the `api/v1` REST API (API), `GET pricing` and `admin/pricing-faqs*` (CMS/PLAN), storefront/merchant payment routes `store/*`, `s/{slug}/checkout`, `wa/checkout/*`, `api/commerce/checkout-link` (CHK), workspace `invoices*` and `i/{token}*` (INV), and booking `b/pay/callback/{gateway}` (APPT) are outside this file.
6. The workspace RBAC permissions `billing.view|invoices|cards|refund` and the platform permission `platform.billing.view` exist in the permission manifests but are NOT checked by any route in this domain (admin routes only use `EnsureUserIsAdmin`); RBAC owns them.

Security-relevant defects found by static reading (do NOT replicate; verify in parity runs): 7. `POST checkout/complete` credits wallet credits with no payment (033); `POST api/app/create-order` marks orders paid instantly (034). 8. Paddle and Mercado Pago accept a paid status straight from the callback query string (017, 024); Authorize.Net trusts the query when its lookup fails (021); PayPal webhook events are unauthenticated (016); Stripe webhook has no timestamp tolerance (014). 9. Replaying a return with a failing payload flips an already-paid order to failed (026). 10. `finalizeOrder` is not atomic/idempotent under concurrent callback + webhook (028). 11. Braintree callback trusts a posted `order_number` (021). 12. Payment proof and other files live on the media disk with plain URLs (013). 13. Non-password credential fields are rendered with their plaintext values in the admin page (002).

Reliability defects: 14. Webhook cannot finalise one-time orders for most gateways (order-hint keys do not match provider payloads); only Midtrans, Duitku, Fondy and LigdiCash do (027). 15. Return handling depends on the session for many gateways; `pending` results are treated as failures; Lemon Squeezy webhooks are always rejected by default; Mollie one-time, Coinbase and Skrill never activate automatically (018, 019, 024, 026). 16. Zero-decimal currencies are multiplied by 100 by most drivers (JPY, KRW are in the seeded whitelists) (008/014). 17. Recurring price includes the first order's tax and coupon discount forever; provider plans are created per checkout (012). 18. Only Razorpay can be polled by the reconciler (030); recurring drivers otherwise depend on webhooks. 19. Hard-coded placeholders sent to providers: phone `9999999999` (Cashfree, PayU), `0000000000` (SSLCommerz, PayTR), iyzico identity number, `customer@example.com` (Duitku). 20. `exchange_rate` never written; `base_amount_usd` computed twice in `process()` (first value discarded); `extra_config` unused; `installableSlugs()` unused; `confirmOrderPayment` unused; unused mock scripts `billing-history-index.js`, `billing-history-analytics.js`. 21. The shared `orders` table also stores booking deposit orders (`BK-` numbers) and mobile wallet top-ups; every admin revenue/order/invoice screen therefore includes them (and the mobile wallet order code passes a `meta` array to a table with no `meta` column). Decide in the port whether to keep them in one table (recommended: separate `payment_orders.purpose`). 22. Admin invoice "mark paid" does not fulfil the order while order-history "approve" does (045 vs 038). 23. Report KPIs sum amounts across currencies with one symbol (037, 041, 043).

Docs vs code: 24. Docs (payment-gateways page) say "30 gateways" and that PayPal confirms on return with the webhook "optional"; there are 33 drivers. Docs say invoices default to "This month" (code: all time). The invoices screen copy promises PDF generation, emailing, reminders, dunning, refunds and "Regenerate PDF" (docs-only). The billing-finance doc says refunds are tracked: nothing creates them (047). The admin settings copy says auto-renew is for Stripe/Razorpay/PayPal; 11 drivers implement it. 25. Order-history "Downgrades" KPI and the funnel's top stages are placeholders; "Chargebacks" is always 0.

Open questions (cannot be resolved from code): 26. Whether Razorpay/PayPal/other providers in production are configured with webhooks at all; several flows rely on them silently (the reconciler exists precisely because merchants skipped it). 27. Which provider payload fields the real webhooks carry versus the hint keys read here (static analysis only): confirm live in the parity run with sandbox events for Stripe, Razorpay, PayPal, Paddle, Paystack. 28. Intended behavior of `auto_renew` on the order when a buyer un-ticks the box after a previous subscription is active (no code cancels the old subscription when buying a new plan).

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET admin/payment-gateways",
    "PATCH admin/payment-gateways/{id}",
    "POST admin/payment-gateways/{id}/toggle",
    "GET admin/order-history",
    "GET admin/order-history/analytics",
    "POST admin/order-history/{id}/approve",
    "POST admin/order-history/{id}/cancel",
    "POST admin/order-history/{id}/reject",
    "GET admin/billing-history",
    "GET admin/billing-history/analytics",
    "GET admin/checkout-settings",
    "POST admin/checkout-settings",
    "GET admin/invoices",
    "POST admin/invoices",
    "GET admin/invoices/{id}",
    "DELETE admin/invoices/{id}",
    "POST admin/invoices/{id}/mark-paid",
    "POST admin/invoices/{id}/void",
    "GET checkout",
    "POST checkout/complete",
    "GET checkout/success",
    "GET checkout/failed",
    "GET checkout/{packageId}",
    "POST checkout/{packageId}",
    "POST checkout/{packageId}/apply-coupon",
    "POST checkout/{order}/proof",
    "GET checkout/credits/{slug}",
    "POST checkout/credits/{slug}",
    "GET checkout/wallet",
    "POST checkout/wallet",
    "GET payment/callback/{gateway}",
    "POST payment/callback/{gateway}",
    "GET payment/paddle/checkout/{order}",
    "POST payment/webhook/{gateway}",
    "GET account/invoices/{id}"
  ],
  "controllers": [
    "app/Http/Controllers/Admin/PaymentGatewayController.php",
    "app/Http/Controllers/Admin/OrderHistoryController.php",
    "app/Http/Controllers/Admin/BillingHistoryController.php",
    "app/Http/Controllers/Admin/CheckoutSettingsController.php",
    "app/Http/Controllers/Admin/InvoicesController.php",
    "app/Http/Controllers/CheckoutController.php",
    "app/Http/Controllers/CheckoutPagesController.php",
    "app/Http/Controllers/InvoiceController.php"
  ],
  "services": [
    "app/Services/Payment/AbstractGatewayDriver.php",
    "app/Services/Payment/Drivers/AuthorizeNetDriver.php",
    "app/Services/Payment/Drivers/BankTransferDriver.php",
    "app/Services/Payment/Drivers/BraintreeDriver.php",
    "app/Services/Payment/Drivers/CashfreeDriver.php",
    "app/Services/Payment/Drivers/CinetpayDriver.php",
    "app/Services/Payment/Drivers/CoinbaseDriver.php",
    "app/Services/Payment/Drivers/DuitkuDriver.php",
    "app/Services/Payment/Drivers/FlutterwaveDriver.php",
    "app/Services/Payment/Drivers/FondyDriver.php",
    "app/Services/Payment/Drivers/HyperpayDriver.php",
    "app/Services/Payment/Drivers/InstamojoDriver.php",
    "app/Services/Payment/Drivers/IyzicoDriver.php",
    "app/Services/Payment/Drivers/LemonSqueezyDriver.php",
    "app/Services/Payment/Drivers/LigdicashDriver.php",
    "app/Services/Payment/Drivers/MercadopagoDriver.php",
    "app/Services/Payment/Drivers/MidtransDriver.php",
    "app/Services/Payment/Drivers/MollieDriver.php",
    "app/Services/Payment/Drivers/OfflineDriver.php",
    "app/Services/Payment/Drivers/PaddleDriver.php",
    "app/Services/Payment/Drivers/PayPalDriver.php",
    "app/Services/Payment/Drivers/PaystackDriver.php",
    "app/Services/Payment/Drivers/PaytmDriver.php",
    "app/Services/Payment/Drivers/PaytrDriver.php",
    "app/Services/Payment/Drivers/PayuDriver.php",
    "app/Services/Payment/Drivers/PhonepeDriver.php",
    "app/Services/Payment/Drivers/RazorpayDriver.php",
    "app/Services/Payment/Drivers/SkrillDriver.php",
    "app/Services/Payment/Drivers/SquareDriver.php",
    "app/Services/Payment/Drivers/SslcommerzDriver.php",
    "app/Services/Payment/Drivers/StripeDriver.php",
    "app/Services/Payment/Drivers/TapDriver.php",
    "app/Services/Payment/Drivers/TwocheckoutDriver.php",
    "app/Services/Payment/Drivers/XenditDriver.php",
    "app/Services/Payment/PaymentGatewayManager.php",
    "app/Services/Payment/PaymentResult.php",
    "app/Services/Payment/SubscriptionReconciler.php",
    "app/Services/Payment/SubscriptionService.php"
  ],
  "models": ["PaymentGateway", "Order", "Subscription"],
  "tables": ["payment_gateways", "orders", "subscriptions"],
  "views": [
    "resources/views/admin/payment-gateways/index.blade.php",
    "resources/views/admin/order-history/index.blade.php",
    "resources/views/admin/order-history/analytics.blade.php",
    "resources/views/admin/billing-history/index.blade.php",
    "resources/views/admin/billing-history/analytics.blade.php",
    "resources/views/admin/checkout-settings/index.blade.php",
    "resources/views/admin/invoices/index.blade.php",
    "resources/views/admin/invoices/view.blade.php",
    "resources/views/checkout/bank-transfer.blade.php",
    "resources/views/checkout/failed.blade.php",
    "resources/views/checkout/index.blade.php",
    "resources/views/checkout/offline.blade.php",
    "resources/views/checkout/partials/proof-form.blade.php",
    "resources/views/checkout/razorpay-form.blade.php",
    "resources/views/checkout/razorpay-subscription-form.blade.php",
    "resources/views/checkout/show.blade.php",
    "resources/views/checkout/success.blade.php",
    "resources/views/payment/paddle-checkout.blade.php",
    "resources/views/user/invoice/show.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [
    "app/Http/Middleware/ReconcileSubscription.php",
    "app/Http/Middleware/PaddleReturnRedirect.php"
  ],
  "node_files": [],
  "js_assets": [
    "resources/js/charts/admin-payment-gateways-index.js",
    "resources/js/charts/admin-billing-history-index.js",
    "resources/js/charts/admin-billing-history-analytics.js",
    "resources/js/charts/billing-history-index.js",
    "resources/js/charts/billing-history-analytics.js",
    "resources/js/charts/order-history-analytics.js",
    "resources/js/charts/checkout-index.js",
    "resources/js/charts/checkout-success.js",
    "resources/js/charts/checkout-failed.js",
    "resources/js/charts/invoices-index.js",
    "resources/js/charts/invoices-view.js"
  ],
  "misc_files": [],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/admin-panel/payment-gateways.html",
    "Documentation/pages/admin-panel/billing-finance.html",
    "Documentation/pages/account/account-billing.html"
  ],
  "feature_map": {
    "TW-PAYGW-001": [],
    "TW-PAYGW-002": ["GET admin/payment-gateways"],
    "TW-PAYGW-003": ["PATCH admin/payment-gateways/{id}"],
    "TW-PAYGW-004": ["POST admin/payment-gateways/{id}/toggle"],
    "TW-PAYGW-005": [],
    "TW-PAYGW-006": [],
    "TW-PAYGW-007": ["GET admin/checkout-settings", "POST admin/checkout-settings"],
    "TW-PAYGW-008": [],
    "TW-PAYGW-009": ["GET checkout/{packageId}"],
    "TW-PAYGW-010": ["POST checkout/{packageId}/apply-coupon"],
    "TW-PAYGW-011": ["POST checkout/{packageId}"],
    "TW-PAYGW-012": [],
    "TW-PAYGW-013": ["POST checkout/{order}/proof"],
    "TW-PAYGW-017": ["GET payment/paddle/checkout/{order}"],
    "TW-PAYGW-026": ["GET payment/callback/{gateway}", "POST payment/callback/{gateway}"],
    "TW-PAYGW-027": ["POST payment/webhook/{gateway}"],
    "TW-PAYGW-031": ["GET checkout/wallet", "POST checkout/wallet"],
    "TW-PAYGW-032": ["GET checkout/credits/{slug}", "POST checkout/credits/{slug}"],
    "TW-PAYGW-033": [
      "GET checkout",
      "POST checkout/complete",
      "GET checkout/success",
      "GET checkout/failed"
    ],
    "TW-PAYGW-035": [],
    "TW-PAYGW-036": ["GET account/invoices/{id}"],
    "TW-PAYGW-037": ["GET admin/order-history"],
    "TW-PAYGW-038": [
      "POST admin/order-history/{id}/approve",
      "POST admin/order-history/{id}/reject"
    ],
    "TW-PAYGW-039": ["POST admin/order-history/{id}/cancel"],
    "TW-PAYGW-040": ["GET admin/order-history/analytics"],
    "TW-PAYGW-041": ["GET admin/billing-history"],
    "TW-PAYGW-042": ["GET admin/billing-history/analytics"],
    "TW-PAYGW-043": ["GET admin/invoices"],
    "TW-PAYGW-044": ["POST admin/invoices"],
    "TW-PAYGW-045": [
      "POST admin/invoices/{id}/mark-paid",
      "POST admin/invoices/{id}/void",
      "DELETE admin/invoices/{id}"
    ],
    "TW-PAYGW-046": ["GET admin/invoices/{id}"]
  }
}
```
