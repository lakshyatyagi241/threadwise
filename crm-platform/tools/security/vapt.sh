#!/usr/bin/env bash
# Automated VAPT run (Sheet3 #25). Boots a LOCAL API on a throwaway database, runs the repo audits, a DAST scan (OWASP ZAP when
# VAPT_ZAP=1 and the image is present, plus tools/security/vapt/dast.mjs always) and the live tests in apps/api/test/security/vapt,
# writes reports/vapt/summary.{json,md} and exits non-zero on any open Critical/High. Never touches anything but localhost.
#   bash tools/security/vapt.sh     # needs Postgres (admin) + Redis from the dev compose, `pnpm install`, workspace packages built
# Env: VAPT_API_PORT (3922) VAPT_METRICS_PORT (59522) VAPT_REDIS_URL (redis://localhost:56379/11)
#      VAPT_ADMIN_URL (postgres://crm:crm@localhost:5432, the repo's dev compose defaults, no database name)
#      VAPT_APP_CRED (crm_app_user:crm_app_dev) VAPT_ZAP=1 (image ghcr.io/zaproxy/zaproxy:stable)
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
PORT="${VAPT_API_PORT:-3922}"; MPORT="${VAPT_METRICS_PORT:-59522}"
HOSTPART="${VAPT_ADMIN_URL:-postgres://crm:crm@localhost:5432}"; APPCRED="${VAPT_APP_CRED:-crm_app_user:crm_app_dev}"
HOSTONLY="${HOSTPART#*@}"
DB="vapt_$$"; DBT="vapt_t_$$"; OUT=reports/vapt; mkdir -p "$OUT"; : > "$OUT/steps.txt"
step() { local n="$1"; shift; echo "==> $n"; "$@" > "$OUT/$n.log" 2>&1; echo "$n $?" >> "$OUT/steps.txt"; return 0; }
# psql if installed, else the dev compose container (admin user crm)
psqlx() { local url="$1"; shift; if command -v psql >/dev/null; then psql "$url" "$@"; else docker exec -i crm-platform-postgres psql -U crm -d "${url##*/}" "$@"; fi; }
cleanup() { [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null; psqlx "$HOSTPART/postgres" -c "DROP DATABASE IF EXISTS $DB" -c "DROP DATABASE IF EXISTS $DBT" >/dev/null 2>&1; }
trap cleanup EXIT

psqlx "$HOSTPART/postgres" -c "CREATE DATABASE $DB" -c "CREATE DATABASE $DBT" >/dev/null || { echo "cannot create throwaway databases"; exit 2; }
export MIGRATION_DATABASE_URL="$HOSTPART/$DB" DATABASE_URL="$HOSTPART/$DB"
step migrate pnpm db:migrate
step seed pnpm db:seed
step seed_auth pnpm --filter @crm/api seed:auth
psqlx "$HOSTPART/$DB" -f - < tools/security/vapt/seed-identities.sql > "$OUT/seed_identities.log" 2>&1

# the API runs as the restricted app role so RLS is in force, exactly like production
APPURL="postgres://${APPCRED}@${HOSTONLY}/$DB"
[ -f apps/api/dist/src/main.js ] || pnpm --filter @crm/api build > "$OUT/build.log" 2>&1
( cd apps/api && PORT="$PORT" OBS_METRICS_PORT="$MPORT" APP_URL="http://localhost:$PORT" DATABASE_URL="$APPURL" DATABASE_REPLICA_URL="$APPURL" \
  REDIS_URL="${VAPT_REDIS_URL:-redis://localhost:56379/11}" exec node dist/src/main.js ) > "$OUT/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do curl -fs "http://localhost:$PORT/docs/api.json" >/dev/null 2>&1 && break; sleep 1; done
curl -fs "http://localhost:$PORT/docs/api.json" >/dev/null || { echo "API did not boot, see $OUT/api.log"; exit 2; }

# repo audits (each writes its own report under reports/)
step audit_authz pnpm audit:authz
step audit_sast pnpm audit:sast
step audit_deps pnpm audit --prod --audit-level high
step audit_auth pnpm audit:auth
MIGRATION_DATABASE_URL="$HOSTPART/$DBT" DATABASE_URL="$HOSTPART/$DBT" pnpm db:migrate > "$OUT/migrate_tenancy.log" 2>&1
step audit_tenancy env MIGRATION_DATABASE_URL="$HOSTPART/$DBT" TENANCY_APP_DATABASE_URL="postgres://${APPCRED}@${HOSTONLY}/$DBT" pnpm audit:tenancy

# DAST: ZAP API scan when asked for, plus the own-code walker (always: fast, and it knows the seeded identities)
if [ "${VAPT_ZAP:-0}" = 1 ] && docker image inspect ghcr.io/zaproxy/zaproxy:stable >/dev/null 2>&1; then
  mkdir -p "$OUT/zap"; curl -s "http://localhost:$PORT/docs-json" -o "$OUT/zap/openapi.json"
  TOKEN=$(curl -s -XPOST "http://localhost:$PORT/v2/auth/login" -H 'content-type: application/json' \
    -d '{"email":"nachiket.challawar@geta.ai","password":"Passw0rd!"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).tokens.accessToken))')
  step zap docker run --rm --network host -v "$PWD/$OUT/zap:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py \
    -t /zap/wrk/openapi.json -f openapi -O "http://localhost:$PORT" -T 10 -I -J zap-report.json -r zap-report.html \
    -z "-config replacer.full_list(0).description=auth -config replacer.full_list(0).enabled=true -config replacer.full_list(0).matchtype=REQ_HEADER -config replacer.full_list(0).matchstr=Authorization -config replacer.full_list(0).replacement=Bearer\ $TOKEN -config scanner.threadPerHost=2"
fi
step dast node tools/security/vapt/dast.mjs --base "http://localhost:$PORT" --out "$OUT/dast.json"
step vapt_tests env VAPT_BASE_URL="http://localhost:$PORT" pnpm --filter @crm/api exec vitest run --dir test/security/vapt

# fold step exit codes into steps.json (+ the tenancy generated-scenario FAILED count, minus the known team_members probe gap)
OUT="$OUT" node -e '
const fs=require("fs"),O=process.env.OUT,s={};
for(const l of fs.readFileSync(O+"/steps.txt","utf8").trim().split("\n")){const [n,c]=l.split(" ");s[n]=+c}
try{const r=JSON.parse(fs.readFileSync("reports/tenancy-audit/latest/tenant-isolation-test-results.json"));
s.tenancy_failed_scenarios=r.results.filter(x=>x.status==="FAILED"&&x.table!=="team_members").length}catch{}
for(const k of ["migrate","seed","seed_auth","audit_sast","dast","zap","audit_tenancy"])delete s[k];
fs.writeFileSync(O+"/steps.json",JSON.stringify(s,null,1))'
node tools/security/vapt/summarize.mjs "$OUT"
