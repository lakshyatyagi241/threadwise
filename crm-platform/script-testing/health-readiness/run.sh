#!/usr/bin/env bash
# Health/readiness (Sheet3 #73): coverage-matrix ratchet over the production compose files, web route tests, and a LIVE test that boots the API
# behind TCP fault proxies (Postgres, Redis) and checks /health and /ready under refuse / black-hole / recover. Exit: 0 PASS, 1 FAIL, 2 ERROR.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; cd "$ROOT"
export PATH="$HOME/.local/bin:$PATH"
MODE=full; OUT=""
usage() { cat <<'U'
run.sh [--quick] [--out DIR] [--help]
Runs: tools/health-readiness/check.mjs (+ its node tests), web route tests, live fault-proxy test. --quick skips the promtool rules check (needs docker pull).
Needs: docker (shared dev Postgres crm-platform-postgres and Redis on 56379 are only READ through proxies, never stopped), node 22, pnpm, built packages and apps/api (dist).
Ports (own): API 3931, metrics 59531, Postgres proxy 59534, Redis proxy 59535. Known baseline: none of these files is in script-testing/known-failures.json.
U
}
while [ $# -gt 0 ]; do case "$1" in --quick) MODE=quick ;; --out) OUT="$2"; shift ;; --help|-h) usage; exit 0 ;; *) usage; exit 2 ;; esac; shift; done
OUT="${OUT:-qa-results/health-readiness/$(date +%Y%m%d-%H%M%S)}"; mkdir -p "$OUT/logs"; OUT="$(cd "$OUT" && pwd)"
DB="hr_$$"; ADMIN="${HR_ADMIN_URL:-postgres://crm:crm@localhost:5432}"
err() { echo "ERROR: $*" >&2; exit 2; }
cleanup() { docker exec crm-platform-postgres psql -U crm -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1; }
trap cleanup EXIT; trap 'exit 130' INT TERM
step() { local n="$1"; shift; echo "==> $n"; "$@" > "$OUT/logs/$n.log" 2>&1; echo $? > "$OUT/logs/$n.exit"; }
command -v node >/dev/null || err "node not found"; docker info >/dev/null 2>&1 || err "docker is not running"
docker ps --format '{{.Names}}' | grep -qx crm-platform-postgres || err "crm-platform-postgres is not running"
[ -f .env ] || err ".env missing"
for p in tax contracts db observability; do [ -d "packages/$p/dist" ] || pnpm --filter "@crm/$p" build > "$OUT/logs/build_$p.log" 2>&1 || err "build of @crm/$p failed"; done
[ -f apps/api/dist/src/main.js ] || pnpm --filter @crm/api build > "$OUT/logs/build_api.log" 2>&1 || err "api build failed"
for p in 3931 59531 59534 59535; do (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null && err "port $p is in use"; done

step ratchet node tools/health-readiness/check.mjs . --json "$OUT/coverage-matrix.result.json"
step ratchet_test node --test tools/health-readiness/check.test.mjs
step web_routes pnpm --filter @crm/web exec vitest run src/app/api/ready
if [ "$MODE" = full ]; then
  step promtool docker run --rm -v "$ROOT/deploy/observability:/r" -w /r --entrypoint promtool prom/prometheus:v2.55.0 check rules /r/event-loop.rules.yml /r/p0-failure-modes.rules.yml
fi
echo "==> live (throwaway database $DB)"
docker exec crm-platform-postgres psql -U crm -d postgres -c "CREATE DATABASE $DB" >/dev/null || err "cannot create database"
MIGRATION_DATABASE_URL="$ADMIN/$DB" DATABASE_URL="$ADMIN/$DB" pnpm db:migrate > "$OUT/logs/migrate.log" 2>&1 || err "migration failed (logs/migrate.log)"
step live env HR_DB="$DB" HR_ADMIN="$ADMIN" HR_REDIS_PORT=56379 HR_API_PORT=3931 HR_METRICS_PORT=59531 HR_PG_PORT=59534 HR_REDIS_PROXY=59535 HR_OUT="$OUT" HR_QUICK=$([ "$MODE" = quick ] && echo 1) node tools/health-readiness/live.mjs
sed -n '/PASS\|FAIL/p' "$OUT/logs/live.log"

node - "$OUT" "$MODE" <<'N'
const fs = require('fs'), [out, mode] = process.argv.slice(2);
const steps = ['ratchet', 'ratchet_test', 'web_routes', 'promtool', 'live'].filter((n) => fs.existsSync(`${out}/logs/${n}.exit`)).map((n) => ({ name: n, pass: Number(fs.readFileSync(`${out}/logs/${n}.exit`, 'utf8')) === 0 }));
let live = []; try { live = JSON.parse(fs.readFileSync(`${out}/live-results.json`, 'utf8')).results; } catch {}
if (!live.length) steps.find((s) => s.name === 'live').pass = false;
const status = steps.every((s) => s.pass) ? 'PASS' : 'FAIL';
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ id: 'health-readiness', mode, status, steps, counts: { liveChecks: live.length, livePassed: live.filter((r) => r.status === 'PASS').length, liveFailed: live.filter((r) => r.status === 'FAIL').length, knownBaseline: 0 }, live }, null, 2));
console.log(steps.map((s) => `${s.pass ? 'PASS' : 'FAIL'} ${s.name}`).join('\n') + `\nOVERALL ${status} (${out}/result.json)`);
process.exit(status === 'PASS' ? 0 : 1);
N
