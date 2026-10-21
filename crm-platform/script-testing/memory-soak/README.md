# memory-soak (sheet item 58)

Wraps `node tools/perf/soak.mjs` (PR #737).

- **Covers:** boots the built API and worker with `--expose-gc`, drives about 15 req/s of mixed traffic (reads, search, creates, webhook-like posts, logins, sockets), samples RSS, heap, handles, event-loop lag, Redis clients and Postgres connections every 10 s, fits a slope per series with a 95% interval.
- **Proves:** no series grew more than 10 MB/h with its whole 95% interval above zero during the run.
- **Does not prove:** that there is no leak. **A short run cannot settle a leak**; only the 24 h run can.
- **Needs:** docker, node 22, pnpm, running `crm-platform-postgres` and `crm-platform-redis`. A throwaway migrated and seeded database is created and dropped; API port 3932 (worker 3933), Redis db 8. Builds the API if `apps/api/dist` is missing.
- **Run:** `--quick` = 5 minutes, default = 20 minutes, `--minutes N` overrides (`--minutes 1440` for 24 h). Add about 3 min for setup.
- **Output:** `qa-results/memory-soak/<timestamp>/soak/soak.csv` and `soak.json` (slopes, verdict), plus `result.json`. The last lines of the soak output (slopes and verdict) are printed at the end.
