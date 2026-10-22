#!/usr/bin/env bash
# Visual regression runner (QA task 21): scenario coverage against the committed baselines, then every P0/P1/P2 page compared with its
# baseline in a real browser on a seeded stack, P0 repeated to prove it is not flaky, and a canary that proves a real change is caught.
SEC_NAME=visual-regression; SEC_SHEET=21; SEC_TITLE="Visual regression"
sec_help() { cat <<'H'
Visual regression (task 21).
  run.sh [--quick] [--out DIR]
  quick (pull request, seconds, no browser, no Docker): the tool tests and the coverage gate on the committed baselines. A new page with no
        baseline, or a baseline whose page is gone, fails the pull request.
  full  (daily and pre-release, about 40 min): quick, then a scratch API on its own database, seeded, and the production web build; every
        scenario compared with its baseline (Chromium, fixed clock, language, time zone, no animation); every P0 scenario run VISUAL_REPEAT
        times (default 3) and any that does not give the same answer every time fails the run; a canary page change that must be caught.
Needs: node 22, pnpm; full also docker, curl and the crm-platform-postgres and crm-platform-redis containers, and the Chromium build Playwright
pins (pnpm --filter @crm/web exec playwright install chromium).
Baselines live in apps/web/e2e/visual/__baselines__ and belong to Linux Chromium; record them with e2e/visual/README.md.
Local only. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
if [ "$SEC_MODE" = quick ]; then sec_prereq node22 pnpm; else sec_prereq node22 pnpm docker curl postgres redis; fi
VR=tools/visual
WEB="$CRM_ROOT/apps/web"

# 1. static: the library tests and coverage of the committed baselines (a page without a baseline fails here, with no browser)
sec_run tool-tests node --test $VR/lib.test.mjs
sec_run baseline-coverage node $VR/check.mjs --json "$SEC_OUT/coverage.json"
[ "$SEC_MODE" = quick ] && sec_finish

# 2. live: a scratch API on its own database, seeded, and the production web build in front of it
# The sign-in lockouts and counters write Redis keys with no REDIS_KEY_PREFIX, so a left-over one from an earlier run (user id 1 in a
# fresh database) would block this run's sign-in. Use a Redis db that holds no lockout or rate-limit key (BullMQ metadata and old
# session records are harmless).
for d in 10 11 12 13 14 15 8 7; do
  left="$(docker exec crm-platform-redis redis-cli -n "$d" --scan 2>/dev/null | grep -E '^(rl:|auth:lock:|auth:acct-fail:|auth:ip)' | head -n1 || true)"
  [ -z "$left" ] && { SEC_REDIS_DB=$d; break; }
done
[ "$SEC_REDIS_DB" = 9 ] && sec_fatal "no Redis db free of left-over lockouts for an isolated run"
sec_boot_api
(cd "$CRM_ROOT" && DATABASE_URL="$SEC_DB_ADMIN_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" pnpm db:seed) >"$SEC_OUT/logs/seed.log" 2>&1 || sec_fatal "seed failed, see logs/seed.log"
sec_check seed PASS "workspace Admin with its seeded staff and agent users"
if [ -z "${VISUAL_SKIP_BUILD:-}" ]; then
  rm -rf "$WEB/.next/dev"
  (cd "$CRM_ROOT" && pnpm --filter @crm/web build) >"$SEC_OUT/logs/web-build.log" 2>&1 || sec_fatal "web build failed, see logs/web-build.log"
fi
WEB_PORT=$(sec_free_port 3961)
sec_spawn web PORT="$WEB_PORT" API_URL="$SEC_API" NEXT_TELEMETRY_DISABLED=1 bash -c "cd '$WEB' && exec node node_modules/next/dist/bin/next start -p $WEB_PORT"
sec_wait_http "http://127.0.0.1:$WEB_PORT/login" 90 '^200$' || sec_fatal "the web app did not start, see logs/web.log"
sec_check web-boot PASS "production build on port $WEB_PORT, API $SEC_API"

PW="env WEB_URL=http://127.0.0.1:$WEB_PORT HEADLESS=1 npx playwright test --project=visual --workers=${VISUAL_WORKERS:-4}"
# every P1 and P2 scenario once; every P0 scenario VISUAL_REPEAT times (the flake check)
sec_run compare-p1-p2 bash -c "cd '$WEB' && VISUAL_PRIORITY=P1,P2 PW_JSON='$SEC_OUT/p1-p2.json' $PW"
sec_run compare-p0-repeated bash -c "cd '$WEB' && VISUAL_PRIORITY=P0 PW_JSON='$SEC_OUT/p0.json' $PW --repeat-each=${VISUAL_REPEAT:-3}"
# the canary: a real change to a page (a background colour) must make the comparison fail, or the suite would be blind
if (cd "$WEB" && VISUAL_CANARY=1 VISUAL_FILTER=/login PW_JSON="$SEC_OUT/canary.json" $PW >"$SEC_OUT/logs/canary.log" 2>&1); then
  sec_check canary FAIL "a changed page was NOT caught: the comparison is blind"
else
  grep -q "pixels" "$SEC_OUT/logs/canary.log" && sec_check canary PASS "a changed page was caught" || sec_check canary FAIL "the canary failed for another reason, see logs/canary.log"
fi

# 3. the gate: coverage verified by this run, flakiness across the repeats, every comparison
sec_run gate-live node $VR/check.mjs --json "$SEC_OUT/gate-live.json" --reports "$SEC_OUT/p1-p2.json" "$SEC_OUT/p0.json"
sec_finish
