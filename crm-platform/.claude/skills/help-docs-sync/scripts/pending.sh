#!/usr/bin/env bash
# Writes docs/help-pending.md (every built screen and plan feature with no help guide) and prints one line when there are some.
# Run by the husky post-merge hook (after every pull), by help-docs-sync, and by hand. It only reports: it ALWAYS exits 0, so it can
# never block a pull, and it never leaves a stale report behind (a failed run removes the old file instead of keeping a wrong count).
#
#   bash .claude/skills/help-docs-sync/scripts/pending.sh [--quiet]
#
# HELP_VITEST overrides the vitest entry (the script test points it at nothing).
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
FILE="$REPO_ROOT/docs/help-pending.md"

cd "$REPO_ROOT/apps/web" 2>/dev/null || exit 0
rm -f "$FILE"
node scripts/gen-registry.mjs >/dev/null 2>&1 || true # the generated registries must match the files on disk
HELP_WRITE_PENDING=1 node "${HELP_VITEST:-node_modules/vitest/vitest.mjs}" run src/features/help-center/pending-report.test.ts >/dev/null 2>&1 || true

[ -f "$FILE" ] || exit 0
COUNT="$(head -1 "$FILE" | sed -n 's/^<!-- help-pending: \([0-9][0-9]*\) -->.*/\1/p')"
if [ "${COUNT:-0}" -gt 0 ] && [ "$QUIET" -eq 0 ]; then
  echo "$COUNT features have no help doc: docs/help-pending.md"
fi
exit 0
