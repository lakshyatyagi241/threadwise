# Queue scaling plan

Stage 1 (now): fixed worker count, explicit concurrency, measure. Do not add Kubernetes/KEDA or a new broker: BullMQ on Redis handled 4,500 io jobs/s on one process, far above any measured need.

## Order of work

1. Ship the depth/age exporter and alerts (done in this change; alerts not promtool-verified).
2. Split the worker into at least two processes from the same image: **inbound/interactive** (waba-ingest, webhook-ingest, webhook-retry, telephony-ingest, message-dispatch, web-push, media-fetch, flow-run) and **bulk/maintenance** (broadcasts, imports, exports, sweeps). Evidence: finding 2 in `queue-infrastructure-bottlenecks.md`. Needs an env switch listing the queues a process serves; processors are registered by `WORKER_MODE` today.
3. Add `limiter` to provider-facing queues from the provider's documented ceiling (message-dispatch, broadcast queues, webhook-deliver), so more replicas cannot raise 429s. Limiters in BullMQ are per queue across all workers.
4. Per-tenant admission cap for broadcast/campaign producers (prototype measured: 300 queued per tenant).
5. Scale-out by replicas only when `crm_queue_oldest_waiting_seconds` breaches the class SLO AND worker loop delay / DB pool / provider headroom allow it. `lib/model.mjs scaleDecision` encodes this with hysteresis; it is not wired to any deployment.

## Triggers (initial)

Scale out: oldest waiting age above the class SLO for 2 to 5 min, or utilization above 80%. Scale in: utilization below 40% and age below half the SLO for 10 min, one replica at a time. Ceiling: min(budget, DB connections / connections per replica). Provider-bound queues never scale on depth.
