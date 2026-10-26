#!/usr/bin/env bash
# Tests for deploy-observability.sh (dry run) and stack-selfcheck.sh (stubs). No network, no docker, no ssh.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
DEP="$ROOT/deploy/hostinger/deploy-observability.sh"; SC="$ROOT/deploy/hostinger/stack-selfcheck.sh"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
N=0; F=0
ok() { N=$((N+1)); if [ "$2" = 0 ]; then echo "ok $N  $1"; else F=$((F+1)); echo "NOT OK $N  $1"; fi; }
has() { printf '%s' "$2" | grep -qF -- "$1"; }
t() { local d="$1"; shift; "$@" >/dev/null 2>&1; ok "$d" $?; }

t "bash -n deploy-observability.sh" bash -n "$DEP"
t "bash -n stack-selfcheck.sh" bash -n "$SC"
if command -v shellcheck >/dev/null; then t "shellcheck both" shellcheck "$DEP" "$SC"; else echo "skip shellcheck (not installed)"; fi

# --- deploy dry run
G="$W/g"; mkdir "$G"
for c in critical slowquery deploy; do echo "https://chat.googleapis.com/v1/spaces/SECRET$c/messages?key=SECRETKEY$c" > "$G/${c}_url"; chmod 600 "$G/${c}_url"; done
cd "$ROOT" || exit 2
OUT="$(GCHAT_DIR="$G" DESK_DEPLOY_DRYRUN=1 bash "$DEP" HEAD 2>&1)"; RC=$?
ok "dry run exits 0" "$RC"
for s in "== 0 preflight" "== 1 memory" "== 2 copy" "== 3 webhook" "== 4 read-only" "== 5 .env" "== 6 pull" "== 7 checks" "ROLLBACK:"; do
  has "$s" "$OUT"; ok "dry run shows step: $s" $?; done
for f in $(cd deploy/hostinger && ls traefik-*.yml.template); do has "$f" "$OUT"; ok "glob copies $f" $?; done
has "grep -v 'REVOKE ALL'" "$OUT"; ok "REVOKE line is removed from the role SQL" $?
has "setv OBS_METRICS_PORT 0" "$OUT"; ok "OBS_METRICS_PORT=0 forced after observability-up.sh" $?
has "CHAT_BRIDGE_DIR /opt/chat-bridge" "$OUT"; ok "CHAT_BRIDGE_DIR set" $?
has "install-release-watch.sh" "$OUT"; ok "release watcher installed" $?
has "systemctl is-active desk-release-watch" "$OUT"; ok "release watcher checked" $?
! printf '%s' "$OUT" | grep -v '^No test alert' | grep -qi 'test alert\|test message\|chat.googleapis'; ok "no test alert or test message step" $?
! printf '%s' "$OUT" | grep -q 'SECRET'; ok "webhook URLs never printed" $?
OUT="$(GCHAT_DIR="$G" DESK_DEPLOY_DRYRUN=1 bash "$DEP" --check-only HEAD 2>&1)"; RC=$?
ok "--check-only exits 0" "$RC"; ! has "== 1 memory" "$OUT"; ok "--check-only runs no later step" $?
rm "$G/slowquery_url"
OUT="$(GCHAT_DIR="$G" DESK_DEPLOY_DRYRUN=1 bash "$DEP" HEAD 2>&1)"; RC=$?
[ "$RC" != 0 ]; ok "missing webhook file stops" $?; has "slowquery_url" "$OUT"; ok "STOP names the missing file" $?; ! has "== 2 copy" "$OUT"; ok "nothing copied after STOP" $?
echo "http://example.com/x" > "$G/slowquery_url"; chmod 600 "$G/slowquery_url"
GCHAT_DIR="$G" DESK_DEPLOY_DRYRUN=1 bash "$DEP" HEAD >/dev/null 2>&1; [ $? != 0 ]; ok "non-Google-Chat URL stops" $?
echo "https://chat.googleapis.com/x" > "$G/slowquery_url"; chmod 644 "$G/slowquery_url"
GCHAT_DIR="$G" DESK_DEPLOY_DRYRUN=1 bash "$DEP" HEAD >/dev/null 2>&1; [ $? != 0 ]; ok "mode 644 webhook file stops" $?

# --- selfcheck against stubs
B="$W/bin"; mkdir "$B"
cat > "$B/docker" <<'S'
#!/usr/bin/env bash
case "$1" in
  ps) cat "$STUB_PS" ;;
  exec) case "$*" in
    *node*) [ -n "${STUB_BRIDGE_BAD:-}" ] || echo '{"ok":true}' ;;
    *up%7B*) echo "{\"status\":\"success\",\"data\":{\"result\":[{\"value\":[1,\"${STUB_TARGET:-1}\"]}]}}" ;;
    *time*) echo "{\"status\":\"success\",\"data\":{\"result\":[{\"value\":[1,\"${STUB_WD:-30.5}\"]}]}}" ;;
  esac ;;
