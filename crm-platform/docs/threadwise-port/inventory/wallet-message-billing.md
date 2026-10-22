---
domain: wallet-message-billing
code: WALLET
title: Wallet, Per-Message Billing, Credit Rates, Overflow Billing & Low-Balance Alerts
threadwise_version: '1.7.0'
sources_read: 78
---

# Wallet, Per-Message Billing, Credit Rates, Overflow Billing & Low-Balance Alerts

## Overview

This domain is the money side of WhatsApp messaging in Reference. It answers four questions: (1) what does a workspace owner hold (a prepaid wallet), (2) how much does one outbound message cost (a per-country x per-category rate card, with a flat fallback), (3) when is the wallet actually debited (at delivery, once per provider message id, refunded on failure), and (4) how is the owner told about it (wallet tab, statement, CSV, low-balance alert, mobile wallet API).

Who uses it:

- **Platform super-admin** sets the economics on one page (`/admin/settings/wallet-rules`): flat credits per message, credits bought per unit of money, referral signup reward, the per-country x category rate grid, the pay-per-message master switch, rate-card CSV import and "sync Meta costs". The admin also curates optional credit packages (`/admin/credit-packages`), which are effectively retired in the UI but still have working CRUD and a working (POST-only) purchase path.
- **Workspace owner / any logged-in user** adds money (`/checkout/wallet?amount=`), sees balance, activity, a filterable statement and CSV export, and receives low-balance alerts. The mobile app has an equivalent wallet API.
- **The send pipeline** (chat, team inbox, campaigns, broadcasts, scheduled, flows, auto-replies) never debits directly in the default configuration. Every channel reports a delivery status and the single billing choke point `MessageBillingService` charges the wallet exactly once per message id.
- **BSP / reseller layer** (`bsp-billing-engine`) reads the `message_charges` ledger for P&L and attaches Meta credit lines; it rides on top of everything defined here.

Main flow end to end (default config, `wallet_billing_on_delivery` = on):

1. Admin configures rates; owner tops up money through a gateway checkout; the paid order finalizes and `WalletService::topup` writes a paired currency row + credit row and raises `users.wallet_credits`.
2. Before a bulk blast (campaign, broadcast, scheduled) a launch-time precheck refuses to start when a wallet-billed workspace has an empty wallet.
3. Messages go out. The provider (Meta status webhook, Twilio status webhook, Node bridge callbacks) reports sent/delivered/read/failed.
4. `settleDelivered` prices the message (recipient country from phone prefix x category), decides free vs charged, debits credits (never below zero) and the money mirror, writes a `wallet_transactions` spend row and a `message_charges` row (idempotent on wamid), then fires the throttled low-balance alert.
5. `settleFailed` reverses the exact charge when the provider reports failure.

Plan tiers: two billing models coexist and are selected per workspace by `MessageBillingService::payPerMessageFor`.

- **Plan/quota model ("classic", meta_direct)**: the plan's `monthly_messages_limit` gives free messages; the wallet only pays for messages beyond the quota; an expired plan gets no free quota.
- **Pay-per-message model (reseller / BSP, or global switch)**: plan quota is ignored, every delivered message is charged at the country x category rate, the wallet is the only gate.

Connections to other domains: `platform-payment-gateways` (PAYGW, payment drivers and callbacks finalize top-up orders), `plans-subscriptions-trials` (PLAN, `monthly_messages_limit`, plan expiry, `PlanUsage`), `coupons-credits-referral-currency` (CPN, currency formatting/conversion, referral payout that calls `WalletService::creditAccount`), `bsp-billing-engine` (BSP, credit-line attach, P&L over `message_charges`, billing-mode switch on the devices page), `notifications-activity-audit` (NOTIF, `wallet_low_balance` preference and NotificationHelper), `whatsapp-cloud-api-waba` (WABA status webhook), `node-bridge-runtime` (NODE delivery callbacks), `broadcasts` / `campaigns` / `scheduled-queue-warmer` / `chat-conversations` / `flow-runtime-engine` (settle-point callers), `mobile-app-api` (MOB) and `chrome-extension-sheets-addon` (EXT) which expose balance snapshots.

Money model warning (read before building): Reference carries a half-finished migration from "credits" to "money". Everything is stored as integer "credits", but most screens treat 1 credit == 1 minor unit of money (paise/cents) and divide by 100, while the top-up converter and the display converter use the admin setting `credits_per_currency_minor` (seeded 0.1, meaning 10 credits per major unit and 1 credit = 10 major units). The code comments repeatedly assume the setting equals 100. See TW-WALLET-002 and Open questions. The port should store balances directly in money minor units and drop the conversion.

## Feature index

| Id            | Feature                                                                                      | Status      | Priority | Effort | Depends on                                  |
| ------------- | -------------------------------------------------------------------------------------------- | ----------- | -------- | ------ | ------------------------------------------- |
| TW-WALLET-001 | Wallet balances and append-only transaction ledger (WalletService funnel)                    | implemented | P0       | M      | -                                           |
| TW-WALLET-002 | Credit-to-money unit model, top-up conversion rate and balance display                       | partial     | P0       | S      | TW-WALLET-001                               |
| TW-WALLET-003 | Admin wallet rules page and flat settings save                                               | implemented | P0       | M      | TW-WALLET-001, TW-WALLET-002                |
| TW-WALLET-004 | Per-country x category credit-rate resolution (MessageCreditRate + PhoneCountry)             | implemented | P0       | M      | TW-WALLET-003                               |
| TW-WALLET-005 | Admin per-country rate grid: save, delete, seed, toggles                                     | implemented | P0       | M      | TW-WALLET-004                               |
| TW-WALLET-006 | Admin rate-card CSV import                                                                   | implemented | P1       | M      | TW-WALLET-004                               |
| TW-WALLET-007 | Admin "Sync Meta costs" (live pull with bundled fallback)                                    | implemented | P1       | M      | TW-WALLET-004                               |
| TW-WALLET-008 | Billing-mode resolution: pay-per-message switch and reseller flag                            | implemented | P0       | S      | TW-WALLET-005                               |
| TW-WALLET-009 | Delivery-time settlement: charge once per message id (settleDelivered)                       | implemented | P0       | L      | TW-WALLET-001, TW-WALLET-004, TW-WALLET-008 |
| TW-WALLET-010 | Plan-quota-first free allowance in classic mode and plan-expiry behavior                     | implemented | P0       | M      | TW-WALLET-009                               |
| TW-WALLET-011 | Failed-delivery refund (settleFailed)                                                        | implemented | P0       | S      | TW-WALLET-009                               |
| TW-WALLET-012 | Settle-point wiring per channel and engine                                                   | implemented | P0       | M      | TW-WALLET-009, TW-WALLET-011                |
| TW-WALLET-013 | Launch-time wallet precheck for bulk sends and scheduled eligibility filter                  | implemented | P0       | M      | TW-WALLET-008                               |
| TW-WALLET-014 | Legacy send-time overflow billing (OverflowBilling, off by default)                          | partial     | P2       | M      | TW-WALLET-004, TW-WALLET-008                |
| TW-WALLET-015 | Low-balance alert (WalletAlerts)                                                             | implemented | P1       | S      | TW-WALLET-009                               |
| TW-WALLET-016 | Add-money top-up checkout (any amount) and wallet credit on paid order                       | implemented | P0       | M      | TW-WALLET-001, TW-WALLET-002                |
| TW-WALLET-017 | Credit-package purchase path (retired in UI, POST still live)                                | partial     | P2       | M      | TW-WALLET-019                               |
| TW-WALLET-018 | Legacy self-confirm checkout pages (free credits hole)                                       | implemented | P2       | S      | TW-WALLET-019                               |
| TW-WALLET-019 | Admin credit packages CRUD                                                                   | implemented | P2       | M      | TW-WALLET-001                               |
| TW-WALLET-020 | User wallet tab on the account page                                                          | implemented | P0       | M      | TW-WALLET-016                               |
| TW-WALLET-021 | Wallet statement page with filters and per-message charge detail                             | implemented | P1       | M      | TW-WALLET-001, TW-WALLET-009                |
| TW-WALLET-022 | Wallet statement CSV export                                                                  | implemented | P2       | S      | TW-WALLET-021                               |
| TW-WALLET-023 | Wallet balance display surfaces (rail, top strip, dashboard, more, plan usage, JS user chip) | implemented | P1       | M      | TW-WALLET-002                               |
| TW-WALLET-024 | Message pricing panel and per-template cost chip                                             | implemented | P2       | S      | TW-WALLET-004, TW-WALLET-008                |
| TW-WALLET-025 | Mobile wallet snapshot API (GET api/app/wallet)                                              | implemented | P1       | S      | TW-WALLET-002, TW-WALLET-008                |
| TW-WALLET-026 | Mobile wallet ledger API (GET api/app/wallet/transactions)                                   | implemented | P1       | S      | TW-WALLET-001                               |
| TW-WALLET-027 | Mobile top-up order creation (POST api/app/wallet/topup)                                     | implemented | P1       | M      | TW-WALLET-016                               |
| TW-WALLET-028 | Mobile top-up confirmation with server-side payment verification                             | implemented | P1       | L      | TW-WALLET-027                               |
| TW-WALLET-029 | Balance and billing-mode snapshots inside api/app/credits and extension credits              | implemented | P2       | S      | TW-WALLET-002, TW-WALLET-008                |
| TW-WALLET-030 | Credit grants through WalletService::creditAccount (referral payout)                         | implemented | P1       | S      | TW-WALLET-001                               |
| TW-WALLET-031 | Unused WalletService helpers: chargeForSend, refund, canSend, adminAdjustCredits             | dead-code   | P2       | S      | TW-WALLET-001                               |
| TW-WALLET-032 | Seed data and settings catalogue for the domain                                              | implemented | P1       | S      | TW-WALLET-004, TW-WALLET-019                |
| TW-WALLET-033 | Advertised but absent: auto-recharge, monthly spend cap, admin wallet adjust UI              | docs-only   | P2       | S      | TW-WALLET-001                               |

## Features

### TW-WALLET-001 — Wallet balances and append-only transaction ledger (WalletService funnel)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** none (other domains: AUTH users, WSP workspace owner)
- **Summary:** Every user row carries two mirrored balances, message credits and paid-money in minor units, and every movement is recorded as one immutable `wallet_transactions` row that stores the balance after the movement. `WalletService` is documented as the single funnel; in practice `MessageBillingService` and `OverflowBilling` also write ledger rows directly.
- **Actors & access:** No end-user UI of its own; it is the storage under TW-WALLET-020/021/025/026. The wallet belongs to a USER (the workspace owner, `workspaces.owner_user_id`), not to the workspace. No permission keys or plan gates.
- **UX & screens:** none directly (see TW-WALLET-020 wallet tab and TW-WALLET-021 statement).
- **Endpoints:** none (internal service).
- **Data:**
  - `users.wallet_credits` bigint unsigned default 0 (spendable balance, the number every send gate reads), `users.wallet_currency_minor` bigint unsigned default 0 (running total of paid top-ups minus the money value of spent credits, floors at 0), `users.wallet_currency_code` char(3) default `INR` (set from the first purchased credit package if empty; otherwise never updated by the top-up path, so it is effectively a stale label).
  - `wallet_transactions` (append-only, no `updated_at`): `user_id` FK cascade delete; `kind` in {`credit`, `currency`}; `type` in {`earn`, `spend`, `refund`, `admin_adjust`, `topup`}; `amount` signed bigint; `balance_after` bigint (denormalized balance of that `kind` after the row); `source` varchar(64) free tag; `subject_type` varchar(64) (PHP class name) + `subject_id` (polymorphic pointer, no FK); `description` varchar(191); `meta` JSON; `created_at` default now. Indexes: (`user_id`,`created_at`), (`kind`,`source`), (`subject_type`,`subject_id`).
  - `source` values in use: `message.sent` (delivery charge), `message.refund` (delivery-failed refund), `plan_overflow` (legacy send-time charge), `refund` (dead helper), `topup.conversion` (credit earn paired to a money top-up), `wallet.topup` and `<gateway-slug>.topup` (currency topup rows), `package.purchase`, `referral.paid`, `admin.adjust`, `demo_seed` (demo seeder only).
- **Rules & edge cases:**
  1. Every mutation runs in a DB transaction that first takes a row lock on the user row (`lockForUpdate`), recomputes the new balance from the locked row, updates the mirror column(s) and inserts the ledger row in the same transaction, so mirror and ledger cannot diverge and concurrent sends cannot overspend.
  2. `balance_after` is always computed server-side from the locked row, never taken from callers.
  3. Money movement through top-up writes TWO rows in one transaction: a `kind=currency` `type=topup` row (amount = paid minor, `balance_after` = new `wallet_currency_minor`) and a `kind=credit` `type=earn` row (amount = credits added, `subject` = the currency row) unless credits rounded to 0, in which case only the currency row exists.
  4. Message spends only write a `kind=credit` row; the money mirror (`wallet_currency_minor`) is decreased inside the same transaction by the money value of the credits, but no `kind=currency` spend row is written (asymmetry: the currency ledger never shows spends).
  5. Sign convention is inconsistent (QUIRK): the mobile API comment says signed (positive add, negative spend) and the unused `chargeForSend` writes a negative amount, but the live spend writers (`settleDelivered`, `OverflowBilling`) store spends with a POSITIVE `amount` and `type=spend`. Consumers must classify by `type`, not by sign. The wallet-statement page classifies by sign and therefore mislabels real message charges as "money in" (see TW-WALLET-021).
  6. Balances are unsigned in MySQL, so they can never go negative; code additionally clamps (`max(0, ...)`) for the money mirror and lets `settleDelivered` charge only what is available (partial charge, see TW-WALLET-009).
  7. `description` is truncated to 191 chars only in `chargeForSend`; other writers do not truncate (long descriptions would fail on strict MySQL).
  8. Deleting a user cascades the ledger. Deleting anything a row points at (package, order) leaves the row (no FK).
  9. Expected volume: one credit row per billed message plus refunds; the table is the hot ledger and needs the (`user_id`,`created_at`) index and eventually partitioning.
- **Async & events:** none itself. Low-balance alert is fired by callers (TW-WALLET-015). No websocket broadcast on balance change.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a wallet with 10 credits, When two billing calls of 8 credits each race, Then exactly one succeeds in charging fully and the balance never goes below 0 and the ledger balances add up.
  - Given a top-up of a paid amount, When it is applied, Then one currency-topup row and one credit-earn row are created in one transaction and both `balance_after` values equal the users-table mirrors afterwards.
  - Given any ledger row, When read back, Then `balance_after` equals the balance the mirror held immediately after that row was written.
- **Source refs:** app/Services/WalletService.php, app/Models/WalletTransaction.php, app/Models/User.php (fillable/casts of wallet_*), database/migrations/2026_05_07_120000_create_wallet_and_referrals_tables.php, app/Services/MessageBillingService.php, app/Services/OverflowBilling.php.
- **Port notes:** Nothing exists yet in this repo for a wallet. Suggested home `apps/api/src/modules/wallet` with tables `wallets` (one row per tenant, see Open questions on owner-vs-workspace) and `wallet_ledger` (append-only, `tenant_id` + RLS policy, composite FK to the wallet, unique idempotency key column). Use `numeric`/`bigint` minor units, a CHECK (balance >= 0), and a single `debit()`/`credit()` service that does `UPDATE ... WHERE balance >= x RETURNING` (or `SELECT FOR UPDATE`) plus the ledger insert plus the audit/outbox row in the same transaction. Do not replicate the two-mirror design or the positive-amount spend sign; store spends negative or keep a `direction` column. Add a reconciliation job (sum of ledger == balance).

### TW-WALLET-002 — Credit-to-money unit model, top-up conversion rate and balance display

- **Status:** partial
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-001
- **Summary:** Balances are integer "credits" but customers see money. A single admin setting decides how credits map to money, and every balance display multiplies credits by a per-credit money value before formatting in the workspace currency. The intended end state is 1 credit == 1 minor unit; the shipped default setting contradicts it.
- **Actors & access:** Admin edits the rate in TW-WALLET-003; everyone else only sees the result. No gates.
- **UX & screens:** Balance chips everywhere show money (for example the currency symbol plus two decimals), never a raw credit count, unless the per-credit value cannot be computed (rate <= 0), in which case screens fall back to the raw credit number.
- **Endpoints:** none.
- **Data:** Setting `credits_per_currency_minor` (float, seeded `0.1`, despite the name it means credits granted per ONE MAJOR currency unit). `MessageCreditRate::minorPerCredit()` = 100 / rate (0 when rate <= 0): money minor units that one credit is worth. Top-up credits = floor((paid_minor / 100) * rate). Charge revenue = charged_credits * minorPerCredit rounded to integer minor. Money display = round(credits * minorPerCredit) / 100 passed through the currency formatter (`FormatSettings::display`, CPN domain).
- **Rules & edge cases:**
  1. With the seeded default 0.1: a 100.00 top-up buys 10 credits and each credit is worth 10.00 of money (1000 minor). A flat price of 1 credit per message then costs 10.00 per message.
  2. With rate = 100 (what the checkout and referral code comments assume: "minorPerCredit == 1"): a 100.00 top-up buys 10000 credits, 1 credit = 1 minor, the rate-grid input "You charge 1.00" (stored as 100 credits) equals 1.00 of money, and referral reward "50.00" is stored as 5000 credits. Every UI in the app that divides credits by 100 (statement, checkout preview, grid, referral KPI) is only right in this configuration.
  3. The admin wallet-rules page still labels the setting "how many credits per 1 of money paid" and shows KPIs computed with the raw rate, so its numbers are correct for either configuration but the grid page is only coherent for rate = 100 (QUIRK, see Open questions).
  4. The ledger stores credit counts, not money; a change of rate after the fact silently re-values every existing balance (the balance in money = credits x current rate).
  5. `wallet_currency_minor` is a second, independently drifting money mirror (paid top-ups minus the money value of spends at spend-time rate); screens deliberately ignore it and compute money from `wallet_credits` (comments say the mirror "can drift"). The only place that displays it raw is the account wallet tab variable (unused in markup) and the mobile `currency_balance` field.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `credits_per_currency_minor` (float 0..100000, admin, default 0.1 seeded), `default_currency` (platform currency used for display and for the top-up grant conversion).
- **Acceptance criteria:**
  - Given rate = 100 and a wallet of 5000 credits, When the wallet chip renders in a USD workspace, Then it shows 50.00 in USD format.
  - Given rate = 0, When any wallet chip renders, Then it shows the raw credit count instead of money and no division by zero occurs.
  - Given a 250.00 top-up at rate = 100, When credited, Then 25000 credits are added.
- **Source refs:** app/Services/MessageCreditRate.php (minorPerCredit, displayForCategory), app/Services/WalletService.php (topup), resources/views/admin/settings/wallet-rules.blade.php, resources/views/user/account/index.blade.php (moneyOf), app/Http/Controllers/CheckoutController.php (comments in walletTopupProcess).
- **Port notes:** Recommended target: drop credits entirely, store balances and rates as money minor units in the workspace/platform currency, keep a single `platform_currency` and a display formatter. If a credit abstraction is wanted, define 1 credit = 1 minor and remove `credits_per_currency_minor`. Add currency to the wallet row instead of the stale `wallet_currency_code`. Do not port the drifting `wallet_currency_minor` mirror.

