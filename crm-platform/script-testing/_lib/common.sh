#!/usr/bin/env bash
# Shared helper for script-testing/<test>/run.sh. Source it: `. "$(dirname "${BASH_SOURCE[0]}")/../_lib/common.sh"`.
# Provides: st_init <id> <title>, st_parse_args "$@", st_need <docker|node22|pnpm|port:N>, st_check <name> <PASS|FAIL> [detail],
# st_run <name> <cmd...> (logs to $OUT/logs, records a check), st_cleanup_add <cmd>, st_finish (writes result.json, prints table, exits 0/1/2).
set -euo pipefail
ST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # crm-platform/
export PATH="$HOME/.local/bin:$PATH"
MODE=full; OUT=""; ST_CHECKS=(); ST_CLEAN=(); ST_START=$(date +%s); ST_STARTED_AT=$(date -u +%FT%TZ)

st_init() { ST_ID=$1; ST_TITLE=$2; }
st_parse_args() {
  while [ $# -gt 0 ]; do case $1 in
    --quick) MODE=quick;; --full) MODE=full;; --out) OUT=$(mkdir -p "$2" && cd "$2" && pwd); shift;;
    --help|-h) st_help; exit 0;; *) echo "unknown option $1" >&2; exit 2;; esac; shift; done
  [ -n "$OUT" ] || OUT="$ST_ROOT/qa-results/$ST_ID/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$OUT/logs"; trap st_cleanup EXIT INT TERM
}
st_help() { echo "$ST_TITLE ($ST_ID): see README.md next to this script. Options: --quick | --full (default) | --out DIR"; }
st_cleanup_add() { ST_CLEAN+=("$1"); }
st_cleanup() { local i; for ((i=${#ST_CLEAN[@]}-1;i>=0;i--)); do eval "${ST_CLEAN[$i]}" >/dev/null 2>&1 || true; done; ST_CLEAN=(); }
st_error() { echo "ERROR: $*" >&2; ST_ERROR="$*"; st_finish; }
st_need() {
  case $1 in
    docker) docker info >/dev/null 2>&1 || st_error "docker is not running";;
    node22) [ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ] || st_error "node 22 required";;
    pnpm) command -v pnpm >/dev/null || st_error "pnpm not found (corepack enable)";;
    port:*) (exec 3<>"/dev/tcp/127.0.0.1/${1#port:}") 2>/dev/null && st_error "port ${1#port:} is in use" || true;;
  esac
}
st_check() { ST_CHECKS+=("$1|$2|${3:-}"); printf '  %-5s %s %s\n' "$2" "$1" "${3:+($3)}"; }
st_run() { local n=$1; shift; if "$@" >"$OUT/logs/$n.log" 2>&1; then st_check "$n" PASS; else st_check "$n" FAIL "see logs/$n.log"; fi; }
st_finish() {
  local status=PASS code=0 c
  for c in "${ST_CHECKS[@]:-}"; do [ -n "$c" ] && [ "$(cut -d'|' -f2 <<<"$c")" = FAIL ] && status=FAIL && code=1; done
  [ -n "${ST_ERROR:-}" ] && status=ERROR && code=2
  local dur=$(( $(date +%s) - ST_START ))
  ST_ID="$ST_ID" ST_TITLE="$ST_TITLE" MODE="$MODE" STATUS="$status" DUR="$dur" STARTED="$ST_STARTED_AT" CHECKS="$(printf '%s\n' "${ST_CHECKS[@]:-}")" ERR="${ST_ERROR:-}" \
    node -e '
const e=process.env;const checks=e.CHECKS.split("\n").filter(Boolean).map(l=>{const[n,s,...d]=l.split("|");return{name:n,status:s,detail:d.join("|")}});
if(e.ERR)checks.push({name:"prerequisites",status:"ERROR",detail:e.ERR});
const p=checks.filter(c=>c.status==="PASS").length,f=checks.filter(c=>c.status==="FAIL").length;
require("fs").writeFileSync(process.argv[1]+"/result.json",JSON.stringify({id:e.ST_ID,title:e.ST_TITLE,mode:e.MODE,status:e.STATUS,startedAt:e.STARTED,finishedAt:new Date().toISOString(),durationSeconds:+e.DUR,checks,counts:{tests:checks.length,passed:p,failed:f,knownBaseline:0},artifacts:[],commands:[]},null,2));' "$OUT"
  st_cleanup
  echo "== $ST_ID: $status in ${dur}s; result: $OUT/result.json"
  echo "   re-run: bash ${0#"$ST_ROOT"/} --$MODE"
  exit $code
}


