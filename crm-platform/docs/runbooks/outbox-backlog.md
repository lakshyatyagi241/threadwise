# Runbook: outbox backlog

**Symptom:** automations are not firing, counters are stale, notifications are
not arriving. Everything else looks fine.

The outbox is the backbone of eventual consistency. When its drain stops, the
business data is still correct — the side effects just never happen. That makes
this a quiet failure, which is why it needs monitoring rather than luck.

## 1. Confirm

```sql
SELECT status, count(*), min(created_at) AS oldest
FROM event_outbox
GROUP BY status;
```

| Reading                                     | Meaning                       |
| ------------------------------------------- | ----------------------------- |
| `pending` growing, `oldest` far in the past | drain is stopped or too slow  |
| `processing` non-zero and not moving        | a worker died mid-batch       |
| `dead` climbing                             | events are failing repeatedly |

## 2. Is the worker alive?

```bash
docker compose -f docker-compose.prod.yml ps worker
docker compose -f docker-compose.prod.yml logs --tail=200 worker
```

`OutboxDrainService` logs `outbox batch drained` at debug level whenever it
processes anything. Silence means it is not running, or it is running and
finding nothing.

## 3. Common causes

### Worker not running

Most common. Restart it:

```bash
docker compose -f docker-compose.prod.yml up -d worker
```

### Rows stuck in `processing`

A worker was killed between claiming a batch and finishing it. Those rows are
claimed but nobody owns them.

```sql
-- Inspect first
SELECT id, created_at, event_type, org_id
FROM event_outbox
WHERE status = 'processing' AND created_at < now() - interval '15 minutes';

-- Then release
UPDATE event_outbox
SET status = 'pending', available_at = now()
WHERE status = 'processing' AND created_at < now() - interval '15 minutes';
```

Safe because consumers are required to be idempotent (at-least-once delivery).

### A poison event

One event fails every attempt and burns retries.

```sql
SELECT event_type, count(*), max(last_error) AS example
FROM event_outbox
WHERE status IN ('pending','dead') AND attempts > 3
GROUP BY event_type
ORDER BY count(*) DESC;
```

Backoff is `2^attempts` seconds capped at 15 minutes with jitter (a random point
in the upper half), dead-lettered at 26 attempts (2 to 4 hours of retrying,
`workers/outbox-retry-policy.ts`) — so a poison event cannot block the queue
behind it indefinitely, and an outage of a few hours does not lose events. The
worker heartbeat publishes the `dead` count (`/health` outbox check, field
`dead`); alert on any value above 0. Fix the consumer, then re-queue:

```sql
UPDATE event_outbox
SET status = 'pending', attempts = 0, available_at = now(), last_error = NULL
WHERE status = 'dead' AND event_type = 'the.broken.event';
```

### Rows landed in the default partition

If partition maintenance fell behind, new rows go to `event_outbox_default`.
Queries still work but partition pruning does not, and new partitions cannot be
created for those ranges.

```sql
SELECT count(*) FROM event_outbox_default;
```

Non-zero → run partition maintenance, then move the rows into their proper
partitions during a quiet window.

### Drain keeping up but too slow

Batch is 200 every 2 seconds ≈ 360k/hour. If the backlog still grows, run more
worker containers — `SKIP LOCKED` means they cooperate with no extra
configuration.

## 4. After the incident

- Is `pending` count alerted on? It should be. Threshold: > 10k, or oldest
  pending > 10 minutes.
- Is `event_outbox_default` count alerted on? Threshold: > 0.
- Did the consumer that failed need to be idempotent and wasn't?

## Prevention

| Signal                            | Threshold    |
| --------------------------------- | ------------ |
| `event_outbox` pending count      | > 10,000     |
| Oldest pending event age          | > 10 minutes |
| `status = 'dead'` count           | > 0          |
| Rows in any `*_default` partition | > 0          |
| Worker process up                 | continuous   |
