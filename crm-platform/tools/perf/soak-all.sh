#!/usr/bin/env bash
# 15-minute soak of every GET endpoint with load stepped up to full load, API RAM/CPU sampled, V8 CPU profile and per-route cost per minute.
#   bash tools/perf/soak-all.sh [minutes]          (default 15)
# Needs a migrated, seeded database (tools/perf/seed.sql), Redis, the API built (pnpm --filter @crm/api build) and psql. Environment (defaults):
#   DATABASE_URL / MIGRATION_DATABASE_URL (the app and owner URLs), REDIS_URL, PSQL_URL (owner URL for psql), PERF_EMAIL, PERF_PASSWORD, PERF_ORG,
#   HEAP_MB=1024 (the API's V8 heap cap: the "controlled" memory), MAX_VUS=32, START_VUS=2, PORT=3000
# The API runs as ONE Node process with --max-old-space-size=$HEAP_MB and --cpu-prof; macOS has no cgroups, so CPU is measured, not capped.
set -eu
cd "$(dirname "$0")/../.."
ROOT=$PWD
MIN="${1:-15}"
PORT="${PORT:-3000}"
HEAP_MB="${HEAP_MB:-1024}"
PROF="$ROOT/perf/soak-all/cpuprof-$(date +%s)"
mkdir -p "$PROF"
export NODE_ENV=production LOG_LEVEL=warn CHANNEL_SIMULATOR_ENABLED=false JWT_ACCESS_TTL=3h PORT
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-$(openssl rand -base64 48 | tr -d '=+/\n')}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-$(openssl rand -base64 48 | tr -d '=+/\n')}"
export CREDENTIALS_ENCRYPTION_KEY="${CREDENTIALS_ENCRYPTION_KEY:-$(openssl rand -base64 32)}"
pkill -f "dist/src/main.js" 2>/dev/null || true; sleep 1
( cd apps/api && nohup node --max-old-space-size="$HEAP_MB" --cpu-prof --cpu-prof-dir="$PROF" --env-file=../../.env dist/src/main.js >"$PROF/api.log" 2>&1 & )
for _ in $(seq 1 60); do curl -sf "localhost:$PORT/health" >/dev/null && break; sleep 2; done
curl -sf "localhost:$PORT/health" >/dev/null || { echo "API did not start; see $PROF/api.log"; exit 1; }
API_URL="http://localhost:$PORT" node tools/perf/soak-all.mjs --minutes "$MIN" --start-vus "${START_VUS:-2}" --max-vus "${MAX_VUS:-32}" --cpuprofile "$PROF"
