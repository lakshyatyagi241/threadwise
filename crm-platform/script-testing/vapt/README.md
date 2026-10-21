# VAPT runner

```bash
bash script-testing/vapt/run.sh --quick   # audits + DAST walker + 18 live attack tests, no ZAP (~8 min)
bash script-testing/vapt/run.sh           # full: adds an authenticated OWASP ZAP API scan (default cap 15 min, --zap-cap N)
bash script-testing/vapt/run.sh --out DIR # default qa-results/vapt/<timestamp>
```

Exit 0 PASS, 1 FAIL, 2 ERROR (prerequisite or infra problem). Output: a summary table, `<out>/result.json`, raw logs in `<out>/logs/`.

It boots its own API on free ports against its own throwaway databases (dropped on exit, also on Ctrl-C), uses Redis db 11 of the dev
Redis, and only attacks localhost. Needs docker (dev compose Postgres `crm-platform-postgres` and Redis on 56379), node 22, pnpm, curl.

## Pass rule
The run passes when only the items in `known-baseline.json` are open (TI-001, API-key scope default, the two owner-accepted MFA switches,
tenancy baseline drift, SAST false positives). A new Critical/High, a new unclassified table or privileged call, a failing live test, or
a failed audit makes it FAIL. In full mode a ZAP run that produces no report is reported `TIMED OUT`/`SKIPPED` and counts as FAIL.

## Cannot do
Scan staging or production, the web app or mobile traffic, real provider webhooks, git history for secrets. Report:
`docs/security/vapt/Sheet3-25-vapt-REPORT.html`.
