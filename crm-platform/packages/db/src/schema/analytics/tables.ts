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

/**
 * Append-only analytics event stream, monthly partitions by recorded_at (PK includes the partition key).
 * See docs/superpowers/specs/2026-10-16-event-based-analytics-design.md. The SQL migration 20261217090000_analytics_events.sql is the source
 * of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
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

/** d1..d3 are the metric's dimensions (0 when unused); a histogram metric uses d3 as the bucket index. org_id 0 = platform rows. */
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

/** The rollup watermark: every event with recorded_at below `recordedBefore` is already in the rollups. */
export const anRollupState = pgTable('an_rollup_state', {
  name: text('name').primaryKey(),
  recordedBefore: timestamp('recorded_before', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AnEventRow = typeof anEvents.$inferSelect;
export type NewAnEventRow = typeof anEvents.$inferInsert;
export type AnRollupRow = typeof anRollupDay.$inferSelect;
