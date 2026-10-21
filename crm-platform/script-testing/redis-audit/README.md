# redis-audit (sheet item 67)

Runs the Redis audit (PR #713).

- **Covers:** `test/unit/redis/*` (ratchets, no Redis needed), `test/integration/redis/*` (private Redis containers on free ports: counter TTL, full server, slow server, restart, key hygiene under load, queue retention, connection footprint) and `node tools/redis-audit/inventory.mjs --check`.
- **Proves:** Redis keys have TTLs and do not leak, the app survives a full/slow/restarted Redis, connections are bounded, the committed inventory is current.
- **Does not prove:** production Redis sizing. The shared dev Redis is never used (the tests refuse ports 6379/56379).
- **Needs:** docker, node 22, pnpm.
- **Run:** `bash crm-platform/script-testing/redis-audit/run.sh --quick` (three specs, about 4 min) or full (all, about 12 min).
- **Output:** `qa-results/redis-audit/<timestamp>/`. `redis-hygiene` failures on pristine main are shown as known baseline.
