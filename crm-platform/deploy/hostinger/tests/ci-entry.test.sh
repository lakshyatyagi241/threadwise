#!/usr/bin/env bash
# Tests for ci-entry.sh, the forced command behind the CI deploy key. Runs the real script against a scratch directory with a
# stub `docker` that records every call and fails on demand, so the release flow (backup, migrate, restart, rollback) is
# checked without a server.   bash deploy/hostinger/tests/ci-entry.test.sh
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ENTRY="$HERE/../ci-entry.sh"
pass=0; fail=0

# --- stubs ---------------------------------------------------------------------------------------------------------------
BIN=$(mktemp -d); trap 'rm -rf "$BIN" "${WORK:-}"' EXIT
cat > "$BIN/sleep" <<'E'
#!/bin/sh
exit 0
E
cat > "$BIN/docker" <<'E'
#!/usr/bin/env bash
# Records the call; STUB_* variables decide what fails.
echo "$*" >> "$STUB_LOG"
case "$*" in
  "image inspect"*) exit 0 ;;
  *"up -d backup"*) [ "${STUB_BACKUP_UP_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"ps --status running --services"*) [ "${STUB_BACKUP_RUNNING:-1}" = 1 ] && echo backup; echo api; exit 0 ;;
  *"exec -T backup test -x"*) [ "${STUB_BACKUP_SCRIPT:-1}" = 1 ]; exit $? ;;
  *"exec -T backup desk-backup once"*) [ "${STUB_DUMP_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"run --rm migrate"*) [ "${STUB_MIGRATE_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  *"exec -T api node -e"*) [ "${STUB_READY:-1}" = 1 ]; exit $? ;;
  *"ps -q worker"*) echo workerid; exit 0 ;;
  "inspect --format"*) echo "${STUB_WORKER_HEALTH:-healthy}"; exit 0 ;;
  "image ls"*) exit 0 ;;
  *) exit 0 ;;
esac
E
chmod +x "$BIN/docker" "$BIN/sleep"

# --- harness -------------------------------------------------------------------------------------------------------------
new_dir() { WORK=$(mktemp -d); printf 'IMAGE_TAG=%s\n' "${1:-aaaaaaa}" > "$WORK/.env"; export DESK_DIR="$WORK" STUB_LOG="$WORK/calls.log"; : > "$STUB_LOG"; }
release() { SSH_ORIGINAL_COMMAND="release $1" PATH="$BIN:$PATH" bash "$ENTRY" > "$WORK/out.txt" 2>&1; echo $? > "$WORK/code"; }
code() { cat "$WORK/code"; }
tag() { grep '^IMAGE_TAG=' "$WORK/.env" | cut -d= -f2; }
line_of() { grep -n -- "$1" "$STUB_LOG" | head -1 | cut -d: -f1; }
ok() { if "$@"; then :; else return 1; fi; }
check() { # check "name" cmd...
  local name=$1; shift
  if "$@"; then pass=$((pass + 1)); echo "  ok   $name"; else fail=$((fail + 1)); echo "  FAIL $name"; fi
}
unset_stubs() { unset STUB_BACKUP_UP_FAIL STUB_BACKUP_RUNNING STUB_BACKUP_SCRIPT STUB_DUMP_FAIL STUB_MIGRATE_FAIL STUB_READY STUB_WORKER_HEALTH; }
before() { [ -n "$(line_of "$1")" ] && [ -n "$(line_of "$2")" ] && [ "$(line_of "$1")" -lt "$(line_of "$2")" ]; }

echo "release: normal"
unset_stubs; new_dir aaaaaaa; release bbbbbbb
check "exits 0" test "$(code)" = 0
check "new tag is recorded" test "$(tag)" = bbbbbbb
check "backup service is started" grep -q "up -d backup" "$STUB_LOG"
check "a pre-release dump named after the tag is taken" grep -q "desk-backup once pre-bbbbbbb" "$STUB_LOG"
check "the dump happens before the migration" before "desk-backup once" "run --rm migrate"
check "the migration happens before the new containers" before "run --rm migrate" "up -d api worker web"

echo "release: the dump fails"
unset_stubs; new_dir aaaaaaa; STUB_DUMP_FAIL=1 release bbbbbbb
check "exits 1" test "$(code)" = 1
check "nothing was migrated" bash -c "! grep -q 'run --rm migrate' '$STUB_LOG'"
check "no new containers were started" bash -c "! grep -q 'up -d api worker web' '$STUB_LOG'"
check "the tag is put back" test "$(tag)" = aaaaaaa
check "it says nothing was changed" grep -q "nothing was changed" "$WORK/out.txt"

