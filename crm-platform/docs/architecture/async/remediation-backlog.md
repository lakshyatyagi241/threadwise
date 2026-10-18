# Async reliability: remediation backlog

Source: the four discovery reports in [discovery/](discovery/). IDs are theirs. Status is what the code on this branch does, checked by a test unless
stated. The discovery findings came from reading code; "open" means not changed here, not "confirmed broken".

## Fixed on this branch

| ID (report)             | What                                                                                                                                  | Proof                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| D1, C-4 (01, 02)        | Outbox retries 26 times with jitter (2 to 4 hours); dead events are counted in the health sample (`dead_letters`) and replayable      | unit, real Postgres  |
| D2, D10 (01)            | WhatsApp ingest retries about 40 minutes; Meta's redelivery replaces a failed job; payload sealed in Redis                            | unit                 |
| D11 (01)                | Operator list and replay for dead outbox events, failed WhatsApp ingest jobs and failed channel webhook events (audited, super admin) | unit, real Postgres  |
| A-1, A-2, F-1 (02)      | Telegram, Viber, LINE, Facebook: a failed store is kept in the `webhook-retry` queue (sealed) and the provider keeps its 200          | unit, booted-app e2e |
| B-8 (02), B-1 (03)      | A resumed or retried broadcast replaces the finished job under its uuid, so it runs                                                   | unit                 |
| Idempotency audit gap 1 | The order-received message is claimed once per order on `wa_orders` (durable, stale claim recovered after 10 minutes)                 | unit, real Postgres  |
| Dead-event index lock   | Migration fails fast (3 s lock wait); per-partition `CONCURRENTLY` tool for large tables                                              | real Postgres        |

## Reviewed and not a defect

- **B4 (04) AI usage charge key.** `ai-lsc:<org>:<contact>:<random>` looks like a retry double-charge, but a retried scoring job makes a new paid
  provider call, so each charge is for a distinct call, and the success-path charge shares one transaction with the score. What remains is that a
  charge failure after a paid call with no score is logged and swallowed (a small unbilled cost, by design: it must not break the flow).

## Open, by priority

### Money or customer-visible duplicates (do first)

| ID            | Gap                                                                                                                      | Suggested fix                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| B-1 (02)      | A Cloud API timeout or unclassified error after Meta may have accepted is retried blindly; there is no `uncertain` state | Add an `uncertain` message state; reconcile by `wamid`/status before any resend                    |
| B-5, B-6 (02) | A DB failure after a successful campaign or broadcast send marks the recipient failed and re-queues it (duplicate)       | Write an intent row before the call; treat a stale `sending` as uncertain; keep `wamid` on failure |
| C-5 (03)      | No idempotency across the provider call in campaigns: a crash between accept and `markSent` resends after 10 minutes     | Same intent-row design; make the post-send writes conditional on the attempt id                    |
| B3 (04)       | Refund checks "already refunded" then inserts with no lock; a timed-out provider call is recorded `failed`               | Claim row per refund request before the gateway call; sweep `pending`                              |
| B2 (04)       | A delivered message whose billing fails for about 4 minutes was dead-lettered and never charged                          | Now replayable; also add a reconcile that finds delivered, uncharged messages                      |

### Throughput and scale (campaigns, 100k recipients)

| ID               | Gap                                                                                                        | Suggested fix                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| C-1 (03)         | Long official-engine campaigns trip the stall detector and spawn concurrent runners                        | Renew the run lease and `touch` inside the loop on a timer  |
| C-2 (03)         | Campaign launch materialises every recipient inside the HTTP request, in one transaction                   | Durable operation row, 202, chunked worker materialisation  |
| C-3, D-3 (03,02) | Every receipt recounts the whole campaign and updates one hot row                                          | Batched counter deltas flushed every few seconds            |
| C-4, C-6 (03)    | Whole-campaign screening at every run start; sweepers scan without `org_id` every 5 s on every worker      | Screen per batch; partial indexes; run sweepers on one pod  |
| D-1, D-2 (02)    | Receipts that beat the send commit are dropped; broadcast `failed` is terminal even if `delivered` follows | Grace retry like the inbox; allow `failed` to be superseded |

### Durability of the rest of the pipeline

| ID                  | Gap                                                                                                                                   | Suggested fix                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A-4, A-5 (02)       | WhatsApp Redis claim is set before the work (a killed worker drops the message); an `AppError` drops the whole multi-change payload   | Claim after success or with a short TTL; split by change before dropping |
| A-3 (02)            | Facebook and Telegram signature checks are fail-open when no secret is set (an existing e2e spec pins it)                             | Fail closed in production; keep open only for Meta's "Verify and Save"   |
| A-6, F-3 (02)       | Post-message hooks (STOP keyword, flow, routing, AI reply) run once, in process, errors swallowed                                     | Enqueue them as outbox events                                            |
| A-7 (02)            | Unofficial (Baileys) inbound is not durable end to end                                                                                | Persist before ack, as the Cloud API path does                           |
| B-3 (02)            | Baileys send lock (60 s) is shorter than the command timeout (130 s); a timeout is ambiguous                                          | Lock TTL above the timeout; classify a timeout as `uncertain`            |
| B-9 (02)            | No circuit breaker for bulk loops on a revoked token or sustained 429                                                                 | Per-number breaker honouring `Retry-After`                               |
| C-3 (02)            | The wallet is checked but never reserved                                                                                              | Reservation at enqueue, settled at delivery                              |
| D3, E-1 (01,02)     | The outbox drain holds one transaction across all handler I/O with no timeout                                                         | Per-event timeout; claim, commit, dispatch, then record                  |
| D5 (01)             | `event_outbox` is never cleaned                                                                                                       | Register it for partition archive and drop                               |
| D8 (01)             | The flow schedule sweeper commits its claim before enrolling                                                                          | Claim and enrol in one transaction                                       |
| B5, B8, B9, B6 (04) | Payment webhooks inline and unpersisted; recurring invoice period skipped on error; reseller attach has no claim before the Meta call | Persist the event first; retry the period; claim row first               |
| D1 (04)             | Customer webhooks retry about 5 minutes with no replay and no auto-disable                                                            | Longer horizon, replay, circuit breaker                                  |

### Heavy work inside HTTP requests

A2, A4, A5, A7, A8 (04): contact import parse, contact export (up to 200k rows), bulk operations (50k rows in one transaction), privacy erasure in one
request transaction, storage purge giving up after about 80 minutes without an alert. Move each to a queued job with progress and a status endpoint;
this changes the API contract (202 instead of the finished result), so it needs a product decision first.

### Observability and operations

D4, D6, D7, D9, D12, D13 (01): Prometheus gauges for queue depth, oldest age, failed and dead counts and an alert rule for each; a uniform recovery for the
commit-then-`queue.add` dual write; Redis HA and AOF `always` for the queues that hold accepted webhooks; error classification in the 16 processors that
have none; stall and event-loop coupling; per-tenant fairness. F1 (04): no antivirus anywhere.

## Decisions that are the owner's

1. Contract changes to 202 for imports, exports and launches (above).
2. Whether the Facebook and Telegram signature checks may fail closed (it changes what an existing e2e spec pins).
3. The wallet model: per-message charge after delivery (today) or reservation (what `billing.md` describes).
