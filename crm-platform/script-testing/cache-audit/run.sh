#!/usr/bin/env bash
set -euo pipefail
RI_ID=cache-audit; RI_SHEET=64; RI_TITLE="Cache strategy audit"
RI_HELP="Runs the cache audit of PR #714: all of apps/api/test/unit/cache-audit (register ratchet: every cache and every Redis writer is in docs/performance/cache/register.json, bounded caches, behaviour, counter TTL, RBAC Lua path on a real Redis if reachable), the web cache-audit spec (apps/web/src/lib/cache-audit) and the sign-out render test (user-menu.logout-cache.render.test.tsx), plus a JSON check of register.json.
Needs: node 22, pnpm (docker only if the real-Redis spec starts a container).
Time: about 3 min (quick and full are the same set; --quick skips the micro-benchmark spec)."
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common.sh"
ri_init "$@"
ri_prereqs node pnpm deps
ri_build_packages
cd "$API_DIR"
if [ "$RI_MODE" = quick ]; then
  ri_try api-unit pnpm exec vitest run test/unit/cache-audit --exclude '**/overhead.bench.spec.ts'
else
  ri_try api-unit pnpm exec vitest run test/unit/cache-audit
fi
cd "$WEB_DIR"
ri_try web-cache-audit-and-signout pnpm exec vitest run src/lib/cache-audit src/components/shell/user-menu.logout-cache.render.test.tsx
ri_try register-json-valid node -e '
const j=require(process.argv[1]);const k=Object.keys(j);if(!k.length)process.exit(1);console.log("register.json sections: "+k.join(", "))' "$CRM_ROOT/docs/performance/cache/register.json"
ri_finish
