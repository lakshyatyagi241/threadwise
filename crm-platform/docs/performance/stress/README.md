# Stress report (Sheet4 V-06)

Every performance pull request attaches a stress report: p95, CPU and RSS of the API at 5, 10, 25 and 50 users, so a change that is faster
but heavier (or the other way round) is seen before it merges.

## Run it

```bash
bash script-testing/stress-report/run.sh          # about 2 min once the API is built; boots a throwaway database, seeds it, ramps, writes the report
BASE=docs/performance/stress/baseline-2026-10-26.json bash script-testing/stress-report/run.sh   # adds the change against a base run
bash script-testing/stress-report/run.sh --quick  # tests of the sampler and the report builder only
```

Output (`qa-results/stress-report/<time>/`): `stress.json`, `stress-report.html`, and `stress-report.md`, which is the block to paste into the
PR. Use the `performance` PR template (`?template=performance.md`).

Against a stack you started yourself: `node tools/perf/stress-ramp.mjs --pid <api pid> --out stress.json`, then
`node tools/perf/stress-report.mjs stress.json --base base.json`. CPU is read from `/proc` (100% is one core, Linux only).

## How to read it

One machine drives and serves, so the limit is a ceiling for that machine, not for production. Compare a run with a base run on the same
machine, same seed, same steps: the change per step is what matters.

## First baseline (2026-10-26, a laptop, NODE_ENV=development, 20 s steps)

| Users | req/s | p95 ms | CPU avg % | RSS max MB |
| ----- | ----- | ------ | --------- | ---------- |
| 5     | 100   | 154    | 94.9      | 1052       |
| 10    | 111   | 313    | 111.2     | 1127       |
| 25    | 108   | 1013   | 112.1     | 1139       |
| 50    | 109   | 1327   | 111.7     | 1143       |

The API saturates at about 110 req/s on one core (CPU stays near 110% from 10 users on) and the limit under p95 500 ms is 10 users. The API
process holds over 1 GB of RSS under load in this mode. Both are for the next performance task to read; this file only records the baseline.
