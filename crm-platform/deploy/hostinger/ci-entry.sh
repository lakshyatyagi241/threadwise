#!/usr/bin/env bash
# Forced command for the CI deploy key (authorized_keys: restrict,command="/opt/desk/ci-entry.sh" ssh-ed25519 ...).
# The key can do exactly three things, chosen by the command the client sends; nothing else is reachable with it.
#   load             docker image tarball (gzip) on stdin -> docker load
#   sync             tar on stdin with the deploy files -> /opt/desk (only the allow-listed names are extracted)
#   release <tag>    migrate, restart api/worker/web on that image tag, health-check, roll back on failure
set -euo pipefail
DESK_DIR=${DESK_DIR:-/opt/desk}   # overridable only so tests/ci-entry.test.sh can run against a scratch directory
cd "$DESK_DIR"
read -r action arg _ <<<"${SSH_ORIGINAL_COMMAND:-}"

case "$action" in
  load)
    nice -n 10 sh -c 'gunzip | docker load'
    ;;
  sync)
    tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
    tar -x -C "$tmp"
    for f in docker-compose.yml init-roles.sh seed.js set-secrets.sh ci-entry.sh .env.example; do
      [ -f "$tmp/$f" ] && install -m "$([ "${f##*.}" = sh ] && echo 755 || echo 644)" "$tmp/$f" "$DESK_DIR/$f"
    done
    echo "synced"
    ;;
  release)
    [[ "$arg" =~ ^[a-f0-9]{7,40}$ ]] || { echo "bad tag" >&2; exit 2; }
    docker image inspect "desk-api:$arg" "desk-web:$arg" >/dev/null
    prev=$(grep '^IMAGE_TAG=' .env | cut -d= -f2 || true)
    setag() { sed -i '/^IMAGE_TAG=/d' .env; echo "IMAGE_TAG=$1" >> .env; }
    ready() { for _ in $(seq 1 36); do
        docker compose --env-file .env exec -T api node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && return 0
        sleep 5
      done; return 1; }
    setag "$arg"
    docker compose --env-file .env up -d postgres redis minio
    # The backup service runs its own nightly schedule; failing to start it must not block a release.
    docker compose --env-file .env up -d backup || echo "warning: the backup service did not start" >&2
    # Migrations only go forward, so a dump taken now is the way back from a bad one. The service writes its script out at
    # start-up: give it a few seconds, and only on the very first release after it was added can it be missing, in which case
    # say so and go on. Once the script exists, a dump that fails stops the release before anything has changed.
    if docker compose --env-file .env ps --status running --services | grep -qx backup &&
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        docker compose --env-file .env exec -T backup test -x /usr/local/bin/desk-backup && break
        sleep 1
      done && docker compose --env-file .env exec -T backup test -x /usr/local/bin/desk-backup; then
      if ! docker compose --env-file .env exec -T backup desk-backup once "pre-$arg"; then
        echo "pre-release backup failed; nothing was changed" >&2; setag "${prev:-$arg}"; exit 1
      fi
    else
      echo "warning: the backup service is not ready; releasing without a pre-release dump" >&2
    fi
    if ! docker compose --env-file .env run --rm migrate; then
      echo "migration failed; the running release is untouched" >&2; setag "${prev:-$arg}"; exit 1
    fi
    docker compose --env-file .env up -d api worker web
    if ready; then
      echo "release $arg is up (previous: ${prev:-none})"
      # keep this and the previous release; drop older desk images
      docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^desk-(api|web):' | grep -vE ":($arg|${prev:-none})$" | xargs -r docker rmi 2>/dev/null || true
    else
      echo "release $arg did not become ready; rolling back to ${prev:-none}" >&2
      if [ -n "$prev" ]; then setag "$prev"; docker compose --env-file .env up -d api worker web; fi
      exit 1
    fi
    ;;
  *)
    echo "unsupported command" >&2; exit 2
    ;;
esac
