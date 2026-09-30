#!/usr/bin/env bash
# Start the WaDesk reference app on http://127.0.0.1:${WADESK_PORT:-8000} (background, survives the shell).
# Read-only behavior reference: never edit files under WADESK_REF.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"

fail() { echo "wadesk-run-reference: $*" >&2; exit 1; }

[ -f "$REF/artisan" ] || fail "no Laravel app at $REF (set WADESK_REF to the folder that contains artisan)"
command -v php >/dev/null || fail "php not found. WaDesk needs PHP >= 8.2 with mysql, mbstring, xml, curl, zip, bcmath, gd, intl, redis (see SKILL.md, first-time setup)"
php -r 'exit(version_compare(PHP_VERSION,"8.2.0",">=")?0:1);' || fail "PHP $(php -r 'echo PHP_VERSION;') is too old, need >= 8.2"
[ -f "$REF/.env" ] || fail "$REF/.env missing (see SKILL.md, first-time setup)"
[ -f "$REF/storage/installed" ] || fail "storage/installed missing: the web installer would take over. See SKILL.md, first-time setup"

if listening; then
  if is_laravel_dev_server "$(listener_pid)"; then echo "already running: http://127.0.0.1:$PORT"; exit 0; fi
  fail "port $PORT is busy with something that is not a Laravel dev server; set WADESK_PORT to another port"
fi

( cd "$REF" && php artisan migrate:status >/dev/null 2>&1 ) || fail "database not reachable or not migrated (check DB_* in $REF/.env; see SKILL.md, first-time setup)"

( cd "$REF" && setsid nohup php artisan serve --host=127.0.0.1 --port="$PORT" >"$LOGFILE" 2>&1 & )

for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
  case "$code" in 200|301|302) echo "up: http://127.0.0.1:$PORT  (admin login test@example.com / password)"; exit 0;; esac
  sleep 0.5
done
tail -20 "$LOGFILE" >&2
fail "server did not answer on port $PORT within 20s (log: $LOGFILE)"
