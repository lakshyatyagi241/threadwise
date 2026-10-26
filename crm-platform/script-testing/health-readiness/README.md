# health-readiness (Sheet3 #73)

`bash script-testing/health-readiness/run.sh --quick` (or without `--quick`, which also runs `promtool check rules`). Exit 0 PASS, 1 FAIL, 2 ERROR.
Output: `qa-results/health-readiness/<timestamp>/result.json`, `coverage-matrix.result.json`, `live-results.json`, `logs/`.

What it runs: the ratchet `tools/health-readiness/check.mjs` against `docs/performance/health/coverage-matrix.json`; its node tests; the web route tests; the live test
`tools/health-readiness/live.mjs` (API behind TCP fault proxies for Postgres and Redis; the shared containers are never stopped).
Own ports: 3931, 59531, 59534, 59535. Own throwaway database `hr_<pid>` (dropped on exit); Redis db 13 on the shared container, one member added and removed.
Runbook: `docs/runbooks/health-readiness.md`. Known failing files: none of these tests is in `script-testing/known-failures.json`.

**Rerun after any new service, compose change or health endpoint change.** The ratchet fails if a compose service is missing from the matrix, lacks a healthcheck or exemption, or a rules file is not loaded and mounted.
Covers: backup/offsite age alerts + promtool tests, Prometheus/Alertmanager healthchecks, Watchdog routing in all three Alertmanager files, crm_postgres_up (unit + live), object-store probe target, `/ready` and `/health` under faults.
