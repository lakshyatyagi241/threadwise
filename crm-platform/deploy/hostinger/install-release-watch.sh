#!/usr/bin/env bash
# Idempotent install of the release watcher on the production host. Run as root from the repo checkout:
#   sudo bash deploy/hostinger/install-release-watch.sh
# Copies script + formatter + unit, reloads systemd, enables and (re)starts the service. Prints no secrets.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEST=${DESK_DIR:-/opt/desk}
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
install -m 755 "$HERE/desk-release-watch.sh" "$DEST/desk-release-watch.sh"
install -m 644 "$HERE/deploy-message.py" "$DEST/deploy-message.py"
install -m 644 "$HERE/desk-release-watch.service" /etc/systemd/system/desk-release-watch.service
install -d -m 750 /var/lib/desk-release-watch
[ -s "$DEST/secrets/github_read_token" ] && echo "github token file: present" || echo "github token file: MISSING (messages will say 'PR details unavailable'); see docs/runbooks/deployment-messages.md"
systemctl daemon-reload
systemctl enable --now desk-release-watch.service
systemctl restart desk-release-watch.service
systemctl is-active desk-release-watch.service
