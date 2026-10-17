# Async discovery 01: core infrastructure

Scope: queue technology, worker bootstrap, the Postgres outbox, schedulers, health/metrics, tenant context, shutdown.
Method: code read, paths relative to `crm-platform/`. `file:line` evidence throughout. A control is marked OK only where code was read; config alone is not accepted. "Test" names the spec that covers the behaviour, or "none".
Not done: no process was run, `node_modules` is absent in this worktree (so `@nestjs/bullmq` / `@nestjs/schedule` shutdown ordering is unverified), and the ~45 non-core sweeps were sampled, not all read.

## 1. What is actually in use

Two mechanisms side by side, not one:

| Mechanism | Role | Evidence |
| --- | --- | --- |
| Postgres `event_outbox` + polling drain (`FOR UPDATE SKIP LOCKED`) | domain events, fan-out to in-process subscribers | `apps/api/src/workers/outbox-drain.service.ts:62-146` |
| BullMQ on Redis, 48 queue names registered, 42 with a `@Processor` | per-job work (sends, ingest, exports, syncs) | `apps/api/src/infra/queue/queues.ts:10-107`, `queue.module.ts:39-41` |
| `@nestjs/schedule` (`@Interval`/`@Cron`) | 79 files, about 90 timers: sweeps, recovery, retention, cron | `ScheduleModule.forRoot()` at `workers/workers.module.ts:85` |
| DB-state-as-truth + sweeper | the "no lost job" mechanism for BullMQ enqueues (see 2.2, D6) | e.g. `chat-conversations/queued-message-recovery.service.ts:36-80` |

The outbox is NOT a BullMQ queue. `QUEUES.OUTBOX = 'outbox'` (`queues.ts:12`) is registered but has no processor; the comment "Drains event_outbox" is stale. Six registered queues have no `@Processor`: `outbox`, `billing-posting`, `sla-sweep`, `counter-flush`, `partition-maintenance`, `bulk-jobs`.

### Bootstrap and deployment

- Two entrypoints, one image: API `apps/api/src/main.ts`, worker `apps/api/src/worker.ts:11-30` (`NestFactory.createApplicationContext(WorkerModule)`, no HTTP). `WorkersModule` is imported by the worker only (`worker.module.ts:54`, `workers.module.ts:71-81`).
- Everything (outbox drain, about 42 BullMQ processors, about 90 timers, Baileys device runtime) runs in ONE Node process. One event loop; a blocking handler delays all of it.
- Deploy: `deploy/hostinger/docker-compose.yml:345-375` single `worker` service, no `replicas`, `stop_grace_period: 60s`, custom healthcheck via Redis heartbeat (`worker-probe.js`). `docker-compose.prod.yml:31-46` worker has NO `stop_grace_period` and NO healthcheck (Docker default 10 s kill).
- Redis: `--appendonly yes --maxmemory-policy noeviction`; hostinger adds `--maxmemory 192mb`, container `mem_limit: 256m` (`deploy/hostinger/docker-compose.yml:137-153`); prod compose has no maxmemory (`docker-compose.prod.yml:88-91`). AOF fsync policy is the default (everysec), not set.
- Concurrency: per processor fixed in the decorator, 1 to 16 (`@Processor(..., { concurrency: N })`, table in 7). Outbox: batch 200, up to 10 batches per 2 s tick, 6 aggregates in parallel (`OUTBOX_DRAIN_CONCURRENCY`, 1..16) (`outbox-drain.service.ts:18-37`). No `lockDuration`, `stalledInterval`, `maxStalledCount` set anywhere (grep over `apps/api/src`), so BullMQ defaults apply (30 s lock, 1 stall tolerated).
- Rate limiter: only `lead-scoring` (`lead-scoring.processor.ts:17`, `limiter: {max:5,duration:1000}`). `docs/architecture/messaging.md` says "BullMQ rate limiter at throttle_per_min"; the code paces in its own services instead.

## 2. Outbox

### 2.1 Schema (`packages/db/migrations/0006_outbox_audit.sql:17-39`, drizzle `packages/db/src/schema/ops.ts:22-44`)

`event_outbox(id bigint seq, org_id, aggregate_module, aggregate_id, event_type, payload jsonb, status default 'pending', attempts, last_error, available_at, processed_at, created_at, PK(id, created_at))`, RANGE partitioned monthly plus a DEFAULT partition. Partial index `idx_outbox_pending (available_at, id) WHERE status='pending'`; `idx_outbox_org_created`.
Status values: `pending | processing | done | dead` (comment only, no CHECK constraint). No dedup key, no `schema_version`, no `trace_id`, no per-subscriber state, no lease column.

