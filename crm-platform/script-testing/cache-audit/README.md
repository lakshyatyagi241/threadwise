# cache-audit (sheet item 64)

Runs the cache strategy audit (PR #714).

- **Covers:** `apps/api/test/unit/cache-audit/*` (register ratchet, bounded caches, behaviour, counter TTL, RBAC Lua path), web `src/lib/cache-audit/*`, the sign-out render test `user-menu.logout-cache.render.test.tsx`, and a validity check of `docs/performance/cache/register.json`.
- **Proves:** every cache and Redis writer is registered, in-process caches are bounded, sign-out leaves no client cache of the old account.
- **Does not prove:** hit rates or invalidation timing (see `cache-hit-rate`, `cache-invalidation`).
- **Needs:** node 22, pnpm.
- **Run:** `bash crm-platform/script-testing/cache-audit/run.sh --quick` (skips the micro-benchmark spec) or full. About 3 to 4 min.
- **Output:** `qa-results/cache-audit/<timestamp>/`.
