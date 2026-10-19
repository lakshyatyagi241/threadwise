# Message-count rollup: design

Status: draft for owner review (2026-10-19). Nothing in this document is built. It is the Phase 1 slice of
[the event-based analytics design](2026-10-16-event-based-analytics-design.md) (approach B, chosen by the owner), narrowed to the one family that the
API timing report ([docs/quality/api-inventory](../../quality/api-inventory/index.html)) shows is still slow after the SQL fixes: **counts of messages**.

## 1. Why this, and what it buys

After the SQL rewrites in PR #648 every remaining slow statement reads 750,000 to 1,000,000 messages (a month of one busy workspace). Postgres
scans about 190 ms per month-long window at best, so no SQL change can reach the 50 ms goal. A rollup answers the same question from a few hundred rows.

Measured on a prototype (`tools/perf/message-rollup-prototype.sql`; 1M messages, 40 days, native Postgres 16, app role, UTC session):

| Read                                       | Live scan today | From the rollup | Rollup rows read                       |
| ------------------------------------------ | --------------- | --------------- | -------------------------------------- |
| Cards: out / in / delivered, 30-day window | 131 ms          | 4.5 ms          | 720 hour rows + 2 edge hours of events |
| Volume per day, 30 buckets                 | 146 ms          | 0.8 ms          | 30 day rows                            |
| All-time total of a workspace              | 52 ms           | 0.3 ms          | 164 day rows                           |
| Delivered share of the last 30 days        | 88 ms           | 0.4 ms          | 30 day rows                            |

Size: 1M messages became 2M events (291 MB with indexes, about 145 bytes per event), 3,844 hour rows (736 kB) and 164 day rows. Building the
hour rollup from the events took 0.7 s; the one-off event backfill took 12.8 s. The rollup equals the live count exactly (out 373,161 = 373,161;
delivered 373,161 = 373,161) provided the bucket boundaries and the read use the same time zone (section 6).

## 2. What is new compared with the approved design

The approved design stays: `an_events` is the append-only stream, `an_rollup_hour` and `an_rollup_day` hold the sums, a worker folds events in by
`recorded_at`, reads stitch rollup rows and a live tail, results are class F. This document adds four things the approved text does not decide:

1. **A feed-shaped metric, `MSG_FEED`**, next to `MSG_COUNT` (section 4). `MSG_COUNT` (type, channel kind, source) fits usage and billing; the history
   cards, the volume chart and the type mix also need the channel (to apply the personal-mailbox rule) and the message kind.
2. **A database trigger as the event writer for messages** (section 5), instead of app-side `record()` calls at three insert sites. About 15 to 30 µs
   per message against 2.3 ms for the app-side writer in the Phase 0 benchmark, and it cannot miss an insert site or a status path.
3. **A three-tier read** (section 6): day rollup for whole days, hour rollup for the hours around them, events for the partial hours at the window ends.
4. **Which callers may read the rollup and which must not** (section 7): a viewer whose visibility depends on assignment keeps the live scan.

## 3. Decisions this design needs from the owner