### 2.2 Enqueue in transaction

`OutboxService.emit(tx, event)` (`kernel/outbox/outbox.service.ts:35-56`) inserts with the caller's `tx`; signature forces the same transaction as the business write. 518 call sites of `outbox.emit`/direct `INSERT INTO event_outbox` in `apps/api/src` (plus raw SQL in `crm/contact-bulk/contact-bulk.repository.ts:79-238`, `owner-reassign.repository.ts:223,259`). Payload gets `_meta {requestId, actorType, actorId}`; no payload schema or version; `orgId` from `RequestContextStore` unless overridden.
Verdict: **OK for "no lost event between commit and publish"** (event is durable with the change). Test: none dedicated; exercised incidentally through e2e specs.

BullMQ enqueues are NOT transactional. Pattern found (about 50 `queue.add` sites): commit DB state, then `queue.add`; recovery = a sweep re-reading DB state. Verified examples with recovery:
- outbound message: `chat-conversations/outbound.service.ts:348-364` (swallow enqueue error, "recovery sweep will") + `queued-message-recovery.service.ts:36-80` every 30 s, deterministic jobId.
- media fetch: `media-fetch-recovery.service.ts:37`; broadcasts: `broadcast-due.service.ts:37-69`; scheduled messages: `scheduled-due.service.ts:50`.
Unverified (not read): every other publisher. See D6.

### 2.3 Dispatcher / claimer (`outbox-drain.service.ts:86-146`)

One `db.privileged` transaction per batch does: CTE `SELECT ... WHERE status='pending' AND available_at<=now() ORDER BY created_at,id LIMIT 200 FOR UPDATE SKIP LOCKED` then `UPDATE ... SET status='processing'`, then dispatches all handlers INSIDE that transaction, then one `UPDATE` per row to `done`/`pending`(retry)/`dead`, then commits.

Consequences, from reading the code:
- `processing` is never committed, so no other session ever sees it. The row lock IS the lease. A crashed worker rolls back and rows return to `pending` on their own. The runbook's "stuck in processing" recovery (`docs/runbooks/outbox-backlog.md:45-62`) and the compose comment "its outbox rows stay in 'processing'" (`deploy/hostinger/docker-compose.yml:351-352`) describe a state that cannot occur; doc drift. Crash recovery: **OK** (by rollback), at-least-once: side effects done before the crash are redone. Test: none.
- No visibility timeout is needed, but there is also no handler timeout (D3).
- Ordering: only within one claimed batch per aggregate (`dispatchAll`, lines 153-176). Across workers, after a retry, or across batches, order is not kept; the code comment promises order only inside a batch. Test: none.

### 2.4 Retry, backoff, DLQ

- `attempts = attempts+1`; `dead = attempts >= 8`; `backoff = min(2^attempts, 900)` s (`outbox-drain.service.ts:19,121-124`). Failures at attempts 1..7 wait 2,4,8,16,32,64,128 s; the 8th failure goes `dead`. Total retry window about 254 s (about 4 minutes). The 900 s cap is unreachable and the runbook's "capped at 15 minutes" is misleading.
- No jitter. No error classification: a permanent error (bad payload) and a transient one (dependency down) burn the same budget. Subscriber errors are stringified into `last_error` (message only, no class).
- `dead` rows: log line only (`:136-139`). No metric, no alert, no API, no UI. Replay = hand-written SQL from the runbook (`outbox-backlog.md:80-84`), unaudited, unauthorized beyond DB access, resets `attempts` for ALL dead rows of an event type.
- Test: `test/unit/notifications/outbox-subscribers.spec.ts` covers the registry only (match by type, one failing subscriber does not stop others, error aggregation). Backoff, dead-letter, SKIP LOCKED concurrency: none.

### 2.5 Handler registry (`kernel/outbox/outbox-subscribers.ts:34-65`)

