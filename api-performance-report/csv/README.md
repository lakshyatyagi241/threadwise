# CSV exports

All files are UTF-8 with a header row. Times are milliseconds measured at the client, on one shared 4-vCPU sandbox (API, worker, Postgres, Redis and the load generator on the same machine, development-mode build). Compare rows with each other; do not read them as production latency.

These CSVs come from a **second run** of the same harness (the report's numbers come from the first run). The data set had grown (about 1,100 contacts instead of about 520), so values differ slightly and a few more operations succeeded (410 vs 399).

| File | Rows | What it lists |
|---|---|---|
| `01-all-operations.csv` | 2,116 | **Every API operation.** 2,045 from the live OpenAPI document plus 71 routes found only in the source code (`in_openapi = no`). Columns: method, path, surface, module, operation id, summary, description, auth, actor kinds, permission keys, idempotency support, throttle, guards, path and query parameters, request content types and required fields, response codes, source file, line and handler, and the measured result (outcome, HTTP status, cold, min, p50, p95, p99, max, mean, time to first byte, request and response bytes, error code, URL requested). |
| `02-every-request.csv` | 32,777 | **Every individual HTTP request sent**: 13,861 from the route sweep and 18,916 from the flow, payload-size and concurrency benchmarks. Timestamp, test phase, method, route, URL, attempt, status, time to first byte, total time, request and response bytes. |
| `03-queues.csv` | 52 | Every BullMQ queue: purpose, processor file, concurrency, retry policy, job counts and sampled wait and processing times. |
| `04-redis-every-sample.csv` | 8,500 | Every Redis round-trip sample (PING, SET, GET, 100 KB GET, EVAL, 50-command pipeline). |
| `05-bullmq-every-job.csv` | 2,200 | Every probe job: enqueue time, queue wait, processing time, end to end. |
| `06-outbox-every-event.csv` | 7,833 | Every outbox event: module, event type, created, processed, lag in ms. |
| `07-postgres-statement-stats.csv` | 1,302 | Every statement in `pg_stat_statements`: calls, rows, total, mean, min, max, stddev, buffer hits and reads, query text. |
| `08-redis-command-stats.csv` | 52 | Redis `INFO commandstats`: calls and microseconds per call, per command. |

## How to read `01-all-operations.csv`

- **`outcome`** says what the sweep got back. Only `success` rows measure real work. `rejected` (400, 409, 422) and `not-found` (404) rows mean the generated body or placeholder id was refused, so the timing covers routing, auth and validation only. `unauthorized` rows need another credential: platform-operator routes, `/api/v1` API keys, partner and signed-webhook routes. `rate-limited` rows are the `/api/v1` per-key throttle. `forbidden` rows are plan or permission gates on the seeded org. `skipped` rows are logout, password and session-revoke routes. `fetch error` rows are OAuth and payment callbacks that redirect to external hosts.
- Request bodies in the sweep are generated from the OpenAPI schema. Most routes validate with Zod schemas that the OpenAPI document does not describe, so many writes were sent `{}` and rejected with 422. For the real write latency of the hot paths use the `flow: ...` phases in `02-every-request.csv` (valid bodies).
- `permission_keys`, `actor_kinds`, `throttle_decorator`, `guards`, `public_decorator`, `idempotency_key_supported` and the source location were read from the controller source code by a parser, not from the running app. All 2,045 OpenAPI operations were matched to a controller method.
- `auth_in_openapi` is the document's default (`bearer JWT`) for most rows because the document does not mark per-route auth; use `public_decorator` for routes that skip the JWT guard.
- Samples per operation: 1 cold request, then 9 more for GET (4 more for other methods). A route that returned 5xx or 429 stops early.