The approved design says a number that would differ must be a listed decision. These are the ones the message counts raise. Defaults are what the
rest of this document assumes.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                    | Default                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D8  | **Which time a status count belongs to.** Today the cards count messages created in the window, by their status now. Events record each transition at its own time, so "delivered" would count deliveries that happened in the window. The two differ only for messages created near a window edge and delivered after it (seconds to hours; on a 30-day window about 0.1 percent).         | Accept transition time. Exact cohort counts cost two extra events per status change (a -1 on the old status and a +1 on the new one, both stamped with the message's creation time); keep that as a fallback if a parity day cannot be explained. |
| D9  | **Average first-response time.** Today: conversations whose first customer message is in the window, to their first reply. The event `conv.first_reply` records the duration when the reply happens, so the average would be over conversations replied to in the window. It is the one card still at 480 ms after the rollup, and it is what keeps `message-history/summary` above 300 ms. | Accept reply-time attribution and serve it from `CONV_FIRST_REPLY_HIST` (sum of duration over count). Otherwise it stays a live scan.                                                                                                             |
| D10 | **Deleted messages.** The cards exclude a message deleted by a person (`deleted_at`). An event stream records that it was sent.                                                                                                                                                                                                                                                             | Count them (billing and usage would). A compensating event (-1) on delete makes the cards exact; it is cheap and rare, add it only if D8 parity needs it.                                                                                         |
| D11 | **Viewers with a narrower scope** (own or team assignment). Their cards depend on which conversations are assigned to them, which no org-level rollup knows.                                                                                                                                                                                                                                | They keep the live scan (section 7).                                                                                                                                                                                                              |
| D12 | **Top conversations** (the most active four) stays a class R read: it groups by conversation, which is high-cardinality.                                                                                                                                                                                                                                                                    | Keep it live, capped to the window it has today (about 260 ms). A per-day per-conversation rollup would be 50,000 rows a day for this one list.                                                                                                   |

## 4. Data model

### 4.1 Events the trigger writes

Types already exist: `msg.queued` (1), `msg.sent` (2), `msg.delivered` (3), `msg.read` (4), `msg.failed` (5), `msg.received` (6).

| Column                | Value for a message event                                                                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org_id`              | the message's                                                                                                                                                               |
| `type`                | by direction and status: outbound insert is `queued`; a status change to sent, delivered, read, failed writes that type; inbound insert is `received`                       |
| `occurred_at`         | creation time for `queued` and `received`; the change time for the others                                                                                                   |
| `recorded_at`         | `clock_timestamp()` (the partition key and the worker's cursor)                                                                                                             |
| `channel_id`          | the conversation's channel (one indexed read of `conversations`, the cost in section 5)                                                                                     |
| `conversation_id`     | the message's conversation                                                                                                                                                  |
| `source_kind`         | from `meta ->> 'source'` using the same mapping as `MESSAGE_SOURCE` in `message-history.query.ts` (inbox, flow, ai, api, auto_reply, broadcast, campaign, scheduled, other) |
| `k1`                  | the message kind class: text, template, image, video, audio, document, location, other                                                                                      |
| `direction`, `status` | the existing columns of the event                                                                                                                                           |

The trigger writes **no event** for `kind IN ('system', 'reaction')` and for the bubble a broadcast or campaign mirrors into a thread
(`meta.source` is broadcast or campaign and the broadcast or campaign id is set): the feed already leaves these out, and the recipient rows carry the
same send through their own events. No message text, number or name is ever copied (the existing PII test applies).

### 4.2 The rollup rule

```ts
{ metric: METRIC.MSG_FEED, types: MSG, dims: ['type', 'channel_id', 'feed_class'], n: 'count' }   // feed_class = source_kind * 16 + k1
```

`d1 = type` (the status and the direction), `d2 = channel_id`, `d3 = source_kind * 16 + k1`. Two small enumerations packed into one column keep the
existing `d1..d3` shape; a helper in `packages/contracts` encodes and decodes them and is the only code that knows the packing. If a fourth dimension
is wanted later, adding `d4` to the rollup tables is cheap while they are empty; this design does not need it.

Rows: one per (bucket, type, channel, feed class) with activity. The prototype, with one channel and one source, made 96 hour rows a day. The worst case
(6 types x 5 channels x 4 sources x 24 hours) is 2,880 a day per workspace, about 1M a year at hour grain, which is why the hour table keeps 120 days
(approved design) and the day table keeps everything.

### 4.3 Tenancy and privacy

Nothing new: the rollup tables already carry forced row-level security with the tenant policy, `org_id = 0` holds the platform rows, and the
`an_events` privacy manifest already exists. The new trigger functions are `SECURITY INVOKER` and only read `conversations` of the same workspace.

## 5. Write path: triggers on `messages`

```sql
-- AFTER INSERT, one event per message
CREATE TRIGGER trg_messages_event_insert AFTER INSERT ON messages
  FOR EACH ROW WHEN (NEW.kind NOT IN ('system','reaction')) EXECUTE FUNCTION an_event_from_message_insert();
-- AFTER UPDATE OF status, one event per status change
CREATE TRIGGER trg_messages_event_status AFTER UPDATE OF status ON messages
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.kind NOT IN ('system','reaction')) EXECUTE FUNCTION an_event_from_message_status();
```

Each function is wrapped in a `BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING` block: **analytics must never break a send**, the rule of the
approved design (section 4.2). A trigger on a partitioned table is created on the parent and applies to every partition, including ones created later; a statement-level trigger with a transition table also works on the partitioned `messages` (tested), which is the cheaper variant for bulk inserts.

Measured on this machine (the box was loaded, so read these as ranges): a 100,000-row bulk insert took 1.2 to 1.8 s without a trigger, 2.5 to 3.5 s with a
row trigger that looks up the channel, and 1.4 to 1.7 s with a statement-level trigger using a transition table. Twenty thousand single-row inserts
took about 52 µs each, and 67 to 78 µs with a row trigger, with or without the exception block (the difference is inside the noise). A status update
costs about 12 µs more. In round numbers: 15 to 30 µs per message, against a message pipeline that spends milliseconds.

Why a trigger and not `AnalyticsEvents.record()` at the call sites (the approved design's plan):

|                                                  | App-side `record()`                                                              | Trigger                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Cost per message                                 | about 2.3 ms per event (savepoint and a round trip)                              | about 15 to 30 µs                                           |
| Missed paths                                     | three insert sites and every status writer must be found; a miss is shadow drift | none: every insert and status update of `messages` fires it |
| Atomicity                                        | savepoint around each event                                                      | same transaction, guarded by the exception block            |
| Visibility                                       | in the service code                                                              | in a migration; needs a test and a note in the schema docs  |
| Other event families (campaigns, flows, billing) | yes, still app-side                                                              | not covered, unchanged                                      |

The cost of the trigger is that this one family's emit logic lives in SQL. The mapping tables (source, kind class) are duplicated between SQL and TypeScript and a test must keep them equal. If the owner prefers code-side emit, sections 4 and 6 are unchanged: only who writes the event changes.

**No hot row.** The earlier idea of a counter row per workspace and hour (`UPDATE ... SET n = n + 1`) is rejected: every message of a busy workspace would
lock the same row. Events are appended; only the worker writes rollup rows, in batches, under its advisory lock.

## 6. Read path

A window `[from, to)` in the workspace timezone is stitched from three tiers, each with the **same bucket expression the worker uses**
(`bucketExpr` in `rollup-sql.ts`, with the workspace timezone):

1. whole days inside the window: `an_rollup_day`;
2. the whole hours at either end that do not make a whole day: `an_rollup_hour`;
3. the partial hours at the two ends, and anything newer than the worker's watermark: `an_events` through `(org_id, occurred_at)`.

A 30-day window reads about 30 day rows, up to 46 hour rows and a few thousand events. The prototype stitched hours and events only (no day tier) and
took 4.5 ms; with the day tier it is under 1 ms.

**The time zone must match.** The first version of the prototype disagreed with the live count by 260 messages (0.07 percent) because the read truncated
hours in the session's zone (+5:30) while the buckets were UTC. Buckets are in the workspace's zone (a half-hour zone puts hour boundaries at :30 UTC),
so every read must build its bucket bounds with the workspace zone, never the connection's. The shared `bucketExpr` and a property test
(section 9) are how this stays true.

## 7. Who reads the rollup

| Caller                                                                                                                                      | Source                                            | Why                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard tiles, More hub, plan meters, operator console, system health                                                                     | rollup (platform rows for the operator)           | org-level counts                                                                                                                                      |
| Message History cards, volume chart, type mix for a viewer who sees every conversation                                                      | rollup, minus the channels the viewer may not see | the personal-mailbox rule is per channel: `d2 NOT IN (hidden channel ids)` with the hidden set read from `channels` and `mail_mailboxes` (a few rows) |
| The same pages for a viewer whose scope is own or team (D11), or with a text search, or a template, campaign, broadcast or scheduled filter | live scan (today's code)                          | those filters depend on rows the rollup does not keep                                                                                                 |
| Top conversations, the message feed, per-recipient lists                                                                                    | live (class R)                                    | high-cardinality (D12)                                                                                                                                |
| Distinct counts (conversations replied to)                                                                                                  | not this table                                    | approved design D1 (sets or sketches)                                                                                                                 |

A channel's mailbox scope changing later moves its past counts between "visible" and "hidden" in the live path and not in the rollup. It is rare and the rollup
errs towards what was true when the message was sent; note it in the parity docs.

## 8. Backfill, parity and operations

- **Backfill** from `messages` (and `message_events` for the true transitions) one workspace and month at a time, before a metric flips. The prototype did
  1M messages into 2M events in 12.8 s on a laptop; a year at the design target (800,000 messages a day, 292M messages) is about an hour of work at
  that rate, more on the 1 GB VM, so it runs in the background, throttled, a workspace and a month at a time.
- **Cut-over** by timestamp so live events and backfilled events never overlap (approved design 4.1).
- **Shadow phase** per metric (`legacy | shadow | rollup`): the old query is served, the rollup runs beside it, and differences are logged. Flip after N clean
  days. Expected differences are exactly D8, D10 and the channel-scope note; anything else is a bug.
- **Nightly drift check**: yesterday's per-type counts from `messages` against the day rollup; a difference is counted and the day is rebuilt from events.
- **Alarms**: watermark age; a day with messages and no events; trigger warnings in the Postgres log (they mean events were dropped).

## 9. Tests

On top of the approved list (section 10 there):

- **Property**: random messages with random status changes, deletions and time zones (including +5:30 and a DST change): the stitched read equals a direct
  count over `messages` for random windows, within D8 (assert the exact set of messages that may differ).
- **Trigger**: insert and status change write exactly one event; a system or reaction message, and a mirrored broadcast bubble, write none; an error inside the
  trigger leaves the message committed and logs a warning (force it with a missing partition).
- **Mapping parity**: the SQL source and kind class equal the TypeScript ones for every value (a table-driven test over a real Postgres).
- **Visibility**: for every viewer shape of `inbox-schema.spec.ts`, the rollup-with-hidden-channels count equals the live count (the same 96 viewers), and the
  scope-limited viewers are routed to the live path.
- **Load**: the Phase 0 load test with the triggers on, at 3M events a day; the budget is the approved 3 ms per message (expected: far less).

## 10. What each slow statement becomes

From the timing report (warm, app role). "Now" is after the PR #648 fixes.

| Statement                                                                         | Now                                                                       | With the rollup                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- |
| History cards, current and previous window                                        | 160 to 220 ms each                                                        | about 5 ms for a viewer who sees every conversation   |
| History volume and type mix                                                       | about 400 ms for volume, type mix and top list together (one shared scan) | 1 to 3 ms for the first two; the top list stays       |
| Delivered share, sent in 7 days, sent this month (More hub)                       | 147 ms together                                                           | under 1 ms                                            |
| A workspace's all-time message total                                              | 55 ms                                                                     | 0.3 ms                                                |
| Dashboard counts: sent, delivered, failed, read, replies                          | 100 ms                                                                    | under 5 ms; the distinct-conversation figures need D1 |
| Messages in the last 24 hours and 14-day series (operator console, system health) | 80 to 90 ms                                                               | platform (org 0) rollup, under 5 ms                   |
| Average first response                                                            | 480 ms                                                                    | under 10 ms with D9; otherwise unchanged              |
| Top conversations                                                                 | 260 ms                                                                    | unchanged (D12)                                       |

Effect on the routes: `message-history/insights` goes from about 420 ms to about 270 ms (the top list remains); `message-history/summary` from about
820 ms to about 15 ms if D9 is accepted, or about 490 ms if it is not; `shell/overview-stats` loses its three message scans (about 150 ms).

## 11. Alternatives considered

| Option                                        | Verdict                                                                                                                                                                                       |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Index with `status` for index-only scans      | Rejected: `status` changes on every send, delivery and read, so every update leaves HOT and bloats the hottest table.                                                                         |
| Materialized view refreshed on a schedule     | Rejected for the cards: stale by the interval, and a refresh re-reads the million rows it was meant to avoid. Fine for the platform-wide totals if the owner prefers no new worker for those. |
| Counter row per workspace and hour            | Rejected: one hot row per workspace (section 5).                                                                                                                                              |
| Approximate counts (`reltuples`, HyperLogLog) | Only for the operator's whole-platform totals, and only if the owner accepts an estimate (it changes what the number means).                                                                  |
| `pg_ivm` or TimescaleDB continuous aggregates | Not available on the production image (`pgvector/pgvector:pg16`, no extensions beyond that). Same idea as the worker, with a new dependency.                                                  |
| A second database (ClickHouse)                | Out of scope (approved design, section 12); the `an_` tables keep the seam.                                                                                                                   |

## 12. Rollout

1. **Migration**: `MSG_FEED` id in `packages/contracts`, the two trigger functions and triggers, the `feed_class` helper, the rule in `ROLLUP_RULES`; nothing reads it yet.
2. **Backfill and shadow** for the cards and the More hub (the largest wins), with the nightly drift check.
3. **Flip** the dashboard, More hub and meters, then History for the all-scope viewer, then the operator console on the `org_id = 0` rows.
4. **Retire** the live scans that no caller needs (keep the scope-limited path), and update `docs/quality/api-inventory` with the new timings.

Each step is a flag flip that can be reverted without a migration.

## 13. Risks

- The trigger puts a write on the hottest table. Measured at 15 to 30 µs and guarded so it cannot fail a send, but it must be in the Phase 0 load test on the real VM (1 GB Postgres).
- Event volume: 2 to 4 events a message. At the design target that is 3M a day, 15 GB a month, within the approved plan; the 60-day hot window and archive apply unchanged.
- Duplicated mapping tables (source, kind class) between SQL and TypeScript: covered by the mapping parity test.
- A mistake in the bucket zone shows up as a small constant drift, as the prototype did. The shared bucket expression and the property test are the guard.

## 14. As built (2026-10-19)

D8 and D9 were accepted by the owner. Implemented in `packages/db/migrations/20270201090000_msg_feed_events.sql`,
`apps/api/src/modules/analytics/query/message-feed.service.ts`, `.../team-inbox-conversations/message-history-rollup.ts`.

**D8 as built differs from section 3's default.** The default was "a message counts in the bucket of the moment it changed status".
Exclusive status cards (queued, sent, delivered, read, failed) cannot be computed from transition-time events: a message that moved
on would leave `queued` in a later bucket than it entered, and a window ending in between would show a negative count. Built instead as
**cohort deltas**: every event is stamped with the message's creation time (`occurred_at = created_at`) and a status change writes one
paired event that enters the new status and leaves the old one (`MSG_STATE`, `status` / `k2`, rollup rule `paired: 'k2'`). A bucket
therefore holds "messages created in this bucket, by the status they have now", which is what the live scan returns for the same window.

**D9 as built:** the average first reply is the average over first replies _made_ in the window (`CONV_FIRST_REPLY` events, whole hours
of the window), not over conversations that started in it. It is excluded from the shadow comparison because it is defined differently.

### Pieces

- Writer: triggers `trg_messages_feed_insert` / `trg_messages_feed_status`; every body is a guarded block that logs a warning and
  returns, so a message is never refused because of analytics. First-reply state lives in `conversations.first_inbound_at` /
  `first_replied_at`.
- Two sources, two metrics, so they never mix in a bucket: `MSG_FEED` (messages created at or after `an_msg_feed_cutover()`, from events,
  folded by the worker) and `MSG_FEED_BASE` / `CONV_REPLY_BASE` (older messages, rebuilt from `messages` by `an_msg_feed_rebuild_base`).
- Read: `MessageFeedService` stitches day rows, hour rows, the unfolded event tail and the partial-hour edges from `messages`, in the
  workspace timezone. The integration spec proves it equals a count of `messages` for random windows in UTC, Asia/Kolkata and
  America/New_York, with and without a hidden channel, and unchanged by the worker folding the tail.
- History: `ANALYTICS_SOURCES={"msg_feed":"shadow"}` serves the scan and logs any difference; `"rollup"` serves the rollup; default is
  `legacy`. Used only when exact (`rollupApplies`): the viewer reads every conversation, no scoping filter, no text search, request
  timezone equals the workspace's. Recipient rows of broadcasts / campaigns / scheduled sends and the top conversations stay live.

### Rollout

1. Deploy (migration sets the cut-over to its own run time).
2. `pnpm --filter @crm/api backfill:message-feed` (all workspaces; `--org`, `--from`, `--to` narrow it). Repeatable.
3. `ANALYTICS_SOURCES={"msg_feed":"shadow"}`; watch `AnalyticsShadow` logs for differences for a few days.
4. Switch to `"rollup"`. The nightly job rebuilds the base of the last 7 days (a no-op once the cut-over is older than that).

### Known limits

- A message deleted by a person stays counted (D10); the live scan leaves it out. Shadow mode will log that difference.
- Daylight-saving: a window boundary inside the repeated local hour cannot be answered exactly from hour buckets.
- Messages older than the cut-over reflect later status changes only after the next base rebuild (nightly, last 7 days, or the backfill command).
- History imported later with old `created_at` needs `backfill:message-feed --from/--to` for its range.
- A channel's mailbox scope changing later is not applied retroactively to past rollup rows (section 7).
- If the event write fails (it logs and continues), that message is missing from the rollup until the day is reconciled or rebuilt.
