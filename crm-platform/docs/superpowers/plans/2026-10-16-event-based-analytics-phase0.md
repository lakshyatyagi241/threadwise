# Event-based analytics: implementation plan

Spec: [`docs/superpowers/specs/2026-10-16-event-based-analytics-design.md`](../specs/2026-10-16-event-based-analytics-design.md). Read it first; this plan does not repeat the reasoning.

**Goal.** Build the event store, rollup engine, query layer, shadow harness and retention engine described in the spec, so that Phases 1 to 4 can move
each screen onto rollups and each log stream onto the archive without touching the foundation again.

**Architecture.** `an_events` (monthly partitions) is written in the business transaction. A worker folds new events into `an_rollup_hour` and
`an_rollup_day` by a `recorded_at` watermark. `AnalyticsQueryService` merges rollups with a live tail. A daily retention job archives old partitions to
object storage and drops them. Nothing user-visible changes in this plan: no screen, route or contract is touched.

**Stack.** PostgreSQL 16, NestJS 11 (`apps/api`), Drizzle (typed access only, SQL migrations are the source of truth), BullMQ not needed (the workers use
`@Interval` / `@Cron` like `OutboxDrainService`), Redis for the query cache, the existing hand-rolled S3 signer for archive objects, vitest with
testcontainers.

## How this plan is organised

| Part | Content                                                                            | Detail level                                                                     |
| ---- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| A    | Phase 0 foundation: events, rollups, query layer, shadow harness (tasks A1 to A11) | step by step, with code                                                          |
| B    | Retention engine and cost hygiene (tasks B1 to B8)                                 | step by step, key code                                                           |
| C    | Roadmap for Phases 1 to 4                                                          | outline; each phase gets its own plan in this format when the previous one exits |

Parts A and B are independent after A2 and can be done by two people. B7 (log rotation, Redis job options) needs nothing else and can ship first.

## Ground rules for every task

- Work in `crm-platform/`. Windows environment (from the memory notes): export `SWC_NATIVE_BINDING_CACHE="C:/Users/<you>/.cache/swc-native"` and
  `TURBO_ENV_MODE=loose` before vitest, eslint or turbo. Docker Desktop must be running for the integration specs.
- API specs import the **built** `@crm/db` and `@crm/contracts`. After changing either package run
  `pnpm --filter @crm/db --filter @crm/contracts build` before running `apps/api` specs.
- Run unit specs: `cd apps/api && node node_modules/vitest/vitest.mjs run --dir test/unit <pattern>`.
  Run integration specs: `cd apps/api && node node_modules/vitest/vitest.mjs run --dir test/integration --testTimeout=240000 --hookTimeout=300000 <pattern>`.
- Use the project skills the repo requires: `add-migration` (read its SKILL.md for the RLS shape), `outbox-event` for any new outbox event,
  `provider-adapter` for the storage adapters in B2, `security-review-gate` before calling anything done, `pre-pr` for the gate script.
- Never edit an applied migration. New migrations are named after the current latest (`20261216090000_drop_dormant_tables.sql` at the time of writing):
  use the next free timestamp.
- Nothing is committed or pushed unless the owner asks (repo rule). Each task ends with a **Checkpoint** step: run the named checks, and commit only
  when asked, with a Conventional Commit message (`feat(analytics): ...`).
- Known red checks on `main` that this work must not add to: `schema-invariants` rows for `waboo_migration_runs` and `flow_segment_state`, and the
  privacy registry row for `google_consent_requests`.

---

# Execution record (2026-10-16)

Part A (tasks A1 to A11) was built and verified in the worktree `event-based-analytics-arch-dd5729`, uncommitted. Parts B and C are not started.
What differs from the steps below, and why:

- **A5, platform rows are UTC.** `org_id = 0` rows bucket in UTC, not in each workspace's timezone; otherwise a platform "day" would mix different
  local days. Workspace rows keep their local timezone.
- **A5, the pass skips quiet stretches.** Each slice first finds the next recorded event and slices from there, so a catch-up after downtime never
  walks empty ten-minute windows. `RollupPass.slices` counts only slices that contained events.
- **A6, `gapReport` is deferred to Phase 1.** Nothing emits message events yet, so a comparison against `messages` could only report a total gap.
- **A9, extra policy entries were needed:** `tools/tenancy-audit/policy/privileged-allowlist.json` (the worker service is a reviewed `privileged()`
  call site), `table-classification.json` (`an_rollup_state`) and `global-unique.json` (`an_events_pkey`).
