# ADR-0029: Idempotency: the rule for repeated requests, retried jobs and redelivered events

- **Status:** proposed
- **Date:** 2026-10-14
- **Deciders:** Vishal (QA task 71); Lakshya owns the async review (#68 to #72) and should confirm the Redis-outage decision

## Context

Three things repeat work in this system, and each needs the same promise: doing it twice must look like doing it once.

1. **Clients retry.** A request times out, the client sends it again. A person double-clicks.
2. **Queue jobs retry.** BullMQ re-runs a job after a failure, a stalled worker, or a crash between the side effect and the acknowledgement.
3. **Outbox events are delivered at least once.** `OutboxSubscriberRegistry.dispatch` re-delivers an event to every matching subscriber when any one of them fails.

The pieces exist (the `@Idempotent()` HTTP interceptor, provider message-id claims, ledgers, unique indexes) but the rule was only written in code comments, and
`docs/quality/idempotency-audit.md` is the first complete list of who follows it.

## Decision

### 1. HTTP: the `Idempotency-Key` header

- **Which routes.** Any `POST` that creates a record, sends a message, moves money or enqueues work carries `@Idempotent()`. Routes that are safe by state (a
  status change to a value) or protected by a unique rule may leave it off, and say why in the audit. A ratchet test
  (`test/e2e/double-submit/inventory.e2e.spec.ts`) fails when a new `POST` has neither.
- **Optional today.** Without the header the route behaves as before. The header becomes **mandatory** on money-moving routes (wallet top-up, payment, public
  invoice pay) in a separate change once clients send it. Until then those routes must be safe without it (a unique rule, or a provider reference).
- **Scope of a key.** organisation + actor + HTTP method + path + key. The same key on another route, or from another actor, is a different operation and runs on
  its own; it never receives, or blocks on, someone else's reply.
- **Lifetime.** A finished reply is kept 24 hours. A key reserved by a request that is still running is held for **5 minutes** (not 24 hours), so a crash mid-request
  does not lock the key for a day.
- **Behaviour on a repeat** (same organisation, actor, method, path and key):
  - same body, first request finished: the stored reply is replayed verbatim (same status class, same body);
  - first request still running: `409 CONFLICT` ("still in flight");
  - **different body: `409 IDEMPOTENCY_KEY_REUSED`**, nothing is executed. This matches the code and the API docs (`chat-conversations`, `team-inbox-conversations`
    use the same code). The IETF draft says 422 here; we keep 409 so one code means one thing across the API. Revisit only if a client library needs 422;
  - first request failed: the key is released, a corrected retry runs normally.
- **Body comparison** is a SHA-256 of `JSON.stringify(body)`, so two bodies that differ only in key order count as different. That errs on the safe side (refuse).
  Clients should send a stable serialisation.
- **Only successes are replayed.** An error is never stored.

### 2. Queue jobs

Every processor must be safe to run twice with the same payload, by one of: a **natural key** (unique index or `ON CONFLICT`, a provider message id claimed before the
send), a **ledger** (a status row moved with `UPDATE ... WHERE status = 'pending'`, so only one worker wins), or a **naturally idempotent write** (set to a value, upsert).
"It probably will not run twice" is not a mechanism. Producers enqueue with a deterministic `jobId` (`<kind>:<natural id>`) so enqueueing twice is also a no-op. A
processor that sends to a customer or moves money records the claim **before** the external call and the result after, and treats "claim exists, result missing" as
"ask the provider" rather than "send again".

### 3. Outbox subscribers

`handle(event)` is keyed by `event.id`, which is stable across redeliveries. Safe means one of: a unique key that includes the event id or the domain key the event
describes; a row in a processed-events ledger written in the same transaction as the effect; or a state write that gives the same result when repeated. A subscriber that
cannot meet this for an external effect enqueues a job with `jobId = <subscriber>:<event.id>` and lets the queue's rule (section 2) carry it.

### 4. Cache and Redis

- Every Redis key written for idempotency has a TTL (24 hours for a reply, 5 minutes for an in-flight reservation) and holds a reply body. Replies are not size-capped
  today (the 100 KiB limit applies to requests, not responses): a route that returns a large body under a key stores all of it for a day. Open item: cap the stored
  reply and skip storing above the cap.
- **When Redis is down the idempotent routes fail closed.** The reservation `SET` throws and the request returns a 5xx before the handler runs, so nothing is created
  without protection. This is deliberate for create, send and money routes. A read-only or state-only route would not use the decorator.
- Failing to store the reply after a success is logged and the 5-minute reservation expires, so a retry after that window runs again. For routes whose effect is not
  itself protected (a send), that is the one remaining gap; the processors and subscribers under them are expected to be safe on their own (sections 2 and 3).

## Consequences

- The tests in `test/e2e/double-submit` pin sections 1 and 4. `docs/quality/idempotency-audit.md` lists every subscriber and processor with its mechanism and the ones
  that still need a fix.
- D-01 of the Phase 1 report (a reused key answered with the first reply) was closed by the slot-and-fingerprint rule that is now in the interceptor; the expected-failure
  test was replaced by two ordinary tests.
- Not decided here: which routes become mandatory-key, and whether the in-flight window should be per-route.