# ===== Section 2: security runners (sec_ helpers) =====

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
    REDIS_KEY_PREFIX="$SEC_REDIS_PREFIX" JWT_ACCESS_SECRET="$(head -c48 /dev/urandom | base64 -w0)" \
    JWT_REFRESH_SECRET="$(head -c48 /dev/urandom | base64 -w0)" CREDENTIALS_ENCRYPTION_KEY="$(head -c32 /dev/urandom | base64 -w0)" \
    CHANNEL_SIMULATOR_ENABLED=false "$@" node dist/src/main.js
  SEC_API_PID=${SEC_PIDS[${#SEC_PIDS[@]}-1]}
  sec_wait_http "$SEC_API/health" 90 '^200$' || { tail -n 15 "$SEC_OUT/logs/api-server.log" >&2; sec_fatal "API did not become healthy on $SEC_API_PORT, see logs/api-server.log"; }
  sec_check api-boot PASS "port $SEC_API_PORT, database $SEC_DB, redis db $SEC_REDIS_DB"
}
sec_finish() { exit 0; } # the EXIT trap turns recorded failures into exit 1


# ===== Section 3: integration runners (ri_ helpers) =====

#!/usr/bin/env bash
# Shared helpers for the integration-style runners (network-failure, concurrency, cache-invalidation,
# redis-audit, cache-audit, cache-hit-rate, memory-soak). Self-contained: source it, do not run it.
#
# A runner sets RI_ID RI_SHEET RI_TITLE RI_HELP (text), then:
#   ri_init "$@"          parse --quick/--full/--out/--jobs/--minutes/--help, set paths, install traps
#   ri_prereqs docker ... check prerequisites (exit 2 with a list of what is missing)
#   ri_build_packages     build tax/contracts/db/observability if dist is missing
#   ri_step NAME CMD...   run a check, log to $RI_OUT/logs/NAME.log, record PASS/FAIL (known-baseline aware)
#   ri_finish             write result.json, print the summary table, exit 0/1/2

# shellcheck disable=SC2034
RI_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRM_ROOT="$(cd "$RI_LIB_DIR/../.." && pwd)"          # crm-platform/
REPO_ROOT="$(cd "$CRM_ROOT/.." && pwd)"              # repo root (qa-results lives here)
API_DIR="$CRM_ROOT/apps/api"
WEB_DIR="$CRM_ROOT/apps/web"
export PATH="$HOME/.local/bin:$PATH"

RI_MODE=full; RI_OUT=""; RI_JOBS=3; RI_MINUTES=""
RI_CHECKS="" ; RI_CMDS=""; RI_ARTIFACTS=""; RI_CLEANUPS=()
RI_TESTS=0; RI_PASSED=0; RI_FAILED=0; RI_BASE=0; RI_ERROR=""
RI_NOISE="Machine noise: other agents/jobs may share this machine, so heavy suites can be slower than the quoted times."

ri_die() { echo "ERROR: $*" >&2; RI_ERROR="$*"; ri_finish 2; }

ri_init() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --quick) RI_MODE=quick ;;
      --full) RI_MODE=full ;;
      --out) RI_OUT="$2"; shift ;;
      --jobs) RI_JOBS="$2"; shift ;;
      --minutes) RI_MINUTES="$2"; shift ;;
      -h|--help) printf '%s\n\nOptions: --quick | --full (default) | --out <dir> | --jobs N | --minutes N (where relevant)\n%s\n' "$RI_HELP" "$RI_NOISE"; exit 0 ;;
      *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
    esac; shift
  done
  RI_START=$(date +%s); RI_STARTED_AT=$(date -u +%FT%TZ)
  RI_STAMP=$(date +%Y%m%d-%H%M%S)
  [ -n "$RI_OUT" ] || RI_OUT="$REPO_ROOT/qa-results/$RI_ID/$RI_STAMP"
  mkdir -p "$RI_OUT/logs"; RI_OUT="$(cd "$RI_OUT" && pwd)"
  RI_RERUN="bash crm-platform/script-testing/$RI_ID/run.sh --$RI_MODE"
  trap 'ri_cleanup; exit 130' INT TERM
  trap 'ri_cleanup' EXIT
  echo "== $RI_TITLE (sheet item $RI_SHEET), mode=$RI_MODE, output $RI_OUT"
  echo "   $RI_NOISE"
}

