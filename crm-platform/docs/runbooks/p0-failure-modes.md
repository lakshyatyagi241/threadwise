# Runbook: P0 failure modes

One section per alert in `deploy/observability/p0-failure-modes.rules.yml`. Section ids match the `runbook` annotation (checked by
`tools/alerting/check-alert-runbooks.mjs`). The matrix of every failure mode, alert and gap is `docs/performance/alerting/failure-modes.json`.
Escalation: first responder is whoever holds the on-call pager (the PagerDuty/Slack receiver in `deploy/observability/alertmanager*.yml`);
if not resolved in 30 minutes for a critical alert, escalate to the platform owner (Vedant) and then the CTO.

## RedisDown

**Means:** the API or worker cannot get an answer to `INFO` from Redis for 2 minutes. Queues, cache, sessions and rate limits are broken; no
background job runs.
**Check:** `docker compose ps redis`; `docker compose logs --tail=100 redis`; `redis-cli -u "$REDIS_URL" ping`; `docker inspect redis --format '{{.State.OOMKilled}}'`.
**Fix:** restart the container (`docker compose restart redis`); if it was OOM-killed raise its memory limit or `maxmemory` (see RedisMemoryNearMax).
After it is back, `CriticalQueueOldestJobAge` should clear within minutes as the worker drains; confirm with `crm_queue_oldest_waiting_seconds`.
**Escalate:** if Redis does not come back after one restart or persistence files are corrupt, platform owner.

## RedisMemoryNearMax

**Means:** `crm_redis_memory_used_bytes` is over 90% of `crm_redis_memory_max_bytes` for 5 minutes. At 100% Redis evicts keys or rejects writes
(cache misses, failed enqueues). The alert is silent when `maxmemory` is 0 (unlimited): then the host itself is the limit, see ContainerMemoryNearLimit.
**Check:** `redis-cli info memory`; `redis-cli --bigkeys`; `crm_redis_evicted_keys_total`; which queue keys are large (a stuck queue with a huge backlog).
**Fix:** drain or fix the backlog that is filling it (see CriticalQueueOldestJobAge), remove stale keys by prefix, or raise `maxmemory`. Never FLUSHALL in production.
**Escalate:** platform owner if the memory is queue data you cannot delete.

## DbPoolExhausted

**Means:** callers have waited for a Postgres connection (`crm_db_pool_waiting` > 0) for 3 minutes; the pool of `crm_db_pool_max` is full.
Requests time out. Postgres being unreachable or slow shows the same way (also see ApiProbeFailing).
**Check:** `select state, count(*) from pg_stat_activity group by 1;` and the longest queries: `select now()-query_start, state, left(query,100) from pg_stat_activity order by 1 desc limit 10;`;
`crm_db_pool_connections{state="idle"}`; look for a transaction left open (`idle in transaction`).
**Fix:** terminate stuck sessions (`select pg_terminate_backend(pid)`), restart the API if connections leak, then find the slow query or raise `DB_POOL_MAX` within Postgres `max_connections`.
**Escalate:** database owner if Postgres itself is down or `max_connections` is the limit.

## OutboxNotDraining

**Means:** the oldest due event in `event_outbox` has been due for over 5 minutes (`crm_outbox_oldest_due_seconds`). Side effects (automations,
notifications, counters, realtime) are not happening. Business data is still correct.
**Check:** is the worker up (`up{job="crm-worker"}`, `docker compose ps worker`)? Worker logs. Follow `docs/runbooks/outbox-backlog.md` sections 1 to 3.
**Fix:** restart the worker; if one event poisons the batch, mark it dead as described in outbox-backlog.md; then replay dead rows.
**Escalate:** platform owner if the drain loop is running but the lag keeps growing.

## OutboxDeadRows

**Means:** `crm_outbox_dead` > 0 for 10 minutes: events exhausted their retries and will not be delivered without a replay.
**Check:** `select id, type, last_error from event_outbox where status = 'dead' order by created_at desc limit 20;`
**Fix:** fix the cause (usually a consumer bug or a down provider), then replay as in `docs/runbooks/outbox-backlog.md` and `docs/runbooks/failed-background-work.md`.
**Escalate:** the owner of the failing consumer module.

## DeadLetterOpenTooLong

**Means:** a failed operation (webhook delivery, provider send, background job) recorded in the durable failure store has been open for over an hour
(`crm_dead_letter_oldest_open_seconds`). Customers may be missing messages or events.
**Check:** the failed operations list and the replay steps in `docs/runbooks/failed-background-work.md`; group by queue (the `queue` label).
**Fix:** fix the cause (provider outage, bad credentials, payload bug), replay, or close with a reason if it is truly not recoverable.
**Escalate:** the channel/provider owner for the queue named in the alert.

## ApiHighErrorRate

**Means:** more than 5% of requests of the service answer a 5xx for 5 minutes (and the service sees at least 0.1 request/s).
**Check:** `crm_http_request_duration_seconds_count{status="5xx"}` by `route` to find the route; API logs filtered by status 5xx (the request id is in the log and the response); is Postgres or Redis down (RedisDown, DbPoolExhausted, ApiProbeFailing)?
**Fix:** if it started with a deploy, roll back the release (`deploy/hostinger/README.md`); if a dependency is down, fix that first.
**Escalate:** platform owner if the route is unknown or errors continue after rollback.

## Existing alerts and their runbooks

The alerts that existed before this file keep their runbooks: queue alerts in `docs/performance/queue-capacity/queue-observability-runbook.md`,
event-loop, restart and metrics-pipeline alerts in `docs/performance/event-loop/event-loop-observability-runbook.md`, cache alerts in
`docs/runbooks/cache-hit-rate.md`, container memory/OOM/PID/CPU alerts in `docs/performance/resource-limits/`. The matrix maps each one.

## Failure modes with no alert yet

Backup failure, disk full, certificate expiry, Postgres replica lag, slow queries, login failure spike, provider send failure rate, deploy failure and a
dead Prometheus/Alertmanager have no metric in this codebase today. The exact metric each needs is listed in `docs/performance/alerting/failure-modes.json`
(`gap.missingMetric`). Until then check by hand: `docs/runbooks/backup-restore.md` ("Check that it is working"), `df -h`, `docker compose ps`.

## DeadLetterCaptureFailing

**Means:** `crm_dead_letter_capture_failures_total` grew in the last 10 minutes: a failed job or webhook could not be saved into `failed_operations`,
so it can no longer be found or replayed (the BullMQ failed set is the only copy, and it is trimmed).
**Check:** worker logs around the failure; Postgres reachable (`DbPoolExhausted`, `ApiProbeFailing`); `select count(*) from failed_operations;` works; table locks (`pg_locks`).
**Fix:** restore the database; then list failed jobs still in Redis (`docs/runbooks/failed-background-work.md`) and capture or replay them by hand before the queue trims them.
**Escalate:** platform owner immediately if the database is healthy and captures still fail (a code or schema bug).
