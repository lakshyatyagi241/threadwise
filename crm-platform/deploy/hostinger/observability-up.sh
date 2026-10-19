#!/usr/bin/env bash
# Turns on event-loop metrics, alerting and the caller-side probe next to the app (docs/performance/event-loop).
# Run on the server:  cd /opt/desk && ./observability-up.sh
#
# What it does, in order:
#   1. makes OBS_METRICS_TOKEN in .env if there is none (random, 48 hex characters), sets OBS_METRICS_PORT=9464 and writes the token to
#      secrets/obs_metrics_token
#   2. asks where alerts go (webhook, Slack/Discord, PagerDuty) and the URL or key (hidden; Enter keeps the current one), writes
#      secrets/alert_webhook_url and ALERTMANAGER_FILE to .env
#   3. pulls the two public images and starts prometheus, alertmanager and the probe
# It does NOT restart the app. Releases are blue-green (ci-entry.sh): the API, web and worker containers read OBS_METRICS_PORT and
# OBS_METRICS_TOKEN from .env when they are CREATED, so the next release (which creates the idle slot and recreates the worker) starts
# serving /metrics, and Prometheus finds them as they appear. Until then the targets are simply absent, not down. To not wait for a
# release: out of hours, `docker compose --env-file .env up -d --no-deps <live slot containers>` recreates them, with the brief loss of
# that slot's connections a restart always has; the worker waits for its running jobs (60 s grace).
# The secret files live in a mode 700 directory (see the note at the chmod). Nothing here publishes a port.
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE=(docker compose -f docker-compose.yml -f observability.compose.yml --env-file .env)

[ -f .env ] || { echo "no .env here: run this next to docker-compose.yml on the server" >&2; exit 1; }

# The base docker-compose.yml passes this to every app container; 0 (the default) keeps /metrics off.
if grep -q '^OBS_METRICS_PORT=' .env; then sed -i 's/^OBS_METRICS_PORT=.*/OBS_METRICS_PORT=9464/' .env; else echo 'OBS_METRICS_PORT=9464' >> .env; fi

# The probe also times the PUBLIC address (through Traefik), so ingress queueing shows. DOMAIN is in .env already (docker-compose.yml needs it).
if ! grep -q '^PROBE_EXTRA_TARGETS=' .env; then
  domain="$(sed -n 's/^DOMAIN=//p' .env | head -n1)"
  if [ -n "$domain" ]; then
    echo "PROBE_EXTRA_TARGETS=public_health=https://${domain}/health,public_web=https://${domain}/login" >> .env
  fi
fi

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

# Where alerts go decides which Alertmanager file is mounted: a generic webhook (Alertmanager's own JSON), Slack (Discord too: append
# /slack to its webhook URL) or PagerDuty (the secret is then the Events API v2 integration key, not a URL).
current_file="$(grep '^ALERTMANAGER_FILE=' .env | head -n1 | cut -d= -f2- || true)"
case "${current_file:-alertmanager.yml}" in alertmanager.slack.yml) current_kind=slack ;; alertmanager.pagerduty.yml) current_kind=pagerduty ;; *) current_kind=webhook ;; esac
read -rp "Destination type: webhook, slack (also Discord) or pagerduty [$current_kind]: " kind
kind="${kind:-$current_kind}"
case "$kind" in
  webhook) file=alertmanager.yml ;;
  slack) file=alertmanager.slack.yml ;;
  pagerduty) file=alertmanager.pagerduty.yml ;;
  *) echo "that is not one of webhook, slack, pagerduty" >&2; exit 1 ;;
esac
if grep -q '^ALERTMANAGER_FILE=' .env; then sed -i "s/^ALERTMANAGER_FILE=.*/ALERTMANAGER_FILE=$file/" .env; else echo "ALERTMANAGER_FILE=$file" >> .env; fi
if [ "$kind" = pagerduty ]; then prompt="PagerDuty Events API v2 integration key"; else prompt="Alert destination URL"; fi
if [ -s secrets/alert_webhook_url ]; then
  read -rsp "$prompt (hidden, Enter to keep the current one): " url; echo
else
  read -rsp "$prompt (hidden): " url; echo
fi
if [ -n "${url:-}" ]; then
  if [ "$kind" = pagerduty ]; then
    case "$url" in *[!A-Za-z0-9]*|"") echo "that does not look like an integration key (letters and digits only)" >&2; exit 1 ;; esac
  else
    case "$url" in https://*|http://*) ;; *) echo "that is not an http(s) URL" >&2; exit 1 ;; esac
  fi
  printf '%s' "$url" > secrets/alert_webhook_url
fi
[ -s secrets/alert_webhook_url ] || { echo "no alert destination set: alerts would go nowhere" >&2; exit 1; }
# 644 on purpose: a file-based compose secret is a bind mount that keeps the host file's mode, and prometheus and alertmanager run as
# `nobody`, so a 600 file would be unreadable inside the container. The directory is 700, so other users on the host cannot reach them.
chmod 644 secrets/*

"${COMPOSE[@]}" pull prometheus alertmanager
"${COMPOSE[@]}" up -d prometheus alertmanager probe
sleep 20
echo "targets (api, worker and web appear once the next release has created containers with the metrics settings):"
"${COMPOSE[@]}" exec -T prometheus wget -qO- http://localhost:9090/api/v1/targets | python3 -c "import sys,json; [print(' ', t['labels']['job'], t['health']) for t in json.load(sys.stdin)['data']['activeTargets']]"
