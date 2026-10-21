#!/usr/bin/env bash
# Encryption audit runner (sheet item 35, PR #666).
SEC_NAME=encryption-audit; SEC_SHEET=35; SEC_TITLE="Encryption audit"
sec_help() { cat <<'H'
Encryption audit (sheet 35): unit specs (encryption-audit, plaintext-secret-ratchet, transport-tls, secret-columns, crypto-bound-blobs,
seal-plaintext-secrets, crypto, key ring), the integration specs under test/integration/security (full only), and the seal CLI run on
seeded plaintext Telegram bot tokens in a throwaway database: dry-run, seal, rerun, scrub, with lookups before and after each step.
  run.sh [--quick] [--out DIR]
  quick: unit specs + seal-CLI scenario (a few minutes).  full: + integration specs (start their own Postgres containers, slow).
Needs: node 22, pnpm, docker, container crm-platform-postgres running. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
sec_prereq node22 pnpm docker postgres
sec_build_packages
S=test/unit/security
sec_vitest encryption-unit-specs api $S/encryption-audit.spec.ts $S/plaintext-secret-ratchet.spec.ts $S/transport-tls.spec.ts \
  $S/secret-columns.spec.ts $S/crypto-bound-blobs.spec.ts $S/seal-plaintext-secrets.spec.ts test/unit/crypto.spec.ts \
  test/unit/auth-registration-security/crypto-key-ring.spec.ts

# --- seal CLI scenario on a throwaway database ---
sec_db_create; sec_db_migrate
CLI=src/modules/platform-infrastructure/crypto-rotation/seal-plaintext-secrets.cli.ts
seal() { (cd "$CRM_ROOT/apps/api" && MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" DATABASE_URL="$SEC_DB_ADMIN_URL" pnpm exec tsx "$CLI" "$@") 2>&1; }
find_tok() { sec_psql -c "SELECT count(*) FROM tg_bot_lookup('$1')"; }
tok_hash() { node -e 'console.log(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex"))' "$1"; }
TOK="qa-legacy-token-$SEC_SUFFIX-aaaaaaaaaaaaaaaa"
ORG=$(sec_psql -c "INSERT INTO organizations (slug,name,plan) VALUES ('qa-$SEC_SUFFIX','QA','starter') RETURNING id" | head -1)
sec_psql -c "INSERT INTO telegram_bots (org_id, bot_token, webhook_token) VALUES ($ORG,'x','$TOK')" >/dev/null
SEC_CMDS+=("seal-plaintext-secrets.cli.ts --dry-run | (none) | --scrub  (seeded telegram_bots row)")
step() { # name, condition-result
  if [ "$2" = ok ]; then sec_check "$1" PASS "${3:-}"; else sec_check "$1" FAIL "${3:-}"; fi
}
step seal-seed-lookup-before "$([ "$(find_tok "$TOK")" = 1 ] && echo ok)" "plaintext row resolves by token"
DRY=$(seal --dry-run | tee "$SEC_OUT/logs/seal-dry-run.log" | grep '^telegram_bots' || true)
step seal-dry-run "$([[ "$DRY" == *"found 1,"* ]] && echo ok)" "$DRY"
ENC_BEFORE=$(sec_psql -c "SELECT count(*) FROM telegram_bots WHERE webhook_token_enc IS NOT NULL")
step seal-dry-run-changes-nothing "$([ "$ENC_BEFORE" = 0 ] && echo ok)" "sealed copies after dry-run: $ENC_BEFORE"
REAL=$(seal | tee "$SEC_OUT/logs/seal-run.log" | grep '^telegram_bots' || true)
step seal-run "$([[ "$REAL" == *"changed 1,"* ]] && echo ok)" "$REAL"
H=$(sec_psql -c "SELECT webhook_token_hash FROM telegram_bots WHERE org_id=$ORG")
step seal-hash-and-copy "$([ "$H" = "$(tok_hash "$TOK")" ] && [ "$(sec_psql -c "SELECT webhook_token_enc LIKE 'v_:%' FROM telegram_bots WHERE org_id=$ORG")" = t ] && echo ok)" "hash matches sha256, sealed copy present"
step seal-lookup-after-seal "$([ "$(find_tok "$TOK")" = 1 ] && echo ok)"
AGAIN=$(seal | tee "$SEC_OUT/logs/seal-rerun.log" | grep '^telegram_bots' || true)
step seal-rerun-idempotent "$([[ "$AGAIN" == *"found 0,"* ]] && echo ok)" "$AGAIN"
SCR=$(seal --scrub | tee "$SEC_OUT/logs/seal-scrub.log" | grep '^telegram_bots' || true)
step seal-scrub "$([[ "$SCR" == *"changed 1,"* ]] && echo ok)" "$SCR"
step seal-plaintext-gone "$([ "$(sec_psql -c "SELECT webhook_token IS NULL FROM telegram_bots WHERE org_id=$ORG")" = t ] && echo ok)" "plaintext column is NULL"
step seal-lookup-after-scrub "$([ "$(find_tok "$TOK")" = 1 ] && [ "$(find_tok wrong-token-wrong-token-wrong)" = 0 ] && echo ok)" "URL token still resolves; wrong token does not"

if [ "$SEC_MODE" = full ]; then
  sec_vitest encryption-integration api test/integration/security
fi
sec_finish
