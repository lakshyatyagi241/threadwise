# ADR-0012: Prepaid wallet, two-level ledger, and the settlement compliance gate

- **Status:** accepted (schema) / **blocked** (exam-fee settlements)
- **Date:** 2026-09-16

## Context

Two distinct money flows:

1. **Platform usage.** Orgs prepay a wallet; messages, AI calls and integrations
   draw it down. At 5 lakh messages/day this is 5 lakh billable events/day.
2. **Exam fees.** A candidate pays _us_; we later settle to the institute, net
   of fees.

Flow 2 means holding money that belongs to someone else. In India that is
regulated activity.

## Decision

### Prepaid wallet with a hard block

`wallets` holds `balance` and `reserved`; available is `balance - reserved`.
Invariants are database CHECK constraints, not application checks:

```
balance >= 0 AND reserved >= 0 AND reserved <= balance
```

Every spend is a **conditional UPDATE**. Zero rows affected means blocked. There
is no read-then-check-then-write anywhere — that pattern loses the race under
concurrency, and the symptom is a negative balance nobody can explain.

A campaign reserves its estimated cost before sending. Insufficient funds moves
the campaign to `paused_insufficient_funds` and sends nothing.

### Two-level ledger

| Level | Table                 | Volume                                  | Purpose            |
| ----- | --------------------- | --------------------------------------- | ------------------ |
| 1     | `usage_charges`       | one row per billable unit (~5 lakh/day) | metering, evidence |
| 2     | `wallet_transactions` | one row per org per ~60s                | money movement     |

A worker rolls unposted charges into a single wallet posting per org per minute.
Writing to the wallet per message would serialise every send in the tenant
behind one row lock — this is the single most important performance decision in
the billing design.

`usage_charges.unit_rate` is **frozen at charge time** from the rate card.
Changing a rate never rewrites history.

`wallet_transactions` is deliberately unpartitioned and carries a real unique
constraint on `(org_id, idempotency_key)` — low volume, and the strongest
possible guard against double-posting a top-up.

### Exam-fee settlements: gated

Schema is in place (`payment_transactions`, `settlements`,
`settlement_items`). Real settlements do **not** go live until the
**RBI Payment Aggregator / Payment Gateway** position is resolved.

## Consequences

### Positive

- The wallet cannot go negative — enforced by the database.
- Billing evidence survives rate changes and disputes.
- Per-message metering costs one insert into a partitioned append-only table.
- Idempotency on postings makes gateway webhook retries harmless.

### Negative

- Balance is up to ~60s stale relative to actual usage. A campaign can slightly
  overspend a reservation within that window. Accepted: reservations are sized
  with headroom, and the settle step reconciles.
- Two tables to reconcile. A discrepancy between the sum of charges and the sum
  of postings is a real bug class, and needs a reconciliation report.
- Money is `numeric` and must stay a string in JavaScript all the way to a
  decimal library. The int8 type parser in `packages/db/src/client.ts`
  deliberately does **not** convert `numeric` for this reason.

### Compliance — read before enabling settlements

Collecting money on behalf of another business and settling it later is payment
aggregation. Under the RBI PA/PG framework that generally requires either
authorisation, or routing through an authorised PA so the funds never sit in
our account.

**Before exam fees go live:**

- [ ] Legal opinion on whether the flow constitutes payment aggregation
- [ ] If yes: route through an authorised PA, or hold funds in an escrow/nodal
      account per the framework
- [ ] Settlement timelines (T+n) agreed and documented per institute
- [ ] GST treatment confirmed: on the platform fee, not the pass-through amount
- [ ] TDS handling on payouts
- [ ] Refund and chargeback flow defined end to end

Until these are closed, exam fees may run in **test mode only**.

## Alternatives considered

### Postpaid invoicing

No hard block, no reservations, much simpler. Also: unbounded credit risk on
prepaid messaging costs we pay upfront to Meta.

### Wallet updated per message

Simple and correct-looking. One hot row per tenant, and at campaign throughput
every worker queues behind it.

### Institute collects fees directly

Sidesteps the compliance question entirely, at the cost of the product being
able to show fee status in the application timeline. Worth reconsidering if the
compliance track proves long.

## Revisit when

The legal opinion lands. If aggregation is confirmed and authorisation is not
viable, the direct-collection model above becomes the fallback design.
