# Centralized structured logging (sheet item 74)

Runs the tests and checks that were written and run for this area. See `run.sh --help`.

**Proves:** Unit specs plus a real boot: every log line is one JSON object with time, level, service and msg, planted secrets in URL, query and headers never appear, the health probe is silent at info, the request id is consistent.

**Does not prove:** Worker and web logging are not booted; tenant ids need a real login (not exercised live); free-text business logs are not scanned for secrets.

**Prerequisites:** node22, pnpm, docker, curl, postgres, redis, `crm-platform/.env`, `pnpm install` done (the script builds the workspace packages and the API when missing).

**Run:**
```
bash crm-platform/script-testing/logging/run.sh --quick   # about 3 min
bash crm-platform/script-testing/logging/run.sh           # full, about 3 min
```
Options: `--out DIR`. Exit code 0 = PASS, 1 = FAIL, 2 = could not run.

**Output:** `qa-results/logging/<timestamp>/result.json` (status, one entry per check, test counts, commands) and raw logs in `logs/`. The terminal shows one line per check and the re-run command. Failures in files that already fail on pristine `main` are counted as "known baseline", not as failures.

**Report of the original work:** `docs/quality/logging/Sheet3-74-logging-REPORT.html`
