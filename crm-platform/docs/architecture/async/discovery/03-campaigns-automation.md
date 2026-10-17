# Async discovery 03: campaigns, broadcasts, automations, bots, scheduled work

Read-only audit of `apps/api/src` (paths below are relative to `apps/api/src/modules` unless they start with `test/`, `infra/`, `workers/` or `packages/`).
Evidence is by code reading; nothing was executed. Where a finding is an inference from code (not reproduced) it says so.
`docs/architecture/messaging.md` still says the broadcast pipeline is "not built yet"; it is built, and it does not match that design
(no durable operation row, no wallet reservation, no 2-5 s batched counters). `docs/architecture/scale.md` hot-row rules are violated by campaigns (see C-3).

## 0. What exists: three send engines plus the flow runtime

| Engine                           | Tables                                                               | Run unit                                            | Claim                                                                                              | Crash policy for a half-sent row                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campaigns (classic + wizard)     | `wpcampaigns`, `wp_campaign_contacts` (plain table, not partitioned) | BullMQ `campaign` job per campaign, sequential loop | `queued -> pending` via `FOR UPDATE SKIP LOCKED` (`campaigns.repository.ts:631-683`)               | `pending` older than 10 min goes back to `queued`, i.e. **re-sent** (`campaign-sweeper.service.ts:83-85`)                                                                             |
| Broadcasts (`/v2/broadcasts`)    | `broadcasts`, `broadcast_contacts`                                   | BullMQ `bcast-dispatch` job per broadcast           | `pending -> processing` conditional UPDATE per recipient (`broadcast-dispatch.service.ts:390-394`) | `processing` older than 10 min is marked `failed` ("interrupted") and the retry sweeper then **re-sends** it (`:157-160`, `broadcast-retry-sweeper.service.ts`, `retry-policy.ts:48`) |
| Scheduled messages               | `scheduled_messages`, `scheduled_message_contacts`                   | BullMQ `sched-run` job per occurrence               | same as broadcasts                                                                                 | `processing` older than 10 min is marked `failed`, **not** re-sent (`scheduled-run.service.ts:155-158`). Only engine that is at-most-once                                             |
| Flow runtime (bots, automations) | `flow_runs`, `flow_run_steps`, `flow_subscribers`                    | BullMQ `flow-run` job per step                      | compare-and-set on `flow_runs.step_seq` (`engine.service.ts:99,423`)                               | node re-executed; sends and HTTP calls carry a step idempotency key                                                                                                                   |

Three engines with three different crash semantics for the same business problem is itself a finding (A-1).

## 1. Findings table (sorted by severity)

Legend: Spec = existing test that covers the behaviour; "none" = I found no spec exercising the failure.

### P0

**C-1. Long-running official-engine campaign trips the stall detector and spawns concurrent duplicate runners (inference, high confidence).**

- Mechanism: the run loop only refreshes `wpcampaigns.last_run_at` (via `repo.touch`) at run start (`campaign-dispatch.service.ts:323`) and inside `rest()` (`:1330`). For waba, twilio, sms and email the gap is `0` (`:583-586, 685-696`) and `rest(ms<=0)` returns before renewing anything (`:1325`). `recount()` every 25 recipients does not touch `last_run_at` (`campaigns.repository.ts:471-490`). The sender lease is 60 s (`broadcasts/send-safety.ts:84`) and is also only renewed in `rest()`. After 45 s (`campaign-sweeper.service.ts:20`) `resumeStalled` (`:121-157`) sees a `running` campaign with unsent recipients, flips it to `scheduled`, and in the _same transaction_ the due query (`:93-99`) flips it back to `running` and enqueues a new job (`:109,116`). The live run reads committed `running` (`campaigns.repository.ts:514`) so it never halts. The new job gets `busy` (lease held) until the old 60 s lease lapses, then acquires it (`campaign.processor.ts:74-78`, `campaign-dispatch.service.ts:189-191, 394-396`). Result: two runners on one campaign and one sender, and since each start resets `last_run_at`, another runner roughly every minute until worker slots (4 per worker) are exhausted. Every new runner also re-runs `screenRecipients` + `ConsentGate.checkMany` over the whole campaign (`:326-364`, see C-4).
- Impact: broken pacing guarantees on shared numbers, wasted DB load that grows with campaign size, counters/outbox storms, slot starvation for other tenants. `SKIP LOCKED` claims keep recipients from being double-claimed, so it is not itself a duplicate-message bug.
- Fix: renew the run lease and `touch` inside the per-recipient loop on a timer (every ~15 s) regardless of gap; make `resumeStalled` ignore a campaign whose `camp:run:*` Redis lease is alive (or whose BullMQ job is `active`); never flip status through `scheduled` in the same tx as the due query; add an `owner_run_id` column so only the owning run may write status.
- Spec: none. `test/e2e/campaigns/campaigns-dispatch.e2e.spec.ts:669` (stalled run is rescheduled; "a live one is left alone") uses an instant fake clock and never runs a loop longer than the stall window.

**C-2. Campaign launch does all fan-out inside the HTTP request, in one transaction (100k recipients).**

