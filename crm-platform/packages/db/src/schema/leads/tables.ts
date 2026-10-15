/**
 * leads: the lead pipeline's tables. Mirrors migrations/20261020090000_lead_sources.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
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
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { deals } from '../deals-pipelines/tables';
import { organizations, users } from '../foundation';

export const leadSources = pgTable(
  'lead_sources',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    kind: text('kind').notNull().default('webhook'),
    providerKey: text('provider_key'),
    externalRef: text('external_ref'),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    /** SHA-256 of the URL token. The token itself is shown once and never stored. */
    tokenHash: text('token_hash'),
    tokenHint: text('token_hint'),
    tokenRotatedAt: timestamp('token_rotated_at', { withTimezone: true }),
    /** AES-GCM ciphertext (credentials key); never plain text. */
    secretEnc: text('secret_enc'),
    externalIdPath: text('external_id_path'),
    fieldMapping: jsonb('field_mapping').$type<Record<string, unknown>>().notNull().default({}),
    defaults: jsonb('defaults').$type<Record<string, unknown>>().notNull().default({}),
    rawRetentionDays: integer('raw_retention_days').notNull().default(30),
    rrCursor: bigint('rr_cursor', { mode: 'number' }).notNull().default(0),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_lead_sources_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_lead_sources_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_lead_sources_kind',
      sql`${t.kind} in ('webhook', 'meta_lead_ads', 'tiktok', 'linkedin', 'google_ads', 'connector')`,
    ),
    check('chk_lead_sources_status', sql`${t.status} in ('active', 'paused')`),
    check(
      'chk_lead_sources_webhook_token',
      sql`${t.kind} <> 'webhook' or ${t.tokenHash} is not null`,
    ),
    check('chk_lead_sources_retention', sql`${t.rawRetentionDays} between 1 and 365`),
    check('chk_lead_sources_mapping', sql`jsonb_typeof(${t.fieldMapping}) = 'object'`),
    check('chk_lead_sources_defaults', sql`jsonb_typeof(${t.defaults}) = 'object'`),
    foreignKey({
      name: 'fk_lead_sources_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    // `uq_lead_sources_name` (a unique index on lower(name)) is an expression index: the SQL migration is its only declaration.
    uniqueIndex('uq_lead_sources_token_hash')
      .on(t.tokenHash)
      .where(sql`${t.tokenHash} is not null`),
    index('idx_lead_sources_created_by').on(t.orgId, t.createdBy),
    index('idx_lead_sources_external_ref')
      .on(t.orgId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
  ],
);

export type LeadSourcesRow = typeof leadSources.$inferSelect;
export type NewLeadSourcesRow = typeof leadSources.$inferInsert;

export const leadEvents = pgTable(
  'lead_events',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    sourceId: idColumn('source_id').notNull(),
    externalId: text('external_id').notNull(),
    status: text('status').notNull().default('received'),
    isTest: boolean('is_test').notNull().default(false),
    reason: text('reason'),
    error: text('error'),
    contactId: idColumn('contact_id'),
    dealId: idColumn('deal_id'),
    /** The normalised lead as received. Personal data: null once the retention sweep has purged it. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    payloadExpiresAt: timestamp('payload_expires_at', { withTimezone: true }),
    payloadPurgedAt: timestamp('payload_purged_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(1),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    lastDuplicateAt: timestamp('last_duplicate_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_lead_events_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_lead_events_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_lead_events_idempotency').on(t.orgId, t.sourceId, t.externalId),
    check(
      'chk_lead_events_status',
      sql`${t.status} in ('received', 'created', 'updated', 'duplicate', 'needs_review', 'failed')`,
    ),
    check('chk_lead_events_external_id', sql`length(${t.externalId}) between 1 and 255`),
    foreignKey({
      name: 'fk_lead_events_source',
      columns: [t.orgId, t.sourceId],
      foreignColumns: [leadSources.orgId, leadSources.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_lead_events_contact',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_lead_events_deal',
      columns: [t.orgId, t.dealId],
      foreignColumns: [deals.orgId, deals.id],
    }).onDelete('set null'),
    index('idx_lead_events_source_recent').on(t.orgId, t.sourceId, t.createdAt.desc(), t.id.desc()),
    index('idx_lead_events_source_status').on(
      t.orgId,
      t.sourceId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('idx_lead_events_contact')
      .on(t.orgId, t.contactId)
      .where(sql`${t.contactId} is not null`),
    index('idx_lead_events_deal')
      .on(t.orgId, t.dealId)
      .where(sql`${t.dealId} is not null`),
    index('idx_lead_events_payload_expiry')
      .on(t.payloadExpiresAt)
      .where(sql`${t.payload} is not null`),
  ],
);

export type LeadEventsRow = typeof leadEvents.$inferSelect;
export type NewLeadEventsRow = typeof leadEvents.$inferInsert;

export const contactAttributions = pgTable(
  'contact_attributions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    contactId: idColumn('contact_id').notNull(),
    leadEventId: idColumn('lead_event_id'),
    sourceId: idColumn('source_id'),
    platform: text('platform'),
    sourceLabel: text('source_label').notNull(),
    campaign: text('campaign'),
    adset: text('adset'),
    ad: text('ad'),
    form: text('form'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    // Click-to-WhatsApp referral fields and the provider message behind the touch (migration 20261205090100).
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    externalRef: text('external_ref'),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_contact_attributions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_contact_attributions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_contact_attributions_contact',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_contact_attributions_lead_event',
      columns: [t.orgId, t.leadEventId],
      foreignColumns: [leadEvents.orgId, leadEvents.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_contact_attributions_source',
      columns: [t.orgId, t.sourceId],
      foreignColumns: [leadSources.orgId, leadSources.id],
    }).onDelete('set null'),
    uniqueIndex('uq_contact_attributions_lead_event')
      .on(t.orgId, t.leadEventId)
      .where(sql`${t.leadEventId} is not null`),
    check(
      'ck_contact_attributions_evidence',
      sql`jsonb_typeof(${t.evidence}) = 'object' and pg_column_size(${t.evidence}) <= 4096`,
    ),
    check(
      'ck_contact_attributions_ref',
      sql`${t.externalRef} is null or char_length(${t.externalRef}) between 1 and 200`,
    ),
    uniqueIndex('uq_contact_attributions_ref')
      .on(t.orgId, t.externalRef)
      .where(sql`${t.externalRef} is not null`),
    index('idx_contact_attributions_contact').on(t.orgId, t.contactId, t.capturedAt, t.id),
    index('idx_contact_attributions_platform').on(t.orgId, t.platform, t.capturedAt.desc()),
    index('idx_contact_attributions_source')
      .on(t.orgId, t.sourceId)
      .where(sql`${t.sourceId} is not null`),
  ],
);

export type ContactAttributionsRow = typeof contactAttributions.$inferSelect;
export type NewContactAttributionsRow = typeof contactAttributions.$inferInsert;