- **A9, privacy** is a new holder file `manifests/analytics.ts` registered in `registry/index.ts`; the erase deletes the three tables in
  `lifecycle.repository.ts` (the lifecycle spec's completeness check fails without it).
- **A4, counters:** `AnalyticsEvents.stats()` exists, but exporting it to the Prometheus registry waits for Phase 1 (the registry is internal to
  platform-infrastructure).
- **A10, the savepoint:** measured cost 2.3 ms on the laptop setup (one round trip 0.79 ms). The default stays on; re-measure on the real VM
  (spec decision D7). Storage is 170 bytes an event, not 130. See `docs/performance/analytics/phase0-bench.md`.
- **Tests that were red before this work** and still are: `schema-invariants` rows for `waboo_migration_runs` and `flow_segment_state`, the privacy
  registry row for `google_consent_requests`, four rows of `boundaries.matrix.spec.ts` (other modules' outbox consumers), and the storage-purge
  retry test in `org-lifecycle.spec.ts`.

# Part A: Phase 0 foundation

## File map

| File                                                                                            | Responsibility                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/contracts/src/analytics/events.ts` (new)                                              | event type ids, dimension enums, `AnalyticsEventInput`, PII guard  |
| `packages/contracts/src/analytics/histogram.ts` (new)                                           | latency bucket edges, `histBucket`, `percentileFromBuckets`        |
| `packages/contracts/src/analytics/metrics.ts` (new)                                             | `METRIC` ids and `MetricDef` registry (public meaning of `d1..d3`) |
| `packages/db/migrations/20261217090000_analytics_events.sql` (new)                              | `an_events`, `an_rollup_hour`, `an_rollup_day`, `an_rollup_state`  |
| `packages/db/src/schema/analytics/tables.ts` (new)                                              | Drizzle mirror of those tables                                     |
| `apps/api/src/kernel/analytics/analytics-events.service.ts` (new)                               | `AnalyticsEvents.record / recordMany`                              |
| `apps/api/src/modules/analytics/rollup/rollup-rules.ts` (new)                                   | which events feed which metric, with which dimensions              |
| `apps/api/src/modules/analytics/rollup/rollup-sql.ts` (new)                                     | pure SQL builders shared by the worker and the query tail          |
| `apps/api/src/modules/analytics/rollup/rollup.service.ts` (new)                                 | one rollup pass, nightly reconcile, hour-row trim                  |
| `apps/api/src/modules/analytics/rollup/rollup.worker.ts` (new)                                  | `@Interval` and `@Cron` drivers                                    |
| `apps/api/src/modules/analytics/query/analytics-query.service.ts` (new)                         | `series()` with live tail, Redis cache                             |
| `apps/api/src/modules/analytics/shadow/metric-source.ts` (new)                                  | `legacy                                                            | shadow | rollup` switch and diff logging |
| `apps/api/src/modules/analytics/{analytics.module,analytics-worker.module,index}.ts` (new)      | module wiring and public surface                                   |
| `apps/api/test/unit/analytics/*.spec.ts`, `apps/api/test/integration/analytics/*.spec.ts` (new) | tests                                                              |

---

## Task A1: Contracts: event ids, dimensions, histogram, metric registry

**Files:** create the three `packages/contracts/src/analytics/*.ts` files and an `index.ts`; modify `packages/contracts/src/index.ts`; test in
`apps/api/test/unit/analytics/contracts.spec.ts`.

- [ ] **Step 1: Write the failing test** `apps/api/test/unit/analytics/contracts.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_EVENT,
  LATENCY_EDGES_MS,
  METRIC,
  METRICS,
  assertNoPii,
  histBucket,
  percentileFromBuckets,
} from '@crm/contracts';

describe('analytics event registry', () => {
  it('has unique positive ids that fit a smallint', () => {
    const ids = Object.values(ANALYTICS_EVENT);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toBeGreaterThan(0);
      expect(id).toBeLessThan(32768);
    }
  });

  it('pins ids that are stored forever (never renumber)', () => {
    expect(ANALYTICS_EVENT.MSG_QUEUED).toBe(1);
    expect(ANALYTICS_EVENT.MSG_RECEIVED).toBe(6);
    expect(ANALYTICS_EVENT.CONV_FIRST_REPLY).toBe(42);
    expect(ANALYTICS_EVENT.BILL_CHARGE).toBe(110);
  });
});

describe('metric registry', () => {
  it('has unique ids and keys, at most three dimensions each', () => {
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
    expect(new Set(METRICS.map((m) => m.key)).size).toBe(METRICS.length);
    for (const m of METRICS) expect(m.dims.length).toBeLessThanOrEqual(3);
    expect(METRICS.map((m) => m.id)).toContain(METRIC.MSG_COUNT);
  });
});

describe('latency histogram', () => {
  it('puts a value in the bucket of the first edge above it', () => {
    expect(histBucket(0)).toBe(0);
    expect(histBucket(999)).toBe(0);
    expect(histBucket(1000)).toBe(1);
    expect(histBucket(LATENCY_EDGES_MS[LATENCY_EDGES_MS.length - 1]!)).toBe(
      LATENCY_EDGES_MS.length,
    );
  });

  it('returns the upper edge of the bucket that holds the percentile', () => {
    const counts = new Array<number>(LATENCY_EDGES_MS.length + 1).fill(0);
    counts[1] = 50;
    counts[3] = 50;
    expect(percentileFromBuckets(counts, 0.5)).toBe(LATENCY_EDGES_MS[1]);
    expect(percentileFromBuckets(counts, 0.51)).toBe(LATENCY_EDGES_MS[3]);
    expect(percentileFromBuckets(new Array(LATENCY_EDGES_MS.length + 1).fill(0), 0.5)).toBeNull();
  });
});

describe('PII guard for props', () => {
  it('accepts plain codes and counters', () => {
    expect(() => assertNoPii({ reason: 'timeout', attempt: 3, retried: true })).not.toThrow();
    expect(() => assertNoPii(undefined)).not.toThrow();
  });
  it('rejects personal-looking keys and values', () => {
    expect(() => assertNoPii({ phone: '1' })).toThrow(/personal data/);
    expect(() => assertNoPii({ note: 'a@b.co' })).toThrow(/personal data/);
    expect(() => assertNoPii({ note: '+919876543210' })).toThrow(/personal data/);
    expect(() => assertNoPii({ note: 'x'.repeat(65) })).toThrow(/personal data/);
  });
});
```

- [ ] **Step 2: Run it, expect failure** (`@crm/contracts` has no `ANALYTICS_EVENT`):
      `pnpm --filter @crm/contracts build` then the unit command with pattern `analytics/contracts`.

- [ ] **Step 3: Implement** `packages/contracts/src/analytics/events.ts`:

```ts
/**
 * Analytics event types. These numbers are STORED (smallint in an_events): never renumber, never reuse. Add new types at the end of a
 * family's range. Families: messages 1-19, clicks and views 20-39, conversations 40-59, automation 60-79, calls 80-89, AI and usage 90-109,
 * billing 110-129, CRM and revenue 130-169, platform 170-199.
 */
export const ANALYTICS_EVENT = {
  MSG_QUEUED: 1,
  MSG_SENT: 2,
  MSG_DELIVERED: 3,
  MSG_READ: 4,
  MSG_FAILED: 5,
  MSG_RECEIVED: 6,
  CLICK_TRACKED: 20,
  CHATLINK_CLICK: 21,
  STOREFRONT_VIEW: 22,
  FORM_VIEW: 23,
  FORM_START: 24,
  FORM_SUBMIT: 25,
  FORM_COMPLETE: 26,
  CMP_OPTOUT: 27,
  CONV_OPENED: 40,
  CONV_ASSIGNED: 41,
  CONV_FIRST_REPLY: 42,
  CONV_RESOLVED: 43,
  CONV_CSAT: 44,
  CONV_SLA_BREACHED: 45,
  FLOW_RUN_STARTED: 60,
  FLOW_RUN_COMPLETED: 61,
  FLOW_RUN_FAILED: 62,
  FAQ_MATCH: 63,
  CALL_ENDED: 80,
  AI_TOKENS: 90,
  TRANSLATION_CALL: 91,
  LEADSCORE_RUN: 92,
  BILL_CHARGE: 110,
  BILL_REFUND: 111,
  WALLET_TOPUP: 112,
  CONTACT_CREATED: 130,
  CONTACT_IMPORTED: 131,
  DEAL_CREATED: 132,
  DEAL_WON: 133,
  DEAL_LOST: 134,
  TASK_COMPLETED: 135,
  INVOICE_ISSUED: 136,
  INVOICE_PAID: 137,
  APPOINTMENT_BOOKED: 138,
  ORG_SIGNUP: 170,
  PLAN_CHANGED: 171,
  ORDER_PAID: 172,
  SUPPORT_TICKET_OPENED: 173,
  SUPPORT_TICKET_RESOLVED: 174,
  SUPPORT_FIRST_RESPONSE: 175,
  REFERRAL_SIGNUP: 176,
} as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT)[keyof typeof ANALYTICS_EVENT];

/** Small-integer codes for the low-cardinality dimension columns. Also stored: append only. */
export const CHANNEL_KIND = {
  whatsapp_cloud: 1,
  whatsapp_baileys: 2,
  twilio: 3,
  email: 4,
  sms: 5,
  facebook: 6,
  instagram: 7,
  telegram: 8,
  line: 9,
  viber: 10,
  wechat: 11,
  widget: 12,
  tiktok: 13,
  other: 99,
} as const;
export const DIRECTION = { in: 1, out: 2 } as const;
export const SOURCE_KIND = {
  inbox: 1,
  campaign: 2,
  broadcast: 3,
  scheduled: 4,
  flow: 5,
  api: 6,
  system: 7,
} as const;

export type AnalyticsProps = Record<string, string | number | boolean | null>;

/** What a call site passes to `AnalyticsEvents.record`. Ids are internal bigint ids as numbers, like everywhere in the API layer. */
export interface AnalyticsEventInput {
  type: AnalyticsEventType;
  /** Defaults to the request's organization. */
  orgId?: number;
  /** Business time (for example the provider's delivered time). Defaults to now. */
  occurredAt?: Date;
  channelKind?: number;
  direction?: number;
  status?: number;
  sourceKind?: number;
  k1?: number;
  k2?: number;
  channelId?: number;
  contactId?: number;
  conversationId?: number;
  campaignId?: number;
  flowId?: number;
  agentId?: number;
  templateId?: number;
  deviceId?: number;
  qty?: number;
  amountMinor?: number;
  durationMs?: number;
  tokens?: number;
  /** Rare overflow. No message text, phone, email or free text: `assertNoPii` rejects it. */
  props?: AnalyticsProps;
}

const PII_KEY = /(phone|mobile|email|name|body|text|message|address|token|secret|password|url)/i;
const IP_KEY = /(^|_)ip($|_)/i;
const PII_VALUE = [/@/, /^\+?\d[\d\s().-]{6,}$/];

export function assertNoPii(props: AnalyticsProps | undefined): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (PII_KEY.test(key) || IP_KEY.test(key)) {
      throw new Error(`analytics props key "${key}" looks like personal data`);
    }
    if (
      typeof value === 'string' &&
      (value.length > 64 || PII_VALUE.some((re) => re.test(value)))
    ) {
      throw new Error(`analytics props value for "${key}" looks like personal data`);
    }
  }
}
```

`packages/contracts/src/analytics/histogram.ts`:

```ts
/** Upper edges (ms) of the latency buckets. Bucket i holds [edges[i-1], edges[i]); the last bucket is open ended. 15 buckets. */
export const LATENCY_EDGES_MS = [
  1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000, 7_200_000,
  21_600_000, 43_200_000, 86_400_000,
] as const;

export function histBucket(valueMs: number, edges: readonly number[] = LATENCY_EDGES_MS): number {
  let i = 0;
  while (i < edges.length && valueMs >= edges[i]!) i += 1;
  return i;
}

/** The upper edge of the bucket holding the p-th item (0 < p <= 1), or null for an empty histogram. The open last bucket reports its lower edge. */
export function percentileFromBuckets(
  counts: readonly number[],
  p: number,
  edges: readonly number[] = LATENCY_EDGES_MS,
): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil(p * total));
  let seen = 0;
  for (let i = 0; i < counts.length; i += 1) {
    seen += counts[i]!;
    if (seen >= rank) return i < edges.length ? edges[i]! : edges[edges.length - 1]!;
  }
  return edges[edges.length - 1]!;
}
```

`packages/contracts/src/analytics/metrics.ts`:

```ts
/** Metric ids are stored (smallint in the rollup tables): never renumber. Phase 0 registers three metrics that prove the three rollup shapes. */
export const METRIC = {
  MSG_COUNT: 1,
  MSG_BY_CAMPAIGN: 2,
  CONV_FIRST_REPLY_HIST: 3,
} as const;
export type MetricId = (typeof METRIC)[keyof typeof METRIC];

export interface MetricDef {
  id: MetricId;
  key: string;
  description: string;
  /** What d1, d2, d3 mean for this metric, in order. A histogram metric uses d3 as the bucket index. */
  dims: readonly string[];
  /** Largest window a caller may ask for, in days. */
  windowDaysMax: number;
}

export const METRICS: readonly MetricDef[] = [
  {
    id: METRIC.MSG_COUNT,
    key: 'msg_count',
    description: 'Message transitions by event type, channel kind and source kind',
    dims: ['event_type', 'channel_kind', 'source_kind'],
    windowDaysMax: 366,
  },
  {
    id: METRIC.MSG_BY_CAMPAIGN,
    key: 'msg_by_campaign',
    description: 'Message transitions of campaign and broadcast sends, by campaign',
    dims: ['campaign_id', 'event_type'],
    windowDaysMax: 366,
  },
  {
    id: METRIC.CONV_FIRST_REPLY_HIST,
    key: 'conv_first_reply_hist',
    description: 'First reply time of conversations, by agent, as a latency histogram',
    dims: ['agent_id', '', 'bucket'],
    windowDaysMax: 366,
  },
];
```

`packages/contracts/src/analytics/index.ts` re-exports the three; add `export * from './analytics';` to `packages/contracts/src/index.ts` next to the other
folder exports.

- [ ] **Step 4: Build and run:** `pnpm --filter @crm/contracts build`, then the unit command for `analytics/contracts`. Expect all pass.
- [ ] **Step 5: Checkpoint.** `eslint` and `prettier --end-of-line auto --check` on the new files; commit when asked: `feat(analytics): event, metric and histogram contracts`.

---

## Task A2: Migration: `an_events`, rollups, watermark

**Files:** create `packages/db/migrations/20261217090000_analytics_events.sql`; test `apps/api/test/integration/analytics/analytics-schema.spec.ts`.
Read the `add-migration` skill first. Pattern source: `0006_outbox_audit.sql` (stream) and `20261001100900_aiadm_threadwise_schema.sql` (`ai_token_usage`, a tenant stream).

- [ ] **Step 1: Write the failing test.** Copy the container/role/migration bootstrap from `apps/api/test/integration/team-chat/team-chat-schema.spec.ts` (create `crm_app_user`, run `runMigrations` from `packages/db/migrations`, open an `owner` client and an `app` client as `crm_app_user`). Helpers: `asOrg(orgId, fn)` runs `BEGIN; SELECT set_config('app.org_id', $1, true); fn(); ROLLBACK` on the `app` client; `asPrivileged(fn)` does the same with `set_config('app.privileged','on',true)`. Assertions:
  1. `an_events` is a range-partitioned table with a `an_events_default` partition and at least four monthly partitions starting last month.
  2. `an_events`, `an_rollup_hour`, `an_rollup_day` have RLS enabled **and forced**, and every partition of `an_events` has its own policy (the same query the `schema-invariants` spec uses).
  3. As the app role in org A: inserting an `an_events` row for org A succeeds and for org B is refused (`42501`); reading shows only org A rows; no tenant context sees none; privileged sees all.
  4. A rollup row with `org_id = 0` is invisible to a tenant and visible when privileged.
  5. `an_rollup_state` has one row named `main`, readable by the app role, and an `UPDATE` by the app role is refused.
  6. `an_events` has no foreign keys, and its primary key is `(id, recorded_at)`.

- [ ] **Step 2: Run, expect failure** (tables do not exist).

- [ ] **Step 3: Write the migration** (comment the why, per the runbook):

```sql
-- 20261217090000_analytics_events
-- The event store and rollup tables behind event-based analytics (docs/superpowers/specs/2026-10-16-event-based-analytics-design.md).
-- an_events is an append-only stream written in the business transaction; the rollup worker folds it into an_rollup_hour and an_rollup_day by a
-- recorded_at watermark kept in an_rollup_state. No foreign keys, so the an_* set can move to another Postgres later.

