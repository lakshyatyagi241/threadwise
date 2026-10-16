#!/usr/bin/env bash
# Build the tip of main on THIS host and release it on the production host (see README.md in this folder).
# The same steps as .github/workflows/deploy.yml, run here instead of on a GitHub runner:
#   fetch main -> build desk-api and desk-web -> `sync` deploy files -> `load` the images -> `release <tag>` -> smoke test.
# `release` is /opt/desk/ci-entry.sh on the production host (blue-green): it dumps the database, migrates, starts the idle slot, moves traffic
# to it once it is healthy, restarts the worker and rolls back on its own if any step fails. A failed BUILD stops before production is touched.
#
# Safe to start from anywhere, any number of times: one run at a time (flock), a push that arrives during a run is picked up
# when it ends, and a tip that is already released is skipped (use --force to release it again).
set -uo pipefail

CI_DIR=${DESK_CI_DIR:-/opt/desk-ci}
STATE=${DESK_CI_STATE:-/var/lib/desk-ci}
LOGS=${DESK_CI_LOGS:-/var/log/desk-ci}
CONF=${DESK_CI_CONF:-/etc/desk-ci}
REPO_URL=${DESK_CI_REPO_URL:-git@github.com:lakshyatyagi241/threadwise.git}
BRANCH=${DESK_CI_BRANCH:-main}
SMOKE_URL=${DESK_CI_SMOKE_URL:-https://desk.wabo.ai/ready}
# The public Sentry DSN, as in deploy.yml (it only lets events in).
SENTRY_DSN=${DESK_CI_SENTRY_DSN:-https://7a686f169d4a7b804e5eb7b6fdd9e806@o4507446172188672.ingest.us.sentry.io/4512202246324224}
FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1

SSH_CONFIG="$CONF/ssh_config"
ssh_prod() { ssh -F "$SSH_CONFIG" -o BatchMode=yes desk "$@"; }
export GIT_SSH_COMMAND="ssh -F $SSH_CONFIG -o BatchMode=yes"

mkdir -p "$STATE" "$LOGS"
# Mark the request BEFORE taking the lock: a run that is finishing releases the lock and then looks for this flag, so a push that
# lost the lock race is always seen (touching it after a failed flock could land just after that last look).
touch "$STATE/pending"
exec 9>"$STATE/lock"
if ! flock -n 9; then
  echo "$(date -Is) a deploy is running; the new push will be picked up when it ends" >> "$LOGS/webhook.log"
  exit 0
fi

status() { printf '{"at":"%s","sha":"%s","state":"%s","log":"%s"}\n' "$(date -Is)" "${TAG:-}" "$1" "${LOG:-}" > "$STATE/status.json"; }

run_once() {
  TAG=""; LOG="$LOGS/$(date +%Y%m%dT%H%M%S).log"
  exec > >(tee -a "$LOG") 2>&1
  echo "== $(date -Is) fetching $BRANCH"
  if [ -d "$CI_DIR/repo/.git" ]; then
    git -C "$CI_DIR/repo" fetch --depth 200 origin "$BRANCH" && git -C "$CI_DIR/repo" reset --hard FETCH_HEAD && git -C "$CI_DIR/repo" clean -fdq || return 1
  else
    git clone --depth 200 --branch "$BRANCH" "$REPO_URL" "$CI_DIR/repo" || return 1
  fi
  cd "$CI_DIR/repo" || return 1
  TAG=$(git rev-parse --short=9 HEAD)
  last=$(cat "$STATE/deployed" 2>/dev/null || true)
  if [ "$FORCE" = 0 ] && [ "$last" = "$TAG" ]; then echo "== $TAG is already released; nothing to do"; return 0; fi
  # Like the old workflow's `paths: crm-platform/**`: a push that changes nothing under crm-platform/ is not released.
  if [ "$FORCE" = 0 ] && [ -n "$last" ] && git rev-parse -q --verify "$last^{commit}" >/dev/null 2>&1 \
    && git diff --quiet "$last" HEAD -- crm-platform; then
    echo "== $TAG changes nothing under crm-platform/ since $last; not releasing"; return 0
  fi
  # Blue-green: the live slot keeps serving while this release migrates, so the migrations it adds must be expand-only. Checked here,
  # before anything is built or shipped. Needs the last released commit in the clone; fetch the full history once if it is missing.
  if [ -n "$last" ] && ! git rev-parse -q --verify "$last^{commit}" >/dev/null 2>&1; then
    git fetch -q --unshallow origin 2>/dev/null || git fetch -q --depth 5000 origin "$BRANCH" || true
  fi
  if [ -n "$last" ] && git rev-parse -q --verify "$last^{commit}" >/dev/null 2>&1; then
    new_mig=$(git diff --name-only --diff-filter=AM "$last" HEAD -- 'crm-platform/packages/db/migrations/*.sql')
    if [ -n "$new_mig" ] && ! python3 crm-platform/deploy/build-server/migration-lint.py $new_mig; then
      echo "== $TAG has a migration that is not expand-only; it is not built or released. Fix it or add a reviewed bluegreen-ok line."
      return 1
    fi
  elif [ -n "$last" ]; then
    echo "== cannot find the last released commit $last in the clone; not releasing (check the clone's history)"; return 1
  fi
  status building
  echo "== building $TAG"
  docker build -f crm-platform/apps/api/Dockerfile -t "desk-api:$TAG" --build-arg "GIT_SHA=$TAG" crm-platform || return 1
  docker build -f crm-platform/apps/web/Dockerfile -t "desk-web:$TAG" \
    --build-arg "NEXT_PUBLIC_SENTRY_DSN=$SENTRY_DSN" --build-arg "NEXT_PUBLIC_GIT_SHA=$TAG" crm-platform || return 1
  status shipping
  echo "== syncing deploy files"
  tar -C crm-platform/deploy/hostinger -c docker-compose.yml init-roles.sh seed.js set-secrets.sh ci-entry.sh .env.example traefik-desk.yml.template | ssh_prod sync || return 1
  echo "== shipping images"
  docker save "desk-api:$TAG" "desk-web:$TAG" | gzip -1 | ssh_prod load || return 1
  status releasing
  echo "== releasing $TAG on production"
  ssh_prod "release $TAG" || return 1
  echo "== smoke test $SMOKE_URL"
  for _ in $(seq 1 12); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SMOKE_URL")" = 200 ] && { echo "== $TAG is live"; echo "$TAG" > "$STATE/deployed"; return 0; }
    sleep 5
  done
  echo "== $SMOKE_URL did not return 200 after the release" >&2
  return 1
}

while true; do
  rm -f "$STATE/pending"
  ( run_once ); rc=$?
  TAG=$(git -C "$CI_DIR/repo" rev-parse --short=9 HEAD 2>/dev/null || true); LOG=$(ls -1t "$LOGS"/20*.log 2>/dev/null | head -1)
  if [ "$rc" = 0 ]; then status ok; else status failed; echo "$(date -Is) deploy of $TAG failed (rc=$rc), see $LOG" >> "$LOGS/webhook.log"; fi
  # keep the last two local builds and trim the build cache so the disk does not fill
  docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^desk-(api|web):' | grep -vE ":($TAG|$(cat "$STATE/deployed" 2>/dev/null || echo none))$" | xargs -r docker rmi >/dev/null 2>&1 || true
  docker builder prune -f --filter until=96h >/dev/null 2>&1 || true
  [ -e "$STATE/pending" ] || break
  FORCE=0
done
# Release the lock, then look once more: a push that failed to get the lock has already set the flag (see above).
exec 9>&-
if [ -e "$STATE/pending" ]; then exec "$0"; fi
