# Event-based analytics and log retention: design

Status: draft for owner review (2026-10-16). Approach B chosen by the owner: raw events plus incremental rollups, in the same PostgreSQL.
Nothing in this document is built. Implementation plan comes after this spec is approved.

## 1. Intent

**What the owner asked for.** Stop keeping large amounts of log data in the live database. Keep a clean stream of **events** as the long-term
history, and drive **all analytics, graphs and meters** from events. It must stay fast and cheap with millions of rows: database, server,
queries and product. Try PostgreSQL first; no new service.

**Success looks like**

- Every dashboard, report, chart and usage meter in the inventory (section 7) reads rollups or events, never a live `GROUP BY` over `messages`,
  `wp_campaign_contacts`, `usage_charges` or similar.
- The retention numbers in section 6 are enforced by one engine, and the data it removes is archived cheaply, not lost.
- No Reference feature is lost or changed (HARD RULES in `docs/threadwise-port/PORTING_RULES.md`): same screens, same API contracts, same numbers.
  Where a number would differ, it is listed in section 13 as a decision, not changed silently.
- A design target of 500k outbound and 300k inbound messages a day (`docs/architecture/scale.md`) runs on the existing single-VM stack.

**Not in scope**: ClickHouse or any second database (a later swap, see section 12); changing any UI; the partner and mobile dashboards, which are
not built (A-060, A-061); the business tables themselves (`messages`, `invoices`, `wallet_transactions`) stay as they are.

## 2. What exists today (facts this design depends on)

- **No analytics pipeline.** Every dashboard, report and meter is a live `GROUP BY` or `count(*)` on the primary database inside the caller's
  tenant transaction. None use the read replica (`DatabaseService.txReplica` is used only by `partner` and `public-api`); in production the
  "replica" URL points at the primary anyway. There are no materialized views. `metric_counters` and the `COUNTER_FLUSH` queue are named in
  `scale.md` and `queues.ts` but not built.
- **The outbox is a work queue, not an event log.** `event_outbox` is drained every 2 seconds in batches of 200 (`FOR UPDATE SKIP LOCKED`), and
  `kernel/outbox/outbox.service.ts` documents that individual messages and receipts do not belong there. About 353 business event types go
  through it. There is no analytics consumer.
- **Message writes have three insert sites** (`chat-conversations/messages.repository.ts:220`, `chatbot-widget/_shims/sql-inbox-gateway.ts:273`,
  `broadcasts/broadcast-inbox-mirror.service.ts:129`) **and one choke point for delivery transitions** (`MessagesRepository.insertEvent`, used by
  outbound, receipts, dispatch and conversations). A delivered billable message writes about 8 to 10 rows today (est.).
- **Retention is row `DELETE` plus bytea archives, and partitions are never dropped.** 21 monthly-partitioned streams exist, each with a
  `_default` partition; `PartitionMaintenanceService` creates 3 months ahead and never drops. The message-log archive keeps gzip blobs in a
  Postgres `bytea` column. Every export file is `bytea` in Postgres; `S3_BUCKET_EXPORTS` is declared and unused.
- **Runtime.** Production is one Docker Compose VM (Hostinger): Postgres 16 (`pgvector/pgvector:pg16`) limited to 1 GB with `shared_buffers`
  256 MB, Redis 192 MB with `noeviction`, MinIO with buckets `crm-media`, `crm-documents`, `crm-exports`. No timescaledb, pg_partman or pg_cron.
  Disk size is not documented.
- **Worst queries today** (from the inventory): per-receipt campaign recount (`campaigns.repository.ts:459`), campaign and broadcast tiles polled
  every 15 s, 30-day dashboard scans of `messages`, a per-message hot wallet row, 38 sequential counts on the More hub, per-create quota counts
  (49 call sites), cross-tenant `GROUP BY org_id` over `messages` for the operator console.

## 3. Decisions already made