CREATE SEQUENCE an_events_id_seq;

CREATE TABLE an_events (
  id              bigint      NOT NULL DEFAULT nextval('an_events_id_seq'),
  org_id          bigint      NOT NULL,
  type            smallint    NOT NULL,
  recorded_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  occurred_at     timestamptz NOT NULL,
  channel_kind    smallint,
  direction       smallint,
  status          smallint,
  source_kind     smallint,
  k1              smallint,
  k2              smallint,
  channel_id      bigint,
  contact_id      bigint,
  conversation_id bigint,
  campaign_id     bigint,
  flow_id         bigint,
  agent_id        bigint,
  template_id     bigint,
  device_id       bigint,
  qty             integer     NOT NULL DEFAULT 1,
  amount_minor    bigint,
  duration_ms     integer,
  tokens          integer,
  props           jsonb,
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Rollup scans read a recorded_at window of the newest partition: a tiny BRIN does it. Drill-down reads one org over an occurred_at range.
CREATE INDEX idx_an_events_recorded_brin ON an_events USING brin (recorded_at) WITH (pages_per_range = 32);
CREATE INDEX idx_an_events_org_occurred  ON an_events (org_id, occurred_at);

ALTER TABLE an_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE an_events FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON an_events FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());

DO $$
DECLARE
  m date;
BEGIN
  FOR m IN
    SELECT generate_series(date_trunc('month', now() - interval '1 month'),
      date_trunc('month', now() + interval '2 months'), interval '1 month')::date
  LOOP
    PERFORM ensure_monthly_partition('an_events', m);
  END LOOP;
END $$;
CREATE TABLE an_events_default PARTITION OF an_events DEFAULT;
SELECT inherit_partition_rls('an_events_default');

-- Rollups. d1..d3 hold the metric's dimensions (0 when unused); a histogram metric uses d3 as the bucket index. org_id = 0 holds platform-wide
-- rows, visible only to a privileged transaction because current_org_id() is never 0. No FK to organizations: 0 is not an organization.
CREATE TABLE an_rollup_hour (
  org_id bigint      NOT NULL,
  metric smallint    NOT NULL,
  bucket timestamptz NOT NULL,
  d1     bigint      NOT NULL DEFAULT 0,
  d2     bigint      NOT NULL DEFAULT 0,
  d3     bigint      NOT NULL DEFAULT 0,
  n      bigint      NOT NULL DEFAULT 0,
  s1     bigint      NOT NULL DEFAULT 0,
  s2     bigint      NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, metric, bucket, d1, d2, d3)
);
CREATE TABLE an_rollup_day (
  org_id bigint   NOT NULL,
  metric smallint NOT NULL,
  bucket date     NOT NULL,
  d1     bigint   NOT NULL DEFAULT 0,
  d2     bigint   NOT NULL DEFAULT 0,
  d3     bigint   NOT NULL DEFAULT 0,
  n      bigint   NOT NULL DEFAULT 0,
  s1     bigint   NOT NULL DEFAULT 0,
  s2     bigint   NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, metric, bucket, d1, d2, d3)
);

ALTER TABLE an_rollup_hour ENABLE ROW LEVEL SECURITY;
ALTER TABLE an_rollup_hour FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON an_rollup_hour FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());
ALTER TABLE an_rollup_day ENABLE ROW LEVEL SECURITY;
ALTER TABLE an_rollup_day FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON an_rollup_day FOR ALL
  USING      (org_id = current_org_id() OR app_is_privileged())
  WITH CHECK (org_id = current_org_id() OR app_is_privileged());

