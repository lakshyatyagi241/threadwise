#!/usr/bin/env bash
# CRM Platform — local environment setup.
#
# Idempotent: safe to run every time. Each step checks what's already true
# before doing anything, so a second run only touches what's missing.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

# ---- output helpers ---------------------------------------------------------
c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_red=$'\033[31m'; c_blue=$'\033[34m'
step() { echo "${c_bold}${c_blue}==>${c_reset} $*"; }
ok()   { echo "${c_green}  ok${c_reset}  $*"; }
warn() { echo "${c_yellow}  !!${c_reset}  $*"; }
fail() { echo "${c_red}  x${c_reset}  $*"; }
die()  { fail "$*"; exit 1; }

# =============================================================================
# 1. Prerequisites
# =============================================================================
step "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 22+ (see .nvmrc): https://nodejs.org or nvm."
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR" -ge 22 ] || die "Node $(node -v) found, this repo needs 22+. Run: nvm install 22 && nvm use 22"
ok "Node $(node -v)"

command -v docker >/dev/null 2>&1 || die "Docker not found. Install Docker Desktop (or the docker engine) and re-run."
docker info >/dev/null 2>&1 || die "Docker isn't running. Start Docker Desktop, then re-run this skill."
ok "Docker running"

command -v curl >/dev/null 2>&1 || die "curl not found. Install it (apt install curl / brew install curl) and re-run."

corepack enable pnpm >/dev/null 2>&1 || true
command -v pnpm >/dev/null 2>&1 || corepack prepare pnpm@9.15.4 --activate >/dev/null 2>&1 || true
command -v pnpm >/dev/null 2>&1 || die "pnpm still unavailable after corepack enable. Try: npm i -g pnpm"
ok "pnpm $(pnpm -v)"

# =============================================================================
# 2. .env
# =============================================================================
step "Environment file"

if [ ! -f .env ]; then
  cp .env.example .env
  ok "Created .env from .env.example"
else
  ok ".env already exists — leaving your values as-is"
fi

get_env() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2-; }
set_env() {
  local key="$1" val="$2"
  if grep -qE "^$key=" .env; then
    sed -i.bak -E "s#^$key=.*#$key=$val#" .env && rm -f .env.bak
  else
    echo "$key=$val" >> .env
  fi
}

# =============================================================================
# 3. Docker infra — reuse if already healthy, otherwise start (remapping any
#    ports that collide with something else already running on this machine)
# =============================================================================
step "Checking Docker infra"

container_healthy() {
  local name="$1" status
  status="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null)" || return 1
  [ "$status" = "healthy" ] || [ "$status" = "running" ]
}

infra_up() { container_healthy crm-platform-postgres && container_healthy crm-platform-redis; }

