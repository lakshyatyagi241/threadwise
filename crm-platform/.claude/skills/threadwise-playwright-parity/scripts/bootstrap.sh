#!/usr/bin/env bash
# Install the Playwright twin-run harness (pinned versions, no workspace changes) and check for a matching browser.
# Idempotent. Browser binaries are NOT downloaded unless you pass --install-browsers (ask the user first: ~150 MB).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
harness="$here/../harness"
install_browsers=0
[ "${1:-}" = "--install-browsers" ] && install_browsers=1

fail() { echo "bootstrap: $*" >&2; exit 1; }
command -v node >/dev/null || fail "node not found (need >= 22)"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || fail "node $(node -v) is too old, need >= 22"
command -v npm >/dev/null || fail "npm not found"

cd "$harness" || fail "no harness dir at $harness"
if [ ! -d node_modules/playwright ] || [ ! -d node_modules/axe-core ]; then
  echo "installing harness dependencies (playwright, axe-core) into $harness/node_modules ..."
  if [ -f package-lock.json ]; then npm ci --no-audit --no-fund --loglevel=error || fail "npm ci failed"
  else npm install --no-audit --no-fund --loglevel=error || fail "npm install failed"; fi
fi

exe="$(node -e 'import("playwright").then(async m => { console.log(m.chromium.executablePath()); })' 2>/dev/null)"
if [ -z "$exe" ] || [ ! -x "$exe" ]; then
  if [ "$install_browsers" = 1 ]; then
    echo "downloading Chromium for Playwright ..."
    npx --no-install playwright install chromium || fail "browser download failed"
  else
    echo "bootstrap: Playwright's Chromium is not installed (expected $exe)." >&2
    echo "  This downloads about 150 MB from Playwright's CDN. With the user's OK run:" >&2
    echo "    bash .claude/skills/threadwise-playwright-parity/scripts/bootstrap.sh --install-browsers" >&2
    exit 3
  fi
fi
echo "ready: playwright $(node -p 'require("./node_modules/playwright/package.json").version'), chromium at $exe"