- Classic: `campaigns.service.ts:114-175`. `audience.resolve` (`audience.service.ts:44-87`) concatenates every contact id into in-memory arrays, runs `resolveOrCreateByIdentity` once per typed/CSV number inside the request tx (`:63-81`), then `insertRecipients` writes `CHUNK = 1000` rows per statement in the same tx (`campaigns.repository.ts:10,1165-1175`). `assignVariants`, `shares.assign` build maps of all recipients in memory (`campaigns.service.ts:141-155`). Wallet precheck is a balance check on the count (`:129-131`).
- Wizard: `wizard-launch.service.ts:60-291` -> `wizard-run.service.ts:233-304` does the same in one tx, materialises CSV numbers per row (`wizard-audience.service.ts:345-373`, one `findOrCreateByPhone` each), loads the full audience id list into `everyone: number[]` (`wizard-run.service.ts:271-278`), then inserts in `WRITE_CHUNK` pieces. Recurring occurrences repeat this inside `WizardSeriesService.planOne` (`wizard-series.service.ts:87-135`) while holding the series row lock.
- Failure mechanism: request timeout / client retry at 100k leaves either a rolled-back tx (nothing created, user retries and pays twice the DB cost) or a pooled connection held for minutes; no durable "launch operation" row exists to poll, resume or cancel; an API pod restart mid-launch loses the work. The API also does the CSV parse (`campaigns/audience.service.ts:58`).
- Fix: launch = insert campaign row in `materializing` status + a durable operation (id, cursor, expected count) and return 202; a worker job materialises recipients in id-keyed chunks (streamed `INSERT ... SELECT` from the audience query, commit per chunk, cursor persisted); flip to `running`/`scheduled` only when materialisation is complete; idempotency key on the launch request.
- Spec: `test/e2e/campaigns/campaigns-create.e2e.spec.ts`, `broadcast-wizard.e2e.spec.ts` cover correctness at small sizes only; no scale or timeout spec.

**C-3. Per-receipt full-aggregate recount and hot-row update on `wpcampaigns` (violates scale.md hot-row rule).**

- `campaign-receipts.service.ts:78` calls `repo.recount` on every delivery receipt (3 per message: sent, delivered, read). `recount` (`campaigns.repository.ts:471-490`) scans all recipient rows of the campaign (`SELECT AGG ... WHERE campaign_id`) and updates the one campaign row. The dispatch loop does the same every 25 recipients (`campaign-dispatch.service.ts:715-718`).
- At 100k recipients: ~300k recounts, each scanning up to 100k rows through `idx_wp_campaign_contacts_campaign_id_status_send_attempts`, all serialised on one row lock. `scale.md` says campaign counters are batch-flushed every 2-5 s; the code does not.
- Also: receipt lookup runs outside any tx through `db.primary` (`campaign-receipts.service.ts:32`) and `camp_receipt_lookup()`; the `broadcast` module avoids this cost by not emitting per-message events unless a webhook is subscribed (`broadcast-progress.service.ts` `hasSubscriber`), campaigns do not.
- Fix: increment-in-memory/Redis deltas flushed by a worker every 2-5 s (or `UPDATE ... SET sent_count = sent_count + n` from a batched receipt writer), recount only on completion and on demand; batch receipts per campaign.
- Spec: `test/e2e/campaigns/campaigns-live-stats.e2e.spec.ts` asserts the numbers, not the cost.

**B-1. Broadcast resume / retry is silently swallowed by BullMQ job-id de-duplication (inference; the unit test mocks the queue).**

