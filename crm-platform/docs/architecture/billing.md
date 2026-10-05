# Billing

Not built yet. The schema and the decisions are settled.

## The whole flow in one picture

```
campaign start
   └─> reserve estimated cost on the wallet
         insufficient? → HARD BLOCK, status = paused_insufficient_funds
   └─> each send writes ONE usage_charge   (rate frozen from the rate card)
   └─> worker rolls unposted charges into ONE wallet_transaction per org, ~60s
   └─> campaign end: settle actuals, release the remainder of the reservation

exam fee
   candidate pays via Easebuzz → payment_transactions
                               → periodic settlements to the institute
                               ⚠ RBI PA/PG compliance gate
```

## Two-level ledger

| Level | Table                 | Volume        | Purpose                    |
| ----- | --------------------- | ------------- | -------------------------- |
| 1     | `usage_charges`       | ~5 lakh/day   | metering, billing evidence |
| 2     | `wallet_transactions` | ~1/minute/org | actual money movement      |

Level 1 is partitioned monthly and retained at least a fiscal year — it is the
evidence behind an invoice.

Level 2 is deliberately **unpartitioned** and carries a real unique constraint
on `(org_id, idempotency_key)`. Low volume, and the strongest available guard
against double-posting a top-up when a gateway retries its webhook.

Writing to the wallet per message would put every send in the tenant behind one
row lock. This roll-up is the most important performance decision in the
billing design.

## Invariants — in the database

```sql
CONSTRAINT chk_wallet_invariant CHECK (
  balance >= 0 AND reserved >= 0 AND reserved <= balance
)
```

Available balance is `balance - reserved`.

Every spend is a **conditional UPDATE**. Zero rows affected = blocked:

```sql
UPDATE wallets
SET reserved = reserved + $amount
WHERE org_id = $1 AND (balance - reserved) >= $amount
```

There is no read-then-check-then-write anywhere. That pattern loses the race
under concurrency, and the symptom is a negative balance nobody can explain.

## Rates are frozen at charge time

`usage_charges.unit_rate` is copied from `rate_cards` when the charge is
written. Changing a rate card never rewrites history — an invoice from last
month must still reconcile next year.

`rate_cards` is the admin pricing surface: per org, per `unit_type`
(`wa_marketing`, `wa_utility`, `sms_txn`, `ai_tokens_1k`, `exam_pg_fee`, …),
with a platform default when `org_id IS NULL`. **A new billable is a new
`unit_type` value, not a schema change.**

## Money in JavaScript

Money columns are `numeric`. The int8 type parser in
`packages/db/src/client.ts` deliberately does **not** convert `numeric`, so
these stay strings all the way to a decimal library.

Float rounding on a wallet balance is the one bug nobody forgives.

## Reconciliation

Two ledgers means they can disagree. A reconciliation report —
sum(`usage_charges.amount`) where posted vs sum of posting amounts, per org per
period — is required before this is trusted, not after.

## Subscriptions, grace and recurring add-ons (platform billing)

How a workspace pays the platform (plans, add-ons, wallet top-ups) through Razorpay and the other gateways. Decided in the billing
hardening change (`lakshya/paygw/billing-hardening`); the code lives in `modules/platform-payment-gateways`, `plans-subscriptions-trials` and
`addons-extension-registry`.

**Decisions**

- **A subscription and a payment are different things.** A wallet top-up and a one-off plan or add-on purchase are payments: an order that
  one confirmed payment settles. A subscription is a provider mandate that charges on its own. A subscription charge is settled only by its
  subscription event (`subscription.charged`, which carries the payment). A `payment.captured` that carries an `invoice_id` is the same charge seen
  as a payment, and is ignored as a one-off payment, so it can never settle or double-apply to an unrelated order.
- **Grace is derived, not stored.** `paid_grace` is computed on read: the plan period has ended, a live autopay subscription (`active` or `past_due`)
  exists for the plan, and now is before `plan_ends_at + billing.grace_days` (platform setting, default 7, 0 to 30). Entitlements stay those of the paid
  plan inside the grace; after it the plan lapses to free as before. No column, no sweeper: a renewal or a final failure is visible on the next read.
- **A recurring add-on is a subscription of its own, not a plan change.** `plans.billing_mode` is `one_time` or `recurring` (recurring only for a
  priced, non-lifetime add-on). A recurring pack is bought through the same checkout as a Razorpay subscription; its `subscriptions` row has
  `kind = 'addon'` and `workspace_addon_id`. Each charge moves that purchase's `workspace_addons.ends_at` to the provider period end, never earlier, and the
  workspace plan window is never touched. Cancel stops the renewal and keeps the paid term. The add-on gets the same grace, evaluated in the entitlement
  query for purchases with a live subscription.
- **A provider plan is made once.** `gateway_plan_cache` remembers the provider plan per gateway account (a hash of the key id, so test and live
  never share), currency, minor-unit amount and interval. A cached plan the provider no longer has is replaced once. The cache is platform data
  (no tenant, privileged access only).

**Consequences**

- Good: no new background job; a missed webhook is repaired by the existing reconciler; the plan and add-on paths share one lifecycle service.
- Cost: every entitlement read for a workspace with autopay also reads the grace setting (cached 30 seconds per process) and checks for a live
  subscription; a changed grace value takes up to 30 seconds to apply. The admin workspace list still shows a workspace in grace as lapsed.
- Cost: because the add-on subscription shares the table, anything that reads "the workspace subscription" must filter on `kind`.
- A renewal never shortens a paid term: if the provider's period end is earlier than the pack's own term, the longer one stays.

**Alternatives that lost**

- A stored `grace_ends_at` set by the failure webhook and cleared by a sweeper: a second source of truth that goes stale when a webhook is missed,
  and a new scheduled job to keep it right.
- A separate `addon_subscriptions` table: duplicates the lifecycle (activate, renew, cancel, reconcile, audit, outbox) for no behavioural difference.
- A new provider plan on every checkout (WaDesk's way): leaves an orphan plan in the provider account for every attempt.

**Revisit when** grace needs a per-plan or per-workspace length, add-ons need prorating or a mid-term quantity change (that wants a real provider
subscription update, not a new row), or the entitlement hot path shows the grace and subscription lookup in a profile.

## Compliance gate

Exam fees mean holding money that belongs to an institute. Under the RBI
PA/PG framework that is regulated activity. Before it goes live: a legal opinion on whether the flow is payment aggregation, routing through an authorised PA (or an escrow/nodal account) if it is, agreed settlement timelines, GST and TDS treatment, and a refund and chargeback flow.

**Test mode only until it is closed.**
