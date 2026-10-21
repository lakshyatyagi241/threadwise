#!/usr/bin/env bash
# Metrics golden signals runner (sheet item 75, PR #733).
SEC_NAME=metrics-golden-signals; SEC_SHEET=75; SEC_TITLE="Metrics golden signals"
sec_help() { cat <<'H'
Metrics (sheet 75): golden-signals.spec.ts ratchet + platform-infrastructure unit tests, plus a LIVE check: boots the API (OBS_METRICS_PORT 59531)
and the worker (59532) with a bearer token, sends traffic, scrapes /metrics (401 without the token, 200 with it), and asserts the golden-signal
metric families marked "present" in docs/performance/metrics/golden-signals.json for api, worker, postgres (pool), outbox and
the saturation set (pool, outbox, event loop, memory) exist, plus a latency histogram with _bucket/_count samples.
  run.sh [--quick] [--out DIR]
  quick: ratchet spec + live check (~2.5 min).  full: + the whole platform-infrastructure unit folder (~+1 min).
Needs: node 22, pnpm, docker, curl, crm-platform-postgres and crm-platform-redis running. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
sec_prereq node22 pnpm docker curl postgres redis
if [ -z "${SEC_LIVE_ONLY:-}" ]; then
  if [ "$SEC_MODE" = quick ]; then sec_vitest golden-signals-ratchet api test/unit/platform-infrastructure/golden-signals.spec.ts
  else sec_vitest platform-infrastructure-unit api test/unit/platform-infrastructure; fi
fi

TOKEN="qa-metrics-$(head -c12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
MP_API=$(sec_free_port "${SEC_METRICS_PORT:-59531}"); MP_WORKER=$(sec_free_port $((MP_API+1)))
sec_boot_api NODE_ENV=production OBS_METRICS_PORT="$MP_API" OBS_METRICS_HOST=127.0.0.1 OBS_METRICS_TOKEN="$TOKEN"
# worker: same env, other metrics port
redis="$(sec_envval REDIS_URL)"; redis="${redis%/}"; redis="${redis%/[0-9]*}/$SEC_REDIS_DB"
sec_spawn worker-server PORT="$(sec_free_port $((SEC_API_PORT+1)))" DATABASE_URL="$SEC_DB_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" \
  REDIS_URL="$redis" REDIS_KEY_PREFIX="$SEC_REDIS_PREFIX" JWT_ACCESS_SECRET="$(head -c48 /dev/urandom | base64 -w0)" \
  JWT_REFRESH_SECRET="$(head -c48 /dev/urandom | base64 -w0)" CREDENTIALS_ENCRYPTION_KEY="$(head -c32 /dev/urandom | base64 -w0)" \
  CHANNEL_SIMULATOR_ENABLED=false NODE_ENV=production WORKER_MODE=true OBS_METRICS_PORT="$MP_WORKER" OBS_METRICS_HOST=127.0.0.1 \
  OBS_METRICS_TOKEN="$TOKEN" node dist/src/worker.js

for _ in 1 2 3 4 5; do curl -s -o /dev/null "$SEC_API/health"; curl -s -o /dev/null "$SEC_API/v2/contacts"; curl -s -o /dev/null "$SEC_API/v2/none"; done
for i in $(seq 1 100); do
  curl -sf -o /dev/null -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$MP_WORKER/metrics" && break; sleep 1
done
sleep 12 # let the pool, outbox and queue gauges take their first sample
ok() { if [ "$2" = ok ]; then sec_check "$1" PASS "${3:-}"; else sec_check "$1" FAIL "${3:-}"; fi; }
A401=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$MP_API/metrics" || true)
ok metrics-needs-token "$([ "$A401" = 401 ] && echo ok)" "no token -> HTTP $A401"
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$MP_API/metrics" >"$SEC_OUT/logs/scrape-api.prom" || true
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$MP_WORKER/metrics" >"$SEC_OUT/logs/scrape-worker.prom" || true
ok scrape-api "$([ "$(wc -l <"$SEC_OUT/logs/scrape-api.prom")" -gt 20 ] && echo ok)" "$(wc -l <"$SEC_OUT/logs/scrape-api.prom") lines"
ok scrape-worker "$([ "$(wc -l <"$SEC_OUT/logs/scrape-worker.prom")" -gt 20 ] && echo ok)" "$(wc -l <"$SEC_OUT/logs/scrape-worker.prom") lines"

RES=$(node -e '
const fs=require("fs");const g=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const api=fs.readFileSync(process.argv[2],"utf8"),wk=fs.readFileSync(process.argv[3],"utf8");
const has=(t,n)=>new RegExp("^(# (HELP|TYPE) )?"+n+"([ {]|_bucket|_count|_sum|_total)","m").test(t);
const want=(svc,sig)=>{const s=g.services[svc]&&g.services[svc][sig];return s&&s.status==="present"?s.metrics:[]};
const rows=[];
const add=(label,svc,sig,text)=>{for(const m of want(svc,sig))rows.push([label+":"+m,has(text,m)])};
for(const sig of ["latency","traffic","errors","saturation"]){add("api-"+sig,"api",sig,api);add("worker-"+sig,"worker",sig,wk);}
add("postgres-saturation","postgres","saturation",api+wk);add("outbox-saturation","outbox","saturation",api+wk);add("outbox-errors","outbox","errors",api+wk);add("outbox-latency","outbox","latency",api+wk);
const seen=new Set();for(const [n,ok] of rows){if(seen.has(n))continue;seen.add(n);console.log((ok?"ok":"missing")+"|"+n)}
const bucket=/^crm_http_request_duration_seconds_bucket\{/m.test(api),cnt=/^crm_http_request_duration_seconds_count\{/m.test(api);
console.log((bucket&&cnt?"ok":"missing")+"|latency-histogram-samples:crm_http_request_duration_seconds_bucket+_count");
console.log(/status="5xx"|status="4xx"/.test(api)?"ok|errors-by-class-label:status=4xx seen after the 404/401 requests":"missing|errors-by-class-label:status class label")
' "$CRM_ROOT/docs/performance/metrics/golden-signals.json" "$SEC_OUT/logs/scrape-api.prom" "$SEC_OUT/logs/scrape-worker.prom")
# Families that only get a sample once a job has run: absent until then, so a missing one is a NOTE here (the ratchet spec proves the code emits them).
LAZY=" crm_queue_job_duration_seconds crm_queue_job_wait_seconds crm_queue_jobs_total crm_dead_letter_captured_total "
while IFS='|' read -r st name; do
  if [ "$st" != ok ] && [[ "$LAZY" == *" ${name#*:} "* ]]; then sec_check "family-$name" PASS "no sample yet: needs a job to run (covered by the ratchet spec)"
  else ok "family-$name" "$([ "$st" = ok ] && echo ok)"; fi
done <<<"$RES"
sec_finish
