#!/usr/bin/env bash
# Redis memory runner (Sheet4 V-04): the live key audit and the memory baseline under a real API + worker workload, and Redis vs Valkey on
# the same keys.
SEC_NAME=redis-memory; SEC_SHEET=0; SEC_TITLE="Redis memory (TTL coverage, baseline, Valkey)"
sec_help() { cat <<'H'
Redis memory (V-04).
  run.sh [--quick] [--out DIR]
  quick (seconds, no Docker): tests of the live key audit (key families, owners, TTL status) and of the key copy.
  full  (about 8 minutes): quick, then a scratch database and a PRIVATE redis:7-alpine (AOF on, noeviction; REDIS_KEY_PREFIX is not read by the API, so a prefix isolates nothing), the built API and worker booted on them,
        seeded, a ramp of 5 and 10 users, then tools/redis-audit/live.mjs --check over every key (count, bytes, does it expire, who owns
        the ones that never do) and INFO memory. Then the same keys are copied into a throwaway redis:7-alpine and valkey/valkey:8-alpine
        (read by type, written natively, 10 copies) and used_memory is compared. Writes redis-live.json and engines.json.
Never touches the shared Redis. Removes its three containers at the end. Local only.
Needs: node 22, pnpm; full also docker, curl, crm-platform-postgres and crm-platform-redis. Exit 0 PASS, 1 FAIL (a key family that never expires
has no named owner), 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
if [ "$SEC_MODE" = quick ]; then sec_prereq node22 pnpm; else sec_prereq node22 pnpm docker curl postgres redis; fi
R=tools/redis-audit
sec_run unit-tests node --test $R/live.test.mjs $R/compare-engines.test.mjs
[ "$SEC_MODE" = quick ] && sec_finish
NAME_A="redis-mem-a-$SEC_SUFFIX"; NAME_B="redis-mem-b-$SEC_SUFFIX"
# REDIS_KEY_PREFIX is not read by the API, so the key prefix of the shared lib isolates nothing, and every database index of the shared Redis
# already holds other runners' leftovers. Isolate by server instead: a private redis:7-alpine with the dev settings (AOF on, noeviction).
NAME_S="redis-mem-src-$SEC_SUFFIX"
mycleanup() { docker rm -f "$NAME_S" "$NAME_A" "$NAME_B" >/dev/null 2>&1 || true; sec_cleanup; }
trap mycleanup EXIT
PS=$(sec_free_port 7201)
docker run -d --rm --name "$NAME_S" -p "127.0.0.1:$PS:6379" redis:7-alpine redis-server --appendonly yes --maxmemory-policy noeviction >/dev/null
sleep 2
REDIS_BASE="redis://127.0.0.1:$PS"
JA=$(head -c48 /dev/urandom | base64 -w0); JR=$(head -c48 /dev/urandom | base64 -w0); CK=$(head -c32 /dev/urandom | base64 -w0)
sec_boot_api NODE_ENV=development LOG_LEVEL=error WORKER_MODE=false REDIS_URL="$REDIS_BASE/0" JWT_ACCESS_SECRET="$JA" JWT_REFRESH_SECRET="$JR" CREDENTIALS_ENCRYPTION_KEY="$CK"
sec_spawn worker-server PORT="$(sec_free_port 3951)" DATABASE_URL="$SEC_DB_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" REDIS_URL="$REDIS_BASE/0" \
  JWT_ACCESS_SECRET="$JA" JWT_REFRESH_SECRET="$JR" CREDENTIALS_ENCRYPTION_KEY="$CK" \
  CHANNEL_SIMULATOR_ENABLED=false NODE_ENV=development LOG_LEVEL=error WORKER_MODE=true node dist/src/worker.js
sleep 8
(cd "$CRM_ROOT" && DATABASE_URL="$SEC_DB_ADMIN_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" pnpm db:seed) >"$SEC_OUT/logs/seed.log" 2>&1 || sec_fatal "seed failed, see logs/seed.log"
sec_psql -v org=Admin -v contacts=5000 -v companies=500 -v tasks=1000 -v conversations=2000 -v messages=40000 <"$CRM_ROOT/tools/perf/seed.sql" >"$SEC_OUT/logs/seed-data.log" 2>&1 || sec_fatal "data seed failed"
sec_psql -v org=Admin -v users=5 <"$CRM_ROOT/tools/perf/seed-users.sql" >"$SEC_OUT/logs/seed-users.log" 2>&1 || sec_fatal "user seed failed"
sec_check seed PASS "workspace Admin, API and worker booted on a private Redis (port $PS)"
PERF_EMAIL=loaduser1@perf.example.test PERF_PASSWORD='Passw0rd!' API_URL="$SEC_API" \
  sec_run workload node "$CRM_ROOT/tools/perf/stress-ramp.mjs" --steps 5,10 --seconds 15 --p95 5000 --out "$SEC_OUT/stress.json"
sleep 5
# the audit reads only; --check fails on a key family that never expires and has no owner in docs/performance/redis/key-owners.json
sec_run live-audit node "$CRM_ROOT/$R/live.mjs" --url "$REDIS_BASE" --db 0 --out "$SEC_OUT/redis-live.json" --check
[ -s "$SEC_OUT/redis-live.json" ] || sec_fatal "live audit wrote nothing"
PA=$(sec_free_port 7101); PB=$(sec_free_port $((PA+1)))
docker run -d --rm --name "$NAME_A" -p "127.0.0.1:$PA:6379" redis:7-alpine redis-server --save "" --appendonly no >/dev/null
docker run -d --rm --name "$NAME_B" -p "127.0.0.1:$PB:6379" valkey/valkey:8-alpine valkey-server --save "" --appendonly no >/dev/null
sleep 2
sec_run engines node "$CRM_ROOT/$R/compare-engines.mjs" --src "$REDIS_BASE/0" --a "redis://127.0.0.1:$PA" --b "redis://127.0.0.1:$PB" --copies 10 --out "$SEC_OUT/engines.json"
sec_finish
