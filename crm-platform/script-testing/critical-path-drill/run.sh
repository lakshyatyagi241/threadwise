#!/usr/bin/env bash
# Critical-path drill: real faults -> real Prometheus + Alertmanager -> real chat-bridge -> FAKE Google Chat (Critical / Slow Queries / Deploy).
# Never talks to chat.googleapis.com or any remote server. --quick = fault 1 (Postgres hang) and 4 (warning only). Exit: 0 PASS, 1 FAIL, 2 ERROR.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../_lib/common.sh"
st_init critical-path-drill "Critical path drill (real faults to the fake Google Chat Critical space)"
st_help() { cat <<'U'
run.sh [--quick] [--out DIR] [--help]
Faults: (1) Postgres black-hole -> DbPoolExhausted + PostgresDown, (2) Redis refused -> RedisDown, (3) probe at a dead port -> ApiProbeFailing,
(4) a warning-only condition (CacheMetricsMissing) must post nothing, (5) every fault ends -> RESOLVED reply in the same thread. --quick: 1 and 4.
Needs: docker (crm-platform-postgres, images prom/prometheus:v2.55.0, prom/alertmanager:v0.27.0, redis:7-alpine), node 22, built apps/api (dist).
Ports: random free ones. Time: quick ~6 min, full ~14 min. Details: README.md next to this script.
U
}
st_parse_args "$@"
cd "$ST_ROOT"
st_need docker; st_need node22
docker ps --format '{{.Names}}' | grep -qx crm-platform-postgres || st_error "crm-platform-postgres is not running"
[ -f apps/api/dist/src/main.js ] || st_error "apps/api is not built (pnpm --filter @crm/api build)"
[ -f .env ] || st_error ".env missing"
DB="critdrill_$$"; ADMIN="${ALERT_ADMIN_URL:-postgres://crm:crm@localhost:5432}"
st_cleanup_add "docker exec crm-platform-postgres psql -U crm -d postgres -c 'DROP DATABASE IF EXISTS $DB WITH (FORCE)'"
docker exec crm-platform-postgres psql -U crm -d postgres -c "CREATE DATABASE $DB" >/dev/null || st_error "cannot create database"
MIGRATION_DATABASE_URL="$ADMIN/$DB" DATABASE_URL="$ADMIN/$DB" pnpm --filter @crm/db migrate >"$OUT/logs/migrate.log" 2>&1 || st_error "migration failed (logs/migrate.log)"
st_run unit node --test tools/chat-bridge/chat-bridge.unit.test.mjs
Q=0; [ "$MODE" = quick ] && Q=1
ALERT_DB="$DB" QUICK=$Q node tools/alerting/critical-path-drill.mjs "$OUT/work" "$OUT/drill.json" >"$OUT/logs/drill.log" 2>&1 && rc=0 || rc=$?
[ "$rc" -eq 2 ] && st_error "drill could not run (logs/drill.log)"
if [ -f "$OUT/drill.json" ]; then
  while IFS='|' read -r n s d; do st_check "$n" "$s" "$d"; done < <(node -e 'for (const c of JSON.parse(require("fs").readFileSync(process.argv[1])).checks) console.log([c.name, c.pass ? "PASS" : "FAIL", c.detail].join("|"))' "$OUT/drill.json")
else st_check drill FAIL "no drill.json, see logs/drill.log"; fi
st_finish
