#!/usr/bin/env bash
# VAPT (Sheet3 #25): one command that boots a LOCAL API on a throwaway database and runs the repo audits, the DAST walker, the live
# attack tests and (full mode) an OWASP ZAP API scan, then judges everything against known-baseline.json.
# Exit: 0 PASS, 1 FAIL (new Critical/High or failing test), 2 ERROR (could not run). Attacks localhost only.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$PATH"

MODE=full; OUT=""; ZAP_CAP_MIN="${VAPT_ZAP_CAP_MIN:-15}"
usage() { cat <<'E'
run.sh [--quick] [--out DIR] [--zap-cap MINUTES] [--help]
Tests: repo audits (auth, authz, tenancy with a real DB, sast, prod dependencies), own DAST walker over every OpenAPI operation,
18 live attack tests (IDOR, privilege escalation, JWT, refresh replay, public tokens, webhooks, CSV injection, upload), and in full
mode an authenticated OWASP ZAP API scan (default cap 15 min; no report = reported as TIMED OUT and FAIL, never a pass).
Needs: docker (dev compose postgres crm-platform-postgres + redis on 56379), node 22, pnpm, curl. Time: quick ~8 min, full ~25 min.
Known open items are in known-baseline.json; the run passes with only those and fails on anything new.
E
}
while [ $# -gt 0 ]; do case "$1" in
  --quick) MODE=quick ;; --out) OUT="$2"; shift ;; --zap-cap) ZAP_CAP_MIN="$2"; shift ;; --help|-h) usage; exit 0 ;;
  *) echo "unknown option $1"; usage; exit 2 ;; esac; shift; done

STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="${OUT:-qa-results/vapt/$(date +%Y%m%d-%H%M%S)}"; mkdir -p "$OUT/logs"; OUT="$(cd "$OUT" && pwd)"
RERUN="bash script-testing/vapt/run.sh$([ "$MODE" = quick ] && echo ' --quick')"
RID="$$"; DB="vapt_$RID"; DBT="vapt_t_$RID"; ZAPNAME="vapt_zap_$RID"
HOSTPART="${VAPT_ADMIN_URL:-postgres://crm:crm@localhost:5432}"; APPCRED="${VAPT_APP_CRED:-crm_app_user:crm_app_dev}"
HOSTONLY="${HOSTPART#*@}"; REDIS="${VAPT_REDIS_URL:-redis://localhost:56379/11}"
API_PID=""
err() { echo "ERROR: $*" >&2; exit 2; }
psqlx() { local url="$1"; shift; if command -v psql >/dev/null; then psql "$url" "$@"; else docker exec -i crm-platform-postgres psql -U crm -d "${url##*/}" "$@"; fi; }
cleanup() {
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null
  docker rm -f "$ZAPNAME" >/dev/null 2>&1
  psqlx "$HOSTPART/postgres" -c "DROP DATABASE IF EXISTS $DB" -c "DROP DATABASE IF EXISTS $DBT" >/dev/null 2>&1
}
trap cleanup EXIT; trap 'exit 130' INT TERM
# run a named step in the foreground; the exit code goes to logs/<name>.exit
step() { local n="$1"; shift; echo "==> $n"; "$@" > "$OUT/logs/$n.log" 2>&1; echo $? > "$OUT/logs/$n.exit"; }
bg() { local n="$1"; shift; ( "$@" > "$OUT/logs/$n.log" 2>&1; echo $? > "$OUT/logs/$n.exit" ) & }

# --- prerequisites ---
command -v node >/dev/null || err "node not found"; [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || err "node 22+ needed"
command -v pnpm >/dev/null || { corepack enable pnpm >/dev/null 2>&1; command -v pnpm >/dev/null || err "pnpm not found"; }
command -v curl >/dev/null || err "curl not found"
docker info >/dev/null 2>&1 || err "docker is not running"
psqlx "$HOSTPART/postgres" -c "select 1" >/dev/null 2>&1 || err "Postgres not reachable at $HOSTPART (start the dev compose: docker compose up -d postgres redis)"
[ -f .env ] || err ".env missing (copy it from the main checkout or .env.example)"
[ "$MODE" = quick ] || docker image inspect ghcr.io/zaproxy/zaproxy:stable >/dev/null 2>&1 || docker pull ghcr.io/zaproxy/zaproxy:stable >/dev/null 2>&1 || err "cannot pull ghcr.io/zaproxy/zaproxy:stable (use --quick)"
freeport() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }
PORT="$(freeport)"; MPORT="$(freeport)"
for p in tax contracts db observability; do [ -d "packages/$p/dist" ] || { echo "building @crm/$p"; pnpm --filter "@crm/$p" build > "$OUT/logs/build_$p.log" 2>&1 || err "build of @crm/$p failed"; }; done
[ -f apps/api/dist/src/main.js ] || { echo "building @crm/api"; pnpm --filter @crm/api build > "$OUT/logs/build_api.log" 2>&1 || err "api build failed"; }

