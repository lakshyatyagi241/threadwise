#!/usr/bin/env bash
# Post a Google Chat message to the Deployments space. Usage: notify-chat.sh <started|succeeded|failed|skipped> <sha> [duration-seconds] [note]   (optional env DESK_CI_PREV_SHA = the previously live sha)
# Best effort by design: always exits 0, never prints or logs the webhook URL, gives up after 5 s. The URL is read from
# $DESK_CI_GCHAT_URL_FILE (default /etc/desk-ci/gchat_deploy_url); a missing or empty file means "not configured" and is silent.
URL_FILE=${DESK_CI_GCHAT_URL_FILE:-/etc/desk-ci/gchat_deploy_url}
LOGS=${DESK_CI_LOGS:-/var/log/desk-ci}
WEB=${DESK_CI_COMMIT_URL_BASE:-https://github.com/lakshyatyagi241/threadwise/commit}
ev=${1:-}; sha=${2:-}; dur=${3:-}; note=${4:-}
{
  [ -s "$URL_FILE" ] || exit 0
  url=$(head -n1 "$URL_FILE" | tr -d '\r\n ')
  [ -n "$url" ] || exit 0
  repo=${DESK_CI_DIR:-/opt/desk-ci}/repo
  # Standard message (PR, commit, author, who deployed) from the shared formatter; falls back to a plain line if it is missing or fails.
  fmt=${DESK_CI_FORMATTER:-$repo/crm-platform/deploy/hostinger/deploy-message.py}
  [ -r "$fmt" ] || fmt=$(dirname "${BASH_SOURCE[0]}")/deploy-message.py
  export DEPLOY_MSG_TOKEN_FILE=${DEPLOY_MSG_TOKEN_FILE:-/etc/desk-ci/github_read_token}
  text=$(python3 "$fmt" "$ev" "${DESK_CI_PREV_SHA:-}" "$sha" "$dur" "$note" 2>/dev/null) || text=""
  [ -n "$text" ] || text="Release $ev: ${sha:0:9} $WEB/$sha (PR details unavailable)"
  body=$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1]}))' "$text")
  # -K reads the URL from stdin-config so it never appears in a process list; --silent hides curl's own error text (which would echo it)
  code=$(printf 'url = "%s"\n' "$url" | curl -sS -K - --max-time 5 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "$body" 2>/dev/null)
  case "$code" in 2??) ;; *) echo "$(date -Is) chat notify '$ev' for $sha not delivered (http ${code:-none})" >> "$LOGS/webhook.log" 2>/dev/null ;; esac
} 2>/dev/null
exit 0
