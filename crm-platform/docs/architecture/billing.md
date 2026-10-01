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

## Compliance gate

Exam fees mean holding money that belongs to an institute. Under the RBI
PA/PG framework that is regulated activity. Before it goes live: a legal opinion on whether the flow is payment aggregation, routing through an authorised PA (or an escrow/nodal account) if it is, agreed settlement timelines, GST and TDS treatment, and a refund and chargeback flow.

**Test mode only until it is closed.**
