# QA suite: one command per QA task

```bash
pnpm qa --list                  # the 18 tasks and their targets
pnpm qa                         # every task, static checks only (no stack needed, ~20 s)
pnpm qa 30 31 43                # only those task numbers
pnpm qa -- --fail               # exit 1 on any failed check or unmet measurable target (CI gate)
```

Output: `reports/qa-suite/latest/report.html` (+ `report.md`, `results.json`); each run is also kept under `reports/qa-suite/<timestamp>/`.

A check is **pass**, **fail**, **warn** (review it) or **skipped**. **Skipped means the check needs a running stack that was not configured. It is
never counted as a pass.** Every task has a "Target" line taken from the QA plan and says whether that target is met, not met, or not measurable
without the live stack.

## Static vs live

Static checks read the code, the SQL migrations and the compose files. Live checks need local services; they are only run when asked.

| Variable                                  | Used by        | Meaning                                                                                              |
| ----------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `API_URL`                                 | 17 30 31 54 59 | A **localhost** API (for example `http://localhost:3000`). Any other host is refused.                |
| `WEB_URL`                                 | 31             | A localhost web app (`http://localhost:3001`)                                                        |
| `QA_EMAIL`, `QA_PASSWORD`, `QA_ORG`       | 17 30 54 59    | A **local dev** account (org optional)                                                               |
| `DATABASE_URL`                            | 40 41 42 44 48 | A seeded local Postgres (superuser or owner, so `SET ROLE crm_app` works)                            |
| `QA_PG_LOG`                               | 41             | Path to the Postgres server log                                                                      |
| `QA_INJECTION_ROUTES`, `QA_INJECTION_MAX` | 30             | Comma-separated routes to attack instead of all discovered GET routes; cap on discovered routes (60) |

## The tasks

| #   | Task                     | Static (always)                                                                                                 | Live / flags                                                                                                                                                                         |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10  | Playwright UI automation | Scenario count (hand-written + generated route matrix), P0/P1 journey coverage                                  | `--run-playwright` runs the suite. Specs: `apps/web/e2e/_matrix`, `e2e/security`                                                                                                     |
| 11  | Regression suite         | Counts every test declaration across api, web, packages, tools, Playwright                                      | `--run-unit` runs the API unit suite and requires zero failures                                                                                                                      |
| 17  | Session expiry           | 27-scenario P0/P1 catalogue with coverage %; 5 browser scenarios                                                | 16 API attacks (tampered/none/expired token, logout revocation, refresh rotation and reuse), each repeated `QA_REPEAT` (3) times to expose flakiness                                 |
| 26  | SAST                     | Runs `tools/sast-report`, zero unresolved Critical/High, "runs on every PR" check                               | Uses semgrep / gitleaks / trivy when installed                                                                                                                                       |
| 30  | Injection                | `sql.raw`, templated `query()`, shell commands: request-shaped data is a failure, dynamic is a review item      | ~30 SQLi/NoSQLi/command/header payloads against every parameterless GET route, login, and headers; detects 5xx, DB error leaks, time-based execution                                 |
| 31  | XSS                      | Dangerous sinks, sanitizer + its tests, CSP/nosniff config                                                      | Reflection and header checks; browser spec `e2e/security/xss.spec.ts` (16 payloads, stored and reflected)                                                                            |
| 36  | Audit logging            | Every module with mutating routes audits; no secrets in audit deltas; `audit_log` append-only; required columns |                                                                                                                                                                                      |
| 40  | DB indexing audit        | FK coverage, redundant indexes, tenant-led indexes, critical-query register (`data/critical-queries.json`)      | Unused and invalid indexes                                                                                                                                                           |
| 41  | Slow-query analysis      | `log_min_duration_statement`, `pg_stat_statements` preloaded, `auto_explain`                                    | Ranks statements, estimates p95; `QA_PG_LOG` parses the log; `QA_SLOW_MS` (100)                                                                                                      |
| 42  | Query execution plans    |                                                                                                                 | EXPLAINs each critical query, flags Seq Scan/Sort on large tables, diffs against `data/plan-baseline.json` (`--save-plans`, `--analyze`)                                             |
| 43  | N+1 detection            | Reads/writes awaited inside loops and async maps                                                                |                                                                                                                                                                                      |
| 44  | Connection pool          | Pool size x services vs `max_connections`, timeouts, error handler                                              | Live connections, idle-in-transaction, role privileges                                                                                                                               |
| 46  | Transaction audit        | audit/outbox calls use the caller's transaction; no network I/O inside a transaction                            |                                                                                                                                                                                      |
| 47  | Constraint audit         | PKs, composite tenant FKs, RLS enabled+forced, constrained status columns                                       |                                                                                                                                                                                      |
| 48  | Data integrity (P0)      | Unique public ids, NOT VALID leftovers                                                                          | Unvalidated constraints, RLS fail-closed as `crm_app`, DEFAULT-partition leaks, sequence exhaustion, `db:verify-schema`                                                              |
| 49  | Retention                | Every high-volume/partitioned table has a retention rule and a way to drop old partitions                       |                                                                                                                                                                                      |
| 54  | Stress                   |                                                                                                                 | `--stress`: ramps 1x..8x of `QA_PEAK_RPS`, finds the degradation point, checks 429/503 shedding and recovery                                                                         |
| 59  | CPU profiling            |                                                                                                                 | p50/p95/p99 per endpoint vs `data/perf-baseline.json` (`--save-baseline`, budget `QA_PERF_BUDGET` 20%); `--spawn "<start cmd>"` adds a V8 `.cpuprofile` with top self-time functions |

