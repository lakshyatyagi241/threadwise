#!/usr/bin/env bash
# Tests for ci-entry.sh, the forced command behind the CI deploy key. Runs the real script against a scratch directory with a stub
# `docker`, `curl` and `sleep` that record every call and fail on demand, so the blue-green release (backup, migrate, idle slot,
# traffic switch, worker, rollback) is checked without a server.   bash deploy/hostinger/tests/ci-entry.test.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ENTRY="$HERE/../ci-entry.sh"
TEMPLATE="$HERE/../traefik-desk.yml.template"
pass=0; fail=0

# --- stubs ---------------------------------------------------------------------------------------------------------------
BIN=$(mktemp -d); trap 'rm -rf "$BIN" "${WORK:-}"' EXIT
cat > "$BIN/sleep" <<'E'
#!/bin/sh
exit 0
E
cat > "$BIN/curl" <<'E'
#!/usr/bin/env bash
echo "curl $*" >> "$STUB_LOG"
[ "${STUB_PUBLIC_FAIL:-0}" = 1 ] && exit 22
exit 0
E
cat > "$BIN/docker" <<'E'
#!/usr/bin/env bash
# Records the call; STUB_* variables decide what fails.
echo "$*" >> "$STUB_LOG"
case "$*" in
  "image inspect"*) exit 0 ;;
  *"ps --status running --services"*) [ "${STUB_BACKUP_RUNNING:-1}" = 1 ] && echo backup; exit 0 ;;
  *"exec -T backup test -x"*) [ "${STUB_BACKUP_SCRIPT:-1}" = 1 ]; exit $? ;;
  *"exec -T backup desk-backup once"*) [ "${STUB_DUMP_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"run --rm migrate"*) echo "migrate-image-tag=${IMAGE_TAG:-unset}" >> "$STUB_LOG"; [ "${STUB_MIGRATE_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"up -d --no-deps worker"*) [ "${STUB_WORKER_UP_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"up -d --no-deps api-hooks"*) [ "${STUB_HOOKS_UP_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"up -d --no-deps api-"*) [ "${STUB_SLOT_UP_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"exec -T postgres"*) cat > /dev/null; [ "${STUB_RECORD_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"ps -q worker"*) echo workerid; exit 0 ;;
  "inspect --format"*workerid*) echo "${STUB_WORKER_HEALTH:-healthy}"; exit 0 ;;
  "inspect --format"*desk-api-hooks*) echo "${STUB_HOOKS_HEALTH:-healthy}"; exit 0 ;;
  "inspect --format"*) echo "${STUB_SLOT_HEALTH:-healthy}"; exit 0 ;;
  *) exit 0 ;;
esac
E
chmod +x "$BIN/docker" "$BIN/sleep" "$BIN/curl"

