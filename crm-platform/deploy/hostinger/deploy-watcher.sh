#!/usr/bin/env bash
# Install the release watcher (desk-release-watch.sh, deploy-message.py, the service) on production from THIS checkout, and let it announce the change
# in the Deployments space by itself: the commit that last changed deploy/hostinger is written next to the sources and the running watcher reads it.
#   SERVER=root@187.127.155.227 SSH_KEY=~/.ssh/threadwise_deploy bash deploy/hostinger/deploy-watcher.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
SERVER=${SERVER:-root@187.127.155.227}
SSH_OPTS=(-o BatchMode=yes -o IdentitiesOnly=yes ${SSH_KEY:+-i "$SSH_KEY"})
H=deploy/hostinger
scp "${SSH_OPTS[@]}" -q $H/desk-release-watch.sh $H/deploy-message.py $H/desk-release-watch.service $H/install-release-watch.sh "$SERVER:/opt/desk/release-watch-src/"
printf '%s' "$(git log -1 --format=%H -- $H)" | ssh "${SSH_OPTS[@]}" "$SERVER" 'cat > /opt/desk/release-watch-src/.version'
ssh "${SSH_OPTS[@]}" "$SERVER" 'cd /opt/desk/release-watch-src && bash install-release-watch.sh 2>&1 | tail -2'
echo "Watcher installed; the new watcher announces its own change in the Deployments space within about 30 s of starting."
