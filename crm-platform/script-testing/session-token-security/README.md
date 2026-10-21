# Session and token security (sheet item 37)

Runs the tests and checks that were written and run for this area. See `run.sh --help`.

**Proves:** Cookie flags and lifetimes, no token in browser storage or URLs, JWT algorithm, issuer and audience pinning, token expiry, secret key ring.

**Does not prove:** No live login, refresh-rotation or session-revocation flow is exercised against a running API.

**Prerequisites:** node22, pnpm, `crm-platform/.env`, `pnpm install` done (the script builds the workspace packages and the API when missing).

**Run:**
```
bash crm-platform/script-testing/session-token-security/run.sh --quick   # about 1 min
bash crm-platform/script-testing/session-token-security/run.sh           # full, about 2 min
```
Options: `--out DIR`. Exit code 0 = PASS, 1 = FAIL, 2 = could not run.

**Output:** `qa-results/session-token-security/<timestamp>/result.json` (status, one entry per check, test counts, commands) and raw logs in `logs/`. The terminal shows one line per check and the re-run command. Failures in files that already fail on pristine `main` are counted as "known baseline", not as failures.

**Report of the original work:** `docs/quality/security-testing-batch-1.md`
