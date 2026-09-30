import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn } from './columns';

/**
 * Transactional outbox.
 *
 * Written in the SAME transaction as the business change, so "row committed"
 * and "event exists" cannot diverge. A worker drains it and publishes.
 *
 * RANGE-partitioned monthly by created_at, so the PK is (id, created_at) —
 * Postgres requires the partition key in every unique constraint.
 */
export const eventOutbox = pgTable(
  'event_outbox',
  {
    id: bigint('id', { mode: 'number' }).notNull(),
    orgId: orgIdColumn(),
    /** Polymorphic: module api_name of the changed aggregate. */
    aggregateModule: text('aggregate_module').notNull(),
    aggregateId: idColumn('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Retry backoff target. The drain query never picks up a future row. */
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_outbox_org_created').on(t.orgId, t.createdAt),
  ],
);

/**
 * Append-only audit trail. Not event sourcing: the business tables remain the
 * source of truth, this is the paper trail of who changed what.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).notNull(),
    orgId: orgIdColumn(),
    actorId: idColumn('actor_id'),
    /** user | partner_agent | candidate | bot | system | api_key */
    actorType: text('actor_type').notNull().default('user'),
    module: text('module').notNull(),
    recordId: idColumn('record_id').notNull(),
    action: text('action').notNull(),
    delta: jsonb('delta').$type<Record<string, unknown>>(),
    requestId: text('request_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.at] }),
    index('idx_audit_record').on(t.orgId, t.module, t.recordId, t.at),
  ],
);

export type OutboxEvent = typeof eventOutbox.$inferSelect;
export type NewOutboxEvent = typeof eventOutbox.$inferInsert;
export type AuditEntry = typeof auditLog.$inferSelect;
