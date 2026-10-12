/**
 * lead-scoring: AI lead scoring for contacts. Mirrors migrations/20261120090000_lsc_lead_scoring.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';

export const leadScoringSettings = pgTable(
  'lead_scoring_settings',
  {
    orgId: orgIdColumn(),
    enabled: boolean('enabled').notNull().default(false),
    autoScore: boolean('auto_score').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId] }),
    foreignKey({
      name: 'lead_scoring_settings_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export type LeadScoringSettingsRow = typeof leadScoringSettings.$inferSelect;

export const leadScoringRuns = pgTable(
  'lead_scoring_runs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    contactId: idColumn('contact_id'),
    contactName: text('contact_name'),
    status: text('status').notNull(),
    trigger: text('trigger').notNull(),
    score: smallint('score'),
    previousScore: smallint('previous_score'),
    reasons: jsonb('reasons').$type<string[] | null>(),
    model: text('model'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 8 }).notNull().default('0'),
    costSource: text('cost_source').notNull().default('none'),
    billedAgainst: text('billed_against').notNull().default('admin'),
    durationMs: integer('duration_ms'),
    error: text('error'),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('lead_scoring_runs_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'lead_scoring_runs_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_lead_scoring_runs_created').on(t.orgId, t.createdAt.desc()),
    index('idx_lead_scoring_runs_contact')
      .on(t.orgId, t.contactId, t.createdAt.desc())
      .where(sql`${t.contactId} is not null`),
    index('idx_lead_scoring_runs_time').on(t.createdAt),
    check('ck_lead_scoring_runs_status', sql`${t.status} in ('ok', 'kept', 'failed', 'skipped')`),
    check(
      'ck_lead_scoring_runs_trigger',
      sql`${t.trigger} in ('created', 'updated', 'manual', 'backfill')`,
    ),
    check('ck_lead_scoring_runs_score', sql`${t.score} is null or ${t.score} between 0 and 100`),
    check('ck_lead_scoring_runs_billed', sql`${t.billedAgainst} in ('admin', 'workspace', 'none')`),
    check(
      'ck_lead_scoring_runs_cost_source',
      sql`${t.costSource} in ('vendor', 'estimate', 'none')`,
    ),
  ],
);

export type LeadScoringRunRow = typeof leadScoringRuns.$inferSelect;
export type NewLeadScoringRunRow = typeof leadScoringRuns.$inferInsert;
