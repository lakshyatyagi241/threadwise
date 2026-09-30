#!/usr/bin/env bash
# Stop the Reference reference app (Laravel dev server) listening on THREADWISE_PORT.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"
pid="$(listener_pid)"
[ -n "$pid" ] || { echo "not running (port $PORT free)"; exit 0; }
is_laravel_dev_server "$pid" || { echo "port $PORT is held by pid $pid which is not a Laravel dev server; refusing to kill it" >&2; exit 1; }
pgid="$(ps -o pgid= -p "$pid" | tr -d ' ')"
kill -- "-$pgid" 2>/dev/null || kill "$pid" 2>/dev/null || true
for _ in $(seq 1 20); do listening || { echo "stopped (port $PORT free)"; exit 0; }; sleep 0.25; done
echo "port $PORT still busy after kill" >&2; exit 1
