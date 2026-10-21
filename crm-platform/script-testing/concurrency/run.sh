#!/usr/bin/env bash
set -euo pipefail
RI_ID=concurrency; RI_SHEET=15; RI_TITLE="Concurrency testing"
RI_HELP="Runs the 14 suites in apps/api/test/e2e/concurrency (each starts its own Postgres and Redis testcontainers, PR #717) plus the related unit specs (tenancy, plans-subscriptions-trials, forms-builder, message-templates).
--quick: each suite once. Full (default): each suite 5 times, like the sheet evidence. Every run prints its seed; seeds are listed per suite (replay with CONC_SEED=<n>).
--jobs N: suites run N at a time (default 3); they are independent.
Needs: docker (testcontainers pull postgres/redis images), node 22, pnpm.
Time: quick ~15-25 min with --jobs 3, full ~60-120 min. A pass of 5 runs is evidence of stability, not proof."
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common.sh"
ri_init "$@"
ri_prereqs docker node pnpm deps
ri_build_packages
ROUNDS=5; [ "$RI_MODE" = quick ] && ROUNDS=1
cd "$API_DIR"
ri_try unit-related pnpm exec vitest run test/unit/tenancy test/unit/plans-subscriptions-trials test/unit/forms-builder test/unit/message-templates

conc_one() { # suite round
  local s="$1" r="$2" log="$RI_OUT/logs/conc-$1-r$2.log" rc=0
  ( cd "$API_DIR" && pnpm exec vitest run "test/e2e/concurrency/$s.e2e.spec.ts" --testTimeout=120000 ) >"$log" 2>&1 || rc=$?
  echo "$rc" >"$log.rc"
}
export -f conc_one; export RI_OUT API_DIR
suites=$(cd test/e2e/concurrency && ls ./*.e2e.spec.ts | sed 's#^\./##; s#\.e2e\.spec\.ts$##')
echo "-> $(echo "$suites" | wc -w) suites; $ROUNDS round(s), --jobs $RI_JOBS"
t0=$(date +%s)
for r in $(seq 1 "$ROUNDS"); do for s in $suites; do echo "$s $r"; done; done |
  xargs -P "$RI_JOBS" -L1 bash -c 'conc_one "$@"' _ || true
dur=$(( $(date +%s) - t0 ))
RI_CMDS+="vitest run test/e2e/concurrency/<suite>.e2e.spec.ts x$ROUNDS (jobs $RI_JOBS)"$'\n'
echo; echo "Per-suite results (passes/runs, seeds):"
for s in $suites; do
  pass=0; seeds=""
  for r in $(seq 1 "$ROUNDS"); do
    log="$RI_OUT/logs/conc-$s-r$r.log"
    [ "$(cat "$log.rc" 2>/dev/null || echo 1)" = 0 ] && pass=$((pass+1))
    seeds+="$(sed 's/\x1b\[[0-9;]*m//g' "$log" | grep -oE 'seed=[0-9]+' | head -1 | cut -d= -f2) "
    ri_count_log "$log"
  done
  if [ "$pass" = "$ROUNDS" ]; then st=PASS; else st=FAIL; fi
  ri_record "$s" "$st" "$pass/$ROUNDS runs passed; seeds: $seeds"
done
ri_record "suites-wall-time" PASS "${dur}s for $(echo "$suites" | wc -w) suites x $ROUNDS"
ri_finish