-- The watermark: every event with recorded_at below it is already in the rollups. Every tenant reads it (the live tail starts there); only
-- the worker writes it.
CREATE TABLE an_rollup_state (
  name            text        PRIMARY KEY,
  recorded_before timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE an_rollup_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE an_rollup_state FORCE  ROW LEVEL SECURITY;
CREATE POLICY read_all ON an_rollup_state FOR SELECT USING (true);
CREATE POLICY operator_write ON an_rollup_state FOR ALL
  USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- Seeded privileged, like every other write to this table, so a non-superuser migration role is not blocked by the policy above.
SELECT set_config('app.privileged', 'on', true);
INSERT INTO an_rollup_state (name, recorded_before) VALUES ('main', now());
SELECT set_config('app.privileged', 'off', true);
```

- [ ] **Step 4: Run the test, expect pass.** Then run `schema-invariants` and fix what it names. Expected adjustments, each in the same change:
  - `tools/tenancy-audit/policy/table-classification.json`: add `"an_rollup_state": { "class": "GLOBAL", "reason": "rollup watermark: read by every tenant for the live tail, written by the worker only", "reviewed": "2026-10-16" }` (copy the shape of the `packages` entry that was removed earlier, from git history, if needed).
  - `tools/tenancy-audit/policy/global-unique.json`: add `an_events_pkey` with the same category and reason as the existing `audit_log_pkey` entry (partitioned primary key without `org_id`).
- [ ] **Step 5: Checkpoint.** `bash .claude/skills/add-migration/scripts/check-rls.sh an_events,an_rollup_hour,an_rollup_day,an_rollup_state` against a migrated scratch DB. Commit when asked: `feat(db): analytics event store and rollup tables`.

---

## Task A3: Drizzle schema

**Files:** create `packages/db/src/schema/analytics/tables.ts`; modify `packages/db/src/schema/index.ts` (add `export * from './analytics/tables';` beside `export * from './ops';`).

- [ ] **Step 1: Write the tables**, matching the migration exactly (pattern: `ops.ts`):

```ts
import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { idColumn, orgIdColumn } from '../columns';

/** Append-only event stream, monthly partitions by recorded_at. See docs/superpowers/specs/2026-10-16-event-based-analytics-design.md. */
export const anEvents = pgTable(
  'an_events',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('an_events_id_seq')`),
    orgId: orgIdColumn(),
    type: smallint('type').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    channelKind: smallint('channel_kind'),
    direction: smallint('direction'),
    status: smallint('status'),
    sourceKind: smallint('source_kind'),
    k1: smallint('k1'),
    k2: smallint('k2'),
    channelId: idColumn('channel_id'),
    contactId: idColumn('contact_id'),
    conversationId: idColumn('conversation_id'),
    campaignId: idColumn('campaign_id'),
    flowId: idColumn('flow_id'),
    agentId: idColumn('agent_id'),
    templateId: idColumn('template_id'),
    deviceId: idColumn('device_id'),
    qty: integer('qty').notNull().default(1),
    amountMinor: idColumn('amount_minor'),
    durationMs: integer('duration_ms'),
    tokens: integer('tokens'),
    props: jsonb('props').$type<Record<string, string | number | boolean | null>>(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.recordedAt] }),
    index('idx_an_events_recorded_brin').using('brin', t.recordedAt),
    index('idx_an_events_org_occurred').on(t.orgId, t.occurredAt),
  ],
);

const rollupColumns = {
  orgId: orgIdColumn(),
  metric: smallint('metric').notNull(),
  d1: idColumn('d1').notNull().default(0),
  d2: idColumn('d2').notNull().default(0),
  d3: idColumn('d3').notNull().default(0),
  n: idColumn('n').notNull().default(0),
  s1: idColumn('s1').notNull().default(0),
  s2: idColumn('s2').notNull().default(0),
};

export const anRollupHour = pgTable(
  'an_rollup_hour',
  { ...rollupColumns, bucket: timestamp('bucket', { withTimezone: true }).notNull() },
  (t) => [primaryKey({ columns: [t.orgId, t.metric, t.bucket, t.d1, t.d2, t.d3] })],
);

export const anRollupDay = pgTable(
  'an_rollup_day',
  { ...rollupColumns, bucket: date('bucket').notNull() },
  (t) => [primaryKey({ columns: [t.orgId, t.metric, t.bucket, t.d1, t.d2, t.d3] })],
);

export const anRollupState = pgTable('an_rollup_state', {
  name: text('name').primaryKey(),
  recordedBefore: timestamp('recorded_before', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AnEventRow = typeof anEvents.$inferSelect;
export type NewAnEventRow = typeof anEvents.$inferInsert;
```

- [ ] **Step 2: Verify against a migrated DB:** build (`pnpm --filter @crm/db build`), start a throwaway Postgres as in the earlier verification (pgvector image with `docker/postgres/init` mounted, port 55432), apply migrations with the runner, then
      `MIGRATION_DATABASE_URL=postgres://crm:crm@localhost:55432/crm node node_modules/tsx/dist/cli.mjs src/cli/verify-schema.ts` from `packages/db`. Expect `0 error(s)`. If it
      reports a default or type mismatch, adjust the Drizzle declaration (the SQL is the source of truth).
- [ ] **Step 3: Run `schema-invariants`**, whose "Drizzle schema describes what the migrations built" check must pass.
- [ ] **Step 4: Checkpoint.** eslint on `packages/db/src`; commit when asked: `feat(db): drizzle mirror of the analytics tables`.

---

## Task A4: Kernel writer `AnalyticsEvents`

**Files:** create `apps/api/src/kernel/analytics/analytics-events.service.ts`; modify `apps/api/src/kernel/kernel.module.ts`, `apps/api/src/config/env.schema.ts`, `.env.example`;
tests `apps/api/test/unit/analytics/events-row.spec.ts`, `apps/api/test/integration/analytics/events-writer.spec.ts`.
The kernel may not import from `modules/` (dependency-cruiser): the writer depends only on `@crm/db`, `@crm/contracts` and `common/`.

- [ ] **Step 1: Env flags.** In `env.schema.ts`, next to `ORG_LIFECYCLE_ENABLED`, add `ANALYTICS_EVENTS_ENABLED: booleanish.default(true)`,
      `ANALYTICS_EVENT_SAVEPOINT: booleanish.default(true)` (benchmark in A10 decides the default), `ANALYTICS_ROLLUP_ENABLED: booleanish.default(true)`,
      `ANALYTICS_SOURCES: z.string().default('{}')`. Add commented examples to `.env.example`.
- [ ] **Step 2: Failing unit test** for the pure row mapper `toEventRow(input, defaultOrgId, now)` (exported from the service file): fills `qty = 1`, `occurredAt = now`, uses
      `input.orgId ?? defaultOrgId`, throws on a non-integer id, throws on PII props, and rounds nothing silently.
- [ ] **Step 3: Failing integration test** `events-writer.spec.ts` (container + migrations, a `DatabaseService`-free harness: `createDbClient` and `withTenant` from `@crm/db`):
  1. `record` inside `withTenant` stores one row with the right org, type, dimensions and `qty = 1`; the row is visible in that tenant and not in another.
  2. `recordMany` of 3 inputs inserts 3 rows in one statement.
  3. With the savepoint on, a failing insert (`type: 40000` overflows smallint) returns `false`, `stats().failures === 1`, and **the surrounding transaction still works** (a following `SELECT 1` and a business insert in the same `withTenant` callback commit).
  4. With the flag `enabled: false` it inserts nothing and returns `true`.
- [ ] **Step 4: Implement** the service:

```ts
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { assertNoPii, type AnalyticsEventInput } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import type { Env } from '../../config/env.schema';

const INT_FIELDS = [
  'channelKind',
  'direction',
  'status',
  'sourceKind',
  'k1',
  'k2',
  'channelId',
  'contactId',
  'conversationId',
  'campaignId',
  'flowId',
  'agentId',
  'templateId',
  'deviceId',
  'qty',
  'amountMinor',
  'durationMs',
  'tokens',
] as const;

export interface EventRow extends Required<
  Pick<AnalyticsEventInput, 'type' | 'orgId' | 'occurredAt'>
> {
  qty: number;
  [k: string]: unknown;
}

export function toEventRow(input: AnalyticsEventInput, defaultOrgId: number, now: Date): EventRow {
  const row: Record<string, unknown> = {
    type: input.type,
    orgId: input.orgId ?? defaultOrgId,
    occurredAt: input.occurredAt ?? now,
    qty: input.qty ?? 1,
  };
  for (const f of INT_FIELDS) {
    const v = input[f];
    if (v === undefined || v === null) continue;
    if (!Number.isSafeInteger(v))
      throw new Error(`analytics field ${f} must be an integer, got ${String(v)}`);
    row[f] = v;
  }
  assertNoPii(input.props);
  row.props = input.props ?? null;
  return row as EventRow;
}

@Injectable()
export class AnalyticsEvents {
  private readonly logger = new Logger(AnalyticsEvents.name);
  private recorded = 0;
  private failures = 0;
  private readonly enabled: boolean;
  private readonly useSavepoint: boolean;

  constructor(@Optional() config?: ConfigService<Env, true>) {
    this.enabled = config?.get('ANALYTICS_EVENTS_ENABLED', { infer: true }) ?? true;
    this.useSavepoint = config?.get('ANALYTICS_EVENT_SAVEPOINT', { infer: true }) ?? true;
  }

  stats(): { recorded: number; failures: number } {
    return { recorded: this.recorded, failures: this.failures };
  }

  record(tx: Tx, input: AnalyticsEventInput): Promise<boolean> {
    return this.recordMany(tx, [input]);
  }

  /**
   * Never throws: analytics must not break the business write it rides on. A failure is logged and counted; the nightly gap check
   * (RollupService.reconcile) is what notices missing events. The insert runs in a savepoint because a failed statement would otherwise
   * abort the caller's whole transaction.
   */
  async recordMany(tx: Tx, inputs: AnalyticsEventInput[]): Promise<boolean> {
    if (!this.enabled || inputs.length === 0) return true;
    try {
      const orgId = RequestContextStore.peek()?.orgId ?? 0;
      const now = new Date();
      const rows = inputs.map((i) => toEventRow(i, orgId, now));
      if (rows.some((r) => !r.orgId)) throw new Error('analytics event has no organization');
      if (this.useSavepoint) await tx.transaction((sp) => this.insert(sp as unknown as Tx, rows));
      else await this.insert(tx, rows);
      this.recorded += rows.length;
      return true;
    } catch (err) {
      this.failures += 1;
      this.logger.warn({ err, types: inputs.map((i) => i.type) }, 'analytics event not recorded');
      return false;
    }
  }

  private async insert(tx: Tx, rows: EventRow[]): Promise<void> {
    const values = rows.map(
      (
        r,
      ) => sql`(${r.orgId}, ${r.type}, ${r.occurredAt.toISOString()}::timestamptz, ${r.channelKind ?? null}, ${r.direction ?? null},
        ${r.status ?? null}, ${r.sourceKind ?? null}, ${r.k1 ?? null}, ${r.k2 ?? null}, ${r.channelId ?? null}, ${r.contactId ?? null},
        ${r.conversationId ?? null}, ${r.campaignId ?? null}, ${r.flowId ?? null}, ${r.agentId ?? null}, ${r.templateId ?? null},
        ${r.deviceId ?? null}, ${r.qty}, ${r.amountMinor ?? null}, ${r.durationMs ?? null}, ${r.tokens ?? null},
        ${r.props === null ? null : JSON.stringify(r.props)}::jsonb)`,
    );
    await tx.execute(sql`
      INSERT INTO an_events (org_id, type, occurred_at, channel_kind, direction, status, source_kind, k1, k2, channel_id, contact_id,
        conversation_id, campaign_id, flow_id, agent_id, template_id, device_id, qty, amount_minor, duration_ms, tokens, props)
      VALUES ${sql.join(values, sql`, `)}`);
  }
}
```

`RequestContextStore.peek()` returns the context or `undefined` (as `OutboxService.emit` uses it); a background job with no context must pass `orgId` explicitly, and the
row check above turns a missing organization into a logged failure instead of an insert with org 0.
Add `AnalyticsEvents` to `providers` and `exports` of `KernelModule`.

- [ ] **Step 5: Run unit and integration specs, expect pass.** Typecheck `apps/api` (`node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`).
- [ ] **Step 6: Checkpoint.** eslint and prettier; commit when asked: `feat(analytics): kernel event writer`.

---

## Task A5: Rollup rules, SQL builders, `RollupService`

**Files:** create `apps/api/src/modules/analytics/rollup/{rollup-rules,rollup-sql,rollup.service}.ts`; tests `apps/api/test/unit/analytics/rollup-sql.spec.ts`,
`apps/api/test/integration/analytics/rollup.spec.ts`.

- [ ] **Step 1: Rules.** `rollup-rules.ts`:

```ts
import { ANALYTICS_EVENT as E, METRIC, type MetricId } from '@crm/contracts';

export type DimCol =
  | 'type'
  | 'channel_kind'
  | 'direction'
  | 'status'
  | 'source_kind'
  | 'k1'
  | 'k2'
  | 'channel_id'
  | 'contact_id'
  | 'conversation_id'
  | 'campaign_id'
  | 'flow_id'
  | 'agent_id'
  | 'template_id'
  | 'device_id';
export type MeasureCol = 'amount_minor' | 'duration_ms' | 'tokens';

export interface RollupRule {
  metric: MetricId;
  types: readonly number[];
  /** Event columns that feed d1, d2, d3 (null leaves the dimension 0). All values come from code, never from a caller. */
  dims: readonly [DimCol | null, DimCol | null, DimCol | null];
  n: 'count' | 'qty';
  s1?: MeasureCol;
  s2?: MeasureCol;
  /** Histogram metric: d3 becomes the latency bucket index of this column (dims[2] must be null). */
  histOn?: 'duration_ms';
  /** Extra constant predicate, for example 'e.campaign_id IS NOT NULL'. */
  where?: string;
  /** Also write org_id = 0 platform rows. */
  platform?: boolean;
}

const MSG = [E.MSG_QUEUED, E.MSG_SENT, E.MSG_DELIVERED, E.MSG_READ, E.MSG_FAILED, E.MSG_RECEIVED];

export const ROLLUP_RULES: readonly RollupRule[] = [
  {
    metric: METRIC.MSG_COUNT,
    types: MSG,
    dims: ['type', 'channel_kind', 'source_kind'],
    n: 'count',
    platform: true,
  },
  {
    metric: METRIC.MSG_BY_CAMPAIGN,
    types: MSG,
    dims: ['campaign_id', 'type', null],
    n: 'count',
    where: 'e.campaign_id IS NOT NULL',
  },
  {
    metric: METRIC.CONV_FIRST_REPLY_HIST,
    types: [E.CONV_FIRST_REPLY],
    dims: ['agent_id', null, null],
    n: 'count',
    s1: 'duration_ms',
    histOn: 'duration_ms',
  },
];
```

- [ ] **Step 2: SQL builders** `rollup-sql.ts`. All fragments built from `ROLLUP_RULES` constants through `sql.raw` after an integer or allowlist check, and a window passed as a drizzle `sql` value:

```ts
import { sql, type SQL } from 'drizzle-orm';
import { LATENCY_EDGES_MS } from '@crm/contracts';
import type { RollupRule } from './rollup-rules';

export type Grain = 'hour' | 'day';
export type Scope = 'org' | 'platform';

const TZ = sql`coalesce(ws.timezone, 'UTC')`;
const int = (n: number): SQL => {
  if (!Number.isInteger(n)) throw new Error(`not an integer: ${n}`);
  return sql.raw(String(n));
};

export function bucketExpr(grain: Grain): SQL {
  return grain === 'hour'
    ? sql`(date_trunc('hour', e.occurred_at AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ})`
    : sql`(date_trunc('day', e.occurred_at AT TIME ZONE ${TZ}))::date`;
}

function histCase(col: 'duration_ms'): SQL {
  const whens = LATENCY_EDGES_MS.map((edge, i) => `WHEN e.${col} < ${edge} THEN ${i}`).join(' ');
  return sql.raw(
    `(CASE WHEN e.${col} IS NULL THEN 0 ${whens} ELSE ${LATENCY_EDGES_MS.length} END)::bigint`,
  );
}

function dimExpr(rule: RollupRule, i: 0 | 1 | 2): SQL {
  if (rule.histOn && i === 2) return histCase(rule.histOn);
  const col = rule.dims[i];
  return col ? sql`coalesce(e.${sql.raw(col)}, 0)::bigint` : sql`0::bigint`;
}

const sum = (col?: string): SQL =>
  col ? sql`coalesce(sum(e.${sql.raw(col)}), 0)::bigint` : sql`0::bigint`;

/** The grouped aggregate for one rule over one window. Shared by the worker (INSERT ... SELECT) and the query tail. */
export function rollupSelect(rule: RollupRule, grain: Grain, scope: Scope, window: SQL): SQL {
  const org = scope === 'org' ? sql`e.org_id` : sql`0::bigint`;
  const types = sql.join(
    rule.types.map((t) => int(t)),
    sql`, `,
  );
  const extra = rule.where ? sql` AND ${sql.raw(rule.where)}` : sql``;
  return sql`
    SELECT ${org} AS org_id, ${int(rule.metric)}::smallint AS metric, ${bucketExpr(grain)} AS bucket,
           ${dimExpr(rule, 0)} AS d1, ${dimExpr(rule, 1)} AS d2, ${dimExpr(rule, 2)} AS d3,
           ${rule.n === 'qty' ? sql`coalesce(sum(e.qty), 0)` : sql`count(*)`}::bigint AS n,
           ${sum(rule.s1)} AS s1, ${sum(rule.s2)} AS s2
      FROM an_events e
      LEFT JOIN workspace_settings ws ON ws.org_id = e.org_id
     WHERE e.type IN (${types})${extra} AND ${window}
     GROUP BY 1, 2, 3, 4, 5, 6`;
}

export function recordedWindow(from: Date, to: Date): SQL {
  return sql`e.recorded_at >= ${from.toISOString()}::timestamptz AND e.recorded_at < ${to.toISOString()}::timestamptz`;
}

/** Adds the slice to the rollup table; replaying the same slice twice is prevented by the watermark, not by this statement. */
export function rollupUpsert(rule: RollupRule, grain: Grain, scope: Scope, window: SQL): SQL {
  const table = sql.raw(grain === 'hour' ? 'an_rollup_hour' : 'an_rollup_day');
  return sql`
    INSERT INTO ${table} (org_id, metric, bucket, d1, d2, d3, n, s1, s2)
    ${rollupSelect(rule, grain, scope, window)}
    ON CONFLICT (org_id, metric, bucket, d1, d2, d3) DO UPDATE
      SET n = ${table}.n + excluded.n, s1 = ${table}.s1 + excluded.s1, s2 = ${table}.s2 + excluded.s2`;
}
```

Unit test (`rollup-sql.spec.ts`): rendering with a Postgres dialect yields SQL that contains the metric number, the `IN (1, 2, ...)` list, `AT TIME ZONE`, and the histogram `CASE` with 14 `WHEN`s for the histogram rule; and the builder throws for a non-integer metric. (Render with `new PgDialect().sqlToQuery(...)` from `drizzle-orm/pg-core`.)

- [ ] **Step 3: `RollupService`** (depends on a narrow `{ privileged }` interface so tests can hand it a plain adapter):

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { DatabaseService } from '../../../infra/db/database.service';
import { ROLLUP_RULES } from './rollup-rules';
import { recordedWindow, rollupUpsert, type Grain, type Scope } from './rollup-sql';

export const ROLLUP_LOCK_KEY = 4_271_993_077; // arbitrary and stable; shared by the pass and the reconcile so they never overlap
export const ROLLUP_LAG_MS = 60_000;
const SLICE_MS = 10 * 60_000;

export interface Privileged {
  privileged<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}
export interface RollupPass {
  from: Date;
  to: Date;
  slices: number;
}

@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);
  constructor(@Inject(DatabaseService) private readonly db: Privileged) {}

  /**
   * Folds every event recorded in [watermark, now - lag) into the rollups and moves the watermark, in slices of at most ten minutes so a
   * catch-up after downtime stays inside the statement timeout. Returns null when another worker holds the lock.
   */
  async runOnce(opts: { upTo?: Date } = {}): Promise<RollupPass | null> {
    let first: Date | null = null;
    let last: Date | null = null;
    let slices = 0;
    for (;;) {
      const step = await this.db.privileged(async (tx) => {
        const lock = await tx.execute(
          sql`SELECT pg_try_advisory_xact_lock(${ROLLUP_LOCK_KEY}) AS ok`,
        );
        if (!(lock.rows[0] as { ok: boolean }).ok) return 'busy' as const;
        const state = await tx.execute(
          sql`SELECT recorded_before FROM an_rollup_state WHERE name = 'main' FOR UPDATE`,
        );
        const from = new Date((state.rows[0] as { recorded_before: string }).recorded_before);
        const limit = opts.upTo ?? (await this.dbNow(tx, ROLLUP_LAG_MS));
        if (from >= limit) return { done: true as const, from, to: from };
        const to = new Date(Math.min(limit.getTime(), from.getTime() + SLICE_MS));
        const window = recordedWindow(from, to);
        for (const rule of ROLLUP_RULES) {
          const scopes: Scope[] = rule.platform ? ['org', 'platform'] : ['org'];
          for (const grain of ['hour', 'day'] as Grain[]) {
            for (const scope of scopes) await tx.execute(rollupUpsert(rule, grain, scope, window));
          }
        }
        await tx.execute(
          sql`UPDATE an_rollup_state SET recorded_before = ${to.toISOString()}::timestamptz, updated_at = now() WHERE name = 'main'`,
        );
        return { done: to >= limit, from, to };
      });
      if (step === 'busy') return slices === 0 ? null : { from: first!, to: last!, slices };
      slices += 1;
      first ??= step.from;
      last = step.to;
      if (step.done) break;
    }
    return { from: first!, to: last!, slices };
  }

  private async dbNow(tx: Tx, lagMs: number): Promise<Date> {
    const r = await tx.execute(
      sql`SELECT (clock_timestamp() - ${lagMs} * interval '1 millisecond') AS t`,
    );
    return new Date((r.rows[0] as { t: string }).t);
  }

  /** Watermark age in seconds, for the health check and the stalled-worker alert. */
  async watermarkAgeSeconds(): Promise<number> {
    return this.db.privileged(async (tx) => {
      const r = await tx.execute(
        sql`SELECT extract(epoch FROM clock_timestamp() - recorded_before)::float AS age FROM an_rollup_state WHERE name = 'main'`,
      );
      return Number((r.rows[0] as { age: number }).age);
    });
  }
}
```

The nightly `reconcile(day)` and `trimHourRows()` methods are added in Task A6.

- [ ] **Step 4: Failing integration tests** `rollup.spec.ts` (container + migrations; an `owner` client for seeding events and a `Privileged` adapter `{ privileged: (fn) => withPrivileged(clients.db, fn) }` over `createDbClient`). Helpers: `seed(rows)` inserts `an_events` through the owner client with explicit `recorded_at`/`occurred_at`; `setWatermark(ts)` updates `an_rollup_state` as the owner; `day(org, metric)` and `hour(org, metric)` read the rollup tables as the owner. Cases:
  1. **Aggregates:** 3 delivered + 1 failed message events for org 1 (`channel_kind` 1, `source_kind` 2) and 2 for org 2, then `runOnce({ upTo })`. Expect `an_rollup_day` rows for `MSG_COUNT` with `d1 = type`, correct `n` per org, **and** `org_id = 0` rows equal to the sum across orgs (platform scope), but no platform rows for `MSG_BY_CAMPAIGN`.
  2. **Watermark / replay:** run again with no new events: all rollup values unchanged. Insert 2 more events, run again: values grew by exactly 2.
  3. **Lag window:** an event with `recorded_at = now()` is not rolled by `runOnce()` (default `upTo` is now minus 60 s); after `runOnce({ upTo: now + 1 minute })` it is.
  4. **Late event:** `occurred_at` ten days ago, `recorded_at` now: after a pass it increments the bucket ten days back, not today's.
  5. **Timezone:** org with `workspace_settings.timezone = 'Asia/Kolkata'` and an event at `2026-10-01T18:40:00Z`: the day bucket is `2026-10-02` and the hour bucket is `2026-10-01T18:30:00Z`. A UTC org gets `2026-10-01` and `18:00:00Z`. A DST zone (`America/New_York`) event at `2026-11-01T05:30:00Z` lands on local day `2026-11-01` (document the fall-back hour as ambiguous and assert it is counted once).
  6. **Histogram:** three `CONV_FIRST_REPLY` events with durations 500, 3000, 40000 ms for one agent produce rows with `d3 = 0, 1, 4` (each `n = 1`) and `s1` equal to the duration.
  7. **Concurrency:** `await Promise.all([runOnce(), runOnce()])` returns one pass and one `null`, and totals are not doubled.
  8. **Slices:** events spread over 35 minutes of `recorded_at` produce `slices >= 4` and the same totals as one pass.
  9. **Property:** 20 iterations with a seeded RNG: random events over 3 days, 3 orgs, random watermark split (run a pass up to a random time, add more events, finish). Totals in `an_rollup_day` equal a direct `GROUP BY` over `an_events` for every org and dimension.
- [ ] **Step 5: Run, expect pass.** Fix SQL until the property test is green; this is the correctness gate of the whole design.
- [ ] **Step 6: Checkpoint.** Commit when asked: `feat(analytics): rollup rules and incremental rollup pass`.

---

## Task A6: Worker, nightly reconcile, trim, health

**Files:** create `apps/api/src/modules/analytics/rollup/rollup.worker.ts`, `analytics-worker.module.ts`, `analytics.module.ts`, `index.ts`; modify `rollup.service.ts`,
`apps/api/src/workers/workers.module.ts`, `apps/api/src/app.module.ts`; tests extend `rollup.spec.ts`.

- [ ] **Step 1: Failing tests (add to `rollup.spec.ts`):**
  1. `reconcile(day)` on a day where one rollup row was deliberately changed (`UPDATE an_rollup_day SET n = n + 5`) and one stray row inserted: after it, the day rows equal a direct aggregate of events with `recorded_at < watermark`; it returns `{ fixedRows: 2 }`. It takes the same advisory lock as `runOnce`, so a concurrent `runOnce` waits or returns null.
  2. `trimHourRows(retentionDays = 120)` deletes `an_rollup_hour` rows older than 120 days and keeps newer ones; day rows are untouched.
  3. `gapReport(day)` compares the count of `an_events` of types `MSG_QUEUED`/`MSG_RECEIVED` with the count of `messages` created that day for the organization and returns `{ events, messages, missing }` (negative `missing` is fine); used only for a warning log in Phase 0 (the real message hooks arrive in Phase 1).
- [ ] **Step 2: Implement** `reconcile`, `trimHourRows`, `gapReport` in `RollupService`:
  - `reconcile(day: string)`: in one privileged transaction take `pg_advisory_xact_lock(ROLLUP_LOCK_KEY)` (blocking), read the watermark, build for every rule/scope a temp table from `rollupSelect(rule, 'day', scope, window)` where the window is `e.recorded_at < watermark AND <bucket expr> = day::date`, then `DELETE FROM an_rollup_day WHERE bucket = day AND metric = ANY(...)` and `INSERT ... SELECT` from the temp table; count differing rows with a `FULL JOIN` before replacing.
  - `trimHourRows`: `DELETE FROM an_rollup_hour WHERE bucket < now() - make_interval(days => $1)` in batches of 10,000 via `ctid`.
- [ ] **Step 3: Worker:**

```ts
@Injectable()
export class RollupWorker {
  private readonly logger = new Logger(RollupWorker.name);
  private running = false;
  constructor(
    private readonly rollup: RollupService,
    @Optional() private readonly config?: ConfigService<Env, true>,
  ) {}

