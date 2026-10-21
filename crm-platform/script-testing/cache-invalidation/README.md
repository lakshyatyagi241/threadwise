# cache-invalidation (sheet item 66)

Runs the cache-invalidation tests (PR #723).

- **Covers:** `test/unit/cache-invalidation/*` (every writer of a cached table is listed), `test/integration/cache-invalidation/*` (throwaway database on the dev Postgres, private Redis container, several API instances plus a cross-process helper) and a check that `docs/performance/cache/invalidation-results.json` has no measured stale time above its documented bound.
- **Proves:** invalidation happens on every write path, and stale reads stay within the documented bound even when an invalidation is lost.
- **Does not prove:** production behaviour, or writers the scanner cannot see.
- **Needs:** docker, node 22, pnpm, running `crm-platform-postgres` (server only).
- **Run:** `bash crm-platform/script-testing/cache-invalidation/run.sh --quick` (about 4 min: ratchet, smoke, access-control, matrix) or without `--quick` (all specs, about 15 min).
- **Output:** `qa-results/cache-invalidation/<timestamp>/`. The tests do not rewrite the results file (`CACHE_INVALIDATION_WRITE` is not set).
