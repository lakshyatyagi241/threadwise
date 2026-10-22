// Runbook-driven diagnosis: every alertname in deploy/observability/*.rules.yml (except Watchdog) has an entry here; a unit test fails
// when a rule has none. Evidence is queried live from Prometheus (2 s timeout, never blocks delivery). Remediation here is SUGGEST ONLY.
const P0 = 'docs/runbooks/p0-failure-modes.md', GC = 'docs/runbooks/google-chat-alerts.md';
const DB = ['DB pool waiting', 'max(crm_db_pool_waiting)'], LOOP = ['Event-loop p95 (s)', 'max(crm_event_loop_delay_p95_seconds)'], QD = ['Oldest waiting job (s)', 'max(crm_queue_oldest_waiting_seconds)'];
const RMEM = ['Redis memory used / max', 'max(crm_redis_memory_used_bytes) / (max(crm_redis_memory_max_bytes) > 0)'], HEAP = ['Heap used / limit', 'max(crm_process_heap_used_bytes / crm_process_heap_limit_bytes)'];
const CMEM = ['Container memory / limit', 'max(crm_container_memory_bytes / crm_container_memory_limit_bytes)'];
const ERR = ['5xx ratio', 'sum(rate(crm_http_request_duration_seconds_count{status=~"5.."}[5m])) / sum(rate(crm_http_request_duration_seconds_count[5m]))'];
export const DIAG = {};
const def = (names, d) => { for (const n of names.split(' ')) DIAG[n] = { rb: `${GC}#${n.toLowerCase()}`, ...d }; };

def('CriticalQueueOldestJobAge InteractiveQueueOldestJobAge AutomationQueueOldestJobAge', { meaning: 'Jobs wait too long before a worker picks them up: customers see delayed messages or automations.',
  causes: ['Workers down, crash-looping or blocked event loop', 'A burst larger than worker concurrency', 'Slow downstream (DB pool exhausted, provider API throttling)', 'Redis latency or memory pressure'],
  check: ['Worker pods up? (RuntimeMetricsTargetDown)', 'Event-loop delay and DB pool waiting (evidence below)', 'Failed or retried jobs on the same queue'], action: 'Restart or scale the worker service; if a provider is throttling, wait and watch retries.', q: [QD, LOOP, DB, RMEM] });
def('BulkQueueBacklogNotDraining WabaIngestBacklogGrowing', { meaning: 'A backlog keeps growing: work arrives faster than it is processed.',
  causes: ['Big import or broadcast just started (expected, check size)', 'Worker concurrency too low or workers stopped', 'Downstream provider throttling', 'Poison jobs retrying forever'], check: ['Backlog deriv and arrival rate', 'Worker count and event-loop delay', 'Failed jobs growing?'], action: 'If it is a planned bulk run, wait. Otherwise scale workers or pause the producer; clear the queue only with the owner approval.', q: [['Waiting jobs', 'sum(crm_queue_jobs_pending{state="waiting"})'], QD, LOOP] });
def('QueueFailedJobsGrowing QueueRetryAmplification', { meaning: 'Jobs fail or retry in large numbers (retry storm).',
  causes: ['A provider or internal dependency is failing', 'A bad deploy introduced an exception', 'Poison payload retried repeatedly', 'Provider rate limit (429) causing retries'], check: ['Error logs for the queue name', 'Last deploy time', 'Provider status page'], action: 'Roll back the last deploy if it correlates; otherwise fix the dependency. Failed jobs are retained, do not purge.', q: [['Failed jobs (15 min)', 'sum(increase(crm_queue_jobs_total{outcome="failed"}[15m]))'], ['Retries/s', 'sum(rate(crm_queue_job_retries_total[10m]))'], DB] });
