#!/usr/bin/env bash
# Read-only diagnosis of a mobile development setup. Prints a line per check and what to do about a failure. Changes nothing.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
APP="$REPO_ROOT/apps/mobile"
cd "$REPO_ROOT"

c_reset=$'\033[0m'; c_green=$'\033[32m'; c_red=$'\033[31m'; c_yellow=$'\033[33m'
FAILED=0
ok()   { echo "${c_green}  ok${c_reset}   $*"; }
bad()  { echo "${c_red}  FAIL${c_reset} $*"; FAILED=1; }
warn() { echo "${c_yellow}  warn${c_reset} $*"; }

# Node
want="$(tr -d 'v\r\n ' < .nvmrc 2>/dev/null || echo 22)"
have="$(node -v 2>/dev/null | tr -d 'v')"
if [ -z "$have" ]; then bad "node not found. Install Node $want (see .nvmrc)."
elif [ "${have%%.*}" != "${want%%.*}" ]; then bad "node $have, but .nvmrc wants $want. Switch with nvm/fnm."
else ok "node $have"; fi

# pnpm
if command -v pnpm >/dev/null 2>&1; then
  v="$(pnpm -v)"; case "$v" in 9.*) ok "pnpm $v" ;; *) warn "pnpm $v; the repo pins 9.15.4 (corepack enable)" ;; esac
else bad "pnpm not found. Run: corepack enable"; fi

# dependencies and built packages
if [ -d node_modules ] && [ -d apps/mobile/node_modules ]; then ok "dependencies installed"; else bad "dependencies missing. Run: pnpm install"; fi
for p in tax contracts; do
  if [ -f "packages/$p/dist/index.js" ]; then ok "@crm/$p built"; else bad "@crm/$p not built (Metro and Jest import it). Run: pnpm --filter @crm/$p build"; fi
done

# .env and API reachability
api=""
if [ -f "$APP/.env" ]; then
  api="$(sed -n 's/^EXPO_PUBLIC_API_URL=//p' "$APP/.env" | head -1 | tr -d '\r ')"
  case "$api" in http://*|https://*) ok "EXPO_PUBLIC_API_URL=$api" ;; *) bad "EXPO_PUBLIC_API_URL in apps/mobile/.env is missing or not a URL" ;; esac
else
  bad "apps/mobile/.env missing. Run: cp apps/mobile/.env.example apps/mobile/.env, then set EXPO_PUBLIC_API_URL"
fi
if [ -n "$api" ]; then
  # The phone reaches the API differently from this computer (10.0.2.2 only exists inside the Android emulator), so test the local equivalent.
  probe="${api/10.0.2.2/localhost}"
  code="$(curl -s -o /dev/null -m 5 -w '%{http_code}' "$probe/health" 2>/dev/null || true)"
  if [ "$code" = "200" ]; then ok "API answers at $probe/health"; else warn "API did not answer 200 at $probe/health (got '${code:-no answer}'). Start it: pnpm infra:up && pnpm dev (setup skill)"; fi
  case "$api" in *localhost*|*127.0.0.1*) warn "EXPO_PUBLIC_API_URL uses localhost: right for the iOS simulator only. Android emulator: 10.0.2.2. Real phone: your LAN IP" ;; esac
fi

# Android tooling (optional: EAS can build in the cloud)
if [ -n "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]; then ok "ANDROID_HOME set"; else warn "ANDROID_HOME not set. Needed only for local Android builds; otherwise use EAS (docs/runbooks/mobile-local-development.md)"; fi
if command -v adb >/dev/null 2>&1; then ok "adb found ($(adb devices | sed -n '2,$p' | grep -c 'device$') device(s) attached)"; else warn "adb not on PATH"; fi

# OneDrive
case "$REPO_ROOT" in *OneDrive*) warn "the repo is under OneDrive. Gradle/Metro are slow and break there (locked files, long paths). Move it to a short local path." ;; esac

echo
if [ "$FAILED" -eq 0 ]; then echo "Setup looks good. Next: docs/runbooks/mobile-local-development.md ('First run')."; else echo "Fix the FAIL lines, then run this again."; fi
exit $FAILED
