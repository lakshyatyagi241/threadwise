# network-failure (sheet item 18)

Runs the tests of the network-failure work (PRs #436 and #663).

- **Covers:** `apps/api/test/unit/network-failure/*`, `apps/api/test/integration/network-failure/*` (a TCP fault proxy in front of Postgres/Redis: outage and recovery, throwaway database `crm_nf2_*`, Redis db 8, random queue prefixes), web `src/lib/network-failure/*` and `src/lib/api/client-deadline.test.ts`.
- **Proves:** outbound calls have deadlines, fail cleanly on drop/hang/reset/slow, and the API recovers when the dependency returns.
- **Does not prove:** real WAN or provider outages; servers are never stopped, faults come from a local proxy.
- **Needs:** docker, node 22, pnpm, running `crm-platform-postgres` and `crm-platform-redis` (used only as servers).
- **Run:** `bash crm-platform/script-testing/network-failure/run.sh --quick` (about 4 min, skips `recovery.spec`) or without `--quick` (about 8 min). Heavy machine load makes it slower.
- **Output:** `qa-results/network-failure/<timestamp>/` with `result.json` and `logs/`. Exit 0 pass, 1 fail, 2 could not run.
- **Reading it:** the table at the end shows one line per check; open `logs/<check>.log` for a failing one.