## Reviewed exceptions

Heuristics produce review items. A reviewed item goes in `data/baseline.json` under its task number with a **reason**; an entry without a reason
is ignored. The same idea for the SAST report is `tools/sast-report/baseline.json`.

## Per-task reports

```bash
pnpm qa:reports                  # run tasks 30 31 36 40 41, write one HTML report per task + an index into docs/quality/qa-reports/
pnpm qa:reports -- --pdf         # also print each to PDF (headless Chrome; set CHROME_PATH if it is not in the usual place)
pnpm qa:reports -- --no-run      # reuse reports/qa-suite/latest/results.json instead of running the checks again
pnpm qa:reports -- --tasks 36,40 # only those tasks
node --test tools/qa-suite/report/report.test.mjs   # fast tests for the generator (no stack needed)
```

Each report has the verdict against the task target, every check run, the weak points, and how to finish the task. Numbers, lists and verdicts come
from the check results, so a rerun on newer code gives a new report; the prose around them is reviewed commentary in `report/builders.mjs`. The
`pnpm qa` run behind it passes `QA_MAX_EVIDENCE` so the appendices hold every finding (the runner's own report keeps the first 40).

Set `API_URL`, `WEB_URL` or `DATABASE_URL` (see above) before running to include the live checks; without them they show as skipped, never as passed.
The XSS report reads one verdict per HTML sink from `data/xss-sink-review.json`. A sink with no entry is shown as "not reviewed", so a new
`dangerouslySetInnerHTML` appears in the next report until someone reads it and adds a line.

## What this does not do

- It does not prove the targets by itself: a count of 3,000 Playwright scenarios is a count of scenarios that exist, and a green regression number
  needs the suites to run (`--run-playwright`, `--run-unit`, and the Docker suites in `docs/quality/README.md`).
- Static checks are heuristics (regex plus bracket matching, no type information). They find leads, not proofs.
- Live checks only attack localhost, and create nothing except a few login sessions (and the XSS spec's contacts, which it deletes).
- The tool's own tests: `node --test tools/qa-suite/qa-suite.test.mjs` (a mock API that behaves correctly and one that does not).
