# Encryption audit (sheet item 35)

Runs the tests and checks that were written and run for this area. See `run.sh --help`.

**Proves:** AES-GCM properties, no plaintext secret columns beyond the allowlist, TLS transport options, and the seal CLI on a seeded plaintext row: dry-run changes nothing, seal adds hash and sealed copy, rerun is idempotent, scrub blanks the plaintext, and the lookup works before and after every step.

**Does not prove:** Only the Telegram bot token target is seeded live (the others are covered by the integration specs in full mode). A real rollout (mirror off, redeploy) is not exercised. Findings E2 to E4 remain open.

**Prerequisites:** node22, pnpm, docker, postgres, `crm-platform/.env`, `pnpm install` done (the script builds the workspace packages and the API when missing).

**Run:**
```
bash crm-platform/script-testing/encryption-audit/run.sh --quick   # about 4 min
bash crm-platform/script-testing/encryption-audit/run.sh           # full, about 12 min
```
Options: `--out DIR`. Exit code 0 = PASS, 1 = FAIL, 2 = could not run.

**Output:** `qa-results/encryption-audit/<timestamp>/result.json` (status, one entry per check, test counts, commands) and raw logs in `logs/`. The terminal shows one line per check and the re-run command. Failures in files that already fail on pristine `main` are counted as "known baseline", not as failures.

**Report of the original work:** `docs/security/encryption-audit/Sheet3-35-encryption-audit-REPORT.html`
