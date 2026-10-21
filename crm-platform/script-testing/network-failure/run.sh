#!/usr/bin/env bash
set -euo pipefail
RI_ID=network-failure; RI_SHEET=18; RI_TITLE="Network failure testing (parts 1 and 2)"
RI_HELP="Runs the network-failure tests of PRs #436 and #663: API unit specs (clients, dependency outage, timeout ratchet), the integration specs behind a TCP fault proxy (api-outage, recovery) on a throwaway database and a private Redis db index, and the web ratchets (fetch-ratchet, client-deadline).
Needs: docker, node 22, pnpm, running crm-platform-postgres and crm-platform-redis (used only as servers).
Time: quick ~3 min (skips recovery.spec), full ~8 min."
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common-integration.sh"
ri_init "$@"
ri_prereqs docker node pnpm deps postgres redis
ri_build_packages
# shared servers, own throwaway db (created by the test infra, dropped at its end) and Redis db 8 with random queue prefixes
export NF_PG_ADMIN_URL="postgres://crm:crm@localhost:5432/postgres" NF_REDIS_URL="redis://localhost:56379/8"
cd "$API_DIR"
ri_try api-unit pnpm exec vitest run test/unit/network-failure
integ=(test/integration/network-failure/api-outage.spec.ts)
[ "$RI_MODE" = full ] && integ+=(test/integration/network-failure/recovery.spec.ts)
ri_try api-integration-fault-proxy pnpm exec vitest run "${integ[@]}" --testTimeout=120000
cd "$WEB_DIR"
ri_try web-ratchets pnpm exec vitest run src/lib/network-failure src/lib/api/client-deadline.test.ts
ri_finish