# --- harness -------------------------------------------------------------------------------------------------------------
# new_dir [live slot] [previous tag]: a scratch /opt/desk with a .env, the routing template and a routing file pointing at the live slot.
new_dir() {
  WORK=$(mktemp -d)
  printf 'IMAGE_TAG=%s\nDOMAIN=desk.example.test\n' "${2:-aaaaaaa}" > "$WORK/.env"
  cp "$TEMPLATE" "$WORK/traefik-desk.yml.template"
  if [ -n "${1:-}" ]; then echo "$1" > "$WORK/.slot"; fi
  mkdir -p "$WORK/dyn"
  export DESK_DIR="$WORK" TRAEFIK_DYN="$WORK/dyn/desk.yml" STUB_LOG="$WORK/calls.log" BLUE_GREEN_MIN_MEM_MB=0 DESK_LOCK_FILE="$WORK/release.lock" DESK_DOCKER_ROOT="$WORK" DESK_MIN_DISK_MB=0
  : > "$STUB_LOG"
  if [ -n "${1:-}" ]; then sed -e "s/__DOMAIN__/desk.example.test/g" -e "s/__SLOT__/$1/g" "$TEMPLATE" > "$TRAEFIK_DYN"; fi
}
release() { SSH_ORIGINAL_COMMAND="release $1${2:+ $2}" PATH="$BIN:$PATH" bash "$ENTRY" > "$WORK/out.txt" 2>&1; echo $? > "$WORK/code"; }
code() { cat "$WORK/code"; }
tag() { grep '^IMAGE_TAG=' "$WORK/.env" | cut -d= -f2; }
slot() { cat "$WORK/.slot" 2>/dev/null || echo none; }
route() { grep -oE 'desk-api-(blue|green):3000' "$TRAEFIK_DYN" 2>/dev/null | head -1 || true; }
has() { grep -q -- "$1" "$STUB_LOG"; }
hasnt() { ! grep -q -- "$1" "$STUB_LOG"; }
line_of() { grep -n -- "$1" "$STUB_LOG" | head -1 | cut -d: -f1; }
check() { # check "name" cmd...
  local name=$1; shift
  if "$@"; then pass=$((pass + 1)); echo "  ok   $name"; else fail=$((fail + 1)); echo "  FAIL $name"; fi
}
unset_stubs() { unset STUB_BACKUP_RUNNING STUB_BACKUP_SCRIPT STUB_DUMP_FAIL STUB_MIGRATE_FAIL STUB_WORKER_UP_FAIL STUB_SLOT_UP_FAIL STUB_PUBLIC_FAIL STUB_WORKER_HEALTH STUB_SLOT_HEALTH STUB_RECORD_FAIL STUB_HOOKS_UP_FAIL STUB_HOOKS_HEALTH; }
# event <stdin text> <command words...>: the build side's event command, with the message on stdin.
event() { local msg=$1; shift; printf '%s' "$msg" | SSH_ORIGINAL_COMMAND="event $*" PATH="$BIN:$PATH" bash "$ENTRY" > "$WORK/out.txt" 2>&1; echo $? > "$WORK/code"; }
A1=11111111-2222-4333-8444-555555555555

echo "release: first blue-green release (the old labelled containers are live)"
unset_stubs; new_dir "" aaaaaaa; release bbbbbbb
check "exits 0" test "$(code)" = 0
check "the idle slot is blue and is now live" test "$(slot)" = blue
check "traffic is routed to the blue API" grep -q "desk-api-blue:3000" "$TRAEFIK_DYN"
check "the new tag is the default image and the blue slot's image" grep -q '^IMAGE_TAG=bbbbbbb' "$WORK/.env"
check "the blue slot's tag is recorded" grep -q '^SLOT_BLUE_TAG=bbbbbbb' "$WORK/.env"
check "a pre-release dump is taken" has "desk-backup once pre-bbbbbbb"
check "the dump happens before the migration" test "$(line_of 'desk-backup once')" -lt "$(line_of 'run --rm migrate')"
check "the migration runs from the NEW image, not the previous release's" has "migrate-image-tag=bbbbbbb"
check "the migration happens before the blue slot starts" test "$(line_of 'run --rm migrate')" -lt "$(line_of 'up -d --no-deps api-blue')"
check "the blue slot starts before the worker is restarted" test "$(line_of 'up -d --no-deps api-blue')" -lt "$(line_of 'up -d --no-deps worker')"
check "the public check runs" has "curl -fsSk"
check "the legacy containers are stopped after the switch" has "stop -t 30 desk-api-1 desk-web-1"
check "shared services are only started, never recreated" has "up -d --no-recreate postgres redis"

echo "release: second release, blue is live, so green becomes live"
unset_stubs; new_dir blue bbbbbbb; release ccccccc
check "exits 0" test "$(code)" = 0
check "green is now live" test "$(slot)" = green
check "traffic is routed to the green API" grep -q "desk-api-green:3000" "$TRAEFIK_DYN"
check "the old blue slot is stopped" has "stop -t 30 api-blue web-blue"
check "the previous tag is kept for a rollback" grep -q '^IMAGE_TAG=ccccccc' "$WORK/.env"

