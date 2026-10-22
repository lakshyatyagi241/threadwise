#!/usr/bin/env bash
# Posts deployment notices to the Google Chat "Deployments" space from the production host itself.
# Watches /opt/desk/ci-entry.sh (the forced command every release runs through) and the live slot's image tag.
#   deploy running            -> "Deploy in progress"        (once; version shipped = IMAGE_TAG in .env)
#   deploy ended, tag changed -> "Release live"
#   deploy ended, same tag    -> "Deploy finished but the live version did not change"
# Every message shows PR number(s), commit, author and who deployed (built by deploy-message.py from the GitHub API; falls back to
# "PR details unavailable"). After the Deployments post it tells the bridge (docker exec, background): release -> POST /release {sha,prs,at};
# unchanged -> POST /incidents (deploy_failure). Never touches the release, never takes its lock, never fails it. Secrets are never logged.
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

env_get() { grep "^$1=" "$DESK/.env" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d "\"'[:space:]"; }
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

# Tell the bridge (internal port, not published) about the release / the failed deploy so incidents can resolve or open. Runs in the background
# AFTER the Deployments post, so it can never block or delay it. The token is read INSIDE the container; failures log only the path and exit code.
BRIDGE_JS='const fs=require("fs");let b="";process.stdin.on("data",d=>b+=d).on("end",async()=>{let t="";try{t=fs.readFileSync("/run/secrets/incident_api_token","utf8").trim()}catch{}try{const r=await fetch("http://127.0.0.1:"+(process.env.PORT||9095)+process.argv[1],{method:"POST",headers:{"x-incident-token":t,"content-type":"application/json"},body:b,signal:AbortSignal.timeout(10000)});console.log("bridge "+process.argv[1]+" http "+r.status);process.exit(r.ok?0:1)}catch(e){console.log("bridge "+process.argv[1]+" failed "+(e.cause&&e.cause.code||e.code||"error"));process.exit(1)}})'
bridge_call() { # bridge_call <path> <json>
  printf '%s' "$2" | timeout 25 docker exec -i "${DESK_BRIDGE_CONTAINER:-desk-gchat-bridge}" node -e "$BRIDGE_JS" "$1" >> "$STATE/watch.log" 2>&1 \
    || echo "$(date -u +%FT%TZ) bridge call $1 failed" >> "$STATE/watch.log"
}
notify_bridge() { # notify_bridge live|unchanged <prev> <new> <secs>
  local j body
  j=$(python3 "$FORMATTER" --json "$1" "$2" "$3" "$4" 2>>"$STATE/watch.log") || { echo "$(date -u +%FT%TZ) bridge json failed" >> "$STATE/watch.log"; return 0; }
  if [ "$1" = live ]; then
    body=$(python3 -c 'import json,sys,time; j=json.loads(sys.argv[1]); print(json.dumps({"sha":j["sha"],"prs":j["prs"],"at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())}))' "$j") && bridge_call /release "$body"
  else # deploy ended without changing the live version: open a deploy_failure incident (the bridge dedupes on the attempted sha)
    body=$(python3 -c 'import json,sys; j=json.loads(sys.argv[1]); print(json.dumps({"kind":"deploy_failure","attemptedSha":j["sha"],"liveSha":j["prev"],"prs":j["prs"],"mergers":j["mergers"],"durationSeconds":j["seconds"]}))' "$j") && bridge_call /incidents "$body"
  fi
  return 0
}
bridge_bg() { ( notify_bridge "$@" ) >/dev/null 2>&1 & }

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
      bridge_bg live "$tag_before" "$now" "$dur"
    else
      post "$(msg unchanged "$now" "$(env_get IMAGE_TAG)" "$dur" "It was rolled back or refused. Check the build server log.")"
      bridge_bg unchanged "$now" "$(env_get IMAGE_TAG)" "$dur"
    fi
  fi
  sleep "$POLL"
done
