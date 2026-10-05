# Wallet and per-message billing (WALLET)

Money is always an integer count of **hundredths** of the currency unit (`...Minor`); the database holds the balance as a decimal in whole units. Ids on the wire are uuids. Validation failures are `422 VALIDATION_FAILED`; domain failures carry the codes below. Shapes: `packages/contracts/src/wallet-message-billing`.

## Customer (workspace user) — `/v2/wallet`
| Route | Permission | What |
|---|---|---|
| `GET /wallet/summary` | `wallet.balance.read` | balance, billing mode (`wallet`/`plan`), 30-day spent/earned/topped-up/refunded, plan allowance, low-balance flag |
| `GET /wallet/ledger?limit&cursor` | `wallet.statement.read` | recent entries, newest first, signed by direction |
| `GET /wallet/statement?type&from&to&q&limit&cursor` | `wallet.statement.read` | filters, totals over the whole filtered set, per-message context. `type`: all, topup, earn, spend, refund, admin_adjust |
| `GET /wallet/statement.csv` (same query) | `wallet.statement.export` | oldest first, formula-safe, at most 50,000 rows |
| `GET /wallet/pricing?country=XX` | `wallet.balance.read` | base price of each category, for THIS workspace (its override, its plan) |
| `GET /wallet/snapshot` | `wallet.balance.read` | one-call view for the mobile app and the extension (mode, balance, messages left, month spend; -1 = unlimited) |

Top-ups are bought through the payment checkout (`/v2/billing/checkout/wallet/*`, domain PAYGW); a paid order posts to the ledger through `WalletLedgerService` with the order uuid as idempotency key.

## Operator (super admin console) — `/v2/platform/wallet`
Every operator role reads; **writes need `super_admin`** and each writes a row to the platform or workspace log.
`GET overview` · `GET/PUT settings` (flat price, referral reward, alert threshold, launch coverage %) · `PUT switches` (`perCountryEnabled`, `payPerMessage`, saved apart from rates) · `GET/PUT rates` (per-row server validation, `skipped[{index,reason}]`) · `DELETE rates/:id` · `POST rates/seed` · `POST rates/import {csv,dryRun}` · `POST rates/sync-meta {dryRun}` (live endpoint, else the stored official card of the platform currency, else the bundled indicative card) · `GET meta-cards` (the cards stored per currency, their age, the quarterly reminder, currencies in use with no card) · `GET meta-cards/:currency` (one card market by market) · `POST meta-cards/import {file(base64 .xlsx|.csv), fileName?, dryRun}` (super admin; the platform currency's card also refreshes the Meta costs behind pricing) · `GET workspaces` (each workspace with the wallet in its own billing currency; `totals.floatByCurrency`) · `PUT workspaces/:id/currency {currency, note}` (super admin; only a currency with a stored Meta card; the old wallet keeps its balance) · `GET workspaces/:id` · `POST workspaces/:id/adjust` · `GET logs` · `POST reconciliation`.

### Adding or taking money by hand
`POST /v2/platform/wallet/workspaces/:id/adjust` with header `Idempotency-Key` and body `{direction:'credit'|'debit', amount:'250.00', note}`.
The **note is mandatory** (5–500 chars): refused by the request schema, again by the ledger service, and a third time by a CHECK on the table. One transaction writes the ledger entry (actor name, note), the workspace wallet log, the security audit row and a `wallet.topped_up` outbox event (the owners are notified). A debit never takes a wallet below 0: the result says `requestedMinor` vs `appliedMinor`. The customer sees the reason on their statement.

### Pricing: Meta cost + our margin
`wallet.pricing_mode` is `fixed` (typed prices, the default so an upgrade changes nothing) or `margin`. In margin mode a message costs **Meta's cost x (1 + margin)**, rounded to the nearest hundredth (never below 0.01 unless the cost is 0 or the margin is -100%). The margin is looked up per country and category, most specific first (country+category, country, category, default), in this order of layers: **workspace override, then the workspace's plan, then the platform default** (plan `''`). Where Meta's cost is unknown for a country/category, or no margin exists, the typed fixed price applies.
`GET/PUT margins?plan=` (platform default or one plan) · `DELETE margins/:id` · `GET/PUT workspaces/:id/margins` (override; **a note is mandatory**, written to the workspace log and the audit trail; `removeIds` removes) · `GET pricing/preview?workspaceId&country&category` (Meta cost, matched margin and layer, price) · `PUT switches {pricingMode}`.
Meta's cost comes from the rate card (`rates`, `rates/import`, `rates/sync-meta`).

### Credit packages (WD-WALLET-019)
`GET/POST packages` · `PUT packages/:id` (`rowVersion`, stale = 409) · `POST packages/:id/toggle` · `DELETE packages/:id`. Catalogue only; there is no bundle checkout (WaDesk retired it).

### Realtime
`wallet.updated {balanceMinor, reason}` is pushed to the workspace `org` room after a charge (coalesced to one per 1.5 s), refund, top-up or manual credit.

## Settlement (no HTTP)
A channel emits `message.delivery_reported` (`provider`, `providerMessageId`, `status`, `recipient`, `category`, `source`) through the outbox; the worker's `DeliveryBillingConsumer` is the only thing that charges. `delivered`/`read` charge (Baileys also on `sent`); `failed`/`undelivered` refund the exact charge once. Idempotent per message id (`usage_charge_keys`), one wallet row lock per workspace, partial charge when the balance is short (shortfall recorded), free reasons `rate_is_zero | within_plan_free_quota | wallet_empty`.
Bulk sends call `WalletGateService.assertCanLaunch({orgId, source, recipients, phones?, category?})` before creating rows (`422 WALLET_EMPTY`).

## Logs
`wallet_events` (per workspace: partial/unbilled charges, refunds, alerts, refused launches, adjustments, settle failures, reconciliation mismatches) and `wallet_platform_log` (rate/switch/settings/import/sync changes with old and new values). Both append-only by trigger. Every event is also a structured process-log line `[WALLET]`.

## Error codes
`WALLET_EMPTY`, `WALLET_INSUFFICIENT_BALANCE`, `WALLET_NOT_FOUND`, `WALLET_NOTE_REQUIRED`, `WALLET_AMOUNT_INVALID`, `WALLET_RATE_INVALID`, `WALLET_IMPORT_FAILED`, `WALLET_SYNC_FAILED`.