def('EventLoopDelayP95Warning EventLoopDelayP99Warning EventLoopUtilizationHigh GcPauseHigh EventLoopLongStallWarning EventLoopLongStallCritical', { meaning: 'The Node event loop is busy or stalled, so every request and job on that process waits.',
  causes: ['Synchronous CPU work (big JSON, regex, crypto, report generation)', 'Large heap and frequent GC pauses', 'CPU throttling by the container cgroup', 'Traffic spike beyond capacity'], check: ['Heap and GC pause (evidence)', 'CPU throttle metric', 'Which route or job ran at that time (traces, logs)'], action: 'Find the blocking code path from traces; scale out the service or raise its CPU limit as a stopgap.', q: [LOOP, ['Event-loop utilization', 'max(crm_event_loop_utilization_ratio)'], ['GC pause max (s)', 'max(crm_gc_pause_max_seconds)'], HEAP] });
def('EventLoopBlockingWithImpact WorkerEventLoopBlockingWithQueueImpact WebEventLoopBlockingWithImpact', { meaning: 'The event loop is blocked AND users or queues are measurably affected.',
  causes: ['Synchronous heavy work on the hot path', 'GC thrash near the heap limit', 'CPU throttled by cgroup'], check: ['Event-loop delay max', 'Heap ratio', 'CPU throttle'], action: 'Restart the affected instance to recover, then profile the blocking path.', q: [LOOP, QD, HEAP] });
def('ContainerCpuThrottled', { meaning: 'The cgroup limits CPU, so the process is paused by the kernel.', causes: ['CPU limit too low for load', 'Busy loop or heavy synchronous work', 'Traffic spike'], check: ['Event-loop utilization', 'Request rate'], action: 'Raise the CPU limit or scale out; find the hot code path.', q: [['Throttle s/s', 'max(rate(crm_container_cpu_throttled_seconds_total[5m]))'], LOOP] });
def('ProcessHeapNearLimit HeapNearOom ContainerMemoryNearLimit ContainerMemoryCritical ContainerOomKilled ProcessRestartLoop ContainerPidsNearLimit', { meaning: 'Memory (or PIDs) near the limit: the process may be OOM-killed and restart, dropping in-flight work.',
  causes: ['Memory leak (steady upward trend)', 'Large payloads or unbounded caches', 'Limit too low for current load', 'Leaked child processes or threads (PIDs)'], check: ['15-min trend: rising = leak, flat = undersized', 'Restart count', 'Last deploy'], action: 'Restart the instance to buy time, raise the limit if flat, and take a heap snapshot if the trend rises.', q: [HEAP, CMEM, ['Restarts (30 min)', 'max(changes(crm_process_start_time_seconds[30m]))'], ['OOM kills (15 min)', 'sum(increase(crm_container_oom_kills_total[15m]))']] });
def('ApiCallerLatencyHigh ApiProbeFailing', { meaning: 'The synthetic probe sees slow or no answers from the API, the same as a customer would.',
  causes: ['API down or restarting', 'Event loop blocked or DB pool exhausted', 'Reverse proxy or network problem', 'Slow SQL (see slow-query cards)'], check: ['crm_probe_up and RuntimeMetricsTargetDown', 'DB pool and event loop', 'Proxy logs'], action: 'Check the API health endpoint; restart the API if hung; fail over only with the owner approval.', q: [['Probe up (min)', 'min(crm_probe_up)'], DB, LOOP] });
def('RuntimeMetricsStale RuntimeMetricsTargetDown', { meaning: 'Metrics from a service stopped arriving: either the service is down or only its metrics are broken. All other alerts for it are blind meanwhile.',
  causes: ['Service crashed or restarting', 'Scrape token or network changed', 'Metrics endpoint blocked by a stalled event loop'], check: ['Is the service really up (health endpoint)?', 'Prometheus targets page'], action: 'Restart the service if down; fix the scrape config/token if only metrics are missing.', q: [['Targets down', 'count(up{job=~"crm-(api|worker|web|probe)"} == 0) or vector(0)']] });
