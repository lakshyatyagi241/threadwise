# Google Chat alerts and slow queries

All alerts and slow queries land in four Google Chat spaces: Slow Queries, Deployments, Critical Alerts, Other Alerts.
Pieces: `tools/chat-bridge` (bridge + slow-query watcher, one Node process, service `gchat-bridge`, 96 MB), `deploy/observability/alertmanager.gchat.yml`,
`deploy/observability/slow-query.rules.yml`. Grafana contact points / dashboard and the Deployments notifier are built on a separate branch (placeholder: see that branch's docs; not part of this runbook yet).

## Setup (owner, once)
1. Create 4 spaces in Google Chat. In each: Manage webhooks, Add, name it, copy the URL (`https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...`). Treat the URLs as secrets.
2. Read-only database role: run `psql "$ADMIN_URL" -v pw="'<generated password>'" -f tools/chat-bridge/create-readonly-role.sql` (idempotent: role `slow_query_ro`, `pg_read_all_stats`, CONNECT only, no table SELECT). Then write `postgres://slow_query_ro:<pw>@postgres:5432/<db>` to `secrets/slow_query_pg_url` (mode 644, dir 700).
3. `pg_stat_statements`: `deploy/hostinger/docker-compose.yml` already sets `shared_preload_libraries=pg_stat_statements` and `pg_stat_statements.track=all` (nothing added here). If the server's Postgres container was started before that was merged it needs ONE restart; then `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` in the app database. Verify: `select count(*) from pg_stat_statements;`. Without it the watcher still reports running queries and exports `pg_stat_statements_available 0`.
4. On the server: `cd /opt/desk && ./observability-up.sh`, choose `gchat`, paste the 4 URLs when asked (hidden; Enter skips a space). It writes `secrets/gchat_{critical,other,slowquery,deploy}_url`, sets `ALERTMANAGER_FILE=alertmanager.gchat.yml` and starts prometheus, alertmanager, probe and `gchat-bridge`. Manually: `docker compose -f docker-compose.yml -f observability.compose.yml --env-file .env up -d gchat-bridge` (and `up -d --force-recreate prometheus alertmanager` to pick up the rules/config).
5. Send a test message per space (from the server, URL never echoed): `curl -s -H 'content-type: application/json' -d '{"text":"test from Threadwise"}' "$(cat secrets/gchat_critical_url)"` (use `_other_`, `_slowquery_`, `_deploy_`). End to end through the bridge: `docker compose ... exec gchat-bridge node -e "fetch('http://127.0.0.1:9095/alertmanager',{method:'POST',body:JSON.stringify({alerts:[{status:'firing',labels:{alertname:'TestAlert',severity:'critical'},annotations:{summary:'test'}}]})}).then(r=>console.log(r.status))"`.
6. Grafana contact points and the deploy-main notifier: separate branch (not documented here).

## Thresholds
Env on the `gchat-bridge` service (set in `.env`, then `up -d gchat-bridge`): `SLOW_RUNNING_SECONDS` (5), `SLOW_MEAN_MS` (500), `SLOW_POLL_SECONDS` (15), `SLOW_COOLDOWN_SECONDS` (900 per query), `SLOW_MAX_PER_MINUTE` (10; extras become one digest message), `CHAT_RETRIES` (3), `CHAT_RETRY_BASE_MS` (500). Alert thresholds: `slow-query.rules.yml`. Grafana-managed rule thresholds: on the Grafana branch.

## Memory budget
Bridge + watcher: `mem_limit: 96m` (one Node process, one pg connection, no queue; measured idle RSS is in the report).

## Rollback / disable
`docker compose ... stop gchat-bridge`; set `ALERTMANAGER_FILE` back to `alertmanager.yml` (or slack/pagerduty) and recreate alertmanager; or `SLOW_WATCHER=0` to run the bridge without the watcher. Nothing else depends on it. Revoke a leaked webhook in the Chat space (Manage webhooks, delete) and re-run `observability-up.sh`.

## Not verified until it runs on the real host
Real Google Chat delivery and card rendering, the real webhook URL format, Postgres on the server with `pg_stat_statements`, the role grants on the server, container memory under real load, the `desk-api` image's `pg` module resolution (verified locally with the repo's node_modules only).

## Watchdog
`Watchdog` always fires; Alertmanager sends it to the bridge every 30 min; the bridge drops it (never posted) and records its arrival. If it stops, `ChatBridgeNoWatchdog` fires, but if Alertmanager or the bridge itself is dead that alert cannot reach Chat: rely on Grafana contact points for that case.

## SlowQueryBurst
Five or more slow-query events in 10 min. Open the Slow Queries space: each message has the normalized statement, calls since the last poll, mean/max, database and role. Find the statement in `pg_stat_statements` (`order by total_exec_time desc`), `EXPLAIN` it on a copy, add an index or fix the caller. Cooldown per query is 15 min, so repeats are expected while it is unfixed.

## SlowQueryWatcherDown
No poll for 2 min. Check `docker logs` of `gchat-bridge` (events `watcher_poll_error` with an error code, never a URL or query), that `secrets/slow_query_pg_url` is valid and the role can connect, and that the bridge is up.

## ChatBridgeDeliveryFailing
`crm_chat_bridge_failed_total{channel}` grew. 4xx means the webhook URL is wrong or revoked (recreate in the space, re-run `observability-up.sh`); 429/5xx means Chat is limiting or down (the bridge already retried; Alertmanager retries too). Check the `chat_post_failed` log lines for the status.

