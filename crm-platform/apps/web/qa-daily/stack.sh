#!/usr/bin/env bash
# Throwaway local stack for the QA journeys and for checking a fix before it is merged: its own database (crm_qa), seeded, API :3000, web :3001.
#   qa-daily/stack.sh up      create/seed (first time), start API + web, wait until healthy, write qa-daily/out/stack.env
#   qa-daily/stack.sh down    stop them
# Needs the dev Postgres + Redis (docker compose) and a built API and web. Never touches the `crm` database.
set -euo pipefail
cd "$(dirname "$0")/../../.."   # crm-platform/
OUT="$PWD/apps/web/qa-daily/out"; mkdir -p "$OUT"
QA_DB="${QA_DB:-crm_qa}"
QA_PW="${QA_LOCAL_PASSWORD:-Qa-Local-Pass1x}"
QA_OP_PW="${QA_LOCAL_OP_PASSWORD:-Qa-Local-Op-Pass1x}"
OP_EMAIL="qa-operator@example.test"

if [ "${1:-}" = "down" ]; then
  [ -f "$OUT/stack.pids" ] && xargs -r kill < "$OUT/stack.pids" 2>/dev/null || true
  rm -f "$OUT/stack.pids"; exit 0
fi

# .env is not shell-safe (unquoted values with spaces), so read only the three database URLs
for v in DATABASE_URL MIGRATION_DATABASE_URL DATABASE_REPLICA_URL; do export "$v=$(grep -m1 "^$v=" .env | cut -d= -f2-)"; done
swap() { echo "$1" | sed -E "s#/[A-Za-z0-9_]+(\?.*)?\$#/$QA_DB\1#"; }
export DATABASE_URL="$(swap "$DATABASE_URL")" MIGRATION_DATABASE_URL="$(swap "$MIGRATION_DATABASE_URL")"
[ -n "${DATABASE_REPLICA_URL:-}" ] && export DATABASE_REPLICA_URL="$(swap "$DATABASE_REPLICA_URL")"

# create the database once, through the migration role (psql if installed, else the dev Postgres container)
ADMIN_URL="$(echo "$MIGRATION_DATABASE_URL" | sed -E 's#/[A-Za-z0-9_]+$#/postgres#')"
pg() {
  if command -v psql >/dev/null; then psql "$ADMIN_URL" -Atc "$1"
  else docker exec crm-platform-postgres psql -U "$(echo "$MIGRATION_DATABASE_URL" | sed -E 's#postgres://([^:]+):.*#\1#')" -d postgres -Atc "$1"; fi
}
pg "select 1 from pg_database where datname='$QA_DB'" | grep -q 1 || pg "create database $QA_DB"
STATE="${QA_STATE_DIR:-$HOME/.local/state/wadesk-qa}"; mkdir -p "$STATE"
SEEDED="$STATE/seeded-$QA_DB"
pnpm db:migrate # idempotent: a newer build may bring migrations
if [ ! -f "$SEEDED" ]; then
  ALLOW_DEV_SEED=1 DEV_SEED_PASSWORD="$QA_PW" pnpm db:seed
  OPERATOR_PASSWORD="$QA_OP_PW" pnpm --filter @crm/api operator:create -- --email "$OP_EMAIL" --name "QA Operator"
  touch "$SEEDED"
fi

: > "$OUT/stack.pids"
(cd apps/api && nohup node dist/src/main.js > "$OUT/api.log" 2>&1 & echo $! >> "$OUT/stack.pids") >/dev/null 2>&1
for i in $(seq 1 60); do curl -fsS http://localhost:3000/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://localhost:3000/health >/dev/null || { tail -n 30 "$OUT/api.log"; exit 1; }
(cd apps/web && nohup node node_modules/next/dist/bin/next start -p 3001 > "$OUT/web.log" 2>&1 & echo $! >> "$OUT/stack.pids") >/dev/null 2>&1
for i in $(seq 1 60); do curl -fsS http://localhost:3001/login >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://localhost:3001/login >/dev/null || { tail -n 30 "$OUT/web.log"; exit 1; }

cat > "$OUT/stack.env" <<ENV
export QA_TARGET=local QA_BASE_URL=http://localhost:3001
export QA_PASSWORD='$QA_PW' QA_OP_EMAIL='$OP_EMAIL' QA_OP_PASSWORD='$QA_OP_PW'
ENV
echo "stack up: web :3001, api :3000, db $QA_DB (credentials in $OUT/stack.env)"
