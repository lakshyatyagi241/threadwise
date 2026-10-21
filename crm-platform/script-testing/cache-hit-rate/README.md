# cache-hit-rate (sheet item 65)

Runs the cache hit-rate monitoring checks (PRs #720 and #735).

- **Covers:** the instrumentation ratchet and counter tests (`test/unit/cache-audit`), `packages/observability` cache-metrics spec, `promtool check rules` and `promtool test rules` (image `prom/prometheus:v2.55.0`), and the **live rules check** (`live-rules-check.mjs`): a private Prometheus container loads `deploy/observability/*.rules.yml`, the API boots (port 3932, metrics 59532, Redis db 8, throwaway database), traffic is generated, and every rule of the `cache-hit-rate` group must be `health=ok` with non-empty lookups and hit-ratio series.
- **Proves:** instrumentation is complete and the rules evaluate on real series. The live check is the one that catches the series-collision bug; promtool tests pass on the broken form too.
- **Does not prove:** production hit rates, Alertmanager delivery, counters on the web server and worker.
- **Needs:** docker, node 22, pnpm, running `crm-platform-postgres` and `crm-platform-redis`; builds the API if `apps/api/dist` is missing.
- **Run:** `bash crm-platform/script-testing/cache-hit-rate/run.sh --quick` (about 7 min); full adds the overhead benchmark.
- **Output:** `qa-results/cache-hit-rate/<timestamp>/` with `live/` (API log, `live-checks.json`, `live-series.json`) and `result.json`.
