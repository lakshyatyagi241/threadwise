#!/usr/bin/env bash
# The mobile gate: the same checks the "Mobile" CI workflow runs, locally (docs/adr/0025-mobile-quality-gates.md).
#
#   bash .claude/skills/mobile-pre-pr/scripts/gate.sh            format, types, lint, layers, tests+coverage, translations, env
#   bash .claude/skills/mobile-pre-pr/scripts/gate.sh --full     ... plus SDK compatibility, expo-doctor and the iOS+Android bundle (slow; run before a release)
#   bash .claude/skills/mobile-pre-pr/scripts/gate.sh --extras   only what the repo-wide pre-pr gate does not already run (it calls this)
#
# Exits non-zero if any check failed, after running all of them, and prints the command to reproduce each failure alone.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

MODE="default"
case "${1:-}" in
  --full) MODE="full" ;;
  --extras) MODE="extras" ;;
  "") ;;
  *) echo "usage: gate.sh [--full|--extras]" >&2; exit 2 ;;
esac

c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_green=$'\033[32m'; c_red=$'\033[31m'; c_blue=$'\033[34m'
step() { echo "${c_bold}${c_blue}==>${c_reset} $*"; }
ok()   { echo "${c_green}  ok${c_reset}  $*"; }
fail() { echo "${c_red}  x${c_reset}  $*"; }

FAILED=0
run() {
  local label="$1"; shift
  step "$label"
  if "$@"; then ok "$label"; else fail "$label — reproduce with: $*"; FAILED=1; fi
}

# --fail-if-no-match: pnpm exits 0 with "No projects matched" when the app is not in pnpm-workspace.yaml, which would let every check below pass vacuously.
M="pnpm --fail-if-no-match --filter @crm/mobile"

# The app imports the built contracts; a stale or missing dist is the most common reason a clean checkout fails.
run "build shared packages (@crm/tax, @crm/contracts)" bash -c "pnpm --filter @crm/tax build && pnpm --filter @crm/contracts build"

if [ "$MODE" != "extras" ]; then
  run "format"     pnpm exec prettier --check apps/mobile
  run "typecheck"  $M typecheck
  run "lint"       $M lint
fi

run "layers (dependency-cruiser)"          $M arch
# test:coverage runs the tests too, so there is no separate test step. (--extras still runs it: the repo-wide gate runs the tests
# but not the coverage floors.)
run "tests and coverage floors"            $M test:coverage
run "translations (21 locales)"            $M i18n:check
run "no secrets in EXPO_PUBLIC_* variables" $M env:check

if [ "$MODE" = "full" ] || [ "$MODE" = "extras" ]; then
  run "Expo SDK-compatible dependency versions" $M deps:check
fi

if [ "$MODE" = "full" ]; then
  run "expo-doctor"                        $M expo-doctor
  run "bundle (Metro, iOS and Android, Hermes)" $M bundle:check
  rm -rf apps/mobile/.expo-export
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "${c_bold}${c_green}Mobile gate passed.${c_reset}"
else
  echo "${c_bold}${c_red}Mobile gate failed.${c_reset} Fix the lines marked x above; each prints the command that reproduces it alone."
fi
exit $FAILED
