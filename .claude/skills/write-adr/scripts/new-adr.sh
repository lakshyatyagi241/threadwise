#!/usr/bin/env bash
# Creates a new numbered ADR from the template. Usage:
#   new-adr.sh "short-kebab-case-title"
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

slug="${1:-}"
if [ -z "$slug" ]; then
  echo "Usage: $0 <kebab-case-title>   e.g. $0 event-driven-search-indexing"
  exit 1
fi
slug="$(echo "$slug" | tr '[:upper:] ' '[:lower:]-' | tr -cs 'a-z0-9-' '-' | sed 's/^-*//;s/-*$//')"

last="$(ls docs/adr/[0-9][0-9][0-9][0-9]-*.md 2>/dev/null | sort | tail -1)"
if [ -z "$last" ]; then
  next=1
else
  last_num="$(basename "$last" | cut -d- -f1)"
  next=$((10#$last_num + 1))
fi
num="$(printf '%04d' "$next")"
out="docs/adr/${num}-${slug}.md"

if [ -f "$out" ]; then
  echo "Already exists: $out"
  exit 1
fi

sed \
  -e "s/^# ADR-0000: Template/# ADR-${num}: TITLE HERE/" \
  -e "s/^- \*\*Status:\*\* template/- \*\*Status:\*\* proposed/" \
  -e "s/^- \*\*Date:\*\* 2026-09-16/- \*\*Date:\*\* $(date +%Y-%m-%d 2>/dev/null || echo TODO)/" \
  docs/adr/0000-template.md > "$out"

echo "Created $out"
echo "Next: fill it in, then add it to the table in docs/README.md (## Decision records)"
