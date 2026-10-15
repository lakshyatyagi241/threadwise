# QA suite: guide

`pnpm qa` runs one check per QA-plan task and writes a single report. It is read-only and only attacks localhost.
Full reference: [tools/qa-suite/README.md](../../tools/qa-suite/README.md).

## What it covers

| #   | Task                           | Checks it runs                                                                         |
| --- | ------------------------------ | -------------------------------------------------------------------------------------- |
| 10  | Playwright UI automation       | Scenario count (2,702 generated from every static page, plus hand-written), journey coverage |
| 11  | Regression suite               | Counts automated checks across api, web, packages, tools                               |
| 17  | Session expiry                 | 16 live API attacks (tampered/expired token, logout revocation, refresh reuse), repeated to expose flakiness |
| 26  | SAST                           | Pattern rules + semgrep/gitleaks/trivy if installed; reasoned baseline                 |
| 30  | Injection                      | Raw SQL / command review; live SQLi, command and header payloads                       |
| 31  | XSS                            | Dangerous sinks, sanitizer, CSP; browser spec with 16 payloads                         |
| 36  | Audit logging                  | Mutating modules audit; no secrets in audit rows; audit table append-only              |
| 40  | DB indexing                    | Foreign-key coverage, redundant indexes, 19 critical query patterns                    |
| 41  | Slow queries                   | Slow-query logging, `pg_stat_statements`, ranked statements                            |
| 42  | Query plans                    | EXPLAIN of critical queries, before/after diff                                         |
| 43  | N+1                            | Database reads inside loops                                                            |
| 44  | Connection pool                | Pool size against `max_connections`, timeouts, role privileges                         |
| 46  | Transactions                   | Audit/outbox on the caller's transaction; no network I/O inside one                    |
| 47  | Constraints                    | Primary keys, composite tenant keys, RLS enabled and forced                            |
| 48  | Data integrity (P0)            | Unvalidated constraints, RLS fails closed, partition leaks, sequences                  |
| 49  | Retention                      | High-volume tables have a retention rule                                               |
| 54  | Stress                         | Ramp to 8x peak, degradation point, recovery                                           |
| 59  | CPU profiling                  | p50/p95/p99 baseline, regression budget, V8 CPU profile                                |

## Reading the result

Each check is **pass**, **fail**, **warn** (review it) or **skipped**. Skipped means the check needs a running stack and was not
configured: it is never counted as a pass. Each task also says whether its target is met, not met, or not measurable without the stack.
Pattern hits are leads to review, not confirmed vulnerabilities. A finding you reviewed and judged safe goes in
`tools/qa-suite/data/baseline.json` (or `tools/sast-report/baseline.json`) with a written reason.

## Scripts that matter

Run from `crm-platform/`.

```bash
pnpm qa                       # all tasks, static checks only (~15 s, no stack)
pnpm qa 30 31 43              # selected tasks
pnpm qa -- --fail             # exit 1 on any failure (CI gate)
pnpm audit:sast               # the SAST report on its own
```

Live checks (start the stack first: `pnpm infra:up && pnpm db:migrate && pnpm db:seed`, then `pnpm dev` and `pnpm dev:web`):

```bash
export API_URL=http://localhost:3000 WEB_URL=http://localhost:3001
export DATABASE_URL=postgres://<owner>:<password>@localhost:5432/crm
export QA_EMAIL=<local dev user> QA_PASSWORD=<password> QA_ORG=<org slug>

pnpm qa                          # adds #17, #30, #31 and the database checks
pnpm qa 42 -- --save-plans       # save "before" query plans, re-run after a change
pnpm qa 54 -- --stress           # stress test (set QA_PEAK_RPS to the expected peak)
pnpm qa 59 -- --save-baseline    # latency baseline; later runs compare against it
pnpm qa 11 -- --run-unit         # API unit tests, zero failures required
pnpm qa 10 -- --run-playwright   # full browser suite (hours)
```

Browser specs (`apps/web/e2e/_matrix`, `e2e/security`):

```bash
pnpm --filter @crm/web exec playwright test e2e/security
HEADLESS=1 QA_MATRIX_LIMIT=20 pnpm --filter @crm/web exec playwright test e2e/_matrix   # smoke
```

The suite's own tests: `node --test tools/qa-suite/qa-suite.test.mjs`.

## Output

`reports/qa-suite/latest/report.html` (plus `report.md`, `results.json`); every run is also kept under `reports/qa-suite/<timestamp>/`.

## Known open findings (from the first run)

- `audit_log` is not append-only: the app role can update or delete it.
- `pg_stat_statements` is not preloaded in any compose file, so slow queries cannot be ranked.
- One unresolved High SAST item: the flow Code node runs user JavaScript in `node:vm`, which is not a security boundary.
- 39 database reads inside loops (N+1 suspects) are unreviewed.
- "SAST on every PR" cannot be enforced while GitHub Actions jobs do not start (removed in #328).

## Limits

Static checks are heuristics, not proofs. A scenario count is not a pass rate: `--run-playwright`, `--run-unit` and the Docker suites in
[README.md](README.md) prove behaviour. The live API checks were validated against a mock API, not the real stack.
