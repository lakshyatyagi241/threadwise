#!/usr/bin/env bash
# Turns on event-loop metrics, alerting and the caller-side probe next to the app (docs/performance/event-loop).
# Run on the server:  cd /opt/desk && ./observability-up.sh
#
# What it does, in order:
#   1. makes OBS_METRICS_TOKEN in .env if there is none (random, 48 hex characters) and writes it to secrets/obs_metrics_token
#   2. asks for the URL alerts are sent to (hidden input; Enter keeps the current one) and writes secrets/alert_webhook_url
#   3. pulls the two public images and starts api, worker, probe, prometheus and alertmanager
# It restarts api, worker and web (they pick up the token and the port), so run it in a quiet minute, like set-secrets.sh.
# The secret files live in a mode 700 directory (see the note at the chmod). Nothing here publishes a port.
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE=(docker compose -f docker-compose.yml -f observability.compose.yml --env-file .env)

[ -f .env ] || { echo "no .env here: run this next to docker-compose.yml on the server" >&2; exit 1; }

if ! grep -q '^OBS_METRICS_TOKEN=.\+' .env; then
  token="$(openssl rand -hex 24)"
  grep -q '^OBS_METRICS_TOKEN=' .env && sed -i "s/^OBS_METRICS_TOKEN=.*/OBS_METRICS_TOKEN=$token/" .env || echo "OBS_METRICS_TOKEN=$token" >> .env
  chmod 600 .env
  echo "made OBS_METRICS_TOKEN"
fi

umask 077
mkdir -p secrets
chmod 700 secrets
# printf, not echo: the token file must hold the token and nothing else, no newline.
printf '%s' "$(grep '^OBS_METRICS_TOKEN=' .env | head -n1 | cut -d= -f2-)" > secrets/obs_metrics_token

if [ -s secrets/alert_webhook_url ]; then
  read -rsp "Alert destination URL (hidden, Enter to keep the current one): " url; echo
else
  read -rsp "Alert destination URL (hidden; a webhook that accepts Alertmanager's JSON, see deploy/observability/alertmanager.yml): " url; echo
fi
if [ -n "${url:-}" ]; then
  case "$url" in https://*|http://*) ;; *) echo "that is not an http(s) URL" >&2; exit 1 ;; esac
  printf '%s' "$url" > secrets/alert_webhook_url
fi
[ -s secrets/alert_webhook_url ] || { echo "no alert destination set: alerts would go nowhere" >&2; exit 1; }
# 644 on purpose: a file-based compose secret is a bind mount that keeps the host file's mode, and prometheus and alertmanager run as
# `nobody`, so a 600 file would be unreadable inside the container. The directory is 700, so other users on the host cannot reach them.
chmod 644 secrets/*

"${COMPOSE[@]}" pull prometheus alertmanager
"${COMPOSE[@]}" up -d api worker probe prometheus alertmanager
sleep 20
echo "targets:"
"${COMPOSE[@]}" exec -T prometheus wget -qO- http://localhost:9090/api/v1/targets | python3 -c "import sys,json; [print(' ', t['labels']['job'], t['health']) for t in json.load(sys.stdin)['data']['activeTargets']]"
