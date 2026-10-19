# Grafana dashboards (EL-B04)

Five dashboards for the metrics the API, the worker, the web server and the probe export. Nothing here runs in production: the production
overlay (`deploy/hostinger/observability.compose.yml`) does not start Grafana, because a fifth container on the shared host is the
owner's call (see "Running it" below).

| File                                     | uid                      | Answers                                                                                                                                                                         |
| ---------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboards/crm-api.json`                | `crm-api`                | Is the API up, what do callers see (probe), request latency and errors by route, loop delay, heap, GC, CPU                                                                      |
| `dashboards/crm-workers.json`            | `crm-workers`            | Is work waiting (job wait p95), throughput, failures and retries per queue, the worker loop, heap, GC, CPU                                                                      |
| `dashboards/crm-web.json`                | `crm-web`                | Is the Next.js server up, requests by route template (latency, status, 5xx share), what callers see (probe of `/robots.txt`), its loop, heap, GC, CPU                           |
| `dashboards/crm-realtime.json`           | `crm-realtime`           | The loop behind the sockets (they live in the API process) and the realtime path itself: sockets, handshakes, room joins, events published by type, publish failures and cost   |
| `dashboards/crm-release-comparison.json` | `crm-release-comparison` | The same loop, latency, error, heap and queue queries now against 1 h, 6 h, 1 d, 3 d or 7 d earlier, with process restarts marked, and grouped BY RELEASE (the `release` label) |

## What they do not show

- **Realtime:** delivery to a browser (the server cannot see a client receive a packet), Redis adapter lag, and the number of
  rooms. The dashboard says so on its face; the publish duration shown is the publisher's own cost, not time to the client.
- **Release comparison:** the `release` label is the image tag (`OBS_RELEASE`, set by the observability overlay). A process started
  without it, and any series recorded before the label existed, shows an empty release name. The time-offset panels remain for
  comparing against "the same hour yesterday". Read a difference next to the traffic panel: load moves latency too.
- **Web:** the route is derived from the URL (the server cannot see which route file ran): ids become `:id`, every 404 is
  `unmatched`, Next's asset URLs are folded. Time spent queued behind a blocked loop is not in the request histogram; the probe
  graph is the view that includes it.

## Files

- `dashboards/*.json` are **generated**: edit `tools/event-loop-audit/dashboards/build.mjs`, run it, commit the JSON.
  `node tools/event-loop-audit/dashboards/build.mjs --check` fails when they differ.
- `provisioning/datasources/prometheus.yml` – one data source, uid `crm-prometheus`, `http://prometheus:9090`.
- `provisioning/dashboards/dashboards.yml` – loads `/var/lib/grafana/dashboards` into a "Threadwise" folder, read-only in the UI.

## Checked

- `apps/api/test/unit/platform-infrastructure/dashboards.spec.ts`: every metric is one the code exports, every variable is declared,
  PromQL is balanced and `offset` is placed after a selector, every panel uses the provisioned data source.
- `node tools/event-loop-audit/scrape-demo.mjs --grafana`: a real Grafana 11.3.0 provisions the five dashboards from these files and
  every panel query is run through Grafana's own `/api/ds/query` against a real Prometheus scraping a real API, worker and probe.

## Running it

Locally, next to the demo stack, or on the host as an extra service. For the host it is one service added to the overlay, behind an
SSH tunnel like Prometheus (no published port, no Traefik route):

```yaml
grafana:
  image: grafana/grafana:11.3.0
  restart: unless-stopped
  mem_limit: 256m
  environment:
    GF_SECURITY_ADMIN_PASSWORD__FILE: /run/secrets/grafana_admin_password
    GF_USERS_ALLOW_SIGN_UP: 'false'
    GF_ANALYTICS_REPORTING_ENABLED: 'false'
  volumes:
    - ../observability/grafana/provisioning:/etc/grafana/provisioning:ro
    - ../observability/grafana/dashboards:/var/lib/grafana/dashboards:ro
    - grafanadata:/var/lib/grafana
  secrets: [grafana_admin_password]
  depends_on: [prometheus]
```

That snippet is NOT VERIFIED on the host (it is the shape the demo runs, with a file secret instead of an environment variable).
Decisions that are the owner's: whether to run Grafana on the shared host at all, who gets the admin password, and whether it is
ever exposed beyond a tunnel.
