# Google Chat alerts and slow queries

All alerts and slow queries land in three Google Chat spaces: Critical, Other, Deployments. Slow queries go to Other and escalate to Critical (see Autonomy).
Pieces: `tools/chat-bridge` (bridge + slow-query watcher, one Node process, service `gchat-bridge`, 96 MB), `deploy/observability/alertmanager.gchat.yml`,
`deploy/observability/slow-query.rules.yml`. Grafana contact points / dashboard and the Deployments notifier are built on a separate branch (placeholder: see that branch's docs; not part of this runbook yet).

## Setup (owner, once)
1. Create 3 spaces in Google Chat. In each: Manage webhooks, Add, name it, copy the URL (`https://chat.googleapis.com/v1/spaces/.../messages?key=...&token=...`). Treat the URLs as secrets.
2. Read-only database role: run `psql "$ADMIN_URL" -v pw="'<generated password>'" -f tools/chat-bridge/create-readonly-role.sql` (idempotent: role `slow_query_ro`, `pg_read_all_stats`, CONNECT only, no table SELECT). Then write `postgres://slow_query_ro:<pw>@postgres:5432/<db>` to `secrets/slow_query_pg_url` (mode 644, dir 700).
3. `pg_stat_statements`: `deploy/hostinger/docker-compose.yml` already sets `shared_preload_libraries=pg_stat_statements` and `pg_stat_statements.track=all` (nothing added here). If the server's Postgres container was started before that was merged it needs ONE restart; then `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` in the app database. Verify: `select count(*) from pg_stat_statements;`. Without it the watcher still reports running queries and exports `pg_stat_statements_available 0`.
4. On the server: `cd /opt/desk && ./observability-up.sh`, choose `gchat`, paste the 3 URLs when asked (hidden; Enter skips a space). It writes `secrets/gchat_{critical,other,deploy}_url`, sets `ALERTMANAGER_FILE=alertmanager.gchat.yml` and starts prometheus, alertmanager, probe and `gchat-bridge`. Manually: `docker compose -f docker-compose.yml -f observability.compose.yml --env-file .env up -d gchat-bridge` (and `up -d --force-recreate prometheus alertmanager` to pick up the rules/config).
5. Send a test message per space (from the server, URL never echoed): `curl -s -H 'content-type: application/json' -d '{"text":"test from Threadwise"}' "$(cat secrets/gchat_critical_url)"` (use `_other_`, `_deploy_`). End to end through the bridge: `docker compose ... exec gchat-bridge node -e "fetch('http://127.0.0.1:9095/alertmanager',{method:'POST',body:JSON.stringify({alerts:[{status:'firing',labels:{alertname:'TestAlert',severity:'critical'},annotations:{summary:'test'}}]})}).then(r=>console.log(r.status))"`.
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
Five or more slow-query events in 10 min. Open the slow-query cards in the Other (or Critical) space: each message has the normalized statement, calls since the last poll, mean/max, database and role. Find the statement in `pg_stat_statements` (`order by total_exec_time desc`), `EXPLAIN` it on a copy, add an index or fix the caller. Cooldown per query is 15 min, so repeats are expected while it is unfixed.

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
for c in critical other deploy; do echo -n "http://127.0.0.1:59611/hook/$c" > $W/secrets/gchat_${c}_url; done
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
  $(for c in critical other deploy; do echo -v $W/secrets/gchat_${c}_url:/run/secrets/gchat_${c}_url:ro; done) grafana/grafana-oss:11.3.0
# 4. trigger: a query the watcher sees (poll is 15 s, so keep it > 20 s) and a test alert
docker exec -d crm-platform-postgres psql -U crm -d crm -c "select pg_sleep(80)"
curl -XPOST localhost:59093/api/v2/alerts -H 'content-type: application/json' -d '[{"labels":{"alertname":"Demo","severity":"critical"},"annotations":{"summary":"test"}}]'
```
Open http://localhost:59611 (fake Chat, refreshes every 3 s), http://localhost:53100 (admin, password in `$W/grafana-admin-password`), :59090, :59093. Stop: `docker rm -f chatlive-prometheus chatlive-alertmanager chatlive-grafana; pkill -f chat-bridge/index.mjs; pkill -f fake-chat.mjs; DROP ROLE chatlive_ro`.
Notes: the Grafana alert rules are provisioned, so they are read-only in the UI (copy to edit). The Watchdog is dropped by the bridge by design; it shows as `crm_chat_bridge_last_watchdog_timestamp_seconds`. Identical statements that differ only in literals are one normalized query (deduped for the 15 min cooldown), so use different statements to see several cards.

## Autonomy: threads, diagnosis, accuracy, resolver
**Channels.** Three spaces only: `critical`, `other`, `deploy` (`/run/secrets/gchat_{critical,other,deploy}_url`). Slow-query cards go to `other` and ESCALATE to `critical` when a query runs >= `CRITICAL_SLOW_SECONDS` (60) or a session holds others waiting >= `CRITICAL_BLOCK_SECONDS` (30). Metric names `crm_slow_query_*` are unchanged.

**Threads.** Every alert fingerprint is one Chat thread (`?threadKey=am-<fingerprint>&messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD` plus `thread.threadKey` in the body). The first firing card carries the diagnosis; repeats are replies ("Still firing for 14m"); `resolved` is a reply "RESOLVED after 4m 12s" with what it was, peak value seen and the diagnosis at firing. Duration uses Alertmanager's `startsAt`, so a bridge restart still posts a correct resolve (the in-memory map, max 500 entries, 7-day TTL, only loses the peak and diagnosis). Slow queries: when the session is gone at the next poll, a reply "RESOLVED after N s (finished on its own)" is posted in the same thread (exact end is within one poll interval).

**Diagnosis ("why" and "what to do").** `tools/chat-bridge/diagnosis.mjs` maps every alertname in `deploy/observability/*.rules.yml` to meaning, ordered likely causes, what to check, suggested action, runbook link and the Prometheus queries used as live evidence (current value, value 15 min ago, trend up/flat/down, related metrics: DB pool, event loop, queue age, Redis memory...). A unit test fails when a rule has no entry. Prometheus is `PROMETHEUS_URL` (default `http://prometheus:9090`), 2 s timeout, evidence is dropped (never delivery) when it is slow or down. Evidence queries are global (`max(...)`), not scoped to the alert's instance.

**Slow-query accuracy rules (no myths).** Each `pg_stat_activity` row is classified before alerting: excluded (autovacuum, replication users, `pg_dump`/backup/migration applications, the watcher itself: regex `SLOW_EXCLUDE_APP_REGEX` / `SLOW_EXCLUDE_USER_REGEX`); `idle in transaction` (reported separately as "not a slow query", only after `SLOW_IDLE_TX_SECONDS`, 60); lock waits (`pg_blocking_pids`, reported as "Lock wait (blocked by pid N)" with the blocker's normalized query and age, never as slow); everything else >= `SLOW_RUNNING_SECONDS` is "Slow execution". Every card carries a verifiable evidence line (pid, `query_start`, state, wait_event, xact age) and a second source (`pg_stat_statements` calls/mean/max by `query_id`). The statement path now needs the NEW calls since the last poll to be slow too (a high lifetime mean with fast recent calls is not alerted). EXPLAIN is plain (never ANALYZE), only for a pure SELECT whose normalized text has no literal or parameter (nothing was stripped), otherwise the card says it was skipped; table sizes come from `pg_total_relation_size`.

**Measured accuracy** (harness `tools/chat-bridge/accuracy/run.mjs`, run by `script-testing/chat-alerts/run.sh`; thresholds scaled 1/10: running 3 s, critical 8 s, blocker critical 4 s, poll 1 s; production defaults are asserted on the pure classifier):
| Scenario | Runs | TP | FN | FP | Detection latency avg / max (s) |
|---|---|---|---|---|---|
| fast queries | 3 | 0 | 0 | 0 | - |
| slow pg_sleep 6 s (<critical) | 3 | 3 | 0 | 0 | 3.1 / 3.1 |
| heavy aggregate | 3 | 3 | 0 | 0 | 3.1 / 3.1 |
| critical slow 11 s (>=critical) | 3 | 3 | 0 | 0 | 3.1 / 3.1 |
| lock wait: waiter | 3 | 3 | 0 | 0 | 3.1 / 3.1 |
| lock wait: blocker (idle in tx) | 3 | 3 | 0 | 0 | 3.1 / 3.1 |
| idle in transaction | 3 | 3 | 0 | 0 | 3.1 / 3.1 |
| allow-listed pg_dump | 3 | 0 | 0 | 0 | - |
| allow-listed migration job | 3 | 0 | 0 | 0 | - |
| burst of identical statements | 3 | 0 | 0 | 0 | - |
| statement slow only once | 3 | 0 | 0 | 0 | - |
| recurring slow statement 0.6 s | 0 | - | - | - | UNMEASURABLE here: pg_stat_statements on the shared server evicted the fresh entry in every run |
| clock edge: ends just before threshold (2 s) | 3 | 0 | 0 | 0 | - |
| clock edge: 3.4 s (threshold 3 s + poll 1 s, may be missed) | 3 | 3 | 0 | 0 | indeterminate (not scored) |

Overall (3 trials): **precision 1.000, recall 1.000**, TP 18, FN 0, FP 0. Pass thresholds: precision >= 0.95, recall >= 0.9 for queries >= threshold + poll interval. Escalation (6 s -> Other, 11 s and 4 s-waiter -> Critical) and the resolve reply in the same thread were 3/3. Latency is about threshold + one poll (3 s + 1 s) as designed. Run on a shared dev Postgres 16 (one machine, 3 trials), not on production load.


**Resolver (incident lifecycle).** `tools/chat-bridge/resolver.mjs`. Replies in the alert's thread: DIAGNOSED -> ACTION -> VERIFIED (the same check stays clear for `VERIFY_SECONDS`, 120) -> RESOLVED ("resolved by <playbook>, after N min"), or ESCALATED to `critical` ("NOT resolved, needs a human", with evidence) when the action fails, verification fails or no safe playbook exists. RESOLVED is only posted after verification; an alert Alertmanager clears with no action is reported as "cleared on its own". `GET /incidents` (read-only JSON) and `crm_incident_total{playbook,outcome}` show the state; `POST /release {"sha":"..."}` (call it from the deploy step) lets a code-fix incident resolve "by release <sha>".

| Playbook | Autonomous? | Preconditions | Verification | Rollback |
|---|---|---|---|---|
| `cancel_select` (runaway SELECT, `pg_cancel_backend`) | yes, only with `AUTO_REMEDIATE=on` and the separate cancel role | pure SELECT (no write/DDL/lock/function-with-effects keywords), running >= `HARD_CANCEL_SECONDS` (120), not allow-listed, if it blocks others then for >= 30 s, same `query_start` re-checked right before | pid no longer active with that query | none needed; the client may retry |
| `terminate_idle` (`pg_terminate_backend`) | yes, same switches | ONLY `idle in transaction`, idle >= `IDLE_BLOCKER_SECONDS` (60), blocking >= 1 session, not allow-listed; active sessions are never terminated | backend gone | its open transaction is rolled back, the app reconnects |
| `db_pool` (DbPoolExhausted/Saturated) | yes: runs the two above on the offenders | each offender passes its own preconditions | `max(crm_db_pool_waiting) == 0` for `VERIFY_SECONDS` | as above |
| `code_fix` (recurring slow statement, new calls slow for `STMT_RECURRING_POLLS` polls, 3) | NO runtime fix: writes `incidents/open/<id>.json` ("needs a code/index fix: ticket opened") for a Claude Code routine / human | none | resolved only when new calls stay fast for N polls (by release sha if `/release` was called) | file moves to `incidents/resolved/` |
| `service` (worker down, queue backlog, Redis memory...) | NO: executor interface only (`executors` map), none wired (no docker socket in this PR) | n/a | executor-provided | n/a |

Safety model: `AUTO_REMEDIATE=off|dry-run|on`, default **dry-run** (an unknown value also means dry-run): the thread gets "DRY-RUN: would cancel pid N (SELECT ..., running 143 s) - set AUTO_REMEDIATE=on to enable" and nothing runs. Even with `on`, nothing happens unless `secrets/slow_query_cancel_pg_url` exists (role from `create-cancel-role.sql`: `pg_signal_backend`, no table access); without it the incident is "suggested" and ESCALATED. Per playbook rate limit `AUTO_REMEDIATE_MAX_PER_HOUR` (3), every decision is one `remediation_audit` JSON log line (no query literals). Nothing destructive is enabled by default. Known gap: a SELECT that calls a volatile function with side effects cannot be detected by text.

**Env vars (bridge service).** `PROMETHEUS_URL`, `SLOW_EXCLUDE_APP_REGEX`, `SLOW_EXCLUDE_USER_REGEX`, `SLOW_IDLE_TX_SECONDS` 60, `CRITICAL_SLOW_SECONDS` 60, `CRITICAL_BLOCK_SECONDS` 30, `AUTO_REMEDIATE` dry-run, `HARD_CANCEL_SECONDS` 120, `CANCEL_BLOCKER_SECONDS` 30, `IDLE_BLOCKER_SECONDS` 60, `VERIFY_SECONDS` 120, `VERIFY_POLL_MS` 2000, `AUTO_REMEDIATE_MAX_PER_HOUR` 3, `STMT_RECURRING_POLLS` 3, `INCIDENTS_DIR` (default `./incidents`, needs a writable volume for code-fix files), `SLOW_CANCEL_PG_URL_FILE` (default `/run/secrets/slow_query_cancel_pg_url`, optional).
