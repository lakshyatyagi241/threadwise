#!/usr/bin/env bash
# Bring up (or just report on) the two apps a parity run needs.
#
#   env.sh status          what is running where, one line per piece
#   env.sh up [--no-web]   start what is missing, then print `export` lines (eval them: eval "$(env.sh env)")
#   env.sh env             print the export lines for what is up now
#   env.sh down            stop ONLY what this script started (pidfiles below); never touches foreign processes
#
# Reference (reference):  delegated to the threadwise-run-reference skill (Laravel dev server, :8000).
# Our API:             `pnpm --filter @crm/api dev` of THIS checkout on a free port (never reuses another clone's server,
#                      it may run different code). Needs the infra containers; `pnpm infra:up` is run when they are down.
# Our web app:         apps/web does not exist yet, so no UI is started and UI scenarios report "missing". Once
#                      apps/web/package.json has a dev script it is started on a free port; override with PARITY_WEB_CMD
#                      (a shell command that serves the app on $PORT).
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../../.." && pwd)"
state="${TMPDIR:-/tmp}/threadwise-parity-$(id -un)/env"
mkdir -p "$state"
THREADWISE_PORT="${THREADWISE_PORT:-8000}"

say() { echo "env: $*"; }
free_port() { python3 - "$1" <<'PY'
import socket, sys
p = int(sys.argv[1])
while True:
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", p)); s.close(); print(p); break
    except OSError:
        p += 1
PY
}
http_code() { curl -s -o /dev/null -m 4 -w '%{http_code}' "$1" 2>/dev/null || echo 000; }
alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
port_of() { [ -f "$state/$1.port" ] && cat "$state/$1.port"; }

api_url() { local p; p="$(port_of api)"; [ -n "$p" ] && alive "$state/api.pid" && echo "http://localhost:$p"; }
web_url() { local p; p="$(port_of web)"; [ -n "$p" ] && alive "$state/web.pid" && echo "http://localhost:$p"; }

web_exists() { [ -n "${PARITY_WEB_CMD:-}" ] || { [ -f "$repo/apps/web/package.json" ] && grep -q '"dev"' "$repo/apps/web/package.json"; }; }

status() {
  local c; c="$(http_code "http://127.0.0.1:$THREADWISE_PORT/")"
  case "$c" in 200|301|302) say "threadwise   up   http://127.0.0.1:$THREADWISE_PORT";; *) say "threadwise   DOWN (GET / -> $c)  start: bash .claude/skills/threadwise-run-reference/scripts/start.sh";; esac
  local a; a="$(api_url)"
  if [ -n "$a" ] && [ "$(http_code "$a/health")" = 200 ]; then say "ours-api up   $a  (started by env.sh, log $state/api.log)"
  else say "ours-api DOWN  start: bash .claude/skills/threadwise-playwright-parity/scripts/env.sh up"; fi
  if web_exists; then
    local w; w="$(web_url)"
    if [ -n "$w" ] && [ "$(http_code "$w/")" != 000 ]; then say "ours-web up   $w"; else say "ours-web DOWN  (apps/web exists; env.sh up starts it)"; fi
  else say "ours-web none  apps/web has no package.json yet: UI scenarios will report 'missing UI'"; fi
  for d in postgres redis; do
    local h; h="$(docker inspect -f '{{.State.Health.Status}}' "crm-$d" 2>/dev/null || echo absent)"
    say "infra   crm-$d $h"
  done
}

print_env() {
  local a w; a="$(api_url)"; w="$(web_url)"
  echo "export THREADWISE_URL=http://127.0.0.1:$THREADWISE_PORT"
  [ -n "$a" ] && echo "export PARITY_API_URL=$a"
  [ -n "$w" ] && echo "export PARITY_WEB_URL=$w"
  return 0
}

up_threadwise() {
  local c; c="$(http_code "http://127.0.0.1:$THREADWISE_PORT/")"
  case "$c" in 200|301|302) return 0;; esac
  bash "$repo/.claude/skills/threadwise-run-reference/scripts/start.sh" || { say "Reference did not start (see the message above; the threadwise-run-reference skill has the first-time setup)"; return 1; }
}

up_infra() {
  for d in postgres redis; do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "crm-$d" 2>/dev/null || echo absent)" = healthy ] && continue
    say "infra containers are not healthy: running pnpm infra:up"
    ( cd "$repo" && pnpm infra:up >"$state/infra.log" 2>&1 ) || { say "pnpm infra:up failed, see $state/infra.log (first time here? run the setup skill)"; return 1; }
    for _ in $(seq 1 40); do
      [ "$(docker inspect -f '{{.State.Health.Status}}' crm-platform-postgres 2>/dev/null)" = healthy ] && [ "$(docker inspect -f '{{.State.Health.Status}}' crm-platform-redis 2>/dev/null)" = healthy ] && return 0
      sleep 2
    done
    say "infra did not become healthy in 80 s"; return 1
  done
}

