#!/usr/bin/env bash
# Deploys the Google Chat alerting stack (Prometheus, Alertmanager, Grafana, gchat-bridge, probe, release watcher) to the production host.
# Run from a LAPTOP that has the project SSH key configured in ~/.ssh/config for the host. Idempotent: safe to re-run.
#   deploy-observability.sh [--check-only] [--yes] [git-ref]        (default ref: origin/main)
# Env: HOST (default 187.127.155.227), GRAFANA_DOMAIN (grafana-desk.wabo.ai), PROMETHEUS_DOMAIN (prometheus-desk.wabo.ai),
#      GCHAT_DIR (default ~/gchat; files critical_url slowquery_url deploy_url), DESK_DEPLOY_DRYRUN=1 (print remote commands, run none).
# Files come from `git archive <ref>`, never from the working tree. It never posts a test alert or message, never prints a secret.
set -euo pipefail

HOST="${HOST:-187.127.155.227}"
GRAFANA_DOMAIN="${GRAFANA_DOMAIN:-grafana-desk.wabo.ai}"
PROMETHEUS_DOMAIN="${PROMETHEUS_DOMAIN:-prometheus-desk.wabo.ai}"
GCHAT_DIR="${GCHAT_DIR:-$HOME/gchat}"
DRY="${DESK_DEPLOY_DRYRUN:-0}"
CHECK_ONLY=0; YES=0; REF=""
for a in "$@"; do case "$a" in
  --check-only) CHECK_ONLY=1 ;; --yes) YES=1 ;; -h|--help) sed -n 2,8p "$0"; exit 0 ;;
  -*) echo "unknown option $a" >&2; exit 2 ;; *) REF="$a" ;; esac; done
REF="${REF:-origin/main}"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST")
RT="/opt/desk/.gchat-deploy-$$"   # temp dir for the webhook files on the host, removed right after use
COMPOSE='docker compose -f docker-compose.yml -f observability.compose.yml --env-file .env'

step() { printf '\n== %s\n' "$*"; }
stop() { echo "STOP: $*" >&2; exit 1; }
# rx: plain remote command (-n so ssh never eats stdin). rxs: remote command whose stdin is a pipe or heredoc.
rx() { if [ "$DRY" = 1 ]; then echo "[dryrun] ssh $HOST: $*"; else "${SSH[@]}" -n "$@"; fi; }
rxs() { if [ "$DRY" = 1 ]; then echo "[dryrun] ssh $HOST: $* (script on stdin, shown below; it holds no secrets)"; sed "s/^/    | /"; else "${SSH[@]}" "$@"; fi; }
# put <local dir> <remote dir> <files...>: tar over ssh
put() { local l="$1" r="$2"; shift 2
  if [ "$DRY" = 1 ]; then echo "[dryrun] copy to $HOST:$r : $*"; else tar -C "$l" -cf - "$@" | "${SSH[@]}" "mkdir -p $r && tar -xf - -C $r"; fi; }

STAGE="$(mktemp -d)"
RT_MADE=0
cleanup() { rm -rf "$STAGE"; if [ "$DRY" != 1 ] && [ "$RT_MADE" = 1 ]; then "${SSH[@]}" -n "rm -rf $RT" 2>/dev/null || true; fi; }
trap cleanup EXIT

step "0 preflight (ref $REF, host $HOST)"
git fetch -q origin 2>/dev/null || echo "warn: git fetch failed, using the local copy of $REF"
git rev-parse --verify -q "$REF^{commit}" >/dev/null || stop "git ref $REF not found"
echo "ref $REF = $(git rev-parse --short "$REF")"
PFX="$(git rev-parse --show-prefix)"
for d in deploy/hostinger deploy/observability tools/chat-bridge; do
  git -C "$(git rev-parse --show-toplevel)" archive "$REF" "${PFX}$d" | tar -x -C "$STAGE"
