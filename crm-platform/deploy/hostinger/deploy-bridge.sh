#!/usr/bin/env bash
# Ship the Chat alert bridge (tools/chat-bridge) from THIS checkout to production, restart it, and announce it in the Deployments space.
# The bridge is not part of the app release pipeline (ship.sh / the build server), so without this its updates are silent.
#   SERVER=root@187.127.155.227 SSH_KEY=~/.ssh/threadwise_deploy bash deploy/hostinger/deploy-bridge.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SERVER=${SERVER:-root@187.127.155.227}
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes ${SSH_KEY:+-i "$SSH_KEY"})
run() { ssh "${SSH_OPTS[@]}" "$SERVER" "$@"; }
SHA=$(git rev-parse --short=9 HEAD); SUBJ=$(git log -1 --format=%s | cut -c1-120)
tar -c --exclude='*.test.mjs' -C tools/chat-bridge . | run 'tar -x -C /opt/chat-bridge && docker restart desk-gchat-bridge >/dev/null'
for i in $(seq 1 12); do
  [ "$(run 'docker inspect -f "{{.State.Health.Status}}" desk-gchat-bridge' 2>/dev/null)" = healthy ] && break
  sleep 5
done
[ "$(run 'docker inspect -f "{{.State.Health.Status}}" desk-gchat-bridge')" = healthy ] || { echo "bridge is not healthy after the restart" >&2; exit 1; }
printf '%s' "$(printf '🔧 *Chat alert bridge updated*\nVersion: `%s` https://github.com/lakshyatyagi241/threadwise/commit/%s\n%s\nThe alert bridge was restarted; open incidents held in its memory were cleared. %s' "$SHA" "$SHA" "$SUBJ" "$(date -u '+%Y-%m-%d %H:%M UTC')")" | run '/opt/desk/desk-release-watch.sh --announce'
echo "Bridge $SHA shipped and announced."