In-memory registry; subscribers self-register in `onModuleInit` (about 25 consumers found, e.g. `outbound-webhooks/webhook-dispatch.consumer.ts:23-36`, `notifications/*-notification.consumer.ts`, `appointments-booking/appointment-*.consumer.ts`). `dispatch` runs all matching subscribers with `Promise.allSettled` and throws an aggregate if any failed; the whole event is retried and ALL subscribers re-run (no per-subscriber delivery record). Idempotency is a convention ("handle MUST be idempotent", lines 14-19) with no enforcement; event `id` is passed through (good) and used as the BullMQ jobId by the webhook consumer (`webhook-dispatch.consumer.ts:54-66`), but BullMQ completed history is kept only 1000 jobs / 1 h (`queues.ts:124`), so a late replay after that can duplicate a webhook delivery. No payload validation: payload is `Record<string, unknown>` trusted by each consumer; no versioning. Unknown event types with zero subscribers are marked `done` silently (`:50`), so an event emitted in the API with a consumer that is not deployed/registered is dropped without trace.

### 2.6 Retention / cleanup

None. `grep` finds no `DELETE FROM event_outbox`, and `archivable_streams()` is `ARRAY['an_events']` only (`packages/db/migrations/20261218090000_drop_closed_partition.sql:21-26`). `PartitionMaintenanceService` only creates partitions (`workers/partition-maintenance.service.ts`). `done` and `dead` rows accumulate forever (D2). Test: `test/integration/partition-maintenance.spec.ts` (creation only).

## 3. Schedulers and duplicate-execution protection

All `@Interval`/`@Cron` timers run in EVERY worker process. There is no scheduler abstraction, no leader election, no run ledger, no missed-run catch-up, no timezone-pinned cron. Protection is per-sweep and ad hoc. Of 79 files, a keyword scan (`SKIP LOCKED|advisory|'NX'|jobId|RedisLock|lease`) found a guard in 33; 46 have none by keyword (list in section 8), where safety depends on idempotent SQL, which I verified only for these:
- `appointments-booking/appointment-reminder-sweep.service.ts:51-103`: `INSERT ... ON CONFLICT DO NOTHING RETURNING` plus `outbox.emit` in the same tx. OK.
- `flow-runtime-engine/triggers/schedule.sweeper.ts:90-105`: compare-and-set on `flows.trigger_last_occurrence` committed in its own tx BEFORE enrolment. Duplicate-safe, but loses the occurrence if the process dies after the CAS (D5).
- `analytics/rollup/rollup.service.ts:73` `pg_try_advisory_xact_lock`; `notifications/notification-retention.service.ts:124` same.
- Redis `SET NX PX` lease: `appointments-booking/calendar-*.jobs.ts`, `ics-feeds.jobs.ts`; `auth/maintenance/otp-template-refresh.service.ts:29`.
- BullMQ deterministic `jobId` per tick slot: `message-templates/template-sweep.processor.ts:42`.
- `@nestjs/schedule`'s overlapping-tick problem is handled by a hand-rolled `running` boolean in each service; this only protects within one process.
- A reusable `RedisLockService` exists (`platform-infrastructure/coordination/redis-lock.service.ts`, lease with renew and fencing flag) but the hand-grepped usage is limited to the platform module; most sweeps do not use it.
Test: none for the scheduler layer; per-sweep e2e only where noted by module (not enumerated here).

BullMQ repeatable jobs / `upsertJobScheduler`: not used (grep: no `repeat:`/`upsertJobScheduler`). The `repeat_every` hit is a DB column of scheduled messages.

## 4. Health, metrics, alerts

- Worker heartbeat: every `INFRA_WORKER_HEARTBEAT_SECONDS` to Redis ZSET `infra:workers` plus a capped (10 000) outbox sample `{ready, lagSeconds}` (`worker-heartbeat.service.ts:40-98`); API reads it for `/ready` (`worker-status.service.ts:45-60`). `workers.status` and `outbox.status=lagging` are informational and "cannot fail a readiness probe" (comment, line 38). Container healthcheck in the hostinger compose only. Test: `test/integration/platform-infrastructure/worker-status.spec.ts`.
- The heartbeat is a timer in the same event loop. It proves the loop turns, not that the outbox drain or any given BullMQ worker is making progress; `running` can be stuck `true` in the drain and the heartbeat still beats.
- Job metrics: wait and duration per queue, only when a job reaches a FINAL state (`job-metrics.ts:44-49`, `job-metrics.module.ts:20-35`); test `test/unit/platform-infrastructure/job-metrics.spec.ts`, `test/e2e/platform-infrastructure/worker-job-metrics.e2e.spec.ts`. A queue that has stopped completing emits nothing, so a "wait p95 > 30" alert (`deploy/observability/event-loop.rules.yml:79-92`) cannot fire during a total stall.
- Alert rules: 14, all loop/heap/API/scrape (`event-loop.rules.yml` alert names). None on outbox lag, dead count, queue depth, failed-job rate, DLQ growth, oldest job age, or the `_default` partition (the runbook thresholds at `outbox-backlog.md:112-120` are not implemented as rules).
- Queue depth: only an on-demand admin probe `dashboards-analytics-charts/health.service.ts:231-250` (`getJobCounts`); not exported to Prometheus.
- Tracing/correlation: `RequestContextStore` carries `requestId`; processors synthesize `send-<jobId>` / `ingest-<jobId>` (`message-dispatch.processor.ts:44-50`, `channel-ingest.processor.ts:51-58`). The originating HTTP `requestId` is stored in the outbox `_meta` but the drain does not restore it for subscribers, and BullMQ job data carries no trace id. There is no trace propagation API to worker.

