/**
 * ai-copilot-lead-finder: tables ported from Reference. Mirrors migrations/20261001102100_aicrm_threadwise_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations, users } from '../foundation';

export const aiCrmActions = pgTable(
  'ai_crm_actions',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('ai_crm_actions_id_seq')`),
    orgId: orgIdColumn(),
    userId: idColumn('user_id'),
    channel: text('channel').notNull().default('dashboard'),
    tool: text('tool').notNull(),
    kind: text('kind').notNull().default('read'),
    status: text('status').notNull().default('ok'),
    params: jsonb('params'),
    resultSummary: text('result_summary'),
    provider: text('provider'),
    model: text('model'),
    tokens: integer('tokens').notNull().default(0),
    subjectType: text('subject_type'),
    subjectId: idColumn('subject_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_ai_crm_actions_tool').on(t.orgId, t.tool),
    index('idx_ai_crm_actions_user_id').on(t.orgId, t.userId),
    index('idx_ai_crm_actions_created_at').on(t.orgId, t.createdAt),
  ],
);

export type AiCrmActionsRow = typeof aiCrmActions.$inferSelect;
export type NewAiCrmActionsRow = typeof aiCrmActions.$inferInsert;

export const crmBriefs = pgTable(
  'crm_briefs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    createdBy: idColumn('created_by'),
    subjectType: text('subject_type').notNull(),
    subjectId: idColumn('subject_id').notNull(),
    title: text('title').notNull(),
    html: text('html').notNull(),
    summary: text('summary'),
    publicToken: text('public_token').notNull(),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_crm_briefs_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_crm_briefs_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_crm_briefs_public_token').on(t.publicToken),
    foreignKey({
      name: 'fk_crm_briefs_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_crm_briefs_subject_type_subject_id').on(t.orgId, t.subjectType, t.subjectId),
  ],
);

export type CrmBriefsRow = typeof crmBriefs.$inferSelect;
export type NewCrmBriefsRow = typeof crmBriefs.$inferInsert;

export const leads = pgTable(
  'leads',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    source: text('source').notNull().default('osm'),
    externalId: text('external_id'),
    name: text('name'),
    category: text('category'),
    phone: text('phone'),
    phoneE164: text('phone_e164'),
    email: text('email'),
    website: text('website'),
    address: text('address'),
    lat: numeric('lat', { precision: 10, scale: 7 }),
    lng: numeric('lng', { precision: 10, scale: 7 }),
    rating: numeric('rating', { precision: 3, scale: 2 }),
    inCrm: boolean('in_crm').notNull().default(false),
    contactId: idColumn('contact_id'),
    raw: jsonb('raw'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_leads_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_leads_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_leads_source_external_id').on(t.orgId, t.source, t.externalId),
    foreignKey({
      name: 'fk_leads_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_leads_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
  ],
);

export type LeadsRow = typeof leads.$inferSelect;
export type NewLeadsRow = typeof leads.$inferInsert;