esac
S
cat > "$B/systemctl" <<'S'
#!/usr/bin/env bash
echo "${STUB_SYSTEMD:-active}"
S
cat > "$B/df" <<'S'
#!/usr/bin/env bash
printf 'Filesystem 1K-blocks Used Available Use%% Mounted\n/dev/x 100 %s 10 %s%% /\n' "${STUB_USED:-40}" "${STUB_USED:-40}"
S
cat > "$B/curl" <<'S'
#!/usr/bin/env bash
echo "$*" >> "$STUB_CURL_LOG"; cat >> "$STUB_CURL_STDIN"
S
chmod +x "$B"/*
export PATH="$B:$PATH" STATE_DIR="$W/state" STUB_CURL_LOG="$W/curl.log" STUB_CURL_STDIN="$W/curl.in" HEARTBEAT_FILE="$W/hb" CRITICAL_URL_FILE="$W/crit"
echo "https://chat.googleapis.com/v1/spaces/SECRETCRIT/messages?key=SECRETK" > "$CRITICAL_URL_FILE"
export STUB_PS="$W/ps"
good() { printf 'desk-grafana-1 Up 2 hours (healthy)\ndesk-prometheus-1 Up 2 hours\ndesk-alertmanager-1 Up 2 hours\ndesk-gchat-bridge Up 2 hours (healthy)\ndesk-probe-1 Up 2 hours (healthy)\n' > "$STUB_PS"; touch "$HEARTBEAT_FILE"; }
sc() { bash "$SC" "$@" 2>&1; }
good; OUT="$(sc)"; RC=$?; ok "selfcheck passes on healthy stubs" "$RC"; [ "$(printf '%s\n' "$OUT" | grep -c '^OK')" = 11 ]; ok "one OK line per check (11)" $?
failcase() { OUT="$(sc)"; RC=$?; [ "$RC" = 1 ] && has "FAIL $1" "$OUT"; ok "selfcheck FAIL: $1" $?; }
good; sed -i '/grafana/d' "$STUB_PS"; failcase container-grafana
good; sed -i 's/prometheus-1 Up 2 hours/prometheus-1 Up 2 hours (unhealthy)/' "$STUB_PS"; failcase container-prometheus
good; sed -i '/probe/d' "$STUB_PS"; failcase container-probe
good; STUB_SYSTEMD=failed failcase release-watch; unset STUB_SYSTEMD
good; touch -d '10 minutes ago' "$HEARTBEAT_FILE"; failcase release-watch-heartbeat
good; STUB_BRIDGE_BAD=1 failcase bridge-health; unset STUB_BRIDGE_BAD
good; STUB_TARGET=0 failcase prometheus-target-bridge; unset STUB_TARGET
good; STUB_WD=1200.2 failcase watchdog; unset STUB_WD
good; STUB_USED=90 failcase disk; unset STUB_USED
# --- notify dedupe
good; sed -i '/probe/d' "$STUB_PS"; : > "$STUB_CURL_LOG"; : > "$STUB_CURL_STDIN"
OUT="$(NOW=10000 sc --notify)"; [ "$(wc -l < "$STUB_CURL_LOG")" = 1 ]; ok "notify posts one message on first failure" $?
! grep -q 'SECRET' "$STUB_CURL_LOG"; ok "webhook URL not in curl arguments" $?; ! printf '%s' "$OUT" | grep -q SECRET; ok "webhook URL not in output" $?
grep -q -- '--max-time 8' "$STUB_CURL_LOG"; ok "curl uses --max-time 8" $?
NOW=10600 sc --notify >/dev/null; [ "$(wc -l < "$STUB_CURL_LOG")" = 1 ]; ok "no second post within the hour" $?
NOW=13700 sc --notify >/dev/null; [ "$(wc -l < "$STUB_CURL_LOG")" = 2 ]; ok "posts again after an hour" $?
sed -i '/grafana/d' "$STUB_PS"; NOW=13800 sc --notify >/dev/null; [ "$(wc -l < "$STUB_CURL_LOG")" = 3 ]; ok "a newly failing check posts at once" $?
good; NOW=13900 sc --notify >/dev/null; [ "$(wc -l < "$STUB_CURL_LOG")" = 3 ] && [ -z "$(ls "$STATE_DIR" 2>/dev/null)" ]; ok "recovery posts nothing and clears state" $?

echo; echo "$((N-F)) / $N passed"; [ "$F" = 0 ]
