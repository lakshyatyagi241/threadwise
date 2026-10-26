#!/usr/bin/env bash
# Rate limiting runner (sheet item 33): static route audit, unit and integration specs, a live census of every public route, behaviour
# probes (silent limits, distributed attacks, bypass tries) and a release gate that fails on any unresolved Critical or High.
SEC_NAME=rate-limiting; SEC_SHEET=33; SEC_TITLE="Rate limiting"
sec_help() { cat <<'H'
Rate limiting (sheet 33).
  run.sh [--quick] [--out DIR]
  quick (pull request, about 1 min, no Docker): the route audit, the tool tests, the API unit specs and the release gate judged against the
        committed census evidence, so a NEW public route with no limit and no census record fails the pull request.
  full  (daily and pre-release, about 12 min): quick, plus the integration specs on real Redis (testcontainers), then a real API booted on
        its own database: a census of every public route (bursts to the first 429), behaviour probes, a second API whose peer is NOT a
        trusted proxy (forged X-Forwarded-For must not help), and the gate judged against the LIVE results.
Needs: node 22, pnpm, installed dependencies; full also docker, curl and the crm-platform-postgres and crm-platform-redis containers.
Local only: the census and probes refuse any address that is not loopback or private. Exit 0 PASS, 1 FAIL, 2 ERROR.
H
}
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../_lib" && pwd)/common.sh"
sec_init "$@"
if [ "$SEC_MODE" = quick ]; then sec_prereq node22 pnpm; else sec_prereq node22 pnpm docker curl postgres redis; fi
RL=tools/rate-limit
UNIT="test/unit/platform-infrastructure/throttle.guard.spec.ts test/unit/platform-infrastructure/client-address.spec.ts test/unit/platform-infrastructure/rate-limit-bypass.spec.ts test/unit/common/problem-retry-after.spec.ts"

# 1. static: the inventory is current, the tools work, the deploy files are sound, the unit specs pass
sec_run route-audit node $RL/audit.mjs
sec_run tool-tests node --test $RL/lib.test.mjs $RL/gate.test.mjs
sec_vitest api-unit api $UNIT
# 2. the gate against the committed evidence: a new public route without a limit or a census record fails here, with no boot
sec_run gate-committed node $RL/gate.mjs --json "$SEC_OUT/gate-committed.json"
[ "$SEC_MODE" = quick ] && sec_finish

# 3. integration on real Redis (testcontainers)
sec_vitest api-integration api test/integration/platform-infrastructure/rate-limiter.spec.ts test/integration/platform-infrastructure/throttle.http.spec.ts test/integration/platform-infrastructure/rate-limit-multi-instance.spec.ts

# 4. live: a real API on its own database, seeded.
# The limiter and the sign-in lockouts write Redis keys with no REDIS_KEY_PREFIX, so the house cleanup misses them and a stale lock
# from an earlier run (user id 1 in a fresh database) would block this run's sign-ins. Use a Redis db that is empty right now.
for d in 10 11 12 13 14 15 8 7; do
  [ "$(docker exec crm-platform-redis redis-cli -n "$d" dbsize 2>/dev/null)" = 0 ] && { SEC_REDIS_DB=$d; break; }
done
[ "$SEC_REDIS_DB" = 9 ] && sec_fatal "no empty Redis db for an isolated run"
sec_boot_api
(cd "$CRM_ROOT" && DATABASE_URL="$SEC_DB_ADMIN_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" pnpm db:seed) >"$SEC_OUT/logs/seed.log" 2>&1 || sec_fatal "seed failed, see logs/seed.log"
sec_check seed PASS "workspace Admin and its staff and agent users"

# a second API on the same database whose peer (this machine) is NOT a trusted proxy, so X-Forwarded-For must be ignored
DIRECT_PORT=$(sec_free_port $((SEC_API_PORT + 1)))
redis="$(sec_envval REDIS_URL)"; redis="${redis%/}"; redis="${redis%/[0-9]*}/$SEC_REDIS_DB"
sec_spawn api-direct PORT="$DIRECT_PORT" DATABASE_URL="$SEC_DB_URL" MIGRATION_DATABASE_URL="$SEC_DB_ADMIN_URL" REDIS_URL="$redis" \
  REDIS_KEY_PREFIX="$SEC_REDIS_PREFIX" JWT_ACCESS_SECRET="$(head -c48 /dev/urandom | base64 -w0)" JWT_REFRESH_SECRET="$(head -c48 /dev/urandom | base64 -w0)" \
  CREDENTIALS_ENCRYPTION_KEY="$(head -c32 /dev/urandom | base64 -w0)" CHANNEL_SIMULATOR_ENABLED=false TRUST_PROXY=203.0.113.7 node dist/src/main.js
sec_wait_http "http://127.0.0.1:$DIRECT_PORT/health" 90 '^200$' || sec_fatal "the second API did not start, see logs/api-direct.log"
sec_check api-direct-boot PASS "port $DIRECT_PORT, TRUST_PROXY=203.0.113.7"

# census: every public route, a burst until the first 429 (or the cap), from its own forged client address
CENSUS="$SEC_OUT/census.json"
if node $RL/census.mjs --api "$SEC_API" --out "$CENSUS" >"$SEC_OUT/logs/census.log" 2>&1; then sec_check census PASS "$(tail -n1 "$SEC_OUT/logs/census.log" | cut -c1-160)"; else sec_check census FAIL "see logs/census.log"; fi
# probes: silent limits, distributed guessing, retry-after, atomicity, path and address variants, a forged header, response shape, counter expiry
PROBES="$SEC_OUT/probes.json"
node $RL/probes.mjs --api "$SEC_API" --direct-api "http://127.0.0.1:$DIRECT_PORT" --db "$SEC_DB" --redis-prefix "$SEC_REDIS_PREFIX" --redis-db "$SEC_REDIS_DB" --out "$PROBES" >"$SEC_OUT/logs/probes.log" 2>&1 || true
[ -s "$PROBES" ] && sec_check probes PASS "$(grep -c 'PASS' "$SEC_OUT/logs/probes.log") passed, $(grep -c 'FAIL' "$SEC_OUT/logs/probes.log") failed (the gate judges them by severity)" || sec_check probes FAIL "no result file, see logs/probes.log"

# the gate, on the live results
sec_run gate-live node $RL/gate.mjs --census "$CENSUS" --probes "$PROBES" --json "$SEC_OUT/gate-live.json"
[ -n "${RL_UPDATE_EVIDENCE:-}" ] && cp "$CENSUS" "$CRM_ROOT/docs/security/rate-limiting/census.json" && echo "census evidence updated"
sec_finish