echo "release: the webhook API (api-hooks) follows the release"
unset_stubs; new_dir blue bbbbbbb; echo HOOKS_TAG=bbbbbbb >> "$WORK/.env"; release ccccccc
check "exits 0" test "$(code)" = 0
check "api-hooks is started on the new tag" grep -q '^HOOKS_TAG=ccccccc' "$WORK/.env"
check "api-hooks starts after the idle slot and before the traffic switch" test "$(line_of 'up -d --no-deps api-green')" -lt "$(line_of 'up -d --no-deps api-hooks')" -a "$(line_of 'up -d --no-deps api-hooks')" -lt "$(line_of 'curl -fsSk')"
check "the routing sends /v2/public/webhooks to api-hooks" grep -q 'desk-api-hooks:3000' "$TRAEFIK_DYN"
check "the slot API is the fallback while api-hooks is unhealthy" grep -q 'fallback: desk-api$' "$TRAEFIK_DYN"
check "the live slot is still found when the hooks service is in the routing file" test "$(route)" = "desk-api-green:3000"

echo "release: api-hooks fails to start (webhooks fall back to the slot API; the release goes on)"
unset_stubs; new_dir blue bbbbbbb; echo HOOKS_TAG=bbbbbbb >> "$WORK/.env"; STUB_HOOKS_UP_FAIL=1 release ccccccc
check "exits 0" test "$(code)" = 0
check "green is live" test "$(slot)" = green
check "the previous hooks tag is put back" grep -q '^HOOKS_TAG=bbbbbbb' "$WORK/.env"
check "the warning says webhooks stay on the slot API" grep -q "webhooks stay on the slot API" "$WORK/out.txt"

echo "release: api-hooks never becomes healthy (same: warning, release succeeds)"
unset_stubs; new_dir blue bbbbbbb; STUB_HOOKS_HEALTH=unhealthy release ccccccc
check "exits 0" test "$(code)" = 0
check "green is live" test "$(slot)" = green

echo "release: the public check fails, so api-hooks goes back to the previous tag"
unset_stubs; new_dir blue bbbbbbb; echo HOOKS_TAG=bbbbbbb >> "$WORK/.env"; STUB_PUBLIC_FAIL=1 release ccccccc
check "exits 1" test "$(code)" = 1
check "api-hooks is back on the previous tag" grep -q '^HOOKS_TAG=bbbbbbb' "$WORK/.env"

echo "release: the worker fails, so api-hooks goes back to the previous tag"
unset_stubs; new_dir blue bbbbbbb; echo HOOKS_TAG=bbbbbbb >> "$WORK/.env"; STUB_WORKER_HEALTH=unhealthy release ccccccc
check "exits 1" test "$(code)" = 1
check "api-hooks is back on the previous tag" grep -q '^HOOKS_TAG=bbbbbbb' "$WORK/.env"

echo "routing template: webhook router, failover and live-slot detection"
check "a desk-hooks router for the webhook path at priority 200" grep -q 'priority: 200' "$TEMPLATE"
check "the failover's main service is health-checked on /health" grep -q 'path: /health' "$TEMPLATE"
unset_stubs; new_dir green ccccccc
printf 'http:\n  services:\n    desk-hooks-main:\n      loadBalancer:\n        servers:\n          - url: http://desk-api-hooks:3000\n    desk-api:\n      loadBalancer:\n        servers:\n          - url: http://desk-api-green:3000\n' > "$TRAEFIK_DYN"
rm -f "$WORK/.slot"; release ddddddd
check "hooks listed first in the routing file does not fool the live-slot detection (blue is idle)" test "$(slot)" = blue