def('ApiHighErrorRate', { meaning: 'More than 5 percent of requests fail with 5xx.', causes: ['Bad deploy', 'Database or Redis down or saturated', 'Downstream provider failing', 'Unhandled exception on a hot route'], check: ['Error logs by route', 'Deploy time', 'DB pool and Redis (evidence)'], action: 'Roll back the last deploy if the timing matches; otherwise fix the failing dependency.', rb: `${P0}#apihigherrorrate`, q: [ERR, DB, ['Redis up (min)', 'min(crm_redis_up)']] });
def('RedisDown', { meaning: 'Redis does not answer INFO: queues, cache, rate limits and realtime are affected.', causes: ['Redis container stopped or OOM-killed', 'Network or DNS issue', 'Redis blocked by a huge command or save'], check: ['Redis container status/logs', 'Memory vs maxmemory'], action: 'Restart the Redis container if stopped (data is persisted by AOF/RDB per config).', rb: `${P0}#redisdown`, q: [['Redis up (min)', 'min(crm_redis_up)'], RMEM] });
def('RedisMemoryNearMax', { meaning: 'Redis is near maxmemory: eviction or write errors follow.', causes: ['Queue backlog stored in Redis', 'Keys without TTL', 'maxmemory too small'], check: ['Biggest key families', 'Queue depth (evidence)'], action: 'Drain the backlog or raise maxmemory. Do not FLUSH.', rb: `${P0}#redismemorynearmax`, q: [RMEM, ['Waiting jobs', 'sum(crm_queue_jobs_pending{state="waiting"})']] });
def('DbPoolExhausted DbPoolSaturated', { meaning: 'Requests wait for a Postgres connection from the pool.', causes: ['Slow or locked queries holding connections (see slow-query cards)', 'Idle-in-transaction connections', 'Pool too small for load', 'Connection leak'], check: ['slow-query cards for blocked/idle-in-tx', 'pg_stat_activity states', 'Pool waiting trend'], action: 'Find and fix the holder of connections (cancel a runaway SELECT); raise pool size only after that.', rb: `${P0}#dbpoolexhausted`, q: [DB, ['DB pool in use', 'max(crm_db_pool_in_use)'], LOOP] });
def('OutboxNotDraining OutboxDeadRows DeadLetterOpenTooLong DeadLetterCaptureFailing', { meaning: 'Durable events or failed operations are stuck, retried out, or cannot be recorded: data may be delayed or lost.',
  causes: ['Outbox publisher or worker down', 'Poison event failing every retry', 'Database problem (slow or full)', 'Downstream consumer failing'], check: ['Outbox oldest-due age and dead count', 'Worker logs', 'DB health'], action: 'Fix the cause then replay dead rows via the runbook; never delete them.', rb: `${P0}#${'outboxnotdraining'}`, q: [['Outbox oldest due (s)', 'max(crm_outbox_oldest_due_seconds)'], ['Outbox dead', 'max(crm_outbox_dead)'], ['Oldest open dead letter (s)', 'max(crm_dead_letter_oldest_open_seconds)']] });
def('CacheHitRatioLow CacheErrorRatioHigh CacheMetricsMissing', { meaning: 'The cache is ineffective or failing, so more load reaches Postgres.', causes: ['Redis problem (errors)', 'Key churn or TTL too short after a deploy', 'Cold cache after restart (hit ratio only)', 'Metrics exporter removed (missing)'], check: ['Cache error ratio', 'Redis health', 'Deploy time'], action: 'Fix Redis first; a cold cache recovers by itself within the TTL.', q: [['Cache errors/s', 'sum(rate(crm_cache_errors_total[5m]))'], ['Redis up (min)', 'min(crm_redis_up)']] });
def('WebhookRateHigh WebhookLatencyHigh', { meaning: 'Public webhooks arrive in a flood or are slow to accept.', causes: ['Provider retry storm or replay', 'Abuse or misconfigured integration', 'Slow ingest (DB or queue)'], check: ['Top sender/route in logs', 'Ingest queue age'], action: 'Rate-limit or block the noisy sender at the proxy; check ingest queue.', rb: `${P0}#webhookflood`, q: [['Webhook req/s', 'sum(rate(crm_http_request_duration_seconds_count{route=~".*/webhooks/.*"}[5m]))'], QD, DB] });
def('SlowQueryBurst', { meaning: 'Several slow queries were seen in 10 minutes.', causes: ['A missing index or a heavy report', 'Lock contention (blocked, not slow)', 'Autovacuum or backup (should be excluded)'], check: ['Each card verdict: blocked vs slow vs idle-in-tx', 'Query text and table size'], action: 'Fix the top query (index/limit); cancel a runaway SELECT (auto-remediation is dry-run by default).', q: [['Slow events (10 min)', 'sum(increase(crm_slow_query_events_total{kind=~"running|statement"}[10m]))'], DB] });
def('SlowQueryWatcherDown ChatBridgeDeliveryFailing ChatBridgeNoWatchdog', { meaning: 'The alert pipeline itself is degraded: alerts may not reach Google Chat.', causes: ['Bridge container down', 'Webhook URL revoked or Chat outage', 'Alertmanager route changed', 'Watcher DB credentials expired'], check: ['Bridge /health and logs', 'crm_chat_bridge_failed_total'], action: 'Restart the bridge; recreate the Chat webhook if revoked (docs/runbooks/google-chat-alerts-grafana-deploy.md).', q: [['Failed deliveries (15 min)', 'sum(increase(crm_chat_bridge_failed_total[15m]))']] });

