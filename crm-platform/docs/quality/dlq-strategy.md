# Dead-letter strategy: failed background work

Why: a webhook the provider already got our 200 for exists, once the request returns, only as a queue job. If that job exhausts its retries, BullMQ keeps it for
3 days and then it is gone. This change makes every such failure a durable, tenant-scoped record that an operator can inspect and redrive one at a time.

## Which queues record a failure

Only queues where the job is the only copy of work (the policy lives in `apps/api/src/modules/failed-operations/failure-policy.ts`, version `dlq-policy-1`):

| Queue              | Priority | Why it is recorded                              | Workspace known at capture                   |
| ------------------ | -------- | ----------------------------------------------- | -------------------------------------------- |
| `webhook-ingest`   | P0       | channel messages and receipts                   | yes (`orgId`)                                |
| `waba-ingest`      | P0       | WhatsApp webhook payload (sealed)               | no, routed from the phone number when worked |
| `webhook-retry`    | P0       | channel event that could not be stored (sealed) | no                                           |
| `ecom-webhook`     | P1       | store webhook, cart step                        | yes                                          |
| `telephony-ingest` | P1       | finished-call callback                          | yes                                          |

Queues whose state lives in a table (broadcast recipient, outbound message, export) record their own failure and are deliberately not listed. Queues that can be
re-read from the source (syncs) lose nothing by failing. Not-yet-assessed queues are in the backlog below.

## How a failure becomes a record

- A worker hook (Discovery over `WorkerHost`, same pattern as the job metrics) sees BullMQ's `failed` event. BullMQ emits it on every attempt, so the hook records
  only a **final** failure: attempts used up, or an `UnrecoverableError`.
- The record holds ids, queue, a failure category, a stable sanitized error code, an attempt count and a payload hash. The payload stays in the job, sealed where it
  was sealed. The error text goes through `common/errors/sanitize-error.ts`: secrets, tokens, phone numbers and e-mail addresses never reach the table.
- Capture is idempotent on (queue, original job id). If the database is down at that moment, a reconcile sweep re-reads the queue failed set and records what is missing, so
  capture survives a DB outage and a worker crash. `crm_dead_letter_capture_failures_total` counts the writes that failed.
- `failed_operations` is a platform table: forced RLS, readable and writable only by the privileged role. Operators reach it through the API only.

## States

`OPEN`, `BLOCKED`, `RECONCILIATION_REQUIRED`, `READY_FOR_REDRIVE`, `REDRIVING`, `RESOLVED`, `TERMINAL` (closed by an operator), `ESCALATED`. A record starts `OPEN`, or
`BLOCKED` when the failure was on purpose (unrecoverable). Every transition is an append-only row in `failed_operation_events`.

## Redrive (one operation, never a batch)

`POST /v2/platform/failed-operations/:uuid/redrive` (super admin). The decision (`recovery-decision.ts`, a pure function with its own spec) refuses when: the workspace is
suspended or deleted, the record is already resolved, the payload version is older than the code, the record is older than 30 days, the replay cap (3) is reached (it
escalates to a person instead of looping), the cooldown (60 s) has not passed, or an ambiguous outcome needs an acknowledgement. The claim is a compare-and-swap on `row_version`, so two
operators never both win. The replay job id is `dlq-<uuid>-<n>`, so a double submit cannot enqueue twice; if enqueueing fails, the claim is reverted.

The old count-based replay of `waba-ingest` and `webhook-retry` (`POST async-ops/*/replay`) now records each failed job and goes through the same decision, so it can no longer
reset attempts and skip every check.

## Signals

| Metric                                           | Meaning                                                    |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `crm_dead_letter_captured_total{queue,category}` | final failures recorded                                    |
| `crm_dead_letter_capture_failures_total`         | a record could not be written; alert on any non-zero value |
| `crm_dead_letter_open{queue}`                    | unresolved records                                         |
| `crm_dead_letter_oldest_open_seconds{queue}`     | age of the oldest unresolved record                        |

## Backlog (not done here)

- Bulk redrive and an operator screen (the API is the interface for now).
- Reconciliation state for outbound sends whose outcome is unknown (DF-08): needs an owner decision on the provider lookup per channel.
- A tenant status gate for `waba-ingest` at capture (the workspace is not known until the payload is worked; the redrive checks it once known).
- A completed original job after a provider redelivery does not close its record automatically.
- Retention job for old records, the failed-operations count in the worker heartbeat and `/health`, a daily report, and CI gates.
- Queues not yet assessed: channel broadcasts, scheduled runs, contact import, segment actions, pinnacle, WhatsApp migration.
