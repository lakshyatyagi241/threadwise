#!/usr/bin/env bash
# Google Chat alerts + slow-query watcher: unit tests, promtool/amtool, compose config, and a live e2e against a FAKE Chat receiver
# and a throwaway Postgres database, plus the accuracy/resolver harness (tools/chat-bridge/accuracy; --quick runs a subset, 1 trial). Exit: 0 PASS, 1 FAIL, 2 ERROR. Ports (own): fake Chat 59611, bridge 59612.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../_lib/common.sh"
st_init chat-alerts "Google Chat alerts and slow-query watcher"
st_parse_args "$@"
cd "$ST_ROOT"
st_need docker; st_need port:59611; st_need port:59612
docker ps --format '{{.Names}}' | grep -qx crm-platform-postgres || st_error "crm-platform-postgres is not running"
DB="chat_alerts_$$"; RO="chat_e2e_ro_$$"; OBS="$ST_ROOT/deploy/observability"
psql_a() { docker exec -i crm-platform-postgres psql -U crm -v ON_ERROR_STOP=1 "$@"; }
st_cleanup_add "docker exec crm-platform-postgres psql -U crm -d postgres -c 'DROP DATABASE IF EXISTS $DB WITH (FORCE)'; docker exec crm-platform-postgres psql -U crm -d postgres -c 'DROP ROLE IF EXISTS $RO'"
PT="docker run --rm -v $OBS:/r -w /r --entrypoint promtool prom/prometheus:v2.55.0"
AM="docker run --rm -v $OBS:/r --entrypoint amtool prom/alertmanager:v0.27.0"

st_run unit node --test tools/chat-bridge/chat-bridge.unit.test.mjs
st_run promtool_check $PT check rules /r/slow-query.rules.yml
st_run promtool_test $PT test rules slow-query.rules.test.yml
st_run amtool_gchat $AM check-config /r/alertmanager.gchat.yml
st_run runbook_ratchet node tools/alerting/check-alert-runbooks.mjs
st_run bash_syntax bash -n deploy/hostinger/observability-up.sh
st_run compose_config env OBS_METRICS_TOKEN=x bash -c "cd deploy/hostinger && docker compose -f docker-compose.yml -f observability.compose.yml --env-file .env.example config -q"

psql_a -d postgres -c "CREATE DATABASE $DB" >/dev/null || st_error "cannot create database"
psql_a -d "$DB" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements" >/dev/null 2>&1 || echo "pg_stat_statements not creatable: statement path will fail" >&2
sed "s/slow_query_ro/$RO/g" tools/chat-bridge/create-readonly-role.sql | psql_a -d "$DB" -v pw="'ropw'" -v dbname="$DB" >"$OUT/logs/role.log" 2>&1 || st_error "role script failed (logs/role.log)"
st_run role_idempotent bash -c "sed 's/slow_query_ro/$RO/g' tools/chat-bridge/create-readonly-role.sql | docker exec -i crm-platform-postgres psql -U crm -v ON_ERROR_STOP=1 -d $DB -v pw=\"'ropw'\" -v dbname=$DB"
psql_a -d "$DB" -c "create table public.t_secret(a int)" >/dev/null
st_run role_no_table_select bash -c "! docker exec -i crm-platform-postgres psql -U crm -d $DB -v ON_ERROR_STOP=1 -c 'set role $RO; select * from public.t_secret'"
st_run role_can_read_stats bash -c "docker exec -i crm-platform-postgres psql -U crm -d $DB -v ON_ERROR_STOP=1 -c 'set role $RO; select count(*) from pg_stat_statements; select count(*) from pg_stat_activity'"
cd apps/api
E2EFLAG=""; [ "$MODE" = quick ] && E2EFLAG="--quick"
st_run e2e node "$ST_ROOT/tools/chat-bridge/e2e.mjs" "postgres://crm:crm@localhost:5432" "$DB" "$RO" "$OUT/e2e-results.json" $E2EFLAG
st_run accuracy node "$ST_ROOT/tools/chat-bridge/accuracy/run.mjs" "postgres://crm:crm@localhost:5432" "$DB" "$RO" "$OUT/accuracy-results.json" $E2EFLAG
cd "$ST_ROOT"
[ -f "$OUT/e2e-results.json" ] && node -e 'for (const r of JSON.parse(require("fs").readFileSync(process.argv[1])).results) console.log("   "+r.status+" "+r.name+" "+r.detail)' "$OUT/e2e-results.json"
st_finish