## 5. Tenant context in workers

- BullMQ: job data carries `orgId`; processors validate with zod where present (`message-dispatch.processor.ts:36-42`, `channel-ingest.processor.ts:38-47`) and run inside `RequestContextStore.run({orgId, actorType:'system'})`, then `db.txAs({orgId})` (RLS GUC per transaction, `database.service.ts:68-77`). `orgId` is trusted from the payload (internal producer), not re-verified against the entity. Verdict OK for the sampled processors. Test: `test/e2e/authz/workers.e2e.spec.ts` (runs processors in-process against restricted role with RLS).
- Outbox: drain is `db.privileged` (RLS lifted via `app.privileged`, `packages/db/src/tenant.ts:72`) for claim and bookkeeping only; the authoritative `org_id` column is passed to subscribers (`outbox-drain.service.ts:190-197`), which then use `txAs({orgId: event.orgId})` (e.g. `webhook-dispatch.consumer.ts:44`). Nothing forces a subscriber to do so; a subscriber that uses `db.privileged` has no tenant fence.
- Sweeps are `privileged` across tenants by design (comments in each).
- Payload validation coverage: `UnrecoverableError` appears in 26 of 42 processor files. The 16 without any: `calendar-backfill.jobs`, `calendar-reconcile.jobs`, `ics-feeds.jobs`, `telephony-events.service`, `mail-sync.processor`, `fb-backfill.processor`, `ig-pull.processor`, `template-sweep.processor`, `meta-lead-ads/lead-sweep.processor`, `meta-lead-ads/leadgen.processor`, `leads/lead-sync.worker`, `marketplace/inbound.worker`, `marketplace/pull.worker`, `shopify-woocommerce/ecom-import.processor`, `shopify-woocommerce/webhook.processor`, `notifications/web-push.processor`. They retry malformed payloads and permanent errors until attempts run out.

## 6. Graceful shutdown

- `app.enableShutdownHooks()` in the worker (`worker.ts:27`). Comment claims "in-flight jobs finish" but the outbox drain and the ~90 timers implement no `OnApplicationShutdown`/`beforeApplicationShutdown` and nothing awaits an in-flight tick (`outbox-drain.service.ts:62-84`; only `WebhookForwardProcessor` flushes in `onModuleDestroy`, `webhook-forward.processor.ts:126`).
- `DatabaseService.onModuleDestroy` closes both pools (`database.service.ts:90-93`); Nest runs `onModuleDestroy` before `onApplicationShutdown`, where the scheduler stops timers (unverified: package not installed). So an in-flight drain batch can lose the pool mid-handler; its handlers' `txAs` calls then fail and the failure is counted as an attempt (D9).
- BullMQ workers: relies on `@nestjs/bullmq` closing workers (waits for active jobs) before the 60 s kill; unverified here. Hostinger compose gives 60 s, prod compose gives 10 s default.
- Heartbeat removes itself on shutdown (`worker-heartbeat.service.ts:50-54`). OK.
- A rollback of the drain tx is the safety net: killed mid-batch, rows return to pending (at-least-once). Test: none.

## 7. Queue, job and cron inventory

