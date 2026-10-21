#!/usr/bin/env bash
# Monitoring stack end to end: private Prometheus + Grafana, real API/worker/probe, traffic, then assertions. See README.md.
# Usage: run.sh [--quick|--full] [--out DIR] [--keep-up]    Exit 0 PASS, 1 FAIL, 2 ERROR.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../_lib/common.sh"
st_init monitoring-dashboards "Monitoring stack: Prometheus, rules and every Grafana panel"
KEEP=0; ARGS=(); for a in "$@"; do [ "$a" = --keep-up ] && KEEP=1 || ARGS+=("$a"); done
st_help() { echo "Boots API+worker+probe, private Prometheus v2.55.0 and Grafana 11.3.0, sends traffic, checks targets, rules and every dashboard panel. Needs docker, node 22, pnpm, shared postgres+redis. ~6 min quick, ~10 full. Options: --quick --full --out DIR --keep-up"; }
st_parse_args "${ARGS[@]+"${ARGS[@]}"}"

API_PORT=${MON_API_PORT:-3933}; M_API=${MON_METRICS_PORT:-59533}; M_WORKER=$((M_API+100)); M_PROBE=$((M_API+200))   # 59534 is held by another process on the dev box, so not +1
PROM_PORT=${MON_PROM_PORT:-59193}; GRAF_PORT=${MON_GRAFANA_PORT:-53193}; REDIS_HOST_PORT=${MON_REDIS_PORT:-56379}; REDIS_DB=7
SUF="$$"; NET="stmon-$SUF"; PROM_C="stmon-prom-$SUF"; GRAF_C="stmon-graf-$SUF"
WORK="$OUT/work"; mkdir -p "$WORK" "$OUT/screenshots"
PROM="http://localhost:$PROM_PORT"; GRAF="http://localhost:$GRAF_PORT"
if [ "$MODE" = quick ]; then ROUNDS=4; WAIT=45; else ROUNDS=12; WAIT=90; fi

for p in $API_PORT $M_API $M_WORKER $M_PROBE $PROM_PORT $GRAF_PORT; do st_need "port:$p"; done
st_need docker; st_need node22; st_need pnpm
for c in crm-platform-postgres crm-platform-redis; do docker ps --format '{{.Names}}' | grep -qx "$c" || st_error "shared container $c is not running (docker compose up -d postgres redis)"; done
[ -f "$ST_ROOT/.env" ] || st_error "crm-platform/.env missing (cp it from the main checkout)"
cd "$ST_ROOT"
[ -f apps/api/dist/src/main.js ] && [ -f apps/api/dist/src/tools/event-loop-probe.js ] || { echo "building api"; pnpm --filter @crm/api build >"$OUT/logs/build.log" 2>&1 || st_error "pnpm --filter @crm/api build failed (logs/build.log)"; }

TOKEN=$(node -p 'require("crypto").randomBytes(24).toString("hex")'); echo -n "$TOKEN" >"$WORK/token"; chmod 644 "$WORK/token"
PIDS=()
cleanup_stack() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; docker rm -f "$PROM_C" "$GRAF_C" >/dev/null 2>&1; docker network rm "$NET" >/dev/null 2>&1; true; }
[ "$KEEP" = 1 ] || st_cleanup_add cleanup_stack

