# Test runners

One folder per tested area under [script-testing/](../../script-testing/), each with `run.sh`, `meta.json` and `README.md`. The generated index (what each proves and does not prove, quick/full minutes, prerequisites, command, report path) is [script-testing/README.md](../../script-testing/README.md); the one-page overview is [script-testing.md](script-testing.md).

- List: `pnpm qa:script-testing:list`. Run all quick: `pnpm qa:script-testing:quick`. One: `bash script-testing/<test>/run.sh --quick`.
- Results: `qa-results/<timestamp>/summary.{html,md,json}`. Exit 0 all PASS, 1 any FAIL, 2 any ERROR.
- Shared helper: `script-testing/_lib/common.sh` (one file, used by all runners). Baseline of files failing on pristine `main`: `script-testing/known-failures.json`.
- Pending: `alerting` (branch `vedant/ops/alerting-tests`) has a placeholder `meta.json` and is skipped by `run-all.sh` until its runner lands.

## Last verified: 2026-10-21

`bash script-testing/run-all.sh --quick --jobs 3 --skip vapt,alerting` on a 12-core laptop shared with other jobs, on `origin/main` at the merge of PR #758 plus this branch. 19 runners are listed (`run-all.sh --list`); `load-testing` is new here.

| Runner | Status | Seconds | Note |
|---|---|---|---|
| ssrf | PASS | 9 | |
| session-token-security | PASS | 9 | |
| csrf-cors-headers | PASS | 37 | |
| file-upload-security | PASS | 35 | Last verified 2026-10-21 (`--quick`, round 2): 70 in-process tests plus 40 unauthenticated upload operations refused live. e2e: the 24 upload specs migrated and run; 9 failures in 7 files are identical on pristine main |
| security-fuzz | PASS | 54 | |
| cache-audit | PASS | 46 | |
| cache-hit-rate | PASS | 101 | |
| cache-invalidation | PASS | 117 | |
| network-failure | PASS | 209 | |
| logging | PASS | 36 | |
| monitoring-dashboards | PASS | 80 | |
| encryption-audit | PASS | 34 | |
| concurrency | PASS | 586 | 14 suites, 1 round (confirms the earlier test-only fix) |
| load-testing | PASS | 107 | new; 30 users, scaled profile, see its README |
| redis-audit | PASS | 34 | first run FAIL (stale `docs/performance/redis/inventory.json`: line numbers shifted by the merge); regenerated with `node tools/redis-audit/inventory.mjs`, re-run PASS |
| metrics-golden-signals | PASS | 46 | first run FAIL inside the parallel run (API/metrics scrape returned nothing while `logging` booted its API at the same time: port race, the runner uses default ports 3931/59531); alone it PASSES. Do not run it in parallel with `logging`. |
| memory-profiling | FAIL | 158 | real finding, not hidden: api warm RSS 638 MB exceeds the budget (p95 <= 550, p99 <= 570 in `perf/memory-budget.json`) |
| memory-soak | FAIL | 329 | verdict GROWTH in the 5-minute quick profile: RSS slope api 33 MB/h, worker 50 MB/h flagged; heap fits are NaN (3 samples). A 5-minute window cannot tell warm-up from a leak; run `--full` before treating it as a leak |
| vapt | not re-run | - | was passing before the merge; skipped for time |
| alerting | not re-run | - | was passing before the merge; skipped for time |
- `chat-alerts` (Google Chat bridge + slow-query watcher, fake Chat receiver): PASS in full mode (65 s, 28 checks); it is new and not yet part of the table above.