echo "release: the idle slot never becomes healthy"
unset_stubs; new_dir blue bbbbbbb; before=$(cat "$TRAEFIK_DYN"); STUB_SLOT_HEALTH=unhealthy release ccccccc
check "exits 1" test "$(code)" = 1
check "traffic is unchanged" test "$(cat "$TRAEFIK_DYN")" = "$before"
check "the live slot is still blue" test "$(slot)" = blue
check "the tag is unchanged" test "$(tag)" = bbbbbbb
check "the half-started green slot is stopped" has "stop -t 30 api-green web-green"
check "the worker is not touched" hasnt "up -d --no-deps worker"

echo "release: the slot will not start"
unset_stubs; new_dir blue bbbbbbb; STUB_SLOT_UP_FAIL=1 release ccccccc
check "exits 1" test "$(code)" = 1
check "traffic is unchanged" grep -q "desk-api-blue:3000" "$TRAEFIK_DYN"

echo "release: the public check fails after the switch"
unset_stubs; new_dir blue bbbbbbb; STUB_PUBLIC_FAIL=1 release ccccccc
check "exits 1" test "$(code)" = 1
check "traffic is moved back to the live slot" grep -q "desk-api-blue:3000" "$TRAEFIK_DYN"
check "the live slot is still blue" test "$(slot)" = blue
check "the tag is unchanged" test "$(tag)" = bbbbbbb
check "the switched-to slot is stopped" has "stop -t 30 api-green web-green"
check "the worker is not restarted" hasnt "up -d --no-deps worker"

echo "release: the public check fails with no live slot yet (first release)"
unset_stubs; new_dir "" aaaaaaa; STUB_PUBLIC_FAIL=1 release bbbbbbb
check "exits 1" test "$(code)" = 1
check "the routing file is removed so the old labelled containers serve again" test ! -e "$TRAEFIK_DYN"
check "the tag is unchanged" test "$(tag)" = aaaaaaa

echo "release: the worker does not become ready"
unset_stubs; new_dir blue bbbbbbb; STUB_WORKER_HEALTH=unhealthy release ccccccc
check "exits 1" test "$(code)" = 1
check "the worker is restored to the previous tag" grep -q '^IMAGE_TAG=bbbbbbb' "$WORK/.env"
check "traffic is moved back to the live slot" grep -q "desk-api-blue:3000" "$TRAEFIK_DYN"
check "the live slot is still blue" test "$(slot)" = blue

echo "release: the dump fails"
unset_stubs; new_dir blue bbbbbbb; STUB_DUMP_FAIL=1 release ccccccc
check "exits 1" test "$(code)" = 1
check "nothing is migrated or started" hasnt "run --rm migrate"
check "traffic is unchanged" grep -q "desk-api-blue:3000" "$TRAEFIK_DYN"

echo "release: the migration fails"
unset_stubs; new_dir blue bbbbbbb; STUB_MIGRATE_FAIL=1 release ccccccc
check "exits 1" test "$(code)" = 1
check "no slot is started" hasnt "up -d --no-deps api-"
check "traffic is unchanged" grep -q "desk-api-blue:3000" "$TRAEFIK_DYN"

echo "release: not enough memory for the overlap"
unset_stubs; new_dir blue bbbbbbb; BLUE_GREEN_MIN_MEM_MB=999999999 release ccccccc
check "exits 1" test "$(code)" = 1
check "nothing is dumped, migrated or started" test -z "$(grep -E 'desk-backup once|migrate|up -d --no-deps' "$STUB_LOG")"
check "the message says nothing was changed" grep -q "nothing was changed" "$WORK/out.txt"

echo "release: a bad tag is refused"
unset_stubs; new_dir blue bbbbbbb; release "not a tag"
check "exits 2" test "$(code)" = 2
check "nothing is run" test ! -s "$STUB_LOG"

