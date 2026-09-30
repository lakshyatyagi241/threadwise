#!/usr/bin/env bash
# Report whether the Reference reference app is up.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_env.sh"
if listening; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" || true)"
  echo "listening on :$PORT, GET / -> $code, ref=$REF, log=$LOGFILE"
else
  echo "not running (port $PORT free), ref=$REF"; exit 1
fi
