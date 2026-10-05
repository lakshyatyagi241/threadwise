#!/usr/bin/env bash
# Tests for pending.sh and session_start.sh (plain bash, no framework). Backs up and restores docs/help-pending.md.
#   bash .claude/skills/help-docs-sync/scripts/test_scripts.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../../.." && pwd)"
FILE="$REPO_ROOT/docs/help-pending.md"
BACKUP=""
if [ -f "$FILE" ]; then BACKUP="$(mktemp)"; cp "$FILE" "$BACKUP"; fi
restore() { if [ -n "$BACKUP" ]; then cp "$BACKUP" "$FILE"; else rm -f "$FILE"; fi; }
trap restore EXIT

fails=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: expected [$2] got [$3]"; fails=$((fails + 1)); fi
}

check "both scripts exist" "yes yes" "$([ -s "$HERE/pending.sh" ] && echo -n yes || echo -n no) $([ -s "$HERE/session_start.sh" ] && echo -n yes || echo -n no)"

# session_start.sh: silent without work, a SessionStart note with it
rm -f "$FILE"
check "session_start is silent when there is no report" "" "$(bash "$HERE/session_start.sh")"
printf '<!-- help-pending: 0 -->\n\nAll features have help guides.\n' > "$FILE"
check "session_start is silent when nothing is pending" "" "$(bash "$HERE/session_start.sh")"
printf '<!-- help-pending: 3 -->\n# x\n' > "$FILE"
out="$(bash "$HERE/session_start.sh")"
parsed="$(node -e 'const j=JSON.parse(process.argv[1]).hookSpecificOutput; console.log(j.hookEventName+"|"+/^3 features have no help doc/.test(j.additionalContext)+"|"+/help-docs-sync/.test(j.additionalContext))' "$out" 2>&1)"
check "session_start emits a SessionStart note naming the count and the skill" "SessionStart|true|true" "$parsed"
check "session_start exits 0" "0" "$(bash "$HERE/session_start.sh" >/dev/null; echo $?)"

# pending.sh: never fails, never keeps a stale report
printf '<!-- help-pending: 9 -->\n' > "$FILE"
out="$(HELP_VITEST=/nonexistent/vitest.mjs bash "$HERE/pending.sh" 2>&1)"
code=$?
check "pending exits 0 even when vitest is missing" "0" "$code"
check "pending prints nothing when it could not run" "" "$out"
check "pending does not keep a stale report" "no" "$([ -f "$FILE" ] && echo yes || echo no)"

# pending.sh for real: writes a report whose first line carries the count
rm -f "$FILE"
bash "$HERE/pending.sh" --quiet >/dev/null 2>&1
check "pending writes docs/help-pending.md" "yes" "$([ -f "$FILE" ] && echo yes || echo no)"
first="$(head -1 "$FILE" 2>/dev/null)"
check "the first line is the machine-readable count" "yes" "$(echo "$first" | grep -qE '^<!-- help-pending: [0-9]+ -->$' && echo yes || echo no)"

echo
if [ "$fails" -eq 0 ]; then echo "all passed"; else echo "$fails failed"; fi
exit "$fails"