  @Interval(30_000)
  async pass(): Promise<void> {
    if (this.running || this.config?.get('ANALYTICS_ROLLUP_ENABLED', { infer: true }) === false)
      return;
    this.running = true;
    try {
      const r = await this.rollup.runOnce();
      const age = await this.rollup.watermarkAgeSeconds();
      if (age > 300)
        this.logger.warn({ ageSeconds: Math.round(age) }, 'analytics rollup watermark is stale');
      if (r && r.slices > 1) this.logger.log({ slices: r.slices }, 'analytics rollup caught up');
    } catch (err) {
      this.logger.error({ err }, 'analytics rollup pass failed');
    } finally {
      this.running = false;
    }
  }

  @Cron('15 2 * * *')
  async nightly(): Promise<void> {
    try {
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const fixed = await this.rollup.reconcile(yesterday);
      if (fixed.fixedRows > 0) this.logger.warn({ fixed }, 'analytics rollup drift repaired');
      await this.rollup.trimHourRows(120);
    } catch (err) {
      this.logger.error({ err }, 'analytics nightly job failed');
    }
  }
}
```

`AnalyticsWorkerModule` provides `RollupService` and `RollupWorker` (import `ScheduleModule` is already in `WorkersModule`); `AnalyticsModule` provides and exports
`AnalyticsQueryService` (Task A7) and `RollupService` (for status). `index.ts` exports both modules and the services. Add `AnalyticsWorkerModule` to the `imports` array of `workers.module.ts`
and `AnalyticsModule` to `app.module.ts`.

- [ ] **Step 4: Boundary spec.** Run `apps/api/test/unit/infra/boundaries.matrix.spec.ts` and the dependency-cruiser check (`pnpm --filter @crm/api exec depcruise ...` as in `package.json`); the worker uses `@Interval`/`@Cron`, so no queue is reserved.
- [ ] **Step 5: Run tests, expect pass.** **Checkpoint.** Commit when asked: `feat(analytics): rollup worker, nightly reconcile and trim`.

---

## Task A7: `AnalyticsQueryService`: rollup plus live tail, cache

**Files:** create `apps/api/src/modules/analytics/query/analytics-query.service.ts`; test `apps/api/test/integration/analytics/query.spec.ts`.

- [ ] **Step 1: Failing tests.**
  1. **Equality across the watermark:** seed 200 random events over 3 days for one org; run `runOnce({ upTo })` for the first half of `recorded_at`; `series()` for the whole range equals the direct aggregate of all events (rollup + tail, no double count, no gap). Repeat for 10 random watermark positions.
  2. **Tail only:** with the watermark at its seed value (nothing rolled), `series()` still returns the correct totals from events alone.
  3. **Grouping and filters:** `groupBy: ['d1']` and `filter: { d2: 1 }` give per-type totals for one channel kind; the campaign metric filtered by `d1 = campaignId` returns only that campaign.
  4. **Window cap:** a window longer than the metric's `windowDaysMax` throws a validation error.
  5. **Tenancy:** called inside `withTenant(orgA)`, rows of org B are never returned even if requested; platform scope (`orgId: 0`) throws unless the transaction is privileged.
  6. **Cache:** two identical `seriesCached` calls inside the TTL run the SQL once (count queries with a spy), and concurrent identical calls share one execution (single-flight).
- [ ] **Step 2: Implement.** Signature and SQL:

```ts
export interface SeriesQuery {
  orgId: number; // 0 = platform rows (privileged transactions only)
  metric: MetricId;
  grain: Grain;
  from: string; // hour grain: ISO instant; day grain: 'YYYY-MM-DD'
  to: string; // exclusive
  filter?: { d1?: number; d2?: number; d3?: number };
  groupBy?: ReadonlyArray<'bucket' | 'd1' | 'd2' | 'd3'>; // default ['bucket']
}
export interface SeriesRow { bucket?: string; d1?: number; d2?: number; d3?: number; n: number; s1: number; s2: number }

