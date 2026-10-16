# Analytics: events and rollups

Every number on a dashboard, report or usage meter is read from **rollups** built from an **event stream**, never from a live `GROUP BY` over
`messages`, `usage_charges` or similar. Design and reasoning: [the spec](../superpowers/specs/2026-10-16-event-based-analytics-design.md).
Build order: [the plan](../superpowers/plans/2026-10-16-event-based-analytics-phase0.md).

## What exists (Phase 0)

```
 business transaction ──insert──► an_events (monthly partitions)
        │                              │
        │ AnalyticsEvents.record(tx)   │ RollupWorker, every 30 s, watermark on recorded_at
        ▼                              ▼
   OLTP tables                  an_rollup_hour   an_rollup_day
   (unchanged)                         │                │
                                       └──► AnalyticsQueryService ◄── live tail of an_events since the watermark
                                                  (Redis cache, one execution for concurrent callers)
```

| Piece                                                                     | Where                                                                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Event ids, dimension codes, PII guard, latency histogram, metric registry | `packages/contracts/src/analytics/`                                                               |
| Tables `an_events`, `an_rollup_hour`, `an_rollup_day`, `an_rollup_state`  | `packages/db/migrations/20261217090000_analytics_events.sql`, `packages/db/src/schema/analytics/` |
| Writer (called inside the business transaction)                           | `apps/api/src/kernel/analytics/analytics-events.service.ts`                                       |
| Rollup rules (which events feed which metric) and the shared SQL builders | `apps/api/src/modules/analytics/rollup/rollup-rules.ts`, `rollup-sql.ts`                          |
| Rollup pass, nightly reconcile, hour trim                                 | `rollup.service.ts`, `rollup.worker.ts` (worker process only)                                     |
| Reads                                                                     | `apps/api/src/modules/analytics/query/analytics-query.service.ts`                                 |
| `legacy` / `shadow` / `rollup` switch per metric                          | `apps/api/src/modules/analytics/shadow/metric-source.ts`                                          |

Nothing emits events yet and no screen reads a metric: Phase 1 hooks the message path and moves the first screens.

## The rules that make it correct

- **The watermark.** `an_rollup_state.recorded_before` says every event recorded earlier is already in the rollups. A pass adds the events in
  `[watermark, now - 60 s)` and moves the watermark in the same transaction, under an advisory lock. The 60 second lag is more than four times
  the statement timeout, so no open transaction can commit an event behind the watermark.
- **Business time versus insert time.** Buckets follow `occurred_at`; the scan follows `recorded_at`. A late event therefore adds to an older
  bucket, and replaying is impossible because the watermark moves with the upsert.
- **Buckets are workspace-local.** Hour and day buckets use the workspace timezone from `workspace_settings` (India's +5:30 comes out right).
  `org_id = 0` rows are the platform-wide rollups; they use UTC and are visible only to a privileged transaction.
- **Reads merge the tail.** `AnalyticsQueryService.series` reads the rollup rows below the watermark and aggregates the events recorded since,
  in one statement, so a pass committing in between can neither double count nor drop an event.
- **The writer never throws.** A failed insert is logged (`analytics event not recorded`) and counted; it runs in a savepoint so it cannot abort
  the caller's transaction. A nightly job repairs rollup drift for yesterday.
- **No personal data in events.** Ids and numbers only. `props` is checked by `assertNoPii`. The one link to a person, `contact_id`, is registered
  in the privacy registry (`analytics.events`) and removed on a contact erase; a workspace erase deletes all four tables.

## Access classes

| Class | Meaning                                                          | Reads from                                     |
| ----- | ---------------------------------------------------------------- | ---------------------------------------------- |
| F     | flow metric by small dimensions                                  | rollups plus tail                              |
| D     | unique count                                                     | per-day sets or sketches plus tail (Phase 1)   |
| S     | stock metric (total contacts, open pipeline, wallet balance)     | daily snapshot plus the live value (Phase 3)   |
| R     | high-cardinality drill-down (top conversations, recipient lists) | raw events in the hot window, then the archive |
| L     | sub-5-second counters (bell, inbox badges, wallet balance)       | unchanged live counters, not analytics         |

## Adding a metric

1. Add the event type to `ANALYTICS_EVENT` (append to the family range; ids are stored forever) and emit it with `AnalyticsEvents.record(tx, ...)` at the
   place the thing happens, inside the transaction.
2. Add a `METRIC` id and a `MetricDef` (what `d1..d3` mean, the window cap) in `packages/contracts/src/analytics/metrics.ts`.
3. Add a `RollupRule` in `rollup-rules.ts`. A latency metric sets `histOn`; its bucket index is `d3`.
4. Add the property test cases to `test/integration/analytics/rollup.spec.ts` (a rollup equals a direct count) and, if the metric has a new shape,
   a unit case in `rollup-sql.spec.ts`.
5. Backfill the metric from the existing tables, then run it in `shadow` (`ANALYTICS_SOURCES={"key":"shadow"}`) until the log shows no
   `analytics shadow diff` for the agreed days, then set it to `rollup`, then remove the legacy path.

## Configuration

| Variable                    | Default | Meaning                                                                         |
| --------------------------- | ------- | ------------------------------------------------------------------------------- |
| `ANALYTICS_EVENTS_ENABLED`  | `true`  | write events from the business transactions                                     |
| `ANALYTICS_EVENT_SAVEPOINT` | `true`  | run each event insert in a savepoint (the benchmark decides whether to keep it) |
| `ANALYTICS_ROLLUP_ENABLED`  | `true`  | the 30 second rollup pass                                                       |
| `ANALYTICS_SOURCES`         | `{}`    | JSON map of metric key to `legacy` / `shadow` / `rollup`                        |

Operations: [runbooks/analytics-rollups.md](../runbooks/analytics-rollups.md).
