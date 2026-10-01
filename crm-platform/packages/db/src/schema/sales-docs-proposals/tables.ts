/**
 * sales-docs-proposals: tables ported from WaDesk. Mirrors migrations/20261001104500_sales_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
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
    docType: text('doc_type').notNull().default('proposal'),
    number: text('number'),
    seq: bigint('seq', { mode: 'number' }).notNull().default(0),
    status: text('status').notNull().default('draft'),
    title: text('title'),
    contactId: idColumn('contact_id'),
    companyId: idColumn('company_id'),
    dealId: idColumn('deal_id'),
    buyerName: text('buyer_name'),
    buyerEmail: text('buyer_email'),
    buyerPhone: text('buyer_phone'),
    currency: text('currency').notNull().default('USD'),
    currencyExponent: smallint('currency_exponent').notNull().default(2),
    subtotalMinor: bigint('subtotal_minor', { mode: 'number' }).notNull().default(0),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull().default(0),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    itemsJson: jsonb('items_json'),
    notes: text('notes'),
    validUntil: date('valid_until'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    invoiceId: idColumn('invoice_id'),
    publicToken: text('public_token'),
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
    unique('uq_sales_docs_public_token').on(t.publicToken),
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
    index('idx_sales_docs_company_id').on(t.orgId, t.companyId),
    index('idx_sales_docs_contact_id').on(t.orgId, t.contactId),
    index('idx_sales_docs_deal_id').on(t.orgId, t.dealId),
    index('idx_sales_docs_doc_type_status').on(t.orgId, t.docType, t.status),
  ],
);

export type SalesDocsRow = typeof salesDocs.$inferSelect;
export type NewSalesDocsRow = typeof salesDocs.$inferInsert;
