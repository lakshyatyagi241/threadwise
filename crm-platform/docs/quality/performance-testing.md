# Performance testing (QA tasks 50, 51, 52, 55, 63)

What exists, how to run it, what it measured, and what the numbers do and do not mean. Everything below was run on one 4-core, 15 GB machine
with Postgres 16 (pgvector 0.8), Redis 7, the API in production mode and k6 1.4.0 **all on that same machine**. No Docker. Read the numbers
as a trend and a ranking, not as production figures: k6, the API, Postgres and Redis were competing for the same four cores.

## What was added

| Piece                                                                                                             | Where                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Latency class of every API route (A, B, C), kept in step with the controllers                                     | `perf/endpoint-classes.json`, `tools/perf/classify.mjs` (`--check` fails on an unclassified route)                |
| Speed budgets (p95 fails a run, p99 is tracked), regression rule, error ceiling, traffic mix, spike pass rule     | `perf/budgets.json`                                                                                               |
| One large organisation: 100,000 contacts, 5,000 companies, 20,000 tasks, 50,000 conversations, 1,000,000 messages | `tools/perf/seed.sql` (psql, about 90 s)                                                                          |
| Latency script, one user or twenty, per class, warm-up discarded                                                  | `perf/latency.js`, `perf/lib/common.js`, `tools/perf/run-latency.sh`                                              |
| Ranked list of the slowest endpoints, median of repeat runs, regression guard against a baseline                  | `tools/perf/rank.mjs`, `perf/baseline.json`                                                                       |
| Slow-request log line in the running API (`SLOW_REQUEST_MS`, default 500, 0 turns it off)                         | `apps/api/src/common/interceptors/slow-request.interceptor.ts`                                                    |
| Stepped throughput run and the capacity it finds                                                                  | `perf/throughput.js`, `tools/perf/capacity.mjs`                                                                   |
| Spike runs (HTTP mix, signed WhatsApp webhooks, socket.io connection storm) and the "no cascading failure" rule   | `perf/spike.js`, `tools/perf/spike-check.mjs`, `tools/perf/sample.mjs` (uptime, memory, connections, queue depth) |
| Bytes on the wire per endpoint and JavaScript per web route, with budgets                                         | `tools/perf/bandwidth.mjs`, `perf/bandwidth-budgets.json`                                                         |
| Response compression (gzip or brotli over 1 KB), `RESPONSE_COMPRESSION=false` to turn it off                      | `apps/api/src/common/http/response-compression.ts`                                                                |
| Manual workflow                                                                                                   | `.github/workflows/perf.yml`                                                                                      |

The classes follow the sheet: **A** single-record reads, sessions and small lists (p95 under 50 ms); **B** writes, validated mutations, filtered lists and
searches (150 ms); **C** reports, analytics, exports, bulk and provider calls (300 ms). The first pass is by rule (`tools/perf/classify.mjs` says why
for each route); a hand-reviewed class goes in `perf/endpoint-class-overrides.json` with a reason. The 18 routes that were benchmarked all agree with their rule.
The sheet asks for the top 150 routes to be reviewed by hand; that has **not** been done.

## Run it

```bash
node tools/perf/classify.mjs --check                       # every route has a class
node --test tools/perf/*.test.mjs                          # the tools' own tests
psql "$MIGRATION_DATABASE_URL" -v org=perf-org -f tools/perf/seed.sql
bash tools/perf/run-latency.sh perf/results                # 3 runs of 1 user, 3 of 20, then the ranking
node tools/perf/rank.mjs perf/results/latency-vus1-run*.json --top 20 --baseline perf/baseline.json
k6 run perf/throughput.js -e RATES=25,50,100,200 -e STEP=60 && node tools/perf/capacity.mjs perf/results/throughput.json
API_PID=<pid> node tools/perf/sample.mjs perf/results/samples-http.json --seconds 780 &
k6 run perf/spike.js -e SPIKE=http -e NORMAL=20 && node tools/perf/spike-check.mjs perf/results/spike-http.json --samples perf/results/samples-http.json
node tools/perf/bandwidth.mjs api --token "$TOKEN" --check
node tools/perf/bandwidth.mjs web --next apps/web/.next --check
```