const ruleNames = (text) => [...text.matchAll(/^\s*-\s*alert:\s*(\S+)/gm)].map((m) => m[1]);
export { ruleNames };

const trendOf = (now, then) => (then == null || !isFinite(then) ? 'n/a' : Math.abs(now - then) <= Math.max(Math.abs(then) * 0.1, 1e-9) ? 'flat' : now > then ? 'up' : 'down');
const num = (v) => (v == null ? '-' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toPrecision(2));

// -> { rows: [[label, text]], value, summary } ; never throws, always resolves within ~2.5 s.
export async function diagnose(alert, { env = process.env, fetchImpl = fetch } = {}) {
  const name = alert.labels?.alertname, d = DIAG[name];
  const base = { entry: d ?? null, rows: [], value: null };
  if (!d) return base;
  const url = (env.PROMETHEUS_URL ?? 'http://prometheus:9090').replace(/\/$/, '');
  const q = async (expr) => {
    const r = await fetchImpl(`${url}/api/v1/query?query=${encodeURIComponent(expr)}`, { signal: AbortSignal.timeout(2000) });
    const v = Number((await r.json())?.data?.result?.[0]?.value?.[1]);
    return Number.isFinite(v) ? v : null;
  };
  try {
    await Promise.race([new Promise((r) => setTimeout(r, 2500)), Promise.all(d.q.slice(0, 4).map(async ([label, expr], i) => {
      const [now, then] = await Promise.allSettled([q(expr), q(`(${expr}) offset 15m`)]).then((x) => x.map((y) => (y.status === 'fulfilled' ? y.value : null)));
      if (now == null) return;
      base.rows.push([i, label, `${num(now)} (15 min ago ${num(then)}, trend ${trendOf(now, then)})`]);
      if (i === 0) base.value = now;
    }))]);
  } catch { /* evidence is best effort */ }
  base.rows.sort((a, b) => a[0] - b[0]);
  base.rows = base.rows.map(([, k, v]) => [k, v]);
  return base;
}

// Widgets rows for the card: why (meaning, ordered causes), what to check, what to do (suggestion only), live evidence.
export function diagnosisRows(alert, ev) {
  const d = ev.entry;
  if (!d) return [['Diagnosis', 'No runbook entry for this alert (add one in tools/chat-bridge/diagnosis.mjs).']];
  return [['What it means', d.meaning], ['Likely causes (most likely first)', d.causes.map((c, i) => `${i + 1}. ${c}`).join('\n')], ...(ev.rows.length ? [['Live evidence (Prometheus)', ev.rows.map(([k, v]) => `${k}: ${v}`).join('\n')]] : [['Live evidence', 'unavailable (Prometheus unreachable or no data)']]),
    ['What to check', d.check.map((c) => `- ${c}`).join('\n')], ['Suggested action (never auto-executed)', d.action]];
}
