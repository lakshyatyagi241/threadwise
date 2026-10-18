# Failed background work: find it and replay it

Three places hold work that ran out of retries. All three are visible and replayable through the operator API (`/v2/platform/async-ops/*`). Any active
operator can look; only a super admin can replay. Every replay is written to the security events with the operator and the counts. Nothing here returns a
message body or a phone number.

| What failed                                                                    | Where it waits                     | List                                | Replay                                    |
| ------------------------------------------------------------------------------ | ---------------------------------- | ----------------------------------- | ----------------------------------------- |
| An outbox event (billing charge, notification, flow trigger...) after 26 tries | `event_outbox`, `status = 'dead'`  | `GET outbox/dead` (grouped by type) | `POST outbox/replay` `{eventType, limit}` |
| A WhatsApp webhook payload after 10 tries (about 40 minutes)                   | BullMQ `waba-ingest`, failed set   | `GET waba-ingest/failed`            | `POST waba-ingest/replay` `{limit}`       |
| A Telegram, Viber, LINE or Facebook event that could not be stored             | BullMQ `webhook-retry`, failed set | `GET webhook-retry/failed`          | `POST webhook-retry/replay` `{limit}`     |

## The durable record (failed operations)

Every job that fails for good on `webhook-ingest`, `waba-ingest`, `webhook-retry`, `ecom-webhook` and `telephony-ingest` is written to `failed_operations`, with a sanitized code
and no payload. Strategy and states: [dlq strategy](../quality/dlq-strategy.md).

| Action                                    | Call                                                  | Who                 |
| ----------------------------------------- | ----------------------------------------------------- | ------------------- |
| List (filter by status, queue, open only) | `GET /v2/platform/failed-operations`                  | any active operator |
| One record with its event history         | `GET /v2/platform/failed-operations/:uuid`            | any active operator |
| Redrive one                               | `POST /v2/platform/failed-operations/:uuid/redrive`   | super admin         |
| Close without redriving (reason required) | `POST /v2/platform/failed-operations/:uuid/terminate` | super admin         |

A redrive is refused, with a code that says why, when the workspace is not active, the record is older than 30 days, it was redriven in the last minute, or it was already
redriven 3 times (it then goes to `ESCALATED`: read the error code, fix the cause, close it). `waba-ingest/replay` and `webhook-retry/replay` use the same check per job.

Alert on `crm_dead_letter_capture_failures_total > 0` (a record was not written; the job is still in the queue failed set and the sweep retries it), on
`crm_dead_letter_open` above zero for longer than your response time, and on `crm_dead_letter_oldest_open_seconds`.

## How the channel webhooks stay durable

Telegram, Viber, LINE and Facebook store a message inline. If that fails after the request was authenticated, the event is put on the `webhook-retry` queue
and the provider still gets its 200, as the Reference gave. The queue retries it for about 40 minutes (10 attempts from 5 seconds, doubling). A failure that a
retry cannot fix (an `AppError`: a rule the data broke) is acknowledged and logged, not retried. If even the queue is unreachable, nothing was kept, so the
webhook answers 503 and the provider redelivers. A 200 therefore always means the event is stored or queued.

## What replay does and does not do

- It only re-queues what is already stored. You name a type and a count, never a payload.
- Outbox replay flips `dead` rows to `pending` in one statement that locks them, so two operators or a double click never take the same row twice; a second
  call finds nothing. Events of a workspace that is suspended or deleted stay dead, and the answer says how many.
- Queue replay (`waba-ingest`, `webhook-retry`) retries only jobs that used all their attempts, with a fresh budget. Jobs that failed early were failed on
  purpose (a rule the data broke) and are skipped and counted.
- Replay cannot put an old event ahead of newer events of the same record that were processed meanwhile. Consumers must apply state forward-only or by upsert
  (see [idempotency audit](../quality/idempotency-audit.md)).
- A consumer runs again for every replayed event, so each must be safe to run twice. The audit lists how each one is.

## Alerting

The worker heartbeat publishes the dead count; `/health` shows `outbox.status = "dead_letters"` (and `outbox.dead`) when it is above zero, unless the outbox
is also lagging, which takes priority. Alert on any non-zero value. The failed queue sets have no count in `/health`; check `GET waba-ingest/failed` and
`GET webhook-retry/failed` when a message is reported missing.

## The dead-event index on a large table

`idx_outbox_dead` is created by a migration that waits at most 3 seconds for the lock and runs at most 30, so it can never stall writers for long: on a
small table it finishes in milliseconds. If it times out the table is big. Postgres does not allow `CREATE INDEX CONCURRENTLY` on a partitioned parent,
so build it partition by partition first (no write lock, safe to run again, rebuilds a piece an interrupted run left invalid), then run the migrations:

```bash
pnpm --filter @crm/db outbox-dead-index   # as the owner (MIGRATION_DATABASE_URL)
pnpm db:migrate                            # the migration is now a no-op
```

## Where the held data lives

- The `webhook-retry` job holds the channel event sealed with the credentials key (AES-256-GCM); Redis never holds the message text. The job is dropped
  when it completes and kept 3 days when it failed. A payload that cannot be opened (a key rotated away) is failed for good, not retried.
- The `waba-ingest` job is sealed the same way (a job queued before the change, with plain `changes`, is still worked). It is dropped on success
  and kept 3 days on failure.
- The order acknowledgement claim is two columns on the order (`wa_orders.ack_claimed_at`, `ack_sent_at`), so it survives a restart and a Redis flush.
  A claim whose worker died mid-send goes stale after 10 minutes and is taken again, which can at worst repeat the message once.
