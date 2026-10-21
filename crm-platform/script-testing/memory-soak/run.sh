#!/usr/bin/env bash
set -euo pipefail
RI_ID=memory-soak; RI_SHEET=58; RI_TITLE="Memory-leak soak"
RI_HELP="Wraps 'node tools/perf/soak.mjs --minutes N' (PR #737): boots the built API and worker with --expose-gc, drives ~15 req/s of mixed traffic, samples RSS/heap/handles/event-loop/Redis/Postgres every 10 s, fits a slope per series with a 95% interval and exits 1 on sustained growth.
--quick = 5 minutes. Default (full) = 20 minutes. --minutes N overrides (1440 for the 24 h run).
The runner creates a throwaway migrated + seeded database (dropped at the end), uses ports API 3932 (worker 3933) and Redis db 8.
Output: soak.csv and soak.json under <out>/soak/. Needs: docker, node 22, pnpm, running crm-platform-postgres and crm-platform-redis; builds the API if apps/api/dist is missing (~2 min).
IMPORTANT: a short run cannot settle a leak. 5 or 20 minutes only catches fast leaks; slow ones need the 24 h run (--minutes 1440), on a quiet machine."
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common-integration.sh"
ri_init "$@"
ri_prereqs docker node pnpm deps postgres redis
ri_build_packages
M=${RI_MINUTES:-20}; [ "$RI_MODE" = quick ] && [ -z "$RI_MINUTES" ] && M=5
cd "$CRM_ROOT"
[ -f apps/api/dist/src/main.js ] || ri_try build-api pnpm --filter @crm/api build
ri_create_db
export MIGRATION_DATABASE_URL="$RI_DB_OWNER_URL" DATABASE_URL="$RI_DB_OWNER_URL" NODE_ENV=development
ri_try db-migrate pnpm --filter @crm/db migrate
ri_try db-seed pnpm --filter @crm/db seed
export SOAK_DATABASE="$RI_DB" SOAK_REDIS_DB=8
unset MIGRATION_DATABASE_URL DATABASE_URL
echo "!! soak of $M minute(s) running; a short run cannot settle a leak."
ri_try soak node tools/perf/soak.mjs --minutes "$M" --port 3932 --out "$RI_OUT/soak"
ri_artifact "$RI_OUT/soak/soak.csv"; ri_artifact "$RI_OUT/soak/soak.json"
echo; echo "---- soak output (slopes with 95% intervals and verdict) ----"
tail -n 40 "$RI_OUT/logs/soak.log" || true
echo "---- soak.csv / soak.json: $RI_OUT/soak/ ----"
echo "NOTE: a ${M}-minute run cannot settle a leak: PASS means no fast growth was seen, not that there is no leak. Run --minutes 1440 for the real answer."
ri_finish
