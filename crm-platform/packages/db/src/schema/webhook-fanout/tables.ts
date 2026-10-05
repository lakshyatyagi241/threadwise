/**
 * webhook-fanout: platform tables for forwarding the one Meta webhook to many targets.
 * Mirrors migrations/20261014100000_wfwd_webhook_forwarding.sql. The SQL migration is the source of truth;
 * `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, rowVersion, updatedAt } from '../columns';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const webhookForwardTargets = pgTable(
  'webhook_forward_targets',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    authHeaderName: text('auth_header_name'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    authHeaderValue: text('auth_header_value'),
    authHeaderLast4: text('auth_header_last4'),
    isActive: boolean('is_active').notNull().default(true),
    fieldFilter: text('field_filter').array(),
    timeoutMs: integer('timeout_ms').notNull().default(10000),
    maxAttempts: integer('max_attempts').notNull().default(5),
    successCount: bigint('success_count', { mode: 'number' }).notNull().default(0),
    failureCount: bigint('failure_count', { mode: 'number' }).notNull().default(0),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [unique('uq_webhook_forward_targets_name').on(t.name)],
);

export type WebhookForwardTargetsRow = typeof webhookForwardTargets.$inferSelect;
export type NewWebhookForwardTargetsRow = typeof webhookForwardTargets.$inferInsert;

export const webhookForwardFailures = pgTable(
  'webhook_forward_failures',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    targetId: idColumn('target_id')
      .notNull()
      .references(() => webhookForwardTargets.id, { onDelete: 'cascade' }),
    body: bytea('body').notNull(),
    signatureHeader: text('signature_header'),
    contentType: text('content_type'),
    attempts: integer('attempts').notNull(),
    statusCode: integer('status_code'),
    error: text('error'),
    createdAt: createdAt(),
    replayedAt: timestamp('replayed_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_wfwd_failures_target').on(t.targetId, t.createdAt.desc()),
    index('idx_wfwd_failures_created').on(t.createdAt),
  ],
);

export type WebhookForwardFailuresRow = typeof webhookForwardFailures.$inferSelect;
export type NewWebhookForwardFailuresRow = typeof webhookForwardFailures.$inferInsert;
