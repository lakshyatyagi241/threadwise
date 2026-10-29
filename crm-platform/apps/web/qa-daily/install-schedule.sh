#!/usr/bin/env bash
# Installs the daily run as a cron entry on THIS machine (it needs Claude Code logged in, git+gh authenticated, Docker for the local proof stack).
#   qa-daily/install-schedule.sh [HH:MM]      default 03:00 (machine time; IST machines: 03:00 IST)
set -euo pipefail
cd "$(dirname "$0")"
T="${1:-03:00}"; H="${T%%:*}"; M="${T##*:}"
ENVF="$HOME/.config/wadesk-qa/env"
if [ ! -f "$ENVF" ]; then
  mkdir -p "$(dirname "$ENVF")"
  cat > "$ENVF" <<'ENV'
# Fill these in; this file is read by qa-daily/run-scheduled.sh and never committed. chmod 600.
export QA_SHEET_URL=''          # Apps Script /exec URL (qa-daily/README.md)
export QA_SHEET_TOKEN=''
export QA_EMAIL=''              # dedicated QA workspace admin on desk.wabo.ai
export QA_PASSWORD=''
export QA_ORG=''                # that workspace's org slug
export QA_OP_EMAIL=''           # platform operator for /admin
export QA_OP_PASSWORD=''
export AUTOFIX_MAX=3            # bugs fixed per day
export AUTOMERGE=0              # 1 = merge verified fixes by themselves (small, not in protected paths, gate green)
ENV
  chmod 600 "$ENVF"; echo "wrote $ENVF: fill it in, then run this again"; exit 0
fi
LINE="$M $H * * * bash $PWD/run-scheduled.sh"
( crontab -l 2>/dev/null | grep -v run-scheduled.sh; echo "$LINE" ) | crontab -
echo "installed: $LINE"
