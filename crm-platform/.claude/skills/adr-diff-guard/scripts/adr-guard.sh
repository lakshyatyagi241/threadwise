#!/usr/bin/env bash
# Structural integrity checks for docs/adr/ — NOT a check of whether an ADR
# is well-argued (that needs a read), only whether the mechanical bookkeeping
# around ADRs is consistent: every file indexed, every index row backed by a
# real file, every "superseded by" reference valid, and no already-accepted
# ADR silently rewritten in place.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

WARN=0
warn() { echo "WARN  $1"; WARN=1; }
ok()   { echo "ok    $1"; }

ADR_DIR="docs/adr"
INDEX="docs/README.md"

if [ ! -f "$INDEX" ]; then
  echo "FAIL  $INDEX not found — can't check the ADR index"
  exit 1
fi

echo "== ADR index consistency =="

# ---------------------------------------------------------------------------
# 1. Every real ADR file (excluding the template) has a row in the index.
# ---------------------------------------------------------------------------
missing_from_index=""
for f in "$ADR_DIR"/[0-9][0-9][0-9][0-9]-*.md; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  [ "$base" = "0000-template.md" ] && continue
  if ! grep -qF "(adr/${base})" "$INDEX"; then
    missing_from_index="${missing_from_index}  ${f}\n"
  fi
done
if [ -n "$missing_from_index" ]; then
  warn "ADR file(s) not listed in $INDEX's Decision records table:"
  echo -e "$missing_from_index" | sed '/^$/d'
else
  ok "every ADR file is listed in the index"
fi

# ---------------------------------------------------------------------------
# 2. Every index row points at a file that actually exists.
# ---------------------------------------------------------------------------
dangling=""
while IFS= read -r ref; do
  [ -z "$ref" ] && continue
  [ -f "docs/$ref" ] || dangling="${dangling}  ${ref}\n"
done < <(grep -oE 'adr/[0-9]{4}-[a-z0-9-]+\.md' "$INDEX" | sort -u)
if [ -n "$dangling" ]; then
  warn "index row(s) point at a file that doesn't exist (renamed or deleted?):"
  echo -e "$dangling" | sed '/^$/d'
else
  ok "every index row points at a real file"
fi

# ---------------------------------------------------------------------------
# 3. Every "superseded by ADR-00NN" reference points at a real ADR.
# ---------------------------------------------------------------------------
bad_supersede=""
for f in "$ADR_DIR"/[0-9][0-9][0-9][0-9]-*.md; do
  [ -f "$f" ] || continue
  target="$(grep -oE 'superseded by ADR-[0-9]{4}' "$f" | grep -oE '[0-9]{4}' || true)"
  if [ -n "$target" ]; then
    if ! ls "$ADR_DIR/${target}-"*.md >/dev/null 2>&1; then
      bad_supersede="${bad_supersede}  $(basename "$f") claims superseded by ADR-${target}, which doesn't exist\n"
    fi
  fi
done
if [ -n "$bad_supersede" ]; then
  warn "broken 'superseded by' reference(s):"
  echo -e "$bad_supersede" | sed '/^$/d'
else
  ok "every 'superseded by' reference resolves to a real ADR"
fi

echo
echo "== changes to existing ADRs =="

# ---------------------------------------------------------------------------
# 4. An ADR that already existed at HEAD and is being modified now, while its
#    current status is NOT 'proposed', is a decision being rewritten in
#    place instead of superseded — flagged for a human/agent read, not
#    auto-failed, because a genuine typo fix is legitimate and this can't
#    tell the difference from the text alone.
# ---------------------------------------------------------------------------
changed_adrs="$(
  git diff --relative --name-only HEAD -- "$ADR_DIR" 2>/dev/null
  git diff --relative --name-only --cached -- "$ADR_DIR" 2>/dev/null
  git ls-files --others --exclude-standard -- "$ADR_DIR" 2>/dev/null
)"
changed_adrs="$(echo "$changed_adrs" | sort -u | sed '/^$/d')"

new_adrs=""
edited_accepted=""
if [ -z "$changed_adrs" ]; then
  echo "  (no docs/adr/*.md files changed)"
else
  for f in $changed_adrs; do
    if git cat-file -e "HEAD:$f" 2>/dev/null; then
      status_line="$(grep -m1 '\*\*Status:\*\*' "$f" 2>/dev/null || true)"
      if ! echo "$status_line" | grep -qi 'proposed'; then
        edited_accepted="${edited_accepted}  ${f}  (${status_line#*Status:** })\n"
      fi
    else
      new_adrs="${new_adrs}  ${f}\n"
    fi
  done

  if [ -n "$new_adrs" ]; then
    echo "  new ADR(s) in this change:"
    echo -e "$new_adrs" | sed '/^$/d'
  fi
  if [ -n "$edited_accepted" ]; then
    warn "already-decided ADR(s) modified in place:"
    echo -e "$edited_accepted" | sed '/^$/d'
    echo "        -> if this changes the Decision/Consequences, it should be a NEW ADR marked"
    echo "           'superseded by ADR-00NN', not an edit — see the write-adr skill. A pure"
    echo "           wording/typo fix with no meaning change is fine as an edit."
  fi
fi

echo
if [ "$WARN" -eq 0 ]; then
  echo "ADR bookkeeping is consistent."
else
  echo "Findings above need a look — none are auto-fixable."
fi

# Remind about the broader rule even when nothing mechanical fired — this
# script can only check the ADR files themselves, not whether OTHER changed
# code now contradicts one.
echo
echo "Reminder: this only checks ADR files. If code in this change behaves"
echo "differently from what an accepted ADR's Decision says, that ADR must"
echo "be updated/superseded in this same change too — no script can detect"
echo "that from the diff alone."

exit $WARN
