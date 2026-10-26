/**
 * meta-lead-ads: Meta lead ads as a door into the lead pipeline. Mirrors migrations/20261219090000_mla_meta_lead_ads.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { leadSources } from '../leads';

/** Per connected Facebook Page: lead sync on or off and its health. `page_id` is Meta's id; no foreign key (see the migration). */
export const metaLeadPages = pgTable(
  'meta_lead_pages',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    pageId: text('page_id').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    subscribedAt: timestamp('subscribed_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    lastLeadAt: timestamp('last_lead_at', { withTimezone: true }),
    lastSweepAt: timestamp('last_sweep_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastErrorKind: text('last_error_kind'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_meta_lead_pages_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_meta_lead_pages_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_meta_lead_pages_page').on(t.orgId, t.pageId),
    check(
      'chk_meta_lead_pages_error_kind',
      sql`${t.lastErrorKind} is null or ${t.lastErrorKind} in ('token', 'permission', 'other')`,
    ),
    foreignKey({
      name: 'fk_meta_lead_pages_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_meta_lead_pages_created_by').on(t.orgId, t.createdBy),
    index('idx_meta_lead_pages_enabled')
      .on(t.orgId, t.id)
      .where(sql`${t.enabled}`),
  ],
);
export type MetaLeadPagesRow = typeof metaLeadPages.$inferSelect;
export type NewMetaLeadPagesRow = typeof metaLeadPages.$inferInsert;

/** One row per lead form the workspace picked. Each feeds one lead source of kind `meta_lead_ads`. */
export const metaLeadForms = pgTable(
  'meta_lead_forms',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    pageId: text('page_id').notNull(),
    formId: text('form_id').notNull(),
    name: text('name').notNull(),
    status: text('status'),
    locale: text('locale'),
    questions: jsonb('questions').$type<unknown[]>().notNull().default([]),
    consentCheckboxes: jsonb('consent_checkboxes').$type<unknown[]>().notNull().default([]),
    privacyPolicyUrl: text('privacy_policy_url'),
    sourceId: idColumn('source_id').notNull(),
    connectedBy: idColumn('connected_by'),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastLeadAt: timestamp('last_lead_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    sweepCheckpointAt: timestamp('sweep_checkpoint_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSweepAt: timestamp('last_sweep_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_meta_lead_forms_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_meta_lead_forms_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_meta_lead_forms_form').on(t.orgId, t.pageId, t.formId),
    unique('uq_meta_lead_forms_source').on(t.orgId, t.sourceId),
    check('chk_meta_lead_forms_questions', sql`jsonb_typeof(${t.questions}) = 'array'`),
    check('chk_meta_lead_forms_consent', sql`jsonb_typeof(${t.consentCheckboxes}) = 'array'`),
    foreignKey({
      name: 'fk_meta_lead_forms_source',
      columns: [t.orgId, t.sourceId],
      foreignColumns: [leadSources.orgId, leadSources.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_meta_lead_forms_connected_by',
      columns: [t.orgId, t.connectedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_meta_lead_forms_connected_by').on(t.orgId, t.connectedBy),
  ],
);
export type MetaLeadFormsRow = typeof metaLeadForms.$inferSelect;
export type NewMetaLeadFormsRow = typeof metaLeadForms.$inferInsert;
