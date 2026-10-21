#!/usr/bin/env bash
# Session and token security runner (sheet item 37): cookies, token exposure, JWT hardening, refresh/expiry, key ring.
SEC_NAME=session-token-security; SEC_SHEET=37; SEC_TITLE="Session and token security"
sec_help() { cat <<'H'
Session and token security (sheet 37): the session/token pieces of tools/quality/security-specs.sh.
  run.sh [--quick] [--out DIR]
  quick: API jwt-hardening + token-expiry + web cookies/token-exposure (~1 min).  full: all API and web auth specs of security-specs.sh.
Needs: node 22, pnpm, installed dependencies. No Docker or database. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common-security.sh"
sec_init "$@"
sec_prereq node22 pnpm
A=test/unit/auth-registration-security
if [ "$SEC_MODE" = quick ]; then
  sec_vitest api-jwt-and-expiry api $A/jwt-hardening.spec.ts $A/token-expiry.spec.ts
  sec_vitest web-cookies-token-exposure web src/lib/auth/cookies.test.ts src/lib/auth/token-exposure.test.ts
else
  sec_vitest api-session-token api $A/jwt-hardening.spec.ts $A/token-expiry.spec.ts $A/crypto-key-ring.spec.ts $A/jwt-guard-partner-and-redis.spec.ts
  sec_vitest web-auth-lib web src/lib/auth
fi
sec_finish
