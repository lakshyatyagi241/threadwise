/**
 * deals-pipelines: tables ported from WaDesk. Mirrors migrations/20261001103800_deal_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { conversations } from '../chat-conversations/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { companies, contacts } from '../crm';
import { organizations, users } from '../foundation';

export const pipelines = pgTable(
  'pipelines',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    currency: text('currency').notNull().default('INR'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_pipelines_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_pipelines_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_pipelines_is_default').on(t.orgId, t.isDefault),
    // uq_pipelines_org_lower_name (lower(btrim(name))) and uq_pipelines_one_default (partial) live in the migration.
  ],
);

export type PipelinesRow = typeof pipelines.$inferSelect;
export type NewPipelinesRow = typeof pipelines.$inferInsert;

export const pipelineStages = pgTable(
  'pipeline_stages',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    pipelineId: idColumn('pipeline_id').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    color: text('color').notNull().default('#25D366'),
    isWon: boolean('is_won').notNull().default(false),
    isLost: boolean('is_lost').notNull().default(false),
    probability: smallint('probability').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_pipeline_stages_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_pipeline_stages_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_pipeline_stages_pipeline_id',
      columns: [t.orgId, t.pipelineId],
      foreignColumns: [pipelines.orgId, pipelines.id],
    }).onDelete('cascade'),
    index('idx_pipeline_stages_pipeline_id_sort_order').on(t.orgId, t.pipelineId, t.sortOrder),
    unique('uq_pipeline_stages_org_pipeline_id').on(t.orgId, t.pipelineId, t.id),
  ],
);

export type PipelineStagesRow = typeof pipelineStages.$inferSelect;
export type NewPipelineStagesRow = typeof pipelineStages.$inferInsert;

export const deals = pgTable(
  'deals',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    pipelineId: idColumn('pipeline_id').notNull(),
    stageId: idColumn('stage_id').notNull(),
    contactId: idColumn('contact_id'),
    companyId: idColumn('company_id'),
    conversationId: idColumn('conversation_id'),
    title: text('title').notNull(),
    valueMinor: bigint('value_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    ownerUserId: idColumn('owner_user_id'),
    ownerTeamId: idColumn('owner_team_id'),
    expectedCloseDate: date('expected_close_date'),
    status: text('status').notNull().default('open'),
    lostReason: text('lost_reason'),
    source: text('source').notNull().default('manual'),
    sortOrder: bigint('sort_order', { mode: 'number' }).notNull().default(0),
    lostReasonId: idColumn('lost_reason_id'),
    notes: text('notes'),
    meta: jsonb('meta'),
    wonAt: timestamp('won_at', { withTimezone: true }),
    lostAt: timestamp('lost_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_deals_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_deals_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_deals_pipeline_id',
      columns: [t.orgId, t.pipelineId],
      foreignColumns: [pipelines.orgId, pipelines.id],
    }).onDelete('no action'),
    // The stage must belong to the deal's own pipeline.
    foreignKey({
      name: 'fk_deals_stage_id',
      columns: [t.orgId, t.pipelineId, t.stageId],
      foreignColumns: [pipelineStages.orgId, pipelineStages.pipelineId, pipelineStages.id],
    }).onDelete('no action'),
    foreignKey({
      name: 'fk_deals_lost_reason_id',
      columns: [t.orgId, t.lostReasonId],
      foreignColumns: [dealLostReasons.orgId, dealLostReasons.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_deals_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_deals_company_id',
      columns: [t.orgId, t.companyId],
      foreignColumns: [companies.orgId, companies.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_deals_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_deals_owner_user_id',
      columns: [t.orgId, t.ownerUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_deals_company_id').on(t.orgId, t.companyId),
    index('idx_deals_contact_id').on(t.orgId, t.contactId),
    index('idx_deals_owner_user_id').on(t.orgId, t.ownerUserId),
    index('idx_deals_pipeline_id_stage_id').on(t.orgId, t.pipelineId, t.stageId),
    index('idx_deals_status').on(t.orgId, t.status),
    index('idx_deals_board').on(t.orgId, t.stageId, t.sortOrder, t.id),
    index('idx_deals_org_created').on(t.orgId, t.createdAt, t.id),
    // idx_deals_won_at / idx_deals_lost_at / idx_deals_open_currency (partial) and idx_deals_title_trgm (gin) live in the migrations.
  ],
);

export type DealsRow = typeof deals.$inferSelect;
export type NewDealsRow = typeof deals.$inferInsert;

export const dealActivities = pgTable(
  'deal_activities',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    dealId: idColumn('deal_id').notNull(),
    userId: idColumn('user_id'),
    assigneeUserId: idColumn('assignee_user_id'),
    type: text('type').notNull().default('note'),
    body: text('body'),
    meta: jsonb('meta'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_deal_activities_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_deal_activities_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_deal_activities_deal_id',
      columns: [t.orgId, t.dealId],
      foreignColumns: [deals.orgId, deals.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_deal_activities_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_deal_activities_deal_id_created_at').on(t.orgId, t.dealId, t.createdAt),
    index('idx_deal_activities_due_at').on(t.orgId, t.dueAt),
    index('idx_deal_activities_type').on(t.orgId, t.type),
    foreignKey({
      name: 'fk_deal_activities_assignee_user_id',
      columns: [t.orgId, t.assigneeUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_deal_activities_timeline').on(t.orgId, t.dealId, t.createdAt, t.id),
    // idx_deal_activities_task_sweep and idx_deal_activities_assignee are partial (tasks only) and live in the migration.
  ],
);

export type DealActivitiesRow = typeof dealActivities.$inferSelect;
export type NewDealActivitiesRow = typeof dealActivities.$inferInsert;

export const dealLostReasons = pgTable(
  'deal_lost_reasons',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_deal_lost_reasons_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_deal_lost_reasons_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_deal_lost_reasons_order').on(t.orgId, t.sortOrder, t.id),
  ],
);

export type DealLostReasonsRow = typeof dealLostReasons.$inferSelect;
export type NewDealLostReasonsRow = typeof dealLostReasons.$inferInsert;

export const dealSettings = pgTable(
  'deal_settings',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    lostReasonRequired: boolean('lost_reason_required').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_deal_settings_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_deal_settings_org_id').on(t.orgId),
    foreignKey({
      name: 'fk_deal_settings_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export type DealSettingsRow = typeof dealSettings.$inferSelect;
export type NewDealSettingsRow = typeof dealSettings.$inferInsert;