BullMQ queues (name = concurrency or "no processor"): outbox (none), campaign 4, message-dispatch 8 (backoffStrategy `sendBackoffStrategy`), webhook-ingest 8, billing-posting (none), sla-sweep (none), counter-flush (none), partition-maintenance (none), bulk-jobs (none), con-import 2, bcast-dispatch 4, waba-ingest 8, pinnacle-credit-line 4, webhook-forward 16, webhook-deliver 16, tg-broadcast 2, line-broadcast 2, viber-broadcast 2, fb-backfill 2, meta-leadgen 4, meta-lead-sweep 2, fb-broadcast 2, ig-pull 4, ecom-import 2, ecom-webhook 5, sched-run 4, segment-actions 2, media-fetch 3, flow-run 8, tpl-sweep 1, mkt-pull 4, mkt-inbound 6, lead-sync 2, web-push 8, mail-sync 4, msg-log-export 1, lsc-score 3 (limiter 5/s), consent-export 1, audit-log-export 1, revenue-report-export 1, privacy-export 1, wab-migrate 1, calling-readiness 4, calendar-reconcile 2, calendar-backfill 2, calendar-ics-refresh 4, wechat-broadcast 2, telephony-ingest 4.

Job names seen: `message.send`, `payload` (waba), `deliver`, `score`, `sync`, `pull`, `sweep`, `run`, `import`, `share`, `backfill`, `batch`/run kinds (waboo), channel-ingest job, media-fetch job, export jobs.

Outbox consumers (subscribers): ai-agents-training source-ingest, appointments calendar/message/backfill, calling-voice call-realtime and calling-readiness, workspaces lifecycle-notification, outbound-webhooks dispatch, chat-conversations waba-group-retitle / waba-channel-sync / device-group-retitle, and about 14 notifications consumers (task, sla, send-outcome, salesdoc, conversation, team-chat, waba-group, member-leave, email-bounce, device, device-group, appointment-drift, ...).

Timers (`@Interval` ms / `@Cron`):
- Intervals: outbox drain 2 s; broadcast-due 3 s; scheduled-due 3 s; campaign-sweeper 5 s; wizard-worker 5/10/5 s and 1 h; faq-embed 5 s; webhook-forward 5 s; lead-first-reply 10 s; flow-sweeper 15 s; queued-message-recovery 30 s; auto-attach-sweep 30 s; rollup 30 s; lead-sync 30 s; inbox-snooze-wake 30 s; and 60 s: appointment-lifecycle, appointment-reminder, google-consent, broadcast-resume, broadcast-retry-sweeper, catalog-sweeps, media-fetch-recovery, segment-count, task-due, schedule.sweeper, cart-recovery, sla-sweep; 5 min: recurring-invoice, owner-restore, sales-doc-expiry, leave-sweep; 10 min invoice-overdue; 1 h wallet reconcile; plus TICK_MS-based: calendar-reconcile, ics-feeds, calling-readiness, tpl-sweep, device-runtime, paygw, waba click sync, device-groups, history-import, mail-sync/mail-push/mail-outbound-attachments sweeps.
- Crons: auth-maintenance 03:00; otp-template-refresh */5 min; partition-maintenance 02:00; rollup 02:15; audit-log-export-sweep 02:47; consent-export-sweep 02:41; message-log-archive 02:17; revenue-export-sweep 03:23; retention sweeps (api-library 03:41, call-log 03:41, call-recording 03:23, faq 03:17, flow-run 03:41, lead-scoring 03:41, plan 03:17, forms 03:17, minor 03:35, webhook-forward 03:00, notification 03:30, push-subscriptions 03:40, data-retention worker 03:50, lead-retention hourly :07, privacy 02:47 and every minute); lifecycle-sweep 03:15; storage-purge */10 min; growth-pilot :23 hourly and 02:37; lead-chat-digest */3 min; support-sla-scan */5 min; form-payment-sweep */30 min; marketplace inbound */20 s and :37, pull */30 s and :17, subscription-sweep hourly and minutely; meta-lead-sweep */10 min; ig pull-sweep */20 s; page-health hourly; waiting-nudge minutely.

## 8. Controls scorecard

