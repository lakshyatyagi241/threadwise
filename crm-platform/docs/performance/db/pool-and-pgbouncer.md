# DB connection pools, PgBouncer and the Postgres version (Sheet 3 D-07)

Decision document. Target from the sheet: pool wait p95 under 5 ms; a decision on PgBouncer and on Postgres 16 against 17/18.

## Decisions

| Question               | Decision                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is pool wait measured? | Yes, now: `crm_db_pool_acquire_seconds{pool}` (every checkout, all pools) and the `DbPoolAcquireSlow` alert (p95 over 5 ms for 15 min). It was not measured before.       |
| Change pool sizes now? | No. The budget below fits `max_connections=100` with room, and there is no production wait data yet to size from. Resize from the new metric, inside the budget.          |
| Deploy PgBouncer?      | Not now. The app is compatible with transaction pooling, but nothing today needs it (budget, triggers below). The three changes it would need are listed.                 |
| Move off Postgres 16?  | Not as part of this task. All migrations apply the same on 16.15, 17.11 and 18.6. Performance was not compared. When upgrading, go straight to 18 after the checks below. |

## What a checkout costs, measured

`crm_db_pool_acquire_seconds` times each `pool.connect` (and so each `pool.query`, drizzle query and transaction): the wait for a free
connection plus, when the pool has to open one, the time to connect. Test: `apps/api/test/integration/db-pool-acquire.spec.ts`, real
Postgres 16, 24 concurrent callers each running 100 queries of 3 ms:

| Pool size | Checkouts | Wait p50 | Wait p95 | Wait p99 |
| --------- | --------- | -------- | -------- | -------- |
| 4         | 2400      | 23.4 ms  | 25.0 ms  | 25.6 ms  |
| 8         | 2400      | 9.0 ms   | 9.7 ms   | 10.1 ms  |
| 12        | 2400      | 4.5 ms   | 4.8 ms   | 5.1 ms   |
| 24        | 2400      | 0.01 ms  | 0.02 ms  | 0.09 ms  |

Reading it: the wait is the queue length times the query time. With N callers on a pool of P and a query of t ms, the wait is about
(N/P - 1) x t. A pool at least as large as the number of callers that are in the database at the same moment never queues; a pool half that
size adds one query time to every call. A warm pool with a free connection hands it out in under 5 ms at p95 (the same spec asserts it).
The numbers are for 3 ms queries on one machine: they show the shape, not production load.

## The connection budget (deploy/hostinger/docker-compose.yml)

Every API-image process has three pools: the main one (`DB_POOL_MAX`), the webhook pool (`WEBHOOK_DB_POOL_MAX` 6) and the health pool
(`HEALTH_DB_POOL_MAX` 2). A pool opens connections on demand and closes idle ones after 30 s, so these are ceilings.

| Process                   | Main | Webhook | Health | Ceiling |
| ------------------------- | ---- | ------- | ------ | ------- |
| api blue (or green)       | 10   | 6       | 2      | 18      |
| api hooks                 | 8    | 6       | 2      | 16      |
| worker                    | 10   | 6       | 2      | 18      |
| **Steady state**          |      |         |        | **52**  |
| second api slot (release) |      |         |        | +18     |
| **During a slot switch**  |      |         |        | **70**  |

Plus a few outside the app: the migrate job (1, holds a session advisory lock), the chat-bridge watcher (1-2, read-only role), operators.
Postgres has `max_connections=100` with 3 reserved for superusers, so 97 usable: the worst case is about 75 of 97. Headroom is about 22.
The production compose is the one that matters; `docker-compose.prod.yml` (a 16 GB+ machine) has `max_connections=300`.

Rules for changing a size: keep the worst case (all pools full, two api slots) under 80 % of `max_connections`; raise the main pool of a
process only when `DbPoolAcquireSlow` fires and the p50 is high (queueing), not when only the p99 is (a cold connect after a quiet period);
and check the database first (`DbPoolSaturated` runbook): a pool full of slow queries is not helped by a bigger pool.