async series(tx: Tx, q: SeriesQuery): Promise<SeriesRow[]> {
  const rule = RULE_BY_METRIC.get(q.metric); // throws on an unknown metric
  assertWindow(q, METRIC_BY_ID.get(q.metric)!.windowDaysMax);
  const table = sql.raw(q.grain === 'hour' ? 'an_rollup_hour' : 'an_rollup_day');
  const scope: Scope = q.orgId === 0 ? 'platform' : 'org';
  const tailWindow = q.orgId === 0
    ? sql`e.recorded_at >= (SELECT recorded_before FROM an_rollup_state WHERE name = 'main')`
    : sql`e.org_id = ${q.orgId} AND e.recorded_at >= (SELECT recorded_before FROM an_rollup_state WHERE name = 'main')`;
  const f = filterSql(q.filter); // d1 = .., d2 = .. built from numbers
  const group = groupCols(q.groupBy ?? ['bucket']);
  const res = await tx.execute(sql`
    SELECT ${group.select}, sum(n)::bigint AS n, sum(s1)::bigint AS s1, sum(s2)::bigint AS s2
      FROM (
        SELECT bucket, d1, d2, d3, n, s1, s2 FROM ${table}
         WHERE org_id = ${q.orgId} AND metric = ${q.metric} AND bucket >= ${q.from} AND bucket < ${q.to} ${f}
        UNION ALL
        SELECT bucket, d1, d2, d3, n, s1, s2 FROM (${rollupSelect(rule, q.grain, scope, tailWindow)}) t
         WHERE bucket >= ${q.from} AND bucket < ${q.to} ${f}
      ) u
     GROUP BY ${group.by} ORDER BY ${group.by}`);
  return mapRows(res.rows);
}
```

The watermark subquery and the rollup read run in one statement (one snapshot, READ COMMITTED), so a pass committing in between cannot cause a double count. A platform query with a non-privileged
transaction returns nothing under RLS: assert privilege explicitly with `SELECT app_is_privileged()` and throw a clear error.
`seriesCached(tx, q, { ttlSeconds })` wraps `series` with Redis (`REDIS_CLIENT`), key `an:v1:{orgId}:{metric}:{grain}:{sha1(JSON(q))}`, JSON value, an in-process `Map<string, Promise<SeriesRow[]>>` for single-flight, and a bypass when `ttlSeconds <= 0`. Cache failures are logged and ignored.

- [ ] **Step 3: Run, expect pass.** **Checkpoint.** Commit when asked: `feat(analytics): query service with live tail and cache`.

---

## Task A8: Shadow harness and source flag

**Files:** create `apps/api/src/modules/analytics/shadow/metric-source.ts`; test `apps/api/test/unit/analytics/metric-source.spec.ts`.

- [ ] **Step 1: Failing unit tests:**
  1. `sourceOf('msg_count', '{"msg_count":"shadow"}')` is `shadow`; unknown keys, invalid JSON and invalid values give `legacy`.
  2. `serve()` in `legacy` runs only the legacy function and returns its value.
  3. In `rollup` it runs only the rollup function.
  4. In `shadow` it returns the **legacy** value, runs the rollup function, calls `onDiff` once with both values when they differ (by the supplied `equal`, default deep equality with numeric tolerance `0`), and does **not** call `onDiff` when they match.
  5. In `shadow` a throwing rollup function never fails the request: the legacy value is returned and `onError` is called.
  6. In `shadow` the rollup function does not delay the legacy result beyond its own duration plus the compare (run them with `Promise.allSettled`, return after both).
- [ ] **Step 2: Implement:**

```ts
export type MetricSource = 'legacy' | 'shadow' | 'rollup';

export function sourceOf(
  key: string,
  raw: string | undefined = process.env.ANALYTICS_SOURCES,
): MetricSource {
  try {
    const v = (JSON.parse(raw ?? '{}') as Record<string, unknown>)[key];
    return v === 'shadow' || v === 'rollup' ? v : 'legacy';
  } catch {
    return 'legacy';
  }
}

export interface ServeOptions<T> {
  source?: MetricSource;
  equal?: (a: T, b: T) => boolean;
  onDiff?: (d: { key: string; legacy: T; rollup: T }) => void;
  onError?: (key: string, err: unknown) => void;
}