port_in_use() {
  local port="$1"
  if (: >"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then return 0; else return 1; fi
}

find_free_port() {
  local base="$1"
  local p="$base"
  if ! port_in_use "$p"; then echo "$p"; return; fi
  p=$((base + 50000))
  while port_in_use "$p"; do p=$((p + 1)); done
  echo "$p"
}

if infra_up; then
  ok "Postgres/Redis already running from a previous setup — reusing them"
else
  PG_PORT="$(get_env POSTGRES_PORT)"; PG_PORT="${PG_PORT:-5432}"
  RD_PORT="$(get_env REDIS_PORT)";    RD_PORT="${RD_PORT:-6379}"
  MN_PORT="$(get_env MINIO_PORT)";    MN_PORT="${MN_PORT:-9000}"
  MC_PORT="$(get_env MINIO_CONSOLE_PORT)"; MC_PORT="${MC_PORT:-9001}"
  MS_PORT="$(get_env MAILPIT_SMTP_PORT)";  MS_PORT="${MS_PORT:-1025}"
  MU_PORT="$(get_env MAILPIT_UI_PORT)";    MU_PORT="${MU_PORT:-8025}"
  API_PORT_CUR="$(get_env PORT)";          API_PORT_CUR="${API_PORT_CUR:-3000}"

  NEW_PG="$(find_free_port "$PG_PORT")"
  NEW_RD="$(find_free_port "$RD_PORT")"
  NEW_MN="$(find_free_port "$MN_PORT")"
  NEW_MC="$(find_free_port "$MC_PORT")"
  NEW_MS="$(find_free_port "$MS_PORT")"
  NEW_MU="$(find_free_port "$MU_PORT")"
  NEW_API="$(find_free_port "$API_PORT_CUR")"

  remapped=0
  remap() {
    local var="$1" old="$2" new="$3"
    if [ "$old" != "$new" ]; then
      warn "Port $old busy — using $new for $var"
      set_env "$var" "$new"
      remapped=1
    fi
  }
  remap POSTGRES_PORT "$PG_PORT" "$NEW_PG"
  remap REDIS_PORT "$RD_PORT" "$NEW_RD"
  remap MINIO_PORT "$MN_PORT" "$NEW_MN"
  remap MINIO_CONSOLE_PORT "$MC_PORT" "$NEW_MC"
  remap MAILPIT_SMTP_PORT "$MS_PORT" "$NEW_MS"
  remap MAILPIT_UI_PORT "$MU_PORT" "$NEW_MU"
  remap PORT "$API_PORT_CUR" "$NEW_API"

  if [ "$remapped" -eq 1 ]; then
    set_env DATABASE_URL "postgres://crm_app_user:crm_app_dev@localhost:$NEW_PG/crm"
    set_env MIGRATION_DATABASE_URL "postgres://crm:crm@localhost:$NEW_PG/crm"
    set_env DATABASE_REPLICA_URL "postgres://crm_app_user:crm_app_dev@localhost:$NEW_PG/crm"
    set_env REDIS_URL "redis://localhost:$NEW_RD"
    set_env S3_ENDPOINT "http://localhost:$NEW_MN"
    set_env SMTP_PORT "$NEW_MS"
    set_env APP_URL "http://localhost:$NEW_API"
    ok "Remapped conflicting ports in .env"
  else
    ok "Default ports are free"
  fi

  step "Starting Docker infra (postgres, redis, minio, mailpit)"
  pnpm infra:up

  step "Waiting for Postgres and Redis to be healthy"
  healthy=0
  for _ in $(seq 1 30); do
    if infra_up; then healthy=1; break; fi
    sleep 2
  done
  [ "$healthy" -eq 1 ] || die "Postgres/Redis didn't become healthy in time. Check: docker compose logs"
  ok "Infra healthy"
fi

API_PORT="$(get_env PORT)"; API_PORT="${API_PORT:-3000}"

# =============================================================================
# 4. Install dependencies
# =============================================================================
step "Installing dependencies"
pnpm install --prefer-offline
ok "Dependencies installed"

# =============================================================================
# 5. Build shared packages (the app imports their compiled dist/, not source)
# =============================================================================
step "Building shared packages"
pnpm --filter @crm/tax build
pnpm --filter @crm/contracts build
pnpm --filter @crm/db build
ok "Tax, contracts and DB packages built"

# =============================================================================
# 6. Restricted app role — normally created by docker/postgres/init/ on first
#    container start; self-heals the rare case of an older data volume that
#    predates it. The app must NOT connect as the Postgres superuser or Row-
#    Level Security silently does nothing (see docs/architecture/multi-tenancy.md).
# =============================================================================
step "Checking database roles"
ROLE_EXISTS="$(docker exec crm-platform-postgres psql -U crm -d crm -tAc \
  "SELECT 1 FROM pg_roles WHERE rolname='crm_app_user'" 2>/dev/null || true)"
if [ "$ROLE_EXISTS" != "1" ]; then
  warn "crm_app_user role missing — creating it"
  docker exec -i crm-platform-postgres psql -U crm -d crm -v ON_ERROR_STOP=1 \
    < docker/postgres/init/01-app-roles.sql
  ok "Created crm_app_user / crm_worker_user"
else
  ok "Database roles already present"
fi

# =============================================================================
# 7. Migrate
# =============================================================================
step "Running database migrations"
pnpm db:migrate
ok "Migrations up to date"

# =============================================================================
# 8. Seed (skip if already seeded — the seed script isn't safe to run twice,
#    it would insert a second batch of demo contacts)
# =============================================================================
step "Seeding demo data"
SEEDED="$(docker exec crm-platform-postgres psql -U crm -d crm -tAc   "SELECT 1 FROM organizations WHERE slug='Admin'" 2>/dev/null || true)"
if [ "$SEEDED" = "1" ]; then
  ok "Demo data already seeded — skipping"
else
  pnpm db:seed
  ok "Seeded 2 tenants, staff admin, a sub-agent, and demo contacts"
fi

# =============================================================================
# 9. Build the API and boot it briefly to prove the whole stack actually works
# =============================================================================
step "Building API"
pnpm --filter @crm/api build
ok "API built"

step "Booting API to verify health"
LOG_FILE="$(mktemp)"
node apps/api/dist/src/main.js > "$LOG_FILE" 2>&1 &
API_PID=$!
trap 'kill $API_PID >/dev/null 2>&1 || true' EXIT

HEALTHY=0
for _ in $(seq 1 20); do
  if curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 1
done

if [ "$HEALTHY" -eq 1 ]; then
  READY="$(curl -s "http://localhost:$API_PORT/ready")"
  ok "API boots — /health OK"
  echo "        /ready -> $READY"
else
  fail "API didn't come up. Last 30 log lines:"
  tail -n 30 "$LOG_FILE"
  die "Setup incomplete — fix the error above and re-run this skill."
fi

kill $API_PID >/dev/null 2>&1 || true
trap - EXIT
rm -f "$LOG_FILE"

# =============================================================================
# Summary
# =============================================================================
echo
echo "${c_bold}${c_green}Setup complete.${c_reset}"
echo
echo "  Start the app:"
echo "    pnpm dev            # API on http://localhost:$API_PORT"
echo "    pnpm dev:worker     # background jobs, in a second terminal"
echo
echo "  API docs:  http://localhost:$API_PORT/docs"
echo
echo "  ${c_bold}Staff login${c_reset}  nachiket.challawar@geta.ai   (org: Admin; Clerk sign-in, the seed sets no password)"
echo "  ${c_bold}Agent login${c_reset}  agent@Admin.test / Passw0rd!"
echo
echo "  Troubleshooting: docs/runbooks/local-development.md"
