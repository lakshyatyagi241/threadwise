# Memory profiling runner (Sheet3 #57)

`script-testing/memory-profiling/run.sh [--quick] [--minutes N] [--snapshots] [--out DIR]`

Creates a throwaway database and uses Redis db 10 (`MEM_REDIS_DB`), boots API + worker with NODE_ENV=production (throwaway secrets),
runs `tools/perf/soak.mjs --profile`, prints boot RSS and p50/p95/p99 of RSS and heapUsed per process plus the four per-endpoint heap
deltas, then checks `perf/memory-budget.json`. Exit 0 PASS, 1 budget exceeded, 2 could not run. Results: `<out>/result.json`, logs in `<out>/logs`.
Quick = 2 min of load (about 5 min total with migrate and boot); full = 5 min load. `--snapshots` adds a separate heap-snapshot run
(snapshots inflate RSS, so they never share a run with the numbers). A FAIL under a high load average may be machine noise; the script
prints the load average and still reports FAIL.
