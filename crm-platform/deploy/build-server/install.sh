#!/usr/bin/env bash
# Install or update the deploy pipeline on the BUILD server (idempotent; run as root from this folder).
#   CI_HOST=ci.<ip>.sslip.io PROD_HOST=<production ip> ./install.sh
# Creates the `deskci` user, the key pairs and the webhook secret (only if missing), installs the scripts and the systemd service,
# and publishes the webhook through Dokploy's Traefik. It prints the PUBLIC keys that still have to be registered
# (GitHub deploy key, production authorized_keys); it never prints a private key or the webhook secret.
set -euo pipefail
CI_HOST=${CI_HOST:?set CI_HOST, e.g. ci.72.61.225.38.sslip.io}
PROD_HOST=${PROD_HOST:?set PROD_HOST, the production server address}
HERE=$(cd "$(dirname "$0")" && pwd)
CONF=/etc/desk-ci; APP=/opt/desk-ci

id deskci >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP" --shell /usr/sbin/nologin deskci
usermod -aG docker deskci
install -d -o deskci -g deskci -m 755 "$APP" /var/lib/desk-ci /var/log/desk-ci
install -d -o root -g deskci -m 750 "$CONF"
install -m 755 -o root -g root "$HERE/webhook.py" "$HERE/deploy-main.sh" "$APP/"

genkey() { [ -f "$CONF/$1" ] || { ssh-keygen -q -t ed25519 -N '' -C "$2" -f "$CONF/$1"; }; chown root:deskci "$CONF/$1" "$CONF/$1.pub"; chmod 640 "$CONF/$1"; }
genkey github_deploy_key "desk-ci build server (GitHub read-only deploy key)"
genkey prod_deploy_key "desk-ci build server (production release key)"
[ -f "$CONF/webhook-secret" ] || ( umask 077; openssl rand -hex 32 > "$CONF/webhook-secret" )
chown root:deskci "$CONF/webhook-secret"; chmod 640 "$CONF/webhook-secret"

cat > "$CONF/ssh_config" <<EOC
Host github.com
  IdentityFile $CONF/github_deploy_key
  IdentitiesOnly yes
  UserKnownHostsFile $CONF/known_hosts
  StrictHostKeyChecking yes
Host desk
  HostName $PROD_HOST
  User root
  IdentityFile $CONF/prod_deploy_key
  IdentitiesOnly yes
  UserKnownHostsFile $CONF/known_hosts
  StrictHostKeyChecking yes
  ServerAliveInterval 30
EOC
chown root:deskci "$CONF/ssh_config"; chmod 640 "$CONF/ssh_config"
touch "$CONF/known_hosts"; chown root:deskci "$CONF/known_hosts"; chmod 664 "$CONF/known_hosts"

BRIDGE=$(ip -4 addr show docker0 | awk '/inet /{sub("/.*","",$2); print $2}')
sed -e "s/__CI_HOST__/$CI_HOST/" -e "s/__BRIDGE_IP__/$BRIDGE/" "$HERE/traefik-desk-ci.yml.template" > /etc/dokploy/traefik/dynamic/desk-ci.yml
printf 'DESK_CI_BIND=%s\n' "$BRIDGE" > "$CONF/webhook.env"
install -m 644 "$HERE/desk-ci-webhook.service" /etc/systemd/system/desk-ci-webhook.service
systemctl daemon-reload
systemctl enable --now desk-ci-webhook.service
systemctl restart desk-ci-webhook.service

echo; echo "== register these PUBLIC keys (once):"
echo "-- GitHub: repo Settings > Deploy keys, read-only:"; cat "$CONF/github_deploy_key.pub"
echo "-- production /root/.ssh/authorized_keys, as ONE line with the forced command:"
echo "restrict,command=\"/opt/desk/ci-entry.sh\" $(cat "$CONF/prod_deploy_key.pub")"
echo "-- known_hosts: add github.com and the production host key to $CONF/known_hosts (README.md, step 3)."
echo "-- webhook: https://$CI_HOST/hooks/github, secret in $CONF/webhook-secret (README.md, step 4)."
