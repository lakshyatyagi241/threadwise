#!/usr/bin/env bash
set -euo pipefail
RI_ID=cache-invalidation; RI_SHEET=66; RI_TITLE="Cache invalidation testing"
RI_HELP="Runs the cache-invalidation tests of PR #723: the writers ratchet (test/unit/cache-invalidation), the integration specs (test/integration/cache-invalidation: throwaway database on the dev Postgres, private Redis container, several API 'instances' in one process plus a cross-process helper), and checks that docs/performance/cache/invalidation-results.json is consistent (measured stale time never above the documented bound).
--quick: ratchet + smoke + access-control + matrix check. Full: every integration spec.
Needs: docker, node 22, pnpm, running crm-platform-postgres (server only).
Time: quick ~3 min, full ~15 min."
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common-integration.sh"
ri_init "$@"
ri_prereqs docker node pnpm deps postgres
ri_build_packages
export TEST_PG_ADMIN_URL="postgres://crm:crm@127.0.0.1:5432/postgres"
cd "$API_DIR"
ri_try unit-writers-ratchet pnpm exec vitest run test/unit/cache-invalidation
D=test/integration/cache-invalidation
if [ "$RI_MODE" = quick ]; then specs=("$D/smoke.spec.ts" "$D/access-control.spec.ts"); else specs=("$D"/*.spec.ts); fi
ri_try integration pnpm exec vitest run "${specs[@]}" --testTimeout=180000
ri_try matrix-file-consistent node "$CRM_ROOT/script-testing/cache-invalidation/check-matrix.mjs" "$CRM_ROOT/docs/performance/cache/invalidation-results.json"
ri_finish
