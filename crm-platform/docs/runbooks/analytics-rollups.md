# Runbook: analytics events and rollups

What it is: [docs/architecture/analytics.md](../architecture/analytics.md). The worker folds `an_events` into `an_rollup_hour` and `an_rollup_day`
every 30 seconds; a nightly job (02:15 UTC) repairs yesterday's day rollups and trims hour rows older than 120 days.

## Is it healthy

```sql
-- how far behind the rollup is: should stay under about 90 seconds
SELECT extract(epoch FROM clock_timestamp() - recorded_before) AS age_seconds FROM an_rollup_state WHERE name = 'main';
-- rows in the catch-all partition must be 0 (it means partition maintenance fell behind)
SELECT count(*) FROM an_events_default;
-- hot event volume by month
SELECT date_trunc('month', recorded_at) AS month, count(*) FROM an_events GROUP BY 1 ORDER BY 1;
-- size of the analytics tables
SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class
 WHERE relname IN ('an_rollup_hour', 'an_rollup_day') OR relname ~ '^an_events_[0-9]{6}$' ORDER BY relname;
```

Log lines (worker): `analytics rollup watermark is stale` (age over 5 minutes), `analytics rollup pass failed`, `analytics rollup caught up`
(a pass ran several slices), `analytics rollup drift repaired` (the nightly job fixed rows), `analytics nightly job failed`. API and worker:
`analytics event not recorded` (a dropped event; see below).

## The watermark is stale

The worker is not running, is failing, or the database is slow.

1. Look for `analytics rollup pass failed` in the worker log and for the worker container itself. `ANALYTICS_ROLLUP_ENABLED=false` switches the pass off.
2. Check for a long-running transaction holding the advisory lock: `SELECT pid, state, query_start, query FROM pg_stat_activity WHERE query ILIKE '%an_events%' ORDER BY query_start;`
3. Nothing is lost while it is stale: events stay in `an_events` and the next pass catches up in slices of at most ten minutes of `recorded_at`.
   Reads keep working because they add the live tail of every event since the watermark; a long stall makes that tail large, so fix it soon.

## Events are being dropped

`analytics event not recorded` with an error. Common causes: a missing partition for the month (rows then land in `an_events_default`; check the
partition maintenance log), an out-of-range value, a `props` value that looks like personal data. The business write is never affected. After
fixing the cause, the nightly check on `messages` versus `an_events` (added with the first emitters in Phase 1) shows the size of the gap.

## A day looks wrong

The nightly job recomputes yesterday. To recompute another day, run from a worker shell: `RollupService.reconcile('YYYY-MM-DD')`. It looks at events
recorded from two days before that day, up to the watermark, replaces the day's rollup rows and returns how many it changed. Events that arrived
more than two days late are not re-verified. The lock it takes is the pass lock, so it waits for a running pass instead of racing it.

## A workspace changed its timezone

Hour and day buckets are written in the timezone the workspace had when the event was rolled up. History keeps its old buckets. To rebuild recent days
in the new timezone, reconcile each of them (`reconcile` recomputes with the current timezone); days older than the hot window of raw events (60 days)
cannot be rebuilt.

## Adding or changing a metric

See "Adding a metric" in the architecture note. Rollup rows are additive per slice, so changing a rule only affects events rolled after the change:
backfill or reconcile the days you need.