| Control | Verdict | Basis |
| --- | --- | --- |
| Durable accept (outbox) | OK | `emit(tx)` same tx; no test |
| Durable accept (webhooks via BullMQ) | Weak | acked after `queue.add` to Redis only (`waba-webhook.service.ts:157`); Redis AOF everysec, 192 MB cap (D7) |
| No lost job between commit and publish | Outbox OK. BullMQ: pattern per feature, verified for message send, media fetch, broadcasts only | D6 |
| Crash recovery | Outbox OK by rollback. BullMQ: default stall settings; no test | D12 |
| Bounded retries with backoff and jitter | Partial | outbox bounded, no jitter, window about 4 min (D1); BullMQ default 5 attempts, 2 s exponential, window 30 s, jitter only on `mail-sync` (`mail-sync.publisher.ts:34`) (D10) |
| Permanent vs retryable vs ambiguous | Partial | message-dispatch has `ChannelError.retryable` and `IN_FLIGHT`; outbox none; 16 processors none (D9) |
| DLQ + authorized safe replay | Missing | outbox: SQL runbook; BullMQ failed set kept 3 days, no replay endpoint (D4, D11) |
| Per-tenant fairness / backpressure | Missing | global FIFO in outbox and every queue; no per-org caps (D13) |
| Graceful shutdown | Partial | D14 |
| Observability | Partial | D4 |

## 9. Defects

### P0