| Decision                                                                        | Choice                                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Architecture                                                                    | B: partitioned event table plus incremental rollups, same Postgres                                                            |
| Database                                                                        | PostgreSQL only for now; ClickHouse is a later seam, not a goal                                                               |
| Message delivery log                                                            | 60 days live, then a 2-year archive                                                                                           |
| Outbox                                                                          | done rows 30 days, dead rows 60 days, then archive                                                                            |
| Audit and security log                                                          | important 365 days, routine 90 days                                                                                           |
| Money evidence (`usage_charges`)                                                | archive after 1 year                                                                                                          |
| Compliance proof (consent, privacy, lifecycle) and `wallet_transactions` ledger | forever                                                                                                                       |
| Usage metering (AI, translation)                                                | 90 days raw                                                                                                                   |
| Integration payload logs                                                        | payload 14 days, metadata 90 days, then archive 1 year                                                                        |
| Automation and AI run logs                                                      | 90 days, then archive 180 days                                                                                                |
| Behaviour tracking                                                              | 30 days, then raw 90 days (widget visitors coarsened at 30 days)                                                              |
| Per-recipient delivery state                                                    | 90 days, then archive                                                                                                         |
| Sessions, notifications, export files, infra logs                               | as today, with the fixes in section 6                                                                                         |
| `messages` chat content                                                         | forever (product data, not a log)                                                                                             |
| Dormant tables                                                                  | 15 dropped in migration `20261216090000_drop_dormant_tables.sql`; about 35 kept because they back unported Reference features |

## 4. Architecture

```
 business transaction ──insert──► an_events (monthly partitions, 60 days hot)
        │                              │
        │ (same tx, savepoint)         │ rollup worker, every 30 s, watermark on recorded_at
        ▼                              ▼
   OLTP tables                  an_rollup_hour (120 days)   an_rollup_day (forever)
   (unchanged)                         │                           │
                                       └───────► AnalyticsQueryService ◄── live tail of an_events
                                                    │  (Redis cache, single-flight)
                                          dashboards, reports, meters, exports

 retention engine (daily): month leaves its live window ─► gzip NDJSON per workspace to the bucket ─► verify ─► detach + drop
```

### 4.1 Event model (`an_events`)

- One table in `public`, prefix `an_`, no foreign keys, so the whole `an_*` set can later move to its own Postgres. It follows the stream
  invariants in `schema-invariants.spec.ts`: monthly range partitions, `_default` partition, primary key `(id, recorded_at)`, explicit
  sequence, forced row-level security with the tenant policy.
