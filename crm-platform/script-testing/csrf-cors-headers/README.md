# CSRF, CORS and security headers (sheet item 32)

Runs the tests and checks that were written and run for this area. See `run.sh --help`.

**Proves:** The real booted API sends the security headers, echoes only the allowed origin with credentials, refuses look-alike and null origins, and answers preflights correctly; the unit specs for the policy and the web CSRF helper pass.

**Does not prove:** No browser, no Next.js response headers, no reverse proxy in front of the API. It notes that X-Powered-By: Express is still sent.

**Prerequisites:** node22, pnpm, docker, curl, postgres, redis, `crm-platform/.env`, `pnpm install` done (the script builds the workspace packages and the API when missing).

**Run:**
```
bash crm-platform/script-testing/csrf-cors-headers/run.sh --quick   # about 3 min
bash crm-platform/script-testing/csrf-cors-headers/run.sh           # full, about 3 min
```
Options: `--out DIR`. Exit code 0 = PASS, 1 = FAIL, 2 = could not run.

**Output:** `qa-results/csrf-cors-headers/<timestamp>/result.json` (status, one entry per check, test counts, commands) and raw logs in `logs/`. The terminal shows one line per check and the re-run command. Failures in files that already fail on pristine `main` are counted as "known baseline", not as failures.

**Report of the original work:** `docs/security/csrf-cors-headers/REPORT.html`
