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
