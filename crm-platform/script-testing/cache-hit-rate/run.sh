#!/usr/bin/env bash
set -euo pipefail
RI_ID=cache-hit-rate; RI_SHEET=65; RI_TITLE="Cache hit-rate monitoring"
RI_HELP="Runs the checks of PRs #720 and #735: the instrumentation ratchet and counter tests (apps/api/test/unit/cache-audit), the packages/observability cache-metrics spec, 'promtool check rules' and 'promtool test rules' with the pinned image prom/prometheus:v2.55.0, AND a live rules check: a private Prometheus container loads deploy/observability/*.rules.yml, the API is booted (port 3932, metrics 59532, Redis db 8, throwaway database), traffic is generated, and every rule of the cache-hit-rate group must have health=ok with non-empty lookups / hit-ratio series. The promtool tests alone cannot catch the series-collision bug; the live check can.
Needs: docker, node 22, pnpm, running crm-platform-postgres and crm-platform-redis; builds the API if apps/api/dist is missing (~2 min).
Time: quick ~6 min (live traffic 45 s); full is the same set plus the micro-benchmark spec."
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common.sh"
ri_init "$@"
ri_prereqs docker node pnpm deps postgres redis
ri_build_packages
cd "$API_DIR"
ri_try instrumentation-and-counters pnpm exec vitest run test/unit/cache-audit/instrumentation.spec.ts test/unit/cache-audit/cache-metrics.spec.ts test/unit/cache-audit/workload-ratios.spec.ts test/unit/cache-audit/ratchet.spec.ts
[ "$RI_MODE" = full ] && ri_try overhead-bench pnpm exec vitest run test/unit/cache-audit/overhead.bench.spec.ts
cd "$CRM_ROOT/packages/observability"
ri_try observability-cache-metrics pnpm exec vitest run src/cache-metrics.spec.ts
cd "$CRM_ROOT"
PROM=prom/prometheus:v2.55.0
D="$CRM_ROOT/deploy/observability"
ri_try promtool-check-rules docker run --rm --entrypoint promtool -v "$D:/r:ro" $PROM check rules /r/cache-hit-rate.rules.yml /r/event-loop.rules.yml /r/queue-capacity.rules.yml /r/resource-limits.rules.yml
ri_try promtool-test-rules docker run --rm --entrypoint promtool -v "$D:/r:ro" -w /r $PROM test rules cache-hit-rate.rules.test.yml event-loop.rules.test.yml queue-capacity.rules.test.yml resource-limits.rules.test.yml
# live check
[ -f apps/api/dist/src/main.js ] || ri_try build-api pnpm --filter @crm/api build
ri_create_db
export MIGRATION_DATABASE_URL="$RI_DB_OWNER_URL" DATABASE_URL="$RI_DB_OWNER_URL" NODE_ENV=development
ri_try db-migrate pnpm --filter @crm/db migrate
ri_try db-seed pnpm --filter @crm/db seed
unset MIGRATION_DATABASE_URL DATABASE_URL
ri_try live-rules-check env LIVE_DB_URL="postgres://crm_app_user:crm_app_dev@localhost:5432/$RI_DB" API_PORT=3932 METRICS_PORT=59532 REDIS_DB=8 OUT_DIR="$RI_OUT/live" node script-testing/cache-hit-rate/live-rules-check.mjs
ri_artifact "$RI_OUT/live/live-checks.json"
sed 's/\x1b\[[0-9;]*m//g' "$RI_OUT/logs/live-rules-check.log" | tail -n 25 || true
ri_finish