# --- Prometheus config: the repo file, only the scrape targets point at the host; rules mounted read-only
mkdir -p "$WORK/prom"
cp deploy/observability/*.rules.yml "$WORK/prom/"
python3 - "$WORK/prom/prometheus.yml" "$M_API" "$M_WORKER" "$M_PROBE" <<'PY'
import re, sys
out, api, worker, probe = sys.argv[1:]
s = open('deploy/observability/prometheus.yml').read()
head = s.split('scrape_configs:')[0].replace('scrape_interval: 15s', 'scrape_interval: 5s').replace('evaluation_interval: 15s', 'evaluation_interval: 5s')
head = re.sub(r'alerting:.*?\n\n', '', head, flags=re.S)  # no Alertmanager in this stack
job = lambda n, p: f"""  - job_name: {n}
    metrics_path: /metrics
    authorization:
      type: Bearer
      credentials_file: /run/secrets/obs_metrics_token
    static_configs:
      - targets: ['host.docker.internal:{p}']
"""
open(out, 'w').write(head + 'scrape_configs:\n' + job('crm-api', api) + job('crm-worker', worker) + job('crm-probe', probe))
PY
docker network create "$NET" >/dev/null
docker run -d --name "$PROM_C" --network "$NET" --network-alias prometheus --add-host host.docker.internal:host-gateway -p "$PROM_PORT:9090" \
  -v "$WORK/prom:/etc/prometheus:ro" -v "$WORK/token:/run/secrets/obs_metrics_token:ro" prom/prometheus:v2.55.0 \
  --config.file=/etc/prometheus/prometheus.yml --storage.tsdb.path=/prometheus --storage.tsdb.retention.time=1h >"$OUT/logs/prom-container.log" 2>&1 || st_error "could not start Prometheus (image pull?)"
docker run -d --name "$GRAF_C" --network "$NET" -p "$GRAF_PORT:3000" \
  -e GF_AUTH_ANONYMOUS_ENABLED=true -e GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer -e GF_SECURITY_ADMIN_PASSWORD="$TOKEN" -e GF_ANALYTICS_REPORTING_ENABLED=false \
  -v "$ST_ROOT/deploy/observability/grafana/provisioning:/etc/grafana/provisioning:ro" \
  -v "$ST_ROOT/deploy/observability/grafana/dashboards:/var/lib/grafana/dashboards:ro" grafana/grafana-oss:11.3.0 >"$OUT/logs/graf-container.log" 2>&1 || st_error "could not start Grafana"

# --- the real processes (shared postgres; redis db index 7)
while IFS= read -r l; do [[ $l =~ ^[A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*$ ]] && export "$l"; done < .env || true   # .env is not always shell-safe, so only plain KEY=VALUE lines
export NODE_ENV=development LOG_LEVEL=info PORT=$API_PORT APP_URL="http://localhost:$API_PORT" REDIS_URL="redis://localhost:$REDIS_HOST_PORT/$REDIS_DB" \
  OBS_METRICS_HOST=0.0.0.0 OBS_METRICS_TOKEN="$TOKEN" OBS_RUNTIME_INTERVAL_SECONDS=5 OBS_RELEASE=monitoring-check
(cd apps/api; OBS_METRICS_PORT=$M_API setsid node dist/src/main.js >"$OUT/logs/api.log" 2>&1 & echo $! >"$WORK/api.pid")
(cd apps/api; OBS_METRICS_PORT=$M_WORKER WORKER_MODE=true setsid node dist/src/worker.js >"$OUT/logs/worker.log" 2>&1 & echo $! >"$WORK/worker.pid")
(cd apps/api; OBS_METRICS_PORT=$M_PROBE PROBE_INTERVAL_SECONDS=5 PROBE_TARGETS="health=http://localhost:$API_PORT/health" setsid node dist/src/tools/event-loop-probe.js >"$OUT/logs/probe.log" 2>&1 & echo $! >"$WORK/probe.pid")
sleep 1; for n in api worker probe; do PIDS+=("$(cat "$WORK/$n.pid")"); done

wait_for() { local i; for ((i=0;i<${2:-90};i++)); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done; return 1; }
wait_for "http://localhost:$API_PORT/health" 120 || { tail -20 "$OUT/logs/api.log" >&2; st_error "API did not become healthy (logs/api.log)"; }
for ((i=0;i<150;i++)); do curl -fsS -m 2 -o /dev/null -H "authorization: Bearer $TOKEN" "http://localhost:$M_WORKER/metrics" 2>/dev/null && break; sleep 1; done   # the worker boots slower than the API; jobs sent before it runs would never be counted
wait_for "$PROM/-/ready" 60 || st_error "Prometheus not ready"
wait_for "$GRAF/api/health" 90 || st_error "Grafana not ready"

# --- traffic: 2xx, 4xx, 401, 404, socket.io connects, queue jobs
echo "traffic ($ROUNDS rounds)"
cat >"$WORK/traffic.cjs" <<'JS'
const { io } = require('socket.io-client'); const { Queue } = require('bullmq');
const [api, rport, rdb, rounds] = process.argv.slice(2);
(async () => {
  const q = new Queue('tpl-sweep', { connection: { host: 'localhost', port: +rport, db: +rdb, maxRetriesPerRequest: null } });
  for (let i = 0; i < +rounds; i++) {
    for (const [m, p, b] of [['GET', '/health'], ['GET', '/ready'], ['GET', '/does-not-exist'], ['GET', '/api/v1/contacts'], ['POST', '/api/v1/auth/login', '{"email":"x","password":"y"}'], ['POST', '/api/v1/auth/login', '{}']])
      await fetch(api + p, { method: m, headers: { 'content-type': 'application/json' }, body: b }).then((r) => r.arrayBuffer()).catch(() => {});
    await q.add('sweep', { slot: i });
    if (i % 3 === 0) { const s = io(api + '/realtime', { transports: ['websocket'], reconnection: false }); await new Promise((r) => { s.on('connect', r); s.on('connect_error', r); setTimeout(r, 1500); }); s.close(); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await q.close(); process.exit(0);
})();
JS
(cd apps/api && NODE_PATH="$ST_ROOT/apps/api/node_modules" node "$WORK/traffic.cjs" "http://localhost:$API_PORT" "$REDIS_HOST_PORT" "$REDIS_DB" "$ROUNDS") >"$OUT/logs/traffic.log" 2>&1 || true
echo "waiting ${WAIT}s for scrapes and rule evaluation"; sleep "$WAIT"

# --- assertions
prom_json() { curl -fsS "$PROM$1"; }
node -e '
const t=JSON.parse(process.argv[1]).data.activeTargets;const bad=t.filter(x=>x.health!=="up");
console.log(t.length+" targets: "+t.map(x=>x.labels.job+"="+x.health).join(", "));process.exit(t.length>=3&&!bad.length?0:1)' "$(prom_json /api/v1/targets)" >"$OUT/logs/targets.log" 2>&1 \
  && st_check "prometheus targets all UP" PASS "$(cat "$OUT/logs/targets.log")" || st_check "prometheus targets all UP" FAIL "$(cat "$OUT/logs/targets.log")"
node -e '
const g=JSON.parse(process.argv[1]).data.groups;const rules=g.flatMap(x=>x.rules);const bad=rules.filter(r=>r.health!=="ok");
console.log(g.length+" groups, "+rules.length+" rules, "+bad.length+" unhealthy"+bad.map(r=>" ["+r.name+": "+(r.lastError||r.health).slice(0,80)+"]").join(""));process.exit(rules.length&&!bad.length?0:1)' "$(prom_json /api/v1/rules)" >"$OUT/logs/rules.log" 2>&1 \
  && st_check "all rule groups healthy" PASS "$(cat "$OUT/logs/rules.log")" || st_check "all rule groups healthy" FAIL "$(cat "$OUT/logs/rules.log")"
python3 "$HERE/panel-check.py" --grafana "$GRAF" --prom "$PROM" --allow "$HERE/expected-empty-panels.json" --out "$OUT/panels.json" >"$OUT/logs/panel-check.log" 2>&1 && PC=PASS || PC=FAIL
st_check "every dashboard loads, every panel query runs (no errors, only allow-listed empties)" "$PC" "$(head -1 "$OUT/logs/panel-check.log")"

# --- screenshots, one per dashboard
for uid in $(curl -fsS "$GRAF/api/search?type=dash-db" | node -e 'JSON.parse(require("fs").readFileSync(0)).forEach(d=>console.log(d.uid))'); do
  timeout 90 google-chrome --headless=new --no-sandbox --hide-scrollbars --window-size=1600,2400 --virtual-time-budget=20000 \
    --screenshot="$OUT/screenshots/$uid.png" "$GRAF/d/$uid?kiosk&from=now-15m&to=now" >/dev/null 2>&1 || true
done
n=$(ls "$OUT/screenshots" | wc -l); [ "$n" -gt 0 ] && st_check "screenshots saved" PASS "$n in screenshots/" || st_check "screenshots saved" FAIL "google-chrome produced none"

if [ "$KEEP" = 1 ]; then
  echo "stack left running. Grafana $GRAF  Prometheus $PROM  API http://localhost:$API_PORT"
  echo "stop it: kill ${PIDS[*]}; docker rm -f $PROM_C $GRAF_C; docker network rm $NET"
fi
st_finish
