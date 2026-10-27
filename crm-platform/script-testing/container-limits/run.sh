#!/usr/bin/env bash
# Container limits runner (Sheet4 V-05): the API image and the worker, started as containers with the CPU, PID and memory limits that deploy/hostinger
# ships, under a stress ramp; reads the cgroup to see whether any limit was hit. Also holds the image to a size budget.
SEC_NAME=container-limits; SEC_SHEET=0; SEC_TITLE="Container limits and image size (API, worker)"
sec_help() { cat <<'H'
Container limits (V-05).
  run.sh [--quick] [--out DIR]
  quick (seconds, no Docker): tests of the cgroup reader and the resource-limits check (every deployed service has a memory, CPU and PID limit).
  full  (about 6 minutes with an image already built): quick, then the API image (IMAGE=name, else built here) is checked against its size budget (as docker lists it; the compressed size is recorded too)
        in docs/performance/container-limits/budgets.json, a scratch database is migrated by the image's own migrate command, the API and the worker
        run as containers with the limits of api-blue and worker from deploy/hostinger/docker-compose.yml (private network, published on 127.0.0.1 only), and
        stress-ramp.mjs runs 5, 10 and 25 users for 15 s. The cgroup then says whether the container was OOM-killed, used most of its PIDs or
        memory, or was throttled by its CPU cap. Writes container-limits.json.
  IMAGE=desk-api:v05-slim reuses an image; WEB_IMAGE=desk-web:v05-slim adds the web container (limits of web-blue, 600 requests) and its size budget. Without BuildKit/buildx the Dockerfile's `--mount` lines cannot build: see docs/performance/container-limits.
Needs: node 22, pnpm, docker, curl, crm-platform-postgres; cgroup v2 on the host. Local only; removes its containers and database at the end.
Exit 0 PASS, 1 FAIL (a limit was hit or the image is over budget), 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
if [ "$SEC_MODE" = quick ]; then sec_prereq node22 pnpm; else sec_prereq node22 pnpm docker curl postgres; fi
T=tools/container-limits
sec_run cgroup-tests node --test $T/cgroup.test.mjs
sec_run limits-check node tools/resource-limits/check.mjs --check
[ "$SEC_MODE" = quick ] && sec_finish

NAMES=(); NETS=()
mycleanup() { [ ${#NAMES[@]} -gt 0 ] && docker rm -f "${NAMES[@]}" >/dev/null 2>&1 || true; [ ${#NETS[@]} -gt 0 ] && docker network rm "${NETS[@]}" >/dev/null 2>&1 || true; sec_cleanup; }
trap mycleanup EXIT
IMAGE=${IMAGE:-}
if [ -z "$IMAGE" ]; then
  IMAGE="desk-api:limits-$SEC_SUFFIX"
  (cd "$CRM_ROOT" && docker build -f apps/api/Dockerfile -t "$IMAGE" .) >"$SEC_OUT/logs/build.log" 2>&1 || sec_fatal "image build failed (no BuildKit? see logs/build.log)"
fi
BYTES=$(node --input-type=module -e 'import { parseDockerSize } from "'"$CRM_ROOT/$T"'/cgroup.mjs"; console.log(parseDockerSize(process.argv[1]))' "$(docker image ls --format '{{.Size}}' "$IMAGE" | head -1)")
# what a release ships over SSH is the compressed layers, not the unpacked size
SAVED=$(docker save "$IMAGE" | wc -c)
MAXMB=$(node -e 'console.log(require(process.argv[1]).api.imageMaxMb)' "$CRM_ROOT/docs/performance/container-limits/budgets.json")
SZ=$(node --input-type=module -e 'import { sizeCheck } from "'"$CRM_ROOT/$T"'/cgroup.mjs"; const c = sizeCheck(Number(process.argv[1]), Number(process.argv[2]) * 1e6); console.log(`${c.ok ? "PASS" : "FAIL"}|${c.detail}; ${Math.round(Number(process.argv[3]) / 1e6)} MB compressed (docker save)`)' "$BYTES" "$MAXMB" "$SAVED")
sec_check image-size "${SZ%%|*}" "${SZ#*|}"

sec_db_create
JA=$(head -c48 /dev/urandom | base64 -w0); JR=$(head -c48 /dev/urandom | base64 -w0); CK=$(head -c32 /dev/urandom | base64 -w0)
# Containers talk over a private network and publish only on 127.0.0.1 (the API binds 0.0.0.0, and the scratch database holds a seeded user with
# a known password: it must not be reachable from the LAN while the test runs). Postgres is the one on the host, reached through host-gateway.
NET="limits-net-$SEC_SUFFIX"; docker network create "$NET" >/dev/null; NETS+=("$NET")
NAME_R="limits-redis-$SEC_SUFFIX"; NAMES+=("$NAME_R")
docker run -d --rm --name "$NAME_R" --network "$NET" redis:7-alpine redis-server --appendonly no --save "" --maxmemory-policy noeviction >/dev/null
sleep 2
HOSTDB() { echo "$1" | sed -E 's#@(localhost|127\.0\.0\.1)([:/])#@host.docker.internal\2#'; }
NETARGS=(--network "$NET" --add-host host.docker.internal:host-gateway)
ENVS=(-e NODE_ENV=production -e LOG_LEVEL=error -e "DATABASE_URL=$(HOSTDB "$SEC_DB_URL")" -e "DATABASE_REPLICA_URL=$(HOSTDB "$SEC_DB_URL")" -e "MIGRATION_DATABASE_URL=$(HOSTDB "$SEC_DB_ADMIN_URL")"
  -e "REDIS_URL=redis://$NAME_R:6379/0" -e "JWT_ACCESS_SECRET=$JA" -e "JWT_REFRESH_SECRET=$JR" -e "CREDENTIALS_ENCRYPTION_KEY=$CK" -e CHANNEL_SIMULATOR_ENABLED=false)
docker run --rm "${NETARGS[@]}" "${ENVS[@]}" "$IMAGE" node node_modules/@crm/db/dist/cli/migrate.js up >"$SEC_OUT/logs/migrate.log" 2>&1 || sec_fatal "the image's migrate failed, see logs/migrate.log"
sec_check migrate PASS "image's own migrate command, database $SEC_DB"
(cd "$CRM_ROOT" && DATABASE_URL="$SEC_DB_ADMIN_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" pnpm db:seed) >"$SEC_OUT/logs/seed.log" 2>&1 || sec_fatal "seed failed"
sec_psql -v org=Admin -v contacts=5000 -v companies=500 -v tasks=1000 -v conversations=2000 -v messages=40000 <"$CRM_ROOT/tools/perf/seed.sql" >"$SEC_OUT/logs/seed-data.log" 2>&1 || sec_fatal "data seed failed"
sec_psql -v org=Admin -v users=5 <"$CRM_ROOT/tools/perf/seed-users.sql" >"$SEC_OUT/logs/seed-users.log" 2>&1 || sec_fatal "user seed failed"

lim() { node "$CRM_ROOT/$T/limits-of.mjs" "$CRM_ROOT/deploy/hostinger/docker-compose.yml" "$1"; }
flags() { node -e 'const l=JSON.parse(process.argv[1]);console.log(`--cpus ${l.cpus} --pids-limit ${l.pids} --memory ${l.memoryBytes}`)' "$1"; }
API_LIM=$(lim api-blue); WK_LIM=$(lim worker)
APORT=$(sec_free_port 3941)
NAME_A="limits-api-$SEC_SUFFIX"; NAME_W="limits-worker-$SEC_SUFFIX"; NAMES+=("$NAME_A" "$NAME_W")
# shellcheck disable=SC2046
docker run -d --name "$NAME_A" "${NETARGS[@]}" -p "127.0.0.1:$APORT:3000" $(flags "$API_LIM") "${ENVS[@]}" -e PORT=3000 -e WORKER_MODE=false -e NODE_OPTIONS=--max-old-space-size=640 "$IMAGE" >/dev/null
# shellcheck disable=SC2046
docker run -d --name "$NAME_W" "${NETARGS[@]}" $(flags "$WK_LIM") "${ENVS[@]}" -e PORT=3000 -e WORKER_MODE=true -e NODE_OPTIONS=--max-old-space-size=640 "$IMAGE" node dist/src/worker.js >/dev/null
sec_wait_http "http://127.0.0.1:$APORT/health" 90 '^200$' || { docker logs "$NAME_A" >"$SEC_OUT/logs/api-container.log" 2>&1; tail -n 15 "$SEC_OUT/logs/api-container.log" >&2; sec_fatal "the API container did not become healthy"; }
sleep 8
docker ps --format '{{.Names}}' | grep -qx "$NAME_W" || { docker logs "$NAME_W" >"$SEC_OUT/logs/worker-container.log" 2>&1; tail -n 15 "$SEC_OUT/logs/worker-container.log" >&2; sec_fatal "the worker container stopped"; }
sec_check container-boot PASS "api (limits $API_LIM) and worker (limits $WK_LIM) running from $IMAGE"

cg() { docker exec "$1" cat "/sys/fs/cgroup/$2" 2>/dev/null; }
snap() { cg "$1" cpu.stat; }
A0=$(snap "$NAME_A"); W0=$(snap "$NAME_W"); T0=$(date +%s)
APID=$(docker inspect -f '{{.State.Pid}}' "$NAME_A")
PERF_EMAIL=loaduser1@perf.example.test PERF_PASSWORD='Passw0rd!' API_URL="http://127.0.0.1:$APORT" \
  sec_run stress-ramp node "$CRM_ROOT/tools/perf/stress-ramp.mjs" --pid "$APID" --steps 5,10,25 --seconds 15 --p95 5000 --out "$SEC_OUT/stress.json"
SECS=$(( $(date +%s) - T0 ))
# one container's cgroup against its limits: report_cg <label> <container> <cpu.stat at start> <limits json> <seconds>
report_cg() {
  local who=$1 C=$2 S0=$3 L=$4 SECS=$5 S1 OUT
  S1=$(snap "$C")
  OUT=$(CPU0="$S0" CPU1="$S1" MP="$(cg "$C" memory.peak)" ME="$(cg "$C" memory.events)" PP="$(cg "$C" pids.peak)" PC="$(cg "$C" pids.current)" LIM="$L" SECS="$SECS" WHO="$who" \
    node --input-type=module -e '
import { judge, parseKeyValue, parseNumber, usage } from "'"$CRM_ROOT/$T"'/cgroup.mjs";
const e = process.env;
const u = usage({ cpuStart: parseKeyValue(e.CPU0), cpuEnd: parseKeyValue(e.CPU1), memoryPeak: parseNumber(e.MP), memoryEvents: parseKeyValue(e.ME),
  pidsPeak: e.PP ? parseNumber(e.PP) : undefined, pidsCurrent: parseNumber(e.PC), seconds: Number(e.SECS) });
const lim = JSON.parse(e.LIM);
console.log(JSON.stringify({ who: e.WHO, limits: lim, usage: u, checks: judge(u, lim) }));')
  echo "$OUT" >>"$SEC_OUT/container-limits.jsonl"
  # process substitution, not a pipe: sec_check must run in this shell or a FAIL is lost with the subshell
  while IFS='|' read -r st nm detail; do sec_check "$nm" "$st" "$detail"; done < <(echo "$OUT" | node -e '
const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
for (const c of r.checks) console.log(`${c.ok ? "PASS" : "FAIL"}|${r.who}-${c.name}|${c.detail}`)')
}
report_cg api "$NAME_A" "$A0" "$API_LIM" "$SECS"
report_cg worker "$NAME_W" "$W0" "$WK_LIM" "$SECS"

# the web image, when WEB_IMAGE is given: boots with its limits, then 600 requests (8 at a time) to a page and the health route
if [ -n "${WEB_IMAGE:-}" ]; then
  WEB_LIM=$(lim web-blue); NAME_X="limits-web-$SEC_SUFFIX"; NAMES+=("$NAME_X"); XPORT=$(sec_free_port 3961)
  # shellcheck disable=SC2046
  docker run -d --name "$NAME_X" --network "$NET" -p "127.0.0.1:$XPORT:3001" $(flags "$WEB_LIM") -e PORT=3001 -e "API_URL=http://$NAME_A:3000" -e "REALTIME_URL=http://$NAME_A:3000" "$WEB_IMAGE" >/dev/null
  sec_wait_http "http://127.0.0.1:$XPORT/api/health" 60 '^200$' || { docker logs "$NAME_X" >"$SEC_OUT/logs/web-container.log" 2>&1; sec_fatal "the web container did not become healthy"; }
  X0=$(snap "$NAME_X"); TX=$(date +%s)
  XPORT="$XPORT" node -e '
const base = `http://127.0.0.1:${process.env.XPORT}`;
let n = 0, bad = 0;
const worker = async () => { while (n++ < 600) { const r = await fetch(base + (n % 2 ? "/login" : "/api/health")).catch(() => null); if (!r || r.status !== 200) bad++; await r?.arrayBuffer(); } };
Promise.all(Array.from({ length: 8 }, worker)).then(() => { console.log(`web requests done, ${bad} not 200`); process.exit(bad ? 1 : 0); });' >"$SEC_OUT/logs/web-load.log" 2>&1 \
    && sec_check web-load PASS "$(cat "$SEC_OUT/logs/web-load.log")" || sec_check web-load FAIL "$(cat "$SEC_OUT/logs/web-load.log")"
  report_cg web "$NAME_X" "$X0" "$WEB_LIM" "$(( $(date +%s) - TX ))"
  WBYTES=$(node --input-type=module -e 'import { parseDockerSize } from "'"$CRM_ROOT/$T"'/cgroup.mjs"; console.log(parseDockerSize(process.argv[1]))' "$(docker image ls --format '{{.Size}}' "$WEB_IMAGE" | head -1)")
  WMAX=$(node -e 'console.log(require(process.argv[1]).web.imageMaxMb)' "$CRM_ROOT/docs/performance/container-limits/budgets.json")
  WSZ=$(node --input-type=module -e 'import { sizeCheck } from "'"$CRM_ROOT/$T"'/cgroup.mjs"; const c = sizeCheck(Number(process.argv[1]), Number(process.argv[2]) * 1e6); console.log(`${c.ok ? "PASS" : "FAIL"}|web ${c.detail}`)' "$WBYTES" "$WMAX")
  sec_check web-image-size "${WSZ%%|*}" "${WSZ#*|}"
fi
node -e 'const fs=require("fs");const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse);fs.writeFileSync(process.argv[2],JSON.stringify({at:new Date().toISOString(),image:process.argv[3],imageBytes:+process.argv[4],runs:rows},null,2))' "$SEC_OUT/container-limits.jsonl" "$SEC_OUT/container-limits.json" "$IMAGE" "$BYTES"
sec_finish
