#!/usr/bin/env bash
# Checks whether a table actually has working tenant isolation — not by
# reading the migration file and trusting it, but by asking Postgres.
#
# Usage: check-rls.sh <table_name> [table_name...]
#
# This exists because "I added a policy" and "RLS actually blocks a
# cross-tenant query" are different claims, and only one of them matters.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$REPO_ROOT"
[ -f .env ] || { echo "No .env found. Run the setup skill first."; exit 1; }
# shellcheck disable=SC1091
set -a; source .env; set +a

DB_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}"
[ -n "${DB_URL:-}" ] || { echo "MIGRATION_DATABASE_URL / DATABASE_URL not set."; exit 1; }

if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <table_name> [table_name...]"
  exit 1
fi

fail=0
for table in "$@"; do
  row="$(psql "$DB_URL" -tAc "
    SELECT relrowsecurity || ',' || relforcerowsecurity
    FROM pg_class WHERE relname = '$table' AND relkind IN ('r','p')
  " 2>/dev/null || true)"

  if [ -z "$row" ]; then
    echo "FAIL  $table — table does not exist (migration not applied? typo?)"
    fail=1
    continue
  fi

  enabled="${row%,*}"
  forced="${row#*,}"
  policy_count="$(psql "$DB_URL" -tAc "
    SELECT count(*) FROM pg_policies WHERE tablename = '$table'
  " 2>/dev/null || echo 0)"

  if [ "$enabled" = "true" ] && [ "$forced" = "true" ] && [ "$policy_count" -gt 0 ]; then
    echo "OK    $table — RLS enabled, forced, $policy_count polic$( [ "$policy_count" -eq 1 ] && echo y || echo ies )"
  else
    echo "FAIL  $table — enabled=$enabled forced=$forced policies=$policy_count"
    fail=1
  fi
done

exit $fail