ri_on_cleanup() { RI_CLEANUPS+=("$1"); }
ri_cleanup() {
  local c; for c in "${RI_CLEANUPS[@]:-}"; do [ -n "$c" ] && eval "$c" >/dev/null 2>&1 || true; done
  RI_CLEANUPS=()
}

# ri_prereqs docker node pnpm redis postgres promtool-docker
ri_prereqs() {
  local missing="" p
  for p in "$@"; do
    case "$p" in
      docker) docker info >/dev/null 2>&1 || missing+=" docker(not running)" ;;
      node) [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" = 22 ] || missing+=" node22" ;;
      pnpm) command -v pnpm >/dev/null || missing+=" pnpm(corepack enable)" ;;
      postgres) docker exec crm-platform-postgres pg_isready -U crm >/dev/null 2>&1 || missing+=" crm-platform-postgres(docker compose up -d postgres)" ;;
      redis) docker exec crm-platform-redis redis-cli ping >/dev/null 2>&1 || missing+=" crm-platform-redis(docker compose up -d redis)" ;;
      deps) [ -d "$CRM_ROOT/node_modules" ] || missing+=" node_modules(pnpm install --frozen-lockfile)" ;;
    esac
  done
  [ -z "$missing" ] || ri_die "missing prerequisites:$missing"
}

ri_build_packages() {
  local pk
  for pk in tax contracts db observability; do
    [ -d "$CRM_ROOT/packages/$pk/dist" ] && continue
    echo "building @crm/$pk ..."
    (cd "$CRM_ROOT" && pnpm --filter "@crm/$pk" build >"$RI_OUT/logs/build-$pk.log" 2>&1) || ri_die "build of @crm/$pk failed (see logs/build-$pk.log)"
  done
}

# ---- known baseline (failing files on pristine main) ----
RI_KNOWN_DEFAULT="chatbot-widget/launcher chatbot-widget/legacy-embed dashboards-analytics-charts/health dashboards-analytics-charts/quick-access flow-builder-editor/editor-field-seam google-account/google-capabilities infra/boundaries.matrix infra/s3-sigv4 redis-hygiene roles-permissions/route-permission-coverage storage-quota/storage-writes-guarded"
ri_known_list() {
  local f="$CRM_ROOT/script-testing/known-failures.json"
  if [ -f "$f" ]; then node -e 'const j=require(process.argv[1]);const a=Array.isArray(j)?j:(j.files||j.known||[]);console.log(a.map(x=>x.name||x).join(" "))' "$f" 2>/dev/null && return; fi
  echo "$RI_KNOWN_DEFAULT"
}
# failing test files named in a log (vitest "FAIL  path > test" lines)
ri_failing_files() { sed 's/\x1b\[[0-9;]*m//g' "$1" | grep -E '^ *(FAIL|❯) ' | grep -oE '[A-Za-z0-9_./-]+\.(spec|test)\.(ts|tsx|mjs)' | sort -u; }

# count tests from a vitest log into the totals
ri_count_log() {
  local l; l=$(sed 's/\x1b\[[0-9;]*m//g' "$1" | grep -E '^ *Tests ' | tail -1)
  [ -n "$l" ] || return 0
  local f p; f=$(grep -oE '[0-9]+ failed' <<<"$l" | grep -oE '[0-9]+' || true); p=$(grep -oE '[0-9]+ passed' <<<"$l" | grep -oE '[0-9]+' || true)
  RI_PASSED=$((RI_PASSED + ${p:-0})); RI_FAILED=$((RI_FAILED + ${f:-0})); RI_TESTS=$((RI_TESTS + ${p:-0} + ${f:-0}))
}

ri_record() { # name status detail
  RI_CHECKS+="$(printf '%s\t%s\t%s' "$1" "$2" "$3")"$'\n'
  printf '  [%s] %s %s\n' "$2" "$1" "$3"
}

