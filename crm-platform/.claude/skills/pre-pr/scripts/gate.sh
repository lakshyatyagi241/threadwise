#!/usr/bin/env bash
# Runs the same checks CI runs, locally, before a PR goes up.
#
# Exits non-zero on the first failure — this is a gate, not a report. Prints
# which check failed and the command to reproduce it in isolation.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

# Windows: SWC needs a writable native-binding cache (else ERR_SWC_NATIVE_CACHE; turbo.json passes it through), and the type-aware
# ESLint of apps/api runs out of the default Node heap, as it does on a CI runner.
if [ -z "${SWC_NATIVE_BINDING_CACHE:-}" ]; then
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) export SWC_NATIVE_BINDING_CACHE="$HOME/.swc-native-cache"; mkdir -p "$SWC_NATIVE_BINDING_CACHE" ;; esac
fi
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"

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
CHANGED="$(git diff --relative --name-only "$BASE"...HEAD 2>/dev/null; git diff --relative --name-only 2>/dev/null; git diff --relative --name-only --cached 2>/dev/null)"
CHANGED="$(echo "$CHANGED" | sort -u)"

touches() { echo "$CHANGED" | grep -qE "$1"; }

echo "Changed files since $BASE:"
echo "$CHANGED" | sed 's/^/  /'
echo

# Same as CI (ci.yml): only the files this branch changes must be formatted (the whole-tree backlog is not this PR's to fix).
# --end-of-line auto tolerates a CRLF working copy on Windows; CI runs on LF and checks strictly.
format_files() {
  local files
  files="$(echo "$CHANGED" | grep -E '\.(ts|tsx|mts|cts|js|mjs|cjs|json|md|css|ya?ml)$' | while read -r f; do [ -f "$f" ] && echo "$f"; done)"
  [ -z "$files" ] && { echo "no formattable files changed"; return 0; }
  echo "$files" | xargs pnpm exec prettier --check --ignore-unknown --end-of-line auto
}
run "format check (changed files)" format_files
run "lint"          pnpm lint
run "typecheck"     pnpm typecheck
run "architecture boundaries" pnpm arch:check
run "event-loop static gate" node tools/event-loop-audit/scan.mjs --check
run "unit tests"    pnpm test
run "translations (21 locales)" bash .claude/skills/i18n-translate-sync/scripts/check.sh

if touches '^packages/db/(migrations|src/schema)/'; then
  step "Migrations or schema changed — checking they apply, match the journal and match Drizzle"
  run "db:migrate" pnpm db:migrate
  run "db:status"  pnpm db:status
  run "db:verify-schema" pnpm db:verify-schema
else
  echo "(no migration files changed — skipping db:migrate/db:status)"
fi

if touches '^(packages/db/|apps/api/src/)' ; then
  run "integration tests" pnpm test:integration
else
  echo "(no db/api source changed — skipping integration tests; run 'pnpm test:integration' by hand if unsure)"
fi

if touches '^(apps/mobile/|packages/contracts/|packages/tax/)'; then
  # format, lint, typecheck and tests already ran above for every workspace; this adds what only the mobile app has.
  run "mobile gate (layers, coverage, translations, env, SDK versions)" bash .claude/skills/mobile-pre-pr/scripts/gate.sh --extras
else
  echo "(no mobile or contract files changed — skipping the mobile gate)"
fi

echo
if [ "$FAILED" -eq 0 ]; then
  echo "${c_bold}${c_green}All checks passed.${c_reset} Safe to open the PR."
else
  echo "${c_bold}${c_red}Some checks failed.${c_reset} Fix them before opening the PR — see above for which, and the exact command to re-run just that one."
fi
exit $FAILED
