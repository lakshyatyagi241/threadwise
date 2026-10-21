#!/usr/bin/env bash
# Alerting (Sheet3 #76): promtool check + test of every rules file, the runbook ratchet and its test, the Alertmanager webhook delivery
# check, and a LIVE alert test on private processes/containers (own API, worker, probe, Redis, Prometheus, Alertmanager, a TCP fault proxy in
# front of a throwaway database). --quick runs the fastest cases; full runs all of them.
# Exit: 0 PASS, 1 FAIL, 2 ERROR (could not run).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:$PATH"
MODE=full; OUT=""
usage() { cat <<'U'
run.sh [--quick] [--out DIR] [--help]
Runs: promtool check/test rules (prom/prometheus:v2.55.0), check-alert-runbooks ratchet + its test, Alertmanager webhook delivery check,
live alert test (worker kill, dead probe, Redis full, dead outbox row, Postgres hang: the API must survive). Full adds more cases.
Needs: docker (dev postgres crm-platform-postgres), node 22, pnpm, built apps/api (dist). Time: quick ~8 min, full ~25 min.
Ports (own): API 3921, metrics 59521/59525/59526, Prometheus 59191, Alertmanager 59193, webhook 59194, Redis 59422, DB proxy 59424.
U
}
while [ $# -gt 0 ]; do case "$1" in --quick) MODE=quick ;; --out) OUT="$2"; shift ;; --help|-h) usage; exit 0 ;; *) usage; exit 2 ;; esac; shift; done
OUT="${OUT:-qa-results/alerting/$(date +%Y%m%d-%H%M%S)}"; mkdir -p "$OUT/logs"; OUT="$(cd "$OUT" && pwd)"
DB="alerting_$$"; ADMIN="${ALERT_ADMIN_URL:-postgres://crm:crm@localhost:5432}"
err() { echo "ERROR: $*" >&2; exit 2; }
cleanup() { docker exec crm-platform-postgres psql -U crm -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1; }
trap cleanup EXIT; trap 'exit 130' INT TERM
step() { local n="$1"; shift; echo "==> $n"; "$@" > "$OUT/logs/$n.log" 2>&1; echo $? > "$OUT/logs/$n.exit"; }

command -v node >/dev/null || err "node not found"; docker info >/dev/null 2>&1 || err "docker is not running"
docker ps --format '{{.Names}}' | grep -qx crm-platform-postgres || err "crm-platform-postgres is not running"
[ -f apps/api/dist/src/main.js ] || err "apps/api is not built (pnpm --filter @crm/api build)"
[ -f .env ] || err ".env missing"
OBS="$ROOT/deploy/observability"
PT="docker run --rm -v $OBS:/r -w /r --entrypoint promtool prom/prometheus:v2.55.0"
RULES="$(cd "$OBS" && ls *.rules.yml | sed 's#^#/r/#' | tr '\n' ' ')"
TESTS="$(cd "$OBS" && ls *.rules.test.yml | tr '\n' ' ')"

step promtool_check $PT check rules $RULES
step promtool_test sh -c "for f in $TESTS; do $PT test rules \$f || exit 1; done"
step ratchet node tools/alerting/check-alert-runbooks.mjs
step ratchet_test node --test tools/alerting/check-alert-runbooks.test.mjs
step webhook node tools/alerting/webhook-delivery-check.mjs "$OUT/wd" "$OUT/webhook-delivery.json"

echo "==> live (creating throwaway database $DB)"
docker exec crm-platform-postgres psql -U crm -d postgres -c "CREATE DATABASE $DB" >/dev/null || err "cannot create database"
MIGRATION_DATABASE_URL="$ADMIN/$DB" DATABASE_URL="$ADMIN/$DB" pnpm --filter @crm/db migrate > "$OUT/logs/migrate.log" 2>&1 || err "migration failed (see logs/migrate.log)"
if [ "$MODE" = quick ]; then ONLY="worker-kill,probe-dead-port,redis-full,outbox-dead,pg-blackhole"; QUIET=15000; else ONLY=""; QUIET=90000; fi
step live env ALERT_DB="$DB" ONLY="$ONLY" QUIET_MS="$QUIET" node tools/alerting/live-test.mjs "$OUT/live-work" "$OUT/live-test-results.json"
echo; sed -n '/^case |/,$p' "$OUT/logs/live.log"

node - "$OUT" "$MODE" <<'N'
const fs = require('fs'), [out, mode] = process.argv.slice(2);
const ex = (n) => Number(fs.readFileSync(`${out}/logs/${n}.exit`, 'utf8'));
const steps = ['promtool_check', 'promtool_test', 'ratchet', 'ratchet_test', 'webhook', 'live'].map((n) => ({ name: n, pass: ex(n) === 0 }));
let wd = null; try { wd = JSON.parse(fs.readFileSync(`${out}/webhook-delivery.json`, 'utf8')); } catch {}
if (!wd?.delivered?.length) steps.find((s) => s.name === 'webhook').pass = false;
let live = []; try { live = JSON.parse(fs.readFileSync(`${out}/live-test-results.json`, 'utf8')).results; } catch {}
const status = steps.every((s) => s.pass) ? 'PASS' : 'FAIL';
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ id: 'alerting', mode, status, steps, webhookSeconds: wd?.secondsToDelivery ?? null, live: live.filter((r) => r.expectedAlert).map((r) => ({ id: r.id, alert: r.expectedAlert, fired: r.fired, secondsToPending: r.secondsToPending, secondsToFiring: r.secondsToFiring, apiAliveAfterHang: r.apiAliveAfterHang })) }, null, 2));
console.log(steps.map((s) => `${s.pass ? 'PASS' : 'FAIL'} ${s.name}`).join('\n') + `\nOVERALL ${status}  (${out}/result.json)`);
process.exit(status === 'PASS' ? 0 : 1);
N