What is not known: the peak `crm_db_pool_connections{state="total"}` per process in production. Read it for a week from Prometheus before
resizing; this session had no read access to production metrics.

## PgBouncer

**What the code does that matters for transaction pooling** (the mode that multiplexes):

| Behaviour                                                                                             | Where                                                                                | Safe in transaction mode?                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant context via `set_config('app.org_id', ..., true)` (transaction-local)                          | `packages/db/src/tenant.ts` and the code that uses it                                | Yes. It ends with the transaction, so one tenant cannot leak into the next client.                                                                                                                  |
| Advisory locks taken as transaction locks (`pg_advisory_xact_lock` family)                            | 36 files                                                                             | Yes.                                                                                                                                                                                                |
| `CREATE TEMP TABLE ... ON COMMIT DROP`                                                                | `analytics/rollup/rollup.service.ts`                                                 | Yes.                                                                                                                                                                                                |
| `LISTEN` / `NOTIFY`                                                                                   | none                                                                                 | n/a                                                                                                                                                                                                 |
| Named prepared statements                                                                             | none (node-postgres unnamed extended protocol)                                       | Yes.                                                                                                                                                                                                |
| **Session advisory lock** `pg_advisory_lock`                                                          | `packages/db/src/migrator.ts`                                                        | **No.** Migrations need a direct connection.                                                                                                                                                        |
| **Session-level** `set_config('app.privileged', 'on', false)`                                         | nine one-off CLIs and seed scripts (rotate keys, re-encrypt, create operator, seeds) | **No.** They need a direct connection, and would leak RLS-lifting state across clients.                                                                                                             |
| **Startup `options`** (`-c statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`) | `packages/db/src/client.ts`                                                          | **No.** PgBouncer refuses unknown startup parameters (or ignores them), so the per-process values are lost. The worker relies on longer values (15 s lock, 5 min idle in transaction) than the API. |

**Changes it would need:** (1) a second DSN for the migrator and the CLIs that bypasses the pooler; (2) the timeouts moved to the database
role (migration `2034_db_role_timeouts.sql` already sets role-level defaults) with the worker's longer values on a separate worker role, or
`ignore_startup_parameters` plus role settings; (3) pooler health in the readiness check and an alert on waiting clients. The outbox drain
holds a transaction open while handlers run, so those connections are not multiplexed anyway.

**Why not now.** The worst case is 75 of 97 connections; connect cost is already visible in the new metric if it ever matters; and the
change moves timeouts and RLS-adjacent session state, which is the area where a mistake leaks data or hangs workers. **Revisit when** any of
these is true: the worst-case budget would pass 80 % of `max_connections` (for example a second worker or more api replicas);
`DbPoolAcquireSlow` fires with a high p50 that a bigger pool cannot fix inside the budget; or connect churn shows up as a high p99 acquire time
on a busy pool.

## Postgres 16 against 17 and 18

Tested: the whole migration set (`packages/db/migrations`) run on a fresh `pgvector/pgvector:pg16`, `:pg17` and `:pg18` with
`shared_preload_libraries=pg_stat_statements`.

| Server | Tables | Tables with RLS forced | Extensions (same on all)                                                   |
| ------ | ------ | ---------------------- | -------------------------------------------------------------------------- |
| 16.15  | 547    | 543                    | btree_gist, citext, pg_stat_statements, pg_trgm, pgcrypto, plpgsql, vector |
| 17.11  | 547    | 543                    | same                                                                       |
| 18.6   | 547    | 543                    | same                                                                       |

Not tested: query performance, the integration and e2e suites on 17/18, `pg_upgrade` on the production data, replication. Do not read
migration timings as a speed comparison (16 was the first, cold run).

**Decision.** Stay on 16 (supported by the Postgres project until November 2028; 17 until November 2029; 18 until November 2030). There is
no measured problem that a newer major fixes. When the upgrade is scheduled, target 18 directly, and before the window: restore a recent
backup into 18, run the integration suite and `db-guards.spec.ts` against it, replay `tools/perf` against both versions and compare the
`pg_stat_statements` weekly digest (D-06), then upgrade in a quiet window with the restore as the rollback.
