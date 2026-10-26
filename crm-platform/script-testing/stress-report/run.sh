#!/usr/bin/env bash
# Stress report runner (Sheet4 V-06): a closed-loop ramp against the built API on a scratch database, with the API process's CPU and RSS
# recorded at every step, and the report a performance PR attaches.
SEC_NAME=stress-report; SEC_SHEET=0; SEC_TITLE="Stress report (CPU, RAM, p95)"
sec_help() { cat <<'H'
Stress report (V-06).
  run.sh [--quick] [--out DIR]
  quick (pull request, seconds, no Docker): tests of the CPU/RAM sampler and of the report builder.
  full  (about 6 minutes): quick, then a scratch database (migrated, seeded with one workspace, 5,000 contacts, 2,000 conversations and
        40,000 messages), the API booted on it, and stress-ramp.mjs at 5, 10, 25 and 50 users for 20 s each with --pid on the API
        process. Writes stress.json, stress-report.html and stress-report.md (paste into the PR) in the output directory.
  BASE=path/to/main-stress.json adds the change against a run on main. STEPS=5,10 and STEP_SECONDS=10 shorten the ramp.
Needs: node 22, pnpm; full also docker, curl and the crm-platform-postgres and crm-platform-redis containers. Local only: one machine drives
and serves, so the limit is a ceiling for this box. Exit 0 PASS (limit found), 1 FAIL (first step already over budget), 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
if [ "$SEC_MODE" = quick ]; then sec_prereq node22 pnpm; else sec_prereq node22 pnpm docker curl postgres redis; fi
P=tools/perf
sec_run sampler-tests node --test $P/proc-sample.test.mjs
sec_run report-tests node --test $P/stress-report.test.mjs
[ "$SEC_MODE" = quick ] && sec_finish
sec_boot_api NODE_ENV=development LOG_LEVEL=error WORKER_MODE=false
(cd "$CRM_ROOT" && DATABASE_URL="$SEC_DB_ADMIN_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" pnpm db:seed) >"$SEC_OUT/logs/seed.log" 2>&1 || sec_fatal "seed failed, see logs/seed.log"
sec_psql -v org=Admin -v contacts=5000 -v companies=500 -v tasks=1000 -v conversations=2000 -v messages=40000 <"$CRM_ROOT/$P/seed.sql" >"$SEC_OUT/logs/seed-data.log" 2>&1 || sec_fatal "data seed failed, see logs/seed-data.log"
sec_psql -v org=Admin -v users=5 <"$CRM_ROOT/$P/seed-users.sql" >"$SEC_OUT/logs/seed-users.log" 2>&1 || sec_fatal "user seed failed, see logs/seed-users.log"
sec_check seed PASS "workspace Admin, 5,000 contacts, 40,000 messages"
STEPS=${STEPS:-5,10,25,50}; SECONDS_PER=${STEP_SECONDS:-20}
PERF_EMAIL=loaduser1@perf.example.test PERF_PASSWORD='Passw0rd!' API_URL="$SEC_API" \
  sec_run stress-ramp node "$CRM_ROOT/$P/stress-ramp.mjs" --pid "$SEC_API_PID" --steps "$STEPS" --seconds "$SECONDS_PER" --p95 "${P95:-500}" --out "$SEC_OUT/stress.json"
[ -s "$SEC_OUT/stress.json" ] || sec_fatal "stress-ramp wrote no result, see logs/stress-ramp.log"
sec_run build-report node "$CRM_ROOT/$P/stress-report.mjs" "$SEC_OUT/stress.json" --out "$SEC_OUT/stress-report.html" --md "$SEC_OUT/stress-report.md" ${BASE:+--base "$BASE"}
LIMIT=$(node -e 'console.log(require(process.argv[1]).limitVus ?? "none")' "$SEC_OUT/stress.json")
if [ "$LIMIT" = none ]; then sec_check limit FAIL "p95 over the budget already at the first step"; else sec_check limit PASS "$LIMIT users within p95 and error budget"; fi
sec_finish
