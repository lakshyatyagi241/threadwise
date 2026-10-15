#!/usr/bin/env bash
# The security regression specs (QA tasks 29 SSRF, 35 encryption, 37 session and token security) on their own, with no Docker and no
# database: address rules, URL vectors, webhook delivery, encryption, token and cookie handling. They are also part of the normal unit
# suites (`pnpm test`), so every pre-pr run and the Quality workflow already executes them; this is the quick, named run for a release.
#   bash crm-platform/tools/quality/security-specs.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
printf '\n==> API security specs\n'
pnpm --filter @crm/api exec vitest run --dir test/unit \
  test/unit/security \
  test/unit/net \
  test/unit/crypto.spec.ts \
  test/unit/outbound-webhooks/send.spec.ts \
  test/unit/webhook-fanout/deliver.spec.ts \
  test/unit/node-bridge-runtime/safe-fetch.spec.ts \
  test/unit/auth-registration-security/jwt-hardening.spec.ts \
  test/unit/auth-registration-security/token-expiry.spec.ts \
  test/unit/auth-registration-security/crypto-key-ring.spec.ts \
  test/unit/auth-registration-security/jwt-guard-partner-and-redis.spec.ts
printf '\n==> Web session and cookie specs\n'
pnpm --filter @crm/web exec vitest run src/lib/auth
printf '\nAll security specs passed.\n'