# ri_step NAME CMD...   (run from the caller's cwd; vitest logs are counted and matched against the baseline)
ri_step() {
  local name="$1"; shift
  local log="$RI_OUT/logs/$name.log" t0; t0=$(date +%s)
  RI_CMDS+="$*"$'\n'
  echo "-> $name: $*"
  local rc=0; "$@" >"$log" 2>&1 || rc=$?
  ri_count_log "$log"
  local dur=$(( $(date +%s) - t0 ))
  if [ $rc -eq 0 ]; then ri_record "$name" PASS "(${dur}s)"; return 0; fi
  local files known bad="" nb=0 f k hit; files=$(ri_failing_files "$log"); known=$(ri_known_list)
  for f in $files; do hit=0; for k in $known; do case "$f" in *"$k"*) hit=1;; esac; done
    if [ $hit = 1 ]; then nb=$((nb+1)); else bad+=" $f"; fi; done
  if [ -n "$files" ] && [ -z "$bad" ]; then
    RI_BASE=$((RI_BASE+nb)); ri_record "$name" PASS "(${dur}s) only known-baseline failures: $nb file(s)"; return 0
  fi
  ri_record "$name" FAIL "(${dur}s, exit $rc) see $log${bad:+; failing:$bad}"; return 1
}
# same as ri_step but never aborts the caller under set -e
ri_try() { ri_step "$@" || true; }

# ---- throwaway database on the shared postgres (never touches other databases) ----
ri_create_db() { # sets RI_DB, RI_DB_ADMIN_URL, RI_DB_OWNER_URL
  RI_DB="ri_${RI_ID//-/_}_$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  docker exec crm-platform-postgres psql -U crm -d postgres -qc "CREATE DATABASE $RI_DB" >/dev/null || ri_die "cannot create database $RI_DB"
  ri_on_cleanup "docker exec crm-platform-postgres psql -U crm -d postgres -qc 'DROP DATABASE IF EXISTS $RI_DB WITH (FORCE)'"
  RI_DB_ADMIN_URL="postgres://crm:crm@localhost:5432/postgres"
  RI_DB_OWNER_URL="postgres://crm:crm@localhost:5432/$RI_DB"
}

ri_free_port() { node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})'; }
ri_artifact() { RI_ARTIFACTS+="$1"$'\n'; }

ri_finish() {
  local forced="${1:-}" status=PASS code=0
  if [ -n "$forced" ]; then status=ERROR; code=2
  elif grep -q $'\tFAIL\t' <<<"$RI_CHECKS"; then status=FAIL; code=1
  elif [ -z "$RI_CHECKS" ]; then status=ERROR; code=2; fi
  local end; end=$(date +%s)
  RI_ID="$RI_ID" RI_SHEET="$RI_SHEET" RI_TITLE="$RI_TITLE" RI_MODE="$RI_MODE" RI_OUT="$RI_OUT" RI_STARTED_AT="$RI_STARTED_AT" RI_ERROR="$RI_ERROR" \
  RI_CHECKS="$RI_CHECKS" RI_CMDS="$RI_CMDS" RI_ARTIFACTS="$RI_ARTIFACTS" RI_STATUS=$status RI_DUR=$((end-RI_START)) \
  RI_FINISHED=$(date -u +%FT%TZ) RI_T=$RI_TESTS RI_P=$RI_PASSED RI_F=$RI_FAILED RI_B=$RI_BASE node -e '
const e=process.env,L=s=>(s||"").split("\n").filter(Boolean);
const checks=L(e.RI_CHECKS).map(l=>{const [name,status,detail]=l.split("\t");return {name,status,detail}});
const r={id:e.RI_ID,sheetItem:+e.RI_SHEET,title:e.RI_TITLE,mode:e.RI_MODE,status:e.RI_STATUS,startedAt:e.RI_STARTED_AT,finishedAt:e.RI_FINISHED,
 durationSeconds:+e.RI_DUR,checks,counts:{tests:+e.RI_T,passed:+e.RI_P,failed:+e.RI_F,knownBaseline:+e.RI_B},
 artifacts:L(e.RI_ARTIFACTS),commands:L(e.RI_CMDS)};if(e.RI_ERROR)r.error=e.RI_ERROR;
require("fs").writeFileSync(e.RI_OUT+"/result.json",JSON.stringify(r,null,2));' || true
  ri_cleanup
  echo; echo "=================== $RI_TITLE: $status ==================="
  printf '%s' "$RI_CHECKS" | awk -F'\t' '{printf "  %-5s %-34s %s\n",$2,$1,$3}'
  echo "  tests: $RI_TESTS (passed $RI_PASSED, failed $RI_FAILED, known-baseline files $RI_BASE)   duration: $((end-RI_START))s"
  [ -z "$RI_ERROR" ] || echo "  error: $RI_ERROR"
  echo "  result: $RI_OUT/result.json"
  echo "  re-run: $RI_RERUN"
  trap - EXIT
  exit $code
}