## ChatBridgeNoWatchdog
See Watchdog above: check prometheus rules loaded (`slow-query.rules.yml` mounted), alertmanager config is the gchat one, and `gchat-bridge` is healthy.

## Run the live local demo
Everything local, with a fake Chat page standing in for Google Chat (`tools/chat-bridge/fake-chat.mjs`; never calls chat.googleapis.com). Needs Docker, node, the dev Postgres with `pg_stat_statements`. Use a work dir `W` outside git.
```bash
W=/tmp/chatlive; mkdir -p $W/secrets $W/prom $W/am; R=$PWD   # R = crm-platform/
# 1. read-only role on the dev DB (skip the REVOKE line: it would lock out other users of a shared DB)
PW=$(openssl rand -hex 12); grep -v 'REVOKE ALL' tools/chat-bridge/create-readonly-role.sql | sed 's/slow_query_ro/chatlive_ro/g' \
  | docker exec -i crm-platform-postgres psql -U crm -v ON_ERROR_STOP=1 -d crm -v pw="'$PW'" -v dbname=crm
echo -n "postgres://chatlive_ro:$PW@localhost:5432/crm" > $W/secrets/slow_query_pg_url
for c in critical other slowquery deploy; do echo -n "http://127.0.0.1:59611/hook/$c" > $W/secrets/gchat_${c}_url; done
openssl rand -hex 12 | tr -d '\n' > $W/grafana-admin-password
# 2. fake Chat (59611), bridge + watcher (59612; run from apps/api so `pg` resolves)
setsid nohup node tools/chat-bridge/fake-chat.mjs >$W/fake.log 2>&1 </dev/null &
(cd apps/api && PORT=59612 CHAT_ALLOW_ANY_HOST=1 GCHAT_SECRETS_DIR=$W/secrets SLOW_PG_URL_FILE=$W/secrets/slow_query_pg_url GRAFANA_URL=http://localhost:53100 setsid nohup node $R/tools/chat-bridge/index.mjs >$W/bridge.log 2>&1 </dev/null &)
# 3. Prometheus (59090, all *.rules.yml), Alertmanager (59093), Grafana (53100), host network so localhost works
cat > $W/prom/prometheus.yml <<'Y'
global: { scrape_interval: 5s, evaluation_interval: 5s }
rule_files: [/rules/*.rules.yml]
alerting: { alertmanagers: [{ static_configs: [{ targets: ['localhost:59093'] }] }] }
scrape_configs:
  - { job_name: prometheus, static_configs: [{ targets: ['localhost:59090'] }] }
  - { job_name: crm-chat-bridge, static_configs: [{ targets: ['localhost:59612'] }] }
Y
sed 's#http://gchat-bridge:9095#http://localhost:59612#' deploy/observability/alertmanager.gchat.yml > $W/am/alertmanager.yml
cp -r deploy/observability/grafana/provisioning $W/prov && sed -i 's#http://prometheus:9090#http://localhost:59090#' $W/prov/datasources/prometheus.yml
chmod -R a+rX $W/prov $W/secrets
docker run -d --name chatlive-prometheus --network host -v $W/prom:/c -v $R/deploy/observability:/rules:ro prom/prometheus:v2.55.0 --config.file=/c/prometheus.yml --web.listen-address=:59090 --storage.tsdb.path=/tmp/d
docker run -d --name chatlive-alertmanager --network host -v $W/am:/c:ro prom/alertmanager:v0.27.0 --config.file=/c/alertmanager.yml --web.listen-address=:59093 --cluster.listen-address= --storage.path=/tmp/a
docker run -d --name chatlive-grafana --network host -e GF_SERVER_HTTP_PORT=53100 -e GF_SECURITY_ADMIN_PASSWORD__FILE=/run/secrets/pw -e GF_AUTH_ANONYMOUS_ENABLED=false \
  -v $W/prov:/etc/grafana/provisioning:ro -v $R/deploy/observability/grafana/dashboards:/var/lib/grafana/dashboards:ro -v $W/grafana-admin-password:/run/secrets/pw:ro \
  $(for c in critical other slowquery deploy; do echo -v $W/secrets/gchat_${c}_url:/run/secrets/gchat_${c}_url:ro; done) grafana/grafana-oss:11.3.0
# 4. trigger: a query the watcher sees (poll is 15 s, so keep it > 20 s) and a test alert
docker exec -d crm-platform-postgres psql -U crm -d crm -c "select pg_sleep(80)"
curl -XPOST localhost:59093/api/v2/alerts -H 'content-type: application/json' -d '[{"labels":{"alertname":"Demo","severity":"critical"},"annotations":{"summary":"test"}}]'
```
Open http://localhost:59611 (fake Chat, refreshes every 3 s), http://localhost:53100 (admin, password in `$W/grafana-admin-password`), :59090, :59093. Stop: `docker rm -f chatlive-prometheus chatlive-alertmanager chatlive-grafana; pkill -f chat-bridge/index.mjs; pkill -f fake-chat.mjs; DROP ROLE chatlive_ro`.
Notes: the Grafana alert rules are provisioned, so they are read-only in the UI (copy to edit). The Watchdog is dropped by the bridge by design; it shows as `crm_chat_bridge_last_watchdog_timestamp_seconds`. Identical statements that differ only in literals are one normalized query (deduped for the 15 min cooldown), so use different statements to see several cards.
