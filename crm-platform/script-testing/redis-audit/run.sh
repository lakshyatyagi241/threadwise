#!/usr/bin/env bash
set -euo pipefail
RI_ID=redis-audit; RI_SHEET=67; RI_TITLE="Redis audit"
RI_HELP="Runs the Redis audit of PR #713: the ratchets in test/unit/redis (no Redis needed), the integration specs in test/integration/redis (each starts PRIVATE Redis containers on free ports: counter TTL, full server, slow server, restart, key hygiene under load, queue retention, connection footprint) and 'node tools/redis-audit/inventory.mjs --check' (the committed inventory is not stale).
--quick: counter-ttl + connection-footprint + queue-retention. Full: all six specs.
The shared Redis (port 6379/56379) is never touched; the tests refuse it.
Needs: docker, node 22, pnpm.  Time: quick ~4 min, full ~12 min.
Known baseline: redis-hygiene has 2 failing tests on pristine main; they are reported as known baseline, not as failures."
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common.sh"
ri_init "$@"
ri_prereqs docker node pnpm deps
ri_build_packages
cd "$API_DIR"
ri_try unit-ratchets pnpm exec vitest run test/unit/redis
D=test/integration/redis
if [ "$RI_MODE" = quick ]; then specs=("$D/counter-ttl.spec.ts" "$D/connection-footprint.spec.ts" "$D/queue-retention.spec.ts"); else specs=("$D"/*.spec.ts); fi
ri_try integration-private-redis pnpm exec vitest run "${specs[@]}" --testTimeout=300000
cd "$CRM_ROOT"
ri_try inventory-check node tools/redis-audit/inventory.mjs --check
ri_finish
