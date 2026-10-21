#!/usr/bin/env bash
# One command for the checks of the analytics / performance work, without Docker (macOS, Linux, or Windows WSL via test/support/no-docker).
#   bash tools/perf/run-all.sh                 unit tests, tool tests, the analytics + History integration specs
#   bash tools/perf/run-all.sh --qa            also `pnpm qa` (one runnable check per QA task)
#   bash tools/perf/run-all.sh --stress        also the ramp stress test against a RUNNING API (API_URL, PERF_EMAIL, PERF_PASSWORD, PSQL_URL)
#   bash tools/perf/run-all.sh --reports       also rebuild the HTML reports into docs/quality/reports
#   bash tools/perf/run-all.sh --only unit|tools|integration   run one stage
# Needs: pnpm install, the workspace packages built (pnpm --filter @crm/tax --filter @crm/contracts --filter @crm/db --filter @crm/observability build),
# Postgres 16 with pgvector and Redis on the machine (see apps/api/test/support/no-docker/README.md). Exit code is non-zero if any stage failed.
set -u
cd "$(dirname "$0")/../.."
ROOT=$PWD
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
WANT_QA=0; WANT_STRESS=0; WANT_REPORTS=0; ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --qa) WANT_QA=1 ;; --stress) WANT_STRESS=1 ;; --reports) WANT_REPORTS=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
  shift
done
declare -a NAMES RESULTS
stage() { # name, command...
  local name="$1"; shift
  [ -n "$ONLY" ] && [ "$ONLY" != "$name" ] && return 0
  echo; echo "=== $name"
  local t0=$SECONDS
  if "$@"; then RESULTS+=("pass ($((SECONDS - t0))s)"); else RESULTS+=("FAIL ($((SECONDS - t0))s)"); fi
  NAMES+=("$name")
}
unit() { (cd "$ROOT/apps/api" && npx vitest run test/unit/analytics test/unit/team-inbox-conversations test/unit/chat-conversations); }
tools() { (cd "$ROOT" && node --test tools/perf/*.test.mjs tools/api-inventory/*.test.mjs tools/qa-suite/qa-suite.test.mjs tools/qa-suite/lib/*.test.mjs); }
integration() {
  (cd "$ROOT/apps/api" && TEST_NO_DOCKER=1 npx vitest run --testTimeout=300000 \
    test/integration/analytics/msg-feed.spec.ts test/integration/analytics/events-writer.spec.ts \
    test/integration/analytics/query.spec.ts test/integration/analytics/analytics-schema.spec.ts test/integration/analytics/rollup.spec.ts \
    test/integration/team-inbox-conversations/history-query-rewrites.spec.ts)
}
stage unit unit
stage tools tools
stage integration integration
[ $WANT_QA -eq 1 ] && stage qa bash -c 'cd "$0" && pnpm qa' "$ROOT"
[ $WANT_STRESS -eq 1 ] && stage stress bash -c 'cd "$0" && mkdir -p perf && node tools/perf/stress-ramp.mjs --out perf/stress.json' "$ROOT"
[ $WANT_REPORTS -eq 1 ] && stage reports python3 "$ROOT/tools/perf/reports/gen.py"
echo; echo "=== summary"
FAILED=0
for i in "${!NAMES[@]}"; do printf '%-14s %s\n' "${NAMES[$i]}" "${RESULTS[$i]}"; case "${RESULTS[$i]}" in FAIL*) FAILED=1;; esac; done
exit $FAILED