- `broadcast-due.service.ts:66-77` enqueues with `jobId: r.uuid` (stable per broadcast) and only then sets `node_schedule_id` and `status = 'processing'`. Default job options keep completed jobs for 1 h / 1000 and failed jobs for 3 days (`infra/queue/queues.ts:117-123`). BullMQ ignores `add` when a job with that id still exists in any state. Every auto/manual resume (daily cap, quiet hours, halt, wallet pause: `broadcast-resume.service.ts`, `broadcasts-actions.service.ts:141-175`) and every retry (`broadcast-retry-sweeper.service.ts`, `retryFailed`) re-queues the same uuid; a retry that comes within an hour of the previous run finishing (the sweeper's backoff is 60 s: `retry-policy.ts`) finds the old _completed_ job and gets no new job. The DB now says `processing` with a `node_schedule_id`, `enqueueDue` filters on `node_schedule_id IS NULL` (`:59`), and nothing recovers it. After 5 failed attempts the failed job blocks the same id for 3 days.
- Contrast: the flow publisher already knows this and removes a finished job before re-adding (`flow-run.publisher.ts:27-33`), and the scheduled-message due service puts the attempt number and occurrence time into the job id (`scheduled-due.service.ts:25-26`).
- Also `next_attempt_at` set by the retry sweeper is never read by `enqueueDue` (`:57-60` uses `scheduled_at` only), so backoff is not enforced.
- Fix: job id = `${uuid}:${send_attempts}:${resume_epoch}` or remove-then-add as the flow publisher does; add a reconciler for `processing` broadcasts whose BullMQ job is missing/failed (as `ScheduledDueService.requeueStale`, `scheduled-due.service.ts:~140-175`, does); honour `next_attempt_at`.
- Spec: `test/e2e/broadcasts/broadcasts-dispatch.e2e.spec.ts:158-230` and `broadcasts-pacing.e2e.spec.ts:243-265` use `{ add } as never` mocks, so the dedupe is never exercised.

### P1

**C-5 / B-2. No idempotency across the provider call: a crash between "provider accepted" and "row marked sent" re-sends after 10 min.**

- Campaigns: claim sets `pending` (`campaigns.repository.ts:667`), provider call (`campaign-dispatch.service.ts:839-877`), then `markSent` in a separate tx (`:879-895`). Crash in the gap leaves `pending`, `campaign-sweeper.service.ts:83-85` returns it to `queued`, next run sends again. `clientReference: camp-<id>-<contactId>` is passed but the waba path calls `provider.sendTemplate` directly (`broadcasts/engine-senders.ts:~186-199`); nothing in `infra/providers/whatsapp-cloud-api-waba` or `node-bridge-runtime` consults it (grep `clientReference` finds it only in the port types, `ChannelDispatcher` and the simulator). The inbox/flow path is protected by `ChannelDispatcher` (`chat-conversations/channel-dispatcher.service.ts:186-241`, Redis key per clientReference); campaigns bypass it.
- Broadcasts: same gap; interrupted `processing` rows are failed and then auto-retried by `BroadcastRetrySweeper` unless the error matches the permanent list (`retry-policy.ts:48`, which has no entry for "Send was interrupted before it finished"), so an accepted-but-unrecorded message is sent twice.
- Unconditional writes make it worse: `markSent`, `release` and `markFailed` filter only on `id` (`campaigns.repository.ts:685-715`), so a run that lost its lease can overwrite a `sent` row back to `queued` via `putBack` (`campaign-dispatch.service.ts:634-638`).
- Fix: write an attempt/intent row (or `sending` state with attempt id and `provider_message_id` null) before the call, treat `sending` older than N minutes as _uncertain_ (reconcile against provider webhooks / do not resend automatically, surface "uncertain" count), make all row writes conditional on `status = 'pending' AND claim_token = $1`. The wizard retry service already does log-before-send with a unique (recipient, attempt) row (`wizard-retry.service.ts` header comment) and `ChannelDispatcher` shows the Redis pattern.
- Spec: `campaigns-dispatch.e2e.spec.ts:694` asserts that claimed rows of a dead run go back to the queue (i.e. it asserts the resend). No spec for "provider accepted, process died".

**C-4. Every run start (including each restart/rearm/resume) re-screens the whole campaign.**

- `runLocked` (`campaign-dispatch.service.ts:316-366`) runs `screenRecipients` (3 full-campaign UPDATEs, one with a `row_number()` window over all recipients; `campaigns.repository.ts:535-588`), loads every unsettled `(id, contact_id)` into memory (`screenCandidates`, `:591-604`), and calls `ConsentGate.checkMany` on all of them inside one tx. A campaign that rearms for the daily cap or retries repeats this for each pass. 100k rows, repeated per rearm/stall.
- Fix: screen at materialisation time and on claim (per batch), not by whole-campaign sweeps; keep a `screened_at` watermark.
- Spec: none at scale.

**C-6. Sweeper full-table scans every 5 s on every worker.**

- `campaign-sweeper.service.ts:83-85`: `UPDATE wp_campaign_contacts SET status='queued' WHERE status='pending' AND updated_at < ...` has no `org_id`/`campaign_id`; every index leads with `org_id` (`packages/db/migrations/20261001103000_camp_threadwise_schema.sql:127-130`) so this is a sequential scan of a table that receives 2-5 lakh rows/day (and is not partitioned despite `scale.md` listing `campaign_recipients`). The Meta-block reconcile (`:163-166`, `status='failed' AND send_attempts<3 AND next_attempt_at IS NULL`) and `WizardRetryService.arm` (`wizard-retry.service.ts:~85-95`, `status='failed' AND retry_state IS NULL`, every 5 s) and `WizardFollowUpService.arm` (`wizard-follow-up.service.ts:~140-155`, every 10 s) have the same shape. Every worker pod runs them.
- Fix: partial indexes `(updated_at) WHERE status='pending'`, `(next_attempt_at) WHERE status='failed'`, `(follow_up_check_at) WHERE follow_up_state='active'`; run each sweeper on one pod via lock; partition or archive `wp_campaign_contacts` by campaign age.
- Spec: none.

**C-7. Cancel/pause is advisory and the end-of-run writes can overwrite it.**

- Operator `cancel` only sets status (`campaigns-actions.service.ts:100-109`); the loop notices at the next recipient (`campaign-dispatch.service.ts:641-649`; spec `campaigns-dispatch.e2e.spec.ts:556`). Good for the cost of one extra DB round trip per recipient (liveStatus `SELECT` for each recipient, `:641`). But `finish()`, `endExpired`, wallet pause and `failRun` do `setStatus(... 'completed'|'scheduled'|'paused'|'failed')` unconditionally, after a non-locking `liveStatus` read (`:1167-1217`, `:1156-1160`, `:1299-1306`); a cancel that lands between the read and the write is lost (cancelled campaign becomes `scheduled`/`completed`/`paused`). TOCTOU.
- Broadcasts have **no operator cancel or pause at all** (`broadcasts-actions.service.ts`: delete of scheduled/failed, retry, resume, export only) and the dispatch loop never re-reads broadcast status (`broadcast-dispatch.service.ts:255-512`); a mistaken blast cannot be stopped except by pausing the sender or deleting rows. Scheduled messages do support pause/cancel (`scheduler.service.ts`; `stillRunning` check per batch, `scheduled-run.service.ts:454-460`).
- Fix: conditional status updates (`WHERE status = 'running'`), row lock or CAS token; add broadcast cancel with the same live-status check.
- Spec: cancel mid-run is covered for campaigns (`campaigns-dispatch.e2e.spec.ts:556`, `campaigns-actions.e2e.spec.ts:116`); the TOCTOU and broadcast cancel have none.

**C-8. Outbox amplification: about five outbox rows per recipient.**

- Each send emits `campaign.contact_status_updated` (`campaign-events.ts:60-72`) and `message.delivery_reported` (`:94-110`); each receipt emits another `delivery_reported` and `contact_status_updated` (`campaign-receipts.service.ts:49-70`). For a 100k campaign that is ~500k `event_outbox` rows through a single drain (`workers/outbox-drain.service.ts`, 200 per batch, max 10 batches per 2 s tick). `messaging.md` states per-message events must stay out of the outbox. These events share the drain with flow triggers, appointment reminders and notifications, so a big campaign delays automation triggers and reminders (fairness).
- Fix: aggregate wallet reports per batch/receipt window; emit per-message events only when a webhook subscribes (as `broadcast-progress.service.ts` does); give campaign/wallet events their own queue or priority lane.
- Spec: none.

**C-9. Throughput ceiling: one sequential sender per campaign, ~6-8 DB transactions per recipient.**

- Per recipient: `liveStatus`, `merge.contactFor`, link tracker, billing `assertCanSend`, provider call, `markSent` tx (+ 2 outbox emits), mirror, plus a claim per 200 and a recount per 25 (`campaign-dispatch.service.ts:641,787,808,827,879,897,715`). A 100k WABA campaign at an optimistic 10 msg/s is ~3 h; a campaign cannot fan out across workers (one job, one lease). Worker concurrency is 4 jobs (`campaign.processor.ts:23`), so the fifth long campaign (any tenant) queues behind hours-long runs. Meta throttle is handled only reactively (`SenderThrottled`, `:899`), there is no proactive token bucket.
- Wallet: `billing.consume` is `assertCanSend` only, no reservation (`_shims/wallet-billing.ts:20-34`), so concurrent campaigns on one wallet can overspend; `messaging.md` promises reserve/settle.
- Fix: shard the audience into per-lane jobs (BullMQ rate limiter per sender), batch bookkeeping per claim slice, wallet hold per slice.
- Spec: `campaigns-dispatch.e2e.spec.ts:545` (gap kept) only.

**F-1. Flow trigger events can be dead-lettered after about 4 minutes of downstream failure, with no automatic replay.**

- `workers/outbox-drain.service.ts:21,115-135`: 8 attempts, backoff `2^attempts` s, so total ~4 min before `status='dead'`. `FlowTriggerEventsConsumer` (`flow-runtime-engine/triggers/trigger-events.consumer.ts`) and `AppointmentMessageConsumer` ride this. Appointment reminders have already consumed their claim row (`appointment-reminder-sweep.service.ts:62-70`, `ON CONFLICT DO NOTHING` on `appointment_reminder_runs`), so a dead `appointment.reminder_due` is never re-armed. Dead events are only requeued by hand SQL (`docs/runbooks/outbox-backlog.md:71-83`); no code path reads `'dead'`.
- Fix: dead events pause the consumer and alert instead of dropping; provide a replay job; make reminder claims re-armable when the event is dead (or delete the claim on dead-letter).
- Spec: none.

**F-2. Inbound bot/auto-reply/AI work is inline in the ingest job and swallows errors.**

- `chat-conversations/inbound-ingest.service.ts:~158-185` calls `hooks.run` after the message commit; `inbound-hooks.ts:103-111` catches every listener error and logs it. Flow start, FAQ answer, AI agent, routing all run here (`FlowInboundService.onStored`, `FaqInboundListener.onStored`). A listener failure or a crash after the store commit means the retry sees `duplicate` (`:121-123`) and no bot ever runs for that message: no durable work item, no retry, no dead letter. Slow listeners (LLM/embedding calls) hold `webhook-ingest` slots (concurrency 8, `channel-ingest.processor.ts:31`) and make provider redelivery likelier.
- Fix: persist a "needs bot handling" row (or enqueue a `bot-react` job keyed by message uuid) in the store tx; run listeners from that queue with retries and per-listener result.
- Spec: none for listener failure. (Cross-reference the inbox discovery file.)

**F-3. Schedule trigger claims the occurrence before enrolling, and truncates the audience silently.**

- `flow-runtime-engine/triggers/schedule.sweeper.ts:97-109`: CAS on `flows.trigger_last_occurrence`, _then_ audience query and `enrolContacts`. A crash or exception after the CAS loses the whole occurrence (the catch at `:123` only logs). `SCHEDULE_AUDIENCE_CAP = 5000` (`:15`, `LIMIT` at `:136-150`) silently drops everyone beyond 5000 with no error or log. The tick runs every minute for _all_ live schedule flows across tenants, with `date_field_match` doing `data->>field` scans on `contacts` without an expression index (`:156-176`).
- Fix: enrol idempotently first (reason `<kind>:<flow>:<key>` is already unique) or persist an occurrence row with a cursor, mark done at the end; chunk the audience instead of capping; log/notify on truncation; add expression indexes via `field_indexes`.
- Spec: `test/e2e/flow-runtime-engine/trigger-producers.e2e.spec.ts` covers firing, not crash-after-claim or the cap.

**C-10. Missed schedule after downtime has no policy for classic campaigns and broadcasts.**

- `CampaignSweeper.sweep` fires anything with `send_date <= today+1` and a past due time regardless of how late (`campaign-sweeper.service.ts:93-111`); `BroadcastDueService` uses `scheduled_at <= now()` (`broadcast-due.service.ts:57-60`). A 09:00 marketing blast after a 2-day outage goes out whenever the system returns. Contrast: wizard series skip occurrences older than `MISFIRE_GRACE_MS = 6 h` and count them (`wizard-series.service.ts:28,94-110`), scheduled messages use `SCHED_MAX_LATE_MINUTES` default 60 (`config/domains/scheduled-queue-warmer.env.ts:13`; `scheduled-due.service.ts:108-114`), flow `schedule` triggers fire any time later the same day (`schedule-rules.ts:75-89`).
- Fix: one explicit misfire policy per engine (grace window then skip-and-mark, or run-late flag chosen by the user).
- Spec: `test/unit/broadcasts/schedule.spec.ts` covers timezone maths; `scheduler.e2e.spec.ts` covers the scheduled-message missed path; none for campaigns/broadcasts.

### P2

- **C-11. Duplicate-cron on every pod for sweeps with no cross-pod guard.** `RedisLockService` (`platform-infrastructure/coordination/redis-lock.service.ts`) exists but is consumed by no sweeper (grep shows only module/index references); all `@Interval/@Cron` jobs run on every worker pod (`workers/workers.module.ts:85` `ScheduleModule.forRoot()`). Per-process `running` flags do not help across pods. Safe (claim/CAS/SKIP LOCKED) where listed in section 3; unguarded and relying on idempotent writes: `growth-pilot/growth-sweeper.ts:51,70` (loops all pilot orgs on every pod; actions dedupe on `(org_id, dedupe_key)` `growth.repository.ts:353`), `notifications/waiting-nudge.service.ts:102` (race window between the NOT EXISTS candidate read and the write), `chat-conversations/queued-message-recovery.service.ts:36` (job id fixed per generation, safe), `analytics/rollup/rollup.worker.ts:23,45` (not audited). Fix: one `withLock('cron:<name>')` wrapper for every sweeper.
- **C-12. Series monthly drift.** `addMonthNoOverflow` (`campaigns/campaign-rules.ts:233-238`) advances from the _stored_ date, so a campaign set on the 31st becomes 28th after February and stays there. Spec: `test/unit/campaigns/recurrence.spec.ts` (check whether it covers the drift).
- **B-3. Stale `processing` recipients younger than 10 min stay in limbo.** `broadcast-dispatch.service.ts:157-160` fails only those older than `STALE_MINUTES = 10`; a retry job that starts sooner leaves them `processing`, finishes, and `progress.finish` may report an outcome with unsettled rows. Same in `scheduled-run.service.ts:155-161`, whose retry after a crash _after_ sending all recipients marks the schedule `failed: No recipients` (`:162`) because `pendingTotal === 0`.
- **C-13. Redis-down fails open on leases.** `SenderLease.acquire` returns a token when Redis throws (`send-safety.ts:93-100`), allowing two runs on one number. `CapTally` returns 0 on error so the unofficial daily cap resets (`:62-70`).
- **C-14. Wallet empty ends a follow-up chain permanently** (`wizard-follow-up.service.ts:~320-330`) instead of deferring like quiet hours; one lapse removes the recipient from the drip.
- **C-15. Cart-recovery nudge is at-most-once with silent loss.** `cart-recovery-sweep.service.ts:62-65` marks sent in the claim tx before the send; a failed send is logged and never retried (`:67-75`).
- **C-16. Queue lock settings are defaults.** No `lockDuration`, `stalledInterval` or `maxStalledCount` anywhere in `src` (grep); long synchronous work in a worker (code sandbox start, big JSON) can stall lock renewal and re-run a campaign/broadcast job. SIGTERM is handled by `enableShutdownHooks` (`worker.ts:27`) but an in-flight hour-long campaign job has no cooperative-stop (it should release rows and re-arm; today it relies on the 10-min `pending` reclaim).
- **F-4. Flow sweeper starvation and cost.** `RunRepository.due` (`runtime/run.repository.ts:365-400`) orders by `id` with `LIMIT 200` and no `SKIP LOCKED`, runs on every pod every 15 s, and has OR-predicates on `max_expires_at` and `last_activity_at` that the partial index `idx_flow_runs_due (status, expires_at, resume_at)` (`20261019090000_flr_runtime.sql:86`) cannot serve. With many waiting bot sessions this is a scan every 15 s per pod, and a persistent set of 200 low-id due rows (stuck `running` whose job is waiting) blocks higher ids. Fix: index per predicate branch or UNION ALL, `SKIP LOCKED`, order by due time.
- **F-5. Flow actions run as the system with no permission/ownership revalidation.** A run keeps executing after the publishing user is removed or loses `record.*` rights; CRM nodes (`runtime/nodes/crm/crm-nodes.ts`) act unconditionally. Contact deletion mid-run: contact-dependent nodes degrade to a "no contact" answer with a log note (`crm-nodes.ts:28`), sends use the run's `peerKey` and are re-checked for consent and send-window per message by `ChannelDispatcher` (good). No explicit "contact deleted -> cancel runs" besides `liveByContact` (`run.repository.ts:178`, used by takeover paths; not verified as called on contact delete).
- **F-6. Code-node sandbox is `node:vm` in a worker thread in the worker process** (`infra/sandbox/code-sandbox.ts:1-16`), 2 s default / 10 s max, 16 MB default heap, thread per run, no per-tenant concurrency cap beyond the processor's 8 slots. Acknowledged in the file as not a security boundary. Async risk: a hostile or buggy script costs up to 10 s of a worker thread and can starve flow slots of every tenant.
- **A-1. Three engines, three crash semantics, three UIs.** See table in section 0. Recommend one shared "send operation + recipient attempt" core.

## 2. Per-question answers (so nothing is claimed OK from config alone)

### Campaign launch

- Handler inline fan-out? Yes (C-2). No durable operation row; the campaign row itself is the only state.
- Recipient materialisation: chunked by 1000 per statement but fully in memory and in a single request tx; not streamed. 100k works at best slowly; no evidence of a test beyond small sets.
- Per-recipient state machine: `queued -> pending -> sent -> delivered -> read -> responded`, side states `failed` (with `send_attempts`, `next_attempt_at`), `skipped`, `unsubscribed`; quiet-hours `queued` + `held_until` (`campaigns.repository.ts:721-730`). `isNewer` ensures receipts only move forward (`campaign-receipts.service.ts:42`).
- Claim: `FOR UPDATE SKIP LOCKED` in a CTE (`campaigns.repository.ts:654-670`). Correct. Missing: owner token on later writes (C-5).
- Crash recovery: `pending` > 10 min back to `queued` (re-send risk, C-5), stalled `running` rescheduled after 45 s (false positives, C-1), BullMQ attempts 5 with exponential backoff (defaults, `queues.ts:117`), `AppError` is non-retryable (`campaign.processor.ts:83`). Only unsent/uncertain recipients are touched; sent rows are not re-sent by the claim itself. Spec for recovery: `campaigns-dispatch.e2e.spec.ts:669,694`.
- Pause/cancel/disable-schedule: cancel stops dispatch within one recipient and puts back the in-memory slice (`:640-649`, spec :556); a `scheduled` campaign that is cancelled is never picked (sweeper filters `status = 'scheduled'`, `campaign-sweeper.service.ts:96`). TOCTOU at run end (C-7). Broadcasts: no cancel (C-7).
- Duplicate scheduled execution across instances: due selection is `FOR UPDATE SKIP LOCKED` and flips status in the same tx (`campaign-sweeper.service.ts:99,109`), so two pods cannot both start it. Series: `lockSeries`/`dueSeries SKIP LOCKED` plus unique `(series_id, occurrence_no)` index (`20261031090000_camp_broadcast_wizard.sql:73`). Spec `broadcast-wizard-worker.e2e.spec.ts`, `broadcast-wizard-sequence.e2e.spec.ts`.
- Timezone/DST: wall time converted with two-pass offset settle (`broadcasts/schedule.ts:42-50`), recurrence advances calendar dates not 24 h blocks (`campaign-rules.ts:240-261`). Fine. Monthly drift P2 (C-12). Spec `test/unit/broadcasts/schedule.spec.ts`, `test/unit/campaigns/recurrence.spec.ts`.
- Missed schedule: C-10.
- Rate limit vs provider: C-9. Sequential per campaign, per-sender lease so two jobs on one number serialise (`campaign-dispatch.service.ts:394-396`).
- Fairness vs inbox: separate queues (`campaign` vs `message-dispatch`), but shared DB pool and shared outbox (C-8) and a campaign holds a connection-using loop for hours.
- Counters: C-3.

### Workflow / automation engine (flow runtime)

Strong. Evidence: `engine.service.ts:99-137` reads the run, executes the node outside a tx, commits with CAS on `step_seq` (`run.repository.ts save`, `engine.service.ts:423`), loses gracefully ('lost'). Step persistence: `flow_run_steps` log capped at `MAX_LOGGED_STEPS` (`step-log.ts`). Delay: `sleeping` + `resume_at` + delayed BullMQ job, sweeper as backup (`flow-sweeper.service.ts`, `engine.service.ts:105-116`). Retry per step: queue `attempts: 3` (`flow-run.publisher.ts:41`) plus re-execution of the node; sends dedupe on `flow:<run>:<seq>:<i>` (`flow-sender.service.ts:111`), HTTP/API/CRM/Google nodes pass `ctx.stepKey` as idempotency key (`webhook-node.ts:51`, `api-library-node.ts:86`, `crm-nodes.ts:155`, `google-nodes.ts:267`). Halted channel: 5 min retry up to the run's absolute limit (`halt.ts`). Loop protection: node visit counters (`visits`), sub-flow depth 10 (`engine.service.ts:46-49`), trigger hops 5 (`trigger-hops.ts:9`). Trigger intake: outbox subscriber `flow-runtime-triggers` (`trigger-events.consumer.ts`) at-least-once with enrolment idempotent per `(flow, contact, reason)`; clock triggers via `FlowScheduleSweeper`. Gaps: F-1 (dead letter), F-2 (inbound inline), F-3 (clock triggers), F-4 (sweeper cost), F-5 (no actor revalidation; contact-deleted policy implicit), F-6. "Failure after N successful actions": each node commits independently; a failing node ends the run `failed` with the earlier effects kept (no compensation); a crash after a send but before commit re-executes the node and relies on the idempotency keys above. Spec: `test/e2e/flow-runtime-engine/*.e2e.spec.ts` (`flow-runtime`, `actions-nodes`, `run-log`, `trigger-producers`, `flow-workflow-gaps`).

### Bots, AI agents, FAQ

- Inbound reply path: F-2. FAQ embeddings: `faq-knowledge/faq-embed.worker.ts` (5 s interval, per-org Redis lock `LOCK_S = 90` but up to 4 vendor batches per pass can outlast it; `SKIP LOCKED` claim and "store only if text unchanged" make a double run harmless). AI-agent URL ingest: outbox consumer `aiag-source-ingest` (`ai-agents-training/source-ingest.consumer.ts`) is idempotent (settles only `processing` rows) and fetches with no tx open; a consumer crash leaves the source `processing` until outbox retry; dead after 4 minutes leaves it `processing` forever (F-1 family). Code sandbox: F-6.

### Sequences / drips / reminders

- Wizard follow-up chain (`campaigns/wizard/wizard-follow-up.service.ts`): lease-claim per recipient (`follow_up_check_at` pushed by `LEASE_MS`, `SKIP LOCKED`), unique attempt log before send, quiet-hours deferral, reply/read conditions. Serial per pod with per-send gap sleeps (throughput bound), wallet-empty ends the chain (C-14), scan costs (C-6). Template sequence rotation in series (`wizard-series.service.ts:153-173`) skips unsendable templates.
- Frequency-cap retry (`wizard-retry.service.ts`): scheduled -> sending claim, unique `(recipient, attempt)` row before provider call, reaper for stale claims (`STALE_CLAIM_MS` 15 min). Best-designed path in the module; use it as the template for C-5.
- Appointment reminders: atomic claim + outbox event in one tx (`appointment-reminder-sweep.service.ts`), consumer re-reads the booking, drops stale (cancelled, started) and dedupes on `${event.id}:${channel}` (`appointment-message.consumer.ts`). Gaps: F-1 (dead event loses the reminder); query joins `appointments` x `booking_reminders` with `NOT EXISTS` every minute, index fit not verified.
- Task due, invoice overdue/recurring, sales-doc expiry, owner restore, SLA, snooze: use `SKIP LOCKED` or CAS per the grep (see section 3); not read in depth.
- Cart recovery: C-15.

## 3. Inventory of every job, handler and cron found

### 3.1 BullMQ processors (concurrency in parentheses)

`campaign` CampaignProcessor (4), `bcast-dispatch` BroadcastDispatchProcessor (4), `sched-run` ScheduledRunProcessor (4), `flow-run` FlowRunProcessor (8), `webhook-ingest` channel-ingest (8), `message-dispatch` message-dispatch.processor, `media-fetch` (3), `msg-log-export` (1), `waba-ingest` (8), `pinnacle-credit-line` (4), `webhook-forward` (16), `webhook-deliver` (16), `web-push` (8), `lsc-score` (3, limiter 5/s), `lead-sync` (2), `con-import` (2), `segment-actions` (2), `tpl-sweep` (1), `meta-leadgen` (4), `meta-lead-sweep` (2), `mkt-pull` (4), `mkt-inbound` (6), `mail-sync` (4), `fb-backfill` (2), `fb-broadcast` (2), `ig-pull` (4), `line-broadcast` (2), `tg-broadcast` (2), `viber-broadcast` (2), `wechat-broadcast` (2), `ecom-import` (2), `ecom-webhook` (5), `calling-readiness` (4), `telephony-ingest` (4), `calendar-reconcile` (2), `calendar-backfill` (2), `calendar-ics-refresh` (4), `consent-export` (1), `audit-log-export` (1), `revenue-report-export` (1), `privacy-export` (1), `wab-migrate` (1). Queues declared but without a `@Processor` found in this pass: `outbox`, `billing-posting`, `sla-sweep`, `counter-flush`, `partition-maintenance`, `bulk-jobs` (declared in `infra/queue/queues.ts`; verify they are unused or are consumed elsewhere).
Special job names on the campaign queue: `run` (also `catchUp: true`), `FIXTURE_RECEIPT_JOB`, `TEST_SEND_RELEASE_JOB` (`campaign.processor.ts:40-58`). Flow queue job name `step`; scheduled queue `run`; broadcast queue `dispatch`.

### 3.2 `@Interval` / `@Cron` jobs (every one runs on every worker pod; guard column says how duplicates are prevented)

Campaigns/broadcast/scheduling:

- `CampaignSweeper.tick` 5 s (`campaigns/campaign-sweeper.service.ts:62`): SKIP LOCKED + status flip in one tx; global UPDATE is idempotent. Issues C-1, C-6.
- `WizardWorker.planTick` 5 s, `followUpTick` 10 s, `retryTick` 5 s, `purgeTick` 1 h (`campaigns/wizard/wizard-worker.service.ts:42,56,70,87`): row locks / SKIP LOCKED / unique rows. Issues C-6.
- `BroadcastDueService.tick` 3 s, `BroadcastResumeService.tick` 60 s, `BroadcastRetrySweeper.tick` 60 s (`broadcasts/`): SKIP LOCKED. Issue B-1.
- `ScheduledDueService.tick` 3 s (`scheduled-queue-warmer/scheduled-due.service.ts:50`): SKIP LOCKED, attempt-scoped job ids, `requeueStale`. Good.
- `FlowSweeperService.tick` 15 s (`flow-runtime-engine/runtime/flow-sweeper.service.ts:33`): CAS via `step_seq`; no SKIP LOCKED (F-4). `FlowScheduleSweeper.tick` 60 s (`triggers/schedule.sweeper.ts:47`): CAS on `trigger_last_occurrence` (F-3). `FlowRunRetentionService` `41 3 * * *`.
- `OutboxDrainService.drain` 2 s (`workers/outbox-drain.service.ts:62`): SKIP LOCKED. Holds one privileged tx (and connection) for the whole dispatch of up to 10 batches; slow consumers delay all consumers.
- `PartitionMaintenanceService` daily 02:00 (`workers/partition-maintenance.service.ts:40`), `RetentionWorker` `50 3 * * *` (off until `RETENTION_ENABLED`).
  Reminders / appointments / inbox: `AppointmentReminderSweepService` 60 s, `AppointmentLifecycleSweepService` 60 s, `GoogleConsentSweepService` 60 s, `calendar-reconcile.jobs` tick, `ics-feeds.jobs` tick, `WaitingNudgeService` `0 * * * * *` (no guard, C-11), `QueuedMessageRecoveryService` 30 s, `MediaFetchRecoveryService` 60 s, `InboxSnoozeWakeService` 30 s, `SlaSweepService` 60 s, `TaskDueSweepService` 60 s, `LeadFirstReplySweepService` 10 s, `LeadSyncWorker` 30 s, `LeadChatDigestSweeper` `*/3 * * * *`, `CartRecoverySweepService` 60 s.
  CRM / billing: `InvoiceOverdueSweepService` 600 s, `RecurringInvoiceSweepService` 300 s, `OwnerRestoreSweepService` 300 s, `SalesDocExpirySweepService` 5 min, `SegmentCountSweepService` 60 s, `ReconcileJob` (wallet-message-billing) 1 h, `AutoAttachSweepService` (bsp-billing) 30 s, `PaygwWorker` tick, `SubscriptionReconciler`/marketplace `subscription-sweep.worker` (`0 15 * * * *`, `0 * * * * *`), `MarketplaceInbound` `*/20 s` and `37 * * * *`, `MarketplacePull` `*/30 s` and `17 * * * *`.
  Channels / providers: `MailSyncSweep`, `MailPushSweep`, `MailOutboundAttachmentsSweep`, `PageHealthSweep` hourly (facebook), `IgPullSweep` `*/20 * * * * *`, `WabaWorker` click sync, `DeviceGroupsSweep`, `HistoryImportSweep`, `DeviceRuntimeService` tick, `WebhookForwardProcessor` 5 s interval, `TemplateSweepProcessor` tick, `OtpTemplateRefreshService` `*/5`, `MetaLeadSweep` every 10 min, `CatalogSweepsService` 60 s (+ own `setInterval`).
  Housekeeping / retention: `AuthMaintenanceService` 03:00, `NotificationRetentionService` 03:30, `PushSubscriptionsPruneService` 03:40, `WebhookForwardRetentionService` 03:00, `MessageLogArchiveService` `17 2 * * *`, `ConsentExportSweep` `41 2`, `MinorSweepService` `35 3`, `AuditLogExportSweep` `47 2`, `RevenueExportSweep` `23 3`, `ApiLibraryRetention` `41 3`, `CallRecordingRetention` `23 3`, `CallLogRetention` `41 3`, `FaqRetention` `17 3`, `LeadScoringRetention` `41 3`, `LeadRetentionSweep` `7 * * * *`, `FormRetentionSweep` `17 3`, `FormPaymentSweep` `*/30`, `PlanRetentionSweep` `17 3`, `PrivacyMaintenance` `* * * * *` and `47 2`, `LifecycleSweep` `15 3`, `StoragePurge` `*/10`, `LeaveSweep` 5 min, `SupportSlaScan` `*/5`, `GrowthSweeper` `23 * * * *` and `37 2 * * *` (C-11), `FaqEmbedWorker` 5 s, `AnalyticsRollup` 30 s and `15 2 * * *`, `CallingReadinessJobs` tick.
  Plain `setInterval`s (not Nest-scheduled, per process): `SessionService` (`auth/sessions/session.service.ts:652`), `WabaConfigService` refresh, `WhatsappProviderResolver` refresh, `WorkerHeartbeatService`, event-loop probe/monitor, `RealtimeGateway` sweeps (`realtime/realtime.gateway.ts:100,103`), `RedisLockService` heartbeat, `CatalogSweepsService`.
  Not audited line by line (listed so the owner knows the coverage): everything under Housekeeping/retention, Channels/providers, CRM/billing above, and `channel-*` broadcast processors (tg/line/viber/fb/wechat repositories use `SKIP LOCKED` per grep but their crash semantics were not read).

### 3.3 Outbox subscribers touching this area

`flow-runtime-triggers` (FlowTriggerEventsConsumer), `appointment-messages` (AppointmentMessageConsumer), `aiag-source-ingest` (SourceIngestConsumer), plus the `lead-flow.consumer.ts`, `routing-flow.consumer.ts` and `social-handoff.consumer.ts` consumers under flow-runtime-engine (not read), growth `growth-handover.consumer`/`growth-digest.listener`.

### 3.4 Inbound listeners (InboundMessageHooks, run inside `webhook-ingest`)

`flow-runtime` (FlowInboundService), `faq-knowledge` (FaqInboundListener), routing/translation/auto-reply/AI-agent listeners registered elsewhere (names not enumerated in this pass).

## 4. Suggested order of work

1. C-1 (heartbeat + stall detector) and B-1 (job id dedupe): small changes, large blast radius.
2. C-5 (attempt row before provider call, conditional writes) and C-7 (conditional status writes, broadcast cancel).
3. C-3/C-8 (counters and outbox amplification), C-6 (indexes): required before any 100k campaign.
4. C-2 (durable launch operation), C-4, C-9.
5. F-1/F-2 (dead-letter replay, durable bot work item), F-3.
6. Cross-cutting: one cron lock wrapper (C-11), one misfire policy (C-10), one shared send-operation core (A-1).

## 5. Existing specs referenced

`test/e2e/campaigns/campaigns-dispatch.e2e.spec.ts`, `campaigns-actions.e2e.spec.ts`, `campaigns-create.e2e.spec.ts`, `campaigns-live-stats.e2e.spec.ts`, `campaigns-quiet-hours.e2e.spec.ts`, `broadcast-wizard*.e2e.spec.ts`; `test/e2e/broadcasts/broadcasts-dispatch.e2e.spec.ts`, `broadcasts-pacing.e2e.spec.ts`, `broadcasts-quiet-hours.e2e.spec.ts`, `broadcasts-actions.e2e.spec.ts`; `test/e2e/scheduled-queue-warmer/scheduler.e2e.spec.ts`; `test/e2e/flow-runtime-engine/*.e2e.spec.ts`; `test/unit/broadcasts/schedule.spec.ts`, `pacing.spec.ts`, `retry-and-csv.spec.ts`; `test/unit/campaigns/recurrence.spec.ts`, `campaign-rules.spec.ts`, `sender-split.spec.ts`. No spec exists for: stalled-detector false positive, provider-accepted-then-crash, job-id dedupe against retained jobs, 100k-scale launch/recount, outbox dead-letter replay, listener failure in inbound hooks, cron multi-pod duplication.