echo "release: backup service not running (first release after it was added)"
unset_stubs; new_dir aaaaaaa; STUB_BACKUP_RUNNING=0 release bbbbbbb
check "exits 0" test "$(code)" = 0
check "warns that there was no dump" grep -q "releasing without a pre-release dump" "$WORK/out.txt"
check "no dump was attempted" bash -c "! grep -q 'desk-backup once' '$STUB_LOG'"
check "the migration still ran" grep -q "run --rm migrate" "$STUB_LOG"

echo "release: backup script not written yet"
unset_stubs; new_dir aaaaaaa; STUB_BACKUP_SCRIPT=0 release bbbbbbb
check "exits 0 and warns" bash -c "test $(cat "$WORK/code") = 0 && grep -q 'releasing without a pre-release dump' '$WORK/out.txt'"
check "it retried before giving up (10 checks plus the final one)" test "$(grep -c 'test -x' "$STUB_LOG")" = 11

echo "release: backup service fails to start"
unset_stubs; new_dir aaaaaaa; STUB_BACKUP_UP_FAIL=1 release bbbbbbb
check "does not block the release" test "$(code)" = 0
check "warns" grep -q "backup service did not start" "$WORK/out.txt"

echo "release: migration fails"
unset_stubs; new_dir aaaaaaa; STUB_MIGRATE_FAIL=1 release bbbbbbb
check "exits 1 and leaves the running release alone" bash -c "test $(cat "$WORK/code") = 1 && ! grep -q 'up -d api worker web' '$STUB_LOG'"
check "the tag is put back" test "$(tag)" = aaaaaaa

echo "release: the new version never becomes ready"
unset_stubs; new_dir aaaaaaa; STUB_READY=0 release bbbbbbb
check "exits 1" test "$(code)" = 1
check "rolls back to the previous tag" test "$(tag)" = aaaaaaa
check "restarts the previous release" test "$(grep -c 'up -d api worker web' "$STUB_LOG")" = 2

echo "release: the worker"
unset_stubs; new_dir aaaaaaa; STUB_WORKER_HEALTH=unhealthy release bbbbbbb
check "an unhealthy worker fails the release" test "$(code)" = 1
check "and rolls back to the previous tag" test "$(tag)" = aaaaaaa
check "it says the worker was the problem" grep -q "api or worker" "$WORK/out.txt"
unset_stubs; new_dir aaaaaaa; STUB_WORKER_HEALTH=starting release bbbbbbb
check "a worker that never leaves 'starting' fails it too" test "$(code)" = 1
unset_stubs; new_dir aaaaaaa; STUB_WORKER_HEALTH=none release bbbbbbb
check "a worker with no healthcheck (older compose) is not waited for" test "$(code)" = 0
unset_stubs; new_dir aaaaaaa; STUB_WORKER_HEALTH=healthy release bbbbbbb
check "a healthy worker passes" test "$(code)" = 0
check "its health is read after the api is ready" bash -c "grep -n 'exec -T api node -e' '$STUB_LOG' | head -1 | cut -d: -f1 > '$WORK/a'; grep -n 'inspect --format' '$STUB_LOG' | head -1 | cut -d: -f1 > '$WORK/b'; test \$(cat '$WORK/a') -lt \$(cat '$WORK/b')"

echo "release: input checks"
unset_stubs; new_dir aaaaaaa; release 'abc; rm -rf /'
check "a malformed tag is refused" test "$(code)" = 2
new_dir aaaaaaa; SSH_ORIGINAL_COMMAND="bash -c id" PATH="$BIN:$PATH" bash "$ENTRY" > "$WORK/out.txt" 2>&1; echo $? > "$WORK/code"
check "an unknown command is refused" test "$(code)" = 2

echo "sync: only allow-listed names are extracted"
unset_stubs; new_dir aaaaaaa
S=$(mktemp -d); for f in docker-compose.yml ci-entry.sh evil.sh .env; do echo "# $f" > "$S/$f"; done
(cd "$S" && tar -c docker-compose.yml ci-entry.sh evil.sh .env) | SSH_ORIGINAL_COMMAND="sync" PATH="$BIN:$PATH" bash "$ENTRY" > "$WORK/out.txt" 2>&1
check "compose and ci-entry are installed" bash -c "test -f '$WORK/docker-compose.yml' && test -x '$WORK/ci-entry.sh'"
check "anything else is ignored" bash -c "! test -e '$WORK/evil.sh' && grep -q 'IMAGE_TAG=aaaaaaa' '$WORK/.env'"
rm -rf "$S"

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
