#!/usr/bin/env bash
# Forced command for the CI deploy key (authorized_keys: restrict,command="/opt/desk/ci-entry.sh" ssh-ed25519 ...).
# The key can do exactly three things, chosen by the command the client sends; nothing else is reachable with it.
#   load             docker image tarball (gzip) on stdin -> docker load
#   sync             tar on stdin with the deploy files -> /opt/desk (only the allow-listed names are extracted)
#   release <tag> [attempt]  blue-green: start the IDLE slot (api + web) on <tag>, wait until healthy, move traffic to it, then restart
#                    the worker on <tag> and stop the old slot. Migrations run first (they must be expand-only, see the build server's
#                    migration lint). Any failure moves traffic back to the live slot and leaves it running. Every step and the outcome
#                    are recorded in platform_releases (the operator console's release history) under <attempt> (a uuid; made here when
#                    the caller gives none). Recording never blocks a release.
#   event <attempt> <tag> <state> [step]   records a build-side step (building, shipping, releasing, failed) with the error text on stdin.
set -euo pipefail
DESK_DIR=${DESK_DIR:-/opt/desk}   # overridable only so tests/ci-entry.test.sh can run against a scratch directory
TRAEFIK_DYN=${TRAEFIK_DYN:-/etc/dokploy/traefik/dynamic/desk.yml}   # Traefik watches this directory: rewriting the file moves traffic
BG_MIN_MEM_MB=${BLUE_GREEN_MIN_MEM_MB:-1000}   # room for one extra api (~350 MB used, 1 GB cap) and one extra web (~400 MB used, 768 MB cap)
MIN_DISK_MB=${DESK_MIN_DISK_MB:-3000}           # room to load two new images and keep the previous release
LOCK_FILE=${DESK_LOCK_FILE:-/var/lock/desk-release.lock}
cd "$DESK_DIR"
read -r -a words <<<"${SSH_ORIGINAL_COMMAND:-}" || true
action=${words[0]:-}; arg=${words[1]:-}
attempt=""; step=""; outcome=""

envget() { grep "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
envset() { sed -i "/^$1=/d" .env; echo "$1=$2" >> .env; }
compose() { docker compose --env-file .env "$@"; }

# Writes one step of a release to platform_releases (the operator console reads it). Never fails the caller: the table may not exist
# yet (its migration runs as part of the release that writes to it), and a lost row only costs a line in the console. The values go to
# psql as variables, never into the SQL text; control characters are dropped and the message is cut to 500 characters.
record() {  # record <attempt> <tag> <state> <step> [error]
  local attempt=$1 tag=$2 state=$3 step=$4 err=${5:-}
  err=$(printf '%s' "$err" | LC_ALL=C tr -d '\000-\037\177' | head -c 500)
  compose exec -T postgres sh -c 'exec psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v attempt="$1" -v tag="$2" -v state="$3" -v step="$4" -v err="$5" -f -' \
    sh "$attempt" "$tag" "$state" "$step" "$err" >/dev/null 2>&1 <<'SQL' || true
INSERT INTO platform_releases (attempt, tag, state, step, error, started_at, updated_at, finished_at)
VALUES (:'attempt', :'tag', :'state', NULLIF(:'step', ''), NULLIF(:'err', ''), now(), now(),
        CASE WHEN :'state' IN ('ok', 'failed', 'rolled_back') THEN now() END)
ON CONFLICT (attempt) DO UPDATE SET
  state = EXCLUDED.state,
  step = COALESCE(EXCLUDED.step, platform_releases.step),
  error = COALESCE(EXCLUDED.error, platform_releases.error),
  updated_at = now(),
  finished_at = COALESCE(EXCLUDED.finished_at, platform_releases.finished_at);
SQL
}

# Ends a release with a recorded outcome, says why, and stops. Used for every failure the script expects; anything else is recorded
# as failed by finish() when the script exits.
die() {  # die <state> <message>
  outcome=$1
  record "$attempt" "$arg" "$1" "$step" "$2"
  echo "$2" >&2
  exit 1
}

# Runs on every exit of a release. A release that stops without a recorded outcome (an unexpected error) is recorded as failed.
finish() {
  local rc=$?
  if [ -n "$attempt" ] && [ -z "$outcome" ] && [ "$rc" -ne 0 ]; then
    record "$attempt" "$arg" failed "$step" "stopped during ${step:-start} (exit $rc)"
  fi
}

# Waits until a container's healthcheck says healthy. Gives up after $2 polls (5 s apart).
wait_healthy() {
  local c=$1 n=$2 state
  for _ in $(seq 1 "$n"); do
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c" 2>/dev/null || echo missing)
    [ "$state" = healthy ] && return 0
    sleep 5
  done
  return 1
}

# The worker serves no HTTP, so "up" for it means its healthcheck (a recent heartbeat in Redis) says healthy.
worker_ready() {
  local id state
  for _ in $(seq 1 36); do
    id=$(compose ps -q worker 2>/dev/null | head -1)
    [ -n "$id" ] || { sleep 5; continue; }
    state=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo unknown)
    case "$state" in healthy | none) return 0 ;; esac
    sleep 5
  done
  return 1
}

