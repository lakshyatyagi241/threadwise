---
name: outbox-event
description: >-
  Emit a new domain event through the transactional outbox, or add a consumer
  that reacts to one, in this CRM platform. Use this whenever a change needs
  to trigger a side effect — send a notification, update a counter, fire an
  automation, push a realtime update, notify an external system — or when
  asked to "fire an event when X happens", "notify when a deal closes", "add
  a webhook on status change". Never call a side effect directly from a
  service method after the write, and never publish to a queue inside a
  request handler — both create states where the row committed but the side
  effect didn't (or fired for a change that then rolled back). Always route
  it through the outbox.
---

# Outbox events

The rule in one line: **the event row is written in the same transaction as
the business change**, so "row committed" and "event exists" can never
disagree.

## Emitting an event

Inside an existing service method's transaction — never in a separate one:

```ts
await this.db.tx(async (tx) => {
  const deal = await this.repo.updateStage(tx, orgId, id, 'won');

  await this.audit.record(tx, { module: 'deals', recordId: deal.id, action: 'update' });

  await this.outbox.emit(tx, {
    aggregateModule: 'deals', // the module api_name
    aggregateId: deal.id, // internal bigint id, not uuid
    eventType: 'deal.won', // past tense, dotted
    payload: { uuid: deal.uuid, amount: deal.amount },
  });
});
```

`emit` takes the `tx`, not a database handle — deliberately, so it's
impossible to call outside the transaction it's supposed to be part of. If
you find yourself wanting to emit after the transaction closes, that's the
bug this design prevents, not an inconvenience to work around.

### Naming

`<aggregate>.<past-tense-verb>` — `contact.created`, `contact.stage_changed`,
`campaign.completed`, `wallet.low_balance`. Past tense because an event is a
record of something that already happened; a present-tense name (`send_email`)
is a command, and commands belong in a queue, not the outbox.

### Payload

Keep it small — identifiers and the few fields a consumer needs to decide
whether it cares. Not the whole row. Consumers that need the full record can
read it; a fat payload makes the outbox table grow fast and locks the event
schema to the table schema.

`emit` automatically attaches `_meta` (requestId, actorType, actorId) from the
request context, so don't hand-add those.

## What belongs in the outbox — and what doesn't

**Yes:** record CRUD, conversation lifecycle, campaign lifecycle, application
status changes, wallet postings. Things where a handful of events per
business action is the right volume.

**No:** individual messages and delivery receipts. At the design target of
5 lakh messages/day those would bury the drain, and they already have a
durable log of their own in `messages` / `message_events`. Those tables are
explicitly exempt from the outbox and audit triggers.

If unsure: would this event fire more than a few times per user action? If
yes, it probably belongs in its own stream table, not the outbox.

## Adding a consumer

Consumers run in the worker process. Today `OutboxDrainService.dispatch()`
(in `apps/api/src/workers/outbox-drain.service.ts`) only logs — it's the
fan-out point where subscribers get wired in.

Two non-negotiables for any consumer:

1. **Idempotent.** Delivery is at-least-once. The same event WILL be
   delivered twice at some point (a worker dies between doing the work and
   marking the row done). A consumer that sends an email must not send two.
2. **Failures are isolated.** One subscriber throwing must not prevent the
   others from seeing the event. Don't let a single `await` chain take down
   the whole dispatch.

Retry/backoff/dead-lettering is already handled by the drain loop —
exponential backoff via `available_at`, dead-lettered after 8 attempts, so a
poison event can't stall the queue behind it. Don't build a second retry
layer inside a consumer.

## If the work is heavy

The outbox drain should stay fast. A consumer that needs to do real work
(send thousands of messages, generate a PDF, call a slow API) should enqueue
a BullMQ job rather than doing it inline — invoke the `worker-job` skill for
that.

## Before finishing

Emitting a new event type is usually not an architectural decision, but
**adding a new consumer that changes system behavior can be**. If the event
introduces a new cross-module dependency or a new external side effect,
say so in the PR description.

Then run the gate — invoke the `pre-pr` skill.
