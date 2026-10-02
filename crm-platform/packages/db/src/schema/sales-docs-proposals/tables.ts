/**
 * sales-docs-proposals: proposals and estimates (one engine). Mirrors migrations/20261001104500_sales_wadesk_schema.sql as reshaped
 * by 20261006100000_sales_docs_reshape.sql. The SQL migrations are the source of truth; `pnpm db:verify-schema` fails if this file
 * and the database disagree.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { companies, contacts } from '../crm';
import { deals } from '../deals-pipelines/tables';
import { organizations, users } from '../foundation';

export const salesDocs = pgTable(
  'sales_docs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    /** `proposal` | `estimate`; the wire calls it `kind`. */
    docType: text('doc_type').notNull(),
    number: text('number').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    /** draft | sent | viewed | accepted | declined | expired | converted */
    status: text('status').notNull().default('draft'),
    source: text('source').notNull().default('manual'),
    title: text('title'),
    contactId: idColumn('contact_id'),
    companyId: idColumn('company_id'),
    dealId: idColumn('deal_id'),
    /** Buyer fields and notes are encrypted at rest (AES-GCM through CryptoService). */
    buyerName: text('buyer_name'),
    buyerEmail: text('buyer_email'),
    buyerPhone: text('buyer_phone'),
    currency: text('currency').notNull().default('USD'),
    currencyExponent: smallint('currency_exponent').notNull().default(2),
    subtotalMinor: bigint('subtotal_minor', { mode: 'number' }).notNull().default(0),
    discountKind: text('discount_kind').notNull().default('none'),
    discountValue: bigint('discount_value', { mode: 'number' }).notNull().default(0),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull().default(0),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    /** The document's default tax rate in basis points: the rate of every line that names none. */
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    notes: text('notes'),
    terms: text('terms'),
    validUntil: date('valid_until'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    invoiceId: idColumn('invoice_id'),
    revision: integer('revision').notNull().default(1),
    acceptedRevision: integer('accepted_revision'),
    duplicatedFromId: idColumn('duplicated_from_id'),
    /** SHA-256 of the public token: the only thing the public lookup compares. */
    publicTokenHash: text('public_token_hash'),
    /** The token encrypted, so staff can copy the link again. */
    publicTokenCipher: text('public_token_cipher'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    tokenRevokedAt: timestamp('token_revoked_at', { withTimezone: true }),
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
    ownerId: idColumn('owner_id'),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_sales_docs_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_sales_docs_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_sales_docs_type_seq').on(t.orgId, t.docType, t.seq),
    unique('uq_sales_docs_number').on(t.orgId, t.number),
    unique('uq_sales_docs_token_hash').on(t.publicTokenHash),
    foreignKey({
      name: 'fk_sales_docs_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_sales_docs_company_id',
      columns: [t.orgId, t.companyId],
      foreignColumns: [companies.orgId, companies.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_sales_docs_deal_id',
      columns: [t.orgId, t.dealId],
      foreignColumns: [deals.orgId, deals.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_sales_docs_owner_id',
      columns: [t.orgId, t.ownerId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_sales_docs_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check('chk_sales_docs_type', sql`${t.docType} in ('proposal', 'estimate')`),
    check(
      'chk_sales_docs_status',
      sql`${t.status} in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'converted')`,
    ),
    check('chk_sales_docs_source', sql`${t.source} in ('manual', 'ai', 'api')`),
    check('chk_sales_docs_tax_rate', sql`${t.taxRateBp} between 0 and 10000`),
    check('chk_sales_docs_revision', sql`${t.revision} >= 1`),
    index('idx_sales_docs_company_id').on(t.orgId, t.companyId),
    index('idx_sales_docs_contact_id').on(t.orgId, t.contactId),
    index('idx_sales_docs_deal_id').on(t.orgId, t.dealId),
    index('idx_sales_docs_list').on(t.orgId, t.docType, t.createdAt, t.id),
    index('idx_sales_docs_status').on(t.orgId, t.status, t.docType),
    index('idx_sales_docs_owner').on(t.orgId, t.ownerId),
  ],
);

export type SalesDocsRow = typeof salesDocs.$inferSelect;
export type NewSalesDocsRow = typeof salesDocs.$inferInsert;

export const salesDocItems = pgTable(
  'sales_doc_items',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    docId: idColumn('doc_id').notNull(),
    position: integer('position').notNull(),
    description: text('description').notNull(),
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull(),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull(),
    discountKind: text('discount_kind').notNull().default('none'),
    discountValue: bigint('discount_value', { mode: 'number' }).notNull().default(0),
    /** Null: the line follows the document's default rate. */
    taxRateBp: integer('tax_rate_bp'),
    grossMinor: bigint('gross_minor', { mode: 'number' }).notNull().default(0),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
    netMinor: bigint('net_minor', { mode: 'number' }).notNull().default(0),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    foreignKey({
      name: 'fk_sales_doc_items_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_sales_doc_items_doc',
      columns: [t.orgId, t.docId],
      foreignColumns: [salesDocs.orgId, salesDocs.id],
    }).onDelete('cascade'),
    unique('uq_sales_doc_items_position').on(t.orgId, t.docId, t.position),
    check('chk_sales_doc_items_qty', sql`${t.qty} >= 0`),
    index('idx_sales_doc_items_doc').on(t.orgId, t.docId, t.position),
  ],
);

export type SalesDocItemsRow = typeof salesDocItems.$inferSelect;
export type NewSalesDocItemsRow = typeof salesDocItems.$inferInsert;

export const salesDocRevisions = pgTable(
  'sales_doc_revisions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    docId: idColumn('doc_id').notNull(),
    revision: integer('revision').notNull(),
    status: text('status').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull(),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_sales_doc_revisions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_sales_doc_revisions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_sales_doc_revisions_doc',
      columns: [t.orgId, t.docId],
      foreignColumns: [salesDocs.orgId, salesDocs.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_sales_doc_revisions_user',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    unique('uq_sales_doc_revisions').on(t.orgId, t.docId, t.revision),
  ],
);

export type SalesDocRevisionsRow = typeof salesDocRevisions.$inferSelect;

export const salesDocEvents = pgTable(
  'sales_doc_events',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    docId: idColumn('doc_id').notNull(),
    type: text('type').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorUserId: idColumn('actor_user_id'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    revision: integer('revision').notNull().default(1),
    channel: text('channel'),
    /** Buyer evidence, encrypted at rest. */
    signerName: text('signer_name'),
    signerEmail: text('signer_email'),
    signature: text('signature'),
    comment: text('comment'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_sales_doc_events_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_sales_doc_events_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_sales_doc_events_doc',
      columns: [t.orgId, t.docId],
      foreignColumns: [salesDocs.orgId, salesDocs.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_sales_doc_events_user',
      columns: [t.orgId, t.actorUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check('chk_sales_doc_events_actor', sql`${t.actorKind} in ('user', 'buyer', 'system')`),
    index('idx_sales_doc_events_doc').on(t.orgId, t.docId, t.createdAt, t.id),
  ],
);

export type SalesDocEventsRow = typeof salesDocEvents.$inferSelect;

export const salesDocCounters = pgTable(
  'sales_doc_counters',
  {
    orgId: orgIdColumn(),
    docType: text('doc_type').notNull(),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.docType] }),
    foreignKey({
      name: 'fk_sales_doc_counters_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_sales_doc_counters_type', sql`${t.docType} in ('proposal', 'estimate')`),
  ],
);

export const salesDocSettings = pgTable(
  'sales_doc_settings',
  {
    orgId: orgIdColumn(),
    proposalPrefix: text('proposal_prefix').notNull().default('PRO'),
    estimatePrefix: text('estimate_prefix').notNull().default('EST'),
    numberPadding: smallint('number_padding').notNull().default(4),
    proposalStart: bigint('proposal_start', { mode: 'number' }).notNull().default(1),
    estimateStart: bigint('estimate_start', { mode: 'number' }).notNull().default(1),
    defaultValidDays: integer('default_valid_days'),
    linkTtlDays: integer('link_ttl_days'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId] }),
    foreignKey({
      name: 'fk_sales_doc_settings_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export const salesDocTemplates = pgTable(
  'sales_doc_templates',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    docType: text('doc_type').notNull(),
    name: text('name').notNull(),
    terms: text('terms'),
    notes: text('notes'),
    validDays: integer('valid_days'),
    isDefault: boolean('is_default').notNull().default(false),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_sales_doc_templates_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_sales_doc_templates_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_sales_doc_templates_user',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check('chk_sales_doc_templates_type', sql`${t.docType} in ('proposal', 'estimate')`),
    uniqueIndex('uq_sales_doc_templates_default')
      .on(t.orgId, t.docType)
      .where(sql`${t.isDefault}`),
  ],
);

export type SalesDocTemplatesRow = typeof salesDocTemplates.$inferSelect;
