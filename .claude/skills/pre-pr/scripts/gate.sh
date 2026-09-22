#!/usr/bin/env bash
# Runs the same checks CI runs, locally, before a PR goes up.
#
# Exits non-zero on the first failure — this is a gate, not a report. Prints
# which check failed and the command to reproduce it in isolation.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

c_reset=$'\033[0m'; c_bold=$'\033[1m'; c_green=$'\033[32m'; c_red=$'\033[31m'; c_blue=$'\033[34m'
step() { echo "${c_bold}${c_blue}==>${c_reset} $*"; }
ok()   { echo "${c_green}  ok${c_reset}  $*"; }
fail() { echo "${c_red}  x${c_reset}  $*"; }

FAILED=0
run() {
  local label="$1"; shift
  step "$label"
  if "$@"; then
    ok "$label"
  else
    fail "$label — reproduce with: $*"
    FAILED=1
  fi
}

# What changed, relative to the merge-base with the default branch (falls
# back to comparing against the last commit if there's no upstream yet).
BASE="$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || echo HEAD)"
CHANGED="$(git diff --name-only "$BASE"...HEAD 2>/dev/null; git diff --name-only 2>/dev/null; git diff --name-only --cached 2>/dev/null)"
CHANGED="$(echo "$CHANGED" | sort -u)"

touches() { echo "$CHANGED" | grep -qE "$1"; }

echo "Changed files since $BASE:"
echo "$CHANGED" | sed 's/^/  /'
echo

run "format check"  pnpm format:check
run "lint"          pnpm lint
run "typecheck"     pnpm typecheck
run "architecture boundaries" pnpm arch:check
run "unit tests"    pnpm test

if touches '^packages/db/migrations/'; then
  step "Migrations changed — checking they apply and match the journal"
  run "db:migrate" pnpm db:migrate
  run "db:status"  pnpm db:status
else
  echo "(no migration files changed — skipping db:migrate/db:status)"
fi

if touches '^(packages/db/|apps/api/src/)' ; then
  run "integration tests" pnpm test:integration
else
  echo "(no db/api source changed — skipping integration tests; run 'pnpm test:integration' by hand if unsure)"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "${c_bold}${c_green}All checks passed.${c_reset} Safe to open the PR."
else
  echo "${c_bold}${c_red}Some checks failed.${c_reset} Fix them before opening the PR — see above for which, and the exact command to re-run just that one."
fi
exit $FAILED
