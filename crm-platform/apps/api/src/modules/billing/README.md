# Billing & Payments

Not implemented yet. Structure to follow when it lands:

```
billing/
  wallet/           balance, reserve, release, settle
  rate-cards/       per-org, per-unit-type pricing
  metering/         usage_charges writer + roll-up worker
  payments/         Easebuzz init + webhook
  settlements/      institute payouts
  billing.module.ts
  index.ts
```

## Two-level ledger — the core idea

| Level | Table                 | Volume                                  | Purpose               |
| ----- | --------------------- | --------------------------------------- | --------------------- |
| 1     | `usage_charges`       | one row per billable unit (~5 lakh/day) | metering, evidence    |
| 2     | `wallet_transactions` | one row per ~60s per org                | actual money movement |

A worker rolls unposted charges into a single wallet posting per org per
minute. Writing to the wallet per message would put every send in the tenant
behind one row lock — this is the single most important performance decision in
the billing design.

## Invariants (enforced in the database, not just in code)

- `balance >= 0`
- `reserved >= 0`
- `reserved <= balance`
- available balance = `balance - reserved`

Every spend is a conditional UPDATE. **Zero rows affected = blocked.** There is
no read-then-write check anywhere; that pattern loses the race under
concurrency.

## Rates are frozen at charge time

`usage_charges.unit_rate` is copied from the rate card when the charge is
written. Changing a rate card never rewrites history — an invoice from last
month must still reconcile next year.

## Compliance

Exam fees mean we hold money belonging to an institute before settling it.
That carries an **RBI PA/PG compliance track** — see
[ADR-0012](../../../../../docs/adr/0012-payments-and-settlements.md). The schema
is ready; do not switch on real settlements until that is signed off.
