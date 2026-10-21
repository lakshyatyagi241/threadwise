#!/usr/bin/env bash
# Shared helpers for the security/observability test runners (self-contained; the master runner unifies later).
# A runner sets SEC_NAME/SEC_SHEET/SEC_TITLE, defines sec_help, sources this file, then calls sec_init "$@",
# sec_prereq ..., sec_run / sec_vitest ..., and ends with sec_finish.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
SEC_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRM_ROOT="$(cd "$SEC_LIB_DIR/../.." && pwd)"   # crm-platform/
REPO_ROOT="$(cd "$CRM_ROOT/.." && pwd)"
SEC_PIDS=(); SEC_DBS=(); SEC_REDIS_PREFIX=""; SEC_REDIS_DB=9; SEC_CHECKS=(); SEC_CMDS=()
SEC_TESTS=0; SEC_PASSED=0; SEC_FAILED=0; SEC_BASE=0; SEC_FAIL_ANY=0; SEC_ERROR=""
# Failing unit files that exist on pristine main (matched by name). script-testing/known-failures.json (master agent) wins when present.
SEC_KNOWN_DEFAULT='chatbot-widget/launcher chatbot-widget/legacy-embed dashboards-analytics-charts/health dashboards-analytics-charts/quick-access flow-builder-editor/editor-field-seam google-account/google-capabilities infra/boundaries.matrix infra/s3-sigv4 redis-hygiene roles-permissions/route-permission-coverage storage-quota/storage-writes-guarded'

