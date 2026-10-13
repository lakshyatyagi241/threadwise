#!/usr/bin/env bash
# Bring a local checkout up to date and make the running dev stack match it:
#   1. merge origin/main (skip with --no-merge),
#   2. install dependencies,
#   3. rebuild @crm/contracts and @crm/db,
#   4. apply pending database migrations (local dev database only),
#   5. rebuild the API and restart the API and the worker from the built files,
#   6. optionally restart the web dev server (--web).
#
# Why from the built files: two `nest start --watch` processes in one repo fight over `dist` on Windows, and an API that was started
# before a pull keeps serving the old code (new routes answer 404) until it is rebuilt and restarted. Run this after every pull.
#
# Usage: bash tools/dev-refresh.sh [--no-merge] [--no-restart] [--restart-only] [--web]
#   --restart-only  skip merge, install, build and migrate; just restart the API and worker from the current build
# Logs go to .dev-run/ (ignored by git). Needs the Docker infra (Postgres, Redis) already up.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

MERGE=1
RESTART=1
WEB=0
BUILD=1
for arg in "$@"; do
  case "$arg" in
    --no-merge) MERGE=0 ;;
    --no-restart) RESTART=0 ;;
    --web) WEB=1 ;;
    --restart-only) MERGE=0; BUILD=0 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# On Windows the SWC native binding is unpacked into a cache directory; when the default one is not writable the build and the vitest
# run die with ERR_SWC_NATIVE_CACHE. Point it at a writable directory in the home folder (turbo.json passes it through to the tasks).
if [ -z "${SWC_NATIVE_BINDING_CACHE:-}" ]; then
  case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) export SWC_NATIVE_BINDING_CACHE="$HOME/.swc-native-cache"; mkdir -p "$SWC_NATIVE_BINDING_CACHE" ;; esac
fi

step() { printf '\n==> %s\n' "$*"; }

is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac; }

# Stop node processes whose command line matches the pattern. Matching is by command line only, so on a machine that runs several
# checkouts it stops the same processes of all of them.
stop_matching() {
  local pattern="$1"
  if is_windows; then
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -match '$pattern' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1 || true
  else
    pkill -f "$pattern" >/dev/null 2>&1 || true
  fi
}

# Start `node <script>` detached from this shell, logging to a file. Run the script in a terminal or redirect its output to a file: on
# Windows a child started from a shell whose output is a pipe (`bash tools/dev-refresh.sh | tail`) keeps that pipe open, so the pipe only
# closes when the API stops.
start_node() {
  local script="$1" log="$2" worker="${3:-0}"
  if is_windows; then
    local dir winlog winerr
    dir="$(cygpath -w "$ROOT/apps/api")"
    winlog="$(cygpath -w "$log")"
    winerr="$(cygpath -w "${log%.log}.err.log")"
    local envset="Remove-Item Env:WORKER_MODE -ErrorAction SilentlyContinue"
    [ "$worker" = 1 ] && envset="\$env:WORKER_MODE = 'true'"
    powershell -NoProfile -Command "$envset; Start-Process -FilePath node -ArgumentList '$script' -WorkingDirectory '$dir' -WindowStyle Hidden -RedirectStandardOutput '$winlog' -RedirectStandardError '$winerr'" >/dev/null
  else
    (cd apps/api && WORKER_MODE="$([ "$worker" = 1 ] && echo true)" nohup node "$script" > "$log" 2>&1 < /dev/null &)
  fi
}

if [ "$MERGE" = 1 ]; then
  step "Merging origin/main"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "You have uncommitted changes. Commit or stash them first (or run with --no-merge)." >&2
    exit 1
  fi
  git fetch origin
  git merge origin/main
fi

if [ "$BUILD" = 1 ]; then
  step "Installing dependencies"
  pnpm install --frozen-lockfile --prefer-offline

  step "Building tax, contracts and db"
  pnpm --filter @crm/tax build
  pnpm --filter @crm/contracts build
  pnpm --filter @crm/db build

  step "Applying migrations to the local database"
  pnpm db:migrate

  step "Building the API"
  (cd apps/api && npx nest build -b swc)
fi

if [ "$RESTART" = 1 ]; then
  mkdir -p .dev-run
  step "Restarting the API and the worker"
  stop_matching 'dist.src.(main|worker)\.js'
  sleep 1
  start_node dist/src/main.js "$ROOT/.dev-run/api.log"
  start_node dist/src/worker.js "$ROOT/.dev-run/worker.log" 1

  port="${PORT:-3100}"
  ok=0
  for _ in $(seq 1 40); do
    if curl -fsS -m 3 -o /dev/null "http://localhost:${port}/health"; then ok=1; break; fi
    sleep 3
  done
  if [ "$ok" = 1 ]; then
    echo "API is up on :${port}"
  else
    echo "API did not answer on :${port}; see .dev-run/api.log" >&2
    exit 1
  fi
  echo "Worker log: .dev-run/worker.log"

  if [ "$WEB" = 1 ]; then
    step "Restarting the web dev server"
    stop_matching 'next.*dev'
    rm -rf apps/web/.next
    nohup pnpm dev:web > .dev-run/web.log 2>&1 < /dev/null &
    echo "Web dev server starting; log: .dev-run/web.log (http://localhost:3001)"
  fi
fi

step "Done"