done
SRC="$STAGE/${PFX}"; SRC="${SRC%/}"
[ -d "$SRC/deploy/hostinger" ] || stop "$REF has no ${PFX}deploy/hostinger"
if [ "$DRY" = 1 ]; then echo "DNS check skipped (dry run): $GRAFANA_DOMAIN and $PROMETHEUS_DOMAIN must resolve to $HOST"
else
  bad=0
  for d in "$GRAFANA_DOMAIN" "$PROMETHEUS_DOMAIN"; do
    ip="$(getent ahostsv4 "$d" 2>/dev/null | awk 'NR==1{print $1}')"
    if [ "$ip" = "$HOST" ]; then echo "DNS ok: $d -> $ip"; else bad=1; echo "DNS wrong: $d -> ${ip:-nothing}"; fi
  done
  [ "$bad" = 0 ] || { printf 'Create these DNS A records, wait for them to resolve, then re-run:\n  %s  A  %s\n  %s  A  %s\n' "$GRAFANA_DOMAIN" "$HOST" "$PROMETHEUS_DOMAIN" "$HOST" >&2; exit 1; }
fi
for ch in critical slowquery deploy; do
  f="$GCHAT_DIR/${ch}_url"
  [ -s "$f" ] || stop "missing webhook file $f (create it with the $ch space webhook URL; there is no fallback)"
  [ "$(stat -c %a "$f")" = 600 ] || stop "$f must be mode 600 (chmod 600 $f)"
  case "$(head -c 33 "$f")" in https://chat.googleapis.com/*) ;; *) stop "$f must start with https://chat.googleapis.com/" ;; esac
  echo "webhook file ok: $f"
done
if [ "$DRY" = 1 ]; then echo "[dryrun] ssh $HOST: true (BatchMode check)"; else "${SSH[@]}" -n true || stop "ssh to $HOST with BatchMode failed (key in ~/.ssh/config?)"; fi
if [ "$CHECK_ONLY" = 1 ]; then
  echo; echo "check-only summary: ref $REF ok, DNS $([ "$DRY" = 1 ] && echo skipped || echo ok), 3 webhook files ok, ssh $([ "$DRY" = 1 ] && echo skipped || echo ok). Nothing was changed."; exit 0
fi

step "1 memory check"
if [ "$DRY" = 1 ]; then echo "[dryrun] ssh $HOST: free -m; docker ps -q | wc -l (require --yes or y when available < 1500 MB)"
else
  rx 'free -m; echo "containers running: $(docker ps -q | wc -l)"'
  avail="$("${SSH[@]}" -n "free -m | awk '/^Mem:/{print \$7}'")"
  if [ "${avail:-0}" -lt 1500 ] && [ "$YES" = 0 ]; then
    [ -t 0 ] || stop "only ${avail} MB available (< 1500); re-run with --yes to continue"
    read -rp "Only ${avail} MB available (< 1500). Continue? [y/N] " ans; [ "$ans" = y ] || stop "aborted by user"
  fi
fi

step "2 copy files"
TPL=$(cd "$SRC/deploy/hostinger" && ls traefik-*.yml.template)   # glob: every Traefik template
# shellcheck disable=SC2086
put "$SRC/deploy/hostinger" /opt/desk observability.compose.yml observability-up.sh stack-selfcheck.sh $TPL
put "$SRC/deploy/observability" /opt/observability .
put "$SRC/tools/chat-bridge" /opt/chat-bridge .
put "$SRC/deploy/hostinger" /opt/desk/release-watch-src desk-release-watch.sh deploy-message.py desk-release-watch.service install-release-watch.sh
rx 'chmod +x /opt/desk/observability-up.sh /opt/desk/stack-selfcheck.sh'
rx 'cd /opt/desk/release-watch-src && if [ "$(id -u)" = 0 ]; then DESK_DIR=/opt/desk bash install-release-watch.sh; else sudo -n env DESK_DIR=/opt/desk bash install-release-watch.sh; fi'

step "3 webhook secrets (temp dir $RT, removed after step 5)"
rx "umask 077; mkdir -p $RT"; RT_MADE=1
for ch in critical slowquery deploy; do
  if [ "$DRY" = 1 ]; then echo "[dryrun] ssh $HOST: cat > $RT/$ch.url (from $GCHAT_DIR/${ch}_url, content not shown)"
  else "${SSH[@]}" "umask 077; cat > $RT/$ch.url" < "$GCHAT_DIR/${ch}_url"; fi
