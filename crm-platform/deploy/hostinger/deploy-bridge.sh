#!/usr/bin/env bash
# Ship the Chat alert bridge (tools/chat-bridge) from THIS checkout to production and restart it. The release watcher on the server announces the
# new version in the Deployments space by itself (with the PR template), because this script writes the commit to /opt/chat-bridge/.version.
# The bridge is not part of the app release pipeline (ship.sh / the build server), so without this its updates are silent.
#   SERVER=root@187.127.155.227 SSH_KEY=~/.ssh/threadwise_deploy bash deploy/hostinger/deploy-bridge.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SERVER=${SERVER:-root@187.127.155.227}
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes ${SSH_KEY:+-i "$SSH_KEY"})
run() { ssh "${SSH_OPTS[@]}" "$SERVER" "$@"; }
SHA=$(git rev-parse HEAD)
tar -c --exclude='*.test.mjs' -C tools/chat-bridge . | run 'tar -x -C /opt/chat-bridge'
printf '%s' "$SHA" | run 'cat > /opt/chat-bridge/.version'   # the release watcher announces the change from this file
run 'docker restart desk-gchat-bridge >/dev/null'
for i in $(seq 1 12); do
  [ "$(run 'docker inspect -f "{{.State.Health.Status}}" desk-gchat-bridge' 2>/dev/null)" = healthy ] && break
  sleep 5
done
[ "$(run 'docker inspect -f "{{.State.Health.Status}}" desk-gchat-bridge')" = healthy ] || { echo "bridge is not healthy after the restart" >&2; exit 1; }
echo "Bridge ${SHA:0:9} shipped. The release watcher announces it in the Deployments space within about 30 s."
