# Analytics Phase 0: benchmark and decision record

Run 2026-10-16 with `ANALYTICS_BENCH=1 vitest run --dir test/integration analytics-bench`
(`apps/api/test/integration/analytics/analytics-bench.spec.ts`). Spec: [event-based analytics design](../../superpowers/specs/2026-10-16-event-based-analytics-design.md).

## Method and limits of this measurement

- PostgreSQL 16 (`pgvector/pgvector:pg16`) in a testcontainer limited to **1 GB of memory and 2 CPUs**, `shared_buffers=256MB`, `max_connections=100`,
  the Hostinger production limits for the database container.
- Runs on a developer laptop: Windows 11, Docker Desktop, repo on OneDrive. Every query goes through Docker Desktop's loopback, so **one query round
  trip costs 0.79 ms (p50)**. A Postgres on the same Docker network as the API in production should be several times faster per round trip. Treat the
  absolute milliseconds below as an upper bound and the ratios as the signal.
- Synthetic data: 125,000 events over one hour from 200 workspaces (the design target of about 3M events a day is 125k an hour); rollup tables filled
  with 200 workspaces x 90 days (day grain) and x 14 days (hour grain), which is far denser than real tenants.
- Single connection for the write tests; reads are 200 sequential calls after a warm-up. Not a concurrency test.

## Results

| Measure                                                                      | Result            | Target                           |                                                              |
| ---------------------------------------------------------------------------- | ----------------- | -------------------------------- | ------------------------------------------------------------ |
| One query round trip, p50                                                    | 0.79 ms           | n/a                              | the unit the other numbers are made of                       |
| Business transaction without an event, p50 / p95                             | 7.5 / 11.1 ms     | n/a                              | 2 set_config + 1 insert + begin/commit = about 6 round trips |
| Writer overhead, **savepoint off**, p50 / p95                                | 1.2 / 1.3 ms      | p95 < 3 ms                       | pass                                                         |
| Writer overhead, **savepoint on**, p50 / p95                                 | 3.5 / 5.0 ms      | p95 < 3 ms                       | **miss on this setup**                                       |
| `recordMany` throughput (500 events per call, one connection)                | 12,266 events/s   | design target about 35/s average | pass by 300x                                                 |
| Roll up 125,000 events (one hour at target) from cold                        | 2.2 s in 6 slices | < 10 s                           | pass                                                         |
| Steady-state pass, 2,100 events (one minute at target)                       | 27 ms             | < 2 s                            | pass                                                         |
| `series` 30 days, day grain, one busy workspace, with a live tail: p50 / p95 | 16.5 / 21.3 ms    | p95 < 200 ms                     | pass                                                         |
| `series` 7 days, hour grain, grouped by event type: p50 / p95                | 22.4 / 28.3 ms    | p95 < 200 ms                     | pass                                                         |
| `an_events` size per event, with indexes                                     | 170 bytes         | spec estimated 130               | higher than estimated                                        |
| Rollup tables for the synthetic load (1.85M rows)                            | 375 MB            | n/a                              | about 200 bytes a row with the primary key                   |

## What the numbers mean

- **Storage.** At 170 bytes an event, the design target of 3M events a day is about 510 MB a day, **about 15 GB a month, about 31 GB for the 60-day hot
  window** (the spec said 12 GB and 24 GB). The retention engine (Part B of the plan) moves older months to compressed files. The VM's disk size is
  still unknown (decision D5).
- **Rollups are cheap.** A full hour of target traffic is folded in 2.2 s and a normal minute in 27 ms, so the 30 second pass is idle almost all the
  time. Reads are about 20 ms for a month because they touch a few hundred rollup rows plus a tiny tail.
- **The savepoint is the one real cost.** It adds three round trips to every event (savepoint, insert, release). Here that is about 2.3 ms; at
  production round-trip times it should be a fraction of that, but that has not been measured.

## Decision

1. **Keep `ANALYTICS_EVENT_SAVEPOINT` on (the default) for now.** It is the only thing between a mistake in an analytics call site and a failed
   business write: while building this benchmark I passed events for another workspace inside a tenant transaction, row-level security refused them,
   and the writer swallowed the errors and carried on. Without the savepoint that same mistake would have aborted the surrounding business
   transaction.
2. **Raise it as decision D7 for the owner** (spec section 13): measure the writer overhead on the real VM during Phase 1 staging, in the same
   benchmark. If the p95 overhead with the savepoint is above 3 ms there, switch the default to off and add the cheap checks in code (value
   ranges, workspace consistency with the request context) so the database errors it protects against can no longer happen.
3. No other target is missed, so no change is needed to the rollup design, the indexes or the rollup lag.

## Reproduce

```bash
cd crm-platform
pnpm --filter @crm/db --filter @crm/contracts build
cd apps/api
ANALYTICS_BENCH=1 node node_modules/vitest/vitest.mjs run --dir test/integration --testTimeout=900000 --hookTimeout=900000 analytics-bench
```

Docker must be running. The table of results is printed at the end of the run.
