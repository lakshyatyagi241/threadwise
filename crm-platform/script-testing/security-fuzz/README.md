# Security fuzz testing (sheet item 38)

Runs the tests and checks that were written and run for this area. See `run.sh --help`.

**Proves:** Seeded fuzz of schemas and parsers (and, in full, HTTP routes) finds no crash, hang or 5xx; the printed seed replays any failure.

**Does not prove:** Fuzzing is not proof of absence; the HTTP part covers only the routes the harness knows.

**Prerequisites:** node22, pnpm, `crm-platform/.env`, `pnpm install` done (the script builds the workspace packages and the API when missing).

**Run:**
```
bash crm-platform/script-testing/security-fuzz/run.sh --quick   # about 2 min
bash crm-platform/script-testing/security-fuzz/run.sh           # full, about 6 min
```
Options: `--out DIR`, `--seed N`. Exit code 0 = PASS, 1 = FAIL, 2 = could not run.

**Output:** `qa-results/security-fuzz/<timestamp>/result.json` (status, one entry per check, test counts, commands) and raw logs in `logs/`. The terminal shows one line per check and the re-run command. Failures in files that already fail on pristine `main` are counted as "known baseline", not as failures.

**Report of the original work:** `docs/security/fuzz/Sheet3-38-security-fuzz-testing-REPORT.html`
