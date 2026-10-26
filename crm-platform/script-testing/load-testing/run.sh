#!/usr/bin/env bash
set -euo pipefail
RI_ID=load-testing; RI_SHEET=53; RI_TITLE="Load testing (concurrent active users)"
RI_HELP="Boots the built API on a throwaway database (own free ports, Redis db 7), seeds one organisation (tools/perf/seed.sql, scaled down) plus N staff users (tools/perf/seed-users.sql), then runs perf/load.js with k6 (local k6, else docker grafana/k6:0.54.0 on the host network): each virtual user signs in once and does a realistic staff mix with think time. Judges the result against perf/budgets.json: error rate under 1% and per-class p95 under budget x LOAD_P95_FACTOR (default 3: the budgets are for a dedicated machine, a laptop shares cores between k6, API, Postgres and Redis; set 1 for the strict budget) and prints p50/p95/p99, error rate and throughput.
--quick: 30 users, 10 s ramp + 45 s hold (~2 min incl. boot). Full (default): 150 users, 30 s ramp + 120 s hold. LOAD_USERS=<n> overrides the user count.
HONEST SCOPE: the sheet target is 500 concurrent users. A laptop shares its cores between k6, API, Postgres and Redis, so this is a SCALED profile; the 500-user run belongs on a dedicated stack (k6 run perf/load.js -e USERS=500, see docs/quality/performance-testing.md).
Needs: docker, node 22, pnpm, running crm-platform-postgres and crm-platform-redis; builds the API if apps/api/dist is missing (~2 min)."
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common.sh"
ri_init "$@"
ri_prereqs docker node pnpm deps postgres redis
ri_build_packages
if [ "$RI_MODE" = quick ]; then USERS=${LOAD_USERS:-30}; RAMP=10; HOLD=45; else USERS=${LOAD_USERS:-150}; RAMP=30; HOLD=120; fi
cd "$CRM_ROOT"
[ -f apps/api/dist/src/main.js ] || ri_step build-api pnpm --filter @crm/api build || ri_die "api build failed"
ri_create_db
(MIGRATION_DATABASE_URL="$RI_DB_OWNER_URL" DATABASE_URL="$RI_DB_OWNER_URL" NODE_ENV=development pnpm --filter @crm/db migrate && \
 MIGRATION_DATABASE_URL="$RI_DB_OWNER_URL" DATABASE_URL="$RI_DB_OWNER_URL" NODE_ENV=development pnpm --filter @crm/db seed) >"$RI_OUT/logs/db-setup.log" 2>&1 || ri_die "migrate/seed failed (logs/db-setup.log)"
psql_db() { docker exec -i crm-platform-postgres psql -U crm -d "$RI_DB" -v ON_ERROR_STOP=1 "$@"; }
psql_db -v org=Admin -v contacts=5000 -v companies=500 -v tasks=1000 -v conversations=2000 -v messages=40000 <tools/perf/seed.sql >"$RI_OUT/logs/seed-data.log" 2>&1 || ri_die "data seed failed (logs/seed-data.log)"
psql_db -v org=Admin -v users="$USERS" <tools/perf/seed-users.sql >"$RI_OUT/logs/seed-users.log" 2>&1 || ri_die "user seed failed (logs/seed-users.log)"
ri_record seed PASS "org Admin, 5000 contacts, 2000 conversations, $USERS users"
APORT=$(ri_free_port); MPORT=$(ri_free_port)
APP_URL="postgres://crm_app_user:crm_app_dev@localhost:5432/$RI_DB"
( cd apps/api && exec env NODE_OPTIONS= NODE_ENV=development PORT=$APORT LOG_LEVEL=error DATABASE_URL="$APP_URL" DATABASE_REPLICA_URL="$APP_URL" \
  REDIS_URL=redis://localhost:56379/7 OBS_METRICS_PORT=$MPORT OBS_METRICS_HOST=127.0.0.1 OBS_METRICS_TOKEN=load-test-metrics-token WORKER_MODE=false node dist/src/main.js ) >"$RI_OUT/logs/api.log" 2>&1 &
API_PID=$!; ri_on_cleanup "kill $API_PID"
for _ in $(seq 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$APORT/ready" || true)" = 200 ] && break; sleep 1; done
curl -sf "http://127.0.0.1:$APORT/ready" >/dev/null || { tail -n 10 "$RI_OUT/logs/api.log" >&2; ri_die "API not ready on $APORT (logs/api.log)"; }
ri_record api-boot PASS "port $APORT"
RES="$RI_OUT/load.json"
KENV=(-e "API_URL=http://127.0.0.1:$APORT" -e "PERF_PASSWORD=Passw0rd!" -e "USERS=$USERS" -e "RAMP=$RAMP" -e "HOLD=$HOLD" -e GAP=1 -e "OUT=$RES")
if command -v k6 >/dev/null; then K6=(k6 run "${KENV[@]}" --quiet perf/load.js)
else K6=(docker run --rm --network host -u "$(id -u):$(id -g)" -v "$CRM_ROOT/perf:/s/perf:ro" -v "$RI_OUT:$RI_OUT" -w /s grafana/k6:0.54.0 run "${KENV[@]}" --quiet perf/load.js); fi
RI_CMDS+="${K6[*]}"$'\n'
echo "-> k6: $USERS users, ramp ${RAMP}s, hold ${HOLD}s"
ri_step k6-run "${K6[@]}" || true
[ -s "$RES" ] || ri_die "k6 produced no result (logs/k6-run.log)"
ri_artifact "$RES"
# judge: error rate < budgets.errorRate and class p95 under budget (p99 reported only, as perf/budgets.json defines)
node -e '
const r=require(process.argv[1]),b=require(process.argv[2]),k=+process.argv[4],s=Object.values(r.stages)[0],f=n=>(n==null?"-":Math.round(n)+"ms");
console.log(`\n  users ${s.users}  requests ${s.requests}  throughput ${s.rps.toFixed(1)} req/s  error rate ${(100*s.failedRate).toFixed(2)}%`);
console.log(`  all     p50 ${f(s.all.p50)}  p95 ${f(s.all.p95)}  p99 ${f(s.all.p99)}`);
let bad=[];if(s.failedRate>=b.errorRate)bad.push(`error rate ${(100*s.failedRate).toFixed(2)}% >= ${100*b.errorRate}%`);
for(const[c,t]of Object.entries(s.classes)){console.log(`  class ${c} p50 ${f(t.p50)}  p95 ${f(t.p95)} (budget ${t.budgetP95})  p99 ${f(t.p99)}  err ${(100*t.failedRate).toFixed(2)}%  n=${t.count}`);if(t.p95>t.budgetP95*k)bad.push(`class ${c} p95 ${f(t.p95)} > ${t.budgetP95*k}ms (budget x${k})`)}
console.log(bad.length?"THRESHOLDS FAILED: "+bad.join("; "):"all thresholds met");process.exit(bad.length?1:0)' "$RES" "$CRM_ROOT/perf/budgets.json" "${LOAD_P95_FACTOR:-3}" | tee "$RI_OUT/logs/judge.log" || true
if grep -q "all thresholds met" "$RI_OUT/logs/judge.log"; then ri_record thresholds PASS "$(grep 'users ' "$RI_OUT/logs/judge.log" | tr -s ' ')"
else ri_record thresholds FAIL "$(grep 'FAILED' "$RI_OUT/logs/judge.log" | cut -c1-200)"; fi
ri_finish
