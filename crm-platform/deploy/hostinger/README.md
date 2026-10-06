# desk.wabo.ai: deployment

Runs on a shared Dokploy host: Docker Compose project `desk` in `/opt/desk` (web, api, worker, postgres+pgvector, redis,
minio). The host's Traefik owns 80/443 and issues the TLS certificate (resolver `letsencrypt`); this stack publishes no ports
and routes through container labels on `dokploy-network`: `/v2`, `/socket.io`, `/health`, `/ready`, `/api/v1` (the customer REST API) and `/docs/api.json` (its OpenAPI document) go to the API,
everything else to the web app. Images are built on a workstation and loaded over SSH (`ship.sh`), never on the host.
Memory is capped per container (about 4 GB in total) because the host runs many other apps.

## Ship / update

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
