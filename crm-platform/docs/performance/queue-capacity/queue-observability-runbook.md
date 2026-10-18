# Queue observability runbook

Signals come from the worker process (`QueueDepthService`, `JobMetricsService`) on the metrics port (`OBS_METRICS_PORT`). Alerts:
`deploy/observability/queue-capacity.rules.yml`.

| Metric | Meaning |
| --- | --- |
| `crm_queue_jobs_pending{queue,state}` | waiting (runnable, not started), active, delayed (scheduled or backing off), failed |
| `crm_queue_oldest_waiting_seconds{queue}` | age of the oldest runnable job: the customer-delay signal. Sampled every 15 s |
| `crm_queue_job_wait_seconds{queue}` | histogram: enqueue to start, excluding asked-for delay and retries |
| `crm_queue_job_duration_seconds{queue}` | histogram: processing time |
| `crm_queue_jobs_total{queue,outcome}` | completions and failures; `rate()` is the completion rate |
| `crm_queue_job_retries_total{queue}` | extra starts: retries and stall restarts |
| `crm_event_loop_*`, `crm_process_*` | worker CPU, heap, loop lag (shared with the event-loop runbook) |

## Which alert, what first

1. **CriticalQueueOldestJobAge** (waba-ingest, webhook-ingest, webhook-retry, telephony-ingest). Customer messages already acknowledged to the provider.
   1. Is the worker up? `crm_runtime_last_report_timestamp_seconds{service="worker"}` stale means the process is down or hung.
   2. Is it slow or stopped? `rate(crm_queue_jobs_total{queue="<q>"}[5m])` is 0: stopped. Non-zero but below arrivals: slow.
   3. Slow: look at `crm_event_loop_delay_p99_seconds{service="worker"}`. High means something CPU-heavy shares the worker process (see isolation finding in `queue-infrastructure-bottlenecks.md`). Low means Postgres: check pool and slow queries.
   4. Do NOT add replicas until step 3 says the loop and Postgres have headroom.
2. **InteractiveQueueOldestJobAge** (message-dispatch, web-push, media-fetch). Same sequence; add the provider's 429 rate.
3. **BulkQueueBacklogNotDraining.** Usually the provider ceiling. Check `crm_queue_job_retries_total` and the channel's own rate limit before scaling.
4. **QueueRetryAmplification.** A retry storm. Pause the producer or lower concurrency; retries beyond the provider ceiling fail jobs for good (measured: 77% of jobs exhausted five attempts at 100 req/s ceiling without a limiter).

## Forecast drain time by hand

`T = backlog / (completion rate - arrival rate)`, rates from `rate(crm_queue_jobs_total[5m])` and the arrival rate you can see at the producer. Only valid when completion rate exceeds arrivals and the jobs are runnable (not delayed).

## Reproduce a capacity run

```bash
node tools/queue-capacity/inventory.mjs --check
node --test tools/queue-capacity/model.test.mjs
node tools/queue-capacity/bench.mjs --scenarios sweep,drain,profiles,isolation,fairness,provider,crash,redis,soak
node tools/queue-capacity/report.mjs
```

The harness starts its own `redis-server` on port 6390 and never touches `REDIS_URL`.
