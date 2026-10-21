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
