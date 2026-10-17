# 04 - Imports/exports, billing, notifications, integrations, analytics, media/AI, privacy, crons

Discovery only. No code was changed. Scope: the async surfaces not covered by 01 (core infra), 02 (messaging), 03 (campaigns/automation).
Every finding cites `file:line` read in this session (paths relative to `crm-platform/apps/api/src` unless stated). "OK" is only
stated where the code was read, not from config. Items I did not read are listed in section 11.

Method note: Windows filesystem is slow; I read the processors, the services they call and the sweepers. Spec status was checked by
file name and, for a few, by grepping the spec (named below).

## 0. Summary

No confirmed P0 (nothing found that loses data or money on the happy path at today's volume). Top P1s:

| ID | One line |
| --- | --- |
| B2 | A delivered message whose settlement fails for ~4 min is dead-lettered by the outbox and never charged; no replay tool, reconcile cannot see it |
| B3 | Operator refund: SUM-then-INSERT race plus a timed-out provider call recorded `failed` (excluded from the sum) allows a double refund |
| B4 | AI wallet charge uses `randomUUID()` in the idempotency key: a retried/stalled job double-charges; failed charge is swallowed (vendor cost unbilled) |
| B5 | Payment webhook processed inline, nothing persisted; amount mismatch / no-match / activation failure are log-only; no sweeper for pending one-time orders |
| B9 | Reseller credit-line attach calls Meta before writing any claim row; two replicas or a crash re-call Meta |
| A1 | Queued contact import has no lost-job recovery (lead-sync has one); failed jobs keep the 20 MB source CSV (PII) |
| A4/A7 | Contact export (200k rows) and privacy erasure run synchronously in the HTTP request |
| A8 | Storage purge after erasure gives up after 8 tries (~80 min) with no alert: erasure silently incomplete |
| C1/C2 | Auth emails inline in the request, errors swallowed; lifecycle (workspace deletion) mail lost on first SMTP failure |
| C4 | Outbox drain holds one DB transaction open across every consumer's network I/O (SMTP, Google, URL fetch) |
| D1 | Customer webhooks: ~5 min retry horizon, no replay, `is_failing` never disables or notifies, delivery log has no retention |
| F1 | No antivirus anywhere; the only hook is a no-op stub |

Cross-cutting facts that explain several rows:

1. Dead queue constants. `infra/queue/queues.ts` declares `BILLING_POSTING`, `COUNTER_FLUSH`, `BULK_JOBS`, `SLA_SWEEP`,
   `PARTITION_MAINTENANCE`, `OUTBOX`. None has a `@Processor` or `InjectQueue` user (grep of `@Processor(QUEUES.*` / `InjectQueue(QUEUES.*` over
   `modules`, `infra`, `workers`). `workers/workers.module.ts:79` still says "Still to land here: ... billing roll-up, SLA sweep, counter flush,
   bulk import/export". The billing doc (`docs/architecture/billing.md`, first line "Not built yet") describes a roll-up/reservation design that does
   not exist; the real design is per-message settlement (B1).
2. Every `@Cron/@Interval` runs on every worker replica (ScheduleModule in `workers/workers.module.ts`). The only guard in most classes is an
   in-process `running` boolean. Correctness depends on each job's own claim (SKIP LOCKED, advisory lock, Redis NX, jobId). I checked this per job
   below; where there is no claim the job is called out.
3. Failure visibility is log lines. The worker initialises Sentry at process level (`worker.ts:9`) but none of the services read here raise a metric,
   an alert row, or a notification when a sweep fails or a row is parked. The one durable "needs a human" rows are the wallet log
   (`WalletLogService.event`) and per-feature status columns.

---

## 1. Classification table (today)

| Surface | Sync/async | Durable | Idempotent | Retry / DLQ | Tenant ctx | Failure visible |
| --- | --- | --- | --- | --- | --- | --- |
| Contact import <=1000 rows | sync in request (`contact-import.service.ts:411`) | row + audit | yes (phone key) | none (request fails) | request ctx | HTTP error |
| Contact import >1000 rows | async `con-import` queue (`:417`) | DB row holds CSV (`:395`) | resume by `processedRows` (`engine:147`) | 5 attempts default; AppError -> Unrecoverable (`processor:48`); no lost-job sweep | job payload -> `RequestContextStore.run` + `txAs` | job row `status/error`, poll `GET /contacts/import/jobs/:id` |
| Contact import preview | sync, parses whole file (`service:238`) | none | n/a | n/a | request | HTTP |
| Contact export | sync streamed HTTP (<=200k) (`contact-bulk.service.ts:436-602`) | file kept gz in DB after full read (`:567`) | audit written before the file (`:465`) | none | request | none after headers sent |
| Bulk tag/group/owner (<=50k) | sync single tx (`:163-285`) | yes | set-based | none | request | HTTP |
| Consent / audit-log / revenue / message-log exports | async queues, `attempts: 1` | export row | claim `queued->running` | none by design; daily sweep fails `running` > 1 h | job payload ctx | row status, e-mail to requester |
| Privacy export (ZIP) | async `privacy-export` | row | claim | none (`attempts:1`), daily sweep | job ctx | row status |
| Privacy erasure | **sync in request**, 3 registry passes in one tx (`privacy-requests.service.ts:444-510`) | atomic | preview-count equality check | none | request | HTTP; report |
| Storage purge (post-erasure) | cron `*/10`, SKIP LOCKED (`storage-purge.service.ts:39,57`) | `storage_purge_queue` | yes | 8 attempts then parked, no alert (`:11,94`) | privileged, per-row org check | `last_error` column only |
| Wallet message settlement | outbox subscriber `wallet-delivery-billing` | outbox + usage_charge_keys | claim key + ledger key | outbox 8 attempts -> `dead` (`outbox-drain.service.ts:19`) | `txAs({orgId})` | `wallet.settle.failed` log event |
| Wallet reconcile | `@Interval(1h)` all replicas (`reconcile.job.ts:19`) | read-only | n/a | n/a | privileged | logger.error only |
| AI wallet charge | inside lead-scoring tx | ledger | **no** (`randomUUID()` key) | queue retries | job ctx | warn log |
| Payment webhook / return | **sync in controller** (`payments.service.ts:94-166`) | order row only | yes (`markPaid` conditional) | provider redelivery only | privileged `PaygwStore`, org explicit | logs |
| Subscription reconcile | `@Interval(10 min)` (`paygw-worker.module.ts:21`) | `meta.last_polled_at` claim | yes | next window | privileged | log tally |
| Refund | sync operator request, provider call in middle (`refund.service.ts:229-300`) | `order_refunds` | **no** (see B3) | none | privileged | row status |
| Recurring invoices | `@Interval(5 min)` | `recurring_invoice_runs` unique key | yes | **skip period on error** | per-org ctx | `recurring_invoice.failed` event |
| Invoice overdue sweep | `@Interval(10 min)` | `overdue_at` stamp | yes (SKIP LOCKED) | next tick | privileged | none |
| Auth / system e-mail | **inline in request** (`mail.service.ts:79`) | none | no | none | n/a | warn log |
| Outbox-consumer mail | in drain tx | none | Redis NX claim (3 patterns, B7/C2) | outbox retry only if consumer throws | event org | log |
| Browser push | `web-push` queue, 4 attempts (`notification.publisher.ts` enqueuePush) | jobId `push-org-uuid` | yes | drop after last attempt (`web-push.processor.ts:27-31`) | job payload | warn log |
| Customer webhooks out | `webhook-deliver` queue | jobId `eventId-webhookId` | yes (receiver gets stable id) | 6 attempts ~5 min then `Unrecoverable` | `txAs({orgId})` | `webhooks.is_failing`, delivery log |
| Gmail/MS mail sync | `mail-sync` queue per mailbox, 60 s sweep | cursor on mailbox row | message id | 3 attempts, 5 min error backoff | job payload | mailbox `last_error/status` |
| Calendar write-back | outbox subscriber `appointment-calendar` | outbox | port idempotent on stored event id | outbox -> dead after ~4 min, then reconcile job repairs | event org | reconcile report |
| Calendar reconcile/backfill/ics | queues + claim + Redis lock (`calendar-reconcile.jobs.ts:20-109`) | claim columns | yes | 3 attempts | job payload | report + backoff |
| Lead sync / Meta lead sweep | queue + stale-queued/abandoned sweep (`lead-sync.worker.ts:29-67`) | `lead_sync_runs` | pipeline idempotency key | requeue after 60 s, fail after 20 min silence | per run | run status |
| Analytics events | writer inside business tx, **no callers** | `an_events` | n/a | never throws (savepoint) | tx ctx | log counter |
| Analytics rollup | `@Interval(30 s)` + advisory lock (`rollup.service.ts:73`) | watermark | yes | next tick | privileged | `watermark is stale` warn (`rollup.worker.ts:34`) |
| Retention (`an_events` only) | `@Cron 03:50`, off by default | manifest in object store | verified, repeatable | failure marker, pause after N | privileged | logs |
| Media fetch (inbound) | `media-fetch` queue + 60 s recovery sweep | message row `pending` | fixed jobId | yes | job payload | message state |
| AV scanning | none (stub) | - | - | - | - | - |
| AI embeddings (FAQ) | `@Interval(5 s)` + Redis lock + SKIP LOCKED (`faq-embed.worker.ts`) | row state | text-equality check on store | attempts then `failed`, self-heal | `txAs` | row `failed` reason |
| AI scoring | `lsc-score` queue, limiter 5/s | run rows | see B4 | retry only vendor-busy | job ctx | run log |
| URL knowledge fetch | outbox subscriber `aiag-source-ingest` | entry status | only `processing` settled | outbox | event org | entry `failed` |

---

## 2. (a) Imports, exports, reports

### A1 - P1 - Queued contact import cannot recover a lost job; failed jobs keep the CSV
- Mechanism: the job row is committed (`contact-import.service.ts:349-409`, `sourceCsv: upload.text` at `:395`) and `queue.add` happens afterwards
  (`:417`). A crash between the two, or Redis losing the key, leaves `status='queued'` for ever. `queue.add` failure is handled (`:422-432`), a process
  crash is not. There is no sweeper for `contact_import_jobs` (not in the `@Cron/@Interval` inventory). Compare `lead-sync.worker.ts:29-67`, which
  re-queues `queued` rows older than 60 s and fails `running` rows silent for 20 min.
- Second half: on a terminal failure `engine.run` sets `status='failed'` (`contact-import.engine.ts:119-130`) but does not null `sourceCsv`; it is only
  nulled on success (`:168`). Up to 20 MB of contact PII per failed job stays in Postgres with no retention sweep. A BullMQ job that exhausts stall
  retries while the row says `running` also stays `running`.
- Fix: `staleQueued` / `abandonedRunning` sweep modelled on lead-sync (heartbeat column updated per batch at `engine:150`), null `source_csv` on `failed`,
  and a retention cron for old terminal rows. Move the CSV to object storage (A2).
- Spec: `test/e2e/contacts-attributes-tags/contact-import.e2e.spec.ts:772` covers resume of a half-done job; nothing covers a lost job or retained CSV.

### A2 - P1 - Whole-file parse and validate on the API event loop, file text stored in a row
- Mechanism: `preview` (`service:238`) and `start` (`:332`) run `analyzeCsv` over up to `IMPORT_MAX_BYTES` 20 MB / `IMPORT_MAX_ROWS` 200,000 rows
  (`packages/contracts/src/contacts-attributes-tags/contact-import.ts:13-16`), extracting and phone-canonicalising every row in-process, then the worker
  re-parses the same file (`engine:138`) and `prepare` re-extracts every row again (`engine:218-226`). Multer uses memory storage
  (`contact-import.controller.ts:32`). A few concurrent 20 MB uploads is hundreds of MB of heap plus seconds of blocked loop. There is no per-workspace
  limit on concurrent import jobs.
- Fix: upload to the object store, return 202 with a job, validate in the worker; preview samples the first N rows only. Cap one open import per workspace
  (unique partial index like `lead_sync_runs`).
- Spec: none for load; `analyzeCsv` unit coverage not checked.

### A3 - P2 - Import resume accuracy and cost
- `fileMap: new Map()` on resume (`engine:286`) means numbers created before the crash are matched as updates, so `duplicatesInFile`/`created` counters differ
  from an uninterrupted run. `rejects` JSON is rewritten on every 500-row batch (`engine:150-160`). Only CSV/TXT is accepted (`decodeUpload`, `service:86-92`);
  Excel is refused with a message, so no XLSX path exists. Progress is `processedRows/totalRows` on the job row: adequate.

### A4 - P1 - Contact export runs synchronously in the HTTP response (up to 200,000 rows)
- Mechanism: `ContactBulkService.export` (`contact-bulk.service.ts:436`) resolves the selection, writes the audit row and `contact.exported` outbox event
  first (`:465-478`), then returns a `Readable` that pages 2,000 rows per short tx but keeps every chunk in `keep: Buffer[]` (`:511`) and gzips the
  concatenation at the end (`:567`) into `contact_exports.csv_gz`. Consequences: the audit says "exported N rows" even if the client disconnects at row 1;
  a slow or dead client pins a pod's memory for the whole stream; `save()` failure is swallowed (`:593`, "The person still gets their file"), so the
  "download again" history silently has holes; no progress, no resume, no timeout, one HTTP connection for minutes.
- Contrast: consent, audit-log, revenue and message-log exports already use the async row+queue+mail pattern.
- Fix: switch to the same async export runner for > N rows (keep inline for small), write audit on completion, stream the gz to object storage rather than a bytea.
- Spec: none found for abort/partial behaviour.

### A5 - P1 - Bulk contact operations up to 50,000 rows in one request transaction
- `BULK_FILTER_MAX = 50_000` (`packages/contracts/.../contact-filter.ts:81`); `group`, `setOwner`, `tag` (`contact-bulk.service.ts:163-285`) run set-based
  SQL in `db.tx` inside the request. `setOwner` documents "one audit row and one `contact.updated` event per contact changed" (`:217-218`), i.e. up to 50k
  audit + outbox rows in one transaction, which then become a burst for the outbox drain and every `contact.updated` subscriber (webhooks, segments, flows).
  Compare: `segment-actions` and `owner-reassign` already have worker paths.
- Fix: above ~2k rows enqueue to the existing owner-reassign / segment-actions style worker and return 202 with a progress row.

### A6 - P2 - Async export framework: orphaned `queued` rows and a daily-only stuck sweep
- All five exports use `{ attempts: 1 }` (`consent-export.job.ts:19`, `audit-log-export.job.ts:19`, `revenue-export.job.ts:19`,
  `message-log-export.job.ts:20`, privacy equivalent) and claim `queued -> running` in the runner. Enqueue failure is handled only for a thrown error
  (`consent-export.service.ts:59-67`); a crash between insert and enqueue leaves `queued`, and the stuck sweep only touches `running` older than 1 h
  (`consent-export.repository.ts:142-146`, `STUCK_EXPORT_MS` `consent-export-sweep.service.ts:7`) and only runs once a day (`@Cron('41 2 * * *')` `:23`;
  audit 02:47, revenue 03:23, privacy 02:47). The documented "one at a time" rule then blocks that workspace for up to ~25 h.
- Builders hold the whole file in memory (consent: `members: Buffer[]` + `Buffer.concat`, `consent-export.runner.ts:105-120`), mitigated by concurrency 1.
- Fix: hourly sweep that also re-enqueues `queued` rows older than a minute (same idea as lead-sync) and fails `running` after a heartbeat gap.
- Spec: sweeps have no spec found by name; e2e for consent export not checked.

### A7 - P1 - Privacy erasure executes inside one HTTP request transaction
- `PrivacyRequestsService.erase` (`privacy-requests.service.ts:444-510`): one `db.tx` runs the dry run (`:468`), a second counting dry run (`:500`) and the
  real run (`:508`) over the whole registry, then loops audit + outbox per doomed contact. For a subject with large history this is minutes in a single
  tx (statement timeout / proxy timeout -> rollback). Atomicity and "preview must equal execution" are good and I verified them; the problem is that a
  heavy subject cannot complete and there is no status/progress, so a legal deadline can be missed with the only symptom an HTTP error.
- Fix: keep the two-phase confirmation, move step 2 to a worker job (`privacy-erase` queue) with request status `in_progress` already modelled
  (`PRIVACY_...` events 'from in_progress'), chunk by registry holder with a durable cursor.
- Spec: `test/e2e/privacy/rights.e2e.spec.ts`, `test/integration/privacy/pipeline-sql.spec.ts` (correctness, not size).

### A8 - P1 - Erasure's file deletion gives up quietly
- `StoragePurgeService.pass` picks rows with `attempts < 8` every 10 min (`storage-purge.service.ts:39,57`) and increments on failure (`:94`). A storage
  outage longer than ~80 min parks every file ("stays with its last error for an operator", comment `:19-22`) and nothing alerts. The privacy proof says
  erasure is complete only when the queue is empty. `PrivacyMaintenanceService.moveFiles` runs every minute (`privacy-maintenance.service.ts:31`) and
  `drainFiles` is capped at 20 x 500 per tick (`:50`), fine.
- Fix: exponential `next_attempt_at`, no hard park (or park + alert + admin "retry parked"), metric on `count(*) WHERE purged_at IS NULL AND attempts >= 8`.

### A9 - P2 - Reports/dashboards computed live in the request
- Dashboard repositories issue many live aggregates per request (`dash.repository.ts` 16, `dash-widgets.repository.ts` 15, `dash-panels.repository.ts` 10,
  `dash-extras.repository.ts` 8 `GROUP BY/count(*)` occurrences; `platform-metrics.service.ts` 27; `plan-analytics.service.ts` 27), no cache in `dash.service.ts`
  (grep for cache: none). `wallet-query.service.ts:201` sums `usage_charges` live. `docs/architecture/analytics.md` states the rule "never a live GROUP BY"
  but nothing emits events yet (E1), so this is the interim. Invoice PDF render is synchronous but pure and small (`invoice-pdf.service.ts:11`). Wallet statement CSV is
  streamed and capped (`wallet-export.service.ts:26`), OK.

---

## 3. (b) Billing, wallet, subscriptions

### B1 - P1 (design drift) - Per-message wallet lock, charge after delivery, no reservation
- `docs/architecture/billing.md` describes reservation at campaign start and a ~60 s roll-up. The code does neither: `MessageBillingService.settleDelivered`
  (`message-billing.service.ts:68-249`) runs per delivery event, claims `usage_charge_keys` (`:93`), takes the workspace wallet row lock (`:109`, and again in
  `WalletLedgerService.post` `wallet-ledger.service.ts:176`), counts the month, prices, posts and writes `usage_charges`. Throughput per workspace is bounded by one
  serialised row lock per delivered message; the doc calls this "the most important performance decision" to avoid.
- Because the charge happens after delivery, an empty wallet is only caught by `WalletGateService` which deliberately fails open on lookup errors and caches an
  `ok` verdict for 3 s (`wallet-gate.service.ts:42,52,99`); the shortfall is written as `wallet.charge.partial/unbilled` (`message-billing.service.ts:185-203`).
  That is a documented revenue-leak trade-off, but there is no reservation hold, so a large launch can overspend without bound.
- Positive (read and verified): claim-then-lock-then-post in one tenant tx; ledger idempotency key `charge:<wamid>` (`:146`); refund key `refund:<chargeId>` (`:302`);
  failure-before-success closes the key as `refunded` (`:274`); everything rolls back together.
- Fix: decide: either implement the reservation + roll-up from the doc, or rewrite the doc. Interim: batch settlement per (org, minute) from the outbox events.
- Spec: `test/e2e/wallet-message-billing/engine.e2e.spec.ts`, `test/integration/wallet-message-billing/wallet-schema.spec.ts`.

### B2 - P1 - Settlement lost when the outbox dead-letters it; reconcile cannot detect it
- Settlement is only reachable through the outbox subscriber (`delivery.consumer.ts:43-85`, rethrows so the drain retries). The drain dead-letters after
  `MAX_ATTEMPTS = 8` (`outbox-drain.service.ts:19`) with `2**attempts` seconds backoff (`:124`): waits of 2+4+...+128 s = ~254 s, i.e. about 4 minutes of
  continuous failure (DB failover, lock timeouts on a hot wallet row, deploy) and the event is `dead`. Result: a delivered message never charged, or a failed message
  never refunded. I found no code that lists, alerts on or replays `dead` rows (grep `'dead'` hits only the drain, heartbeat lag query, partition maintenance and
  three module repositories); `docs/runbooks/outbox-backlog.md` is manual SQL.
- `WalletReconcileJob` checks `balance == sum(ledger)` only (`reconcile.job.ts:19-38`), not "every delivered message has a `usage_charges`/`usage_charge_keys` row".
- Fix: (1) per-subscriber retry horizon of hours for billing events, or a dedicated billing queue (the unused `BILLING_POSTING` constant) with 20+ attempts and DLQ;
  (2) a nightly "delivered but unbilled" reconciliation over message delivery events vs `usage_charge_keys`; (3) alert on any `dead` billing event.
- Spec: none for dead-letter behaviour of billing.

### B3 - P1 - Refund double-spend and stuck `pending`
- `RefundService.refund` claims with `alreadyRefunded` (SUM of rows `status <> 'failed'`, `refund.service.ts:305-309`) then `INSERT ... 'pending'` (`:239-243`)
  in the same tx but with no `FOR UPDATE` on the order/subscription and no unique constraint: two concurrent requests both read `prior=0` and both insert.
  The provider call (`:250`) carries no idempotency key. Drivers return `{ok:false}` on timeout/network error (Razorpay `refundPayment` catch, `razorpay*.ts:401-430`), the row becomes
  `failed` (`:272`) and `failed` rows are excluded from the sum, so a refund the provider actually processed can be refunded again. If the process dies between `:246` and the
  record step, the row stays `pending` for ever, counts against `room`, and nothing sweeps it.
- Fix: lock the payment row (`SELECT ... FOR UPDATE` on orders/subscriptions) before computing room; send the refund row uuid as provider idempotency/notes reference and look the
  refund up before retrying; treat timeouts as `unknown` (count against room) not `failed`; sweeper that polls `pending/unknown` rows older than N minutes.
- Spec: `test/e2e/platform-payment-gateways/admin-billing.e2e.spec.ts` (24 refund references) and `paygw-subscription-management.e2e.spec.ts`; no concurrency case found (grep concurrent/Promise.all: none).

### B4 - P1 - AI usage charge is not idempotent and not reserved
- `lead-scoring.service.ts:354-358` and `:572-576` build the key as `ai-lsc:${orgId}:${contactId}:${randomUUID()}`. The ledger's `UNIQUE (org, key)` guard (`wallet-ledger.service.ts:178`)
  therefore never fires. Window: the tx that writes the score and the charge commits, the worker dies before acking, BullMQ re-runs the job (attempts default 5): vendor
  called again (platform pays) and charged again (customer pays twice; "score never overwritten" only protects the score, `lead-scoring.processor.ts` doc).
- `chargeWallet` for a paid-but-no-score call is `.catch(warn)` (`:572-579`): vendor cost incurred, no ledger row, no retry.
- `assertCanAfford` is a `balance > 0` peek (`ai-charge.service.ts:85-97`), not a hold; concurrent calls each pass and `allowPartial` truncates, so spend beyond balance is simply unbilled.
- Fix: key `ai-lsc:<jobId>` or `<runId>`; persist the run row before the vendor call and charge keyed by run id; sweep runs with cost but no ledger row.
- Spec: `test/e2e/lead-scoring/lead-scoring.e2e.spec.ts` does not reference the key.

### B5 - P1 - Payment webhooks are inline, unpersisted, and silent on mismatch
- `PaymentsService.handleWebhook` (`payments.service.ts:94-166`) verifies the signature, then does everything in the request: subscription events `apply` (a throw -> 500 so the
  provider retries, `:123-139`), one-time payments `fulfil`. The raw body is never stored, so a gateway that gives up after its retry budget (or a deploy during the window) loses the event with nothing to replay.
- Silent drops: amount/currency mismatch -> `ignored`, 200 (`:156-161`); no matching order -> 200 (`:149-155`). The buyer has paid, nothing was applied, no operator row, no alert.
- `activateForOrder` failure is `logger.error` only, relying on "the provider's notification repairs it" (`payment-confirmation.service.ts:82-87`), which is not true for a one-time order.
- No pending-order poller: the only paygw schedule is `SubscriptionReconcileScheduler` (`paygw-worker.module.ts:37-46`). A wallet top-up whose redirect and webhook were both lost is never credited.
- Positive: `fulfil` = one conditional `markPaid` then plan/wallet/coupon/audit/outbox in one tx (`fulfilment.service.ts:94-190`), wallet key `order:<uuid>` (`:150`): replays are harmless.
- Fix: persist verified webhook events (`payment_webhook_events`, unique provider event id), ack 200 after persist, process from a queue with retries/DLQ; "needs review" table for mismatches; hourly poll of orders `pending` > 15 min via `driver.confirm`.
- Spec: `test/e2e/platform-payment-gateways/paygw.e2e.spec.ts`, `paygw-p2.e2e.spec.ts`.

### B6 - P2 - Subscription reconciler burns its window on a failed poll
- The claim `UPDATE ... last_polled_at` happens before the provider call (`subscription-reconciler.service.ts:54,106`); `skip_poll_failed` or an exception (`:119-123`) consumes the 6 h
  window (`RECONCILE_THROTTLE_HOURS`). Polls are sequential, up to 50 per 10-minute tick. Claim is atomic (SKIP LOCKED), so multi-replica is safe.
- Fix: write `last_polled_at` only on a successful poll or use a shorter retry window on failure.

### B7 - P2 - No dunning, no renewal reminders, no trial-expiry worker for platform plans
- `PlansWorkerModule` provides only the retention sweep (`plans-worker.module.ts`); plan/trial expiry is evaluated lazily at read time (`planIsActive`, used in `message-billing.service.ts:86`).
  The marketplace has real sweeps (`marketplace/subscription-sweep.worker.ts:22` reminders, `:34` lapse). The "payment failed" mail is claimed in Redis before sending and never released
  (`subscription-notifications.consumer.ts:124-138`), so one SMTP failure means that owner is never told.
- Fix: platform-plan sweeper (reminder at -7/-3/-1 days, grace, downgrade event), release the claim on failure.

### B8 - P1 - Recurring invoice period skipped permanently on any error
- `generateIn` records a failed period and advances the schedule (`recurring-invoices.service.ts:453,477-490`); there is no retry of the same `period_index` and no auto-pause after
  repeated failures that I could see. A transient failure (deadlock, timeout, a missing buyer e-mail fixed an hour later) loses that invoice unless a human regenerates it.
  Idempotency itself is good: `claimRun` unique `(org, recurring_id, period_index)` (`recurring-invoices.repository.ts:282-293`), SKIP LOCKED per schedule (`:176-179`).
  `issue_send` marks the invoice sent and emits `invoice.sent` (`:518-540`); I did not trace a consumer that actually sends it.
- Fix: distinguish retryable (DB) from validation errors; leave the run row `failed` without advancing for retryable ones (retry next tick, max N), notify the owner.

### B9 - P1 - Reseller credit-line attach has no claim before the Meta call
- `attach` (`reseller-credit.service.ts:143`) reads the allocation, calls Meta (`askMeta` `:158`), then upserts the row (`:160`). `AutoAttachSweepService` is `@Interval(30_000)` on every
  replica (`auto-attach-sweep.service.ts:70`) with only an in-process `running` flag; `pendingAttachments({onlyNew:true})` returns numbers with no allocation row, so two replicas (or a crash after the
  Graph call) both call Meta for the same WABA. The service comment says "idempotent by construction"; that holds only for the row, not the external call. Whether Meta's attach is idempotent was not
  verified (assumption: not).
- Fix: insert an allocation row `status='attaching'` (unique per waba) first and call Meta only when this process inserted it; sweep stale `attaching`.
- Spec: `test/e2e/bsp-billing-engine/reseller-console.e2e.spec.ts`, `test/unit/bsp-billing-engine/reseller-rules.spec.ts`; no concurrency case.

### B10 - P2 - Wallet reconcile
- Hourly on every replica (`reconcile.job.ts:19`), first run one hour after boot, result is a `logger.error` (`:25-29`); the class comment promises an error row in the wallet log; I did not trace
  that path from `PlatformWalletService.reconcile`. No alerting hook.

### B11 - P2 - Refund of a failed message does not give the monthly free quota back
- `settleDelivered` increments `wallet_usage_months.messages` (`message-billing.service.ts:114-118`) and `settleFailed` never decrements it (`:252-330`). A message later reported failed keeps consuming
  the plan's free monthly allowance.

### Billing - what I verified as sound
Ledger post (`wallet-ledger.service.ts:152-282`): amount validation, row lock, idempotent replay, partial debit, balance+entry in the caller's tx. Fulfilment (`fulfilment.service.ts`). Referral reward: three layers
(`referral-reward.service.ts:19,55,78`, key `referral:<id>`). Overdue sweep claim and stamp in one statement (`invoice-overdue-sweep.service.ts:41-69`). Marketplace lapse sweep per-subscription lock (`subscription-lifecycle.service.ts:735-757`).

---

## 4. (c) Notifications, e-mail, web push, SMS

### C1 - P1 - System e-mail is sent inline in the request with no queue or retry
- There is no mail queue in `QUEUES`. `auth/mail/mail.service.ts:79-90` (`deliverDetailed`) calls `port.send` inside the request (verify e-mail, password reset, invites) and converts failure to
  `{sent:false}`; `marketing-site-cms/contact.service.ts:152` and `crm/sales-docs/sales-docs.service.ts:708` also send inline (the latter correctly surfaces `SALESDOC_SEND_FAILED`). An SMTP stall
  holds the request; a transient failure means the user clicks "resend". No DLQ, no record that a mail was owed.
- Fix: `mail-send` queue with persistence (`outbound_mail` row), retries with backoff, and a status the UI can show; keep neutral responses.

### C2 - P1 - One-shot mails from outbox consumers can be lost silently
- Lifecycle mail (workspace deletion/purge warnings): Redis NX claim then send; on failure the key is deleted but the error is swallowed and the event completes
  (`lifecycle-notification.consumer.ts:157-168`), so no retry. Subscription failed-payment and form-payment mails claim and never release (`subscription-notifications.consumer.ts:124-138`,
  `form-notification.consumer.ts:205-221`). The bell row is written first so the in-app notice exists; the e-mail is not retried.
- Fix: rethrow after releasing the claim (outbox retries), or move to the C1 mail queue.

### C3 - P2 - Browser push is deliberately best effort
- `NotificationPublisher.enqueuePush` runs after commit and swallows errors (a crash between commit and enqueue drops that push); the job has 4 attempts and drops quietly
  (`web-push.processor.ts:27-31`); retry is narrowed to failed devices (`:34`). Design is coherent for "late push is worse than none". Redis outage = no push, no record.

### C4 - P1 (shared with doc 01) - The outbox drain holds a DB transaction across all consumer I/O
- `drainBatch` (`outbox-drain.service.ts:86-143`) claims up to 200 rows `SET status='processing'`, runs `dispatchAll` (concurrency 6) and records outcomes, all inside a single `db.privileged` tx.
  Consumers in my scope do real network I/O there: SMTP (lifecycle/subscription/form mails), Google/Microsoft calendar write (`appointment-calendar.consumer.ts:46-54`), URL fetch
  (`ai-training/source-ingest.consumer.ts:54`), `queue.add` for webhooks. One 30 s hang delays the whole batch and holds a pooled connection plus row locks; an event is re-delivered to every
  matching subscriber when one fails (`outbox-subscribers.ts` dispatch), so every consumer must be idempotent (mails use Redis claims, see C2).
- Fix: claim in a short tx, dispatch outside it with a lease column, record outcomes in a second tx; move slow consumers (mail, calendar, URL fetch) behind their own queues.

### SMS / other channels
Not re-audited here (see 02). `channel-sms` has no worker of its own beyond the dispatch queue.

---

## 5. (d) Integration sync

### D1 - P1 - Customer webhooks: short retry horizon, no replay, no circuit breaker, unbounded log
- Retry: 6 attempts at 10, 20, 40, 80, 160 s (`outbound-webhooks/webhook-job.ts:10-12`) = ~5 min. A customer outage longer than that loses the event for good: final failure ->
  `UnrecoverableError` (`webhook-delivery.processor.ts:62-69`). 3xx/4xx except 408/429 are permanent on first sight (`send.ts:84`), including 401/404/410.
- No replay: controller routes are list/create/patch/delete/`:id/test`/`:id/deliveries` only (`webhooks.controller.ts:35-82`).
- Disable-on-failure: `recordResult` sets `is_failing` (`webhooks.repository.ts:158-180`) but nothing disables the endpoint or notifies the owner; every later event keeps queueing 6-attempt jobs to a dead URL.
- Retention: every attempt inserts a `webhook_deliveries` row with the full envelope (`:138-153`); no purge code exists in `apps/api/src` (only `webhook_forward_failures` has one).
- Dedup: `jobId = <eventId>-<webhookId>` (`webhook-dispatch.consumer.ts:58`) only holds while the BullMQ job is retained (`removeOnComplete: 1000` per queue `:61`); a late outbox redelivery after >1000 newer completions re-sends (receivers dedupe on the stable `id` header, which is sent).
- Positive: HMAC `sha256=` over `timestamp.body` (`signing.ts`), SSRF checked twice incl. inside the socket lookup, 10 s timeout, no redirects (`send.ts`), 1 KB response kept.
- Fix: longer schedule (hours, e.g. 8 attempts over 24 h) for 5xx/timeout, replay endpoint from the delivery log, auto-disable after N consecutive final failures with notification, retention (30 days) cron.
- Spec: `test/e2e/outbound-webhooks/webhooks.e2e.spec.ts` (test fire; no retry/disable cases found).

### D2 - P2 - Mail sync drops poison messages by design
- `mail-sync.service.ts` header (line ~36): a message that cannot be stored is counted, logged and left behind while the cursor advances. Inbound mail can vanish with no quarantine row. Loop is otherwise sound:
  60 s sweep (`mail-sync.sweep.ts:33`), jobId per mailbox (`mail-sync.publisher.ts:143`), `needs_reauth` handling and 5 min error backoff (`mail-sync-rules.ts:85`), cursor persisted per sync. The
  `getJob` + `add` check is racy across replicas but BullMQ jobId makes the second add a no-op. Specs: `test/unit/channel-email/mail-sync.service.spec.ts`, `test/e2e/channel-email/mail-sync.e2e.spec.ts`.
- Fix: store the failing provider message id in `mail_sync_failures` and surface it.

### D3 - OK, verified - patterns to copy
Calendar reconcile: atomic claim moves next time (`claimDueReconciles`), per-org Redis lock with token release (`calendar-reconcile.jobs.ts:44-62`), windowed jobId. Lead sync: stale-queued requeue and abandoned-run fail
(`lead-sync.worker.ts`). Media fetch: pending-message recovery + fixed jobId (`media-fetch-recovery.service.ts`). Meta lead ads: webhook enqueues `leadgen-<org>-<leadgenId>` (`channel-facebook/inbound.service.ts:141`)
and a 10-minute sweep re-reads recent leads (`meta-lead-ads/lead-sweep.service.ts:26`). Google Sheets add-on is synchronous but bounded per call (`EXT_SHEETS_MAX_ROWS/MAX_PULL`).

---

## 6. (e) Analytics event store, rollups, retention

### E1 - P2 - Ingestion is not wired
- `AnalyticsEvents` has no call site outside `kernel/analytics` and `kernel.module.ts` (grep of `modules`/`kernel`); `docs/architecture/analytics.md` says "Nothing emits events yet". Rollup and retention workers therefore run on an empty store, and every dashboard still uses live aggregates (A9).

### E2 - P2 - Silent loss and soft alerts
- The writer never throws; a failed insert is logged and counted in a savepoint (analytics.md "The writer never throws"). A tx open longer than the 60 s lag lands behind the watermark: day rows are repaired by the nightly reconcile,
  hour rows are not (doc). Staleness is a `logger.warn` (`rollup.worker.ts:34`), not an alert.
- Positive: pass is serialised by `pg_try_advisory_xact_lock` (`rollup.service.ts:73`), reconcile takes the same lock (`:129`), slices are time-bounded, watermark moves in the same tx.
  Specs: `test/integration/analytics/rollup.spec.ts`, `test/unit/analytics/rollup-worker.spec.ts`, `rollup-sql.spec.ts`.

### E3 - P2 - Retention covers one stream and is off by default
- `STREAM_POLICIES` registers only `an_events` (`data-retention/retention-policies.ts:26`); job needs `RETENTION_ENABLED=true` and defaults to dry run (`retention.worker.ts:61-90`). `PartitionMaintenanceService` only creates future
  partitions (`workers/partition-maintenance.service.ts:54-72`). I found no purge or partition drop for `event_outbox` (`done` rows), `audit_log`, `webhook_deliveries` (D1), `usage_charges` (by design kept a fiscal year, but no archival path either),
  `lead_first_replies`, `contact_import_jobs` (A1). Archiver itself is sound: verified manifest, hash read-back, count recheck under lock before drop, failure marker + pause (`partition-archiver.service.ts:103-108,186-270`); spec
  `test/integration/data-retention/partition-archiver.spec.ts`. The `@Cron` has an in-process guard only (`retention.worker.ts:61-64`); two replicas would both attempt, but each step is repeatable.
- Fix: add policies for `event_outbox`, `audit_log`, `webhook_deliveries`; alert if the oldest partition exceeds policy.

---

## 7. (f) Media, uploads, AV, search, AI jobs

### F1 - P1 - No antivirus anywhere
- `MailAttachmentScanner.scan` returns `{clean:true}` always (`channel-email/mail-attachment-scanner.ts:3-18`, "ANTIVIRUS HOOK POINT"). No scanning on inbound WhatsApp/Messenger media (`media-fetch.processor.ts` stores directly), the unauthenticated chat-widget upload
  (`chatbot-widget/widget-public.controller.ts:188-199`, 10 MB, only type sniffing), form file fields, chat/team-chat/contact-files uploads. Design is scan-before-store in the request, which blocks the request on a scanner and fails closed only if someone implements it.
- Fix: quarantine state on stored files (`scan_status`), async `av-scan` queue (clamd/SaaS), serve only `clean`; start with public and inbound paths.

### F2 - P2 - Memory-buffered uploads
- 23 controllers use `FileInterceptor` with memory storage (list from grep); import is 20 MB (A2), widget 10 MB. `media-fetch` uses spool files and concurrency 3 (`media-fetch.processor.ts` doc) which is the right pattern for large inbound files.

### F3 - OK / notes
- Search indexing: no external search or index jobs exist in `apps/api/src` (Postgres only). FAQ embeddings: Redis per-org lock (`faq-embed.worker.ts:75-80`), SKIP LOCKED claim, vendor call with no tx, text-equality guard, bounded attempts and self-heal (`:49-58`); a lock expiry of 90 s with up to 4 batches of 64 per tick could overlap on a slow vendor (lock is `EX 90`, not extended) - P2, harmless because stores are guarded.
- Lead scoring is rate limited (`limiter: {max:5, duration:1000}`, `lead-scoring.processor.ts:17`); billing issue in B4.
- URL knowledge ingestion rides the outbox (C4); entry stays `processing` if its event is dead-lettered (no sweeper).

---

## 8. (g) Privacy and maintenance crons

| Cron / interval | File | Claim for multi-replica | Notes |
| --- | --- | --- | --- |
| `PrivacyMaintenanceService.moveFiles` `* * * * *` | `privacy/requests/privacy-maintenance.service.ts:31` | SKIP LOCKED (`privacy-requests.repository.ts:516-528`) | OK |
| `PrivacyMaintenanceService.sweepDaily` 02:47 | `:59` | idempotent updates | export expiry, stuck export, overdue requests |
| `StoragePurgeService` `*/10` | `lifecycle/storage-purge.service.ts:39` | SKIP LOCKED | A8 |
| `LifecycleSweepService` 03:15, `LeaveSweepService` 5 min | `lifecycle/` | SKIP LOCKED in leave sweep (3 hits) | not read in depth |
| `RetentionWorker.nightly` 03:50 | `data-retention/retention.worker.ts:61` | none (repeatable) | E3 |
| Retention crons (api-library 03:41, flow-run 03:41, lead-scoring 03:41, faq 03:17, forms 03:17, plans 03:17, calling recordings 03:23, call log 03:41, notifications 03:30, push prune 03:40, webhook-forward 03:00, lead retention hourly :07) | respective `*-retention*.ts` | deletes are idempotent; notification retention uses locks | batches differ, not each verified |
| `AuthMaintenanceService` 03:00, `OtpTemplateRefreshService` 5 min | `auth/maintenance/` | not read | |

Visibility for all of these is the logger; none writes an operator-visible failure row.

---

## 9. (h) Heavy synchronous work in controllers (consolidated)

1. Contact import preview/start parse (A2), inline run up to 1000 rows (`IMPORT_SYNC_MAX_ROWS` `contact-import.ts:16`, fine in size).
2. Contact export 200k rows (A4). 3. Bulk operations 50k rows (A5). 4. Privacy erasure (A7). 5. Dashboard aggregates (A9).
6. Payment webhook fulfilment and provider polling in the request (B5); refund provider call in the request (B3).
7. Inline SMTP (C1). 8. Memory upload parsing (F2). Wallet statement CSV, invoice PDF and Sheets add-on calls are bounded and fine.

---

## 10. Gap register (priority order)

| ID | Sev | Area | Mechanism (short) | Fix (short) | Existing spec |
| --- | --- | --- | --- | --- | --- |
| B2 | P1 | wallet | outbox dead-letters settlement after ~4 min | billing queue + 20 attempts + DLQ alert + delivered-vs-billed reconcile | none |
| B3 | P1 | refund | SUM/INSERT race, timeout = failed, stuck pending | row lock, provider idempotency, `unknown` state, sweeper | admin-billing e2e (no concurrency) |
| B4 | P1 | AI charge | random idempotency key, swallowed charge | key by run id, charge-reconcile | none |
| B5 | P1 | payments | inline unpersisted webhook, silent mismatch, no order poller | persist events, queue, review table, poll | paygw e2e (happy paths) |
| B9 | P1 | BSP | Meta call before claim | insert-then-call | reseller-console e2e |
| B8 | P1 | invoices | failed period skipped | retry retryable errors | none found |
| B1 | P1 | wallet | per-message lock, no reservation, doc drift | decide design; update billing.md | engine e2e |
| A1 | P1 | import | lost queued job; CSV retained on failure | sweep + null CSV + retention | resume test only |
| A2 | P1 | import | whole-file parse on API loop | object store + worker parse | none |
| A4 | P1 | export | sync 200k stream, audit before file | async runner | none |
| A5 | P1 | bulk | 50k in one request tx, per-row outbox | worker path above 2k | bulk e2e (small) |
| A7 | P1 | privacy | erasure in one request tx | worker job with cursor | rights e2e |
| A8 | P1 | privacy | purge gives up after 8 tries, no alert | backoff + alert | none |
| C1 | P1 | mail | inline SMTP, no retry | mail queue | none |
| C2 | P1 | mail | one-shot lifecycle/subscription mail | rethrow / queue | none |
| C4 | P1 | outbox | tx held across consumer I/O | lease model | see 01 |
| D1 | P1 | webhooks-out | 5 min retry, no replay/disable/retention | see D1 | webhooks e2e (test fire) |
| F1 | P1 | media | no AV | quarantine + async scan | none |
| A6 | P2 | exports | orphan `queued`, daily-only sweep | hourly sweep + requeue | none |
| A3 | P2 | import | resume counters, rejects rewrite, no XLSX, no concurrency cap | see A3 | resume e2e |
| A9 | P2 | reports | live aggregates, no cache | rollups / cache | none |
| B6 | P2 | subscriptions | window burned on failed poll | claim on success | paygw e2e |
| B7 | P2 | plans | no dunning/reminder/trial worker | sweeper | none |
| B10 | P2 | wallet | reconcile log-only | alert row | none |
| B11 | P2 | wallet | refund keeps quota used | decrement | none |
| C3 | P2 | push | best effort by design | metric | push-subscriptions spec |
| D2 | P2 | mail sync | poison mail skipped | failure table | mail-sync specs |
| E1-E3 | P2 | analytics | not wired; soft alerts; one-stream retention | wire, alert, policies | rollup/archiver specs |
| F2 | P2 | uploads | memory buffering | stream to disk/object store | none |

---

## 11. Not read / limits of this audit

Shopify/Woo import and webhook processors (`ecom-import`, `ecom-webhook`), Waboo migration, Baileys history import, scheduled-queue-warmer, `device-runtime.service` ticks,
Pinnacle credit-line processor, support-desk SLA scan, SMS driver internals, `platform-wallet.service.reconcile` body, `auth-maintenance` body, and the consumers behind
`invoice.sent` were not read; they are inventoried below by name only. Meta idempotency of the credit-line attach and the gateway drivers' refund idempotency were assumed, not verified.
No tests were run.

---

## 12. Inventory of jobs, handlers and crons found

BullMQ processors (queue: class, concurrency) - in scope: `con-import`: ContactImportProcessor (2); `consent-export`: ConsentExportProcessor (1); `audit-log-export`: AuditLogExportProcessor;
`revenue-report-export`: RevenueExportProcessor; `msg-log-export`: MessageLogExportProcessor; `privacy-export`: PrivacyExportProcessor (1); `web-push`: WebPushProcessor (8);
`webhook-deliver`: WebhookDeliveryProcessor (16); `webhook-forward`: WebhookForwardProcessor; `mail-sync`: MailSyncProcessor (4); `lead-sync`: LeadSyncProcessor (2);
`meta-leadgen`: LeadgenProcessor (4); `meta-lead-sweep`: LeadSweepProcessor (2); `mkt-pull`/`mkt-inbound`: pull/inbound workers; `media-fetch`: MediaFetchProcessor (3);
`lsc-score`: LeadScoringProcessor (3, 5/s); `calendar-reconcile` (2) / `calendar-backfill` / `calendar-ics-refresh`; `calling-readiness`; `wab-migrate`; `ecom-import`; `ecom-webhook`;
`segment-actions`; `telephony-ingest`; `pinnacle-credit-line`; `tpl-sweep`. Other queues with processors (owned by 02/03): `campaign`, `message-dispatch`, `webhook-ingest`, `waba-ingest`, `bcast-dispatch`,
`tg-broadcast`, `line-broadcast`, `viber-broadcast`, `wechat-broadcast`, `fb-broadcast`, `fb-backfill`, `ig-pull`, `sched-run`, `flow-run`.
Queue constants with NO processor/producer: `outbox`, `billing-posting`, `sla-sweep`, `counter-flush`, `partition-maintenance`, `bulk-jobs`.

Outbox subscribers touched: `wallet-delivery-billing` (DeliveryBillingConsumer), WalletNotificationsConsumer, `outbound-webhooks` (WebhookDispatchConsumer), `appointment-calendar`,
`aiag-source-ingest`, `cpn-referral-code`, `cpn-referral-attribution`, `cpn-referral-reward`, SubscriptionNotificationsConsumer (paygw and marketplace), LifecycleNotificationConsumer,
FormNotificationConsumer, plus the notification consumers in `modules/notifications` (conversation, task, sla, team-chat, device, device-group, waba-group, email-bounce, member-leave, salesdoc,
appointment-drift, send-outcome).

Crons/intervals (class: schedule): WalletReconcileJob 1 h; SubscriptionReconcileScheduler 10 min; AutoAttachSweepService 30 s; marketplace SubscriptionSweepService `remind` hourly :15 and `run` every minute;
RecurringInvoiceSweepService 5 min; InvoiceOverdueSweepService 10 min; SalesDocExpirySweep 5 min; OwnerRestoreSweep 5 min; SegmentCountSweep 60 s; TaskDueSweep 60 s;
RollupWorker `pass` 30 s and `nightly` 02:15; RetentionWorker 03:50; PartitionMaintenanceService 02:00 and boot; OutboxDrainService 2 s;
PrivacyMaintenanceService `moveFiles` 1 min and `sweepDaily` 02:47; ConsentExportSweep 02:41; AuditLogExportSweep 02:47; RevenueExportSweep 03:23; MessageLogArchive 02:17;
StoragePurgeService 10 min; LifecycleSweepService 03:15; LeaveSweepService 5 min; MailSyncSweep 60 s; MailPushSweep; MailOutboundAttachmentsSweep; LeadSyncSweepService 30 s;
LeadFirstReplySweep 10 s; LeadRetentionSweep hourly :07; MetaLeadSweepService 10 min; MarketplacePullWorker 30 s and hourly :17; MarketplaceInboundWorker 20 s and hourly :37;
CalendarReconcileScheduler / CalendarBackfill / IcsFeeds ticks; AppointmentLifecycleSweep / ReminderSweep / GoogleConsentSweep 60 s; MediaFetchRecovery 60 s; QueuedMessageRecovery 30 s;
FaqEmbedWorker 5 s; LeadChatDigestSweeper 3 min; GrowthSweeper hourly :23 and 02:37; WaitingNudgeService 1 min; PushSubscriptionsPrune 03:40; NotificationRetention 03:30;
WebhookForwardRetention 03:00 and `flush` 5 s; ApiLibraryRetention 03:41; FlowRunRetention 03:41; LeadScoringRetention 03:41; FaqRetention 03:17; FormRetentionSweep 03:17;
PlanRetentionSweep 03:17; CallRecordingRetention 03:23; CallLogRetention 03:41; MinorSweep 03:35; AuthMaintenance 03:00; OtpTemplateRefresh 5 min; PageHealthSweep hourly;
InstagramPullSweep 20 s; CatalogSweeps 60 s; CartRecoverySweep 60 s; SupportSlaScan 5 min; SlaSweep 60 s; InboxSnoozeWake 30 s; Broadcast due/resume/retry sweepers 3 s / 60 s / 60 s;
CampaignSweeper 5 s; Wizard worker (5 s, 10 s, 5 s, 1 h); ScheduledDue 3 s; FlowSweeper 15 s; ScheduleSweeper 60 s; TemplateSweep; DeviceRuntime tick; DeviceGroupsSweep; HistoryImportSweep;
WabaClickSync; FormPaymentSweep `*/30`.