export async function serve<T>(
  key: string,
  legacy: () => Promise<T>,
  rollup: () => Promise<T>,
  opts: ServeOptions<T> = {},
): Promise<T> {
  const source = opts.source ?? sourceOf(key);
  if (source === 'legacy') return legacy();
  if (source === 'rollup') return rollup();
  const [l, r] = await Promise.allSettled([legacy(), rollup()]);
  if (l.status === 'rejected') throw l.reason;
  if (r.status === 'rejected') opts.onError?.(key, r.reason);
  else if (!(opts.equal ?? deepEqual)(l.value, r.value))
    opts.onDiff?.({ key, legacy: l.value, rollup: r.value });
  return l.value;
}
```

(`deepEqual` is a small local structural comparison; no new dependency.) A default `onDiff` logs `{ key, legacy, rollup }` at `warn` with the message `analytics shadow diff` so the shadow period is greppable.

- [ ] **Step 3: Run, expect pass.** **Checkpoint.** Commit when asked: `feat(analytics): shadow-compare harness`.

---

## Task A9: Privacy, tenancy audit, docs

**Files:** modify `apps/api/src/modules/privacy/manifests/engagement.ts` and `apps/api/src/modules/privacy/registry/known-links.ts`; create `docs/architecture/analytics.md`, `docs/runbooks/analytics-rollups.md`; modify `docs/architecture/scale.md`.

- [ ] **Step 1: Run `privacy/registry.spec.ts` and read what it asks for `an_events`** (it points at `contact_id`). Add to the `engagement` holder (copy the neighbouring entry shape):

```ts
{
  table: 'an_events',
  link: CONTACT,
  disposition: 'anonymise',
  set: { contact_id: 'null' },
  tier: 'history',
  categories: ['behaviour'],
  pii: ['contact_id'],
  retention: 'Counts stay; the contact link is removed on erase. Raw events are archived after 60 days and the archive omits contact_id.',
},
```

and in `known-links.ts` add `{ table: 'an_events', column: 'contact_id', holds: 'contacts.id' }`. Follow the spec's messages until `registry.spec.ts` passes (it must not add to the existing `google_consent_requests` failure).

- [ ] **Step 2: Workspace erase.** Locate the erase list (`workspaces-teams-tenancy/lifecycle/lifecycle.repository.ts`, the `org_id` cascade at about line 339 and the plan wipe list in `plan-retention.service.ts`): add `an_events`, `an_rollup_hour`, `an_rollup_day` (none has a foreign key to `organizations`, so they are not cascaded). Test: extend the lifecycle erase integration test to seed one row in each table and assert they are gone.
- [ ] **Step 3: Tenancy audit.** Run `node tools/tenancy-audit/run.mjs` against a migrated scratch DB (env as in the earlier run). Expect no new unclassified tables and the generated isolation scenarios for the four new tables passing. If the DB probe reports `BLOCKED` for `an_events`, teach `tools/tenancy-audit/lib/db-probe.mjs` to seed it (never skip it).
- [ ] **Step 4: Docs.** `docs/architecture/analytics.md`: the diagram from the spec section 4, the five access classes, and the rules for adding a metric (event type, rollup rule, registry entry, shadow, flip). `docs/runbooks/analytics-rollups.md` with these queries:

```sql
-- watermark age (seconds): should stay under ~90
SELECT extract(epoch FROM clock_timestamp() - recorded_before) AS age_s FROM an_rollup_state WHERE name = 'main';
-- events in the default partition: must be 0
SELECT count(*) FROM an_events_default;
-- hot event volume by month
SELECT date_trunc('month', recorded_at) AS month, count(*) FROM an_events GROUP BY 1 ORDER BY 1;
-- rebuild one day of rollups from events (run in a privileged psql session): see RollupService.reconcile(day)
```

and the procedures: stalled worker, timezone change, adding a metric, replaying a day. In `scale.md`, replace "Where this design stops" with a pointer to the spec.

- [ ] **Step 5: Checkpoint.** Commit when asked: `feat(analytics): privacy, erase and tenancy coverage; docs`.

---

## Task A10: Load test and decision gate

**Files:** create `apps/api/test/integration/analytics/analytics-bench.spec.ts` (skipped unless `ANALYTICS_BENCH=1`) and `docs/performance/analytics/phase0-bench.md`.

- [ ] **Step 1: Bench spec.** A container with the production limits (`withResourcesQuota({ memory: 1, cpu: 1 })`, `shared_buffers=256MB`, `max_connections=100`; adjust to the testcontainers API in use). Measure and print a table:
  1. **Writer overhead:** 5,000 `record` calls, each in its own transaction that also inserts a 1-row dummy business row, with `ANALYTICS_EVENT_SAVEPOINT` on and off. Report p50 and p95 added milliseconds versus the business insert alone.
  2. **Bulk insert throughput:** `recordMany` of 500 events x 200 batches; events per second.
  3. **Rollup pass cost:** 125,000 events (one hour at the design target of 3M a day) with `recorded_at` spread over 60 minutes across 200 orgs; time `runOnce` to roll them all; also the steady-state pass for one minute of events (about 2,100).
  4. **Query p95:** 200 orgs x 90 days of day rollups and 30 days of hour rollups; 200 `series()` calls for one busy org (30 days, `groupBy bucket`), p50 and p95, with and without a 90 second tail.
  5. **Storage:** `pg_total_relation_size` of `an_events` and the rollup tables after the load, bytes per event.
- [ ] **Step 2: Decision gate** (write results and the decision into `docs/performance/analytics/phase0-bench.md`):
  - Writer p95 overhead < 3 ms. If the savepoint costs more than 1 ms, set the default of `ANALYTICS_EVENT_SAVEPOINT` to false and have `recordMany` validate in TypeScript only (document that a database error inside the insert then fails the caller's transaction).
  - Steady-state rollup pass < 2 s; one-hour catch-up < 10 s.
  - `series()` p95 < 200 ms.
  - If any target fails, stop and raise it with the owner before Phase 1 (open decision D5 in the spec: Postgres memory).
- [ ] **Step 3: Checkpoint.** Commit when asked: `test(analytics): phase 0 benchmark and decision record`.

---

## Task A11: Phase 0 gate

- [ ] **Step 1: Full checks.**
  - `eslint` on `apps/api/src/{kernel,modules/analytics}` and `packages/{db,contracts}/src`; `prettier --end-of-line auto --check` on all new files.
  - `tsc --noEmit` for `packages/db`, `packages/contracts`, `apps/api`.
  - Unit: `analytics` pattern. Integration: `analytics`, `schema-invariants`, `privacy/registry`, `tenancy-isolation.generated`, `partition-maintenance`, lifecycle erase.
  - `pnpm db:verify-schema` against a migrated scratch DB: 0 errors.
  - `bash .claude/skills/pre-pr/scripts/gate.sh`.
- [ ] **Step 2: Security gate.** Run the `security-review-gate` skill in order (tenancy, authz, auth audits; dependency audit; secret scan; `security-review`; `code-review` high). New surfaces to read by hand: the raw-SQL builders (`sql.raw` only on integers and allowlisted column names), the privileged worker transaction, the `org_id = 0` rows, the cache key (must include `orgId`), PII in `props`.
- [ ] **Step 3: Parity stamp.** No screen or contract changed; record `blocked-env` (Reference not runnable) with the note used earlier, or run the skill if the Reference is available.
- [ ] **Step 4: Exit criteria for Phase 0.**
  - The property test, late-event test and concurrency test pass.
  - Benchmark targets met or the owner has accepted a documented deviation.
  - No new red in the known-red list.
  - Feature flags default to a safe state: events on, rollup worker on, every metric source `legacy`.

---

# Part B: Retention engine and cost hygiene

Independent of Part A after Task A2. The engine is generic; Phase 0 registers one policy (`an_events`), the other streams join in the phases that move their readers (rule from the spec: a stream's cut ships only after its readers have switched).

## File map

| File                                                                                                                  | Responsibility                                    |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `apps/api/src/modules/data-retention/retention-policies.ts` (new)                                                     | `StreamPolicy` type, registry, `eligibleMonths()` |
| `apps/api/src/modules/data-retention/archive-storage.port.ts` (new)                                                   | `ArchiveStorage` interface                        |
| `apps/api/src/infra/providers/data-retention/local-archive-storage.adapter.ts`, `s3-archive-storage.adapter.ts` (new) | adapters (dev/tests, bucket)                      |
| `apps/api/src/modules/data-retention/partition-archiver.service.ts` (new)                                             | export, verify, detach, drop                      |
| `apps/api/src/modules/data-retention/archive-reader.service.ts` (new)                                                 | `stream(stream, org, from, to)`                   |
| `apps/api/src/modules/data-retention/retention.worker.ts`, `data-retention-worker.module.ts`, `index.ts` (new)        | daily job and wiring                              |

## Task B1: Policy registry

- [ ] **Step 1: Failing unit test** `apps/api/test/unit/data-retention/policies.spec.ts` for `eligibleMonths(now, liveDays)`: a month is eligible only when its **end** is at least `liveDays` before `now` (so with `liveDays = 60` on 2026-12-20, `2026-10` is eligible and `2026-11` is not); never returns the current or future months; returns months oldest first.
- [ ] **Step 2: Implement:**

```ts
export interface StreamPolicy {
  /** Partitioned parent table in `public`. */
  stream: string;
  partitionKey: string;
  orgColumn: string;
  liveDays: number;
  /** null = keep archive objects forever. */
  archiveDays: number | null;
  /** Columns left out of the archive object (personal links). */
  omitColumns: readonly string[];
}

export const STREAM_POLICIES: readonly StreamPolicy[] = [
  {
    stream: 'an_events',
    partitionKey: 'recorded_at',
    orgColumn: 'org_id',
    liveDays: 60,
    archiveDays: null,
    omitColumns: ['contact_id'],
  },
];

