#!/usr/bin/env bash
# SSRF test runner (sheet item 29, PR #417). Runs the exact specs written for the SSRF work.
SEC_NAME=ssrf; SEC_SHEET=29; SEC_TITLE="SSRF protection"
sec_help() { cat <<'H'
SSRF protection (sheet 29): address and URL matrices, outbound ratchet, guarded request, connect-time check.
  run.sh [--quick] [--out DIR]
  quick: test/unit/ssrf/* only (~1 min).  full (default): + test/unit/security SSRF specs, test/unit/net, send/deliver/safe-fetch specs.
Needs: node 22, pnpm, installed dependencies. No Docker or database. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common-security.sh"
sec_init "$@"
sec_prereq node22 pnpm
sec_vitest ssrf-matrices-and-ratchet api test/unit/ssrf
if [ "$SEC_MODE" = full ]; then
  sec_vitest ssrf-security-specs api test/unit/security/ssrf-address-rules.spec.ts test/unit/security/ssrf-url-vectors.spec.ts \
    test/unit/security/guarded-request-bytes.spec.ts test/unit/net
  sec_vitest ssrf-callers api test/unit/outbound-webhooks/send.spec.ts test/unit/webhook-fanout/deliver.spec.ts \
    test/unit/node-bridge-runtime/safe-fetch.spec.ts
fi
sec_finish