echo "release: .slot is lost but the routing file points at green (a release died between the two writes)"
unset_stubs; new_dir green ccccccc; rm -f "$WORK/.slot"; release ddddddd
check "exits 0" test "$(code)" = 0
check "blue is the idle slot and is now live" test "$(slot)" = blue
check "traffic is routed to the blue API" grep -q "desk-api-blue:3000" "$TRAEFIK_DYN"
check "the old green slot is stopped" has "stop -t 30 api-green web-green"

echo "release: .slot disagrees with the routing file"
unset_stubs; new_dir blue bbbbbbb; echo green > "$WORK/.slot"; release ccccccc
check "exits 0" test "$(code)" = 0
check "the routing file wins: green was idle, so green is live" test "$(slot)" = green

echo "release: .slot holds garbage and there is no routing file"
unset_stubs; new_dir "" aaaaaaa; echo "../etc" > "$WORK/.slot"; release bbbbbbb
check "exits 0 and treats it as the first release" test "$(code)" = 0
check "the blue slot becomes live" test "$(slot)" = blue

echo "release: another release holds the lock"
unset_stubs; new_dir blue bbbbbbb
( exec 8>"$DESK_LOCK_FILE"; flock -n 8; sleep 3 ) & holder=$!; sleep 0.5
release ccccccc
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null
check "exits 1" test "$(code)" = 1
check "the message says nothing was changed" grep -q "nothing was changed" "$WORK/out.txt"
check "nothing is run" test -z "$(grep -E 'migrate|up -d' "$STUB_LOG")"

echo "release: Traefik's dynamic directory is missing"
unset_stubs; new_dir blue bbbbbbb; rm -rf "$WORK/dyn"; release ccccccc
check "exits 1" test "$(code)" = 1
check "nothing is dumped, migrated or started" test -z "$(grep -E 'desk-backup once|migrate|up -d --no-deps' "$STUB_LOG")"

echo "release: not enough disk"
unset_stubs; new_dir blue bbbbbbb; DESK_MIN_DISK_MB=999999999 release ccccccc
check "exits 1" test "$(code)" = 1
check "nothing is dumped, migrated or started" test -z "$(grep -E 'desk-backup once|migrate|up -d --no-deps' "$STUB_LOG")"

echo "release: DOMAIN missing from .env"
unset_stubs; new_dir blue bbbbbbb; sed -i '/^DOMAIN=/d' "$WORK/.env"; release ccccccc
check "exits 1 before anything changes" test "$(code)" = 1
check "traffic is unchanged" grep -q "desk-api-blue:3000" "$TRAEFIK_DYN"

echo "sync: ci-entry.sh is never replaced through the CI key"
unset_stubs; new_dir blue bbbbbbb
printf 'original\n' > "$WORK/ci-entry.sh"
S=$(mktemp -d); printf 'evil\n' > "$S/ci-entry.sh"; printf 'services: {}\n' > "$S/docker-compose.yml"
tar -C "$S" -c ci-entry.sh docker-compose.yml | SSH_ORIGINAL_COMMAND="sync" PATH="$BIN:$PATH" bash "$ENTRY" > "$WORK/out.txt" 2>&1
check "ci-entry.sh is untouched" grep -q '^original$' "$WORK/ci-entry.sh"
check "allow-listed files are still installed" grep -q 'services' "$WORK/docker-compose.yml"
rm -rf "$S"

echo "release history: every step is recorded, under the attempt the caller gave"
unset_stubs; new_dir blue bbbbbbb; release ccccccc $A1
check "exits 0" test "$(code)" = 0
check "the release starts and each step is recorded under the attempt" has "$A1 ccccccc releasing start"
check "the migration step is recorded" has "$A1 ccccccc releasing schema"
check "the switch step is recorded" has "$A1 ccccccc releasing switch"
check "the outcome ok is recorded" has "$A1 ccccccc ok commit"
check "the outcome is written after the switch" test "$(line_of 'ok commit')" -gt "$(line_of 'desk-api-green')"

