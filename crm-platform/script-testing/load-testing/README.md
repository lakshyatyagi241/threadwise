# Load testing (Sheet3 #53)

`bash script-testing/load-testing/run.sh --quick` (or no flag for the full profile; `--out DIR`, `LOAD_USERS=n`, `LOAD_P95_FACTOR=n`).

Boots the built API on a throwaway database, seeds one organisation plus N staff users with the repo's own `tools/perf/seed.sql` and `seed-users.sql`,
then runs `perf/load.js` (k6; local `k6` if installed, else docker `grafana/k6:0.54.0` on the host network). Each virtual user signs in once and
keeps doing a staff mix (inbox, conversation, contacts, search, dashboard, task create) with 3-8 s think time. Prints p50/p95/p99 per class A/B/C,
error rate and throughput, and writes `result.json` plus `load.json`. Exit 0 PASS, 1 FAIL, 2 ERROR.

Pass rule: error rate under 1% and each class p95 under `perf/budgets.json` x `LOAD_P95_FACTOR` (default 3, because a laptop runs k6, API, Postgres and
Redis on the same cores; use `LOAD_P95_FACTOR=1` for the strict budgets on a dedicated stack).

| Profile | Users | Ramp + hold | Data |
|---|---|---|---|
| quick | 30 | 10 s + 45 s | 5k contacts, 2k conversations, 40k messages |
| full | 150 | 30 s + 120 s | same |

**Honest scope:** the sheet target is 500 concurrent users. This is a scaled profile, not that run. The 500-user run needs a dedicated stack with the
100k-contact seed: `k6 run perf/load.js -e USERS=500` (see `docs/quality/performance-testing.md`). A pass here shows no errors and no latency collapse
at the scaled load, not capacity at 500. Reference quick run (30 users): p50 70 ms, p95 179 ms, p99 237 ms, 0.00% errors, 5.3 req/s.