export function eligibleMonths(now: Date, liveDays: number): string[] {
  /* 'YYYY-MM', oldest first, month end <= now - liveDays */
}
```

- [ ] **Step 3: Run, expect pass.** Checkpoint: commit when asked, `feat(retention): stream policy registry`.

## Task B2: Archive storage port and adapters

Use the `provider-adapter` skill. Read `apps/api/src/infra/providers/platform-settings-branding-storage/object-storage.probe.ts` for `signS3Request` / `resolveStorageTarget` before writing the S3 adapter.

- [ ] **Step 1: Port** (`archive-storage.port.ts`): `put(key, body: Buffer, meta?: Record<string,string>): Promise<{bytes:number}>`, `get(key): Promise<Buffer | null>`, `list(prefix): Promise<string[]>` (full keys), `delete(key)`, `deletePrefix(prefix): Promise<number>`; a Nest injection token `ARCHIVE_STORAGE`.
- [ ] **Step 2: Shared contract test** `apps/api/test/unit/data-retention/archive-storage.contract.ts` (a function taking a factory), run against the local adapter: round trip, missing key returns `null`, `list` returns only keys under the prefix in sorted order, `deletePrefix` removes exactly those, keys with `..` or a leading `/` are rejected.
- [ ] **Step 3: Local adapter** (root from `ARCHIVE_LOCAL_DIR`, default `~/.crm-platform/archive`; reject path traversal). **S3 adapter** using the existing signer against `S3_ENDPOINT` with bucket `S3_BUCKET_ARCHIVE` (default `crm-archive`; create it on first write like `MediaStorageService` does). Run the contract test against the S3 adapter with a MinIO container (the `offsite-backup` spec shows the image and credentials); skip with a clear message when Docker is unavailable.
- [ ] **Step 4: Env:** `ARCHIVE_DRIVER` (`local` | `s3`, default `local`), `ARCHIVE_LOCAL_DIR`, `S3_BUCKET_ARCHIVE`; provider factory picks the adapter. Checkpoint: `feat(retention): archive storage port with local and S3 adapters`.

## Task B3: Partition archiver

- [ ] **Step 1: Failing integration tests** `apps/api/test/integration/data-retention/partition-archiver.spec.ts` with a synthetic stream `zz_stream` (range-partitioned by `recorded_at`, columns `id, org_id, recorded_at, contact_id, n`) and months `2026-08`, `2026-09`, `2026-10`; a `StreamPolicy` with `liveDays = 40`, `omitColumns = ['contact_id']`, local storage in a temp dir:
  1. Running at `2026-12-01` archives and drops `2026-08` and `2026-09`, keeps `2026-10`.
  2. Objects exist at `archive/zz_stream/2026-08/<org>.ndjson.gz` per org plus `_manifest.json` with `totalRows`, per-org `rows`, `sha256`, `bytes`; each object parses to the exact rows (without `contact_id`).
  3. **Verification blocks the drop:** corrupt one object after export (in a test hook between export and verify): the partition is **not** dropped, the run reports a failure, and the next run (object repaired) completes.
  4. **Idempotent:** a second run changes nothing; a run that crashed after export but before the drop (simulate) finishes the drop without re-exporting.
  5. Rows in the `_default` partition are never archived or dropped.
  6. A month whose partition has rows added after its manifest was written (count differs) is re-exported, not dropped on a stale manifest.
- [ ] **Step 2: Implement** `PartitionArchiver.archiveMonth(policy, month)`:
  1. Privileged transaction; `SET LOCAL lock_timeout = '5s'`.
  2. Per org in the partition (`SELECT DISTINCT org_id`), stream rows with keyset pagination on `(id)` in batches of 20,000, build NDJSON, gzip with Node `zlib` streams in chunks (never hold a full month in memory), compute sha256 of the uncompressed bytes, `storage.put`.
  3. Write `_manifest.json`; re-read each object, recount lines and recompute the hash; compare with `SELECT count(*)` of the partition.
  4. Only if everything matches: `ALTER TABLE <stream> DETACH PARTITION <stream>_YYYYMM; DROP TABLE <stream>_YYYYMM;` and log the totals.
     Use `format('%I')` / `sql.identifier` for all names; the stream and partition names come from the registry and the catalog, never from input.
- [ ] **Step 3: Run, expect pass.** Checkpoint: `feat(retention): archive and drop closed partitions`.

## Task B4: Archive reader

- [ ] **Step 1: Failing tests** `archive-reader.spec.ts` (using output of B3): `ArchiveReader.stream('zz_stream', org, from, to)` yields only that org's rows whose partition key is in `[from, to)`, in id order, across two archived months; yields nothing for a month with no object; handles a missing manifest by listing the prefix; never reads another org's object (assert the storage `get` calls).
- [ ] **Step 2: Implement** as an async generator reading each month's object, gunzipping, parsing line by line. Checkpoint: `feat(retention): archive reader`.

## Task B5: Retention worker and expiry

- [ ] **Step 1: Failing tests:** with `RETENTION_ENABLED=false` nothing runs; with `RETENTION_DRY_RUN=true` it logs the plan (months per stream) and changes nothing; with both off it archives eligible months; `expireArchive(policy)` deletes `archive/<stream>/<yyyy-mm>/` prefixes older than `archiveDays` (skipped when null).
- [ ] **Step 2: Implement** `RetentionWorker` (`@Cron('50 3 * * *')`), env `RETENTION_ENABLED` (default `false`), `RETENTION_DRY_RUN` (default `true`); one stream at a time; a failure on one stream is logged and does not stop the others; module `DataRetentionWorkerModule` imported by `workers.module.ts`. Checkpoint: `feat(retention): daily retention worker`.

## Task B6: Workspace erase of archive objects

- [ ] **Step 1: Failing test:** after archiving a month for two orgs, the workspace erase for org A deletes only `archive/*/*/<A>.ndjson.gz`.
- [ ] **Step 2: Implement** `ArchiveStorage.deleteOrgObjects(orgId)` (list `archive/`, match the `/<orgId>.ndjson.gz` suffix, delete) and call it from the lifecycle erase path beside the existing `storage_purge_queue` work. Checkpoint: `feat(retention): erase archive objects with the workspace`.

## Task B7: Cost hygiene quick wins (can ship first)

- [ ] **Step 1: Docker log rotation.** In `deploy/hostinger/docker-compose.yml`, give `postgres`, `redis`, `minio` and `migrate` the same `logging: { driver: json-file, options: { max-size: 20m, max-file: "5" } }` block the other services use (YAML anchor if one exists). The file's comment says the database was left unrotated to avoid restarting it; schedule the change with a planned restart, or apply it at the next release.
- [ ] **Step 2: Redis job history.** In `apps/api/src/infra/queue/queues.ts` change `DEFAULT_JOB_OPTIONS` to `removeOnComplete: { count: 1000, age: 3600 }` and `removeOnFail: { count: 2000, age: 259200 }`. Update `boundaries.matrix.spec.ts` expectations if they pin the old numbers; keep the "bounded history" assertion.
- [ ] **Step 3: PII in job data.** For `waba-ingest` and `webhook-forward`, set `removeOnComplete: true` in their queue options (they hold message text, phone numbers and the raw webhook body). Failed jobs keep 3 days for debugging.
- [ ] **Step 4: Verify** with the boundary matrix spec and a queue integration spec (`test/integration/queue*.spec.ts`). Checkpoint: `chore(infra): rotate container logs and shorten Redis job history`.

## Task B8: Docs and gate

- [ ] `docs/runbooks/data-retention.md` (what the job does, dry run first, how to restore a month from the archive into a side table, how to check the manifest), update `docs/architecture/scale.md` partition section ("Retention is dropping a partition" now true for registered streams), run the Part A gate steps (A11) on this part.

---

# Part C: Roadmap for Phases 1 to 4

Each phase becomes its own plan, written in this format, when the previous one exits. Every phase uses the same loop per metric: **emit the event, add the rollup rule and registry entry, backfill, shadow, flip, then remove the legacy path.**

| Phase                      | Plan content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Items (spec section 7)                                            | Exit criteria                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Messaging and campaigns | Hook `AnalyticsEvents.record` at the three message insert sites and `MessagesRepository.insertEvent` (map `queued/sent/delivered/read/failed` to `MSG_*`), campaign callbacks, link redirect, conversation lifecycle and CSAT; rules for `msg_count`, `msg_by_campaign`, funnel, throughput, heatmap, first-reply and resolution histograms, campaign and broadcast stats; unique-count sketch (decision D1); `conv.sla_breached`; backfill from `messages` and `message_events`; switch `DashService`, `team-analytics`, `message-history` summary/insights, `broadcasts-read`, `campaigns-read`, `campaign-summary`; remove the per-receipt `recount`; Message History export reads live plus `ArchiveReader`; retention cut of `message_events` to 60 days and archive 2 years | A-001 to A-020, A-057                                             | each metric shadows clean for the agreed days then flips; dashboard and list endpoints no longer scan `messages`; polling tiles are rollup reads |
| 2. Usage and billing       | Events for AI tokens, translation, lead scoring, charges and refunds, call end; `an_dict` migration for provider/model; quota meters (`monthly_messages`, AI tokens, email) read month-to-date from the day rollup; wallet summary and BSP / platform wallet from charge rollups; retention for `ai_token_usage`, `translation_usage` (90 days) and `usage_charges` (1 year then archive)                                                                                                                                                                                                                                                                                                                                                                                         | A-037 to A-041, A-051 to A-055                                    | meters equal live counts in shadow; create-time enforcement is O(1); wallet reconcile still reads only the ledger                                |
| 3. Everything else         | Events and rules for CRM (contacts, deals, tasks, invoices, appointments), flows and FAQ, forms and links, storefront, support and referrals, platform events; `an_stock_day` snapshot job; operator console from `org_id = 0` rollups; retention for integration payloads, automation and AI runs, tracking and per-recipient state; exports move from `bytea` to the bucket                                                                                                                                                                                                                                                                                                                                                                                                     | A-021 to A-036, A-042 to A-050, A-056, A-058, A-059, A-062, A-063 | all inventory items read the service or are explicitly live (class L)                                                                            |
| 4. Cleanup                 | Remove `message_event_archives` and its sweep, legacy counters (`wpcampaigns.*_count` recount, `devices.sent_24h` columns without writers), the `COUNTER_FLUSH` and `BILLING_POSTING` reservations; audit `retention_class` and the 90/365 day split (decision D3); outbox done/dead retention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | n/a                                                               | no reader of a legacy path remains; boundary and schema-invariant specs updated                                                                  |

Open decisions that block specific phases: D1 (unique counts) before Phase 1; D2 (archive length for outbox and per-recipient state) before Phases 3 and 4; D3 (audit split) before Phase 4; D4 (flow-run window) before Phase 3; D5 (Postgres memory, disk) after the Phase 0 benchmark.
