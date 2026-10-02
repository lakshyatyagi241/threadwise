# Wallet and per-message billing (WALLET)

Money is always an integer count of **hundredths** of the currency unit (`...Minor`); the database holds the balance as a decimal in whole units. Ids on the wire are uuids. Validation failures are `422 VALIDATION_FAILED`; domain failures carry the codes below. Shapes: `packages/contracts/src/wallet-message-billing`.

## Customer (workspace user) — `/v2/wallet`
| Route | Permission | What |
|---|---|---|
| `GET /wallet/summary` | `wallet.balance.read` | balance, billing mode (`wallet`/`plan`), 30-day spent/earned/topped-up/refunded, plan allowance, low-balance flag |
| `GET /wallet/ledger?limit&cursor` | `wallet.statement.read` | recent entries, newest first, signed by direction |
| `GET /wallet/statement?type&from&to&q&limit&cursor` | `wallet.statement.read` | filters, totals over the whole filtered set, per-message context. `type`: all, topup, earn, spend, refund, admin_adjust |
| `GET /wallet/statement.csv` (same query) | `wallet.statement.export` | oldest first, formula-safe, at most 50,000 rows |
| `GET /wallet/pricing?country=XX` | `wallet.balance.read` | base price of each category |

Top-ups are bought through the payment checkout (`/v2/billing/checkout/wallet/*`, domain PAYGW); a paid order posts to the ledger through `WalletLedgerService` with the order uuid as idempotency key.

## Operator (super admin console) — `/v2/platform/wallet`
Every operator role reads; **writes need `super_admin`** and each writes a row to the platform or workspace log.
`GET overview` · `GET/PUT settings` (flat price, referral reward, alert threshold, launch coverage %) · `PUT switches` (`perCountryEnabled`, `payPerMessage`, saved apart from rates) · `GET/PUT rates` (per-row server validation, `skipped[{index,reason}]`) · `DELETE rates/:id` · `POST rates/seed` · `POST rates/import {csv,dryRun}` · `POST rates/sync-meta {dryRun}` · `GET workspaces` · `GET workspaces/:id` · `POST workspaces/:id/adjust` · `GET logs` · `POST reconciliation`.

### Adding or taking money by hand
`POST /v2/platform/wallet/workspaces/:id/adjust` with header `Idempotency-Key` and body `{direction:'credit'|'debit', amount:'250.00', note}`.
The **note is mandatory** (5–500 chars): refused by the request schema, again by the ledger service, and a third time by a CHECK on the table. One transaction writes the ledger entry (actor name, note), the workspace wallet log, the security audit row and a `wallet.topped_up` outbox event (the owners are notified). A debit never takes a wallet below 0: the result says `requestedMinor` vs `appliedMinor`. The customer sees the reason on their statement.

## Settlement (no HTTP)
A channel emits `message.delivery_reported` (`provider`, `providerMessageId`, `status`, `recipient`, `category`, `source`) through the outbox; the worker's `DeliveryBillingConsumer` is the only thing that charges. `delivered`/`read` charge (Baileys also on `sent`); `failed`/`undelivered` refund the exact charge once. Idempotent per message id (`usage_charge_keys`), one wallet row lock per workspace, partial charge when the balance is short (shortfall recorded), free reasons `rate_is_zero | within_plan_free_quota | wallet_empty`.
Bulk sends call `WalletGateService.assertCanLaunch({orgId, source, recipients, phones?, category?})` before creating rows (`422 WALLET_EMPTY`).

## Logs
`wallet_events` (per workspace: partial/unbilled charges, refunds, alerts, refused launches, adjustments, settle failures, reconciliation mismatches) and `wallet_platform_log` (rate/switch/settings/import/sync changes with old and new values). Both append-only by trigger. Every event is also a structured process-log line `[WALLET]`.

## Error codes
`WALLET_EMPTY`, `WALLET_INSUFFICIENT_BALANCE`, `WALLET_NOT_FOUND`, `WALLET_NOTE_REQUIRED`, `WALLET_AMOUNT_INVALID`, `WALLET_RATE_INVALID`, `WALLET_IMPORT_FAILED`, `WALLET_SYNC_FAILED`.