# Points the public routes at one slot (deploy/hostinger/traefik-desk.yml.template). Written to a temp file and renamed, so Traefik
# never reads half a file.
route_to() {
  local slot=$1 tmp
  mkdir -p "$(dirname "$TRAEFIK_DYN")"
  tmp=$(mktemp "$(dirname "$TRAEFIK_DYN")/.desk.XXXXXX")
  sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__SLOT__/$slot/g" "$DESK_DIR/traefik-desk.yml.template" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$TRAEFIK_DYN"
}

# Puts traffic back on the live slot. For the very first release there is no slot yet: the old labelled containers still serve, so
# removing the routing file is enough for Traefik to fall back to them.
route_back() {
  if [ "$1" = legacy ]; then rm -f "$TRAEFIK_DYN"; else route_to "$1"; fi
}

# Checks the public address through Traefik, the way a user reaches it. Five rounds in a row, 2 s apart.
public_ok() {
  local i
  for i in 1 2 3 4 5; do
    curl -fsSk -o /dev/null --max-time 10 "https://$DOMAIN/ready" || return 1
    curl -fsSk -o /dev/null --max-time 10 "https://$DOMAIN/login" || return 1
    sleep 2
  done
  return 0
}

# Which slot serves traffic. .slot is the record, the routing file is the truth Traefik acts on: if they disagree (a release died
# between the two writes, or .slot was lost), believe the routing file. No routing file and no record means the old labelled containers.
live_slot() {
  local rec routed
  rec=$(cat .slot 2>/dev/null || true)
  routed=$(grep -o 'desk-api-[a-z]*:3000' "$TRAEFIK_DYN" 2>/dev/null | head -1 | sed -e 's/^desk-api-//' -e 's/:3000$//' || true)
  case "$routed" in blue | green) echo "$routed"; return ;; esac
  case "$rec" in blue | green) [ -f "$TRAEFIK_DYN" ] && { echo "$rec"; return; } ;; esac
  echo legacy
}

stop_slot() { # stop_slot <slot>: stop the api and web containers of one slot, keeping their images for a rollback
  compose stop -t 30 "api-$1" "web-$1" >/dev/null 2>&1 || true
}

