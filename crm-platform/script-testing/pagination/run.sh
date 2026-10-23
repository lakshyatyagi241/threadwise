#!/usr/bin/env bash
# Pagination optimization runner (QA task 45): the static audit of every list route and every OFFSET in the API, and a measured
# before/after of the largest numbered list (campaign recipients) on a scratch database.
SEC_NAME=pagination; SEC_SHEET=45; SEC_TITLE="Pagination optimization"
sec_help() { cat <<'H'
Pagination optimization (task 45).
  run.sh [--quick] [--out DIR]
  quick (pull request, seconds, no Docker): tool tests and the audit: every paged list route and its size cap, every OFFSET site against
        the register (a new OFFSET without a decision fails), the committed inventory is current.
  full  (about 4 minutes): quick, then a scratch database (migrated, seeded) with one campaign of 300,000 recipients, and the recipients page
        query as it was and as it is now, at five depths, with and without a status filter: same rows, deep pages at least 2x faster.
Needs: node 22, pnpm; full also docker and the crm-platform-postgres container. Local only. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
if [ "$SEC_MODE" = quick ]; then sec_prereq node22 pnpm; else sec_prereq node22 pnpm docker curl postgres; fi
PA=tools/pagination-audit
sec_run tool-tests node --test $PA/lib.test.mjs
sec_run audit node $PA/scan.mjs
[ "$SEC_MODE" = quick ] && sec_finish
sec_build_packages
sec_db_create; sec_db_migrate
(cd "$CRM_ROOT" && DATABASE_URL="$SEC_DB_ADMIN_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" pnpm db:seed) >"$SEC_OUT/logs/seed.log" 2>&1 || sec_fatal "seed failed, see logs/seed.log"
sec_check seed PASS "workspace Admin"
sec_run bench-recipients node $PA/bench.mjs --db "$SEC_DB" --out "$SEC_OUT/bench.json"
sec_finish
