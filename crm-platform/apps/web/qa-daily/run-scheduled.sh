#!/usr/bin/env bash
# What cron/systemd calls. Loads the secrets from ~/.config/wadesk-qa/env (never in git), updates the checkout, then runs the day:
#   1. maintain  - journeys follow the product (tests-only PR, merged)
#   2. production run: verify yesterday's fixes, run the journeys + crawl, fill the sheet, fix + PR (+ merge when AUTOMERGE=1)
# Staging is the same host as production today; set QA_STAGING_URL to a different host later and the same run covers it.
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . "${QA_ENV_FILE:-$HOME/.config/wadesk-qa/env}"; set +a
LOG="$HOME/.local/state/wadesk-qa/logs"; mkdir -p "$LOG"; exec >> "$LOG/$(date +%F).log" 2>&1
echo "=== $(date -Is) daily QA"
git -C "$(git rev-parse --show-toplevel)" fetch -q origin main
pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 || true
[ "${QA_MAINTAIN:-1}" = "1" ] && node qa-daily/maintain.mjs
node qa-daily/daily.mjs --target prod --fix --max-fix "${AUTOFIX_MAX:-3}"
if [ -n "${QA_STAGING_URL:-}" ]; then QA_BASE_URL="$QA_STAGING_URL" node qa-daily/daily.mjs --target prod --no-crawl; fi