up_api() {
  local a; a="$(api_url)"
  [ -n "$a" ] && [ "$(http_code "$a/health")" = 200 ] && return 0
  [ -d "$repo/apps/api/node_modules" ] || { say "dependencies missing: run bash .claude/skills/setup/scripts/setup.sh first"; return 1; }
  local port wport; port="$(free_port 3300)"; wport="$(port_of web)"
  say "starting our API on :$port (this checkout; first compile takes about 30 s)"
  # `nest start` rewrites a tracked build artifact; remember whether it was clean so `down` can put it back
  if ( cd "$repo" && git diff --quiet -- apps/api/tsconfig.build.tsbuildinfo 2>/dev/null ); then : >"$state/tsbuildinfo.clean"; else rm -f "$state/tsbuildinfo.clean"; fi
  # NB: cd happens in the foreground of the subshell; only the server itself is backgrounded, with every fd redirected, so
  # a caller reading our stdout (a pipe) never waits on the server.
  ( cd "$repo" || exit 1
    PORT="$port" CORS_ORIGINS="http://localhost:${wport:-3400},http://localhost:3001" APP_URL="http://localhost:$port" \
      setsid nohup pnpm --filter @crm/api dev >"$state/api.log" 2>&1 </dev/null &
    echo $! >"$state/api.pid" )
  echo "$port" >"$state/api.port"
  for _ in $(seq 1 90); do
    [ "$(http_code "http://localhost:$port/health")" = 200 ] && { say "our API is up on :$port"; return 0; }
    alive "$state/api.pid" || break
    sleep 1
  done
  tail -15 "$state/api.log" >&2
  say "our API did not come up (log: $state/api.log). Usual cause: stale .env, migrations or seed missing: run the setup skill"
  return 1
}

up_web() {
  web_exists || return 0
  local w; w="$(web_url)"
  [ -n "$w" ] && [ "$(http_code "$w/")" != 000 ] && return 0
  local port api; port="$(free_port 3400)"; api="$(api_url)"
  say "starting our web app on :$port"
  local cmd="${PARITY_WEB_CMD:-pnpm --filter ./apps/web dev}"
  ( cd "$repo" || exit 1
    PORT="$port" NEXT_PUBLIC_API_URL="$api" NEXT_PUBLIC_API_BASE_URL="$api" API_URL="$api" \
      setsid nohup bash -c "$cmd" >"$state/web.log" 2>&1 </dev/null &
    echo $! >"$state/web.pid" )
  echo "$port" >"$state/web.port"
  for _ in $(seq 1 120); do
    local c; c="$(http_code "http://localhost:$port/")"
    case "$c" in 000) ;; *) say "our web app is up on :$port"; return 0;; esac
    alive "$state/web.pid" || break
    sleep 1
  done
  tail -15 "$state/web.log" >&2
  say "our web app did not come up (log: $state/web.log)"; return 1
}

down() {
  for k in web api; do
    if alive "$state/$k.pid"; then
      local pid; pid="$(cat "$state/$k.pid")"
      pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null
      # the dev server's own children (nest/next) outlive the wrapper: stop whatever still listens on our port
      local port; port="$(port_of $k)"
      # ...but only processes that run from THIS checkout, never a foreign server that happens to hold the port
      [ -n "$port" ] && for p in $(ss -ltnpH "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p'); do
        case "$(readlink "/proc/$p/cwd" 2>/dev/null)" in "$repo"|"$repo"/*) kill -TERM "$p" 2>/dev/null;; esac
      done
      say "stopped $k"
    fi
    rm -f "$state/$k.pid" "$state/$k.port"
  done
  if [ -f "$state/tsbuildinfo.clean" ] && ! ( cd "$repo" && git diff --quiet -- apps/api/tsconfig.build.tsbuildinfo 2>/dev/null ); then
    ( cd "$repo" && git checkout -- apps/api/tsconfig.build.tsbuildinfo ) && say "restored apps/api/tsconfig.build.tsbuildinfo (a build artifact the API dev server rewrites)"
  fi
  rm -f "$state/tsbuildinfo.clean"
  say "Reference and the infra containers are left running on purpose (stop Reference with threadwise-run-reference/scripts/stop.sh)"
}

case "${1:-status}" in
  status) status ;;
  env) print_env ;;
  down) down ;;
  up)
    rc=0
    up_threadwise || rc=1
    up_infra || rc=1
    [ "$rc" = 0 ] && { up_api || rc=1; }
    [ "${2:-}" != "--no-web" ] && [ "$rc" = 0 ] && { up_web || rc=1; }
    status
    echo "# eval these:"; print_env
    exit $rc ;;
  *) echo "usage: env.sh status | up [--no-web] | env | down" >&2; exit 2 ;;
esac
