# Scale design

The numbers the schema is built for, and the specific decisions each one drives.

## Target volumes

| Flow                  | Volume                                  |
| --------------------- | --------------------------------------- |
| Outbound messages     | 2–5 lakh/day (200k–500k)                |
| Inbound messages      | 1–3 lakh/day (100k–300k)                |
| `messages`            | 10–25M rows/month                       |
| `message_events`      | 2–4× that (every status transition)     |
| `usage_charges`       | one row per billable unit — ~5 lakh/day |
| `campaign_recipients` | 2–5 lakh/day                            |

Today's actual load is ~15–20 leads/day. The schema is built for the target
because retrofitting partitioning onto a large table means a rewrite under
lock — the cheapest time to partition is before there is any data.

## Partitioning

### Time-range, monthly — streams

`messages`, `message_events`, `campaign_recipients`, `usage_charges`,
`event_outbox`, `audit_log`, `workflow_executions`, `notifications`,
`ai_usage_events`.

These are append-only and read by time. The primary key is `(id, created_at)`
because Postgres requires the partition key in every unique constraint.

Partitioned tables cannot own an identity sequence, so they use an explicit one:

```sql
CREATE SEQUENCE event_outbox_id_seq;
CREATE TABLE event_outbox (
  id bigint NOT NULL DEFAULT nextval('event_outbox_id_seq'),
  ...
) PARTITION BY RANGE (created_at);
```

**Retention is dropping a partition**, not deleting rows. `DROP TABLE
messages_202601` is instant; `DELETE FROM messages WHERE created_at < ...` is
hours of I/O plus bloat plus a vacuum.

### Hash by `org_id` (64 buckets) — entities

Planned for `contacts`, `records` and other high-cardinality entity tables.
Additive, because `org_id` is already first in every primary key and index.

### Whale tenants

`organizations.tier = 'whale'` escalates a tenant to dedicated,
time-subpartitioned partitions, so one very large customer does not degrade
scans for everyone sharing their hash bucket.

## Partition maintenance

`PartitionMaintenanceService` runs at boot and daily at 02:00, creating
partitions **three months ahead**. It finds the tables itself by reading
`pg_partitioned_table` (RANGE parents in `public`), so a new stream needs no
code change. The worker role cannot create tables itself, so creation goes
through `ensure_monthly_partition()`, a `SECURITY DEFINER` function that
validates its arguments.

A missing partition is not a slow query — it is a failing INSERT, which means
dropped audit rows and a stalled outbox. Three months of runway means the job
can be broken for weeks before it wakes anyone up.

Every partitioned table also has a `DEFAULT` partition as a catch-all. Rows in
it mean maintenance fell behind. The job ends each pass by counting them
(`defaultPartitionCounts()`) and logs a `rows in default partitions` warning for
any table where the count is non-zero.

A non-empty default partition also blocks creating new partitions for the
ranges it covers, so it must be drained, not ignored.

## Hot-row avoidance

Three places where the obvious implementation serialises the whole tenant
behind one row lock:

| Counter           | Naive                                                                   | What we do                                     |
| ----------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| Campaign counters | `UPDATE campaigns SET sent_count = sent_count + 1` per delivery receipt | batch flush every 2–5s                         |
| Wallet balance    | one `wallet_transactions` row per message                               | roll charges into one posting per org per ~60s |
| Display IDs       | `UPDATE sequence_counters` per insert                                   | claim 100 at a time                            |

At 5 lakh messages/day the naive versions do not merely get slow — every worker
queues behind the same row, and throughput collapses to one write at a time.

## Concurrency patterns

**Claim work without coordination:**

```sql
SELECT id, created_at FROM event_outbox
WHERE status = 'pending' AND available_at <= now()
ORDER BY created_at, id
LIMIT 200
FOR UPDATE SKIP LOCKED
```

N workers run the identical query. `SKIP LOCKED` means none of them blocks on,
or double-processes, another's rows. No leader election, no distributed lock.

**Conditional update instead of read-then-write:**

```sql
UPDATE exam_slots SET booked_count = booked_count + 1
WHERE org_id = $1 AND id = $2 AND booked_count < capacity
```

Zero rows affected = the slot filled while the candidate was deciding. The
read-then-check version loses this race, and the symptom is an oversold exam
centre.

## Indexing

- **Partial indexes** on the hot path: `WHERE is_archived = false`,
  `WHERE status = 'pending'`. Processed and archived rows drop out of the index
  instead of bloating it.
- **Composite indexes lead with `org_id`**, so the RLS predicate is
  index-friendly rather than a filter applied after the fact.
- **Keyset pagination** on `(created_at, id)`.
- **Expression indexes on JSONB**, created `CONCURRENTLY` and governed by
  `field_indexes`.

## Where this design stops

Live analytics queries. Reporting over 25M rows/month does not belong on the OLTP
database regardless of how it is indexed. The decision (2026-10-16) is an event
stream with incremental rollups in the same PostgreSQL, not CDC into ClickHouse
and not `metric_counters`: see [analytics.md](analytics.md) and
[the design](../superpowers/specs/2026-10-16-event-based-analytics-design.md).
ClickHouse stays a later swap behind `AnalyticsQueryService` if Postgres stops
being enough. The sub-5-second numbers (unread badges, wallet balance) remain
live counters.

## Ceilings to watch

| Signal                         | Threshold     | Next move                                       |
| ------------------------------ | ------------- | ----------------------------------------------- |
| Rows in a `_default` partition | > 0           | fix partition maintenance                       |
| Outbox backlog                 | > 10k pending | more workers, or LISTEN/NOTIFY                  |
| p99 write latency              | > 100ms       | check hot rows and index bloat                  |
| One tenant > 20% of a table    | —             | promote to `tier = 'whale'`                     |
| Database size                  | > 500GB       | separate the database host; consider CDC sooner |