sec_init() {
  SEC_MODE=full; SEC_OUT=""; SEC_SEED=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --quick) SEC_MODE=quick;;
      --full) SEC_MODE=full;;
      --out) SEC_OUT="$2"; shift;;
      --seed) SEC_SEED="$2"; shift;;
      -h|--help) sec_help; exit 0;;
      *) echo "unknown option: $1 (try --help)" >&2; exit 2;;
    esac
    shift
  done
  SEC_TS="$(date +%Y%m%d-%H%M%S)"
  SEC_OUT="${SEC_OUT:-$REPO_ROOT/qa-results/$SEC_NAME/$SEC_TS}"
  mkdir -p "$SEC_OUT/logs"; SEC_OUT="$(cd "$SEC_OUT" && pwd)"
  SEC_START_EPOCH=$(date +%s); SEC_START_ISO=$(date -u +%FT%TZ)
  SEC_RERUN="bash crm-platform/script-testing/$SEC_NAME/run.sh"; [ "$SEC_MODE" = quick ] && SEC_RERUN="$SEC_RERUN --quick"
  SEC_SUFFIX="$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  trap sec_cleanup EXIT; trap 'exit 130' INT TERM
  echo "== $SEC_TITLE (sheet item $SEC_SHEET), mode=$SEC_MODE, output=$SEC_OUT"
}
sec_fatal() { echo "ERROR: $*" >&2; SEC_ERROR=1; exit 2; }
sec_check() { # name status detail
  SEC_CHECKS+=("$1|$2|${3:-}"); [ "$2" = PASS ] || SEC_FAIL_ANY=1
  printf '  [%s] %s %s\n' "$2" "$1" "${3:+- $3}"
}
sec_prereq() { # node22 pnpm docker curl postgres redis
  local miss=() n names
  names=$(docker ps --format '{{.Names}}' 2>/dev/null || true)
  for n in "$@"; do
    case "$n" in
      node22) if ! command -v node >/dev/null || [ "$(node -v | sed 's/v//;s/\..*//')" -lt 22 ]; then miss+=("Node 22+ (nvm install 22)"); fi;;
      pnpm) command -v pnpm >/dev/null || miss+=("pnpm (corepack enable pnpm)");;
      curl) command -v curl >/dev/null || miss+=("curl");;
      docker) docker info >/dev/null 2>&1 || miss+=("docker running");;
      postgres) grep -qx crm-platform-postgres <<<"$names" || miss+=("container crm-platform-postgres (docker compose up -d postgres)");;
      redis) grep -qx crm-platform-redis <<<"$names" || miss+=("container crm-platform-redis (docker compose up -d redis)");;
    esac
  done
  [ -f "$CRM_ROOT/.env" ] || miss+=("crm-platform/.env (cp .env.example .env)")
  [ -d "$CRM_ROOT/node_modules" ] || miss+=("dependencies (cd crm-platform && pnpm install --frozen-lockfile)")
  if [ ${#miss[@]} -gt 0 ]; then
    echo "Missing prerequisites:" >&2; printf '  - %s\n' "${miss[@]}" >&2; SEC_ERROR=1; exit 2
  fi
  sec_check prerequisites PASS "$*"
}
sec_build_packages() {
  local d
  for d in tax contracts db observability; do
    if [ ! -d "$CRM_ROOT/packages/$d/dist" ]; then
      echo "building @crm/$d"
      (cd "$CRM_ROOT" && pnpm --filter "@crm/$d" build) >"$SEC_OUT/logs/build-$d.log" 2>&1 || sec_fatal "build of @crm/$d failed, see logs/build-$d.log"
    fi
  done
}
sec_free_port() { local p=$1; while (: >"/dev/tcp/127.0.0.1/$p") 2>/dev/null; do p=$((p+1)); done; echo "$p"; }
sec_envval() { grep -E "^$1=" "$CRM_ROOT/.env" | tail -1 | cut -d= -f2-; }

# run a command in crm-platform, log to logs/<name>.log, PASS/FAIL by exit code
sec_run() { # name cmd...
  local name=$1 rc=0; shift; SEC_CMDS+=("$*")
  (cd "$CRM_ROOT" && "$@") >"$SEC_OUT/logs/$name.log" 2>&1 || rc=$?
  if [ "$rc" -eq 0 ]; then sec_check "$name" PASS "log: logs/$name.log"
  else sec_check "$name" FAIL "exit $rc, tail: $(tail -n 3 "$SEC_OUT/logs/$name.log" | tr '\n' ' ' | cut -c1-200)"; fi
}
# vitest in a workspace app with the JSON reporter; counts tests, separates known baseline failures by file name
sec_vitest() { # name app(api|web) files...
  local name=$1 app=$2 rc=0; shift 2
  local json="$SEC_OUT/logs/$name.json"
  SEC_CMDS+=("pnpm --filter @crm/$app exec vitest run $*")
  (cd "$CRM_ROOT" && pnpm --filter "@crm/$app" exec vitest run --reporter=json --outputFile="$json" "$@") >"$SEC_OUT/logs/$name.log" 2>&1 || rc=$?
  if [ ! -s "$json" ]; then sec_check "$name" FAIL "vitest produced no report (exit $rc), see logs/$name.log"; return; fi
  local known="$SEC_KNOWN_DEFAULT" out t p f b bad
  if [ -f "$SEC_LIB_DIR/../known-failures.json" ]; then
    known="$(node -e 'const j=require(process.argv[1]);console.log((Array.isArray(j)?j:j.files||j.known||[]).map(x=>x.file||x).join(" "))' "$SEC_LIB_DIR/../known-failures.json" 2>/dev/null || echo "$known")"
  fi
  out=$(node -e '
const r=require(process.argv[1]);const known=process.argv[2].split(" ");let t=0,p=0,f=0,b=0;const bad=[];
for(const x of r.testResults){const k=known.some(q=>x.name.includes(q));
 if(x.assertionResults.length===0){ if(x.status==="failed"){t++; if(k)b++; else{f++;bad.push(x.name.split("/test/").pop())}} continue}
 for(const a of x.assertionResults){ if(["skipped","pending","todo"].includes(a.status))continue; t++;
  if(a.status==="passed")p++; else if(k)b++; else{f++;bad.push(x.name.split("/test/").pop())}}}
console.log([t,p,f,b,[...new Set(bad)].join(",")].join("|"))' "$json" "$known")
  IFS='|' read -r t p f b bad <<<"$out"
  SEC_TESTS=$((SEC_TESTS+t)); SEC_PASSED=$((SEC_PASSED+p)); SEC_FAILED=$((SEC_FAILED+f)); SEC_BASE=$((SEC_BASE+b))
  if [ "$f" -eq 0 ] && [ "$t" -gt 0 ]; then sec_check "$name" PASS "$p/$t tests passed, $b known-baseline"
  else sec_check "$name" FAIL "$f failed of $t (files: ${bad:-none}); see logs/$name.log"; fi
}
sec_db_create() { # sets SEC_DB, SEC_DB_URL (app role), SEC_DB_ADMIN_URL
  SEC_DB="qa_${SEC_NAME//-/_}_$SEC_SUFFIX"; SEC_DB="${SEC_DB:0:60}"; SEC_DBS+=("$SEC_DB")
  docker exec crm-platform-postgres psql -U crm -d postgres -qc "CREATE DATABASE \"$SEC_DB\"" >/dev/null || sec_fatal "cannot create database $SEC_DB"
  local base; base="$(sec_envval MIGRATION_DATABASE_URL)"; SEC_DB_ADMIN_URL="${base%/*}/$SEC_DB"
  base="$(sec_envval DATABASE_URL)"; SEC_DB_URL="${base%/*}/$SEC_DB"
}
sec_db_migrate() {
  (cd "$CRM_ROOT" && MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" DATABASE_URL="$SEC_DB_ADMIN_URL" pnpm --filter @crm/db migrate) >"$SEC_OUT/logs/migrate.log" 2>&1 || sec_fatal "migrations failed, see logs/migrate.log"
}
sec_psql() { docker exec -i crm-platform-postgres psql -U crm -d "$SEC_DB" -v ON_ERROR_STOP=1 -tA "$@"; }
sec_wait_http() { # url seconds [code-regex]
  local i c
  for ((i=0;i<${2:-60};i++)); do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$1" || true)
    if [[ "$c" =~ ${3:-^[23]} ]]; then return 0; fi
    sleep 1
  done
  return 1
}
sec_build_api() { # build apps/api dist once
  [ -f "$CRM_ROOT/apps/api/dist/src/main.js" ] && return 0
  echo "building @crm/api (first run only)"
  (cd "$CRM_ROOT" && pnpm --filter @crm/api build) >"$SEC_OUT/logs/build-api.log" 2>&1 || sec_fatal "api build failed, see logs/build-api.log"
}
# start a background process in apps/api: sec_spawn <name> VAR=val ... node dist/...  (log in logs/<name>.log)
sec_spawn() {
  local name=$1; shift
  (cd "$CRM_ROOT/apps/api" && exec env "$@") >"$SEC_OUT/logs/$name.log" 2>&1 &
  SEC_PIDS+=($!)
}
sec_cleanup() {
  local rc=$? p d; trap - EXIT
  for p in "${SEC_PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  sleep 1
  for d in "${SEC_DBS[@]}"; do docker exec crm-platform-postgres psql -U crm -d postgres -qc "DROP DATABASE IF EXISTS \"$d\" WITH (FORCE)" >/dev/null 2>&1 || true; done
  if [ -n "$SEC_REDIS_PREFIX" ]; then
    docker exec crm-platform-redis redis-cli -n "$SEC_REDIS_DB" --scan --pattern "$SEC_REDIS_PREFIX*" 2>/dev/null | xargs -r docker exec -i crm-platform-redis redis-cli -n "$SEC_REDIS_DB" del >/dev/null 2>&1 || true
  fi
  [ "$rc" -eq 0 ] && [ "$SEC_FAIL_ANY" -eq 1 ] && rc=1
  sec_write_result "$rc"
  exit "$rc"
}
sec_write_result() {
  local rc=$1 status=PASS end
  if [ -n "$SEC_ERROR" ] || [ "$rc" -eq 2 ]; then status=ERROR; elif [ "$rc" -ne 0 ]; then status=FAIL; fi
  end=$(date +%s)
  printf '%s\n' "${SEC_CHECKS[@]}" >"$SEC_OUT/.checks"; printf '%s\n' "${SEC_CMDS[@]}" >"$SEC_OUT/.cmds"
  node -e '
const fs=require("fs"),a=process.argv.slice(1);const rd=f=>fs.readFileSync(f,"utf8").split("\n").filter(Boolean);
const checks=rd(a[0]+"/.checks").map(l=>{const[n,s,...d]=l.split("|");return{name:n,status:s,detail:d.join("|")}});
const res={id:a[1],sheetItem:Number(a[2]),title:a[3],mode:a[4],status:a[5],startedAt:a[6],finishedAt:new Date().toISOString(),durationSeconds:Number(a[7]),checks,
counts:{tests:+a[8],passed:+a[9],failed:+a[10],knownBaseline:+a[11]},artifacts:fs.readdirSync(a[0]+"/logs").map(f=>"logs/"+f),commands:rd(a[0]+"/.cmds")};
fs.writeFileSync(a[0]+"/result.json",JSON.stringify(res,null,2));fs.unlinkSync(a[0]+"/.checks");fs.unlinkSync(a[0]+"/.cmds");
console.log("\n=== "+a[3]+": "+a[5]+" ===");for(const c of checks)console.log("  "+c.status.padEnd(6)+c.name+(c.detail?"  ("+c.detail.slice(0,120)+")":""));
console.log("tests "+a[8]+" passed "+a[9]+" failed "+a[10]+" known-baseline "+a[11]+" | "+a[7]+"s\nresult: "+a[0]+"/result.json\nre-run: "+a[12]);
' "$SEC_OUT" "$SEC_NAME" "$SEC_SHEET" "$SEC_TITLE" "$SEC_MODE" "$status" "$SEC_START_ISO" "$((end-SEC_START_EPOCH))" "$SEC_TESTS" "$SEC_PASSED" "$SEC_FAILED" "$SEC_BASE" "$SEC_RERUN" || true
}
# Live API: own throwaway DB + shared Redis db index 9 with a random key prefix. Ports: SEC_API_PORT (default 3931), SEC_METRICS_PORT (59531).
# usage: sec_boot_api [VAR=val ...]   -> sets SEC_API (base url), SEC_API_LOG; extra env is passed to the API process
sec_boot_api() {
  sec_build_packages; sec_build_api
  SEC_API_PORT=$(sec_free_port "${SEC_API_PORT:-3931}"); SEC_API="http://127.0.0.1:$SEC_API_PORT"
  SEC_REDIS_PREFIX="qa-$SEC_SUFFIX:"
  sec_db_create; sec_db_migrate
  local redis; redis="$(sec_envval REDIS_URL)"; redis="${redis%/}"; redis="${redis%/[0-9]*}/$SEC_REDIS_DB"
  sec_spawn api-server PORT="$SEC_API_PORT" DATABASE_URL="$SEC_DB_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" REDIS_URL="$redis" \
    REDIS_KEY_PREFIX="$SEC_REDIS_PREFIX" "$@" node dist/src/main.js
  SEC_API_PID=${SEC_PIDS[${#SEC_PIDS[@]}-1]}
  sec_wait_http "$SEC_API/health" 90 '^200$' || { tail -n 15 "$SEC_OUT/logs/api-server.log" >&2; sec_fatal "API did not become healthy on $SEC_API_PORT, see logs/api-server.log"; }
  sec_check api-boot PASS "port $SEC_API_PORT, database $SEC_DB, redis db $SEC_REDIS_DB"
}
sec_finish() { exit 0; } # the EXIT trap turns recorded failures into exit 1