### TW-WALLET-003 — Admin wallet rules page and flat settings save

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-001, TW-WALLET-002
- **Summary:** Platform admin page titled "Message pricing" in the Billing group of the admin sidebar. The top half sets the three flat economics settings and shows four KPI cards plus explanatory copy; the bottom half is the per-country rate grid (TW-WALLET-005). Saving the top form is a separate POST from the grid.
- **Actors & access:** Platform admin only (middleware: Authenticate, EnsureUserIsAdmin, IPAllowlist). No Spatie permission key is checked on these routes (the seeded `billing.*` keys are not referenced).
- **UX & screens:** `resources/views/admin/settings/wallet-rules.blade.php` (layout `x-layouts.admin`, key `wallet-rules`).
  - Header: breadcrumb Admin > Wallet rules, flash area, hero text with anchor to the per-message pricing section.
  - KPI strip (4 cards): Signup reward (money, = referral_signup_credits / 100 with currency symbol), Cost per message (flat credits, singular/plural), Top-up rate (credits per 1 unit of default currency, symbol, and "X buys 100 credits" where X = round(100 / rate, 2), 0 when rate is 0), Real spending (messages per 100 credits = intdiv(100, credits_per_message)).
  - Rules form (POST `admin.settings.affiliate.update`), labelled "live - 3 keys": Signup reward (money, number, min 0, max 100000, step 0.01, symbol prefix), Credits per message (integer 1..1000), How many credits per 1 of money paid (number 0..100000 step 0.01). Live sentence under the form: reward money is enough for intdiv(reward credits, credits per message) messages.
  - Three "quick guide" cards (how wallet credits work, lifecycle, break-even math). Static copy; it wrongly says the balance lives in `workspaces.wallet_credits` and that a top-up gives "1 credit per USD" (QUIRK, stale text).
  - Then the pricing section (TW-WALLET-004/005/006/007). A separate hidden form `rateImportForm` exists for the multipart CSV upload.
  - States: flash `status` after saves ("Wallet rules saved."), validation errors on the settings form; no loading or empty states.
- **Endpoints:**
  | METHOD uri                      | route name                      | Controller@action                            | middleware                                   | request fields                                                                                                                                                | response                                                                                                                        |
  | ------------------------------- | ------------------------------- | -------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
  | GET admin/settings/wallet-rules | admin.settings.wallet-rules     | AdminPagesController@settingWalletRules      | Authenticate, EnsureUserIsAdmin, IPAllowlist | none                                                                                                                                                          | view with `settings`, `perCountryEnabled`, `payPerMessage`, `messageRates` (default rows first, then by country_code, category) |
  | POST admin/settings/affiliate   | admin.settings.affiliate.update | AdminPagesController@settingsAffiliateUpdate | same                                         | `referral_signup_credits` required numeric 0..100000; `credits_per_message` required integer 1..1000; `credits_per_currency_minor` nullable numeric 0..100000 | redirect to wallet-rules with flash "Wallet rules saved."                                                                       |
- **Data:** `system_settings` rows (key unique, type string, value text). Saves: `referral_signup_credits` (int) = round(input x 100) minor, `credits_per_message` (int), `credits_per_currency_minor` (float) only when the field is non-empty (blank submit never zeroes the rate). Reads the same three plus `per_country_credits_enabled` and `bsp_pay_per_message`.
- **Rules & edge cases:**
  1. The signup reward is entered as money and stored x100; the referral payout later credits that stored number as CREDITS, valid only if 1 credit == 1 minor (see TW-WALLET-002/030).
  2. Credits per message cannot be 0 here (min 1), so a "free flat rate" needs the rate grid instead.
  3. No audit log entry is written for setting changes.
  4. The GET is also linked from `admin.bsp.rate-cards.index` (TW-WALLET-008) and from the admin sidebar (child "Message pricing").
  5. Rate saving does not flush the resolver cache (only grid, import and sync do). The flat settings are read live, but `credits_per_currency_minor` changes apply immediately to display everywhere.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** the three keys above; `referral_signup_credits` default 100, `credits_per_message` default 1, `credits_per_currency_minor` default 0.1.
- **Acceptance criteria:**
  - Given an admin, When they submit credits per message 3 and rate 100, Then `system_settings` holds 3 and 100 and the KPI strip shows "3 credits" and "1 credit per unit".
  - Given a blank rate field, When the form is submitted, Then the stored rate is unchanged.
  - Given a non-admin or an IP outside the allowlist, When they open the page or POST, Then access is denied.
  - Given credits per message 0, When submitted, Then validation fails.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (settingWalletRules, settingsAffiliateUpdate), resources/views/admin/settings/wallet-rules.blade.php, resources/views/components/admin/sidebar.blade.php, routes/admin.php, Documentation/pages/bsp-billing/admin-pages.html.
- **Port notes:** Home: `apps/web/.../admin/billing/message-pricing` + `apps/api/src/modules/admin-billing`. Store settings in the platform settings table (SET domain) with typed keys; write an audit-log row on every change (Reference does not). Use money inputs only if the credit layer is dropped (TW-WALLET-002).

### TW-WALLET-004 — Per-country x category credit-rate resolution (MessageCreditRate + PhoneCountry)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-003
- **Summary:** Given a recipient phone number and a message category, return how many credits one message costs and, separately, what Meta charges the platform for it. Country is derived from the dialing-code prefix; the most specific active rate row wins; a flat setting is the safety net. The whole per-country mode is a master switch that is OFF unless the admin opts in.
- **Actors & access:** internal service used by settlement, precheck (does NOT use it), legacy overflow billing, UI price display, P&L. No direct user access.
- **UX & screens:** indirectly the rate grid (TW-WALLET-005), pricing panel (TW-WALLET-024).
- **Endpoints:** none.
- **Data:** `message_rates`: `country_code` char(2) default '' (ISO alpha-2, '' = any country), `category` varchar(20) default '' ('' = any category), `credits` unsigned int default 1 (customer price, 0 = free), `meta_cost_minor` unsigned bigint nullable (Meta wholesale cost in minor units of `currency`), `currency` varchar(8) nullable, `is_active` bool default 1; UNIQUE (`country_code`,`category`); index country_code. Model constant categories: marketing, utility, authentication, service.
- **Rules & edge cases:**
  1. Master switch `per_country_credits_enabled` (setting, "1"/"0", default off, not seeded). When off, `creditsFor` returns the flat `credits_per_message` (floored at 0) regardless of any rate rows; cost lookup (`metaCostMinorFor`) ignores the switch and still works, so P&L cost is recorded even in flat mode.
  2. Category normalization: trim + lowercase; anything outside the four categories becomes '' (matches "any category" rows). Callers pass the Meta category from the WABA webhook (pricing.category, else conversation.origin.type), or the resolved template category (`effectiveCategory()`), or null for Baileys/Twilio chat.
  3. Country resolution (`PhoneCountry::iso`): strip non-digits, try prefixes of length 3, 2, then 1 against a built-in dial-code map (about 130 entries, one representative ISO per code, +1 maps to US for the whole NANP, +7 to RU); unknown prefix gives null (treated as '' country). Known imprecision: 3-digit map also contains duplicates (353) and lacks many countries; unmatched numbers fall to the default rows.
  4. Lookup order (most specific first): `COUNTRY|category`, `COUNTRY|` (country any category), `|category` (any country, this category), `|` (global default). First key present wins, even if its credits value is 0 (0 = deliberately free, e.g. service). If no key matches, the flat setting is used.
  5. `creditsFor` returns max(0, int) of the row; rows with `is_active=0` are ignored (the UI never sets 0, rows are deleted instead).
  6. Both maps are cached 5 minutes (`message_rates_map`, `message_rates_cost_map`) and flushed by `MessageCreditRate::forget()` after grid save, import and sync. Changing rates by any other path takes up to 5 minutes to apply.
  7. `metaCostMinorFor` returns null when no matching row carries a cost, so P&L can distinguish unknown from free (0 is stored as 0).
  8. `displayForCategory(cat)` returns the any-country base price for UI (`creditsFor(null, cat or 'utility')`), money = round(credits x minorPerCredit), `free` when credits <= 0. `displayTable()` maps the four categories. Note that with per-country ON the number shown is the country-independent default and the real charge can differ.
  9. `PhoneCountry` also exposes `NAMES` (about 110 ISO names), `names()` sorted, and `resolve(value)` which accepts ISO-2, a country name (case-insensitive, aliases usa, uk, uae, korea, russia, vietnam, ivory coast), or a calling code ("1", "+91"), used by CSV import (TW-WALLET-006).
- **Async & events:** cache invalidation only.
- **External systems:** none (no libphonenumber; pure prefix table).
- **Settings:** `per_country_credits_enabled` (off), `credits_per_message` (flat, 1), rows in `message_rates`.
- **Acceptance criteria:**
  - Given per-country ON and rows `|`=1, `|service`=0, `IN|marketing`=1, `US|marketing`=12, When pricing a marketing message to +1 415..., Then 12; a service reply to +91..., Then 0; a utility message to an unknown prefix, Then 1 (global default).
  - Given per-country OFF, When pricing any message, Then the flat credits_per_message is returned.
  - Given a rate edit, When the grid is saved, Then the next lookup within seconds uses the new value (cache flushed).
  - Given a number with prefix 971, When resolved, Then AE (3-digit beats 1-2 digit).
- **Source refs:** app/Services/MessageCreditRate.php, app/Support/PhoneCountry.php, app/Models/MessageRate.php, database/migrations/2026_06_28_160000_create_message_rates_table.php, database/migrations/2026_08_11_140000_add_bsp_cost_to_message_rates.php.
- **Port notes:** Home `apps/api/src/modules/wallet/rate-card`. Table `message_rates` at platform scope (no tenant_id, admin-managed; read-only to tenants). Use libphonenumber for country instead of the hand table (the WhatsApp API pricing is by recipient country), keep the four-level fallback, cache in Redis with explicit invalidation, and make the mode switch a real setting with a default. Persist meta cost with enough precision (see TW-WALLET-005 rounding quirk): store per-message cost as decimal or micro-units.

### TW-WALLET-005 — Admin per-country rate grid: save, delete, seed, toggles

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-004
- **Summary:** The lower half of the wallet-rules page: an editable table of (country, category) rows with what the customer is charged, Meta cost and live margin, plus two master switches (per-country pricing on/off, pay-per-message mode on/off), an optional "re-seed starter card" checkbox and a Remove checkbox per row.
- **Actors & access:** Platform admin (same middleware as TW-WALLET-003).
- **UX & screens:** Section `#message-pricing` of wallet-rules.blade.php, JS `resources/js/charts/admin-wallet-rules.js` (page key `admin-wallet-rules`).
  - Toggle 1 "Enable per-country pricing" (`per_country_credits_enabled`).
  - Toggle 2 "Pay-per-message mode (prepaid wallet)" (`bsp_pay_per_message`), with ON/OFF explanatory copy (ON: plan monthly limit ignored, wallet is the only gate, expired plan does not block if wallet has funds).
  - Sync Meta costs button (TW-WALLET-007, with confirm dialog) and Import file input + button (TW-WALLET-006).
  - Grid columns: Country (searchable TomSelect, blank option "Any country (default)", backed by the `country-state-city` list so any ISO country can be chosen), Category (Any category, Marketing, Utility, Authentication, Service (free window)), You charge (money number, min 0, step 0.01, stored x100), Meta cost (money, min 0, step 0.0001, stored x100), Your margin (computed live in JS as charge minus cost and percentage of cost, green positive / red negative, dash when either blank), Remove checkbox (existing rows only).
  - Render: all existing rows ordered default rows first, then country_code, category; then always 2 blank rows for adding (no add-row button; add at most 2 rows per save). Each existing row also carries hidden `orig_country[]` and `currency[]`.
  - Explanatory panels: cross-border note (billing is by RECIPIENT country), "how this works in simple words", and the resolution-order footnote.
  - A "Also re-seed the starter rate card (India/US/UK/BR/AE/MX)" checkbox next to the Save rates button. Enter in a price cell saves (an off-screen first submit button prevents Enter from triggering Sync).
- **Endpoints:**
  | METHOD uri                        | route name                          | Controller@action                       | middleware                                   | request fields                                                                                                                                                                                              | response                                            |
  | --------------------------------- | ----------------------------------- | --------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
  | POST admin/settings/message-rates | admin.settings.message-rates.update | AdminPagesController@messageRatesUpdate | Authenticate, EnsureUserIsAdmin, IPAllowlist | `per_country_credits_enabled`, `bsp_pay_per_message` (checkboxes), `seed`, parallel arrays `country_code[]`, `category[]`, `credits[]`, `meta_cost[]`, `currency[]`, `orig_country[]`, `delete[]` (row ids) | redirect back with flash "Per-country rates saved." |
