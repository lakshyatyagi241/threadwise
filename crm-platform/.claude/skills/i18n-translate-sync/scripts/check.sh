#!/usr/bin/env bash
# Fails when a messages/en/*.json file changed on this branch has a key missing (or still English) in any other locale.
# Files nobody touched are the backlog and do not fail this check. Run from anywhere in the repo.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

BASE="$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || echo HEAD)"
CHANGED="$( (git diff --relative --name-only "$BASE"...HEAD; git diff --relative --name-only; git diff --relative --name-only --cached) 2>/dev/null | sort -u)"

FILES="$(echo "$CHANGED" | sed -n 's#^apps/web/messages/en/\(.*\.json\)$#\1#p')"
if [ -z "$FILES" ]; then
  echo "i18n: no English message file changed, nothing to translate"
  exit 0
fi

cd apps/web
REPORT="$(node scripts/i18n-audit.mjs gaps --json 2>/dev/null)" || true
if [ -z "$REPORT" ]; then
  echo "i18n: the audit printed nothing; run: cd apps/web && node scripts/i18n-audit.mjs gaps" >&2
  exit 1
fi

FAILED=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  bad="$(printf '%s' "$REPORT" | FILE="$f" node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const r = JSON.parse(s); const f = process.env.FILE;
      const out = Object.entries(r).filter(([, v]) => v && v[f]).map(([l, v]) => `${l}=${v[f]}`);
      if (out.length) console.log(out.join(" "));
    });')"
  if [ -n "$bad" ]; then
    echo "x  $f is not translated: $bad"
    FAILED=1
  else
    echo "ok $f translated in all locales"
  fi
done <<<"$FILES"

if [ "$FAILED" -ne 0 ]; then
  echo "fix: follow .claude/skills/i18n-translate-sync/SKILL.md (plan, translate, apply), then re-run this script" >&2
  exit 1
fi
node scripts/i18n-tool.mjs check >/dev/null 2>&1 || { echo "x  i18n-tool check found invalid messages; run: cd apps/web && node scripts/i18n-tool.mjs check" >&2; exit 1; }
echo "i18n: all touched message files are translated and valid"
