# monitoring-dashboards

Prometheus + Grafana end-to-end check (Sheet3 monitoring stack).

```bash
bash script-testing/monitoring-dashboards/run.sh --quick      # ~6 min; --full waits and sends more traffic; --keep-up leaves the stack running
```

What it does: starts a private docker network with `prom/prometheus:v2.55.0` (the repo's `deploy/observability/prometheus.yml` and `*.rules.yml`, mounted read-only; only the scrape targets are rewritten to host ports, scrape interval 5 s, Alertmanager block dropped) and `grafana/grafana-oss:11.3.0` (repo provisioning and dashboards read-only, anonymous Viewer). Boots the built API, worker and event-loop probe with `OBS_METRICS_PORT` and a random token (shared Postgres, shared Redis db index 7), sends varied traffic (2xx, 4xx, 401, 404, socket.io connects to `/realtime`, queue jobs), then checks: all Prometheus targets UP, no rule with `health != ok`, every dashboard loads and the query of every panel runs (`panel-check.py`: `$__rate_interval`->5m, `$instance/$route/$queue/$service/$cache/$job/$target`->`.*`, `$compare`->5m). Screenshots of every dashboard go to `<out>/screenshots/`, per-panel results to `<out>/panels.json`.

PASS = no query errors, no unhealthy rules, all targets up, and the only empty panels are those in `expected-empty-panels.json` (each with a reason: web server not running, realtime joins need authenticated sockets, 5xx share needs 5xx errors, release comparison needs history).

Not proven: alert delivery (no Alertmanager), the `crm-web` job (the Next.js server is not started), real production load. Ports: API 3933, metrics 59533, 59633, 59733, Prometheus 59193, Grafana 53193 (override with `MON_*` env vars). Cleans up containers, network and processes on exit.