- **Data:** upserts `message_rates` by (`country_code`,`category`); sets `system_settings` `per_country_credits_enabled` and `bsp_pay_per_message` to "1"/"0" on EVERY save (an unchecked box turns the mode off).
- **Rules & edge cases:**
  1. Both master switches are overwritten on every save from the checkboxes; a save from a stale page can silently flip them.
  2. Seed (`seed` ticked): upserts ten starter rows: global `|`=1.00, `|service`=0, `|utility`=1.00, `|authentication`=1.00, `IN|marketing`=1.00, `US|marketing`=12.00, `GB|marketing`=12.00, `BR|marketing`=6.00, `AE|marketing`=5.00, `MX|marketing`=3.00, stored x100 (so 100, 1200, ...), active. (The install-time migration seed differs: it stores plain whole credits 1, 12, 6, 5, 3, and utility/authentication rows for IN, US, GB, and 0/1/1 defaults, so a fresh install's rows read as 0.01, 0.12 in the grid; QUIRK.)
  3. Delete handling: ids in `delete[]` are resolved to their (country|category) keys FIRST, deleted, and those keys are skipped in the upsert loop; otherwise the still-submitted grid inputs would re-create the deleted row.
  4. Upsert loop per row index: country trimmed/uppercased; if empty, recovered from `orig_country[i]` when it is a valid ISO-2 (guards a JS widget desync that submits empty country); category trimmed/lowercased; skip a row when BOTH credits and meta_cost are blank (a meta-cost-only row is allowed); skip when category is non-empty and not one of the four; skip when country is non-empty and not two letters; first-wins de-dup on (country|category) within one submit (a later collapsed duplicate can no longer overwrite the price the admin typed); skip keys just deleted.
  5. `credits` = max(0, round(input x 100)) only when the field is non-blank (blank leaves existing credits untouched); `meta_cost_minor` = blank -> null else max(0, round(input x 100)) (QUIRK: sub-cent Meta costs are rounded to whole cents, e.g. 0.025 becomes 0.03 and 0.004 becomes 0.00, so real WhatsApp per-message costs lose precision; the input allows 4 decimals but storage is 2); `currency` = uppercased hidden value or null (the hidden currency input actually carries the currency SYMBOL for blank rows; QUIRK).
  6. New rows created by the grid always `is_active=true`. Rows are never deactivated by the UI.
  7. `MessageCreditRate::forget()` flushes both caches after save.
  8. No audit log entry; no maximum price validation; `credits` is an unsigned int in DB so absurd values error at the DB.
  9. Docs claim "one searchable list covering all ~250 countries"; in code only rows that exist (plus 2 blanks) render, the picker offers all countries.
- **Async & events:** cache flush only.
- **External systems:** none.
- **Settings:** `per_country_credits_enabled`, `bsp_pay_per_message`.
- **Acceptance criteria:**
  - Given a US marketing row entered as 12.00, When saved, Then `credits`=1200 and reloading shows 12.00.
  - Given a row ticked Remove and still filled in, When saved, Then it is deleted and not re-created.
  - Given two submitted rows for the same key, When saved, Then the first wins.
  - Given both checkboxes unticked, When saved, Then both modes are stored "0".
  - Given a country widget that submitted an empty country for a row whose hidden orig is "US", When saved, Then the row is stored as US.
  - Given Meta cost 0.025, When saved, Then it is stored as 3 minor units (documented rounding) unless the port improves precision.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (messageRatesUpdate), resources/views/admin/settings/wallet-rules.blade.php, resources/js/charts/admin-wallet-rules.js, app/Services/MessageCreditRate.php, app/Support/PhoneCountry.php (NAMES), Documentation/pages/bsp-billing/admin-pages.html.
- **Port notes:** Rebuild as an editable table with explicit add-row and per-row delete (fix the 2-blank-rows limit), server-side validation with per-row errors, and separate endpoints for the two switches so a rate save cannot flip them. Fix the meta-cost precision (store micro-units) and do not reuse the credits x100 convention if the credit layer is dropped. Audit every change.

### TW-WALLET-006 — Admin rate-card CSV import

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-004
- **Summary:** Upload Meta's official "rates by country" CSV (or a simple long-format CSV) to fill or update Meta cost, and optionally customer price, for many (country, category) pairs at once, converting every cost into the platform currency.
- **Actors & access:** Platform admin (same middleware).
- **UX & screens:** File input `file` (accept .csv, text/csv, required) and "Import my rate card" button inside the pricing section, posting to a separate multipart form. Result flash: added, updated, skipped counts and the currency converted to.
- **Endpoints:**
  | METHOD uri                               | route name                          | Controller@action                       | middleware                                   | request fields                                    | response                                                                  |
  | ---------------------------------------- | ----------------------------------- | --------------------------------------- | -------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
  | POST admin/settings/message-rates/import | admin.settings.message-rates.import | AdminPagesController@messageRatesImport | Authenticate, EnsureUserIsAdmin, IPAllowlist | `file` required, file, mimes csv,txt, max 4096 KB | redirect back with status flash or error flash "Could not read the file." |
- **Data:** upserts `message_rates` (`meta_cost_minor`, `currency` = platform currency code, `credits`, `is_active`=true).
- **Rules & edge cases:**
  1. First row is the header (lowercased, trimmed). Wide shape is detected when the header contains at least one of marketing/utility/authentication/service AND has no `category` column (one row per country, one column per category). Otherwise long shape (`category` column).
  2. Country cell read from the first present of `country_code`, `country code`, `country`, `market`; blank or `*` means the any-country default (''); otherwise resolved by `PhoneCountry::resolve` (ISO, name, alias or calling code); unresolvable rows are skipped (counted).
  3. Currency: the row's `currency` column or the platform currency; cost is converted into platform currency with `FormatSettings::convert` (unknown currency falls back to 1:1) then stored round(x100) minor (same sub-cent rounding quirk as TW-WALLET-005).
  4. Cost column for long shape: first present of `meta_cost`, `cost`, `rate`, `price`; non-numeric or blank cost leaves the existing cost untouched but still upserts.
  5. Customer price: only when a `credits` column is present and non-blank; taken as an integer number of CREDITS with no x100 (QUIRK: the grid takes money and multiplies by 100, the import takes raw credits, so a CSV `credits` of 1 means 0.01 of money at rate 100).
  6. Long shape: category blank means any category; invalid category skips the row. Wide shape: each non-empty category cell (marketing/utility/authentication/service) upserts one row; a row with no populated cell is skipped.
  7. New rows created with `credits` from the CSV or 0 (a new imported row prices at zero until the admin sets a price: free messages if per-country mode is on and no later default applies).
  8. Existing rows update in place; every upsert sets `is_active`=true and `currency` to the platform code.
  9. Cache flushed at the end. File is streamed with `fgetcsv` (no charset detection, no delimiter detection: comma only, no BOM handling).
- **Async & events:** cache flush.
- **External systems:** none (the admin downloads the CSV from Meta's pricing page or WhatsApp Manager).
- **Settings:** platform currency (`default_currency`), currency rates table (CPN).
- **Acceptance criteria:**
  - Given a wide CSV row `IN, INR, marketing 0.7846, utility 0.115`, When imported into a USD platform, Then two rows are upserted with costs converted to USD minor units.
  - Given a row with country "Narnia", When imported, Then it is skipped and counted.
  - Given a CSV over 4 MB or a non-csv file, When uploaded, Then validation rejects it.
  - Given a long-shape row `US, marketing, 0.0250`, When imported, Then cost is stored (rounded per the documented rule) and customer price is untouched.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (messageRatesImport), app/Support/PhoneCountry.php (resolve), app/Support/FormatSettings.php (convert), Documentation/pages/bsp-billing/admin-pages.html.
- **Port notes:** Home `apps/api/src/modules/wallet/rate-card/import`. Use a queued job for large files, streaming parser with delimiter detection and BOM stripping, dry-run preview with row errors before commit, and an explicit "you charge" column in money (not credits). Currency conversion from the CPN currency service.

### TW-WALLET-007 — Admin "Sync Meta costs" (live pull with bundled fallback)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-004
- **Summary:** One click fills the Meta wholesale cost column for every country x (marketing, utility, authentication) from a live Meta pricing endpoint if the admin wired one, otherwise from an indicative bundled rate card, converting each rate to the platform currency. Customer prices are never touched.
- **Actors & access:** Platform admin.
- **UX & screens:** "Sync Meta costs" button in the pricing section with confirm dialog ("Load Meta wholesale costs for every country (converted to CUR)? Your customer prices are not touched."). Result flash with source label, version, currency, added and updated counts and the hint to set customer prices then Save.
- **Endpoints:**
  | METHOD uri                                  | route name                             | Controller@action                         | middleware                                   | request fields | response                                                                                                            |
  | ------------------------------------------- | -------------------------------------- | ----------------------------------------- | -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
  | POST admin/settings/message-rates/sync-meta | admin.settings.message-rates.sync-meta | AdminPagesController@messageRatesSyncMeta | Authenticate, EnsureUserIsAdmin, IPAllowlist | none           | redirect back with status or error flash "Could not fetch rates from Meta, and the bundled fallback is unreadable." |
- **Data:** upserts `message_rates` (`meta_cost_minor`, `currency`, `is_active`; `credits` set to 0 only when null on a new row).
- **Rules & edge cases:**
  1. Live source first: settings `bsp_meta_rates_endpoint` and `bsp_meta_system_user_token` (set on the BSP "Connect Meta" page); HTTP GET with bearer token, 20 s timeout, JSON. Accepts either `{rates:[{country,currency,marketing,utility,authentication}], version}` or a flat list (or `data:` wrapped) of `{country|country_code, currency, category, rate|amount|price}` which is folded per country. Any failure (not configured, non-200, exception, empty) silently falls through to the bundled file.
  2. Bundled fallback: `resources/data/meta-rate-card.json` (version "2026-07", 24 country rows, values USD unless a row sets a currency, marked INDICATIVE only; a `*`-country row would map to the any-country default).
  3. For each row: country must be `*` or two letters; for marketing, utility, authentication only (service is never synced); amount converted from row currency to the platform currency via `FormatSettings::convert`, minor = max(0, round(x100)) (sub-cent precision lost, e.g. US utility 0.004 becomes 0).
  4. Existing customer `credits` are untouched; new rows are created with credits 0 (so with per-country mode ON, a synced country whose row has 0 credits now charges nothing for that category; QUIRK, exact-match rows shadow the global default even at 0).
  5. Cache flushed after.
- **Async & events:** cache flush; log lines `[RATE-SYNC]` on live failures.
- **External systems:** Meta pricing endpoint (admin-configured URL + system-user token, stored in system settings; bearer auth; 20 s timeout; failure = silent fallback). The token is a secret stored in `system_settings` (not obviously encrypted).
- **Settings:** `bsp_meta_rates_endpoint`, `bsp_meta_system_user_token`, platform currency.
- **Acceptance criteria:**
  - Given no live endpoint configured, When the admin syncs, Then the bundled card is applied and the flash names "bundled reference" and version 2026-07.
  - Given a live endpoint returning a flat list, When synced, Then rows are grouped per country and applied with source "Meta (live)".
  - Given a synced country previously priced at 5, When synced, Then its customer price stays 5.
- **Source refs:** app/Http/Controllers/AdminPagesController.php (messageRatesSyncMeta, fetchLiveMetaRates), resources/data/meta-rate-card.json, Documentation/pages/bsp-billing/admin-pages.html, Documentation/pages/bsp-billing/api-reference.html.
- **Port notes:** Make sync a queued job with a preview, store the token encrypted, keep the bundled card as seed data under the repo (data file, not copied text) and store per-message Meta cost with adequate precision. Rates change quarterly (Jan/Apr/Jul/Oct 1), so version the card.

### TW-WALLET-008 — Billing-mode resolution: pay-per-message switch and reseller flag

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-005
- **Summary:** One boolean per workspace decides whether the wallet is charged for every delivered message ("wallet" billing mode) or only for messages beyond the plan quota ("plan" mode). It is the OR of the workspace's `bill_to_platform_credit` flag and the global `bsp_pay_per_message` setting.
- **Actors & access:** Global switch: platform admin (TW-WALLET-005). Per-workspace flag: workspace admin chooses "Bill me through us" vs "Meta bills me directly" on the connect-WhatsApp device page (`POST devices/billing-mode`, role admin; owned by `bsp-billing-engine`/`whatsapp-devices-baileys`, referenced here). The closure route `GET admin/bsp/rate-cards` is a plain redirect to the wallet-rules page.
- **UX & screens:** No screen of its own. Effects: hides/shows the message-pricing panel, per-template cost chip, dashboard "pay per message" tag, account wallet copy, referral copy, "amount per message" in APIs.
- **Endpoints:**
  | METHOD uri                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | route name                 | Controller@action        | middleware                      | request fields | response                                |
  | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------ | ------------------------------- | -------------- | --------------------------------------- |
  | GET admin/bsp/rate-cards                                                                                                                                                                                                                                                                                                                                                                                                                                                   | admin.bsp.rate-cards.index | Closure (routes/bsp.php) | Authenticate, EnsureUserIsAdmin | none           | redirect to admin.settings.wallet-rules |
  | (Referenced, not owned: POST devices/billing-mode, DevicesController@setBillingMode, middleware Authenticate + EnsureWorkspaceRole:admin, field `mode` in {meta_direct, reseller}; reseller is refused with an error flash when the platform Meta credit line is not configured, otherwise sets `workspaces.bill_to_platform_credit`, attaches the credit line to the workspace's connected WABAs, success flash "Billing set: we bill you per message from your wallet.") |
- **Data:** `workspaces.bill_to_platform_credit` (bool default 0, in `Workspace::$fillable`, cast bool); setting `bsp_pay_per_message` ("1"/"0", default "0").
- **Rules & edge cases:**
  1. `payPerMessageFor(workspace)` = `workspace.billsToPlatform()` OR global `bsp_pay_per_message == "1"`; a null workspace falls back to the global value only.
  2. Reseller (bill_to_platform_credit) workspaces are ALWAYS pay-per-message even if the global switch is off; meta_direct workspaces follow the global default (normally off).
  3. Docs claim a meta_direct customer is never charged even when the global switch is ON; in code the global switch ON makes every workspace pay-per-message regardless of its own choice (QUIRK, doc/code mismatch).
  4. Platform-admin-owned workspaces are exempt from billing in all modes (see TW-WALLET-009).
  5. The mode drives what `billing_mode` reads in APIs: `wallet` when pay-per-message else `plan`.
- **Async & events:** none (a reseller switch triggers the BSP credit-line attach, not owned here).
- **External systems:** Meta credit line (BSP domain).
- **Settings:** `bsp_pay_per_message`, per-workspace `bill_to_platform_credit`.
- **Acceptance criteria:**
  - Given global switch off and a workspace with bill_to_platform_credit = 1, When billing mode is resolved, Then pay-per-message is true.
  - Given global switch on and a normal workspace, When resolved, Then true (code behavior).
  - Given an admin opens GET admin/bsp/rate-cards, Then they are redirected to the wallet-rules page.
- **Source refs:** app/Services/MessageBillingService.php (payPerMessage, payPerMessageFor), app/Models/Workspace.php (billsToPlatform, fillable), app/Http/Controllers/DevicesController.php (setBillingMode, read-only reference), routes/bsp.php, Documentation/pages/bsp-billing/overview.html, Documentation/pages/bsp-billing/customer-flow.html, Documentation/pages/bsp-billing/billing-engine.html.
- **Port notes:** Model as `tenants.billing_mode` enum (`plan_quota` | `wallet`) plus a platform default, resolved in one function; keep it out of controllers. BSP domain owns the credit-line side.

### TW-WALLET-009 — Delivery-time settlement: charge once per message id (settleDelivered)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-WALLET-001, TW-WALLET-004, TW-WALLET-008
- **Summary:** The single choke point where money moves for messages. When a provider confirms a message went out, `MessageBillingService::settleDelivered` prices it, decides free versus charged, debits the wallet owner's balances, writes a spend ledger row and a `message_charges` row (the P&L source), all idempotently per provider message id. It never throws: the message already left, so it is always accounted for (charged or recorded free).
- **Actors & access:** System only, invoked by webhook/callback handlers (TW-WALLET-012). No user-facing permission.
- **UX & screens:** none; effects show on wallet tab, statement, alerts, P&L dashboards.
- **Endpoints:** none (service). Callers listed in TW-WALLET-012.
- **Data:**
  - `message_charges`: `workspace_id` (required), `user_id` (wallet owner, nullable), `provider` varchar(16) (`waba`, `twilio`, `baileys`), `wamid` varchar(191) UNIQUE (idempotency + refund key), `to_country` char(2) nullable, `category` varchar(24) nullable, `source` varchar(32) nullable (`campaign`, `broadcast`, `scheduled`, `chat`, `flow`, null for WABA webhook), `credits` unsigned int default 0 (credits actually debited), `revenue_minor` bigint default 0 (money value of the credits charged), `cost_minor` bigint nullable (Meta wholesale cost, null = unknown), `status` enum(`free`,`charged`,`refunded`) default charged, `wallet_tx_id` (ledger row of the spend), `meta` JSON, timestamps. Indexes: (`workspace_id`,`created_at`), `workspace_id`, `user_id`, `status`.
  - `wallet_transactions` spend row: `kind=credit`, `type=spend`, `source=message.sent`, `amount` = credits charged (positive, see TW-WALLET-001 quirk), `balance_after`, `description` = "WhatsApp message" plus " . COUNTRY" and " . category" when known, `meta` {wamid, provider, source, money_minor, cost_minor}.
  - `users.wallet_credits` and `users.wallet_currency_minor` of the workspace OWNER.
- **Rules & edge cases:**
  1. Guards: blank/whitespace wamid or workspace id <= 0 returns null (nothing recorded). Unknown workspace returns null.
  2. Idempotency: an existing `message_charges` row for the wamid is returned untouched (a sent -> delivered -> read sequence, duplicate webhooks and Baileys+Twilio double reports charge once). A concurrent insert race is caught on the unique key (MySQL 1062 or "unique/duplicate" text) and returns the winner's row; any other DB error is logged and returns null.
  3. Platform-admin-owned workspaces (owner has role Super Admin or Admin, or legacy `users.role` in `admin`/`A`) are never billed: return null, nothing written (not even a free row), an info log line `[BILLING] admin-skip`.
  4. Price = max(0, `MessageCreditRate::creditsFor(phone, category)`); Meta cost = `metaCostMinorFor` (null when unknown). Country from the recipient phone prefix, category lowercased/trimmed (TW-WALLET-004).
  5. Free decision: free when price == 0 OR (workspace is NOT pay-per-message AND still within the plan's free monthly quota, TW-WALLET-010). Reseller/pay-per-message workspaces skip quota entirely.
  6. Free path (rate 0, in-quota, or no wallet owner `owner_user_id` <= 0) writes a `message_charges` row status `free` with credits 0, revenue 0 and the Meta cost (so P&L still sees the cost of free/quota messages), and no ledger row. Reason logged: `rate_is_zero`, `no_wallet_owner` or `within_plan_free_quota`.
  7. Charge path (all inside one DB transaction): lock the owner row; if the owner no longer exists record free. `have` = owner credits; `charged` = max(0, min(price, have)) so a partial charge happens when the balance is below the price (no rejection). If `charged` = 0 (empty wallet at delivery) the message is recorded FREE (revenue leak by design, comment: "wallet-empty") and the low-balance hook still fires with balance 0.
  8. Revenue = round(charged x `minorPerCredit`). New credits = have - charged; new money mirror = max(0, currency_minor - revenue). Both saved on the owner. Ledger spend row and `message_charges` row (status `charged`, `wallet_tx_id` set) are created in the same transaction. Then `afterSpend` triggers the low-balance alert (TW-WALLET-015).
  9. The wallet debited is always the OWNER's (`workspaces.owner_user_id`), not the acting agent's and not the buyer's top-up account (QUIRK if a non-owner tops up: the credit goes to the topping-up user's own wallet).
  10. Revenue is computed from the CURRENT rate setting at settle time; changing `credits_per_currency_minor` later changes revenue on new rows only.
  11. Provider/`source` are trusted strings from the caller; category may be any string (normalized only for pricing; the raw lowercase string is stored on the row).
- **Async & events:** Called inline from webhook/callback handlers (no queue). Fires `WalletAlerts::lowBalance` (throttled). Log lines prefixed `[BILLING]` (settle, free, charged, wallet-empty, admin-skip).
- **External systems:** none directly; category comes from Meta's status webhook `pricing.category` or `conversation.origin.type`.
- **Settings:** `credits_per_message` (flat fallback), `per_country_credits_enabled`, `bsp_pay_per_message`, `credits_per_currency_minor`, `wallet_low_balance_threshold` (default 20, no admin UI), `wallet_billing_on_delivery` (default on; see TW-WALLET-014).
- **Acceptance criteria:**
  - Given a pay-per-message workspace with 100 credits and a US marketing price of 12, When a delivered status arrives for a new wamid, Then 12 credits are debited, one spend ledger row and one `message_charges` row status charged exist and balance_after is 88.
  - Given the same wamid arrives again as `read`, When settled, Then nothing further is charged.
  - Given a wallet with 3 credits and a price of 12, When settled, Then 3 credits are charged (partial) and the balance is 0.
  - Given an empty wallet, When settled, Then the row is recorded free and the low-balance alert fires.
  - Given an admin-owned workspace, When settled, Then no rows are written.
  - Given a service message priced 0, When settled, Then a free row with the Meta cost is recorded and no ledger row.
- **Source refs:** app/Services/MessageBillingService.php, app/Models/MessageCharge.php, database/migrations/2026_08_12_000000_create_message_charges_table.php, Documentation/pages/bsp-billing/billing-engine.html.
- **Port notes:** Home `apps/api/src/modules/wallet/billing/message-billing.service.ts`, invoked by a BullMQ worker consuming provider-status events from the outbox (never inline in a webhook handler). `message_charges` becomes a partitioned, tenant-scoped table with `UNIQUE (provider, provider_message_id)` and RLS; the debit uses the wallet module's atomic debit with an idempotency key. Decide explicitly whether to keep "record free when the wallet is empty" (recommended: keep, but flag the message `unbilled` and alert). Keep the partial-charge behavior only if the business wants it; otherwise write an `unbilled_credits` shortfall column.

### TW-WALLET-010 — Plan-quota-first free allowance in classic mode and plan-expiry behavior

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-009
- **Summary:** In plan (non pay-per-message) mode, the first N delivered messages of the calendar month are free, where N is the workspace's effective `monthly_messages_limit`; beyond N the wallet pays; an expired plan or trial has no free allowance at all.
- **Actors & access:** System. Plan limit comes from `plans-subscriptions-trials` (`Workspace::effectiveLimit('monthly_messages_limit')`, honoring per-workspace `plan_overrides`; platform-admin-owned workspaces get -1 = unlimited).
- **UX & screens:** Explained on the wallet tab "How billing works" card (TW-WALLET-020) and plan usage card (TW-WALLET-023).
- **Endpoints:** none.
- **Data:** counts `message_charges` rows for the workspace with `created_at >= start of this calendar month` of ANY status (free, charged, refunded). Reads `workspaces.plan_ends_at`, `trial_ends_at`, plan package.
- **Rules & edge cases:**
  1. `withinFreeQuota(workspace, add)`: returns false when the plan is not active (`planIsActive()` false: paid plan past `plan_ends_at`, or free plan past `trial_ends_at`), meaning the wallet must cover every message; returns true when the limit is null or <= 0 (unlimited); otherwise true when used + add <= limit, where used = the month's `message_charges` count.
  2. Because rows of all statuses count, refunded and free (including zero-priced service) messages consume quota (QUIRK), and the counter resets on the 1st of the calendar month in the SERVER timezone (not the workspace timezone, not the plan anniversary).
  3. Because the check uses rows already written (used) and `add` = 1 at settle time, the charge decision is made per message in delivery order; concurrent deliveries near the boundary can each see the same `used` and both be free (no lock on the count).
  4. Expired plan in plan mode: NOT blocked. The message is charged from the wallet if credits exist, otherwise recorded free because nothing can be deducted (send-time blocking existed only in the legacy path, TW-WALLET-014). In pay-per-message mode plan status is ignored entirely.
  5. Over quota with an empty wallet: message still delivers and is recorded free (charge = 0).
  6. Unlimited (null/0/-1) quota means every message is free forever; the wallet is never touched.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** plan package `monthly_messages_limit`; per-workspace `plan_overrides`; workspace `cap_monthly_messages` is a separate hard cap owned by PLAN.
- **Acceptance criteria:**
  - Given a plan with limit 1000 and 999 rows this month, When the 1000th message is delivered, Then it is free; the 1001st charges the wallet.
  - Given a plan that expired yesterday and wallet 50 credits, When a message is delivered, Then it is charged (no free quota).
  - Given an unlimited plan, When messages are delivered, Then no wallet movement occurs.
- **Source refs:** app/Services/MessageBillingService.php (withinFreeQuota), app/Models/Workspace.php (planIsActive, effectiveLimit, billsToPlatform), app/Services/PlanUsage.php, resources/views/user/account/index.blade.php.
- **Port notes:** Implement as a `QuotaService` reading the plan module; count usage from a dedicated monthly counter (Redis or a `usage_counters` table) instead of scanning the ledger, use the tenant timezone or billing-cycle anchor, and count only billable/delivered messages if the product intends that.

### TW-WALLET-011 — Failed-delivery refund (settleFailed)

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-009
- **Summary:** When the provider later reports the message failed or undelivered, the exact charge is reversed so customers never pay for undelivered messages.
- **Actors & access:** System.
- **UX & screens:** A refund row appears in the wallet activity and statement as type Refund with description "Refund - message not delivered".
- **Endpoints:** none.
- **Data:** `message_charges.status` charged -> refunded; new `wallet_transactions` row `kind=credit`, `type=refund`, `source=message.refund`, `amount` = original credits (positive), subject = the `message_charges` row, `meta` {wamid, money_minor}; owner's `wallet_credits` increased by the charged credits and `wallet_currency_minor` by the stored revenue.
- **Rules & edge cases:**
  1. Runs in a DB transaction that locks the `message_charges` row; if there is no row or status is not `charged` (free or already refunded) it does nothing (idempotent, no double refund).
  2. Credit refund only when the row has a `user_id` and credits > 0; the status is flipped to refunded regardless.
  3. Refund restores the credits actually charged (partial charges refund partially) and the recorded revenue, not the current rate.
  4. Free rows that later fail are left as free (nothing to reverse); refunded messages still count toward the monthly free quota (TW-WALLET-010).
  5. A message that fails AFTER delivery/read is impossible in providers' state machines, but a later `sent` for an already-refunded wamid does not re-charge (row exists).
  6. No low-balance recheck on refund; no notification.
- **Async & events:** inline in the failure webhook; logs only.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given a charged message of 12 credits, When the provider reports failed, Then 12 credits return, a refund ledger row exists and the charge row status is refunded.
  - Given the failure webhook fires twice, When processed, Then only one refund happens.
  - Given a free message that fails, Then no wallet movement occurs.
- **Source refs:** app/Services/MessageBillingService.php (settleFailed), app/Http/Controllers/WaWebhookController.php, Documentation/pages/bsp-billing/billing-engine.html.
- **Port notes:** Same worker as TW-WALLET-009; refund keyed on the charge row id (unique) and posted as a compensating ledger entry (never mutate the original). Emit an outbox event for analytics.

### TW-WALLET-012 — Settle-point wiring per channel and engine

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-009, TW-WALLET-011
- **Summary:** Seven call sites convert provider delivery events into `settleDelivered` / `settleFailed`. Which status counts as "delivered" differs per engine; the port must reproduce these triggers or spend will leak or double-charge.
- **Actors & access:** Provider webhooks and Node bridge callbacks (machine-to-machine; authentication is owned by the respective channel/node domains).
- **UX & screens:** none.
- **Endpoints:** the callers (routes owned by other domains, listed for orientation):
  | METHOD uri                               | route name                       | Controller@action                         | billing trigger                                                                                                                                                                                                                |
  | ---------------------------------------- | -------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | POST webhooks/whatsapp/inbound           | -                                | WaWebhookController@receive (applyStatus) | WABA: status delivered or read -> settleDelivered (category = pricing.category else conversation.origin.type, provider `waba`, source null); failed -> settleFailed. Workspace from the webhook, else resolved from the wamid. |
  | POST api/twilio/status                   | twilio.status                    | TwilioStatusController@handle             | after signature check, mapped status delivered or read -> settleDelivered (phone = `To`, category null, provider `twilio`), failed/undelivered -> settleFailed                                                                 |
  | POST api/update-message-status           | broadcasts.node.message-status   | BroadcastsController@nodeMessageStatus    | status sent, delivered or read -> settleDelivered (category = resolved template category, provider = broadcast provider default baileys, source `broadcast`); failed -> settleFailed                                           |
  | POST api/campaigns/update-contact-status | wa-campaigns.node.contact-status | WaCampaignsController@nodeContactStatus   | same set as broadcasts, source `campaign`                                                                                                                                                                                      |
  | POST api/update-scheduled-contact-status | scheduled.update-contact-status  | ScheduledController@updateContactStatus   | same set, source `scheduled`, messageId + phone from body                                                                                                                                                                      |
  | POST api/chat/message-status             | chat.node.message-status         | ChatController@nodeChatMessageStatus      | when at least one outbound message row was updated and matched by `meta.wa_message_id` -> settleDelivered (source `chat`, provider `baileys`, category null)                                                                   |
  | POST api/inbound-message                 | baileys.inbound                  | WaInboundController@baileys               | outbound mirror whose id starts with `flow_out_` -> settleDelivered (source `flow`, provider baileys); normal Baileys chat sends are excluded to avoid double charge                                                           |
- **Data:** `message_charges`, ledger as in TW-WALLET-009.
- **Rules & edge cases:**
  1. QUIRK: "charge on delivery" is literally true only for WABA (delivered/read). For Baileys/Twilio broadcasts, campaigns and scheduled sends the callbacks treat `sent` as billable too (Baileys reports unreliable delivery).
  2. Campaign inline path: the unofficial (Baileys) campaign loop also calls `settleDelivered` immediately after a successful dispatch (`sent`), keyed by the provider message id, because delivery callbacks are unreliable; the later callback is a harmless idempotent backstop.
  3. Category for template sends is the template's resolved `effectiveCategory()` (meta_category, else a whitelisted category); the raw `category` column is overloaded with industry verticals and must not be used. Chat/flow/Twilio sends have no category, so they price at the country default (or flat rate).
  4. Flow and auto-reply sends from the Node bridge bill only via the `flow_out_` mirror in the inbound controller; the Node flow "notify number" copy is a separate send with its own wamid and bills on its own webhook.
  5. Twilio broadcasts report through both the Twilio status webhook and the Node callback with the same SID: billed once due to idempotency.
  6. Every settle call is wrapped in try/catch that only logs a warning (`[BILLING] ... settle failed`); billing failure never blocks status processing or the response.
  7. Order of operations: settlement runs BEFORE the message row updates in the WABA handler and after the row updates in chat/broadcast handlers; there is no ordering dependency.
  8. Status downgrade protection (never regress read -> delivered) is applied to message rows by the same handlers, not to billing (billing is idempotent anyway).
- **Async & events:** synchronous inside webhook/callback requests.
- **External systems:** Meta Cloud API status webhooks, Twilio status callbacks (HMAC-SHA1 signature check is in the Twilio controller, owned by SMS/WABA domains), Node bridge callbacks (shared token, owned by NODE).
- **Settings:** none specific.
- **Acceptance criteria:**
  - Given a WABA marketing template delivered to +91, When the delivered webhook arrives, Then one charge at IN marketing is made; when the read webhook follows, no second charge.
  - Given a Baileys campaign message reported `sent`, When the callback arrives, Then it is charged (documented behavior); if the same id is reported delivered later, no second charge.
  - Given a Twilio message failed, When the callback arrives, Then any earlier charge is refunded.
  - Given a flow send mirrored as `flow_out_abc`, When mirrored into the inbox, Then it is charged once with source flow.
- **Source refs:** app/Http/Controllers/WaWebhookController.php (applyStatus), app/Http/Controllers/TwilioStatusController.php, app/Http/Controllers/BroadcastsController.php (nodeMessageStatus), app/Http/Controllers/WaCampaignsController.php (nodeContactStatus and inline loop), app/Http/Controllers/ScheduledController.php (updateContactStatus), app/Http/Controllers/ChatController.php (nodeChatMessageStatus), app/Http/Controllers/WaInboundController.php, node/services/flowService.js (comment on notify-number billing), Documentation/pages/bsp-billing/billing-engine.html.
- **Port notes:** In the port, provider adapters normalize status events to one internal event `message.status_changed` (provider, provider_message_id, status, recipient, category, tenant); the billing worker is the only subscriber that charges. Decide once, for all engines, which status is billable (recommend delivered only, plus an explicit engine capability flag for engines that cannot report delivery). Route ownership stays with the channel domains (WABA, SMS, NODE, CHAT, BCAST, CAMP, SCHED, FLR).

### TW-WALLET-013 — Launch-time wallet precheck for bulk sends and scheduled eligibility filter

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-008
- **Summary:** Because charging happens after delivery, an empty wallet could otherwise blast a whole campaign for free. Before a campaign, broadcast or scheduled batch starts, a cheap check blocks the launch when a wallet-billed workspace has no balance. The scheduled-message poller also drops schedules from over-quota workspaces with an empty wallet.
- **Actors & access:** Workspace users launching a broadcast/campaign/scheduled send (permissions owned by those domains). Runs regardless of security guardrail mode.
- **UX & screens:** The launch action is refused with an error message: broadcasts redirect back with the error flash; scheduled returns HTTP 422 JSON `errors.wallet[0]`; campaign store shows the error. Reason text: "Your message wallet is empty. Top up to start sending."
- **Endpoints:** none (called from `SendGate::screenBody` inside BroadcastsController store, WaCampaignsController store, ScheduledController store, and the Node scheduler poll in ScheduledController).
- **Data:** reads `users.wallet_credits` of the workspace owner, `message_charges`, plan limits.
- **Rules & edge cases:**
  1. `precheck(workspace, count)`: returns ok (balance 0, need 0) when the workspace has no owner or the owner is platform admin; returns ok when NOT pay-per-message and the month's usage plus `count` still fits the free quota (TW-WALLET-010); otherwise reads the owner balance.
  2. The estimate `need` = max(1, credits_per_message) x max(1, count) is returned but NEVER compared with the balance (QUIRK): the only block condition is balance <= 0. A wallet with 1 credit can launch a 50,000-recipient blast.
  3. Block reason string is fixed: "Your message wallet is empty. Top up to start sending."; also writes an audit entry `billing.send_blocked_no_wallet` (layer platform, result warning) with source, workspace id and count.
  4. `SendGate::screenBody` wraps the check: a RuntimeException (the block) propagates; any other exception (lookup failure) is logged and the send is ALLOWED (fail-open). The pre-check runs before the guardrail content checks and before warmer budget/rows are created.
  5. Per-message `SendGate::screen` (1:1 sends) does NOT run the wallet precheck; 1:1 sends are never blocked for an empty wallet in the default delivery-billing mode (they are recorded free at delivery).
  6. Scheduled poll filter (`GET api/scheduled/active`, `ScheduledController@activeForBot`, token-gated by the Node token, owned by SCHED/NODE; the list of active schedules the bot re-registers): a schedule is dropped when its workspace has a plan limit, the month's used count (both outbound tables) has reached the limit, and the owner has fewer than 1 wallet credit; schedules with no owner user, no workspace, or an unlimited plan pass. Dropped schedules are simply not returned that poll (they stay scheduled).
  7. Call-site counts differ (QUIRK): broadcast store passes the number of resolved contacts, scheduled store passes the total recipients, but campaign store passes NO count (defaults to 1) and runs before recipients are computed, so in classic mode a campaign is only checked for "one more message fits the free quota", and in wallet mode only for balance > 0.
  8. Emergency send halt (`platform.emergency_send_halt`) is a separate layer in the same class and is owned by the security domain.
- **Async & events:** audit log entry on block; no notification.
- **External systems:** none.
- **Settings:** `credits_per_message`, plan limit, `bsp_pay_per_message`, `platform.emergency_send_halt` (other domain).
- **Acceptance criteria:**
  - Given a reseller workspace with wallet 0, When a user launches a broadcast to 100 contacts, Then the launch is refused with the empty-wallet message and no rows are created.
  - Given a classic-plan workspace within its free quota, When launching, Then it proceeds even with wallet 0.
  - Given a wallet of 1 credit and 5000 recipients, When launching in wallet mode, Then it proceeds (documented gap; port may tighten it to a real estimate).
  - Given the workspace lookup throws, When launching, Then the send is allowed and a warning is logged.
- **Source refs:** app/Support/SendGate.php (screenBody), app/Services/MessageBillingService.php (precheck), app/Http/Controllers/BroadcastsController.php, app/Http/Controllers/WaCampaignsController.php, app/Http/Controllers/ScheduledController.php.
- **Port notes:** Implement `WalletGate.assertCanLaunch(tenant, recipientCount)` in the wallet module and call it from the campaign/broadcast/scheduled launch use cases. Improve on the reference by comparing the balance to a per-country estimate (use the rate resolver over the audience's country mix) with a configurable tolerance; keep fail-open only if the business wants it. Emit an audit event.

### TW-WALLET-014 — Legacy send-time overflow billing (OverflowBilling, off by default)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-004, TW-WALLET-008
- **Summary:** The original "plan quota first, wallet after" model that charged one wallet debit at send time and threw a plan-limit error when the wallet ran dry. In 1.7.0 it is kept only as a fallback: the setting `wallet_billing_on_delivery` (default "1", never seeded, no admin UI) turns it into a no-op, so every call site is inert in a default install.
- **Actors & access:** System. Call sites: `WhatsAppDispatcher` (Baileys/Twilio/WABA sends), `InboxDispatcher::guardMonthlyMessagesLimit` (team inbox, AI agent, flows), campaign sequential and batched loops, catalog send in TeamInbox, keyword auto-reply lookup, scheduled delta metering, chat.
- **UX & screens:** When active and blocked: JSON 422/402 or redirect-back error carrying the exception message; auto-reply lookup returns `reply: notallow`, reason `plan_limit`.
- **Endpoints:** none.
- **Data:** ledger spend row with `source=plan_overflow`, positive amount, `meta` {country, category, bsp_revenue_minor, bsp_cost_minor}; no `message_charges` row (P&L in this mode reads the ledger meta).
- **Rules & edge cases:**
  1. `consumeOne(workspace, usedThisMonth, toPhone, category)` returns immediately when `wallet_billing_on_delivery` = "1" (default) so the same message cannot be billed twice. Set to "0" to enable the rest.
  2. When active: skip for null workspace; skip when the current authenticated user is Super Admin/Admin/legacy admin; skip for workspaces owned by an admin (Node bridge calls have no session).
  3. Pay-per-message workspaces: no quota; plan expiry irrelevant; wallet is the only gate. Classic workspaces: expired plan throws `PlanLimitReachedException` (key `plan_expired`) with the message "Your plan has ended - renew your plan to keep sending. Wallet credits only cover over-limit sends while a plan is active."; limit null or <= 0 means unlimited (return); used < limit returns free.
  4. Missing owner throws (pay-per-message: "No wallet is attached to this workspace to bill messages. Contact support." / classic: "You've hit your plan's monthly message cap and there's no wallet to bill. Upgrade your plan.").
  5. Price from the resolver (per-country or flat); price <= 0 returns free (intentionally not floored). Balance below price throws `wallet_empty` ("Your message wallet is out of balance. Top up to keep sending.") or `monthly_messages_limit` ("...Top up your wallet or upgrade to keep sending.").
  6. The debit is all-or-nothing (unlike settleDelivered) and locks the owner row; the currency mirror is NOT decreased in this path (drifts from the delivery path).
  7. Category rules at call sites: campaigns bill as `marketing`, inbox replies as `service` (free by default), template sends by template category, flow/auto-reply/chat null.
  8. Scheduled sends meter by callback deltas via a `charged_sent` counter on `scheduled_messages`.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `wallet_billing_on_delivery` (default "1" = disabled legacy).
- **Acceptance criteria:**
  - Given default settings, When any send path calls the meter, Then nothing is debited at send time.
  - Given `wallet_billing_on_delivery` = 0, a classic workspace over quota with 0 credits, When a message is sent, Then it is rejected with the monthly-cap message.
- **Source refs:** app/Services/OverflowBilling.php, app/Exceptions/PlanLimitReachedException.php, app/Services/WhatsAppDispatcher.php, app/Services/InboxDispatcher.php, app/Http/Controllers/WaCampaignsController.php, app/Http/Controllers/ScheduledController.php, app/Http/Controllers/AutoReplyController.php, app/Http/Controllers/TeamInboxController.php, app/Http/Controllers/ChatController.php.
- **Port notes:** Do NOT port as a mode switch. Port only the two ideas it contains: a send-time hard gate for pay-per-message wallets with a real estimate (see TW-WALLET-013) and the plan-expired pause. Keep the exception-to-HTTP mapping (422/402 with stable error codes) in the send use cases. The exception class lives with PLAN limit guard (owner: plans domain).

### TW-WALLET-015 — Low-balance alert (WalletAlerts)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-009
- **Summary:** After a delivery charge (or an empty-wallet free record) leaves the owner at or under a threshold, a "Low WhatsApp balance" notification is created for the owner, at most once per 6 hours, honoring the workspace's notification preferences.
- **Actors & access:** Recipient is the wallet owner user. Preference key `wallet_low_balance` per workspace (`/settings?tab=notifications`, NOTIF domain).
- **UX & screens:** In-app bell entry: title "Low WhatsApp balance", body "Your message balance is down to MONEY. Top up to keep your campaigns and replies sending." (or, when the credit-to-money value is unavailable, "...running low (N credits)..."), category billing, severity warning, urgent, action URL `/account?tab=wallet`. Optional email and Slack copies per preference.
- **Endpoints:** none.
- **Data:** `notifications` row (NOTIF domain), Laravel cache key `wallet_low_notified:{owner id}`.
- **Rules & edge cases:**
  1. Trigger: `afterSpend(owner, newBalance)` after every charged settlement and after the empty-wallet free record (balance 0). NOT after refunds, top-ups or admin adjustments.
  2. Fires when threshold > 0 AND newBalance <= threshold; threshold = setting `wallet_low_balance_threshold` (default 20 CREDITS, no admin UI, in credits not money: under rate = 100 it is 0.20 of money, effectively "almost zero").
  3. Throttle: `Cache::has` check then put for 6 hours, so one alert per owner per 6 hours even if the balance stays low; the throttle is NOT cleared by a top-up, so a customer who tops up and drops again within 6 hours gets no second alert.
  4. Notification is created through `NotificationHelper::toUser` with `event=wallet_low_balance`; default channel toggles for this event are in-app on, email on, Slack on (Workspace default channel table), overridable per workspace; the `workspace_id` used for the preference lookup is the OWNER's current workspace (not the workspace whose message triggered it: QUIRK for owners of several workspaces).
  5. Money text uses `FormatSettings::display(credits x minorPerCredit / 100)`; falls back to the settings currency symbol + number.
  6. All failures are swallowed (logged `[BILLING] low-balance hook failed`); billing never fails because of the alert.
- **Async & events:** notification row; email and Slack deferred (after response, fail-open) inside NotificationHelper.
- **External systems:** SMTP, Slack incoming webhook (per-workspace, NOTIF domain).
- **Settings:** `wallet_low_balance_threshold` (default 20, hidden), workspace notification preferences for `wallet_low_balance`.
- **Acceptance criteria:**
  - Given threshold 20 and a charge leaving 15 credits, When settled, Then one alert is created for the owner and a second charge within 6 hours creates none.
  - Given the workspace muted `wallet_low_balance` in-app, When the alert would fire, Then no bell row is created (the throttle is still consumed).
  - Given balance 500, When charged to 480, Then no alert.
- **Source refs:** app/Support/WalletAlerts.php, app/Services/MessageBillingService.php (afterSpend), app/Helpers/NotificationHelper.php (toUser), app/Models/Workspace.php (NOTIFICATION_EVENTS, DEFAULT_NOTIFICATION_CHANNELS), Documentation/pages/account/notifications.html.
- **Port notes:** Emit `wallet.low_balance` via the outbox; NOTIF consumes and applies preferences. Make the threshold a per-tenant money setting (default derived from platform), re-arm the throttle on top-up, and evaluate on the correct tenant for multi-workspace owners.

### TW-WALLET-016 — Add-money top-up checkout (any amount) and wallet credit on paid order

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-001, TW-WALLET-002
- **Summary:** The primary way to fund the wallet: the user enters any amount on the wallet tab, lands on the shared gateway checkout page in "Add money to wallet" mode, pays through any active gateway, and on confirmed payment the pre-tax amount is credited.
- **Actors & access:** Any authenticated user with a current workspace (no role check, no permission key, no plan gate). The credit goes to the paying user's own wallet (see quirk).
- **UX & screens:** `resources/views/checkout/show.blade.php` (shared checkout view; also used for plans, owned by PLAN/PAYGW) rendered with overrides: item name "Add money to wallet", stub package "Wallet top-up", change link back to `/account?tab=wallet`, no coupon, no auto-renew. Fields: gateway pick, currency select (only currencies with an active gateway), billing name/email/company/address/city/postal/country/tax id, tax line, total. AJAX (`?ajax=1`) returns re-priced JSON when the currency changes.
  - States: amount < 1 (in base currency) redirects to the wallet tab with an error "Enter an amount of at least X to add to your wallet."; unauthenticated redirects to login; no active gateway for the currency shows an empty gateway list (checkout view concern).
- **Endpoints:**
  | METHOD uri           | route name                   | Controller@action                     | middleware   | request fields                                                                                                                                                                                                                                                                                                                            | response                                                                                                                                                                                                |
  | -------------------- | ---------------------------- | ------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET checkout/wallet  | user.checkout.wallet.show    | CheckoutController@walletTopupShow    | Authenticate | query `amount` (base currency, min 1), optional `currency`, `ajax`                                                                                                                                                                                                                                                                        | checkout view or pricing JSON                                                                                                                                                                           |
  | POST checkout/wallet | user.checkout.wallet.process | CheckoutController@walletTopupProcess | Authenticate | `amount` required numeric min 1 (carried on the action URL query), `gateway_id` required int exists, `currency` nullable string max 10, `customer_name` <=191, `customer_email` email <=191, `billing_company` <=191, `billing_address` <=255, `billing_city` <=120, `billing_postal` <=32, `billing_country` <=80, `billing_tax_id` <=64 | redirect to gateway URL, or HTML from the driver, or wallet tab with success flash "Payment received. Money added to your wallet." when the driver returns paid immediately; back with error on failure |
- **Data:** creates an `orders` row: order_number, workspace_id, user_id, package_id null, credit_package_id null, gateway id/slug, currency, amount = total, tax_rate, tax_amount, total_amount, `base_amount_usd`, status pending, customer/billing fields, `gateway_payload` = {`wallet_topup_minor`: pre-tax amount in platform-currency minor units}. On paid: `WalletService::topup(buyer, wallet_topup_minor, 'wallet.topup', 'topup.conversion', 'Wallet top-up', {order})`.
- **Rules & edge cases:**
  1. Amount is denominated in the workspace currency (`workspaces.currency`, else `default_currency`, else USD) and may be re-billed in another gateway-supported currency chosen by the shopper (converted with `FormatSettings::convert`); gateway must accept the currency (`acceptsCurrency`) and be active or an error is flashed.
  2. Tax is added on top: `checkout.tax_enabled` (default true) and `checkout.tax_rate`. QUIRK: the show page defaults the rate to 18 when the setting is missing, the process step defaults to 0; the credited amount is the PRE-TAX amount only (tax is not credited).
  3. Credit grant = pre-tax billed amount converted back to the platform currency (`default_currency`) x 100, rounded, as minor units; then `topup` converts to credits with the conversion rate (TW-WALLET-002); the comment assumes 1 minor = 1 credit.
  4. The order is finalized by `finalizeOrder` (private, in CheckoutController, shared with plans; called from the gateway callback route and from the driver's immediate `paid` result). It is idempotent: it returns early if the order is already paid, then in one DB transaction marks the order paid, and grants the wallet credit exactly once. The wallet credit branch requires no `credit_package_id` and `wallet_topup_minor` > 0.
  5. Top-up is always one-time (never a subscription), no coupon support, no minimum other than 1 and NO maximum.
  6. Failure to initiate marks the order failed with the driver message; an exception is caught and flashed as "Payment provider error. Try again or pick a different gateway."
  7. Buyer vs owner quirk: credit lands on `orders.user_id` (whoever paid); billing debits the workspace OWNER's wallet, so a manager who tops up credits their own wallet, not the workspace's.
  8. After paying, the return path redirects to `/account?tab=wallet` with a success flash (also used by the callback controller for gateway redirects).
  9. Cross-domain quirk: the shared `finalizeOrder` also runs the referral payout after commit, so a referee's first paid order of any kind, including a minimum 1.00 wallet top-up, pays the referrer's signup bonus (see TW-WALLET-030).
- **Async & events:** gateway webhooks/callbacks (PAYGW) call `finalizeOrder`; after payment also triggers referral payout logic (CPN) via the shared finalize path; invoice generation is a plan-order concern (PLAN).
- **External systems:** any payment gateway driver (Razorpay, Stripe, PayPal, ... 30+) via `PaymentGatewayManager`; credentials in admin gateway settings (PAYGW).
- **Settings:** `checkout.tax_enabled`, `checkout.tax_rate`, `checkout.tax_label`, `checkout.countries`, `pricing.refund_enabled`, `pricing.refund_days`, `default_currency`, `credits_per_currency_minor`.
- **Acceptance criteria:**
  - Given a logged-in user, When they open `/checkout/wallet?amount=500`, Then the shared checkout renders in add-money mode showing tax and total in the workspace currency.
  - Given amount 0, When opening, Then they are redirected to the wallet tab with the minimum-amount error.
  - Given a paid order for 500 pre-tax, When the gateway callback finalizes it twice, Then the wallet is credited once and a currency row plus a credit row exist.
  - Given a gateway that does not support the chosen currency, When submitting, Then an error "GATEWAY does not support CUR." is flashed and no order is created.
- **Source refs:** app/Http/Controllers/CheckoutController.php (walletTopupShow, walletTopupProcess, finalizeOrder), resources/views/checkout/show.blade.php, app/Services/WalletService.php (topup), app/Models/Order.php, routes/web.php, Documentation/pages/bsp-billing/customer-flow.html, Documentation/pages/commerce/checkout-gateways.html.
- **Port notes:** Home: `apps/api/src/modules/wallet/topups`. Model a `wallet_topups` intent (tenant-scoped, gateway ref, amount, currency, status) instead of overloading `orders.gateway_payload`; credit only from a verified gateway webhook (see `webhook-handler` skill) with idempotency on the gateway payment id; credit the TENANT wallet. Decide tax handling (credit pre-tax like Reference). Set a maximum. Reuse PAYGW's provider adapters.

### TW-WALLET-017 — Credit-package purchase path (retired in UI, POST still live)

- **Status:** partial
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-019
- **Summary:** The original "buy a fixed bundle of N credits for a fixed price" checkout. The GET page now redirects to the any-amount top-up, the wallet tab hides the bundle cards behind a literal false condition, but the POST endpoint and the order-finalization branch still work for any active package slug.
- **Actors & access:** Authenticated user with a current workspace.
- **UX & screens:** No reachable screen. Old bookmarks land on `/checkout/wallet?amount=<package price major>` (amount seeded from the package price rounded to a whole unit, or nothing when the slug is unknown). A dead block in `CheckoutController@creditShow` and a hidden "Top up credits" grid in `account/index.blade.php` describe the intended UI (cards with badge, price, credits, description, featured highlight).
- **Endpoints:**
  | METHOD uri                   | route name                    | Controller@action                | middleware   | request fields                                                              | response                                                                                       |
  | ---------------------------- | ----------------------------- | -------------------------------- | ------------ | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
  | GET checkout/credits/{slug}  | user.checkout.credits.show    | CheckoutController@creditShow    | Authenticate | slug `[A-Za-z0-9_-]+`                                                       | 302 to `/checkout/wallet?amount=N`                                                             |
  | POST checkout/credits/{slug} | user.checkout.credits.process | CheckoutController@creditProcess | Authenticate | same billing fields as TW-WALLET-016 but no `amount`; `gateway_id` required | gateway redirect/HTML, or wallet tab success "Payment received. Credits added to your wallet." |
- **Data:** order with `credit_package_id` set; on paid `WalletService::topupViaPackage(buyer, package, gateway_payment_id)`: adds `price_minor` to `wallet_currency_minor`, adds `credits` to `wallet_credits`, sets `wallet_currency_code` from the package if empty, writes a currency topup row and a credit earn row (source `package.purchase`, subject = the CreditPackage, descriptions "Top-up . NAME (N credits)" / "Top-up . NAME", meta with slug, currency, price, payment ref, currency tx id).
- **Rules & edge cases:**
  1. `creditProcess` 404s for inactive or unknown slugs; `topupViaPackage` throws for an inactive package.
  2. Price is converted from the package currency to the shopper's chosen currency; tax added as in TW-WALLET-016; the credit count is fixed by the package regardless of the conversion rate setting and regardless of tax.
  3. The order is created but no purchase confirmation exists apart from the shared `finalizeOrder` path (idempotent on order status).
  4. Package credits are raw credits and are not reconciled with the money model (QUIRK): a seeded package sells 5000 credits for 100.00, which is worth only 50.00 of money at rate = 100 (1 credit = 1 minor) and 50,000.00 at the shipped rate 0.1; the top-up path for the same 100.00 would grant 10000 credits or 10 credits respectively.
- **Async & events:** as TW-WALLET-016.
- **External systems:** payment gateways (PAYGW).
- **Settings:** as TW-WALLET-016.
- **Acceptance criteria:**
  - Given an active package "starter", When a logged-in user opens `/checkout/credits/starter`, Then they are redirected to the any-amount checkout with the package price prefilled.
  - Given a POST for an inactive package, Then 404.
  - Given a paid credit-package order, When finalized twice, Then credits are added once.
- **Source refs:** app/Http/Controllers/CheckoutController.php (creditShow, creditProcess, finalizeOrder), app/Services/WalletService.php (topupViaPackage), resources/views/user/account/index.blade.php (hidden bundle grid), database/migrations/2026_06_04_160000_add_credit_package_id_to_orders.php, Documentation/pages/admin-panel/coupons-credits.html.
- **Port notes:** Recommend NOT porting the bundle purchase path (Reference itself retired it); if bundles are wanted later, build them as top-up presets on the any-amount flow with bonus credits stored as money. Keep `topupViaPackage` semantics only if the product wants "bonus money" bundles.

### TW-WALLET-018 — Legacy self-confirm checkout pages (free credits hole)

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-019
- **Summary:** A prototype checkout page pair (`/checkout`, `/checkout/complete`, `/checkout/success`, `/checkout/failed`) whose "Pay" button credits a credit package to the wallet with NO payment. It is reachable in production and is a free-money hole. It must not be ported.
- **Actors & access:** Routes are defined outside the authenticated route group (no auth middleware). A guest POSTing crashes with a type error (500) because `Auth::user()` is null; any logged-in user can mint credits.
- **UX & screens:** `resources/views/checkout/index.blade.php`: a static "Complete your order" page with hard-coded sample name/email/company and card/UPI/netbanking/wallet tabs that do nothing (front-end only), a coupon box that calls a JS stub, an order summary (package name, credits, price, 18% GST computed in the view, total) and a Pay form posting the package slug. `resources/views/checkout/success.blade.php` (shows credits added and the buyer's most recent paid order amount) and `checkout/failed.blade.php` (most recent failed/pending/cancelled order).
- **Endpoints:**
  | METHOD uri             | route name        | Controller@action                | middleware | request fields                                                               | response                                                     |
  | ---------------------- | ----------------- | -------------------------------- | ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
  | GET checkout           | checkout.index    | CheckoutPagesController@index    | none (web) | query `package` slug (falls back to the first featured/active package)       | checkout prototype view                                      |
  | POST checkout/complete | checkout.complete | CheckoutPagesController@complete | none (web) | `package_slug` required string max 96, `payment_ref` nullable string max 191 | credits the package, redirect to checkout.success with flash |
  | GET checkout/success   | checkout.success  | CheckoutPagesController@success  | none       | none                                                                         | success view                                                 |
  | GET checkout/failed    | checkout.failed   | CheckoutPagesController@failed   | none       | none                                                                         | failed view                                                  |
- **Data:** calls `WalletService::topupViaPackage(user, package, payment_ref)` immediately, writing currency and credit ledger rows and raising both balances.
- **Rules & edge cases:**
  1. NO payment verification anywhere; `payment_ref` is stored as metadata only. The controller comment admits it is a self-confirm placeholder for a future PSP callback.
  2. `checkout.complete` credits for any active package slug repeatedly (no idempotency).
  3. `success` and `failed` read the current user's latest orders; guests see empty placeholders.
  4. The static page shows 18% GST regardless of admin tax settings and lists payment methods that do not exist.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:** (these describe the behavior the port must NOT reproduce)
  - Given a logged-in user, When POSTing `/checkout/complete` with any active package slug, Then in Reference credits are added with no payment (port: this endpoint must not exist).
  - Given the port, When the same request is made to any wallet-credit endpoint without a verified gateway payment, Then it is rejected.
  - Given the shared success/failed pages are needed, When implemented, Then they must be driven by verified order state only.
- **Source refs:** app/Http/Controllers/CheckoutPagesController.php, resources/views/checkout/index.blade.php, resources/views/checkout/success.blade.php, resources/views/checkout/failed.blade.php, routes/web.php (checkout prefix group).
- **Port notes:** Skip. Log the hole in the security notes for the reference verification. The generic "payment success/failed" landing pages, if wanted, belong to PAYGW/PLAN.

### TW-WALLET-019 — Admin credit packages CRUD

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-001
- **Summary:** Platform admin manages fixed "this money buys this many credits" bundles: list, create, edit, enable/disable, delete. The catalog is functional but effectively unused by customers because the wallet tab no longer lists it (see TW-WALLET-017).
- **Actors & access:** Platform admin (Authenticate, EnsureUserIsAdmin, IPAllowlist). Sidebar entry under Billing & plans with a count badge = number of packages.
- **UX & screens:**
  - `resources/views/admin/credit-packages/index.blade.php`: header "Credit packages", New package button, table columns Name (with description), Slug, Price (currency-formatted via `price_display`, converted to the platform currency at the live rate), Credits, "Per 1 CURRENCY" (credits per major unit, one decimal), Badge or dash, Status pill (Active/Disabled), Actions (Edit, Enable/Disable toggle form, Delete form with confirm "Delete this package? Existing purchases keep their ledger rows."). Empty state: "No credit packages yet" with hint about `/checkout?package=<slug>` URL. Ordered by `sort_order` then id, no pagination.
  - `create.blade.php` / `edit.blade.php` share `_form.blade.php`: three numbered sections. 01 Identity: Name (required, max 96), Slug (optional, max 96, auto-generated), Description (textarea max 500). 02 Pricing: Price in whole currency units (required, number min 0 step 0.01 max 10,000,000), Currency (select of active currencies, "SYMBOL CODE"), Credits (required integer 1..100,000,000). 03 Display: Badge (max 32), Sort order (0..9999), Active (default on) and Featured (default off) toggles (hidden 0 + checkbox 1 pattern). Edit page copy: repricing only affects future purchases.
  - Error block lists validation messages; flash `status` messages.
- **Endpoints:**
  | METHOD uri                             | route name                    | Controller@action                         | middleware                                   | request fields | response                                                    |
  | -------------------------------------- | ----------------------------- | ----------------------------------------- | -------------------------------------------- | -------------- | ----------------------------------------------------------- |
  | GET admin/credit-packages              | admin.credit-packages.index   | Admin\AdminCreditPackagesController@index | Authenticate, EnsureUserIsAdmin, IPAllowlist | none           | list view                                                   |
  | GET admin/credit-packages/create       | admin.credit-packages.create  | @create                                   | same                                         | none           | form with currency options                                  |
  | POST admin/credit-packages             | admin.credit-packages.store   | @store                                    | same                                         | see rules      | redirect to index, flash "Credit package created."          |
  | GET admin/credit-packages/{id}/edit    | admin.credit-packages.edit    | @edit                                     | same                                         | id numeric     | form (404 if missing)                                       |
  | PUT admin/credit-packages/{id}         | admin.credit-packages.update  | @update                                   | same                                         | as store       | redirect to index, flash "Credit package updated."          |
  | POST admin/credit-packages/{id}/toggle | admin.credit-packages.toggle  | @toggle                                   | same                                         | none           | redirect with "Package activated." / "Package deactivated." |
  | DELETE admin/credit-packages/{id}      | admin.credit-packages.destroy | @destroy                                  | same                                         | none           | redirect with "Credit package deleted."                     |
- **Data:** `credit_packages`: `name` varchar(96), `slug` varchar(96) UNIQUE, `price_minor` bigint unsigned, `currency_code` char(3) default INR, `credits` bigint unsigned, `badge` varchar(32) nullable, `description` text nullable, `is_active` bool default 1, `is_featured` bool default 0, `sort_order` int unsigned default 0, timestamps; index (`is_active`,`sort_order`).
- **Rules & edge cases:**
  1. Validation: name required string max 96; slug nullable string max 96 `alpha_dash` unique among packages (ignoring the row being edited); `price_major` required numeric 0..10,000,000, stored `price_minor` = round(x100); `currency_code` required size 3 and one of the ACTIVE currencies from the catalog (fallback list INR, USD, EUR, GBP, AED when no currencies are seeded); `credits` required integer 1..100,000,000; `badge` max 32; `description` max 500; `is_active`/`is_featured` booleans; `sort_order` nullable integer 0..9999.
  2. Slug auto-generation on save when empty: slugified name, or "package"; collisions get "-2", "-3", ... (checked against other rows).
  3. Price 0 is allowed (a free bundle).
  4. Delete is a hard delete; already-purchased ledger rows keep their `subject_id` (dangling pointer) and orders keep `credit_package_id`. There is no "in use" protection.
  5. Nothing is audited; no permission key beyond the admin role/IP allowlist.
  6. Seeded install data: Starter (100.00 INR = 5000 credits, sort 10), Growth (500.00 = 27,500, badge "Most popular", featured, sort 20), Scale (1000.00 = 60,000, badge "Best value", sort 30).
  7. Model helpers: `price_display` (converted/formatted), `rate` (credits per minor), `credits_per_major` (rate x 100).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** active currencies list (CPN).
- **Acceptance criteria:**
  - Given an admin, When creating a package with name "Pro Pack", price 250, credits 20000, Then slug `pro-pack` is created, `price_minor`=25000 and it appears in the list.
  - Given a duplicate slug, When saving, Then validation rejects it.
  - Given an inactive package, When the admin toggles it, Then `is_active` flips and the flash reads activated.
  - Given a currency not in the active catalog, When saving, Then validation fails.
- **Source refs:** app/Http/Controllers/Admin/AdminCreditPackagesController.php, app/Models/CreditPackage.php, resources/views/admin/credit-packages/index.blade.php, resources/views/admin/credit-packages/create.blade.php, resources/views/admin/credit-packages/edit.blade.php, resources/views/admin/credit-packages/_form.blade.php, database/migrations/2026_05_07_140000_create_credit_packages_table.php, Documentation/pages/admin-panel/coupons-credits.html.
- **Port notes:** Low priority; if built, home `apps/api/src/modules/wallet/top-up-presets` + admin UI under billing. Prefer "top-up preset amounts with optional bonus" over bundles. RLS not needed (platform table).

### TW-WALLET-020 — User wallet tab on the account page

- **Status:** implemented
- **Priority:** P0 (product unusable without)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-016
- **Summary:** The customer's wallet home (`/account?tab=wallet`): current balance as money, 30-day spend and earnings, an "Add money" box with quick-add amounts, an explanation of how billing works for their mode, and a paginated activity list.
- **Actors & access:** Any authenticated user (own wallet only). The page is `AccountController@index` (route `user.account`, owned by the auth/account domain); only the wallet pane is described here. No permission or plan gate.
- **UX & screens:** `resources/views/user/account/index.blade.php`, pane `data-pane="wallet"` selected by `?tab=wallet` (redirect target of every top-up).
  - Three KPI cards: Wallet balance (money = credits x per-credit value, or the raw credit count when the value is unknown; subtitle "Available to spend", plus an approximate message count "about N messages" = floor(credits / credits_per_message) only when per-country pricing is OFF), Spent (30d) (sum of `spend` rows in the last 30 days, absolute, money), Earned via affiliate (30d) with a plus sign (sum of `earn` and `refund` rows in the last 30 days).
  - "Add money to your wallet" card: GET form to `/checkout/wallet` with Amount (number min 1 step 1, required, currency symbol prefix, placeholder 1000) and "Add money"; "Quick add" links 500, 1000, 2000, 5000 (formatted with symbol) linking to `/checkout/wallet?amount=N`; a link to the Affiliate tab.
  - "How billing works" card, three variants: pay-per-message mode ("Every message you send is charged from your wallet balance at the recipient's price - there is no monthly plan allowance ... sending pauses until you add money"); plan with a monthly limit > 0 (states the allowance, plan end date, that extra messages are charged from the wallet at each message's price, and shows a red "Your plan has ended - sending is paused until you renew" when the plan is not active); plan without a numeric limit (generic text).
  - Credit-package grid: present in markup but permanently hidden by a literal false condition (TW-WALLET-017).
  - "Wallet activity" table: 10 rows per page (`wallet_page` query param, tab param preserved), `kind=credit` rows only, newest first by `created_at`; columns Description (or the humanized source), Type (raw type string as a pill), Date (month day, time), Amount (sign + money), Balance (money of `balance_after`). Header shows "Showing a-b of N" and a "Full statement" link (TW-WALLET-021). Empty state: "No wallet activity yet. Add money above or earn via the affiliate program to get started." Prev/Next pagination.
- **Endpoints:** rendered by GET account (`AccountController@index`), not claimed here.
- **Data:** reads `users.wallet_credits`, `wallet_currency_minor`/code (computed but not displayed), `wallet_transactions` (credit kind only), `credit_packages` (active, ordered; unused), workspace limit/plan end.
- **Rules & edge cases:**
  1. QUIRK: "Earned via affiliate (30d)" sums all `earn` and `refund` rows, and top-up credits are stored as `earn` rows, so buying credits inflates "earned via affiliate", and delivery refunds count too.
  2. QUIRK: the Amount cell shows a plus sign for any row whose stored amount is positive; message charges are stored positive, so they display as "+" (colored as spend) rather than "-".
  3. Only `kind=credit` rows appear; currency topup rows never show.
  4. Money conversion uses `minorPerCredit` (TW-WALLET-002).
  5. The pane always shows "Available to spend"; balances cannot be negative.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `credits_per_message`, per-country switch, `bsp_pay_per_message`, `credits_per_currency_minor`.
- **Acceptance criteria:**
  - Given a workspace in pay-per-message mode, When the wallet tab opens, Then the "how billing works" card says there is no monthly allowance.
  - Given 25 ledger rows, When the tab opens, Then 10 show with pagination and "Showing 1-10 of 25".
  - Given a user with no rows, Then the empty state copy is shown.
  - Given a quick-add click on 1000, Then the browser goes to `/checkout/wallet?amount=1000`.
- **Source refs:** app/Http/Controllers/AccountController.php (index), resources/views/user/account/index.blade.php, resources/views/user/partials/empty-state.blade.php, Documentation/pages/account/account-billing.html, Documentation/pages/bsp-billing/customer-flow.html.
- **Port notes:** Home `apps/web/.../account/wallet` with API `GET /wallet/summary` and `GET /wallet/ledger`. Correct the affiliate-earned KPI (filter by source), classify by direction, and scope to the tenant wallet.

### TW-WALLET-021 — Wallet statement page with filters and per-message charge detail

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-001, TW-WALLET-009
- **Summary:** A full audit ledger page ("Wallet statement") with summary cards, filters, and for each message charge the channel, recipient country, category, engine and, for campaign/broadcast sends, the campaign or broadcast name, recipient and template.
- **Actors & access:** Any authenticated user, own rows only (Authenticate). No plan gate.
- **UX & screens:** `resources/views/user/account/wallet-statement.blade.php` (layout `x-layouts.user`, nav key more, page `user-wallet-statement`).
  - Header: breadcrumb Wallet / Statement, Back to wallet, Export CSV (carries the current filters).
  - Summary cards: Current balance (money value of credits), Money in (sum of positive amounts over the whole filtered set), Money out (sum of absolute negative amounts), Net movement with count of transactions in view.
  - Filters (GET): Type (All movements, Top-ups, Message charges, Refunds, Earnings, Adjustments), From and To dates, Search (description or source substring), Apply/Reset.
  - Table (25 per page): Date (month day, year - time), Description with optional context block (campaign/broadcast name, "To" recipient, "Template"), and chips for channel (Campaign, Broadcast, Flow / Chatbot, Scheduled, Auto-reply, Team Inbox / Chat, API), destination country, category, engine (WhatsApp Cloud, WhatsApp, Twilio); Type badge (Top-up, Earning, Refund, Message charge, Adjustment); Money in; Money out; Balance (`balance_after` money). Prev/Next with "Page x of y - N total". Empty state: "No transactions match these filters. Try widening the date range or clearing the search."
- **Endpoints:**
  | METHOD uri                   | route name                    | Controller@action                 | middleware   | request fields                                                                                                                      | response       |
  | ---------------------------- | ----------------------------- | --------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------- | -------------- |
  | GET account/wallet/statement | user.account.wallet.statement | AccountController@walletStatement | Authenticate | query `type` (all, topup, earn, spend, refund, admin_adjust), `from`, `to` (any Carbon-parsable date, invalid ignored), `q`, `page` | statement view |
- **Data:** `wallet_transactions` where `user_id` = me and `kind = credit`; joined in memory to `message_charges` by `wallet_tx_id`; context resolved from `wp_campaign_contacts` and `broadcast_contacts` by `whatsapp_message_id` = charge wamid, then `wa_templates` names; failures in resolution are swallowed.
- **Rules & edge cases:**
  1. Only the credit kind is shown (the currency kind would double count paired rows). Consequently the "Top-ups" filter (`type=topup`) matches nothing: real top-ups are stored as credit `earn` rows (currency rows carry type topup), so top-ups appear under Earnings (QUIRK).
  2. Date filters are inclusive day boundaries (start of from day, end of to day), invalid strings ignored. Search escapes `%` and `_`. Ordering `created_at desc, id desc`.
  3. Summary is computed over the WHOLE filtered set: in = sum(amount > 0), out = abs(sum(amount < 0)), net = in - out, count.
  4. QUIRK (bug): message-charge rows are stored with POSITIVE amounts, so the page renders real charges under "Money in" and counts them as inflow; refunds too. The page only classifies correctly for rows written negative (the unused `chargeForSend`, and `admin_adjust` down). The port must classify by `type`/direction.
  5. Money display divides raw amounts by 100 and formats in the workspace currency, assuming 1 credit = 1 minor (TW-WALLET-002); the current-balance card uses credits x per-credit value (inconsistent basis).
  6. Per-message context exists only for campaign and broadcast sends (their tables persist the wamid); 1:1 chat and flow charges show just the channel chip.
  7. Encrypted PII (phone numbers, names) is decrypted via model casts with try/catch so one bad row never breaks the page.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** platform currency.
- **Acceptance criteria:**
  - Given 60 rows, When opened, Then 25 per page and totals reflect all filtered rows.
  - Given a search "campaign" and a date range, When applied, Then only matching rows and summary within the range display.
  - Given a charge for a campaign message, When listed, Then it shows the campaign name, recipient and template.
  - Given a spend row stored 12, When rendered in the port, Then it must appear as money OUT (fix), not in (Reference bug).
- **Source refs:** app/Http/Controllers/AccountController.php (walletStatement, walletStatementQuery, resolveMessageContext, tryRead), resources/views/user/account/wallet-statement.blade.php, resources/views/user/partials/empty-state.blade.php.
- **Port notes:** Home `apps/web/.../account/wallet/statement`, API `GET /wallet/statements?type&from&to&q&cursor` (cursor pagination per repo contracts). Port 2026-10-21: the screen and the CSV share one column set in CSV order; Channel, Recipient, Template, Country, Category and Engine appear only when some row of the filtered set has a value (parity file item 16). Migrated Waboo history fills Category from Waboo's own category (item 17). Join charge details through `message_charges` -> campaign/broadcast message ids; expose direction explicitly.

### TW-WALLET-022 — Wallet statement CSV export

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-021
- **Summary:** Streams the same filtered statement as a CSV download with major-unit money columns.
- **Actors & access:** Authenticated user, own rows.
- **UX & screens:** "Export CSV" link on the statement page (`?type&from&to&q` carried).
- **Endpoints:**
  | METHOD uri                       | route name                        | Controller@action                    | middleware   | request fields                | response                                                             |
  | -------------------------------- | --------------------------------- | ------------------------------------ | ------------ | ----------------------------- | -------------------------------------------------------------------- |
  | GET account/wallet/statement.csv | user.account.wallet.statement.csv | AccountController@walletStatementCsv | Authenticate | same filters as TW-WALLET-021 | streamed `text/csv` download named `wallet-statement-YYYY-MM-DD.csv` |
- **Data:** as TW-WALLET-021, chunked 500 rows ordered oldest first (`created_at asc, id asc`).
- **Rules & edge cases:**
  1. Header columns: Date, Type, Description, Channel, Recipient, Template, Country, Category, Engine, Money in (CUR), Money out (CUR), Balance after (CUR), where CUR is the platform default currency code (fallback USD).
  2. Date format `Y-m-d H:i` (app timezone). Money in = amount/100 when amount > 0; Money out = abs(amount)/100 when amount < 0; balance after = balance_after/100, two decimals with a dot.
  3. Free-text fields (description, channel+campaign name, recipient, template) are formula-injection-neutralized: a leading `=`, `+`, `-` or `@` gets a leading apostrophe.
  4. Same sign bug as the page: real message charges land in the Money in column.
  5. No row cap and no rate limit on the export.
- **Async & events:** none (streamed synchronously).
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given filters type=refund, When exporting, Then only refund rows appear oldest first.
  - Given a description starting with "=", When exported, Then it is prefixed with an apostrophe.
  - Given 10,000 rows, When exporting, Then the response streams without loading all rows in memory.
- **Source refs:** app/Http/Controllers/AccountController.php (walletStatementCsv, csvSafe).
- **Port notes:** Prefer an async export job for very large ledgers (download link), keep formula-injection protection, add a row cap. Port 2026-10-21: the screen and the CSV share one column set in CSV order; Channel, Recipient, Template, Country, Category and Engine appear only when some row of the filtered set has a value (parity file item 16). Migrated Waboo history fills Category from Waboo's own category (item 17).

### TW-WALLET-023 — Wallet balance display surfaces (rail, top strip, dashboard, more, plan usage, JS user chip)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-002
- **Summary:** The balance, always shown as money, appears in several always-visible places with a "Top up" call to action that leads to the wallet tab.
- **Actors & access:** Authenticated users; reads their own `users.wallet_credits` (not the workspace owner's balance: QUIRK, a member sees their own personal wallet).
- **UX & screens:**
  - Sidebar rail (`components/user/sidebar-rail.blade.php`): Wallet card with money balance, plan name badge, "Top up" link to `/account?tab=wallet`.
  - Top strip menu (`components/user/topstrip.blade.php`): "Wallet" link to the wallet tab (and a Wallet quick link in the profile dropdown).
  - `window.THREADWISE_USER` in `components/layouts/user.blade.php`: `credits` (raw), `creditsPerMessage`, `walletMoney` (pre-formatted), used by `resources/js/threadwise.js` to render the balance in the profile dropdown (money if present else the raw number).
  - Dashboard KPI 4 (`user/dashboard/index.blade.php`, `UserPagesController@dashboard`): "Wallet balance" card with money, a "pay per message" chip when the workspace is pay-per-message, "Earn via affiliate" link and "Top up" link; the card is shown ONLY when `wallet_credits` > 0, else a fallback "automate" card fills the slot; the progress bar is a fixed 100% or 0%.
  - More page (`user/more/index.blade.php`): wallet money next to the account entry; a card linking to the wallet tab.
  - Plan usage component (`components/plan-usage.blade.php`, used on the account plans/usage area): "Wallet balance" tile linking to the wallet tab, "Top up wallet" button in the hero, and the hint "extra sends bill from wallet credits" when the monthly quota is exhausted (shown even in pay-per-message mode where the quota is irrelevant).
  - Legacy checkout prototype wallet panel (TW-WALLET-018).
  - `PlanUsage::summary` returns credits, `billing_mode` (`wallet` when pay-per-message else `plan`), `is_bsp`, `wallet_amount_minor`, `wallet_balance` (major), currency code/symbol, `amount_per_message` (flat credits x per-credit money, major) for this UI and for API consumers; it reads the workspace OWNER's wallet (differs from the other surfaces).
- **Endpoints:** rendered by dashboard, more and account routes owned by other domains; not claimed.
- **Data:** `users.wallet_*`, `system_settings`.
- **Rules & edge cases:**
  1. All surfaces multiply credits by `minorPerCredit` and format through the currency helper; if rate <= 0 they show the raw count.
  2. Inconsistent basis across surfaces (QUIRK): sidebar/dashboard/JS chip use the logged-in user's wallet; the plan-usage card and mobile/extension snapshots use the workspace owner's wallet (dashboard usage cards) or the user's (mobile), so a non-owner member sees different numbers in different places.
  3. Balances are read at page render (no polling, no websocket push); the JS chip is stale until reload.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `credits_per_currency_minor`, `default_currency`.
- **Acceptance criteria:**
  - Given a wallet of 5000 credits at rate 100 in a USD workspace, When any surface renders, Then it shows 50.00 in USD format.
  - Given wallet 0, When the dashboard loads, Then the wallet KPI card is replaced by the fallback card.
  - Given a pay-per-message workspace, When the dashboard loads, Then the "pay per message" chip appears.
- **Source refs:** resources/views/components/user/sidebar-rail.blade.php, resources/views/components/user/topstrip.blade.php, resources/views/components/layouts/user.blade.php, resources/js/threadwise.js, resources/views/user/dashboard/index.blade.php, resources/views/user/more/index.blade.php, resources/views/components/plan-usage.blade.php, app/Services/PlanUsage.php, app/Http/Controllers/UserPagesController.php.
- **Port notes:** One `useWalletBalance()` hook backed by `GET /wallet/summary` and a websocket `wallet.updated` event on every debit/credit so the chip updates live. Always tenant wallet, never per-user.

### TW-WALLET-024 — Message pricing panel and per-template cost chip

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-004, TW-WALLET-008
- **Summary:** In wallet billing mode the templates page shows a small "Message pricing" panel with the base rate of the four categories, and each template card shows its own per-message cost, so customers see costs before sending.
- **Actors & access:** Any user viewing templates in a pay-per-message workspace (hidden otherwise).
- **UX & screens:**
  - `components/message-pricing.blade.php` (`x-message-pricing`, prop `compact`): title "Message pricing", badge "charged only on delivery", four tiles Marketing, Utility, Authentication, Service each with money (or "Free" and "no charge" when credits <= 0) and "N credit(s) / msg"; footer text (non-compact) "Per delivered WhatsApp message. The exact charge can vary by the recipient's country; these are your workspace's base rates." Rendered at the top of the templates index only when `payPerMessageFor(current workspace)`.
  - `user/templates/_cards.blade.php`: chip "Free" or "money/msg" with tooltip "Cost per delivered message - base rate, varies by recipient country", only for engines waba, baileys, twilio and only in pay-per-message mode; category from `WaTemplate::effectiveCategory()`.
- **Endpoints:** none (partials of the templates page, TPL domain).
- **Data:** resolver display methods (`displayTable`, `displayForCategory`) over `message_rates`.
- **Rules & edge cases:**
  1. Shows the ANY-country base rate (the country-independent default), not a per-country price; with per-country pricing OFF it shows the flat rate for all categories, including a non-free "service".
  2. Money = round(credits x minorPerCredit) formatted in the workspace currency.
  3. In plan mode nothing is shown (messages are covered by the plan quota).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** as TW-WALLET-004/008.
- **Acceptance criteria:**
  - Given pay-per-message mode and a service rate of 0, When the templates page loads, Then the Service tile says Free / no charge.
  - Given plan mode, When it loads, Then no pricing panel or chip appears.
- **Source refs:** resources/views/components/message-pricing.blade.php, resources/views/user/templates/index.blade.php, resources/views/user/templates/_cards.blade.php, app/Services/MessageCreditRate.php.
- **Port notes:** Serve `GET /pricing/messages` (categories + optional country param) and compute in the frontend; extend to show the exact per-country price for a selected audience.

### TW-WALLET-025 — Mobile wallet snapshot API (GET api/app/wallet)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-002, TW-WALLET-008
- **Summary:** Returns the authenticated mobile user's balances and pricing hints for the app's wallet screen.
- **Actors & access:** Sanctum-authenticated user with a resolved app workspace (middleware `api`, `Authenticate:sanctum`, `ResolveAppWorkspace`). Route ownership is MOB by the boundary rules; the controller is wallet-specific so it is described here and listed in this file's coverage.
- **UX & screens:** app wallet screen (out of repo scope); JSON contract below.
- **Endpoints:**
  | METHOD uri         | route name                 | Controller@action              | middleware                                     | request fields | response                                |
  | ------------------ | -------------------------- | ------------------------------ | ---------------------------------------------- | -------------- | --------------------------------------- |
  | GET api/app/wallet | (unnamed in the app group) | Api\App\WalletController@index | api, Authenticate:sanctum, ResolveAppWorkspace | none           | `{success, data:{billing_mode ('wallet' | 'plan'), is_bsp, credit_balance, currency_balance (raw mirror, minor), currency_balance_major (credits x per-credit value / 100, 2 dp), currency_code, currency_symbol, wallet_balance_formatted, credits_per_message, amount_per_message (major), amount_per_message_minor, amount_per_message_formatted, messages_remaining}}` |
- **Data:** reads the authenticated user's `wallet_credits`, `wallet_currency_minor`, `wallet_currency_code`; settings `credits_per_message`; workspace billing mode.
- **Rules & edge cases:**
  1. `credits_per_message` = max(1, flat setting); `amount_per_message` = round(flat x per-credit minor) / 100; `messages_remaining` = floor(credits / flat) (ignores per-country rates and category).
  2. `currency_balance_major` deliberately derives from credits (not the mirror); `currency_balance` exposes the raw drifting mirror.
  3. `billing_mode` is `wallet` when pay-per-message else `plan`. Currency code/symbol from the workspace currency, falling back to the user's `wallet_currency_code` or USD.
  4. The balance is the AUTHENTICATED USER's wallet, not the workspace owner's (QUIRK for members).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** as above.
- **Acceptance criteria:**
  - Given a user with 1000 credits and flat rate 2, When GET api/app/wallet, Then `messages_remaining` is 500.
  - Given no token, Then 401.
  - Given pay-per-message mode, Then `billing_mode` is wallet.
- **Source refs:** app/Http/Controllers/Api/App/WalletController.php (index), routes/app.php.
- **Port notes:** Home `apps/api/src/modules/wallet` controller `GET /wallet` (contracts in `@crm/contracts`); return tenant wallet and explicit money fields; estimate remaining messages via the rate card for the tenant's dominant country.

### TW-WALLET-026 — Mobile wallet ledger API (GET api/app/wallet/transactions)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-001
- **Summary:** Paginated ledger for the mobile wallet history.
- **Actors & access:** As TW-WALLET-025.
- **UX & screens:** app screen.
- **Endpoints:**
  | METHOD uri                      | route name | Controller@action                     | middleware                                     | request fields         | response                                                                              |
  | ------------------------------- | ---------- | ------------------------------------- | ---------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
  | GET api/app/wallet/transactions | (unnamed)  | Api\App\WalletController@transactions | api, Authenticate:sanctum, ResolveAppWorkspace | query `kind` (`credit` | `currency`, omitted = both), `limit` (default 50, clamped 1..200), `page` (default 1) | `{success, data:[{id, kind, type, amount, balance_after, source, description, subject_type, subject_id, meta, created_at (ISO 8601)}], pagination:{page, limit, total, pages}}` |
- **Data:** `wallet_transactions` for the user, ordered by id desc, offset pagination with a full count query.
- **Rules & edge cases:**
  1. Unknown `kind` values are ignored (returns both kinds).
  2. `type` may be any of earn, spend, refund, admin_adjust, topup (the code comment says "adjust": stale).
  3. `amount` is the stored value (see sign quirk in TW-WALLET-001); `meta` returned raw (may include gateway ids, wamids).
  4. Own rows only; a member sees their personal wallet rows.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given 120 rows, When requesting limit 500 page 1, Then limit is clamped to 200.
  - Given kind=currency, Then only currency rows return.
  - Given page 3 with limit 50 and 120 rows, Then 20 rows and pages = 3.
- **Source refs:** app/Http/Controllers/Api/App/WalletController.php (transactions), app/Models/WalletTransaction.php.
- **Port notes:** Use cursor pagination and a stable direction field per the repo's contracts convention; never expose `meta` gateway internals.

### TW-WALLET-027 — Mobile top-up order creation (POST api/app/wallet/topup)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** M (<=1 week)
- **Depends on:** TW-WALLET-016
- **Summary:** Creates a pending wallet top-up order for a given amount in minor units and starts the payment server-side with the chosen gateway, returning what the device's payment SDK needs.
- **Actors & access:** As TW-WALLET-025; needs a current workspace.
- **UX & screens:** app payment sheet.
- **Endpoints:**
  | METHOD uri                | route name | Controller@action              | middleware                                     | request fields                                                                                                                                                                                                             | response                                                                                                                                                                                                                                                                                        |
  | ------------------------- | ---------- | ------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST api/app/wallet/topup | (unnamed)  | Api\App\WalletController@topup | api, Authenticate:sanctum, ResolveAppWorkspace | `amount` required integer min 1 (minor units), `currency` nullable string max 10, `gateway` nullable string max 64 (slug), `gateway_id` nullable integer exists in payment_gateways, `description` nullable string max 255 | 201 `{success, message, data:{order_id (order number), payment_id (row id), amount (major), amount_minor, currency, gateway, description, user, gateway_order_id?, redirect_url?, html?, gateway_payload?}}`; 422 `{success:false, message, errors}` on validation; 422 "No workspace context." |
- **Data:** creates `orders` (status pending, package null, `gateway_id`/slug, currency, `amount`=`total_amount`=amount/100, discount/tax 0, customer fields from the user, billing company = workspace name, `meta` {kind:`wallet_topup`, minor}); updates `gateway_order_id` and `gateway_payload` from the driver result.
- **Rules & edge cases:**
  1. Currency defaults to the request, else the user's `wallet_currency_code`, else INR; uppercased.
  2. Gateway resolved by id or slug; inactive gateway gives 422 "That gateway is not available."; unsupported currency gives 422 "NAME does not support CUR.".
  3. With a gateway the payment is initiated server-side via the same `initiate()` as web checkout (amount/currency bound to the server-created order). Driver exception: order marked failed, 502 "Payment provider error. Try again or pick a different gateway."; driver `failed` status: order failed, 422 "Payment could not be started: reason".
  4. Without a gateway an order is still created, but it can never be confirmed (confirm refuses orders lacking a gateway, TW-WALLET-028).
  5. No tax, no coupon, no upper bound on `amount`; no conversion to the platform currency (QUIRK: confirm credits `meta.minor` as platform-currency minor units even when the order currency differs, so a USD top-up of 1000 cents credits as 1000 minor of the platform currency).
- **Async & events:** logs `[App\Wallet] topup order created`; gateway callback (PAYGW) may also finalize the order via the web callback.
- **External systems:** payment gateways through `PaymentGatewayManager`.
- **Settings:** none specific.
- **Acceptance criteria:**
  - Given a valid amount and active gateway, When posting, Then an order with meta kind wallet_topup exists and the response includes the gateway order id.
  - Given an inactive gateway, Then 422 "That gateway is not available."
  - Given amount 0, Then 422 validation error.
- **Source refs:** app/Http/Controllers/Api/App/WalletController.php (topup), app/Models/Order.php, app/Services/Payment/PaymentGatewayManager.php (PAYGW).
- **Port notes:** Same top-up intent model as TW-WALLET-016; convert to the platform currency at creation and store both amounts; enforce min/max; idempotency key header.

### TW-WALLET-028 — Mobile top-up confirmation with server-side payment verification

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** L (<=2 weeks)
- **Depends on:** TW-WALLET-027
- **Summary:** After the device SDK reports success the app calls confirm; the server re-verifies the payment with the gateway (fail closed), binds it to the order, and only then credits the wallet, idempotently.
- **Actors & access:** As TW-WALLET-025; the order must belong to the caller.
- **UX & screens:** app.
- **Endpoints:**
  | METHOD uri                        | route name | Controller@action                     | middleware                                     | request fields                                                                                                                                                                       | response                                                                                                                                                                                                                                |
  | --------------------------------- | ---------- | ------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | POST api/app/wallet/topup/confirm | (unnamed)  | Api\App\WalletController@topupConfirm | api, Authenticate:sanctum, ResolveAppWorkspace | `order_id` required string max 64 (order number), `transaction_id` nullable string max 191, plus any gateway SDK fields (session_id, razorpay_*, refno, ...) forwarded to the driver | 200 `{success, message:"Wallet credited.", data:{order_id, status:paid, credit_added, currency_added, credit_balance, currency_balance}}` or already-confirmed 200 `{message:"Order already confirmed.", data:{order_id, status:paid}}` |
- **Data:** order `status` pending -> paid, `paid_at`, `gateway_payment_id`, merged `gateway_payload`; credits via `WalletService::topup(user, minor, '<gateway-slug>.topup', 'topup.conversion', 'Wallet top-up - order N', meta{order_id, gateway, transaction_id, gateway_payment_id})` -> one currency topup row and one credit earn row.
- **Rules & edge cases:** (in order of evaluation)
  1. 404 "Order not found." when no order with that number belongs to the caller. Already `paid` returns the idempotent success. 422 when `meta.kind` is not `wallet_topup` ("Use /create-order/confirm for plan orders."). 422 when the minor amount (from `meta.minor` or total x100) <= 0.
  2. Gateway lookup by `gateway_id` then `gateway_slug`; none -> 402 "This top-up cannot be verified - no payment gateway is attached to the order." (fail closed).
  3. The client-supplied `transaction_id` is set on the order in memory as the payment id so a driver `verify()` can re-query. The driver's `handleCallback(payload)` decides; if not paid it falls back to `verify(order)`. Exceptions -> 502 "Could not verify the payment with the gateway."; not paid -> 402 "Payment was not confirmed by the gateway. Your wallet was not credited."
  4. Binding: if both the order and the verification result carry a gateway order id, they must match (constant-time compare) else 422 "The verified payment does not match this top-up order."; captured amount/currency are extracted best-effort (Stripe-style `amount_total`/`amount_received`/`amount_captured` in minor; 2Checkout `GrossPrice`/`NetPrice` in major x100): currency mismatch -> 422, captured < expected -> 422. If neither the id binding nor an amount check succeeded -> 422 "The payment could not be matched to this top-up order."
  5. Credit + mark paid run in one DB transaction that re-locks the order row and re-checks status (concurrent confirms: the second is a no-op returning "Order already confirmed."). Failure to credit -> 500 `{success:false, message:"Failed to credit wallet.", error}`.
  6. QUIRK: this path does NOT run the shared `finalizeOrder`, so it neither triggers the referral payout nor invoice hooks, and it grants `meta.minor` as-is with no currency conversion (see TW-WALLET-027).
  7. The wallet credited is the caller's own wallet.
- **Async & events:** logs `[App\Wallet]` warnings for each rejection; gateway webhooks may also finalize the same order through the web path; the transaction re-check keeps the two idempotent only when the web path also checks status (it does).
- **External systems:** the gateway's verify/callback APIs (PAYGW).
- **Settings:** none.
- **Acceptance criteria:**
  - Given a paid Stripe session bound to the order, When confirming, Then the wallet is credited once and a second confirm returns "Order already confirmed."
  - Given a client claiming success for an unpaid order, When confirming, Then 402 and no credit.
  - Given a valid payment for a different (cheaper) order, When confirming this order, Then 422 mismatch.
  - Given an order lacking a gateway, Then 402.
- **Source refs:** app/Http/Controllers/Api/App/WalletController.php (topupConfirm, capturedAmountMinor), app/Services/WalletService.php (topup), app/Services/Payment/PaymentGatewayManager.php.
- **Port notes:** Build as a webhook-first flow (credit on the verified gateway webhook, per the `webhook-handler` skill) and keep this confirm endpoint as a poll/sync that only reads state or triggers a server-side verify; never accept client claims. Reuse the amount/currency/id binding checks.

### TW-WALLET-029 — Balance and billing-mode snapshots inside api/app/credits and extension credits

- **Status:** implemented
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-002, TW-WALLET-008
- **Summary:** Two other API surfaces expose the wallet in their own "credits" payloads: the mobile app's `GET api/app/credits` and the Chrome extension's `GET api/credits` (route named `ext.credits`). The routes belong to MOB and EXT; the wallet rules they embed are recorded here so the numbers stay consistent.
- **Actors & access:** Sanctum user (mobile) / extension API key (`ExtensionApiAuth`).
- **UX & screens:** none.
- **Endpoints:** (not claimed in this file's coverage)
  | METHOD uri          | route name  | Controller@action                  | middleware                                     | note                                                                                                                                          |
  | ------------------- | ----------- | ---------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
  | GET api/app/credits | (unnamed)   | Api\App\ContentController@credits  | api, Authenticate:sanctum, ResolveAppWorkspace | plan limits normalized so unlimited is always -1, plan usage this month (outbound rows in inbox_messages + messages), wallet fields           |
  | GET api/credits     | ext.credits | Api\ExtensionApiController@credits | api, ExtensionApiAuth                          | plan name, unlimited flag for admins, `monthly_messages_limit` (-1 unlimited), wallet money, per-message amount, delivered count, plan expiry |
- **Data:** reads the user's `wallet_credits`, `message_charges` (spent this month = sum of `revenue_minor` where status charged since month start), workspace limits.
- **Rules & edge cases:**
  1. `billing_mode`: `wallet` when pay-per-message else `plan`.
  2. `messages_remaining`: -1 for platform admins; in wallet mode floor(wallet credits / flat credits per message); in plan mode the plan's remaining monthly quota (-1 unlimited) with the wallet exposed separately as `wallet_buffer_messages` (overflow cushion).
  3. Money fields: `wallet_amount` (raw credits, backward-compat), `wallet_amount_minor` and `wallet_balance` (credits x per-credit money), formatted string with the currency symbol, `credit_per_message` (flat credits), `amount_per_message*` (flat price money), `spent_this_month*`.
  4. QUIRK: `amount_per_message` shows only the FLAT price even when per-country pricing is on.
  5. Monthly usage counts here (message rows) differ from the quota counter used by billing (`message_charges` rows): the two can disagree.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** as above.
- **Acceptance criteria:**
  - Given wallet mode with 1000 credits and flat 2, When calling api/app/credits, Then `messages_remaining` is 500.
  - Given plan mode with limit 1000 and 400 used, Then `plan_messages_remaining` is 600.
- **Source refs:** app/Http/Controllers/Api/App/ContentController.php (credits), app/Http/Controllers/Api/ExtensionApiController.php (credits).
- **Port notes:** Serve these from the wallet module's `getBillingSnapshot(tenant)` so MOB and EXT share one implementation.

### TW-WALLET-030 — Credit grants through WalletService::creditAccount (referral payout)

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-001
- **Summary:** The only live caller of `creditAccount` is the referral payout: when a referred user makes a first paid purchase, the referrer's wallet gets `referral_signup_credits` credits as an `earn` ledger row.
- **Actors & access:** System (checkout finalization). Referral attribution/UX belongs to CPN.
- **UX & screens:** shows as an "earn" row (source `referral.paid`) on the wallet tab and statement; KPI "Earned via affiliate".
- **Endpoints:** none.
- **Data:** `wallet_transactions` row kind credit, type earn (default type), source `referral.paid`, subject = the referee user, description "Referral bonus - EMAIL started a paid plan with your code", meta {referee_id, code_used}; `referrals.credits_awarded`, `award_transaction_id` (CPN table).
- **Rules & edge cases:**
  1. `creditAccount(user, amount, source, subject, description, meta, type)` throws when amount <= 0 and otherwise locks the user row, adds credits and writes the ledger row. Type defaults to `earn`.
  2. Payout amount = `referral_signup_credits` (stored minor units of the reward money, x100 of the admin input); zero payout is skipped; paid once per referee (award transaction id stamped).
  3. Triggered from the shared `finalizeOrder` after commit for ANY paid order, including a wallet top-up (TW-WALLET-016 rule 9). The mobile confirm path does not trigger it (TW-WALLET-028).
  4. The old signup-time payout was moved to first-payment to stop farming; the settings text on the wallet-rules page still says "the moment the referee finishes signup" (stale copy).
- **Async & events:** best-effort try/catch after the checkout transaction; log `[REFERRAL] paid-payout failed`.
- **External systems:** none.
- **Settings:** `referral_signup_credits`.
- **Acceptance criteria:**
  - Given a referral with an unpaid award, When the referee's first paid order finalizes, Then the referrer gets one earn row of the configured amount and the referral is stamped.
  - Given the referee later pays again, Then no second payout.
- **Source refs:** app/Services/WalletService.php (creditAccount), app/Services/ReferralService.php, app/Http/Controllers/CheckoutController.php (finalizeOrder), resources/views/user/account/index.blade.php.
- **Port notes:** CPN owns referrals; expose `wallet.credit({tenant, amount, reason, subject, idempotencyKey})` for it to call, and require a paid-plan (not top-up) trigger if farming is a concern.

### TW-WALLET-031 — Unused WalletService helpers: chargeForSend, refund, canSend, adminAdjustCredits

- **Status:** dead-code
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-001
- **Summary:** `WalletService` still ships a send-time charge (`chargeForSend`), a generic refund of a spend row (`refund`), a balance gate (`canSend`, `priceForMessages`) and an admin credit adjustment (`adminAdjustCredits`). Nothing calls them (only injected in controllers/services that never use them), so they are documentation of an earlier design.
- **Actors & access:** none reachable. There is no admin UI to adjust a user's wallet.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** would write ledger rows with source `message.sent` (negative amount), `refund` (type refund) and `admin.adjust` (type admin_adjust, meta {by_admin, requested, applied}).
- **Rules & edge cases:** (behavior if revived) `chargeForSend` throws when the balance is short and never sends half a broadcast; `refund` is idempotent per original row and only refunds credit spend rows; `adminAdjustCredits` clamps at zero and records the requested vs applied delta so support can see intent; `priceForMessages` = count x max(1, flat price).
- **Async & events:** none.
- **External systems:** none.
- **Settings:** `credits_per_message`.
- **Acceptance criteria:**
  - Given the port needs admin adjustments, When an admin applies -500 to a balance of 200, Then the balance is 0, the ledger stores requested -500 and applied -200, and an audit entry is written.
  - Given a refund is requested twice for the same spend, Then only one refund row exists.
- **Source refs:** app/Services/WalletService.php, app/Models/WalletTransaction.php (TYPE_ADMIN_ADJUST).
- **Port notes:** Port `adjust` as a platform-admin support action (needs a permission key, reason, audit) since customers will need goodwill credits; drop `chargeForSend` and `canSend`.

### TW-WALLET-032 — Seed data and settings catalogue for the domain

- **Status:** implemented
- **Priority:** P1 (expected by customers)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-004, TW-WALLET-019
- **Summary:** What a fresh install contains and every setting key the wallet domain reads, so the port can seed equivalent defaults.
- **Actors & access:** Installer / migrations.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** seeds installed with the database:
  1. `system_settings` seeded by the wallet migration: `referral_signup_credits`=100 (int), `credits_per_message`=1 (int), `credits_per_currency_minor`=0.1 (float).
  2. `message_rates` seeded (16 rows, all active, meta cost null): `|`=1, `|service`=0, `|utility`=1, `|authentication`=1, IN marketing/utility/authentication = 1/1/1, US = 12/2/6, GB = 12/2/6, BR marketing 6, AE marketing 5, MX marketing 3.
  3. `credit_packages` seeded: Starter, Growth, Scale (see TW-WALLET-019).
  4. Demo ledger seeder writes historical `wallet_transactions` (source `demo_seed`) without changing the balance.
  5. No seeded value for `per_country_credits_enabled`, `bsp_pay_per_message`, `wallet_billing_on_delivery`, `wallet_low_balance_threshold`, `bsp_meta_rates_endpoint`, `bsp_meta_system_user_token` (all defaulted in code).
- **Rules & edge cases:** settings table. `credits_per_message` (int >= 1 via UI, default 1), `credits_per_currency_minor` (float, default 0.1), `referral_signup_credits` (int minor, default 100), `per_country_credits_enabled` ("0"), `bsp_pay_per_message` ("0"), `wallet_billing_on_delivery` ("1"), `wallet_low_balance_threshold` (20 credits), `bsp_meta_rates_endpoint`/`bsp_meta_system_user_token` (empty), plus cross-domain `default_currency`, `checkout.tax_enabled`, `checkout.tax_rate`, `security.wa_guardrails_mode`, `platform.emergency_send_halt`. Setting values are stored as text with a type column; boolean-ish flags use the strings "1"/"0".
- **Async & events:** none.
- **External systems:** none.
- **Settings:** see above.
- **Acceptance criteria:**
  - Given a fresh install, When the admin opens wallet-rules, Then flat price 1, rate shown, and 16 starter rate rows exist.
  - Given per-country mode is switched on with seeded rows, When a US marketing message is priced, Then 12 credits.
- **Source refs:** database/migrations/2026_05_07_120000_create_wallet_and_referrals_tables.php, database/migrations/2026_06_28_160000_create_message_rates_table.php, database/migrations/2026_05_07_140000_create_credit_packages_table.php, database/seeders/DemoContentSeeder.php, app/Models/SystemSetting.php.
- **Port notes:** Ship a seed script for platform defaults; express the starter rate card in money not credits (TW-WALLET-002).

### TW-WALLET-033 — Advertised but absent: auto-recharge, monthly spend cap, admin wallet adjust UI

- **Status:** docs-only
- **Priority:** P2 (nice to have)
- **Effort:** S (<=2 dev-days)
- **Depends on:** TW-WALLET-001
- **Summary:** Copy in code or docs promises behaviors that have no working path in 1.7.0. Recorded so they are not mistaken for shipped features.
- **Actors & access:** none.
- **UX & screens:** none.
- **Endpoints:** none.
- **Data:** none.
- **Rules & edge cases:**
  1. Auto-recharge: a code comment on the low-balance hook says it triggers "auto-recharge" but nothing implements it; the checkout FAQ seed says "Top up automatically or set a monthly cap" and no such setting/UI exists.
  2. Monthly wallet spend cap: none exists (only plan caps and warmer caps).
  3. Admin adjustment of a user's wallet: a service method exists (TW-WALLET-031) but no admin route/UI.
  4. Docs claim "any unused wallet credits are lost on deletion" (account deletion): the account-delete action (`AccountController@destroyAccount`, AUTH domain) contains no wallet handling or warning, and the ledger FK to users is ON DELETE CASCADE, so the ledger goes with a hard-deleted user.
  5. Docs on the BSP pages describe a "programmatic access to wallets and charges" API; no such REST routes exist (the BSP api-reference page is only about Meta Graph API calls).
  6. Docs claim a pricing table covering all ~250 countries; only rows the admin creates or syncs exist.
  7. Docs say a meta_direct customer is never wallet-charged even with the global pay-per-message switch on; code charges (TW-WALLET-008).
  8. Refund of payments (wallet top-up refunds) is not implemented: nothing debits credits when a payment is refunded/charged back.
- **Async & events:** none.
- **External systems:** none.
- **Settings:** none.
- **Acceptance criteria:**
  - Given the port ships without these, When QA compares to Reference, Then no parity failure is raised for auto-recharge, monthly cap or wallet-refund flows.
  - Given the port chooses to add them later, When built, Then they are tracked as new features (not Reference parity).
- **Source refs:** app/Services/MessageBillingService.php (afterSpend comment), database/seeders/CheckoutDefaultsSeeder.php, Documentation/pages/account/account-billing.html, Documentation/pages/bsp-billing/api-reference.html, Documentation/pages/bsp-billing/admin-pages.html.
- **Port notes:** Backlog candidates: auto-recharge (saved payment method + threshold), monthly spend cap, wallet refund on payment refund, admin adjust screen.

## Data model

### wallet_transactions (model `WalletTransaction`)

Purpose: append-only ledger of every wallet movement. Written by `WalletService`, `MessageBillingService`, `OverflowBilling`; read by the wallet tab, statement, CSV, mobile API, BSP dashboards. Volume: one credit row per billed message (millions over time), so index on (`user_id`,`created_at`) matters.

- `id` bigint PK; `user_id` bigint unsigned NOT NULL FK users ON DELETE CASCADE; `kind` varchar(16) NOT NULL in {`credit`, `currency`}; `type` varchar(16) NOT NULL in {`earn`, `spend`, `refund`, `admin_adjust`, `topup`}; `amount` bigint NOT NULL (sign convention inconsistent, see TW-WALLET-001); `balance_after` bigint NOT NULL; `source` varchar(64) NULL; `subject_type` varchar(64) NULL + `subject_id` bigint unsigned NULL (no FK); `description` varchar(191) NULL; `meta` JSON NULL (shapes: charge {wamid, provider, source, money_minor, cost_minor}; refund {wamid, money_minor}; topup {order_id, gateway, transaction_id, gateway_payment_id} or {package_slug, currency, payment_ref, price_minor, currency_tx_id}; overflow {country, category, bsp_revenue_minor, bsp_cost_minor}; referral {referee_id, code_used}; admin {by_admin, requested, applied}); `created_at` timestamp NOT NULL default now (no `updated_at`).
- Indexes: (`user_id`,`created_at`), (`kind`,`source`), (`subject_type`,`subject_id`). Written by TW-WALLET-009/011/014/016/017/028/030/031; read by TW-WALLET-020/021/022/026.

### message_charges (model `MessageCharge`)

Purpose: one billing record per outbound provider message id; the P&L and idempotency key (`wamid` UNIQUE). Created by `settleDelivered`, flipped by `settleFailed`; read by the BSP `ReportService`, the statement (join by `wallet_tx_id`), quota counting (TW-WALLET-010) and API "spent this month".

- `id` bigint PK; `workspace_id` bigint unsigned NOT NULL (no FK); `user_id` bigint unsigned NULL (wallet owner); `provider` varchar(16) NULL (`waba`, `twilio`, `baileys`); `wamid` varchar(191) NOT NULL UNIQUE; `to_country` char(2) NULL; `category` varchar(24) NULL; `source` varchar(32) NULL; `credits` int unsigned NOT NULL default 0; `revenue_minor` bigint NOT NULL default 0; `cost_minor` bigint NULL; `status` enum(`free`,`charged`,`refunded`) NOT NULL default `charged`; `wallet_tx_id` bigint unsigned NULL; `meta` JSON NULL (unused by current writers); `created_at`, `updated_at` nullable timestamps.
- Indexes: `message_charges_wamid_unique`, (`workspace_id`,`created_at`), `workspace_id`, `user_id`, `status`.
- Model constants STATUS_FREE / STATUS_CHARGED / STATUS_REFUNDED. Retention: none defined; grows one row per delivered message.

### message_rates (model `MessageRate`)

Purpose: per (country, category) customer price and Meta wholesale cost. Read by `MessageCreditRate` (cached 5 minutes); edited only from the admin grid, import and sync.

- `id`; `country_code` varchar(2) NOT NULL default '' ('' = any country); `category` varchar(20) NOT NULL default '' ('' = any category; values marketing, utility, authentication, service); `credits` int unsigned NOT NULL default 1 (0 = free); `meta_cost_minor` bigint unsigned NULL; `currency` varchar(8) NULL; `is_active` tinyint(1) NOT NULL default 1; timestamps.
- UNIQUE (`country_code`,`category`); index `country_code`. Row volume: tens to a few hundred.

### credit_packages (model `CreditPackage`)

Purpose: admin-curated top-up bundles (retired from the UI). See TW-WALLET-019 for columns, defaults and seeds. UNIQUE `slug`; index (`is_active`,`sort_order`).

### Columns owned on shared tables

- `users.wallet_credits`, `users.wallet_currency_minor`, `users.wallet_currency_code` (see TW-WALLET-001); `users` is owned by AUTH.
- `workspaces.bill_to_platform_credit` bool default 0 (billing mode flag); `workspaces` is owned by WSP; `plan_ends_at`, `trial_ends_at`, `plan_overrides`, `cap_monthly_messages` are PLAN concerns read here.
- `orders.credit_package_id` and `orders.gateway_payload.wallet_topup_minor`, `orders.meta` {kind:`wallet_topup`, minor} carry top-up intent (orders owned by PAYGW/PLAN).
- `scheduled_messages.charged_sent` used only by the legacy send-time meter.
- `system_settings` keys listed in TW-WALLET-032.

## Cross-domain contracts

Consumes:

- `plans-subscriptions-trials` (PLAN): `Workspace::effectiveLimit('monthly_messages_limit')`, `planIsActive()`, plan expiry/trial, `plan_overrides`; `PlanUsage::summary` embeds wallet fields; `PlanLimitReachedException` type.
- `platform-payment-gateways` (PAYGW): `PaymentGatewayManager` drivers (`initiate`, `handleCallback`, `verify`, `acceptsCurrency`), the `payment.callback` route that calls `finalizeOrder`, shared `checkout.show` view, `Order` model.
- `coupons-credits-referral-currency` (CPN): `FormatSettings::display/convert/currencyFor/formatIn`, active currency catalog, referral attribution and payout trigger (`ReferralService::rewardOnFirstPayment` calls `WalletService::creditAccount`), affiliate history page copy.
- `notifications-activity-audit` (NOTIF): `NotificationHelper::toUser`, `wallet_low_balance` preference and default channels, `Audit::log` (`billing.send_blocked_no_wallet`).
- `roles-permissions` (RBAC) / `admin-console-shell` (ASHELL): admin route middleware (Authenticate, EnsureUserIsAdmin, IPAllowlist), sidebar entries "Message pricing", "Credit packages"; note seeded `billing.*` permission keys are not used by any wallet route.
- `platform-settings-branding-storage` (SET): `system_settings` storage of every key here.
- `whatsapp-cloud-api-waba` (WABA), `node-bridge-runtime` (NODE), `broadcasts` (BCAST), `campaigns` (CAMP), `scheduled-queue-warmer` (SCHED), `chat-conversations` (CHAT), `team-inbox-conversations` (TIB1), `auto-reply-keywords` (AR), `flow-runtime-engine` (FLR), `message-templates` (TPL): they call `settleDelivered`/`settleFailed`, `SendGate::screenBody`, and (legacy) `OverflowBilling::consumeOne`; TPL supplies `effectiveCategory()`.
- `bsp-billing-engine` (BSP): the devices billing-mode switch and credit-line attach (`POST devices/billing-mode`), P&L dashboards, the "Message income" and "Reseller billing" pages, `bsp_credit_allocations`.

Exposes:

- Service API (proposed names for the port): `wallet.debit/credit`, `billing.settleDelivered/settleFailed`, `billing.precheck`, `rates.creditsFor/metaCostFor/display`, `wallet.getBillingSnapshot`.
- Tables read by others: `message_charges` (BSP P&L, statements, API spend), `wallet_transactions` (statement, mobile), `message_rates` (BSP margin readouts).
- Settings read by others: `credits_per_message`, `credits_per_currency_minor`, `bsp_pay_per_message`, `per_country_credits_enabled`.
- Events to emit in the port: `wallet.topped_up`, `wallet.debited`, `wallet.low_balance`, `message.charged`, `message.refunded`.
- Shared routes: `api/app/wallet*` (also MOB), `checkout/*` wallet pages (also PAYGW/PLAN), `account/wallet/*` (also the account domain).

## Open questions & quirks

1. **Money-unit contradiction (highest risk).** Credits vs money is half migrated. `credits_per_currency_minor` ships as 0.1 (10 credits per unit, 1 credit = 10.00 of money) but checkout, referral, statement, rate grid, seeded rate card comments all assume 1 credit = 1 minor unit (rate = 100). Under the shipped default, a "1.00" rate-grid price charges 100 credits = 1000.00 of money. Confirm the intended production value on the reference install before porting; recommendation is to store money directly.
2. **Spend rows are stored with a POSITIVE amount** by `settleDelivered` and `OverflowBilling` (type `spend`), negative only by the dead `chargeForSend`. The statement, its summary and the CSV classify by sign and therefore show message charges and refunds as "money in". The wallet tab shows "+" on charges. Port must use an explicit direction.
3. **Free-credit hole:** `POST checkout/complete` (CheckoutPagesController) credits any active credit package with no payment for any logged-in user (no auth middleware; guests crash with a 500). Do not port. Also check whether the reference deployment exposes it.
4. **Empty wallet still delivers:** in delivery-time billing an empty or short wallet is recorded as a free (or partially charged) message; only bulk launches are pre-gated, and only by `balance > 0`, not by the estimated cost. Expired plans in plan mode are not blocked either.
5. **"Charge on delivery" is not strictly delivery:** Baileys/Twilio campaign, broadcast and scheduled callbacks bill on `sent`, and the unofficial campaign loop settles inline at send.
6. **Wallet is per USER, not per workspace.** The debited wallet is the workspace owner's; the credited wallet is whoever paid (`orders.user_id`); balance chips in the shell show the logged-in user's own wallet while the plan-usage card shows the owner's. Owners of multiple workspaces share one wallet; the low-balance alert is evaluated against the owner's current workspace. Decide the port's tenant-wallet model explicitly.
7. **Rounding of Meta cost:** input allows 4 decimals but storage is x100 integer rounded, so US utility 0.004 becomes 0.00 and marketing 0.025 becomes 0.03.
8. **CSV import vs grid unit mismatch:** import `credits` column is raw credits; grid input is money x100. Migration seed rows are whole credits (1, 12) that render as 0.01, 0.12 in the money grid.
9. **Master switches overwritten on every rate save:** `per_country_credits_enabled` and `bsp_pay_per_message` are reset from checkboxes at each grid save. Docs say a meta_direct client is never charged even with the global switch on; code charges everyone when it is on.
10. **Wallet-rules page stale copy:** says the balance is `workspaces.wallet_credits`, "1 credit per USD", and that referral reward is paid at signup (it is paid on first paid purchase). Flat "credits per message" cannot be set to 0 in the UI.
11. **Docs-only / absent:** auto-recharge, monthly spend cap, admin wallet adjust UI, refund-of-top-up handling, BSP wallet REST API, "all ~250 countries" rows (TW-WALLET-033).
12. **Quota counter semantics:** free monthly quota counts `message_charges` rows of every status (free, charged, refunded) since the 1st of the server-timezone month; there is no lock, so concurrent deliveries near the limit can over-grant free messages.
13. **Referral farming:** any first paid order, including a 1.00 wallet top-up, triggers the referrer payout; the mobile confirm path never triggers it.
14. **Top-up currency handling:** the web flow converts the pre-tax amount to the platform currency before crediting; the mobile top-up path does not (credits `meta.minor` verbatim in whatever currency was chosen). Web tax defaults differ between show (18) and process (0) when the setting is unset.
15. **Ownership overlaps to resolve with other writers:** `api/app/wallet*` (MOB vs WALLET), `checkout/wallet` + `checkout/credits/{slug}` (PAYGW/PLAN vs WALLET), `account/wallet/statement*` (AUTH/account vs WALLET), `checkout` (GET), `checkout/complete`, `checkout/success`, `checkout/failed` (claimed here as they belong to the legacy credit-pack checkout), credit packages (CPN's doc page also covers coupons), `admin/bsp/rate-cards` (BSP vs WALLET). `devices/billing-mode`, `api/app/credits`, `api/credits` are documented here but left to BSP/WADEV, MOB and EXT.
16. **Shared source files** claimed here for their wallet parts only: AdminPagesController, AccountController, CheckoutController, UserPagesController, ContentController, ExtensionApiController, SendGate, PhoneCountry, PlanUsage. Only the wallet-specific files are listed in the controllers/services coverage.
17. **Dead code / unused:** `WalletService::chargeForSend/refund/canSend/adminAdjustCredits/priceForMessages`, the hidden bundle grid on the wallet tab, the unreachable body of `creditShow`, the `wallet_currency_minor` display path, `MessageCharge.meta`, `WalletTransaction` scopes `credit/currency/forUser` used only by account pages.
18. **Observability gaps:** no audit log for rate or setting changes, no alert when charges fail to record, no reconciliation between ledger and balance mirror.
19. **Unverified:** the per-driver behavior of the shared gateway callback (`payment/callback/{gateway}`, PAYGW) beyond the shared redirect to the wallet tab for wallet orders; behavior of order refund status on wallet orders (nothing debits credits).

## Coverage

```json threadwise-coverage
{
  "routes": [
    "GET account/wallet/statement",
    "GET account/wallet/statement.csv",
    "GET admin/settings/wallet-rules",
    "POST admin/settings/affiliate",
    "POST admin/settings/message-rates",
    "POST admin/settings/message-rates/import",
    "POST admin/settings/message-rates/sync-meta",
    "GET admin/bsp/rate-cards",
    "GET admin/credit-packages",
    "GET admin/credit-packages/create",
    "POST admin/credit-packages",
    "GET admin/credit-packages/{id}/edit",
    "PUT admin/credit-packages/{id}",
    "POST admin/credit-packages/{id}/toggle",
    "DELETE admin/credit-packages/{id}",
    "GET checkout/wallet",
    "POST checkout/wallet",
    "GET checkout/credits/{slug}",
    "POST checkout/credits/{slug}",
    "GET checkout",
    "POST checkout/complete",
    "GET checkout/success",
    "GET checkout/failed",
    "GET api/app/wallet",
    "GET api/app/wallet/transactions",
    "POST api/app/wallet/topup",
    "POST api/app/wallet/topup/confirm"
  ],
  "controllers": [
    "app/Http/Controllers/Admin/AdminCreditPackagesController.php",
    "app/Http/Controllers/Api/App/WalletController.php",
    "app/Http/Controllers/CheckoutPagesController.php"
  ],
  "services": [
    "app/Services/WalletService.php",
    "app/Services/MessageBillingService.php",
    "app/Services/MessageCreditRate.php",
    "app/Services/OverflowBilling.php",
    "app/Support/WalletAlerts.php",
    "app/Support/PhoneCountry.php",
    "app/Support/SendGate.php"
  ],
  "models": ["WalletTransaction", "MessageCharge", "MessageRate", "CreditPackage"],
  "tables": ["wallet_transactions", "message_charges", "message_rates", "credit_packages"],
  "views": [
    "resources/views/admin/settings/wallet-rules.blade.php",
    "resources/views/admin/credit-packages/index.blade.php",
    "resources/views/admin/credit-packages/create.blade.php",
    "resources/views/admin/credit-packages/edit.blade.php",
    "resources/views/admin/credit-packages/_form.blade.php",
    "resources/views/user/account/wallet-statement.blade.php",
    "resources/views/checkout/index.blade.php",
    "resources/views/checkout/success.blade.php",
    "resources/views/checkout/failed.blade.php",
    "resources/views/components/message-pricing.blade.php"
  ],
  "commands": [],
  "permissions": [],
  "middleware": [],
  "node_files": [],
  "js_assets": ["resources/js/charts/admin-wallet-rules.js"],
  "misc_files": ["app/Exceptions/PlanLimitReachedException.php"],
  "config_files": [],
  "doc_pages": [
    "Documentation/pages/bsp-billing/billing-engine.html",
    "Documentation/pages/admin-panel/coupons-credits.html",
    "Documentation/pages/account/account-billing.html",
    "Documentation/pages/bsp-billing/customer-flow.html",
    "Documentation/pages/bsp-billing/admin-pages.html",
    "Documentation/pages/bsp-billing/overview.html"
  ],
  "feature_map": {
    "TW-WALLET-001": [],
    "TW-WALLET-002": [],
    "TW-WALLET-003": ["GET admin/settings/wallet-rules", "POST admin/settings/affiliate"],
    "TW-WALLET-004": [],
    "TW-WALLET-005": ["POST admin/settings/message-rates"],
    "TW-WALLET-006": ["POST admin/settings/message-rates/import"],
    "TW-WALLET-007": ["POST admin/settings/message-rates/sync-meta"],
    "TW-WALLET-008": ["GET admin/bsp/rate-cards"],
    "TW-WALLET-009": [],
    "TW-WALLET-010": [],
    "TW-WALLET-011": [],
    "TW-WALLET-012": [],
    "TW-WALLET-013": [],
    "TW-WALLET-014": [],
    "TW-WALLET-015": [],
    "TW-WALLET-016": ["GET checkout/wallet", "POST checkout/wallet"],
    "TW-WALLET-017": ["GET checkout/credits/{slug}", "POST checkout/credits/{slug}"],
    "TW-WALLET-018": [
      "GET checkout",
      "POST checkout/complete",
      "GET checkout/success",
      "GET checkout/failed"
    ],
    "TW-WALLET-019": [
      "GET admin/credit-packages",
      "GET admin/credit-packages/create",
      "POST admin/credit-packages",
      "GET admin/credit-packages/{id}/edit",
      "PUT admin/credit-packages/{id}",
      "POST admin/credit-packages/{id}/toggle",
      "DELETE admin/credit-packages/{id}"
    ],
    "TW-WALLET-020": [],
    "TW-WALLET-021": ["GET account/wallet/statement"],
    "TW-WALLET-022": ["GET account/wallet/statement.csv"],
    "TW-WALLET-023": [],
    "TW-WALLET-024": [],
    "TW-WALLET-025": ["GET api/app/wallet"],
    "TW-WALLET-026": ["GET api/app/wallet/transactions"],
    "TW-WALLET-027": ["POST api/app/wallet/topup"],
    "TW-WALLET-028": ["POST api/app/wallet/topup/confirm"],
    "TW-WALLET-029": [],
    "TW-WALLET-030": [],
    "TW-WALLET-031": [],
    "TW-WALLET-032": [],
    "TW-WALLET-033": []
  }
}
```
