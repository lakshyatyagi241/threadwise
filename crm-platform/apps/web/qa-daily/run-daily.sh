#!/usr/bin/env bash
# Daily QA: regenerate the feature file, explore every page, push bugs to the Google Sheet, optionally auto-fix open bugs.
# Needs the stack up (API :3000, web :3001) and QA_SHEET_URL / QA_SHEET_TOKEN set (see README.md).
#   AUTOFIX=1 qa-daily/run-daily.sh
set -euo pipefail
cd "$(dirname "$0")/.."

curl -fsS -o /dev/null "${WEB_URL:-http://localhost:3001}/login" || { echo "web app is not running on ${WEB_URL:-:3001}"; exit 1; }

node qa-daily/gen-feature.mjs
HEADLESS=1 pnpm exec playwright test -c qa-daily/playwright.config.ts
node qa-daily/sheet.mjs push
if [ "${AUTOFIX:-0}" = "1" ]; then node qa-daily/autofix.mjs; fi
