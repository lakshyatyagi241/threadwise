# ADR-0010: BullMQ on Redis, worker as a separate process from the same image

- **Status:** accepted
- **Date:** 2026-09-16

## Context

Background work at the design target: outbox drain, 2–5 lakh outbound messages
a day with per-campaign throttling, 1–3 lakh inbound webhooks, billing roll-ups
every ~60s, SLA sweeps, counter flushes every 2–5s, bulk import/export.

Some of that is bursty by nature — a campaign start is a spike.

## Decision

**BullMQ on Redis** for queueing. **A separate process** for processing,
started from the same image with a different entrypoint:

```
node dist/src/main.js      # HTTP + WebSocket
node dist/src/worker.js    # BullMQ processors + schedulers, no HTTP listener
```

`worker.ts` builds its own Nest module: config, db, redis, queue, providers,
kernel, workers. No controllers, no guards, no HTTP server.

Queues are split by failure domain (`queues.ts`): a stuck WhatsApp provider must
not delay wallet postings.

## Consequences

### Positive

- A campaign burst cannot starve HTTP latency — different process, different
  event loop.
- API and worker scale independently: one API pod and three workers during a
  campaign, or the reverse during business hours.
- One image, one build, one copy of the domain logic. No duplicated services.
- BullMQ gives rate limiting (exactly what `throttle_per_min` needs), delayed
  jobs, retries with backoff, and a dead-letter path.

### Negative

- Redis is now critical infrastructure, not a cache. `maxmemory-policy` is set
  to `noeviction` because evicting job state loses jobs.
- Two processes to deploy, monitor and restart in the right order.
- Job payloads must stay small — pass ids, not objects.
- Local development needs both running to see end-to-end behaviour.

### Neutral

- The outbox drain is a `@Interval` poller rather than a BullMQ job, because its
  work queue is a database table. It still lives in the worker process.

## Alternatives considered

### pg-boss (jobs in Postgres)

One less service, and transactional enqueue for free. Rejected on throughput
and on rate limiting: at 5 lakh jobs/day the polling load competes with OLTP
traffic on the same database, and per-queue rate limiting would be hand-rolled.

### Workers in the API process

Simplest to operate, and the first campaign spike shows up as p99 latency on
every API request.

### Temporal

Genuinely better for long-running campaign and settlement sagas. A whole
additional system to run, learn and upgrade — not for v1 with two engineers.

## Revisit when

Campaign orchestration grows real saga semantics (multi-day drips with
compensation). That is Temporal's actual strength, and the queue abstraction in
`queues.ts` is where the swap would happen.
