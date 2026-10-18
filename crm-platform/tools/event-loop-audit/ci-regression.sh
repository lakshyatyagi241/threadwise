#!/usr/bin/env bash
# The event-loop regression gate as one command (EL-B06). Run from crm-platform with the shared packages and the API built:
#   pnpm --filter @crm/db --filter @crm/contracts --filter @crm/config --filter @crm/tax --filter @crm/observability build && pnpm --filter @crm/api build
#   bash tools/event-loop-audit/ci-regression.sh
#
# With a baseline file for this kind of machine (BASELINE, default docs/performance/event-loop/ci-baseline.json): one load run, then
# regression-check.mjs. Exit 0 no regression found, 1 regression, 2 cannot decide.
# Without one: it records three runs into reports/event-loop/ci-baseline.json, says where to commit it, and exits 2. A gate with no
# baseline must not look green.
# PROVE=1 (needs a baseline): after a clean check, runs once more with a 300 ms block every 5 s and requires the gate to FAIL it.
set -uo pipefail
cd "$(dirname "$0")/../.."

BASELINE="${BASELINE:-docs/performance/event-loop/ci-baseline.json}"
OUT="reports/event-loop"
RUNS="$OUT/gate-runs"
# Small on purpose: 300 contacts, 90 s at the normal rate. The shape is the one in the recorded baseline, so keep them in step.
COMMON=(--profiles=normal --seconds=90 --contacts=300 --settle-seconds=20)
mkdir -p "$RUNS"

load() { # name [extra run-load args]
  local name="$1"; shift
  node tools/event-loop-audit/load/run-load.mjs "${COMMON[@]}" "$@" || { echo "load run '$name' failed" >&2; return 2; }
  cp "$OUT/load-baseline.json" "$RUNS/$name.json"
}

node tools/event-loop-audit/regression-check.mjs --self-test || exit 1

if [ ! -s "$BASELINE" ]; then
  echo "no baseline at $BASELINE: recording one from three separate runs"
  for i in 1 2 3; do load "base$i" || exit 2; done
  node tools/event-loop-audit/regression-check.mjs --record --out="$OUT/ci-baseline.json" "$RUNS"/base1.json "$RUNS"/base2.json "$RUNS"/base3.json || exit 2
  echo
  echo "NO BASELINE WAS IN THE REPOSITORY, so nothing was checked. Commit $OUT/ci-baseline.json as $BASELINE"
  echo "(download the artifact) and run this again. It is recorded for THIS kind of machine only."
  exit 2
fi

load check || exit 2
node tools/event-loop-audit/regression-check.mjs --baseline="$BASELINE" "$RUNS/check.json"
code=$?
if [ "$code" -ne 0 ] || [ "${PROVE:-}" != "1" ]; then exit "$code"; fi

echo
echo "== detection proof: the same check with a 300 ms block injected every 5 s must fail =="
load inject --inject-block-ms=300 --inject-every-s=5 || exit 2
node tools/event-loop-audit/regression-check.mjs --baseline="$BASELINE" "$RUNS/inject.json"
if [ "$?" -eq 1 ]; then echo "the gate tripped on the injected block, as it must"; exit 0; fi
echo "the gate did NOT trip on an injected 300 ms block: it cannot be trusted on this runner" >&2
exit 1
