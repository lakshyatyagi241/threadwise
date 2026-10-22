#!/usr/bin/env bash
# Proves the /incidents route with a throwaway Traefik v3 (host network, random port, no TLS, local backends only; nothing remote):
# /incidents needs basicAuth AND X-Incident-Token; /api/v1 on the same host still reaches (a stand-in for) Prometheus with ITS own auth.
# Backends: the REAL bridge (tools/chat-bridge) and a one-line fake Prometheus. Exit 0 = all assertions held.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; T="$ROOT/deploy/hostinger"
W="$(mktemp -d)"; P=$(shuf -i 40000-49000 -n1); BP=$((P+1)); PP=$((P+2)); N="traefik-proof-$RANDOM"; HOST=prom.test; FAIL=0
cleanup() { [ -n "${KEEP:-}" ] && { cat "$W"/dyn/*.yml; docker logs $N 2>&1 | tail -8; }; docker rm -f $N >/dev/null 2>&1; kill $B1 $B2 2>/dev/null; rm -rf "$W"; }
trap cleanup EXIT
chk() { if [ "$2" = "$3" ]; then echo "ok   $1 ($2)"; else echo "FAIL $1: got $2 want $3"; FAIL=1; fi; }
IP=incp$RANDOM; PPW=promp$RANDOM; TOK=tok$RANDOM$RANDOM
render() { awk -v d="$HOST" -v u="$2" -v b="$3" '/^  middlewares:/{skip=0} /^    prometheus-http:/{skip=1} skip{next} /tls:|certResolver/{next} {gsub(/__PROMETHEUS_DOMAIN__/,d); gsub(/\[websecure\]/,"[web]"); gsub(/desk-prometheus:9090/,"127.0.0.1:" b); gsub(/desk-gchat-bridge:9095/,"127.0.0.1:" b); if ($0 ~ /__(PROMETHEUS|INCIDENTS)_USERS__/) sub(/__(PROMETHEUS|INCIDENTS)_USERS__/, "\"" u "\""); print}' "$1"; }
mkdir -p "$W/dyn"
render "$T/traefik-prometheus.yml.template" "prometheus:$(openssl passwd -apr1 $PPW)" $PP > "$W/dyn/prometheus.yml"
render "$T/traefik-incidents.yml.template" "incidents:$(openssl passwd -apr1 $IP)" $BP > "$W/dyn/incidents.yml"
( cd "$ROOT/tools/chat-bridge" && PORT=$BP INCIDENT_API_TOKEN=$TOK AUTO_REMEDIATE=dry-run node --input-type=module -e "
import { startBridge } from './bridge.mjs'; import { createResolver } from './resolver.mjs';
let r; const b = startBridge({ urls: {}, log: () => {}, resolverFactory: () => (r = createResolver({ env: { AUTO_REMEDIATE: 'dry-run', INCIDENT_API_TOKEN: process.env.INCIDENT_API_TOKEN }, post: async () => {} })) });
await r.handle({ playbook: 'code_fix', key: 'k', threadKey: 't', channel: 'slowquery', file: {}, diagnosis: 'd' }); b.server.listen($BP, '127.0.0.1');" ) & B1=$!
node -e "require('http').createServer((q,s)=>s.end('PROMETHEUS')).listen($PP,'127.0.0.1')" & B2=$!
docker run -d --name $N --network host -v "$W/dyn:/dyn:ro" traefik:v3.1 --entrypoints.web.address=127.0.0.1:$P --providers.file.directory=/dyn --log.level=${TLOG:-ERROR} >/dev/null || exit 2
for i in $(seq 40); do [ "$(curl -s -o /dev/null -w %{http_code} -H "Host: $HOST" http://127.0.0.1:$P/api/v1/x)" = 401 ] && break; sleep 0.5; done
c() { curl -s -o "$W/body" -w '%{http_code}' -H "Host: $HOST" "$@"; }
chk "/incidents no auth" "$(c http://127.0.0.1:$P/incidents)" 401
chk "/incidents basic auth only (no token)" "$(c -u incidents:$IP http://127.0.0.1:$P/incidents)" 401
chk "/incidents token only (no basic auth)" "$(c -H "X-Incident-Token: $TOK" http://127.0.0.1:$P/incidents)" 401
chk "/incidents wrong basic password" "$(c -u incidents:bad -H "X-Incident-Token: $TOK" http://127.0.0.1:$P/incidents)" 401
chk "/incidents both ok" "$(c -u incidents:$IP -H "X-Incident-Token: $TOK" http://127.0.0.1:$P/incidents)" 200
grep -q '"status":"open"' "$W/body" && echo "ok   body is the real bridge list" || { echo "FAIL body"; FAIL=1; }
chk "/incidents with the PROMETHEUS credentials" "$(c -u prometheus:$PPW -H "X-Incident-Token: $TOK" http://127.0.0.1:$P/incidents)" 401
chk "/api/v1 no auth" "$(c http://127.0.0.1:$P/api/v1/query)" 401
chk "/api/v1 with the INCIDENTS credentials" "$(c -u incidents:$IP http://127.0.0.1:$P/api/v1/query)" 401
chk "/api/v1 prometheus basic auth" "$(c -u prometheus:$PPW http://127.0.0.1:$P/api/v1/query)" 200
grep -q PROMETHEUS "$W/body" && echo "ok   /api/v1 reached Prometheus" || { echo "FAIL /api/v1 body"; FAIL=1; }
chk "/release is not routed to the bridge" "$(c -u incidents:$IP -X POST http://127.0.0.1:$P/release)" 401
exit $FAIL