# --- throwaway databases and identities ---
psqlx "$HOSTPART/postgres" -c "CREATE DATABASE $DB" -c "CREATE DATABASE $DBT" >/dev/null || err "cannot create throwaway databases"
bg migrate_tenancy env MIGRATION_DATABASE_URL="$HOSTPART/$DBT" DATABASE_URL="$HOSTPART/$DBT" pnpm db:migrate
export MIGRATION_DATABASE_URL="$HOSTPART/$DB" DATABASE_URL="$HOSTPART/$DB" REDIS_URL="$REDIS"
step migrate pnpm db:migrate
step seed pnpm db:seed
step seed_auth pnpm --filter @crm/api seed:auth
psqlx "$HOSTPART/$DB" -f - < tools/security/vapt/seed-identities.sql > "$OUT/logs/seed_identities.log" 2>&1
for n in migrate seed seed_auth; do [ "$(cat "$OUT/logs/$n.exit")" = 0 ] || { tail -5 "$OUT/logs/$n.log"; err "setup step $n failed"; }; done

# --- boot the API as the restricted app role (RLS in force) ---
APPURL="postgres://${APPCRED}@${HOSTONLY}/$DB"
( cd apps/api && PORT="$PORT" OBS_METRICS_PORT="$MPORT" APP_URL="http://localhost:$PORT" DATABASE_URL="$APPURL" DATABASE_REPLICA_URL="$APPURL" \
  MIGRATION_DATABASE_URL="$HOSTPART/$DB" REDIS_URL="$REDIS" exec node dist/src/main.js ) > "$OUT/logs/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 90); do curl -fs "http://localhost:$PORT/docs/api.json" >/dev/null 2>&1 && break; kill -0 "$API_PID" 2>/dev/null || break; sleep 1; done
curl -fs "http://localhost:$PORT/docs/api.json" >/dev/null || { tail -5 "$OUT/logs/api.log"; err "API did not boot"; }

# --- the checks: audits in parallel, then the attacks (the attacks are serial: they share one API and its rate limits) ---
bg audit_authz pnpm audit:authz
bg audit_sast pnpm audit:sast
bg audit_deps pnpm audit --prod --audit-level high
bg audit_auth pnpm audit:auth
until [ -f "$OUT/logs/migrate_tenancy.exit" ]; do sleep 2; done
[ "$(cat "$OUT/logs/migrate_tenancy.exit")" = 0 ] || err "tenancy database migration failed"
step audit_tenancy env MIGRATION_DATABASE_URL="$HOSTPART/$DBT" DATABASE_URL="$HOSTPART/$DBT" TENANCY_APP_DATABASE_URL="postgres://${APPCRED}@${HOSTONLY}/$DBT" pnpm audit:tenancy
for n in audit_authz audit_sast audit_deps audit_auth; do until [ -f "$OUT/logs/$n.exit" ]; do sleep 2; done; done
# the login throttles live in Redis and outlast a run (5 to 15 min): clear ONLY this host's auth throttle keys in our db so a previous run cannot lock this one out
RDB="${REDIS##*/}"
for pat in 'auth:ipfail:*:127.0.0.1' 'auth:ipfail:*:::1' 'auth:ip:*:127.0.0.1' 'auth:ip:*:::1' 'auth:lock:*' 'auth:acct-fail:*' 'rl:*login*'; do
  docker exec crm-platform-redis sh -c "redis-cli -n $RDB --scan --pattern '$pat' | xargs -r redis-cli -n $RDB del" >/dev/null 2>&1
done
step vapt_tests env VAPT_BASE_URL="http://localhost:$PORT" pnpm --filter @crm/api exec vitest run --dir test/security/vapt
# DAST last: its brute-force check trips the per-IP login ceiling, which would lock the live tests out
step dast node tools/security/vapt/dast.mjs --base "http://localhost:$PORT" --out "$OUT/dast.json"

ZAPSTATE=skipped
if [ "$MODE" = full ]; then
  mkdir -p "$OUT/zap"; chmod 777 "$OUT/zap"; curl -s "http://localhost:$PORT/docs-json" -o "$OUT/zap/openapi.json"
  TOKEN=$(curl -s -XPOST "http://localhost:$PORT/v2/auth/login" -H 'content-type: application/json' -d '{"email":"nachiket.challawar@geta.ai","password":"Passw0rd!"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tokens.accessToken))')
  echo "==> zap (cap ${ZAP_CAP_MIN} min)"
  # the access token lives 15 minutes; a longer cap would scan unauthenticated after expiry
  timeout "$((ZAP_CAP_MIN * 60))" docker run --rm --name "$ZAPNAME" --network host -v "$OUT/zap:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py \
    -t /zap/wrk/openapi.json -f openapi -O "http://localhost:$PORT" -T "$((ZAP_CAP_MIN > 12 ? 10 : ZAP_CAP_MIN - 2))" -I -J zap-report.json -r zap-report.html \
    -z "-config replacer.full_list(0).description=auth -config replacer.full_list(0).enabled=true -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization -config replacer.full_list(0).replacement=Bearer\ $TOKEN -config scanner.threadPerHost=2" \
    > "$OUT/logs/zap.log" 2>&1
  zc=$?; docker rm -f "$ZAPNAME" >/dev/null 2>&1
  if [ -f "$OUT/zap/zap-report.json" ]; then ZAPSTATE=completed; elif [ "$zc" = 124 ]; then ZAPSTATE="TIMED OUT after ${ZAP_CAP_MIN} min"; else ZAPSTATE="SKIPPED (zap exit $zc, no report)"; fi
fi

node "$HERE/gate.mjs" "$OUT" "$MODE" "$STARTED" "$ZAPSTATE" "$RERUN"
exit $?
