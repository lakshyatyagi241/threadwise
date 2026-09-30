#!/usr/bin/env bash
# Mechanical smell-checks for this repo's non-negotiable conventions
# (CONTRIBUTING.md). Cheap, textual, and NOT exhaustive — a clean report
# means the checkable-by-grep violations weren't found, not that the diff is
# correct. The skill's own checklist covers what still needs a real read.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"

WARN=0
warn_block() {
  local label="$1" matches="$2" fix="$3"
  if [ -n "$matches" ]; then
    echo "WARN  $label"
    echo "$matches" | sed 's/^/        /'
    echo "        -> $fix"
    WARN=1
  else
    echo "ok    $label"
  fi
}

echo "== mechanical scan (see CONTRIBUTING.md for the full list of rules) =="
echo

# ---------------------------------------------------------------------------
# Excludes src/config: env validation runs once at process bootstrap, before
# any request context exists — there's no problem+json response to build yet,
# so AppError doesn't apply there. Everything else is fair game, but read each
# hit: a bare Error thrown INSIDE a try block whose own catch converts it to
# an AppError (see cursor.ts's decodeCursor) is a legitimate flow-control
# idiom, not a violation — this grep can't tell the two apart, you have to.
m="$(grep -rnE 'throw new Error\(' apps/api/src \
  --include='*.ts' --exclude-dir=tools --exclude-dir=config \
  --exclude='*.spec.ts' --exclude='*.test.ts' 2>/dev/null || true)"
warn_block "bare 'throw new Error' — check each is either bootstrap-time or caught-and-converted in the same function" "$m" \
  "if it's neither, use an AppError static (AppError.notFound/.forbidden/.validation/...) — a bare Error surfaces as an unhelpful generic 500 instead of the right problem+json code"

# ---------------------------------------------------------------------------
m="$(grep -rnE '\.(primary|replica)\.' apps/api/src/modules --include='*.ts' 2>/dev/null || true)"
warn_block "modules/ touching db.primary/db.replica directly" "$m" \
  "business logic should go through DatabaseService.tx()/.txReplica()/.txAs(), not the raw connection handles — those exist for infra/health/workers only"

# ---------------------------------------------------------------------------
keys="$(grep -rohE "@RequirePermission\('[^']+'\)" apps/api/src --include='*.ts' 2>/dev/null \
  | sed -E "s/@RequirePermission\('([^']+)'\)/\1/" | sort -u)"
missing=""
while IFS= read -r key; do
  [ -z "$key" ] && continue
  if ! grep -rqF "'$key'" packages/db/migrations/*.sql 2>/dev/null; then
    missing="${missing}${key}\n"
  fi
done <<< "$keys"
warn_block "@RequirePermission key with no matching entry in any migration" "$(echo -e "$missing" | sed '/^$/d')" \
  "the key must be INSERTed into permission_defs in a migration — see the rbac-permission skill; role_grants' foreign key rejects an unregistered key"

# ---------------------------------------------------------------------------
echo
echo "-- RLS check on tables touched by changed/new migrations --"
changed_migrations="$(git diff --relative --name-only HEAD 2>/dev/null; git diff --relative --name-only --cached 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null)"
changed_migrations="$(echo "$changed_migrations" | grep -E '^packages/db/migrations/.*\.sql$' | sort -u || true)"

if [ -z "$changed_migrations" ]; then
  echo "  (no migration files changed — nothing to check)"
else
  tables=""
  for f in $changed_migrations; do
    [ -f "$f" ] || continue
    t="$(grep -ohE 'CREATE TABLE ([a-z_]+)' "$f" | awk '{print $3}')"
    tables="${tables} ${t}"
  done
  tables="$(echo "$tables" | tr ' ' '\n' | sed '/^$/d' | sort -u)"
  if [ -z "$tables" ]; then
    echo "  (changed migrations touch no new CREATE TABLE — nothing to check)"
  elif [ -f .env ]; then
    # shellcheck disable=SC1091
    set -a; source .env; set +a
    bash "$REPO_ROOT/.claude/skills/add-migration/scripts/check-rls.sh" $tables || WARN=1
  else
    echo "  no .env — run the setup skill, then re-run this check"
    WARN=1
  fi
fi

echo
if [ "$WARN" -eq 0 ]; then
  echo "No mechanical smells found. Still work through the judgment checklist in the skill."
else
  echo "Findings above need a look. None of these are auto-fixable — read the context, not just the grep hit."
fi
exit $WARN
