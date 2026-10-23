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
# DATABASE-DRIVEN as well: every DESK_WATCH_DB_POLL s (20) it reads the last 30 rows of platform_releases (read-only SELECT through
# `docker compose exec postgres psql`) and announces releasing / ok / failed, plus ONE message when a tag stays in `building` for
# BUILD_STUCK_MINUTES (20) (several stuck tags are grouped in one message). Deduped by tag+state in $STATE/seen/ (survives restarts).
# The process sniffing above stays as the fallback; both paths share the same dedupe keys. Heartbeat: $STATE/heartbeat every loop.
#   desk-release-watch.sh --selftest                        exit 1 if the heartbeat is older than 120 s (cron / monitoring check)
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
  --selftest)
    hb=$(cat "$STATE/heartbeat" 2>/dev/null); [ -n "$hb" ] && [ $(( $(date +%s) - hb )) -le 120 ] && { echo "ok"; exit 0; }
    echo "heartbeat missing or older than 120 s"; exit 1 ;;
  --test)
    post "🧪 *TEST* - Test message, not a real deployment. The production release watcher is connected to this space. Live release right now: \`$(live_tag || echo unknown)\`."
    echo "test sent, http $(cat "$STATE/last_http" 2>/dev/null)"; exit 0 ;;
  --dry-run)
    [ $# -ge 3 ] || { echo "usage: $0 --dry-run <prev_sha> <new_sha> [seconds] [started|live|unchanged]"; exit 2; }
    msg "${5:-live}" "$2" "$3" "${4:-}"; exit 0 ;;
esac

deploy_running() { pgrep -f "$DESK/ci-entry.sh" >/dev/null 2>&1; }
# One deploy calls ci-entry.sh several times (sync, load, release). Only the `release <sha>` call knows the NEW version, so a deploy is
# announced once, when that call starts, with the attempted sha read from its SSH_ORIGINAL_COMMAND. sync/load alone post nothing.
release_tag() {
  local pid t
  for pid in $(pgrep -f "$DESK/ci-entry.sh" 2>/dev/null); do
    t=$(tr '\0' '\n' < "${DESK_WATCH_PROC:-/proc}/$pid/environ" 2>/dev/null | sed -n 's/^SSH_ORIGINAL_COMMAND=release \([0-9a-fA-F]\{7,40\}\)\( [^ ]*\)\{0,3\}$/\1/p' | head -n1)
    [ -n "$t" ] && { printf '%s' "$t"; return 0; }
  done
  return 1
}
# ---- database-driven path -------------------------------------------------------------------------------------------------------
STUCK_MIN=${BUILD_STUCK_MINUTES:-20}; DB_POLL=${DESK_WATCH_DB_POLL:-20}; DB_FAIL_SECS=${DESK_WATCH_DB_FAIL_SECS:-600}
# read-only: one SELECT, sent on stdin; the password never appears (psql runs inside the container with its own env)
DB_SQL="SELECT attempt, tag, state, COALESCE(step,''), extract(epoch from started_at)::bigint, extract(epoch from updated_at)::bigint, extract(epoch from now())::bigint, replace(replace(COALESCE(error,''),E'\\n',' '),'|','/') FROM platform_releases ORDER BY updated_at DESC LIMIT 30;"
once() { [ -e "$STATE/seen/$1" ] && return 1; mkdir -p "$STATE/seen"; date +%s > "$STATE/seen/$1"; return 0; }  # once <tag7>.<state>
alert_selfcheck() { once "selfcheck.$1" && post "⚠️ *Deployment watcher cannot see releases* ($2)"; return 0; }
db_poll() {
  local now rows rc att tag st step started upd dbnow err good="" stuck="" nstuck=0 maxage=0 prev live t f age first=0
  now=$(date +%s); live=$(live_tag || true); prev=$(cat "$STATE/last_ok" 2>/dev/null)
  rows=$(cd "$DESK" 2>/dev/null && timeout 20 docker compose --env-file .env exec -T postgres psql -X -q -t -A -F '|' -U "$(env_get POSTGRES_USER)" -d "$(env_get POSTGRES_DB)" <<<"$DB_SQL" 2>"$STATE/psql.err"); rc=$?
  if [ $rc -ne 0 ]; then
    if grep -q 'does not exist' "$STATE/psql.err" 2>/dev/null; then
      [ -e "$STATE/db_missing" ] || { : > "$STATE/db_missing"; echo "$(date -u +%FT%TZ) platform_releases missing: process mode only" >> "$STATE/watch.log"; }
      return 0
    fi
    echo "$(date -u +%FT%TZ) psql failed rc=$rc" >> "$STATE/watch.log"
    [ -e "$STATE/db_okat" ] || echo "$now" > "$STATE/db_okat"
    [ $(( now - $(cat "$STATE/db_okat") )) -ge "$DB_FAIL_SECS" ] && alert_selfcheck read "cannot read platform_releases for $(( DB_FAIL_SECS / 60 )) min"
    return 0
  fi
  echo "$now" > "$STATE/db_okat"; rm -f "$STATE/seen/selfcheck.read" "$STATE/db_missing"
  [ -e "$STATE/seeded" ] || first=1   # first ever run: history is marked as seen (no replay), stuck builds are still announced
  while IFS='|' read -r att tag st step started upd dbnow err; do
    [ -n "$tag" ] && case "$st" in releasing|shipping|ok) good="$good ${tag:0:7}";; esac
  done <<<"$rows"
  while IFS='|' read -r att tag st step started upd dbnow err; do   # newest first -> tac below keeps chronological order
    [ -n "$tag" ] || continue
    local k=${tag:0:7}
    case "$st" in
      releasing) once "$k.releasing" && { [ $first = 1 ] || { post "$(msg started "$prev" "$tag")"; }; } ;;
      ok) once "$k.ok" && [ $first = 0 ] && {
            local dur=$(( upd - started )); [ -e "$STATE/seen/$k.releasing" ] && dur=$(( now - $(cat "$STATE/seen/$k.releasing") ))
            post "$(msg live "$prev" "$tag" "$dur")"; bridge_bg live "$prev" "$tag" "$dur"; echo "$k" > "$STATE/last_ok"; prev=$k; } ;;
      failed|rolled_back) once "$k.failed" && [ $first = 0 ] && {
            post "$(msg dbfailed "$prev" "$tag" 0 "❌ Release failed at step ${step:-unknown}: $(printf '%.200s' "$err")")"; bridge_bg unchanged "$live" "$tag" 0; } ;;
      building) age=$(( (dbnow - started) / 60 ))
            if [ $age -ge "$STUCK_MIN" ]; then case "$good $stuck" in *" $k"*) ;; *) [ -e "$STATE/seen/$k.stuck" ] || { stuck="$stuck $k"; nstuck=$((nstuck+1)); [ $age -gt $maxage ] && maxage=$age; }; esac; fi ;;
    esac
  done < <(printf '%s\n' "$rows" | tac)
  if [ $nstuck -gt 0 ]; then
    for t in $stuck; do once "$t.stuck"; done
    if [ $nstuck = 1 ]; then post "$(msg stuck "" "${stuck# }" "$maxage")"; else post "$(python3 "$FORMATTER" --group "${stuck# }" "$maxage" 2>>"$STATE/watch.log" || echo "⚠️ $nstuck builds are stuck")"; fi
    # one grouped message is the whole notice: no per-build incident (13 near-identical "Deploy failed" cards, no PRs known, were posted when this was per tag)
  fi
  : > "$STATE/seeded"
  # self-check 2: a release the process path announced as live has no row in platform_releases after 2 min -> the table is not being fed
  for f in "$STATE"/proc_live.*; do
    [ -e "$f" ] || continue; t=${f##*.}
    if grep -q "^[^|]*|$t" <<<"$rows"; then rm -f "$f"
    elif [ $(( now - $(cat "$f") )) -gt 120 ]; then alert_selfcheck "stale.$t" "newest row is older than the live release $t"; rm -f "$f"; fi
  done
  return 0
}
POLL=${DESK_WATCH_POLL:-10}; SETTLE=${DESK_WATCH_SETTLE:-20}
active=0; attempted=""; tag_before=$(live_tag || true); started=0
echo "$(date -u +%FT%TZ) watcher started, live tag ${tag_before:-unknown}" >> "$STATE/watch.log"
last_db=0; last_stall=0; STALL_POLL=${DESK_STALL_POLL:-300}; STALL_MIN=${DESK_STALL_MIN:-20}
# Merging to main does not deploy by itself (the build server must run the release). If main is ahead of the live tag for STALL_MIN minutes with no
# release event after the newest commit, post ONE warning per newest commit. Needs the read-only GitHub token; without it, silently nothing.
stall_check() {
  local live j newest
  live=$(live_tag) || return 0
  newest=$(ls -t "$STATE"/seen 2>/dev/null | head -n1); newest=$([ -n "$newest" ] && cat "$STATE/seen/$newest" 2>/dev/null || echo 0)
  j=$(python3 "$FORMATTER" --stall "$live" "$STALL_MIN" "${newest:-0}" 2>>"$STATE/watch.log") || return 0
  [ "$(printf '%s' "$j" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("post"))' 2>/dev/null)" = True ] || return 0
  local head text
  head=$(printf '%s' "$j" | python3 -c 'import json,sys; print(json.load(sys.stdin)["head"][:7])') && text=$(printf '%s' "$j" | python3 -c 'import json,sys; print(json.load(sys.stdin)["text"])') || return 0
  once "stall-$head" && post "$text"
  return 0
}
while true; do
  date +%s > "$STATE/heartbeat"
  if [ $(( $(date +%s) - last_db )) -ge "$DB_POLL" ]; then last_db=$(date +%s); db_poll; fi
  if [ "$active" = 0 ] && ! deploy_running && [ $(( $(date +%s) - last_stall )) -ge "$STALL_POLL" ]; then last_stall=$(date +%s); stall_check; fi
  if deploy_running; then
    rt=$(release_tag || true)
    if [ -n "$rt" ] && [ "$active" = 0 ]; then
      active=1; attempted=$rt; started=$(date +%s); tag_before=$(live_tag || true)
      once "${attempted:0:7}.releasing" && post "$(msg started "$tag_before" "$attempted")"
    fi
  elif [ "$active" = 1 ]; then
    sleep "$SETTLE"   # let the slot switch and .env settle
    active=0; now=$(live_tag || true); dur=$(( $(date +%s) - started ))
    if [ -n "$now" ] && [ "${now:0:7}" = "${attempted:0:7}" ]; then
      if once "${now:0:7}.ok"; then
        post "$(msg live "$tag_before" "$now" "$dur")"
        bridge_bg live "$tag_before" "$now" "$dur"; echo "${now:0:7}" > "$STATE/last_ok"
      fi
      date +%s > "$STATE/proc_live.${now:0:7}"
    elif once "${attempted:0:7}.failed"; then
      post "$(msg unchanged "$now" "$attempted" "$dur" "It was rolled back or refused. Check the build server log.")"
      bridge_bg unchanged "$now" "$attempted" "$dur"
    fi
  fi
  sleep "$POLL"
done