The API needs real secrets in production mode and a registration policy that allows sign-up without a phone code; `.github/workflows/perf.yml` shows
the exact steps. Throughput and spike runs push the stack until it gives: dedicated stack only.

## Results

### Latency (#50, #51), one user, median of three runs, final build

| Class | p50      | p95      | p99       | p95 budget |        |
| ----- | -------- | -------- | --------- | ---------- | ------ |
| A     | 15.7 ms  | 917.6 ms | 1088.8 ms | 50         | over   |
| B     | 19.1 ms  | 371.2 ms | 453.8 ms  | 150        | over   |
| C     | 156.4 ms | 237.8 ms | 269.3 ms  | 300        | inside |

The class A and B figures are driven by three endpoints. Without them every class A endpoint measured is under 30 ms p95 and every class B write under 40 ms.

| Endpoint                      | Class | p95     | Budget | Why                                                                                                                                               |
| ----------------------------- | ----- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/inbox/counts`        | A     | 1053 ms | 50     | One aggregate with `FILTER` clauses over every conversation of the organisation (50,000 rows here). `pg_stat_statements` mean 2374 ms under load. |
| `GET /v2/inbox/conversations` | A     | 1047 ms | 50     | Same cause: the list carries the counts.                                                                                                          |
| `GET /v2/contacts?q=`         | B     | 466 ms  | 150    | The free-text search; the list query averaged 563 ms in `pg_stat_statements` under load.                                                          |
| `GET /v2/crm/dashboard`       | C     | 253 ms  | 300    | Inside, at 84% of the budget.                                                                                                                     |

These are handed to the owners of the inbox and contacts modules (and to the slow-query work, QA 41 and 42, which read the same `pg_stat_statements`). They are
not fixed in this phase: the fix is a design choice (a maintained counter, a partial index, a search index), not a measurement.

With twenty users at once (before the compression change) the machine saturated: class A p95 4983 ms, B 941 ms, C 1178 ms, and the two inbox
endpoints were 5.7 s at p95. That figure says more about four shared cores than about the application.

The slow-request log works: the first call to `/v2/inbox/counts` after the change logged `slow request GET /v2/inbox/counts 981 ms` with the route pattern and the organisation.

### Throughput (#52)

Mix of 70% A, 25% B, 5% C, arrival rate stepped 10, 20, 40, 80 per second for 30 s each.

| Target | Achieved | Errors | Verdict                                       |
| ------ | -------- | ------ | --------------------------------------------- |
| 10     | 10.4     | 0%     | outside budget: class A p95 1043 ms, B 497 ms |
| 20     | 20.5     | 0%     | outside budget                                |
| 40     | 31.2     | 16%    | saturated: p95 about 19 s                     |
| 80     | 39.2     | 52%    | saturated                                     |

**Sustained inside the budgets: 0 requests per second** with this mix, because the two slow inbox endpoints are 2 of the 11 class A probes. The
machine **saturates at about 30 requests per second**. Fix the inbox pair and rerun to get a number worth keeping as a baseline; no throughput baseline file is committed for that reason.

Queue throughput: 13,503 queued WhatsApp webhook jobs drained in 16 s (about 840 per second including worker start-up) once a worker started. That is a lower bound
for the ingest queue only: the test number belongs to no connection, so each job ends early; the other hot queues are in `docs/performance/queue-capacity/` (QA 72).

### Spike (#55)

| Spike                      | Load                                   | Result                                                                                                                                                                                                                                   |
| -------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP mix                   | 10 to 30 per second in 60 s, held 60 s | **Fails the rule.** Errors 7.4% in the hold (ceiling 5%), 1.2% in the drop; `/health` canary saw 1.5% failures and waits up to 11 s. Recovers cleanly: 0% errors and the same p95 as before. No restart, memory flat (519 MB to 511 MB). |
| Signed WhatsApp webhooks   | 50 to 150 per second                   | **Passes** every check on the request path: 0 errors, p95 14 to 21 ms, no restart. The "queues empty" check fails only because no worker was running; the 13,503 queued jobs drained in 16 s once one started.                           |
| socket.io connection storm | 20 to 60 connections per second        | **Passes**: 0 failed upgrades, connect p95 under 5 ms, canary healthy.                                                                                                                                                                   |

The shortened phases (30 to 60 s, not 5 minutes) and the 30 per second peak (the box saturates at about 30) are deliberate for this machine; set `HOLD`, `RECOVERY` and `NORMAL` for a real run.
The expected peak of 500 concurrent users (QA 53) has not been converted to an arrival rate; the NORMAL values here are chosen for this machine, not for the product.

### Bandwidth (#63)

| Endpoint                               | Bytes before | Bytes on the wire after |
| -------------------------------------- | ------------ | ----------------------- |
| `GET /v2/contacts?limit=50`            | 52,061       | 3,973 (gzip)            |
| `GET /v2/contacts?limit=20`            | 20,891       | 1,871                   |
| `GET /v2/inbox/conversations?limit=20` | 15,928       | 2,000                   |
| `GET /v2/auth/session`                 | 11,528       | 2,512                   |
| `GET /v2/companies?limit=20`           | 11,356       | 1,359                   |
| `GET /v2/tasks?limit=20`               | 10,395       | 1,199                   |
| `GET /v2/tags`                         | 9,347        | 2,165                   |
| `GET /v2/crm/dashboard`                | 3,898        | 965                     |

Before the change the API sent every response uncompressed; there is no proxy configuration in this repository, so the compression is in the API. If the proxy in front
already compresses, set `RESPONSE_COMPRESSION=false`. Cost on this machine: about 1 to 4 ms of extra p95 on small endpoints, measured on loopback where bytes are free, so on a real
link the saving is far larger than the cost. Responses carry no `Cache-Control` and the list endpoints are not cached; ETags are present.
JavaScript per web route (Next 16 production build, gzip, from each page's client-reference manifest; an **upper bound**, since a chunk is fetched only when its component renders):

| Route                  | Gzip JavaScript | Chunks |
| ---------------------- | --------------- | ------ |
| `/login`               | 629 KB          |        |
| `/signup`              | 662 KB          |        |
| `/inbox`               | 966 KB          |        |
| `/settings`            | 969 KB          |        |
| `/dashboard`           | 981 KB          |        |
| `/contacts` (heaviest) | 1,205 KB        | 50     |
| `/flows/builder`       | 1,190 KB        | 45     |

409 routes: median 968 KB, smallest 191 KB. Even the login page is 629 KB, so a first visit on a slow link is dominated by JavaScript, not by the API. No reduction was made in this phase:
the budget in `perf/bandwidth-budgets.json` (1,050,000 bytes by default, a named limit for the 16 routes above it) **holds the line** at today's size and fails a build that grows a route. Splitting
the flow builder, loading only the active locale's messages instead of all 21, and lazy-loading rarely used screens are the next steps; `@next/bundle-analyzer` and Lighthouse CI were not set up.
Realtime event sizes were not measured.

## What these numbers do not tell you

- One machine, all roles on it, a single organisation, no network between k6 and the API, a worker that was not running except for one drain test.
- Single-user latency is meaningful as a ranking and for the three over-budget endpoints. The twenty-user and throughput figures are about this box.
- The k6 summary gives percentiles over a whole phase, not a time series; "recovers within N seconds" is judged from the recovery phase as a whole.
- One organisation of 20 users was asked for; the seed creates one admin user.
- Docker was not available, so the workflow and the Docker services in `perf.yml` have never run.