- Columns, kept narrow (measured at about 170 bytes per event with indexes, so the design target of 3M events a day is about 15 GB a month and about
  31 GB for the 60-day hot window; see [the Phase 0 benchmark](../../performance/analytics/phase0-bench.md)):
  - identity: `id`, `org_id`, `type` (smallint from a registry in `packages/contracts`, stable numeric ids)
  - time: `recorded_at` (insert time, partition key) and `occurred_at` (business time, for example the provider's delivered time)
  - dimensions, nullable: `channel_kind`, `direction`, `status`, `source_kind` (campaign, broadcast, scheduled, flow, inbox, api), `channel_id`,
    `contact_id`, `conversation_id`, `campaign_id`, `flow_id`, `agent_id`, `template_id`, `device_id`, and two dictionary-coded smallints `k1`, `k2`
    (provider, model, failure reason, gateway) resolved through a small `an_dict` table
  - measures: `qty` (default 1), `amount_minor`, `duration_ms`, `tokens`
  - `props jsonb` for rare overflow. **No message text, no phone number, no email, no free text.** A unit test rejects PII-looking keys.
- Indexes: the primary key, a BRIN on `recorded_at` (rollup scans), and one btree `(org_id, occurred_at)` (drill-down). No unique index at insert
  time: idempotency comes from emitting at the existing transition points, which already ignore repeated provider reports. Backfill is
  separated from live events by a cut-over timestamp, so the two never overlap.
- Two metric kinds:
  - **Flow metrics** are sums over events: counts, amounts, durations, token totals.
  - **Stock metrics** are point-in-time values: total contacts, open pipeline value, wallet balance, active devices. They come from a daily
    snapshot job (`an_stock_day`), never from event arithmetic, so they cannot drift.

### 4.2 Write path

- `AnalyticsEvents.record(tx, type, dims)` and `recordMany`, called inside the business transaction, the same shape as `OutboxService.emit`.
- **Not the outbox.** The outbox is drained by a single-row-claim loop and documents that messages would drown it. Events are append-only with no consumer.
- Each write runs in a **savepoint**. If it fails, the error is logged and counted and the business operation continues: analytics must never
  break a send. A nightly check compares event counts with `messages` per day and flags any gap.
- Hook points, by phase: the three message insert sites and `MessagesRepository.insertEvent`; campaign callbacks and broadcast progress;
  conversation lifecycle and CSAT; flow-run start, end and failure; the AI token meter; charge settlement; link redirect; form views and
  submissions; calls; deals, invoices, orders and sign-ups.
- Emitting an event does not replace the existing write. The legacy counters keep working until the metric they feed has switched over (section 9).

### 4.3 Event catalogue (v1)

| Family           | Types                                                                                                                                                    | Key dimensions and measures                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Messages         | `msg.queued`, `msg.sent`, `msg.delivered`, `msg.read`, `msg.failed`, `msg.received`                                                                      | `channel_kind`, `direction`, `source_kind`, `campaign_id`, `template_id`, `device_id`, `conversation_id`, `status`, `k1` (failure reason) |
| Clicks and views | `click.tracked`, `chatlink.click`, `storefront.view`, `form.view`, `form.start`, `form.submit`, `form.complete`, `cmp.optout`                            | `campaign_id`, `contact_id`, source id                                                                                                    |
| Conversations    | `conv.opened`, `conv.assigned`, `conv.first_reply`, `conv.resolved`, `conv.csat`, `conv.sla_breached`                                                    | `agent_id`, `channel_kind`, `duration_ms`, `qty` (score)                                                                                  |
| Automation       | `flow.run_started`, `flow.run_completed`, `flow.run_failed`, `faq.match`                                                                                 | `flow_id`, `source_kind`, `duration_ms`, `status`, `k1`                                                                                   |
| Calls            | `call.ended`                                                                                                                                             | `agent_id`, `direction`, `status`, `duration_ms`                                                                                          |
| AI and usage     | `ai.tokens`, `translation.call`, `leadscore.run`                                                                                                         | `tokens`, `k1` (provider), `k2` (model), `amount_minor` (cost)                                                                            |
| Billing          | `bill.charge`, `bill.refund`, `wallet.topup`                                                                                                             | `amount_minor`, `status` (charged, free), `k1` (provider)                                                                                 |
| CRM and revenue  | `contact.created`, `contact.imported`, `deal.created`, `deal.won`, `deal.lost`, `task.completed`, `invoice.issued`, `invoice.paid`, `appointment.booked` | `amount_minor`, `duration_ms` (deal cycle), `agent_id`, `k1` (source, lost reason)                                                        |
| Platform         | `org.signup`, `plan.changed`, `order.paid`, `support.ticket_opened`, `support.ticket_resolved`, `support.first_response`, `referral.signup`              | `amount_minor`, `duration_ms`, `k1` (plan, gateway)                                                                                       |

### 4.4 Rollup engine

- Tables `an_rollup_hour` and `an_rollup_day`, each `(org_id, metric, bucket, d1, d2, d3, n, s1, s2)` with `(org_id, metric, bucket, d1, d2, d3)`
  as the primary key. The metric registry defines what `d1..d3`, `s1` and `s2` mean per metric. Only buckets with activity have rows.
  `org_id = 0` rows hold platform-wide rollups for the operator console (privileged read only).
- **Buckets follow the workspace timezone** (hour and day), computed at roll time from the organization's timezone, so India's +5:30 and the
  weekday-by-hour heatmap come out exact. A timezone change rebuilds the affected days from events inside the hot window; older history keeps the
  timezone it was written with.
- **Worker pass** (existing `@Interval` worker pattern), every 30 seconds, under an advisory lock:
  1. read events with `recorded_at` in `[watermark, now() - 60 s)`;
  2. `GROUP BY` bucket and dimensions, then `INSERT ... ON CONFLICT DO UPDATE SET n = n + excluded.n, ...`;
  3. advance the watermark in `an_rollup_state` in the same transaction.
     The 60 second lag is more than four times the statement timeout, so no open transaction can commit an event behind the watermark. Late events
     (by `occurred_at`) simply add to an older bucket because the scan follows `recorded_at`.
- **Self-heal.** A nightly job recomputes yesterday's day rollups from events, compares, fixes and counts drift. A crash resumes from the watermark.
- **Percentiles** (first-reply time, resolution time, p95 latency) are stored as fixed log-scale histogram buckets, one rollup row per bucket with the
  bucket index in `d3`. Plain sums therefore merge them across time, with no custom array merge.
- **Unique counts** (conversations contacted, contacts reached) cannot be added across buckets. They use exact sets below about 5,000 members and a
  small HyperLogLog sketch above that (about 2% error), stored per `(org, metric, day)` and merged at read time. See decision D1.
- **Stock snapshots.** A daily job writes `an_stock_day` from OLTP (`contacts`, open `deals` value, `devices`, wallet balance). Charts of "total over
  time" read this table.

### 4.5 Query layer

- One `AnalyticsQueryService` with `series(org, metric, from, to, grain, tz, filters, groupBy)`. A metric registry in `packages/contracts` defines
  source rollup, dimension meaning, allowed grains and window cap (the existing 366-day, 365-day and 3650-day caps are kept).
- Reads **merge rollup rows with a live tail** of `an_events` (`recorded_at >= watermark`, about 90 seconds), so in-flight campaign live counts are
  real-time and dashboards are at worst seconds behind.
- Results are cached in Redis with a short TTL (about 30 seconds for dashboards, 5 minutes for reports), de-duplicated for concurrent callers
  (single-flight), and read on the replica pool when a real replica exists.
- **Five access classes** decide where each screen reads from:

| Class | Meaning                                                                          | Reads                                                                         |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| F     | Flow metric by small dimensions                                                  | rollups plus tail                                                             |
| D     | Unique count                                                                     | per-day sets or sketches plus tail                                            |
| S     | Stock metric                                                                     | `an_stock_day` plus the live OLTP value for today                             |
| R     | High-cardinality drill-down (top conversations, per-recipient lists, event logs) | raw events in the hot window, then the archive; row cap and statement timeout |
| L     | Sub-5-second counters (bell, inbox badges, wallet balance)                       | unchanged OLTP counters, not analytics                                        |

- Platform-wide numbers (admin console, BSP P&L, operator health) read the `org_id = 0` rollups, which removes the cross-tenant `GROUP BY org_id`
  scans of `messages`.
- **Quota meters** (`monthly_messages`, AI-token caps, email, SMS) read month-to-date from the day rollup plus today's tail, so enforcement at create
  time is O(1) instead of counting rows. Hard caps that must not drift (`total_campaigns`, `sms_monthly`) keep the existing increment-only
  `plan_usage` ledger.

## 5. Privacy and tenancy

- `an_events` and the rollups are tenant tables with forced row-level security and the standard tenant policy. `org_id = 0` rows are readable only
  in a privileged transaction. Rollup and query code runs inside the same tenant sessions as the rest of the API; the worker is privileged.
- Events hold ids and numbers only. `contact_id` is a link to personal data, so the personal-data registry (`privacy/manifests`) gets an entry for
  `an_events` that **anonymises** (`contact_id` to NULL) on a contact erase request, and workspace erase deletes `an_events` by `org_id` and the
  archive prefix `<org_id>`. Rollups hold no contact ids.
- Archive objects are written per workspace (`archive/<stream>/<yyyy-mm>/<org_id>.ndjson.gz`), so an erase or a tenant export is a prefix operation.
  **Archive objects omit `contact_id`** (the retention policy lists omitted columns), so a contact erase never needs an archive rewrite. Anything that
  needs per-contact history after 60 days reads the business tables, not the archive.
- `RBAC` is unchanged: each analytics endpoint keeps its current permission and plan-feature gate.

## 6. Retention engine

One daily job and one policy registry (code, with per-environment overrides). A policy is `stream, live_days, archive_days, mode`.

**Procedure for a partitioned stream.** When a whole month is older than `live_days`:

1. export it as gzipped NDJSON per workspace to `crm-archive` (a new bucket, or a prefix in `crm-exports`);
2. verify the row count and a hash against the partition;
3. detach and drop the partition (instant, no vacuum debt);
4. delete archive objects older than `archive_days`.

For unpartitioned tables (`broadcast_contacts`, `wp_campaign_contacts`, `scheduled_message_contacts`, `flow_runs` and steps, `faq_match_logs`,
`lead_scoring_runs`): whole parents past the live window (for example a campaign older than 90 days) are exported then deleted in batches, after
their totals are frozen in the rollups. The existing sweeps are reused and keep their batch caps. Payload-only trims (`UPDATE ... SET payload = NULL`)
cover the 14-day payload / 90-day metadata rule.

| Stream                                                                                                                                         | Live                                | Archive             | Notes                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `an_events`                                                                                                                                    | 60 days                             | forever, compressed | the long-term event history; rollups outlive it                                                                                                                           |
| `an_rollup_hour`                                                                                                                               | 120 days                            | none                | day rollups cover older history                                                                                                                                           |
| `an_rollup_day`, `an_stock_day`                                                                                                                | forever                             | none                | small                                                                                                                                                                     |
| `message_events`                                                                                                                               | 60 days                             | 2 years             | replaces `message_event_archives` (`bytea`), which is migrated to the bucket then dropped                                                                                 |
| `message_ledger`                                                                                                                               | 60 days                             | none                | the sweep promised in its migration and never built                                                                                                                       |
| `event_outbox`                                                                                                                                 | done 30 days, dead 60 days          | length: D2          | partition drop after export                                                                                                                                               |
| `audit_log`, `security_events`                                                                                                                 | routine 90 days, important 365 days | none                | new `retention_class` set at write from an action registry (D3); mixed rows share a partition, so routine rows are batch-deleted and the partition is dropped at 365 days |
| `usage_charges`, `usage_charge_keys`                                                                                                           | 1 year, keys 90 days                | per money rules     | `wallet_transactions` stays forever; the wallet reconcile job reads only the ledger                                                                                       |
| `ai_token_usage`, `translation_usage`                                                                                                          | 90 days                             | none                | day rollups keep the history                                                                                                                                              |
| integration payload logs (`webhook_deliveries`, Shopify and Woo logs, `api_library_logs`, forward failures, marketplace events, `lead_events`) | payload 14 days, metadata 90 days   | 1 year              | dormant HubSpot, Slack and Trello logs follow when they get writers                                                                                                       |
| `flow_runs`, `flow_run_steps`, `faq_match_logs`, `lead_scoring_runs`                                                                           | 90 days                             | 180 days            | see D4 for the 30-day window that is a Reference contract today                                                                                                           |
| `web_form_events`, `wa_link_clicks`, `wa_call_events`                                                                                          | 30 days then raw 90 days            | none                | `chatbot_widget_visitors` coarsened at 30 days                                                                                                                            |
| per-recipient state                                                                                                                            | 90 days                             | length: D2          | campaign totals live on in rollups                                                                                                                                        |
| sessions, notifications, tokens                                                                                                                | as today                            | none                | unchanged                                                                                                                                                                 |
| compliance proof, `wallet_transactions`, `messages`                                                                                            | forever                             | n/a                 | unchanged                                                                                                                                                                 |

Cost and hygiene items folded in, because they are the same job:

- Export files (`contact_exports`, `message_log_exports`, `audit_log_exports`, consent, privacy, revenue exports) move from `bytea` to
  `crm-exports`, using the already-declared and unused `S3_BUCKET_EXPORTS`. File TTLs stay at 7 days (contact exports 30).
- Redis: completed job payloads kept 1 hour (count 1,000), failed 3 days (count 2,000); `waba-ingest` and `webhook-forward` stop keeping message
  text and phone numbers in job data after completion. This also protects the 192 MB `noeviction` Redis from filling.
- Docker log rotation (`json-file`, `max-size`) added for `postgres`, `redis` and `minio`, which are unrotated today.
- `ArchiveReader.stream(stream, org, from, to)` lets the Message History 365-day export (and any other long-range export) read live partitions and
  archive objects through one interface.
- Rule: a stream's retention cut ships only after the screens that read it have switched to events or the archive reader.

## 7. Analytics inventory and where each item reads from

All 64 items from the read-side inventory. "Built" is as of `main`. Contracts and screens do not change.

| IDs                          | Item                                                           | Class   | Events                                                               | Notes                                                                           |
| ---------------------------- | -------------------------------------------------------------- | ------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A-001, A-002                 | Dashboard KPI tiles, sparkline, throughput                     | F, D    | `msg.*`, `flow.run_completed`                                        | funnel stages count distinct conversations (D1)                                 |
| A-003                        | Dashboard data cards                                           | F, S    | `msg.*`, `flow.*`                                                    | contacts, campaigns, devices come from stock snapshots and live OLTP counts     |
| A-004 to A-006               | Analytics overview, panels, CSV export                         | F, D, R | `msg.*`, `conv.*`                                                    | heatmap uses local-hour buckets; top-5 conversations is class R                 |
| A-007                        | More hub (about 38 counts)                                     | F, S    | many                                                                 | one query service call per card group; all-time totals come from the day rollup |
| A-008                        | Inbox tab badges                                               | L       | none                                                                 | unchanged live counters                                                         |
| A-009                        | Team performance                                               | F       | `conv.first_reply`, `conv.resolved`, `conv.csat`, `msg.*`            | histograms for median reply time                                                |
| A-010                        | Tenant SLA compliance report                                   | F       | `conv.sla_breached` (new)                                            | not built today; becomes cheap                                                  |
| A-011                        | Message History cards, volume, cost                            | F, R    | `msg.*`, `bill.charge`                                               | the feed itself stays a keyset query on `messages`                              |
| A-012, A-013                 | Broadcast tiles and detail, delivery curve                     | F, R    | `msg.*` with `campaign_id`, `click.tracked`                          | hour curve in the broadcast's timezone; recipient lists class R                 |
| A-014                        | Click counting                                                 | F       | `click.tracked`                                                      | the synchronous counter path is replaced by an event                            |
| A-015 to A-018               | Campaign list, detail, summary, CSV                            | F, D, R | `msg.*`, `click.tracked`, `cmp.optout`                               | removes the O(N²) per-receipt recount                                           |
| A-019                        | Scheduled-message funnel                                       | F       | `msg.*`, `source_kind = scheduled`                                   |                                                                                 |
| A-020                        | Growth Pilot reports                                           | F, R    | `msg.*`, `conv.*`                                                    | pilot workspaces only                                                           |
| A-021                        | Flow analytics                                                 | F       | `flow.run_*`                                                         | `days = 0` (all time) reads the day rollup                                      |
| A-022                        | FAQ insights                                                   | F, R    | `faq.match`                                                          |                                                                                 |
| A-023                        | Widget stats                                                   | F, S    | `msg.*`, visitors snapshot                                           |                                                                                 |
| A-024, A-025                 | Web-form and chat-link tiles                                   | F       | `form.*`, `chatlink.click`                                           |                                                                                 |
| A-026 to A-029               | Storefront, catalog, ecommerce dashboards                      | F, S    | `storefront.view`, `order.paid`                                      |                                                                                 |
| A-030, A-032                 | CRM dashboard, deal reports                                    | F, S    | `deal.*`, `task.completed`, `invoice.paid`                           | stage value and open pipeline are stock snapshots                               |
| A-031                        | Revenue report and async export                                | F, R    | `invoice.paid`                                                       | export stays an async job                                                       |
| A-033 to A-035               | Contact, group, tag, segment, task, appointment counts         | S, L    | `contact.created`, `appointment.booked`                              | segment counts keep their 5-minute cache; badges stay live                      |
| A-036                        | Lead scoring                                                   | F       | `leadscore.run`                                                      | distribution endpoint does not exist today                                      |
| A-037, A-038                 | Plan usage meters and quota enforcement                        | F       | `msg.*`, `ai.tokens`, `bill.charge`                                  | O(1) month-to-date read; hard caps keep `plan_usage`                            |
| A-039                        | Wallet summary, statement                                      | F, R    | `bill.*`, `wallet.topup`                                             | statement stays a keyset query on the ledger                                    |
| A-040, A-053, A-054, A-055   | AI, lead-scoring and translation usage                         | F       | `ai.tokens`, `leadscore.run`, `translation.call`                     | by provider and model through `an_dict`                                         |
| A-041                        | Call analytics                                                 | F       | `call.ended`                                                         |                                                                                 |
| A-042                        | Channel insights (Facebook, Viber)                             | F       | `msg.*`                                                              |                                                                                 |
| A-043                        | Notification bell                                              | L       | none                                                                 | unchanged                                                                       |
| A-044, A-045                 | Referral and privacy counts                                    | F, S    | referral and request events                                          | small; may stay direct queries                                                  |
| A-046 to A-050, A-052, A-056 | Operator overview, plan, financial, billing, support analytics | F       | `org.signup`, `plan.changed`, `order.paid`, `bill.*`, support events | platform (`org_id = 0`) rollups                                                 |
| A-051                        | BSP / reseller P&L                                             | F       | `bill.charge`                                                        | revenue minus Meta cost per workspace per month                                 |
| A-057                        | System health (24 h counts, 14-day throughput)                 | F       | `msg.*`, `ai.tokens`                                                 | queue and host vitals stay live                                                 |
| A-058, A-059                 | Workspace hub, marketplace usage                               | F, S    | `msg.*`                                                              | last-active reads `max(occurred_at)` from the day rollup                        |
| A-062, A-063                 | Baileys send cap, device 24 h counters                         | L, F    | `msg.sent`                                                           | `devices.sent_24h` has no writer today; it becomes a rollup read                |
| A-060, A-061                 | Partner and mobile dashboards                                  | n/a     | n/a                                                                  | not built; will read this service                                               |

Items listed as blocked or open in the parity docs stay as they are (A-064).

## 8. Failure modes

| Failure                           | Behaviour                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Event insert fails                | logged, counted, business write continues; the nightly gap check flags the day                                          |
| Rollup worker stalled             | alert on watermark age; reads still merge the live tail up to a cap; beyond it the screen shows a "data delayed" notice |
| Worker crash mid-pass             | the watermark moves with the upsert in one transaction, so a re-run starts from the last good point                     |
| Missing partition                 | `_default` partition catches rows, alert on any default row (existing check)                                            |
| Rollup drift                      | nightly recompute for yesterday fixes it and increments a drift counter                                                 |
| Archive export fails verification | the partition is not dropped; retry next run; alert                                                                     |
| Timezone change                   | affected days rebuilt from events inside the hot window                                                                 |

## 9. Rollout

| Phase | Scope                                                                                                                                  | Exit criteria                                                                                   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0     | `an_events`, registry, writer, rollup worker, query service skeleton, shadow-compare harness, retention engine core and archive reader | tripwire and property tests pass; load test at the design target on the production memory limit |
| 1     | messaging and campaigns: A-001 to A-020, A-057                                                                                         | each metric shadows clean for N days, then flips                                                |
| 2     | usage and billing: A-037 to A-041, A-051 to A-055                                                                                      | meters equal the live counts; enforcement is O(1)                                               |
| 3     | CRM, flows, forms, storefront, operator console, stock snapshots                                                                       | same                                                                                            |
| 4     | cleanup: remove the per-receipt recount, legacy counters and the bytea archives                                                        | no reader of the legacy path remains                                                            |

- Each metric carries a flag `legacy | shadow | rollup`. In `shadow` the old query is served, the new one runs beside it, and differences are logged.
  A metric flips only after N consecutive clean days.
- Each metric is **backfilled** from existing tables (`messages`, `message_events`, `usage_charges`, `flow_runs`, and so on) before it flips, within the
  hot window; older history comes from the existing archives where they exist.
- Retention cuts follow the screens: for example `message_events` goes to 60 days only after Message History reads events and the archive reader.

## 10. Testing

- **Unit:** metric registry and timezone bucket math (including +5:30 and DST zones); PII-key rejection on `props`; histogram bucket math.
- **Property:** rollup equals a direct aggregate of the events for random event sets, with late and out-of-order events.
- **Integration (real Postgres):** idempotency; crash and resume; two workers racing under the advisory lock; late event into an old bucket;
  forced row-level security on events and rollups; the archive export, verify and drop sequence; archive reader across live and archived months.
- **Parity:** old versus new result for every flipped metric on seeded data; the shadow log in staging.
- **Load:** 3M events a day (about 35 per second average, 10x burst) on the production memory limit. Targets: writer overhead under 3 ms, a rollup
  pass under 10 s, dashboard read p95 under 200 ms.
- **Security gates** as the repo requires: tenancy audit (new tables classified), authz, privacy registry entry for `an_events`.

## 11. Risks

- Postgres runs at a 1 GB container limit in production. Rollup reads are tiny, but event inserts and the monthly export compete for I/O and
  shared buffers at the design target (D5).
- Unique-count sketches change Reference's exact numbers for very large workspaces (D1).
- Emitting events in the business transaction adds one narrow insert per event (budgeted in the load test).
- The event catalogue must be complete before a metric flips; a missed emit site shows up as shadow drift, which is the purpose of the shadow phase.
- Several parity and audit baselines in the repo already fail on `main` for unrelated reasons (`waboo_migration_runs`, `flow_segment_state`,
  `google_consent_requests`); new work must not add to them.

## 12. Later seam to ClickHouse or a second Postgres

The `an_` tables have no foreign keys, are read only through `AnalyticsQueryService`, and the archive is plain compressed NDJSON. Moving the raw events
and rollups to another engine means changing the writer sink and the service's reader, not the screens.

## 13. Open decisions

| #   | Decision                                                                                                                                                  | Default if not answered                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Unique counts: accept about 2% error above 5,000 members per day (exact below)                                                                            | accept, and list the affected funnel cards in the parity notes                                                                                                                                                                                                       |
| D2  | Archive length for the outbox and for per-recipient state                                                                                                 | 365 days each                                                                                                                                                                                                                                                        |
| D3  | Important versus routine audit actions                                                                                                                    | important: authentication and security events, role and permission changes, billing, plan and wallet changes, data export or delete, impersonation, API keys and webhook secrets, privacy and consent changes, workspace security settings. Routine: everything else |
| D4  | Flow-run history is a 30-day Reference contract today (`FLOW_RUN_RETENTION_DAYS`); the owner chose 90 days for automation run logs                        | keep 30 days for the screen, retain 90 days of events behind it                                                                                                                                                                                                      |
| D5  | VM disk size, and whether to raise the 1 GB Postgres limit before the design-target volume arrives                                                        | measure in the Phase 0 load test, then decide                                                                                                                                                                                                                        |
| D6  | The four `*_flow_sessions` tables dropped earlier still need the channel owner's confirmation (punya)                                                     | recorded as pending in the parity docs                                                                                                                                                                                                                               |
| D7  | The writer's savepoint costs about 2.3 ms per event on the laptop benchmark (one round trip is 0.79 ms there); keep it, or switch to code-side validation | keep it on; re-measure on the real VM in Phase 1 staging and switch only if the p95 overhead there is above 3 ms                                                                                                                                                     |
