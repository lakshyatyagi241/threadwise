#!/usr/bin/env bash
# Deploys the stack on the server. Run it ON the server, from a checkout of the repo:
#   git clone <repo> && cd <repo>/crm-platform/deploy/hostinger && sudo ./deploy.sh
# Idempotent: re-running pulls nothing, keeps your .env and data, rebuilds and restarts.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || { say "Installing Docker"; curl -fsSL https://get.docker.com | sh; }
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (apt-get install docker-compose-plugin)."

if [ ! -f .env ]; then
  say "Creating .env with generated secrets"
  cp .env.example .env
  secret() { openssl rand -hex 24; }
  for key in POSTGRES_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD MINIO_ROOT_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET WHATSAPP_VERIFY_TOKEN; do
    sed -i "s|^${key}=CHANGE_ME|${key}=$(secret)|" .env
  done
  sed -i "s|^CREDENTIALS_ENCRYPTION_KEY=CHANGE_ME|CREDENTIALS_ENCRYPTION_KEY=$(openssl rand -base64 32)|" .env
  chmod 600 .env
  echo "Created .env. Edit SMTP_* (and CLERK_SECRET_KEY if used), then re-run this script."
  [ "${SKIP_ENV_REVIEW:-0}" = "1" ] || exit 0
fi

grep -q CHANGE_ME .env && die ".env still has CHANGE_ME values."
DOMAIN=$(grep '^DOMAIN=' .env | cut -d= -f2)
PUBLIC_IP=$(curl -fsS https://api.ipify.org || true)
RESOLVED=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
if [ -n "$PUBLIC_IP" ] && [ "$RESOLVED" != "$PUBLIC_IP" ]; then
  die "$DOMAIN resolves to '${RESOLVED:-nothing}', this server is $PUBLIC_IP. Add the DNS A record first (Caddy needs it to get the certificate)."
fi

say "Building and starting (first build takes several minutes)"
docker compose --env-file .env up -d --build

say "Waiting for the API"
for _ in $(seq 1 60); do
  docker compose --env-file .env exec -T api node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && ok=1 && break
  sleep 5
done
[ "${ok:-0}" = "1" ] || { docker compose --env-file .env logs --tail=60 api; die "API did not become ready."; }

say "Done: https://$DOMAIN"
echo "Create the first platform super admin (two-factor is enrolled at first sign-in):"
echo "  docker compose --env-file .env exec -e OPERATOR_PASSWORD='<choose one>' api node dist/src/modules/auth/cli/create-operator.js --email you@wabo.ai --name 'Your Name' --role super_admin"
