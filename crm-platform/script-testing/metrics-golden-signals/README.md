# Metrics golden signals (sheet item 75)

Runs the tests and checks that were written and run for this area. See `run.sh --help`.

**Proves:** The golden-signal families marked present in golden-signals.json are really exposed by a booted API and worker behind a bearer token, with latency histogram samples and an error-class label.

**Does not prove:** Job metrics (queue duration, jobs_total, dead letters) only get samples when a job runs, so live they are noted, not asserted. Web, realtime and Redis exporter families are not checked live.

**Prerequisites:** node22, pnpm, docker, curl, postgres, redis, `crm-platform/.env`, `pnpm install` done (the script builds the workspace packages and the API when missing).

**Run:**
```
bash crm-platform/script-testing/metrics-golden-signals/run.sh --quick   # about 3 min
bash crm-platform/script-testing/metrics-golden-signals/run.sh           # full, about 4 min
```
Options: `--out DIR`. Exit code 0 = PASS, 1 = FAIL, 2 = could not run.

**Output:** `qa-results/metrics-golden-signals/<timestamp>/result.json` (status, one entry per check, test counts, commands) and raw logs in `logs/`. The terminal shows one line per check and the re-run command. Failures in files that already fail on pristine `main` are counted as "known baseline", not as failures.

**Report of the original work:** `docs/performance/metrics/Sheet3-75-metrics-REPORT.html`
