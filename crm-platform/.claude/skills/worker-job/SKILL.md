---
name: worker-job
description: >-
  Add a background job, scheduled task, or queue processor to this CRM
  platform's worker process — BullMQ queue + processor, or a @Interval/@Cron
  service. Use this whenever work shouldn't happen inside an HTTP request:
  sending a campaign, rolling up billing charges, sweeping SLA deadlines,
  flushing counters, bulk import/export, partition maintenance, retrying
  anything, or any task described as "in the background", "on a schedule",
  "every N minutes", "async". Never do slow or bursty work inline in a
  controller or service that a request is waiting on, and never register a
  processor in the API process — it belongs in the worker.
---

# Background jobs

The API and worker are the same image with different entrypoints
(`main.ts` vs `worker.ts`). The API only ever **enqueues**; processors are
registered only in the worker, so an HTTP pod never picks up a job it
shouldn't be running.

## Pick the right mechanism

| Need                                    | Use                         | Example in repo               |
| --------------------------------------- | --------------------------- | ----------------------------- |
| React to a domain event                 | outbox consumer             | `OutboxDrainService`          |
| Work triggered by a request, done later | BullMQ queue + processor    | campaign send                 |
| Runs on a clock, no trigger             | `@Interval` / `@Cron`       | `PartitionMaintenanceService` |
| Poll a database table for work          | `@Interval` + `SKIP LOCKED` | `OutboxDrainService`          |

If it's reacting to a business change, the trigger should be an outbox event
— invoke the `outbox-event` skill first, then come back here for the heavy
lifting part.

## Queues are declared centrally

All queue names live in `apps/api/src/infra/queue/queues.ts` — add yours
there, don't inline a string:

```ts
export const QUEUES = {
  // ...
  MY_NEW_QUEUE: 'my-new-queue',
} as const;
```

Queues are split **by failure domain**, not by convenience. A stuck WhatsApp
provider must not delay wallet postings; a slow LLM call must not hold up
delivery-receipt ingestion. If your new work can fail independently of
everything else, it gets its own queue.

`DEFAULT_JOB_OPTIONS` (retries, exponential backoff, bounded
removeOnComplete/removeOnFail) already applies — don't redefine retry logic
per-queue unless this queue genuinely needs different semantics, and say why
in a comment if so.

## Writing a processor

Register it in `apps/api/src/workers/workers.module.ts` — that module is
imported **only** by `worker.ts`, never by `app.module.ts`.

The patterns that matter, all visible in `OutboxDrainService`:

**Guard against overlapping runs.** An `@Interval` keeps firing whether or
not the previous pass finished:

```ts
@Interval(2_000)
async run(): Promise<void> {
  if (this.running) return;   // without this, a slow batch piles up on itself
  this.running = true;
  try { /* ... */ } finally { this.running = false; }
}
```

**Claim work with `SKIP LOCKED`** if polling a table — it lets N workers run
the identical query with no coordination, no leader election, no distributed
lock:

```sql
SELECT ... FROM my_table
WHERE status = 'pending' AND available_at <= now()
ORDER BY created_at, id
LIMIT 200
FOR UPDATE SKIP LOCKED
```

**Jobs carry ids, not objects.** Payloads stay small; the processor re-reads
what it needs.

**Tenant context is explicit.** A worker has no request context, so
`DatabaseService.tx()` won't work — use `txAs({ orgId })` with the org from
the job payload, or `privileged()` if the work genuinely spans tenants (the
outbox drain, billing roll-ups, partition maintenance). Getting this wrong
means either a crash or, worse, a query that silently sees nothing.

**Idempotent.** BullMQ retries, and a worker can die mid-job. Doing the work
twice must be harmless.

## Don't starve the event loop

The whole reason the worker is a separate process is that a campaign burst
must not add latency to API requests. Keep that property inside the worker
too: a tight loop over 500k rows with no `await` breathing room blocks
everything else in that process.

## Before finishing

Invoke the `pre-pr` skill. If the new job changes an operational
characteristic someone would need to know about during an incident (a new
queue that can back up, a new failure mode), add or update a runbook in
`docs/runbooks/` — `outbox-backlog.md` is the model for what that looks
like.
