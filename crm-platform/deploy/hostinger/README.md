# desk.wabo.ai: deployment

Runs on a shared Dokploy host: Docker Compose project `desk` in `/opt/desk` (web, api, worker, postgres+pgvector, redis,
minio). The host's Traefik owns 80/443 and issues the TLS certificate (resolver `letsencrypt`); this stack publishes no ports
and routes through container labels on `dokploy-network`: `/v2`, `/socket.io`, `/health`, `/ready`, `/api/v1` (the customer REST API), `/public/v1` (the signed partner API: leads, flows) and `/docs/api.json` (its OpenAPI document) go to the API,
everything else to the web app. Images are built elsewhere and loaded over SSH, never on this host: a push to `main` is built on the **build
server** and released here automatically ([../build-server/README.md](../build-server/README.md)); `ship.sh` does the same by hand from a workstation.
Memory is capped per container (about 4 GB in total) because the host runs many other apps.

## Ship / update

**Normally nothing to do:** merging to `main` triggers the build server, which builds the images and runs `release` here. The release is
blue-green: it migrates (expand-only), starts the idle slot (`api-blue`/`api-green` and `web-blue`/`web-green`), moves the public routes to it
through `traefik-desk.yml.template` (written to Dokploy's Traefik dynamic directory) and restarts the worker. The old slot stops after a
minute. Shared services (Postgres, Redis, MinIO) are started only if missing, never recreated by a release. Progress, logs, manual runs, rollback and key rotation:
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

## Not set up

Outgoing mail (set `SMTP_*` in `.env`, then `docker compose up -d api worker`): until then sign-up verification and password
reset emails do not send. Meta/WhatsApp webhooks (`https://desk.wabo.ai/v2/public/webhooks/whatsapp`, real
`WHATSAPP_APP_SECRET`), Clerk (`CLERK_SECRET_KEY` is a placeholder), the off-host backup settings (`OFFSITE_*`, see the backup runbook; until they are set the copies stay on this machine) and monitoring.
