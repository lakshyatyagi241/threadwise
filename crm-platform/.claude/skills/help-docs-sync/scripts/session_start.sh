#!/usr/bin/env bash
# SessionStart hook: when docs/help-pending.md (kept fresh by the post-merge hook and by pending.sh) says features have no help doc,
# tell Claude so it drafts them. Reads one file, runs no tests, prints nothing when there is no work, and always exits 0.
set -u
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
FILE="$REPO_ROOT/docs/help-pending.md"

[ -f "$FILE" ] || exit 0
COUNT="$(head -1 "$FILE" | sed -n 's/^<!-- help-pending: \([0-9][0-9]*\) -->.*/\1/p')"
[ "${COUNT:-0}" -gt 0 ] || exit 0

printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s features have no help doc (docs/help-pending.md). Per the repo CLAUDE.md, invoke the help-docs-sync skill to draft them and tell the user what you drafted."}}\n' "$COUNT"
exit 0
