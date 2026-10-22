#!/usr/bin/env bash
# CSRF / CORS / security headers runner (sheet item 32, PR #425).
SEC_NAME=csrf-cors-headers; SEC_SHEET=32; SEC_TITLE="CSRF, CORS and security headers"
sec_help() { cat <<'H'
CSRF/CORS/headers (sheet 32): unit specs (api headers-cors.spec.ts, cors-policy.spec.ts, web src/lib/auth/csrf.test.ts) plus a LIVE check:
boots the API (own database, redis db 9) with NODE_ENV=production and one allowed origin, then asserts with curl: security headers on
responses, allowed origin echoed with credentials, denied/null/suffix origins not echoed, preflight allowed and denied, no wildcard.
  run.sh [--quick] [--out DIR]
  quick and full run the same checks (~2 min; the first run also builds the API, +1 min). Ports: API 3931.
Needs: node 22, pnpm, docker, curl, crm-platform-postgres and crm-platform-redis running. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
sec_prereq node22 pnpm docker curl postgres redis
if [ -z "${SEC_LIVE_ONLY:-}" ]; then # SEC_LIVE_ONLY=1 skips the unit specs (debugging the live part)
  sec_vitest csrf-cors-headers-api api test/unit/security/headers-cors.spec.ts test/unit/platform-infrastructure/cors-policy.spec.ts
  sec_vitest csrf-web web src/lib/auth/csrf.test.ts
fi

ALLOWED=https://app.example.com
sec_boot_api NODE_ENV=production CORS_ORIGINS="$ALLOWED"
URL="$SEC_API/v2/contacts"
hdr() { curl -s -D - -o /dev/null --max-time 10 "$@" | tr -d '\r'; }
val() { grep -i "^$1:" | head -1 | cut -d: -f2- | sed 's/^ *//' || true; }
chk() { if [ "$2" = ok ]; then sec_check "$1" PASS "${3:-}"; else sec_check "$1" FAIL "${3:-}"; fi; }

H=$(hdr "$SEC_API/health"); echo "$H" >"$SEC_OUT/logs/live-health-headers.txt"
for h in x-content-type-options referrer-policy permissions-policy x-frame-options content-security-policy x-request-id; do
  v=$(val $h <<<"$H"); chk "header-$h" "$([ -n "$v" ] && echo ok)" "${v:-missing}"
done
chk header-hsts-not-on-plain-http "$([ -z "$(val strict-transport-security <<<"$H")" ] && echo ok)"
H2=$(hdr -H "X-Forwarded-Proto: https" "$SEC_API/health")
chk header-hsts-on-https "$([[ "$(val strict-transport-security <<<"$H2")" == *max-age=31536000* ]] && echo ok)" "$(val strict-transport-security <<<"$H2")"
# informational (not asserted by the original tests): framework banner
sec_check note-x-powered-by PASS "x-powered-by: $(val x-powered-by <<<"$H"), not asserted by the original specs"

H=$(hdr -H "Origin: $ALLOWED" "$URL"); echo "$H" >"$SEC_OUT/logs/live-cors-allowed.txt"
chk cors-allowed-origin-echoed "$([ "$(val access-control-allow-origin <<<"$H")" = "$ALLOWED" ] && echo ok)" "$(val access-control-allow-origin <<<"$H")"
chk cors-allowed-credentials "$([ "$(val access-control-allow-credentials <<<"$H")" = true ] && echo ok)"
chk cors-vary-origin "$([[ "$(val vary <<<"$H")" == *rigin* ]] && echo ok)" "$(val vary <<<"$H")"
for o in https://evil.example.com null "https://app.example.com.evil.com" "http://app.example.com" "https://sub.app.example.com"; do
  H=$(hdr -H "Origin: $o" "$URL")
  chk "cors-denied-$o" "$([ -z "$(val access-control-allow-origin <<<"$H")" ] && echo ok)" "allow-origin: ${H:+$(val access-control-allow-origin <<<"$H")}"
done
P=$(hdr -X OPTIONS -H "Origin: $ALLOWED" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type,authorization" "$URL")
echo "$P" >"$SEC_OUT/logs/live-preflight-allowed.txt"
chk preflight-allowed "$([ "$(val access-control-allow-origin <<<"$P")" = "$ALLOWED" ] && [ -n "$(val access-control-allow-methods <<<"$P")" ] && echo ok)" "methods: $(val access-control-allow-methods <<<"$P")"
P=$(hdr -X OPTIONS -H "Origin: https://evil.example.com" -H "Access-Control-Request-Method: POST" "$URL")
chk preflight-denied "$([ -z "$(val access-control-allow-origin <<<"$P")" ] && echo ok)"
ANY=$( { hdr -H "Origin: $ALLOWED" "$URL"; hdr -H "Origin: https://evil.example.com" "$URL"; } | val access-control-allow-origin | grep -c '^\*$' || true)
chk cors-never-wildcard "$([ "$ANY" = 0 ] && echo ok)"
sec_finish
