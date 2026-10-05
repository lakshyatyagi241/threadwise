#!/usr/bin/env bash
# Prompts (hidden input) for the WhatsApp secrets, writes them to .env (mode 600) and restarts the API and worker.
# Press Enter to keep a value as it is. Run on the server:  cd /opt/desk && ./set-secrets.sh
set -euo pipefail
cd "$(dirname "$0")"
for key in META_APP_SECRET INTERAKT_PARTNER_AUTH_KEY META_SYSTEM_USER_TOKEN; do
  read -rsp "$key (hidden, Enter to keep): " val; echo
  [ -z "$val" ] && continue
  grep -q "^$key=" .env || echo "$key=" >> .env
  KEY="$key" VAL="$val" python3 - <<'PY'
import os,re
k,v=os.environ['KEY'],os.environ['VAL']
s=open('.env').read()
s=re.sub(rf'^{k}=.*$', lambda m: f'{k}={v}', s, flags=re.M)
open('.env','w').write(s)
PY
done
chmod 600 .env
docker compose --env-file .env up -d api worker
sleep 25
docker compose --env-file .env exec -T api node -e "fetch('http://127.0.0.1:3000/ready').then(r=>{console.log('api ready',r.status);process.exit(0)})"
