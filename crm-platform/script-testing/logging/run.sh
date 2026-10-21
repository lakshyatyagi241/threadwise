#!/usr/bin/env bash
# Structured logging runner (sheet item 74, PR #734).
SEC_NAME=logging; SEC_SHEET=74; SEC_TITLE="Centralized structured logging"
sec_help() { cat <<'H'
Logging (sheet 74): unit specs test/unit/logging/* plus a LIVE check: boots the API (own database, redis db 9, LOG_LEVEL=info), sends a
health probe, a 404 with ?token=, a 401, a public tokenised URL and a request with a chosen x-request-id, then reads the stdout log:
every line is valid JSON with time/level/msg/service, no secret string appears, the health probe is not logged at info, the request id
is consistent between the response header and all log lines of that request.
  run.sh [--quick] [--out DIR]
  quick and full are the same (~2 min; first run builds the API, +1 min). Ports: API 3931.
Needs: node 22, pnpm, docker, curl, crm-platform-postgres and crm-platform-redis running. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common-security.sh"
sec_init "$@"
sec_prereq node22 pnpm docker curl postgres redis
if [ -z "${SEC_LIVE_ONLY:-}" ]; then sec_vitest logging-unit api test/unit/logging; fi

SECRET="sk_live_QA$SEC_SUFFIX"SUPERSECRET0123
RID="qa-req-$SEC_SUFFIX"
sec_boot_api NODE_ENV=production LOG_LEVEL=info
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
C_HEALTH=$(code "$SEC_API/health")
C_404=$(code "$SEC_API/v2/no-such-route?token=$SECRET&api_key=$SECRET")
C_401=$(code -H "x-request-id: $RID" -H "Authorization: Bearer $SECRET" "$SEC_API/v2/contacts?token=$SECRET")
C_PUB=$(code "$SEC_API/v2/public/invoices/$SECRET?token=$SECRET")
RESP_RID=$(curl -s -D - -o /dev/null -H "x-request-id: $RID-2" "$SEC_API/v2/contacts" | tr -d '\r' | grep -i '^x-request-id:' | cut -d: -f2- | tr -d ' ')
sleep 2
LOG="$SEC_OUT/logs/api-server.log"
sec_check live-requests-sent PASS "health=$C_HEALTH 404-with-token=$C_404 401=$C_401 public-tokenised=$C_PUB"

REPORT=$(node -e '
const fs=require("fs");const secret=process.argv[2],rid=process.argv[3],respRid=process.argv[4];
const raw=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);
let bad=[],missing=[],objs=[];
for(const l of raw){let o;try{o=JSON.parse(l)}catch{bad.push(l.slice(0,80));continue}objs.push(o);
 const miss=["time","level"].filter(k=>o[k]===undefined);if(o.service===undefined)miss.push("service");if(o.msg===undefined&&o.message===undefined&&!(o.req&&o.res))miss.push("msg");
 if(miss.length)missing.push(miss.join("+")+": "+l.slice(0,80))}
const leaked=raw.filter(l=>l.includes(secret)).length;
const healthInfo=objs.filter(o=>(o.level==="info"||o.level===30)&&o.req&&o.req.url==="/health").length;
const mine=objs.filter(o=>o.req&&o.req.id===rid||o.requestId===rid);
const ids=new Set(mine.map(o=>o.requestId||o.req.id));
const echoed=respRid===rid+"-2";
const mine2=objs.filter(o=>o.requestId===rid+"-2"||(o.req&&o.req.id===rid+"-2"));
console.log(JSON.stringify({lines:raw.length,notJson:bad.length,notJsonSample:bad[0]||"",missing:missing.length,missingSample:missing[0]||"",leaked,healthInfo,
 reqLines:mine.length,reqIdsDistinct:ids.size,echoed,reqLines2:mine2.length,
 has404:objs.some(o=>o.res&&o.res.statusCode===404),has401:objs.some(o=>o.res&&o.res.statusCode===401)}))' "$LOG" "$SECRET" "$RID" "$RESP_RID")
echo "$REPORT" >"$SEC_OUT/logs/live-log-analysis.json"
f() { node -e 'console.log(JSON.parse(process.argv[1])[process.argv[2]])' "$REPORT" "$1"; }
ok() { if [ "$2" = ok ]; then sec_check "$1" PASS "${3:-}"; else sec_check "$1" FAIL "${3:-}"; fi; }
ok log-every-line-json "$([ "$(f notJson)" = 0 ] && echo ok)" "$(f lines) lines, non-JSON: $(f notJson) $(f notJsonSample)"
ok log-required-fields "$([ "$(f missing)" = 0 ] && echo ok)" "lines missing time/level/msg/service: $(f missing) $(f missingSample)"
ok log-no-secret-strings "$([ "$(f leaked)" = 0 ] && echo ok)" "lines containing the planted secret: $(f leaked)"
ok log-health-not-at-info "$([ "$(f healthInfo)" = 0 ] && echo ok)" "info lines for /health: $(f healthInfo)"
ok log-404-and-401-recorded "$([ "$(f has404)" = true ] && [ "$(f has401)" = true ] && echo ok)" "404 logged: $(f has404), 401 logged: $(f has401)"
ok log-request-id-consistent "$([ "$(f reqLines)" -ge 1 ] && [ "$(f reqIdsDistinct)" = 1 ] && [ "$(f echoed)" = true ] && [ "$(f reqLines2)" -ge 1 ] && echo ok)" "lines with the sent id: $(f reqLines), response echoes the id: $(f echoed)"
sec_finish
