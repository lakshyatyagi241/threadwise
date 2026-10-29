# Database and route alerts (Sheet 3 D-04, D-05)

Alerts that tell the team channel when a query, a route or the database pool is slow. They reach Google Chat through Alertmanager and the
bridge ([google-chat-alerts.md](google-chat-alerts.md)). Each alert has an owner label and a link to this page.

| Alert                    | Fires when                                                                                    | Owner  | File                                              |
| ------------------------ | --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------- |
| `SlowQueryMeanOver120ms` | a statement averaged 120 ms or more per call over the last 5 minutes (at least 3 new calls)   | vedant | `deploy/observability/slow-query.rules.yml`       |
| `RouteLatencyP95High`    | a route's p95 is over 120 ms for 10 minutes, counting only routes with 50+ requests in 15 min | vedant | `deploy/observability/p0-failure-modes.rules.yml` |
| `ApiHighErrorRate`       | more than 5% of a service's requests answer 5xx for 5 minutes                                 | vedant | `deploy/observability/p0-failure-modes.rules.yml` |
| `DbPoolSaturated`        | a DB pool is at its maximum with no idle connection for 2 minutes                             | vedant | `deploy/observability/webhook-ingest.rules.yml`   |
| `DbPoolExhausted`        | callers have waited for a pool connection for 3 minutes                                       | vedant | `deploy/observability/p0-failure-modes.rules.yml` |

`ApiHighErrorRate` and `DbPoolExhausted` have their own sections in [p0-failure-modes.md](p0-failure-modes.md#apihigherrorrate).

## SlowQueryMeanOver120ms

**What it measures.** The slow-query watcher (`tools/chat-bridge/watcher.mjs`) reads `pg_stat_statements` every 15 seconds with a
read-only role and keeps snapshots for 5 minutes. For each statement it divides the new total time by the new calls between the oldest
snapshot in the window and now. It publishes `crm_slow_query_window_statements_over` (how many statements are at 120 ms or more) and
`crm_slow_query_window_mean_max_seconds` (the worst). Statements with fewer than 3 new calls, maintenance statements (vacuum, copy,
migrations, backups) and statements the activity pass excluded are left out. The thresholds are `SLOW_WINDOW_MEAN_MS` (120),
`SLOW_WINDOW_SECONDS` (300) and `SLOW_WINDOW_MIN_CALLS` (3) in the bridge's environment.

**It fires about two minutes after the calls**: up to 15 s for the next poll, one scrape, and `for: 1m`.

**First look.**

1. The watcher logs `slow_statement_window_mean` with the five worst statements (mean, calls, normalized text). Find it in the bridge
   container's log: `docker logs --since 10m desk-gchat-bridge | grep slow_statement_window_mean`.
2. The same statement usually has a card in Slow Queries & Warnings with a plan hint.
3. In `psql` as the read-only role: `select calls, mean_exec_time, max_exec_time, left(query, 120) from pg_stat_statements order by total_exec_time desc limit 20;`
4. Plan: `EXPLAIN (ANALYZE, BUFFERS)` on staging with the same parameters. A sequential scan on a large table or a sort spilling to disk is the usual cause.

**Not a defect**: a one-off import or report that ran a few times is expected to trip it once. If it keeps firing for a named statement
that is fine by design, add the statement to `SLOW_EXCLUDE_STATEMENT_REGEX`, and write down why.

**Prove it end to end** (local or staging, nothing is changed):

```bash
# 1. the bridge watcher points at the database with pg_stat_statements loaded (SLOW_PG_URL), then:
psql "$DATABASE_URL" -c "select pg_sleep(0.3)" -c "select pg_sleep(0.3)" -c "select pg_sleep(0.3)" -c "select pg_sleep(0.3)"
# 2. within one poll (15 s) the bridge /metrics shows the gauge:
curl -s localhost:$BRIDGE_METRICS_PORT/metrics | grep crm_slow_query_window
# 3. about a minute later Prometheus shows the alert pending, then firing
```

## RouteLatencyP95High

**What it measures.** `histogram_quantile(0.95, ...)` of `crm_http_request_duration_seconds` per service and route over 15 minutes, for
routes with at least 50 requests in that window. Routes with fewer requests are ignored: a p95 from 3 requests right after a deploy is
not a measurement (the production baseline, sheet item P-16). It needs the app metrics on the service
([event-loop-observability-runbook.md](../performance/event-loop/event-loop-observability-runbook.md#turning-app-metrics-on-one-service-at-a-time)).

**First look.**

1. Is `SlowQueryMeanOver120ms` or `DbPoolSaturated` firing too? Then the database is the cause, start there.
2. Event-loop delay for the same service (`EventLoopDelayP95Warning`): a blocked loop slows every route, not one.
3. One route only: check the code path for a missing index, an N+1 or a large payload; `pnpm qa 42` runs the critical queries through EXPLAIN.
4. A deploy in the last 15 minutes: the first requests after a restart are cold.

## DbPoolAcquireSlow

**What it measures.** `crm_db_pool_acquire_seconds{pool}` times every checkout from a pool: the wait for a free connection plus, when the
pool had to open one, the time to connect. This is the time a request or job spends before its first query can start. The alert fires when
the p95 over 10 minutes is above 5 ms for 15 minutes, with at least 0.2 checkouts a second. It fires before `DbPoolSaturated`, because a
pool can queue briefly long before it is full for minutes.

**First look.**

1. `histogram_quantile(0.95, sum by (le, pool) (rate(crm_db_pool_acquire_seconds_bucket[10m])))` by pool, and `crm_db_pool_waiting` for the same pool.
2. Mostly connects, not waits? A pool that keeps closing idle connections (`idleTimeoutMillis` 30 s) and reopening them after a quiet period pays
   a connect on the first requests; the p50 stays near zero. Waiting shows as a high p50 as well.
3. Slow statements or sessions holding connections: the checks in `DbPoolSaturated` above.
4. Concurrency above the pool size: the evidence in [docs/performance/db/pool-and-pgbouncer.md](../performance/db/pool-and-pgbouncer.md)
   shows how the wait grows as the pool gets smaller than the number of concurrent callers. Raise `DB_POOL_MAX` only inside the connection budget
   in that document (Postgres `max_connections=100`).

## DbPoolSaturated

**What it measures.** A pool (`primary`, `webhook`, ...) of a service has all its connections open and none idle for 2 minutes. This is
the early warning; `DbPoolExhausted` pages when callers are already waiting.

**First look.**

1. `crm_db_pool_connections{state="idle"}`, `crm_db_pool_waiting` and `crm_db_pool_max` for the pool, in the golden-signals dashboard.
2. Slow statements now (`SlowQueryMeanOver120ms`) and sessions stuck in a transaction:
   `select pid, state, now() - xact_start as open_for, left(query, 100) from pg_stat_activity where state = 'idle in transaction' order by xact_start;`
3. A burst on one route (`WebhookRateHigh`) fills the webhook pool first.
4. If nothing is slow and traffic is normal, the pool may be too small: see the pool-sizing review ([docs/performance/db/pool-and-pgbouncer.md](../performance/db/pool-and-pgbouncer.md)) before raising `DB_POOL_MAX`.
