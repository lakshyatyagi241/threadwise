# SSRF protection (sheet item 29)

Runs the tests and checks that were written and run for this area. See `run.sh --help`.

**Proves:** Address and URL matrices (internal, mapped and encoded IPs, schemes, credentials, DNS answers), the outbound-call ratchet, the guarded request and the connect-time check behave as specified.

**Does not prove:** It is unit-level: no real DNS rebinding against a live network, and the open operator-only gaps S5 and S7 are not tested.

**Prerequisites:** node22, pnpm, `crm-platform/.env`, `pnpm install` done (the script builds the workspace packages and the API when missing).

**Run:**
```
bash crm-platform/script-testing/ssrf/run.sh --quick   # about 1 min
bash crm-platform/script-testing/ssrf/run.sh           # full, about 3 min
```
Options: `--out DIR`. Exit code 0 = PASS, 1 = FAIL, 2 = could not run.

**Output:** `qa-results/ssrf/<timestamp>/result.json` (status, one entry per check, test counts, commands) and raw logs in `logs/`. The terminal shows one line per check and the re-run command. Failures in files that already fail on pristine `main` are counted as "known baseline", not as failures.

**Report of the original work:** `docs/security/ssrf/REPORT.html`
