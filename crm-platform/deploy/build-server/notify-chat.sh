#!/usr/bin/env bash
# Post a Google Chat card to the Deployments space. Usage: notify-chat.sh <started|succeeded|failed|skipped> <sha> [duration-seconds] [note]
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
  subject=$(git -C "$repo" log -1 --format=%s "$sha" 2>/dev/null); author=$(git -C "$repo" log -1 --format=%an "$sha" 2>/dev/null)
  body=$(EV="$ev" SHA="$sha" DUR="$dur" NOTE="$note" SUBJ="$subject" AUTH="$author" WEB="$WEB" python3 - <<'PY'
import json, os
e = os.environ
title = {"started": "Release started", "succeeded": "Release succeeded", "failed": "Release failed or rolled back", "skipped": "Release skipped"}.get(e["EV"], "Release " + e["EV"])
sha = e["SHA"][:9]
rows = [("Commit", sha), ("Subject", e["SUBJ"] or "unknown"), ("Author", e["AUTH"] or "unknown")]
if e["DUR"]: rows.append(("Duration", e["DUR"] + " s"))
if e["NOTE"]: rows.append(("Note", e["NOTE"]))
text = "<br>".join("<b>%s</b>: %s" % (k, v.replace("<", "&lt;")) for k, v in rows)
print(json.dumps({"cardsV2": [{"cardId": "release-" + sha, "card": {
  "header": {"title": title, "subtitle": "desk production"},
  "sections": [{"widgets": [{"textParagraph": {"text": text}},
    {"buttonList": {"buttons": [{"text": "Open commit", "onClick": {"openLink": {"url": e["WEB"] + "/" + e["SHA"]}}}]}}]}]}}]}))
PY
)
  # -K reads the URL from stdin-config so it never appears in a process list; --silent hides curl's own error text (which would echo it)
  code=$(printf 'url = "%s"\n' "$url" | curl -sS -K - --max-time 5 -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d "$body" 2>/dev/null)
  case "$code" in 2??) ;; *) echo "$(date -Is) chat notify '$ev' for $sha not delivered (http ${code:-none})" >> "$LOGS/webhook.log" 2>/dev/null ;; esac
} 2>/dev/null
exit 0