case "$action" in
  load)
    nice -n 10 sh -c 'gunzip | docker load'
    ;;
  sync)
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    tar -x -C "$tmp"
    # ci-entry.sh is deliberately NOT in this list: it is the forced command of this very key, so letting the key rewrite it would hand
    # root to whoever holds the key. It is installed by an administrator (ship.sh does it with their own login).
    for f in docker-compose.yml init-roles.sh seed.js set-secrets.sh .env.example traefik-desk.yml.template; do
      [ -f "$tmp/$f" ] && install -m "$([ "${f##*.}" = sh ] && echo 755 || echo 644)" "$tmp/$f" "$DESK_DIR/$f"
    done
    echo "synced"
    ;;
  event)
    # A build-side step. The state set is fixed, the tag and attempt are checked, and the message comes on stdin.
    eattempt=${words[1]:-}; etag=${words[2]:-}; estate=${words[3]:-}; estep=${words[4]:-}
    [[ "$eattempt" =~ ^[0-9a-f-]{36}$ && "$etag" =~ ^[a-f0-9]{7,40}$ && "$estate" =~ ^(building|shipping|releasing|failed)$ \
      && "$estep" =~ ^[a-z_]{0,40}$ ]] || { echo "bad event" >&2; exit 2; }
    eerr=$(head -c 1000 || true)
    record "$eattempt" "$etag" "$estate" "$estep" "$eerr"
    echo "recorded"
    ;;
  release)
    [[ "$arg" =~ ^[a-f0-9]{7,40}$ ]] || { echo "bad tag" >&2; exit 2; }
    attempt=${words[2]:-$(cat /proc/sys/kernel/random/uuid)}
    [[ "$attempt" =~ ^[0-9a-f-]{36}$ ]] || { echo "bad attempt id" >&2; exit 2; }
    trap finish EXIT
    step=lock
    # One release at a time on this host, whoever started it (CI webhook, ship.sh, a person).
    mkdir -p "$(dirname "$LOCK_FILE")"
    exec 9>"$LOCK_FILE"
    flock -n 9 || die failed "another release is running on this host; nothing was changed"
    if ! docker image inspect "desk-api:$arg" "desk-web:$arg" >/dev/null 2>&1; then
      die failed "the images for $arg are not loaded; nothing was changed"
    fi
    DOMAIN=$(envget DOMAIN)
    [ -n "$DOMAIN" ] || die failed "DOMAIN is not set in .env; nothing was changed"
    prev=$(envget IMAGE_TAG)
    active=$(live_slot)
    case "$active" in blue) idle=green ;; *) idle=blue ;; esac
    idle_upper=$(echo "$idle" | tr '[:lower:]' '[:upper:]')
    step=start
    record "$attempt" "$arg" releasing start

    # Traefik must be watching the directory the routing file goes in, or the switch would be written and never read.
    if [ ! -d "$(dirname "$TRAEFIK_DYN")" ]; then
      die failed "Traefik's dynamic directory $(dirname "$TRAEFIK_DYN") does not exist; nothing was changed"
    fi
    avail_disk_mb=$(df -Pm "${DESK_DOCKER_ROOT:-/var/lib/docker}" 2>/dev/null | awk 'NR==2{print $4}')
    if [ "${avail_disk_mb:-0}" -lt "$MIN_DISK_MB" ]; then
      die failed "not enough free disk (${avail_disk_mb:-0} MB free, ${MIN_DISK_MB} MB needed); nothing was changed"
    fi

    # Both slots run during the switch, so there must be memory for one more api and one more web. Refuse before anything changes.
    avail_mb=$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
    if [ "$avail_mb" -lt "$BG_MIN_MEM_MB" ]; then
      die failed "not enough free memory for a zero-downtime switch (${avail_mb} MB free, ${BG_MIN_MEM_MB} MB needed); nothing was changed"
    fi

    # Shared services are only started if missing: a release never recreates Postgres or Redis.
    compose up -d --no-recreate postgres redis
    # The backup service runs its own nightly schedule; failing to start it must not block a release.
    compose up -d backup || echo "warning: the backup service did not start" >&2
    compose up -d offsite || echo "warning: the offsite copier did not start" >&2
    # Migrations only go forward, so a dump taken now is the way back from a bad one. The service writes its script out at start-up:
    # give it a few seconds, and only on the very first release after it was added can it be missing, in which case say so and go on.
    step=dump
    record "$attempt" "$arg" releasing dump
    if compose ps --status running --services | grep -qx backup &&
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        compose exec -T backup test -x /usr/local/bin/desk-backup && break
        sleep 1
      done && compose exec -T backup test -x /usr/local/bin/desk-backup; then
      if ! compose exec -T backup desk-backup once "pre-$arg"; then
        die failed "pre-release backup failed; nothing was changed"
      fi
    else
      echo "warning: the backup service is not ready; releasing without a pre-release dump" >&2
    fi

    # Expand-only migrations: the live slot keeps serving on the old code while this runs. The migrate service runs from desk-api:$IMAGE_TAG
    # and .env still names the PREVIOUS release here (it moves at step 3), so the tag is set for this one command: without it the migrations
    # of the release being deployed were left for the next release and the new code ran on a schema that was a release behind.
    step=schema
    record "$attempt" "$arg" releasing schema
    if ! IMAGE_TAG="$arg" compose run --rm migrate; then
      die failed "migration failed; the running release is untouched"
    fi

    # 1. The idle slot starts on the new image. Nothing public points at it yet.
    step=idle
    record "$attempt" "$arg" releasing idle
    echo "starting slot $idle on $arg (live: $active)"
    envset "SLOT_${idle_upper}_TAG" "$arg"
    if ! compose up -d --no-deps "api-$idle" "web-$idle"; then
      stop_slot "$idle"; die failed "could not start slot $idle; the live slot is untouched"
    fi
    if ! wait_healthy "desk-api-$idle" 36 || ! wait_healthy "desk-web-$idle" 36; then
      stop_slot "$idle"; die failed "slot $idle did not become healthy; stopping it, the live slot is untouched"
    fi

    # 2. Traffic moves to the new slot. Checked through the public address; any failure puts it back.
    step=switch
    record "$attempt" "$arg" releasing switch
    route_to "$idle"
    sleep 5
    if ! public_ok; then
      route_back "$active"; sleep 5; stop_slot "$idle"
      die rolled_back "public check failed after the switch to $idle; traffic moved back to $active"
    fi

    # 3. The worker is restarted on the new image (it is not behind the switch: one instance, and its schedulers must not run twice).
    step=worker
    record "$attempt" "$arg" releasing worker
    envset IMAGE_TAG "$arg"
    if ! compose up -d --no-deps worker || ! worker_ready; then
      if [ -n "$prev" ]; then envset IMAGE_TAG "$prev"; compose up -d --no-deps worker >/dev/null 2>&1 || true; fi
      route_back "$active"; sleep 5; stop_slot "$idle"
      die rolled_back "worker did not become ready on $arg; rolled back to ${prev:-none}"
    fi

    # 4. Commit: the idle slot is now live. The old slot stays up for a minute so requests and websocket clients already on it finish
    # (clients reconnect to the new slot on their own), then it is stopped and its images are kept for a rollback.
    step=commit
    echo "$idle" > .slot
    sleep 60
    if [ "$active" = legacy ]; then
      docker stop -t 30 desk-api-1 desk-web-1 >/dev/null 2>&1 || true
    else
      stop_slot "$active"
    fi
    echo "release $arg is up on $idle (previous: ${prev:-none}, now stopped: $active)"
    # keep this and the previous release; drop older desk images
    docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^desk-(api|web):' | grep -vE ":($arg|${prev:-none})$" | xargs -r docker rmi 2>/dev/null || true
    outcome=ok
    record "$attempt" "$arg" ok commit
    ;;
  *)
    echo "unsupported command" >&2; exit 2
    ;;
esac
