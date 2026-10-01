/**
 * invoicing: tables ported from Reference. Mirrors migrations/20261001104600_inv_threadwise_schema.sql.
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
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';

export const invoices = pgTable(
  'invoices',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    source: text('source').notNull(),
    docType: text('doc_type').notNull().default('tax_invoice'),
    waOrderId: idColumn('wa_order_id'),
    externalOrderId: text('external_order_id'),
    externalOrderNumber: text('external_order_number'),
    series: text('series').notNull(),
    invoiceNumber: text('invoice_number').notNull(),
    seq: integer('seq').notNull(),
    status: text('status').notNull().default('issued'),
    sendStatus: text('send_status').notNull().default('pending'),
    sendAttempts: smallint('send_attempts').notNull().default(0),
    sendReason: text('send_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    trigger: text('trigger').notNull().default('manual'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    currency: text('currency').notNull().default('USD'),
    currencyExponent: smallint('currency_exponent').notNull().default(2),
    subtotalMinor: bigint('subtotal_minor', { mode: 'number' }).notNull().default(0),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
    shippingMinor: bigint('shipping_minor', { mode: 'number' }).notNull().default(0),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull().default(0),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    taxInclusive: boolean('tax_inclusive').notNull().default(false),
    buyerName: text('buyer_name'),
    buyerEmail: text('buyer_email'),
    buyerPhone: text('buyer_phone'),
    billingJson: jsonb('billing_json'),
    shippingJson: jsonb('shipping_json'),
    sellerSnapshotJson: jsonb('seller_snapshot_json'),
    notes: text('notes'),
    pdfDisk: text('pdf_disk'),
    pdfPath: text('pdf_path'),
    pdfSha256: text('pdf_sha256'),
    pdfBytes: bigint('pdf_bytes', { mode: 'number' }),
    deliveryChannel: text('delivery_channel'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    waMessageId: text('wa_message_id'),
    sendError: text('send_error'),
    publicToken: text('public_token').notNull(),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_invoices_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_invoices_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_invoices_public_token').on(t.publicToken),
    unique('uq_invoices_source_external_order_id_doc_type').on(
      t.orgId,
      t.source,
      t.externalOrderId,
      t.docType,
    ),
    unique('uq_invoices_invoice_number').on(t.orgId, t.invoiceNumber),
    unique('uq_invoices_series_seq').on(t.orgId, t.series, t.seq),
    foreignKey({
      name: 'fk_invoices_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_invoices_doc_type').on(t.orgId, t.docType),
    index('idx_invoices_send_status').on(t.orgId, t.sendStatus),
    index('idx_invoices_status').on(t.orgId, t.status),
    index('idx_invoices_wa_order_id').on(t.orgId, t.waOrderId),
    index('idx_invoices_issued_at').on(t.orgId, t.issuedAt),
  ],
);

export type InvoicesRow = typeof invoices.$inferSelect;
export type NewInvoicesRow = typeof invoices.$inferInsert;

export const invoiceItems = pgTable(
  'invoice_items',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    invoiceId: idColumn('invoice_id').notNull(),
    sort: smallint('sort').notNull().default(0),
    description: text('description').notNull(),
    sku: text('sku'),
    hsnSac: text('hsn_sac'),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull().default('1.000'),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull().default(0),
    lineSubtotalMinor: bigint('line_subtotal_minor', { mode: 'number' }).notNull().default(0),
    lineDiscountMinor: bigint('line_discount_minor', { mode: 'number' }).notNull().default(0),
    taxRate: numeric('tax_rate', { precision: 6, scale: 3 }),
    taxAmountMinor: bigint('tax_amount_minor', { mode: 'number' }).notNull().default(0),
    taxCode: text('tax_code'),
    currency: text('currency').notNull().default('USD'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_invoice_items_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_invoice_items_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_invoice_items_invoice_id',
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }).onDelete('cascade'),
    index('idx_invoice_items_invoice_id').on(t.orgId, t.invoiceId),
  ],
);

export type InvoiceItemsRow = typeof invoiceItems.$inferSelect;
export type NewInvoiceItemsRow = typeof invoiceItems.$inferInsert;

export const invoiceLogs = pgTable(
  'invoice_logs',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('invoice_logs_id_seq')`),
    orgId: orgIdColumn(),
    invoiceId: idColumn('invoice_id').notNull(),
    event: text('event').notNull(),
    detail: text('detail'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_invoice_logs_invoice_id').on(t.orgId, t.invoiceId),
  ],
);

export type InvoiceLogsRow = typeof invoiceLogs.$inferSelect;
export type NewInvoiceLogsRow = typeof invoiceLogs.$inferInsert;

export const invoiceNumberSequences = pgTable(
  'invoice_number_sequences',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    series: text('series').notNull(),
    nextSeq: integer('next_seq').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_invoice_number_sequences_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_invoice_number_sequences_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_invoice_number_sequences_series').on(t.orgId, t.series),
  ],
);

export type InvoiceNumberSequencesRow = typeof invoiceNumberSequences.$inferSelect;
export type NewInvoiceNumberSequencesRow = typeof invoiceNumberSequences.$inferInsert;

export const invoiceSettings = pgTable(
  'invoice_settings',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    enabled: boolean('enabled').notNull().default(false),
    numberingPrefix: text('numbering_prefix').notNull().default('INV'),
    proformaPrefix: text('proforma_prefix').notNull().default('PRO'),
    fyReset: boolean('fy_reset').notNull().default(true),
    taxLabel: text('tax_label'),
    defaultTaxRate: numeric('default_tax_rate', { precision: 6, scale: 3 }),
    taxInclusiveDefault: boolean('tax_inclusive_default').notNull().default(false),
    hsnDefault: text('hsn_default'),
    logoPath: text('logo_path'),
    brandColor: text('brand_color'),
    footerNote: text('footer_note'),
    supportEmail: text('support_email'),
    autoSendWoocommerce: boolean('auto_send_woocommerce').notNull().default(false),
    autoSendShopify: boolean('auto_send_shopify').notNull().default(false),
    autoSendOwn: boolean('auto_send_own').notNull().default(false),
    triggerWoocommerce: text('trigger_woocommerce').notNull().default('on_paid'),
    triggerShopify: text('trigger_shopify').notNull().default('on_paid'),
    triggerOwn: text('trigger_own').notNull().default('on_paid'),
    sendSender: text('send_sender'),
    templateIdWhatsapp: idColumn('template_id_whatsapp'),
    templateStatus: text('template_status').notNull().default('none'),
    metaJson: jsonb('meta_json'),
    sellerName: text('seller_name'),
    sellerAddress: text('seller_address'),
    sellerTaxId: text('seller_tax_id'),
    sellerRegNo: text('seller_reg_no'),
    sellerPhone: text('seller_phone'),
    sellerExtraJson: jsonb('seller_extra_json'),
    signaturePath: text('signature_path'),
    signatureLabel: text('signature_label'),
    showSignature: boolean('show_signature').notNull().default(false),
    dueDays: smallint('due_days'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_invoice_settings_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_invoice_settings_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_invoice_settings_template_id_whatsapp',
      columns: [t.orgId, t.templateIdWhatsapp],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
  ],
);

export type InvoiceSettingsRow = typeof invoiceSettings.$inferSelect;
export type NewInvoiceSettingsRow = typeof invoiceSettings.$inferInsert;

export const invoiceTaxSummary = pgTable(
  'invoice_tax_summary',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    invoiceId: idColumn('invoice_id').notNull(),
    taxLabel: text('tax_label').notNull(),
    rate: numeric('rate', { precision: 6, scale: 3 }),
    baseMinor: bigint('base_minor', { mode: 'number' }).notNull().default(0),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_invoice_tax_summary_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_invoice_tax_summary_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_invoice_tax_summary_invoice_id',
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }).onDelete('cascade'),
    index('idx_invoice_tax_summary_invoice_id').on(t.orgId, t.invoiceId),
  ],
);

export type InvoiceTaxSummaryRow = typeof invoiceTaxSummary.$inferSelect;
export type NewInvoiceTaxSummaryRow = typeof invoiceTaxSummary.$inferInsert;

export const invoiceWebhookEvents = pgTable(
  'invoice_webhook_events',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    source: text('source').notNull(),
    deliveryId: text('delivery_id').notNull(),
    topic: text('topic'),
    externalOrderId: text('external_order_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [unique('uq_invoice_webhook_events_source_delivery_id').on(t.source, t.deliveryId)],
);

export type InvoiceWebhookEventsRow = typeof invoiceWebhookEvents.$inferSelect;
export type NewInvoiceWebhookEventsRow = typeof invoiceWebhookEvents.$inferInsert;
