/**
 * flow-runtime-engine: tables ported from Reference. Mirrors migrations/20261001101500_flr_threadwise_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { flows } from '../flow-builder-editor/tables';
import { organizations, users } from '../foundation';

export const flowSubscribers = pgTable(
  'flow_subscribers',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    flowId: idColumn('flow_id').notNull(),
    contactId: idColumn('contact_id').notNull(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    status: text('status').notNull().default('active'),
    retryCount: integer('retry_count').notNull().default(0),
    lastRetriedAt: timestamp('last_retried_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_flow_subscribers_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_flow_subscribers_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_flow_subscribers_flow_id_contact_id').on(t.orgId, t.flowId, t.contactId),
    foreignKey({
      name: 'fk_flow_subscribers_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flow_subscribers_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    index('idx_flow_subscribers_contact_id').on(t.orgId, t.contactId),
    index('idx_flow_subscribers_flow_id_status').on(t.orgId, t.flowId, t.status),
  ],
);

export type FlowSubscribersRow = typeof flowSubscribers.$inferSelect;
export type NewFlowSubscribersRow = typeof flowSubscribers.$inferInsert;

export const flowRetryLogs = pgTable(
  'flow_retry_logs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    flowId: idColumn('flow_id').notNull(),
    flowSubscriberId: idColumn('flow_subscriber_id').notNull(),
    contactId: idColumn('contact_id'),
    retriedByUserId: idColumn('retried_by_user_id'),
    previousStatus: text('previous_status'),
    previousFailureReason: text('previous_failure_reason'),
    outcome: text('outcome').notNull().default('queued'),
    outcomeReason: text('outcome_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_flow_retry_logs_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_flow_retry_logs_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flow_retry_logs_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flow_retry_logs_flow_subscriber_id',
      columns: [t.orgId, t.flowSubscriberId],
      foreignColumns: [flowSubscribers.orgId, flowSubscribers.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flow_retry_logs_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_flow_retry_logs_retried_by_user_id',
      columns: [t.orgId, t.retriedByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_flow_retry_logs_flow_id').on(t.orgId, t.flowId),
    index('idx_flow_retry_logs_flow_subscriber_id').on(t.orgId, t.flowSubscriberId),
    index('idx_flow_retry_logs_outcome').on(t.orgId, t.outcome),
    index('idx_flow_retry_logs_created_at').on(t.orgId, t.createdAt),
  ],
);

export type FlowRetryLogsRow = typeof flowRetryLogs.$inferSelect;
export type NewFlowRetryLogsRow = typeof flowRetryLogs.$inferInsert;