done

step "4 read-only Postgres role (only if secrets/slow_query_pg_url is empty or missing)"
rxs bash -s <<'REMOTE'
set -euo pipefail
cd /opt/desk
if [ -s secrets/slow_query_pg_url ]; then echo "slow_query_pg_url already set: skipping role creation"; exit 0; fi
PW="$(openssl rand -hex 16)"
DB="$(docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'printf %s "$POSTGRES_DB"')"
# psql variables: pw keeps its quotes (the SQL uses %L); the REVOKE ... FROM PUBLIC line is dropped so the app role keeps working
{ printf "\\\\set pw '''%s'''\n" "$PW"; printf "\\\\set dbname '%s'\n" "$DB"; grep -v 'REVOKE ALL' /opt/chat-bridge/create-readonly-role.sql; } \
  | docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
docker compose -f docker-compose.yml --env-file .env exec -T postgres sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements"' \
  || echo "note: pg_stat_statements not available (needs shared_preload_libraries); the watcher still sees pg_stat_activity"
umask 022; mkdir -p secrets
printf 'postgres://slow_query_ro:%s@postgres:5432/%s' "$PW" "$DB" > secrets/slow_query_pg_url
chmod 644 secrets/slow_query_pg_url
echo "slow_query_ro created and secrets/slow_query_pg_url written (not shown)"
REMOTE

step "5 .env settings and observability-up.sh"
rxs bash -s <<REMOTE
set -euo pipefail
cd /opt/desk
cp -p .env .env.bak-predeploy
setv() { if grep -q "^\$1=" .env; then sed -i "s|^\$1=.*|\$1=\$2|" .env; else echo "\$1=\$2" >> .env; fi; }
setv GRAFANA_DOMAIN $GRAFANA_DOMAIN
setv PROMETHEUS_DOMAIN $PROMETHEUS_DOMAIN
setv CHAT_BRIDGE_DIR /opt/chat-bridge
printf 'gchat\n\n\n' | GCHAT_URL_DIR=$RT ./observability-up.sh
setv OBS_METRICS_PORT 0
echo "OBS_METRICS_PORT forced to 0 (app metrics stay off)"
rm -rf $RT
REMOTE
RT_MADE=0

step "6 pull and start"
rx "cd /opt/desk && $COMPOSE pull grafana gchat-bridge prometheus alertmanager probe"
rx "cd /opt/desk && $COMPOSE up -d grafana gchat-bridge prometheus alertmanager probe"

step "7 checks"
if [ "$DRY" = 1 ]; then
  echo "[dryrun] curl https://$GRAFANA_DOMAIN/api/health (expect 200); curl https://$PROMETHEUS_DOMAIN/-/healthy (expect 401, no login)"
else
  sleep 15
  g="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$GRAFANA_DOMAIN/api/health" || true)"
  p="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$PROMETHEUS_DOMAIN/-/healthy" || true)"
  echo "grafana health: $g (want 200); prometheus without login: $p (want 401)"
  { [ "$g" = 200 ] && [ "$p" = 401 ]; } || echo "WARN: https checks not as expected (the TLS certificate can take a minute after DNS)" >&2
fi
rx "cd /opt/desk && $COMPOSE ps"
rx 'free -m'
rx 'docker exec desk-gchat-bridge node -e "fetch(\"http://127.0.0.1:9095/health\").then(r=>r.text()).then(console.log)"'
rx 'systemctl is-active desk-release-watch'
cat <<EOT

Grafana     https://$GRAFANA_DOMAIN   user admin; password: ssh $HOST 'cat /opt/desk/secrets/grafana_admin_password'
Prometheus  https://$PROMETHEUS_DOMAIN   user prometheus; password: ssh $HOST 'cat /opt/desk/secrets/prometheus_basic_password'
(read the passwords yourself on the host; this script never prints them)
No test alert or message was sent.
ROLLBACK: ssh $HOST 'cd /opt/desk && cp -p .env.bak-predeploy .env && $COMPOSE stop grafana gchat-bridge prometheus alertmanager probe'
EOT
