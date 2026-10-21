# Alerting test

`bash script-testing/alerting/run.sh [--quick] [--out DIR]` (exit 0 PASS, 1 FAIL, 2 ERROR; writes `result.json` and `logs/`).

Steps: promtool check and test of all rules files (docker `prom/prometheus:v2.55.0`), the runbook ratchet (`tools/alerting/check-alert-runbooks.mjs`) and its test, the Alertmanager webhook delivery check, then a live test (`tools/alerting/live-test.mjs`): private API, worker, probe, Redis, Prometheus and Alertmanager, a TCP fault proxy in front of a throwaway database (dropped on exit). `for:` is shortened to 20 s in a COPY of the rules only. It never touches shared Postgres data, the shared Redis or `crm-mon-*`.

Own ports: API 3921, metrics 59521/59525/59526, Prometheus 59191, Alertmanager 59193, webhook 59194, Redis 59422, DB proxy 59424. Do not run two at once.
Matrix of failure modes: `docs/performance/alerting/failure-modes.json`. Runbooks: `docs/runbooks/p0-failure-modes.md`.
