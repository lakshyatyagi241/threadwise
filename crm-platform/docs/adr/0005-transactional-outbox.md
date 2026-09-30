# ADR-0005: Transactional outbox, not event sourcing

- **Status:** accepted
- **Date:** 2026-09-16

## Context

Business changes must trigger side effects: automations, notifications,
counters, realtime updates, analytics. The classic failure is a change that
commits while its notification is lost, or a notification that fires for a
change that later rolled back.

Separately: "who changed what" must be answerable for compliance and for
commission disputes.

## Decision

Two mechanisms, deliberately separate.

**1. Transactional outbox** for side effects. The event row is inserted in the
same transaction as the business change:

```ts
await this.db.tx(async (tx) => {
  const contact = await this.repo.insert(tx, orgId, values);
  await this.outbox.emit(tx, { aggregateModule: 'contacts', eventType: 'contact.created', ... });
});
```

A worker drains `event_outbox` with `FOR UPDATE SKIP LOCKED`, retries with
exponential backoff, and dead-letters after 8 attempts.

**2. Append-only audit log** for history. The business tables remain the source
of truth; `audit_log` records the field-level diff.

This is **not** event sourcing. State is never rebuilt from events.

## Consequences

### Positive

- "Row committed" and "event exists" cannot diverge. No two-phase commit, no
  message broker in the write path.
- `SKIP LOCKED` lets N workers run the same claim query with no coordination —
  no leader election, no distributed lock.
- The current state is a plain `SELECT`. No projections to rebuild, no replay
  to reason about, no schema-versioned event history to migrate.

### Negative

- Delivery is at-least-once. Every consumer must be idempotent. This is a real
  ongoing tax on every subscriber that gets written.
- The outbox is a table that grows; it is partitioned monthly and processed
  rows are dropped with their partition.
- Polling adds latency (~2s) and constant database load. Acceptable here;
  `LISTEN/NOTIFY` is the upgrade path if it stops being.

### Neutral

- Ordering is per-partition by `(created_at, id)`, not globally strict.
  Consumers that need ordering per aggregate must handle it themselves.

## What goes in the outbox

**Yes:** record CRUD, conversation lifecycle, campaign lifecycle, application
status changes, wallet postings.

**No:** individual messages and delivery receipts. At 5 lakh messages/day those
would bury the drain, and they already have a durable log of their own in
`messages` / `message_events`. Those tables are explicitly exempt from the
outbox and audit triggers — they _are_ the log.

## Alternatives considered

### Event sourcing

Full audit by construction and time travel. Also: every query becomes a
projection, every schema change becomes an event migration, and debugging
requires replay. Far too much machinery for a CRM whose users expect a row to
be a row.

### Publish to a broker inside the transaction

The classic dual-write bug. The broker accepts the message, the transaction
rolls back, and now there is an event for something that never happened.

### Database triggers publishing directly

Side effects inside a trigger hold the transaction open across a network call.
One slow consumer and writes stall.

## Revisit when

2s polling latency becomes user-visible, or the drain cannot keep up with a
single worker — first move is `LISTEN/NOTIFY` to wake the drain, keeping the
same table.
