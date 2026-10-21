# concurrency (sheet item 15)

Runs the concurrency tests (PR #717).

- **Covers:** the 14 suites in `apps/api/test/e2e/concurrency/` (each starts its own Postgres and Redis testcontainers) plus the unit specs `test/unit/tenancy`, `plans-subscriptions-trials`, `forms-builder`, `message-templates`.
- **Proves:** caps and limits hold under parallel load, duplicates are rejected, no lost updates, Redis outage and stalled jobs are survived. Every run prints a seed; replay a failure with `CONC_SEED=<n>`.
- **Does not prove:** separate machines or DB failover; kill tests prove at-least-once; five runs is stability evidence, not proof.
- **Needs:** docker, node 22, pnpm.
- **Run:** `bash crm-platform/script-testing/concurrency/run.sh --quick --jobs 3` (each suite once, about 20 min) or full (each suite 5 times, 1-2 h). `--jobs N` sets how many suites run at once (default 3).
- **Output:** `qa-results/concurrency/<timestamp>/` with `result.json`, `logs/conc-<suite>-r<n>.log`. The table lists passes/runs and seeds per suite.
- **Note:** other jobs on the machine slow the containers; a timeout under load is a reason to re-run with a lower `--jobs`.
