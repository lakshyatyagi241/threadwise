#!/usr/bin/env bash
# Posts deployment notices to the Google Chat "Deployments" space from the production host itself.
# Watches /opt/desk/ci-entry.sh (the forced command every release runs through) and the live slot's image tag.
#   deploy running            -> "Deploy in progress"        (once; version shipped = IMAGE_TAG in .env)
#   deploy ended, tag changed -> "Release live"
#   deploy ended, same tag    -> "Deploy finished but the live version did not change"
# Every message shows PR number(s), commit, author and who deployed (built by deploy-message.py from the GitHub API; falls back to
# "PR details unavailable"). Never touches the release, never takes its lock, never fails it. Secrets are never logged.
#   desk-release-watch.sh                                   loop forever (systemd service)
#   desk-release-watch.sh --test                            post one clearly labelled TEST card (text only)
#   desk-release-watch.sh --dry-run <prev> <new> [secs] [event]   print the message that WOULD be posted; posts nothing
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STATE=${DESK_WATCH_STATE:-/var/lib/desk-release-watch}; export DESK_WATCH_STATE=$STATE
URLF="${DESK_WATCH_URL_FILE:-/opt/desk/secrets/gchat_deploy_url}"
DESK=${DESK_DIR:-/opt/desk}
FORMATTER=${DESK_WATCH_FORMATTER:-$HERE/deploy-message.py}
mkdir -p "$STATE" 2>/dev/null

env_get() { grep "^$1=" "$DESK/.env" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '"'"'"'[:space:]'; }
live_tag() {
  local slot; slot=$(tr -d '[:space:]' < "$DESK/.slot" 2>/dev/null)
  [ -n "$slot" ] || return 1
  env_get "SLOT_$(printf '%s' "$slot" | tr a-z A-Z)_TAG"
}
msg() { python3 "$FORMATTER" "$@" 2>>"$STATE/watch.log" || echo "Release $1 ${3:-unknown} (PR details unavailable)"; }

post() { # post <text>
  [ -s "$URLF" ] || { echo "$(date -u +%FT%TZ) no webhook file" >> "$STATE/watch.log"; return 0; }
  local body; body=$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$1") || return 0
  # -K - keeps the URL out of the process list; errors are swallowed and logged without the URL
  printf 'url = "%s"\n' "$(cat "$URLF")" | curl -s -m 8 -o /dev/null -w '%{http_code}' -K - -H 'Content-Type: application/json' -d "$body" > "$STATE/last_http" 2>/dev/null \
    || echo "$(date -u +%FT%TZ) post failed" >> "$STATE/watch.log"
  return 0
}

case "${1:-}" in
  --test)
    post "🧪 *TEST* - Test message, not a real deployment. The production release watcher is connected to this space. Live release right now: \`$(live_tag || echo unknown)\`."
    echo "test sent, http $(cat "$STATE/last_http" 2>/dev/null)"; exit 0 ;;
  --dry-run)
    [ $# -ge 3 ] || { echo "usage: $0 --dry-run <prev_sha> <new_sha> [seconds] [started|live|unchanged]"; exit 2; }
    msg "${5:-live}" "$2" "$3" "${4:-}"; exit 0 ;;
esac

deploy_running() { pgrep -f "$DESK/ci-entry.sh" >/dev/null 2>&1; }
POLL=${DESK_WATCH_POLL:-10}; SETTLE=${DESK_WATCH_SETTLE:-20}
prev_running=0; tag_before=$(live_tag || true); started=0
echo "$(date -u +%FT%TZ) watcher started, live tag ${tag_before:-unknown}" >> "$STATE/watch.log"
while true; do
  if deploy_running; then
    if [ "$prev_running" = 0 ]; then
      prev_running=1; started=$(date +%s); tag_before=$(live_tag || true)
      post "$(msg started "$tag_before" "$(env_get IMAGE_TAG)")"
    fi
  elif [ "$prev_running" = 1 ]; then
    sleep "$SETTLE"   # let the slot switch and .env settle
    prev_running=0; now=$(live_tag || true); dur=$(( $(date +%s) - started ))
    if [ -n "$now" ] && [ "$now" != "$tag_before" ]; then
      post "$(msg live "$tag_before" "$now" "$dur")"
    else
      post "$(msg unchanged "$now" "$(env_get IMAGE_TAG)" "$dur" "It was rolled back or refused. Check the build server log.")"
    fi
  fi
  sleep "$POLL"
done
