#!/usr/bin/env bash
# Read-only health check of the alerting stack. Run ON THE HOST by the owner or from cron (docs/runbooks/stack-health-24h.md).
#   stack-selfcheck.sh [--notify]     one OK/FAIL line per check, exit 1 on any FAIL.
# --notify: also posts ONE message to the Critical Google Chat space (webhook in /opt/desk/secrets/gchat_critical_url) for the checks
# that fail, and re-posts the same failing check at most once per hour. The URL is never printed or put in a process argument list.
# Env (for tests): STATE_DIR, CRITICAL_URL_FILE, HEARTBEAT_FILE, MIN_DISK_FREE_PCT, NOW.
set -uo pipefail
NOTIFY=0; [ "${1:-}" = "--notify" ] && NOTIFY=1
STATE_DIR="${STATE_DIR:-/var/tmp/stack-selfcheck}"
URL_FILE="${CRITICAL_URL_FILE:-/opt/desk/secrets/gchat_critical_url}"
HEARTBEAT_FILE="${HEARTBEAT_FILE:-/var/lib/desk-release-watch/heartbeat}"
MIN_FREE="${MIN_DISK_FREE_PCT:-15}"
NOW="${NOW:-$(date +%s)}"
FAILS=()
res() { # name status detail
  if [ "$2" = OK ]; then printf 'OK   %s %s\n' "$1" "$3"; else printf 'FAIL %s %s\n' "$1" "$3"; FAILS+=("$1"); fi; }

PS="$(docker ps --format '{{.Names}} {{.Status}}' 2>/dev/null || true)"
name_of() { printf '%s\n' "$PS" | awk -v n="$1" 'index($1,n){print $1; exit}'; }
for svc in grafana prometheus alertmanager gchat-bridge probe; do
  line="$(printf '%s\n' "$PS" | awk -v n="$svc" 'index($1,n){print; exit}')"
  case "$line" in
    "") res "container-$svc" FAIL "not running" ;;
    *unhealthy*|*"health: starting"*) res "container-$svc" FAIL "not healthy: ${line#* }" ;;
    *" Up"*) res "container-$svc" OK "" ;;
    *) res "container-$svc" FAIL "not up: ${line#* }" ;;
  esac
done

if [ "$(systemctl is-active desk-release-watch 2>/dev/null || true)" = active ]; then res release-watch OK ""; else res release-watch FAIL "desk-release-watch not active"; fi
if [ -e "$HEARTBEAT_FILE" ]; then
  age=$((NOW - $(stat -c %Y "$HEARTBEAT_FILE")))
  if [ "$age" -lt 120 ]; then res release-watch-heartbeat OK "${age}s old"; else res release-watch-heartbeat FAIL "${age}s old (limit 120)"; fi
fi

BR="$(name_of gchat-bridge)"; PM="$(name_of prometheus)"
if [ -n "$BR" ] && docker exec "$BR" node -e 'fetch("http://127.0.0.1:9095/health").then(r=>r.text()).then(console.log)' 2>/dev/null | grep -q '"ok":true'; then
  res bridge-health OK ""; else res bridge-health FAIL "bridge /health not ok"; fi
promq() { docker exec "$PM" wget -qO- "http://localhost:9090/api/v1/query?query=$1" 2>/dev/null; }
if [ -n "$PM" ] && promq 'up%7Bjob%3D%22crm-chat-bridge%22%7D' | grep -q '"value":\[[^]]*,"1"\]'; then
  res prometheus-target-bridge OK ""; else res prometheus-target-bridge FAIL "target crm-chat-bridge not up"; fi
wd=""; [ -n "$PM" ] && wd="$(promq 'time()-crm_chat_bridge_last_watchdog_timestamp_seconds' | sed -n 's/.*"value":\[[^,]*,"\([0-9.]*\)"\].*/\1/p')"
if [ -n "$wd" ] && [ "${wd%.*}" -lt 900 ]; then res watchdog OK "${wd%.*}s ago"; else res watchdog FAIL "last Watchdog ${wd:-unknown}s ago (limit 900)"; fi
used="$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')"
if [ -n "$used" ] && [ $((100 - used)) -gt "$MIN_FREE" ]; then res disk OK "$((100 - used))% free"; else res disk FAIL "${used:-?}% used (need > ${MIN_FREE}% free)"; fi

if [ "$NOTIFY" = 1 ]; then
  mkdir -p "$STATE_DIR"
  due=()
  for f in "$STATE_DIR"/*.last; do [ -e "$f" ] || continue; n="$(basename "$f" .last)"; case " ${FAILS[*]:-} " in *" $n "*) ;; *) rm -f "$f" ;; esac; done
  for n in "${FAILS[@]:-}"; do
    [ -n "$n" ] || continue
    last=0; [ -f "$STATE_DIR/$n.last" ] && last="$(cat "$STATE_DIR/$n.last")"
    [ $((NOW - last)) -ge 3600 ] && due+=("$n")
  done
  if [ "${#due[@]}" -gt 0 ] && [ -s "$URL_FILE" ]; then
    msg="Stack self-check FAILED on $(hostname): ${due[*]}. See docs/runbooks/stack-health-24h.md"
    if printf 'url = "%s"\n' "$(tr -d '\r\n' < "$URL_FILE")" | curl -K - --max-time 8 -s -o /dev/null -f -X POST -H 'Content-Type: application/json' -d "{\"text\":\"$msg\"}"; then
      for n in "${due[@]}"; do printf '%s' "$NOW" > "$STATE_DIR/$n.last"; done
      echo "notified: ${due[*]}"
    else echo "notify failed (will retry next run)"; fi
  fi
fi
[ "${#FAILS[@]}" -eq 0 ]
