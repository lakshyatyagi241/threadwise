#!/usr/bin/env bash
# Build the images HERE and ship them to the server; the server never builds (it is a shared host with little spare RAM).
#   SERVER=root@187.127.155.227 SSH_KEY=~/.ssh/desk_deploy ./ship.sh
# First run: also creates /opt/desk/.env with generated secrets. Re-runs keep .env and all data. Releases are blue-green (see ci-entry.sh).
set -euo pipefail
cd "$(dirname "$0")/../.."
SERVER=${SERVER:?set SERVER=user@host}
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes ${SSH_KEY:+-i "$SSH_KEY"})
TAG=$(git rev-parse --short HEAD)
DIR=/opt/desk
run() { ssh "${SSH_OPTS[@]}" "$SERVER" "$@"; }

docker build -f apps/api/Dockerfile -t "desk-api:$TAG" .
docker build -f apps/web/Dockerfile -t "desk-web:$TAG" .
run "mkdir -p $DIR"
docker save "desk-api:$TAG" "desk-web:$TAG" | gzip -1 | run "nice -n 10 sh -c 'gunzip | docker load'"
scp "${SSH_OPTS[@]}" -q deploy/hostinger/{docker-compose.yml,init-roles.sh,seed.js,ci-entry.sh,traefik-desk.yml.template,.env.example} "$SERVER:$DIR/"

run "cd $DIR && set -e
if [ ! -f .env ]; then
  cp .env.example .env
  for k in POSTGRES_PASSWORD APP_DB_PASSWORD WORKER_DB_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET WHATSAPP_VERIFY_TOKEN; do
    sed -i \"s|^\$k=CHANGE_ME|\$k=\$(openssl rand -hex 24)|\" .env
  done
  sed -i \"s|^CREDENTIALS_ENCRYPTION_KEY=CHANGE_ME|CREDENTIALS_ENCRYPTION_KEY=\$(openssl rand -base64 32)|\" .env
  chmod 600 .env
fi
# The same blue-green release the pipeline runs (ci-entry.sh): backup, migrate, idle slot healthy, traffic moved, worker restarted.
SSH_ORIGINAL_COMMAND='release $TAG' bash $DIR/ci-entry.sh
docker compose --env-file .env ps"
echo "Shipped $TAG. Seed accounts once with seed.js / the operator CLI (see README)."
