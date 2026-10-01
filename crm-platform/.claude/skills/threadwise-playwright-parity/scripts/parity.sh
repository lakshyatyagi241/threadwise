#!/usr/bin/env bash
# One entry point for the twin test. Wraps bootstrap + environment + the harness so the commands stay short.
#
#   parity.sh ready                     install the harness, make sure Reference, our API (and web when it exists) are up
#   parity.sh list  <spec>              show the scenario matrix without running anything
#   parity.sh run   <spec>... [opts]    twin run (opts: --depth quick|standard|full --only RX --skip RX --workers N ...)
#   parity.sh rerun <runDir> <spec> <regex>   re-run only matching scenarios into an existing run, then compare again
#   parity.sh compare <runDir>          rebuild findings/report from the result files
#   parity.sh explore <threadwise|ours> <path> [--click "name"] [--root css] [--anonymous]
#   parity.sh selftest [--quick]        prove the engine finds planted defects and raises no false alarms
#
# Environment (all optional): PARITY_WEB_URL PARITY_API_URL THREADWISE_URL PARITY_DEPTH PARITY_WORKERS PARITY_OUT PARITY_HEADED
# PARITY_CONFIG (json file). `ready` prints the values it settled on; later commands pick them up from the state dir.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
skill="$(cd "$here/.." && pwd)"
repo="$(cd "$skill/../../.." && pwd)"
harness="$skill/harness"

load_env() {
  # export what env.sh knows is running; explicit variables win
  while IFS= read -r line; do
    case "$line" in export\ *=*) k="${line#export }"; k="${k%%=*}"; [ -z "${!k:-}" ] && eval "$line";; esac
  done < <(bash "$here/env.sh" env 2>/dev/null)
}

need_harness() { [ -d "$harness/node_modules/playwright" ] || bash "$here/bootstrap.sh" || exit $?; }

cmd="${1:-help}"; shift || true
case "$cmd" in
  ready)
    bash "$here/bootstrap.sh" || exit $?
    bash "$here/env.sh" up "$@"; rc=$?
    exit $rc ;;
  list)    need_harness; load_env; node "$harness/run.mjs" "$@" --list ;;
  run)     need_harness; load_env; node "$harness/run.mjs" "$@" ;;
  rerun)
    dir="${1:?run dir}"; spec="${2:?spec}"; rx="${3:?scenario regex}"
    need_harness; load_env; node "$harness/run.mjs" "$spec" --only "$rx" --into "$dir" ;;
  compare) need_harness; load_env; node "$harness/compare.mjs" "$@" ;;
  explore) need_harness; load_env; node "$harness/explore.mjs" "$@" ;;
  selftest)
    need_harness
    python3 "$here/test_scripts.py" || exit 1
    ( cd "$harness" && node selftest.mjs "$@" ) ;;
  *) sed -n '2,16p' "${BASH_SOURCE[0]}"; exit 2 ;;
esac
