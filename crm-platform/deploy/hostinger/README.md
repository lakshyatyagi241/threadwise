# Deploy to the Hostinger server (desk.wabo.ai)

One VM, Docker Compose: Caddy (TLS) -> web + api, plus worker, Postgres (pgvector), Redis, MinIO. A fresh database:
roles are created on first start, every migration is applied, nothing is seeded.

## Before you start

1. DNS: an `A` record `desk.wabo.ai` -> `187.127.155.227` (not proxied). `deploy.sh` refuses to run until it resolves.
2. The server is Linux with ports 80 and 443 open. SSH in with a key, not the root password (and change that password).
3. Mail: SMTP details for sign-up verification and password reset.

## Deploy

```bash
ssh <you>@187.127.155.227
git clone <repo-url> app && cd app/crm-platform/deploy/hostinger
sudo ./deploy.sh      # 1st run writes .env with generated secrets and stops
nano .env             # set SMTP_*; adjust PG_* to the server's RAM
sudo ./deploy.sh      # 2nd run builds and starts everything
```

The script prints the command to create the first platform super admin. Then sign in at
`https://desk.wabo.ai/admin/login` (two-factor is enrolled at first sign-in). Customers register at `/signup`.

## Operate

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs -f api worker web
docker compose --env-file .env exec api node dist/src/modules/auth/cli/create-operator.js --help
```

Update: `git pull && sudo ./deploy.sh` (migrations run on every start; an already applied one is skipped).

## Back up

`docker compose exec postgres pg_dump -U crm crm | gzip > desk-$(date +%F).sql.gz`, plus the `miniodata` volume. Keep `.env`
safe: losing `CREDENTIALS_ENCRYPTION_KEY` makes stored channel credentials unreadable.

## Not covered

Meta/WhatsApp webhooks (point them at `https://desk.wabo.ai/v2/public/webhooks/whatsapp` and set the real
`WHATSAPP_APP_SECRET`), Clerk (set `CLERK_SECRET_KEY` only if used), an off-box backup, monitoring.
