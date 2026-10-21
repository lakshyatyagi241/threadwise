# desk.wabo.ai: deployment

Runs on a shared Dokploy host: Docker Compose project `desk` in `/opt/desk` (web, api, worker, postgres+pgvector, redis).
Object storage is Cloudflare R2 (S3_* in `.env`). The host's Traefik owns 80/443 and issues the TLS certificate (resolver `letsencrypt`); this stack publishes no ports
and routes through container labels on `dokploy-network`: `/v2`, `/socket.io`, `/health`, `/ready`, `/api/v1` (the customer REST API), `/public/v1` (the signed partner API: leads, flows) and `/docs/api.json` (its OpenAPI document) go to the API,
everything else to the web app. Images are built elsewhere and loaded over SSH, never on this host: a push to `main` is built on the **build
server** and released here automatically ([../build-server/README.md](../build-server/README.md)); `ship.sh` does the same by hand from a workstation.
Memory is capped per container (about 4 GB in total) because the host runs many other apps.

## Ship / update

**Normally nothing to do:** merging to `main` triggers the build server, which builds the images and runs `release` here. The release is
blue-green: it migrates (expand-only), starts the idle slot (`api-blue`/`api-green` and `web-blue`/`web-green`), moves the public routes to it
through `traefik-desk.yml.template` (written to Dokploy's Traefik dynamic directory) and restarts the worker. The old slot stops after a
minute. Shared services (Postgres, Redis) are started only if missing, never recreated by a release. Progress, logs, manual runs, rollback and key rotation:
[../build-server/README.md](../build-server/README.md). Do not run `ship.sh` while a pipeline run is in progress.

By hand from a workstation (needs Docker and the `desk_deploy` key; it builds here and then runs the same `release` as the pipeline):

```bash
SERVER=root@<host> SSH_KEY=~/.ssh/<deploy key> deploy/hostinger/ship.sh
```

Builds `desk-api` and `desk-web` tagged with the git commit, loads them, keeps `.env` and data, applies new migrations and
restarts. A first run creates `/opt/desk/.env` with generated secrets (mode 600).

## Seed (once, fresh database)

Run on the server from `/opt/desk`. Passwords are generated and written to a root-only file, never printed.

```bash
# platform super admin (two-factor is enrolled at first sign-in)
docker compose --env-file .env run --rm -T -e OPERATOR_PASSWORD='<password>' api \
  node dist/src/modules/auth/cli/create-operator.js --email superadmin@desk.wabo.ai --name "Super Admin" --role super_admin
# one workspace with the five preset roles and one account per role (owner/admin/manager/agent/viewer@demo.desk.wabo.ai)
docker compose --env-file .env run --rm -T -v ./seed.js:/app/seed.js:ro -e WORKSPACE_PASSWORD='<password>' api node /app/seed.js
```

Sign in: platform console `/admin/login`, workspace `/login`.

## Operate

```bash
cd /opt/desk
docker compose --env-file .env ps
docker compose --env-file .env logs -f api worker web
docker compose --env-file .env exec -T backup desk-backup once manual                          # dump now (nightly ones run by themselves)
```

Backups, restore and how to prove a backup works: [docs/runbooks/backup-restore.md](../../docs/runbooks/backup-restore.md). A release takes a dump
before it migrates and stops if that dump fails.

Keep `.env` safe: losing `CREDENTIALS_ENCRYPTION_KEY` makes stored channel credentials unreadable.

## Webhook API (`desk-api-hooks`)

The public webhook receiver runs in its own container, outside the blue/green slots, so a webhook flood cannot slow the dashboard API (and the reverse).

- **Route:** Traefik sends `/v2/public/webhooks/*` to `desk-api-hooks` (`traefik-desk.yml.template`, priority 200). The service is a failover: while the container answers `/health` it gets the traffic; otherwise the live slot's API does, so a restart or a failed start never refuses a webhook.
- **Release:** `ci-entry.sh` restarts it on the new tag (`HOOKS_TAG` in `.env`) after the idle slot is healthy and before the traffic switch. It is a warning, not a failure, if it does not come up; a rollback puts it back on the previous tag.
- **Pools:** every API process has two small extra DB pools, `WEBHOOK_DB_POOL_MAX` (6) and `HEALTH_DB_POOL_MAX` (2), so webhooks and `/ready` do not queue behind the dashboard's pool. Postgres `max_connections=100` covers both slots, the hooks container and the worker at these sizes.
- **Memory:** API slots 1536m, hooks 1g, Postgres 2g (`PG_SHARED_BUFFERS=512MB`, `PG_EFFECTIVE_CACHE_SIZE=1536MB` in `.env.example`; set the same in the server's `.env`). The first `compose up` after this change recreates Postgres (a few seconds of downtime): take it at a quiet hour.
- **Alerts:** `deploy/observability/webhook-ingest.rules.yml` (webhook rate and p95, DB pool full, `waba-ingest` backlog); Prometheus scrapes the container as job `crm-api-hooks`. Runbook: `docs/runbooks/p0-failure-modes.md#webhookflood`. Connections idle in a transaction are not alerted: no Postgres exporter is deployed.

## Not set up

Outgoing mail (set `SMTP_*` in `.env`, then `docker compose up -d api worker`): until then sign-up verification and password
reset emails do not send. Meta/WhatsApp webhooks (`https://desk.wabo.ai/v2/public/webhooks/whatsapp`, real
`WHATSAPP_APP_SECRET`), Clerk (`CLERK_SECRET_KEY` is a placeholder), the off-host backup settings (`OFFSITE_*`, see the backup runbook; until they are set the copies stay on this machine) and monitoring: event-loop metrics, alerts and a caller-side probe are written and rehearsed but not switched on here. `./observability-up.sh` (next to `docker-compose.yml`) starts Prometheus, Alertmanager and the probe without restarting the app; the API, web and worker serve `/metrics` from the next release on. What it does, what it needs from you (the alert destination) and how to test it: [docs/performance/event-loop/event-loop-observability-runbook.md](../../docs/performance/event-loop/event-loop-observability-runbook.md).

**Grafana (optional, behind a login).** Not live until the server owner does this, once: (1) create a DNS A record for `GRAFANA_DOMAIN` (default `grafana.<DOMAIN>`) pointing at this host; (2) copy `observability.compose.yml`, `observability-up.sh` and `traefik-grafana.yml.template` next to `docker-compose.yml` (ship.sh does not copy them) and optionally set `GRAFANA_DOMAIN` in `.env`; (3) run `./observability-up.sh`, which makes `secrets/grafana_admin_password` (random, never printed) and writes Traefik's `grafana.yml` route beside `desk.yml`; (4) `docker compose -f docker-compose.yml -f observability.compose.yml --env-file .env pull grafana`, then the same with `up -d grafana`. Log in at `https://GRAFANA_DOMAIN` as `admin` with the contents of `secrets/grafana_admin_password` (read it on the server with `cat`; mode 644 inside a 700 directory). Rotate: delete that file, re-run `./observability-up.sh`, `up -d --force-recreate grafana`, then `docker compose ... exec grafana grafana cli admin reset-admin-password --password-from-stdin < secrets/grafana_admin_password` (Grafana stores the password in its database after the first start). Releases (`ci-entry.sh`) never start, stop or route Grafana. Memory: 256m.