echo "release history: a failed migration is recorded as failed, and the release says why"
unset_stubs; new_dir blue bbbbbbb; STUB_MIGRATE_FAIL=1 release ccccccc $A1
check "exits 1" test "$(code)" = 1
check "the outcome failed is recorded at the schema step" has "$A1 ccccccc failed schema"
check "no ok outcome is recorded" hasnt " ok commit"

echo "release history: a failed public check after the switch is recorded as rolled back"
unset_stubs; new_dir blue bbbbbbb; STUB_PUBLIC_FAIL=1 release ccccccc $A1
check "exits 1" test "$(code)" = 1
check "the outcome rolled_back is recorded at the switch step" has "$A1 ccccccc rolled_back switch"

echo "release history: a failed database write never fails the release"
unset_stubs; new_dir blue bbbbbbb; STUB_RECORD_FAIL=1 release ccccccc $A1
check "exits 0" test "$(code)" = 0
check "traffic moved to the new slot" grep -q "desk-api-green:3000" "$TRAEFIK_DYN"

echo "release history: a release without an attempt id gets one; a bad one is refused"
unset_stubs; new_dir blue bbbbbbb; release ccccccc
check "exits 0 and still records" has " ok commit"
unset_stubs; new_dir blue bbbbbbb; SSH_ORIGINAL_COMMAND="release ccccccc not-a-uuid" PATH="$BIN:$PATH" bash "$ENTRY" > "$WORK/out.txt" 2>&1; echo $? > "$WORK/code"
check "exits 2" test "$(code)" = 2
check "nothing is run" test ! -s "$STUB_LOG"

echo "event: a build-side step is recorded with its message"
unset_stubs; new_dir blue bbbbbbb; event "docker build failed" "$A1" aaaaaaa failed building
check "exits 0" test "$(code)" = 0
check "the state, step and message are recorded" has "$A1 aaaaaaa failed building docker build failed"

echo "event: a bad state, tag or attempt is refused and nothing is recorded"
unset_stubs; new_dir blue bbbbbbb; event "" "$A1" aaaaaaa bogus building
check "exits 2 for a bad state" test "$(code)" = 2
event "" "not-a-uuid" aaaaaaa failed building
check "exits 2 for a bad attempt" test "$(code)" = 2
event "" "$A1" "not a tag" failed building
check "exits 2 for a bad tag" test "$(code)" = 2
check "nothing is recorded" test ! -s "$STUB_LOG"

echo "event: control characters and long messages are cut before recording"
unset_stubs; new_dir blue bbbbbbb; event "$(printf 'bad\001thing %0600d' 1)" "$A1" aaaaaaa failed shipping
check "exits 0" test "$(code)" = 0
check "no control character reaches the record" test "$(grep -c "$(printf '\001')" "$STUB_LOG")" = 0
check "the message is cut to 500 characters" test "$(grep 'failed shipping' "$STUB_LOG" | head -1 | sed 's/.*failed shipping //' | tr -d '\n' | wc -c)" -le 500

echo "changes: the pull requests of a release are recorded for the attempt, without control characters"
unset_stubs; new_dir blue bbbbbbb
printf '[{"pr":830,"title":"feat: a\001b","author":"Akshay"}]' | SSH_ORIGINAL_COMMAND="changes $A1" PATH="$BIN:$PATH" bash "$ENTRY" > "$WORK/out.txt" 2>&1; echo $? > "$WORK/code"
check "exits 0" test "$(code)" = 0
check "the attempt and the JSON are recorded" grep -qF -- "$A1 [{\"pr\":830,\"title\":\"feat: ab\",\"author\":\"Akshay\"}]" "$STUB_LOG"
printf '[]' | SSH_ORIGINAL_COMMAND="changes not-a-uuid" PATH="$BIN:$PATH" bash "$ENTRY" > "$WORK/out.txt" 2>&1; echo $? > "$WORK/code"
check "a bad attempt is refused" test "$(code)" = 2

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