**D1. Outbox events dead-letter after about 4 minutes of dependency trouble, silently, with no replay path.**
Mechanism: `MAX_ATTEMPTS=8`, `backoff=2^attempts` (`outbox-drain.service.ts:19,121-124`), total window about 254 s; a Redis outage (the webhook consumer's `queue.add` throws), a DB failover, or a provider outage longer than that moves every event of the period to `dead` (webhook deliveries to customers, notifications, calendar sync, lifecycle emails). `dead` produces one log line, no metric/alert, and the only recovery is manual SQL. Unknown event types and permanent failures take the same path.
Fix: classify errors (permanent to `dead` at once with reason code; transient keeps retrying); raise the budget to hours with jittered capped backoff (for example base 5 s, cap 15 min, 20 attempts, full jitter); export `dead` and oldest-ready as metrics with a paging alert at >0; add an authorized replay endpoint (per event or per type and time window, audit-logged, rate-limited) replacing the raw SQL.

**D2. WABA inbound payloads can be lost after a short infrastructure blip.**
Mechanism: after signature check the webhook handler returns 200 once `queue.add('payload')` succeeds (`waba-webhook.service.ts:156-158`), with default options (5 attempts, 2 s exponential = about 30 s window, `queues.ts:121-126`) and `removeOnComplete: true` on this queue (`queues.ts:132-135`). A Postgres/Redis hiccup over about 30 s exhausts the attempts; the job sits in Redis `failed` for 3 days; Meta already got 200 and will not resend; there is no replay tool and no reconciliation from Meta. Customer messages vanish.
Fix: persist the raw verified body first in a Postgres inbox table (or at least a longer `attempts`/backoff on this queue), process from there, add a replay/reconcile job and a failed-queue alert. Same exposure for any acked-then-queued webhook (`channel-ingest.publisher.ts:44`, `ecom` webhook, telephony, leadgen). I read only the WABA path.

### P1

**D3. The outbox transaction spans all handler work; no handler timeout.** Claim, handlers and bookkeeping share one transaction (`outbox-drain.service.ts:87-145`). `statement_timeout` (15 s, `packages/db/src/client.ts:55`) only bounds SQL statements, not awaited network calls inside a subscriber. A hung subscriber (provider call, `queue.add` with Redis blocked) keeps up to 200 rows locked and one pooled connection held (plus up to 6 more), pins `running=true` so that worker's drain stops (`:66`), and holds back xmin/vacuum. No `idle_in_transaction_session_timeout`. Fix: per-handler deadline (`AbortSignal.timeout`), small claim txn that sets a lease (`locked_until`, `locked_by`) and commits, handlers run outside the txn, outcome written by CAS on lease; reaper for expired leases.

**D4. Blind spots in observability.** Outbox lag lives only in `/ready` (informational), job metrics see only final-state jobs, no queue-depth/oldest-age/failed/dead gauges in Prometheus, no alert rule for any of them (`event-loop.rules.yml` has none). A stalled drain, a stuck queue or a growing failed set pages nobody. The heartbeat is an in-loop timer and does not prove progress. Fix: exporter for per-queue waiting/active/delayed/failed counts and oldest waiting age; outbox ready/dead/oldest gauges from the existing sampler; alerts on lag, dead>0, failed growth, no-completions-while-waiting; heartbeat should publish last successful drain/process time.

**D5. `event_outbox` is never cleaned.** No delete, not in `archivable_streams()` (`20261218090000_drop_closed_partition.sql:21-26`). `done` rows accumulate forever at every state change; `dead` rows too. Fix: retention (drop closed partitions older than N days after confirming no `pending`/`dead`; or batch delete `done`), register stream in `archivable_streams()`; keep `dead` longer in a separate table.

**D6. Commit-then-`queue.add` dual write has no uniform recovery.** About 50 sites; recovery verified only for message send (`queued-message-recovery.service.ts`), media fetch, broadcasts and scheduled runs. Exports (`attempts: 1`, e.g. `audit-log/audit-log-export.job.ts:19`, `privacy-export.job.ts:16`), contact import (`contact-import.service.ts:417`), segment actions (`segment-actions.service.ts:138`), lead sync (`lead-sync.service.ts:379`, `attempts:1`, `removeOnFail:true`), ig-pull (`attempts:1, removeOnFail:true`) may strand a DB row in a "queued" state if Redis is down or flushed at the moment of enqueue. Redis is `noeviction` at 192 MB: when full, every `queue.add` fails (D7). Fix: make a rule (and a lint/test) that every queue publisher either writes through the outbox (a relay to BullMQ) or has a registered recovery sweep; inventory each of the 48 queues against it.

**D7. Redis is a single non-HA node carrying "durable accept" for webhooks.** AOF default fsync everysec means up to about 1 s of acknowledged jobs lost on crash; `maxmemory 192mb` with per-queue history (1000 completed, 2000 failed x up to 3 days, 48 queues, `queues.ts:121-126`) can fill and make all enqueues fail; prod compose has no maxmemory at all. Fix: size and alert on Redis memory, trim `removeOnFail` by count for big payload queues, set `appendfsync always` or move durable-accept paths to Postgres (D2).

**D8. Scheduled flow occurrences can be lost.** `schedule.sweeper.ts:90-105` commits `trigger_last_occurrence` before enrolling contacts; a crash or error after the CAS and before `enrolContacts` completes means the scheduled send for that day never happens and is never retried. Fix: claim and enqueue in one transaction (outbox event, `ON CONFLICT` run row like the reminder sweep `appointment-reminder-sweep.service.ts:51-103`) or write a run row with status and resume incomplete rows.

**D9. Error classification missing in 16 of 42 processors and in the outbox**, and `attempts: 1` on several user-facing jobs. Permanent errors retry 5 times for no gain; transient errors on `attempts:1` jobs fail forever with no retry and `removeOnFail: true` hides the evidence (`lead-sync.service.ts:381-383`, `pull-sweep.service.ts:37`, `mail-sync.publisher.ts:36`). Ambiguous outcomes (timeout after a provider accepted) are only handled in message-dispatch (client reference idempotency). Fix: shared `classifyError` helper returning permanent/transient/ambiguous, used by the outbox and by a base processor class; never `removeOnFail: true` for work with side effects.

**D10. Default BullMQ retry window is about 30 s with no jitter.** `attempts:5`, exponential 2 s (delays 2,4,8,16 s) (`queues.ts:121-126`); only mail-sync sets jitter. Any queue that does not override (waba-ingest, webhook-ingest paths, many) gives up during a short outage and retries in lockstep. Fix: longer base and attempts per queue class with `jitter`, and document a retry budget per queue.

### P2

**D11. No safe replay for BullMQ failed jobs.** Only counts are exposed (`health.service.ts:231-250`); no `retry`/`getFailed` usage anywhere (grep). Fix: admin replay endpoint with RBAC, audit entry, idempotency check, rate cap.

**D12. Stall and single-process coupling.** Default `lockDuration` 30 s and `maxStalledCount` 1 with about 42 processors, 90 timers and the Baileys runtime on one event loop (`worker.module.ts`); a loop block over 30 s makes jobs stall and run twice or fail "stalled more than allowable". Handlers must be idempotent; only message send is proven so. Fix: split worker roles (outbox+sweeps / sends / ingest / heavy exports), set explicit `lockDuration`, add `OnWorkerEvent('stalled'|'failed')` logging (none exists; grep).

**D13. No per-tenant fairness.** Outbox claim is global `ORDER BY created_at,id` (`outbox-drain.service.ts:93`), so one org's `emitMany` of 100k events (`outbox.service.ts:59-63`, bulk import/reassign) delays everyone's events; BullMQ queues are FIFO with fixed concurrency (e.g. webhook-deliver 16: a dead customer endpoint with long timeouts occupies slots). Fix: per-org caps in claim (window function or round-robin), per-org concurrency for delivery queues, circuit breaker per endpoint.

**D14. Shutdown ordering.** DB pool closes in `onModuleDestroy` while the drain/timers have no shutdown hook (`database.service.ts:90`; `outbox-drain.service.ts` none), prod compose grants no grace period (`docker-compose.prod.yml:31-46`), and the hostinger comment describes a 'processing' state that does not exist. Effects: wasted attempts and duplicate side effects on every deploy. Fix: `beforeApplicationShutdown` that stops intervals and awaits in-flight ticks, then close workers, then DB; add `stop_grace_period` to prod compose; test with a real SIGTERM.

**D15. Ordering is not guaranteed and not documented as such.** Per-aggregate order only inside a batch; retries and multi-worker reorder events. Consumers that assume order (e.g. conversation notifications) are exposed. Fix: document, add per-aggregate sequence or claim whole aggregates, or make consumers order-insensitive.

**D16. No payload validation or versioning for outbox events, no trace propagation.** `Record<string, unknown>` (`outbox.service.ts:7-15`), no `schema_version`, no event contract registry, `_meta` lacks trace id; drain does not restore `requestId` for subscribers. Fix: typed event registry with zod schema and version, trace id in `_meta` and restored into `RequestContextStore` during dispatch.

**D17. Claim query ordering does not match its index.** `ORDER BY created_at, id` (`outbox-drain.service.ts:93`) with partial index on `(available_at, id)` (`0006_outbox_audit.sql:37`) forces a sort of all ready rows on every tick per worker; cost grows with backlog exactly when it matters. Fix: order by `available_at, id` or index `(created_at, id) WHERE status='pending'`.

**D18. Scheduler duplicates rely on per-sweep discipline.** 46 timer files have no lock keyword; correctness rests on idempotent SQL that was verified only for 3 of them. No central registry, no run history, no catch-up after downtime for cron jobs (missed 02:00 job on a 02:00 deploy is skipped). Fix: wrap timers in one `ClusteredJob` helper (advisory lock or `RedisLockService`, `last_run` table, metrics, missed-run policy) and migrate sweeps.

**D19. Doc and comment drift** that would mislead an operator: stale `QUEUES.OUTBOX` comment, `outbox-backlog.md` "processing" recovery and 15-minute cap, `scale.md`/`messaging.md` "BullMQ rate limiter at throttle_per_min", misplaced doc comment for `WAB_MIGRATE` (`queues.ts:91-94`). Fix: correct docs alongside D1/D3.

## 10. Test coverage summary

- Outbox drain (claim, SKIP LOCKED concurrency, backoff, dead, crash): none. Used incidentally by e2e specs (`test/e2e/authz/workers.e2e.spec.ts`, `notifications/*.e2e.spec.ts`, `lead-scoring.e2e.spec.ts`, `flow-runtime-engine/trigger-producers.e2e.spec.ts`).
- Registry: `test/unit/notifications/outbox-subscribers.spec.ts`.
- Partition creation: `test/integration/partition-maintenance.spec.ts`.
- Heartbeat/status: `test/integration/platform-infrastructure/worker-status.spec.ts`; job metrics: `test/unit/platform-infrastructure/job-metrics.spec.ts`, `test/e2e/platform-infrastructure/worker-job-metrics.e2e.spec.ts`.
- Tenant isolation in workers: `test/e2e/authz/workers.e2e.spec.ts`.
- Queued-message recovery sweep: referenced in `test/e2e/chat-conversations/message-send.e2e.spec.ts`; flow schedule sweeper: referenced in `test/e2e/flow-runtime-engine/flow-workflow-gaps.e2e.spec.ts` (neither opened; crash-between-claim-and-fire is not shown to be covered). `readiness.e2e.spec.ts` and `device-runtime.e2e.spec.ts` mention dead/heartbeat terms. Graceful shutdown, DLQ/replay and stall behaviour: no spec found (matched by file name and a content grep for `dead`).

## 11. Open questions for the owner

1. Is any redundancy planned for Redis, and is losing up to 1 s of acknowledged webhooks acceptable?
2. Should webhooks be persisted in Postgres before the 200 (recommended) or is the Redis-first path a deliberate trade?
3. Replay authority: who may replay dead outbox events and failed jobs, and must it be audit-logged per tenant?
4. Is more than one worker container planned? Several sweeps and Baileys device runtime may assume exactly one (not verified).
