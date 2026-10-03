/**
 * flow-runtime-engine: tables ported from Reference. Mirrors migrations/20261001101500_flr_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { chatChannels as channels } from '../chat-conversations';
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
    // 20261019090000_flr_runtime.sql: how the contact entered, and the run that last served it.
    source: text('source').notNull().default('enroll'),
    lastRunId: idColumn('last_run_id'),
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

export const flowRuns = pgTable(
  'flow_runs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    flowId: idColumn('flow_id').notNull(),
    subscriberId: idColumn('subscriber_id'),
    contactId: idColumn('contact_id'),
    channelId: idColumn('channel_id'),
    peerKey: text('peer_key').notNull(),
    conversationId: idColumn('conversation_id'),
    source: text('source').notNull(),
    triggerRef: text('trigger_ref'),
    triggerText: text('trigger_text'),
    status: text('status').notNull().default('running'),
    endReason: text('end_reason'),
    failureCode: text('failure_code'),
    failureReason: text('failure_reason'),
    graph: jsonb('graph').notNull(),
    currentNodeId: text('current_node_id'),
    stepSeq: integer('step_seq').notNull().default(0),
    vars: jsonb('vars')
      .notNull()
      .default(sql`'{}'::jsonb`),
    visits: jsonb('visits')
      .notNull()
      .default(sql`'{}'::jsonb`),
    wait: jsonb('wait'),
    lastMenu: jsonb('last_menu'),
    lastOut: jsonb('last_out'),
    timeoutSeconds: integer('timeout_seconds').notNull().default(600),
    cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
    variant: text('variant'),
    campaignId: idColumn('campaign_id'),
    haltReason: text('halt_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    maxExpiresAt: timestamp('max_expires_at', { withTimezone: true }).notNull(),
    resumeAt: timestamp('resume_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_flow_runs_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_flow_runs_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flow_runs_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flow_runs_subscriber_id',
      columns: [t.orgId, t.subscriberId],
      foreignColumns: [flowSubscribers.orgId, flowSubscribers.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_flow_runs_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_flow_runs_channel_id',
      columns: [t.orgId, t.channelId],
      foreignColumns: [channels.orgId, channels.id],
    }).onDelete('set null'),
    uniqueIndex('uq_flow_runs_live_peer')
      .on(t.orgId, t.channelId, t.peerKey)
      .where(
        sql`${t.status} IN ('running', 'waiting', 'sleeping', 'halted') AND ${t.channelId} IS NOT NULL`,
      ),
    index('idx_flow_runs_flow_status').on(t.orgId, t.flowId, t.status),
    index('idx_flow_runs_contact').on(t.orgId, t.contactId),
    index('idx_flow_runs_subscriber').on(t.orgId, t.subscriberId),
    index('idx_flow_runs_started').on(t.orgId, t.startedAt.desc()),
    index('idx_flow_runs_due')
      .on(t.status, t.expiresAt, t.resumeAt)
      .where(sql`${t.status} IN ('waiting', 'sleeping', 'halted', 'running')`),
  ],
);

export type FlowRunsRow = typeof flowRuns.$inferSelect;
export type NewFlowRunsRow = typeof flowRuns.$inferInsert;

export const flowRunSteps = pgTable(
  'flow_run_steps',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    runId: idColumn('run_id').notNull(),
    seq: integer('seq').notNull(),
    nodeId: text('node_id'),
    nodeType: text('node_type'),
    event: text('event').notNull(),
    detail: jsonb('detail')
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    foreignKey({
      name: 'fk_flow_run_steps_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flow_run_steps_run_id',
      columns: [t.orgId, t.runId],
      foreignColumns: [flowRuns.orgId, flowRuns.id],
    }).onDelete('cascade'),
    index('idx_flow_run_steps_run').on(t.orgId, t.runId, t.seq, t.id),
  ],
);

export type FlowRunStepsRow = typeof flowRunSteps.$inferSelect;
export type NewFlowRunStepsRow = typeof flowRunSteps.$inferInsert;
