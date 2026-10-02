/**
 * invoicing: tables for invoices, lines, tax, numbering, settings, tax rates and online-payment attempts. Mirrors
 * migrations/20261001104600_inv_threadwise_schema.sql as reshaped by 20261007100000_inv_model_reshape.sql and
 * 20261007100100_inv_payment_ledger.sql. The SQL migrations are the source of truth; `pnpm db:verify-schema` fails if this file
 * and the database disagree.
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
  numeric,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { companies, contacts } from '../crm';
import { deals } from '../deals-pipelines/tables';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';
import { salesDocs } from '../sales-docs-proposals/tables';

export const taxRates = pgTable(
  'tax_rates',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    ratePercent: numeric('rate_percent', { precision: 7, scale: 4 }).notNull(),
    rateBp: integer('rate_bp').generatedAlwaysAs(sql`round(rate_percent * 100)::int`),
    inclusive: boolean('inclusive').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    description: text('description'),
    createdBy: idColumn('created_by'),
    taxType: text('tax_type').notNull().default('other'),
    country: text('country'),
    region: text('region'),
    components: jsonb('components'),
    effectiveFrom: date('effective_from'),
    effectiveTo: date('effective_to'),
    defaultHsnSac: text('default_hsn_sac'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_tax_rates_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_tax_rates_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_tax_rates_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

export type TaxRatesRow = typeof taxRates.$inferSelect;
export type NewTaxRatesRow = typeof taxRates.$inferInsert;

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
    series: text('series'),
    invoiceNumber: text('invoice_number'),
    seq: integer('seq'),
    status: text('status').notNull().default('draft'),
    sendStatus: text('send_status').notNull().default('pending'),
    sendAttempts: smallint('send_attempts').notNull().default(0),
    sendReason: text('send_reason'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    trigger: text('trigger').notNull().default('manual'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
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
    metaJson: jsonb('meta_json'),
    ownerId: idColumn('owner_id'),
    contactId: idColumn('contact_id'),
    companyId: idColumn('company_id'),
    dealId: idColumn('deal_id'),
    quoteId: idColumn('quote_id'),
    reference: text('reference'),
    terms: text('terms'),
    issueDate: date('issue_date'),
    dueDate: date('due_date'),
    paymentStatus: text('payment_status').notNull().default('unpaid'),
    paidMinor: bigint('paid_minor', { mode: 'number' }).notNull().default(0),
    refundedMinor: bigint('refunded_minor', { mode: 'number' }).notNull().default(0),
    taxAddedMinor: bigint('tax_added_minor', { mode: 'number' }).notNull().default(0),
    discountKind: text('discount_kind').notNull().default('none'),
    discountValue: bigint('discount_value', { mode: 'number' }).notNull().default(0),
    taxRegime: text('tax_regime').notNull().default('none'),
    buyerTaxId: text('buyer_tax_id'),
    buyerCountry: text('buyer_country'),
    placeOfSupply: text('place_of_supply'),
    reverseCharge: boolean('reverse_charge').notNull().default(false),
    legalNotes: text('legal_notes'),
    overdueAt: timestamp('overdue_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: idColumn('voided_by'),
    voidReason: text('void_reason'),
    publicTokenHash: text('public_token_hash'),
    publicTokenCipher: text('public_token_cipher'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    tokenRevokedAt: timestamp('token_revoked_at', { withTimezone: true }),
    firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
    lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
    creditedMinor: bigint('credited_minor', { mode: 'number' }).notNull().default(0),
    recurringId: idColumn('recurring_id'),
    salesOrderId: idColumn('sales_order_id'),
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
    unique('uq_invoices_token_hash').on(t.publicTokenHash),
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
    foreignKey({
      name: 'fk_invoices_owner_id',
      columns: [t.orgId, t.ownerId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_invoices_voided_by',
      columns: [t.orgId, t.voidedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_invoices_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_invoices_company_id',
      columns: [t.orgId, t.companyId],
      foreignColumns: [companies.orgId, companies.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_invoices_deal_id',
      columns: [t.orgId, t.dealId],
      foreignColumns: [deals.orgId, deals.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_invoices_quote_id',
      columns: [t.orgId, t.quoteId],
      foreignColumns: [salesDocs.orgId, salesDocs.id],
    }).onDelete('set null'),
    index('idx_invoices_doc_type').on(t.orgId, t.docType),
    index('idx_invoices_status').on(t.orgId, t.status),
    index('idx_invoices_wa_order_id').on(t.orgId, t.waOrderId),
    index('idx_invoices_issued_at').on(t.orgId, t.issuedAt),
    index('idx_invoices_list').on(t.orgId, t.createdAt, t.id),
    index('idx_invoices_owner').on(t.orgId, t.ownerId),
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
    qty: numeric('qty', { precision: 18, scale: 4 }).notNull().default('1'),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull().default(0),
    lineSubtotalMinor: bigint('line_subtotal_minor', { mode: 'number' }).notNull().default(0),
    lineDiscountMinor: bigint('line_discount_minor', { mode: 'number' }).notNull().default(0),
    taxAmountMinor: bigint('tax_amount_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    metaJson: jsonb('meta_json'),
    taxRateId: idColumn('tax_rate_id'),
    taxName: text('tax_name'),
    taxRatePercent: numeric('tax_rate_percent', { precision: 7, scale: 4 }).notNull().default('0'),
    taxRateBp: integer('tax_rate_bp').generatedAlwaysAs(sql`round(tax_rate_percent * 100)::int`),
    taxInclusive: boolean('tax_inclusive').notNull().default(false),
    discountKind: text('discount_kind').notNull().default('none'),
    discountValue: bigint('discount_value', { mode: 'number' }).notNull().default(0),
    docDiscountShareMinor: bigint('doc_discount_share_minor', { mode: 'number' })
      .notNull()
      .default(0),
    lineTotalMinor: bigint('line_total_minor', { mode: 'number' }).notNull().default(0),
    taxType: text('tax_type'),
    taxComponents: jsonb('tax_components'),
    salesOrderItemId: idColumn('sales_order_item_id'),
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
    foreignKey({
      name: 'fk_invoice_items_tax_rate_id',
      columns: [t.orgId, t.taxRateId],
      foreignColumns: [taxRates.orgId, taxRates.id],
    }).onDelete('set null'),
    index('idx_invoice_items_invoice_id').on(t.orgId, t.invoiceId),
    unique('uq_invoice_items_sort').on(t.orgId, t.invoiceId, t.sort),
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
    actorKind: text('actor_kind').notNull().default('system'),
    actorUserId: idColumn('actor_user_id'),
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
    receiptPrefix: text('receipt_prefix').notNull().default('RCT'),
    fyStartMonth: smallint('fy_start_month').notNull().default(1),
    numberPadding: smallint('number_padding').notNull().default(6),
    paymentInstructions: text('payment_instructions'),
    terms: text('terms'),
    overdueReminders: boolean('overdue_reminders').notNull().default(true),
    sellerCountry: text('seller_country'),
    sellerState: text('seller_state'),
    defaultTaxRegime: text('default_tax_regime').notNull().default('none'),
    bankDetails: jsonb('bank_details'),
    numberFormat: text('number_format').notNull().default('{PREFIX}-{YEAR}-{SEQ}'),
    invoiceTitle: text('invoice_title'),
    creditNotePrefix: text('credit_note_prefix').notNull().default('CRN'),
    salesOrderPrefix: text('sales_order_prefix').notNull().default('SO'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_invoice_settings_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_invoice_settings_org').on(t.orgId),
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
    baseMinor: bigint('base_minor', { mode: 'number' }).notNull().default(0),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull().default(0),
    ratePercent: numeric('rate_percent', { precision: 7, scale: 4 }).notNull().default('0'),
    rateBp: integer('rate_bp').generatedAlwaysAs(sql`round(rate_percent * 100)::int`),
    inclusive: boolean('inclusive').notNull().default(false),
    taxType: text('tax_type'),
    taxComponents: jsonb('tax_components'),
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
    unique('uq_invoice_tax_summary_row').on(
      t.orgId,
      t.invoiceId,
      t.taxLabel,
      t.ratePercent,
      t.inclusive,
    ),
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

export const invoiceGatewayConnections = pgTable(
  'invoice_gateway_connections',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    provider: text('provider').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    mode: text('mode').notNull().default('test'),
    webhookSecretCipher: text('webhook_secret_cipher'),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_invoice_gateway_connections_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_invoice_gateway_connections_provider').on(t.orgId, t.provider),
    unique('uq_invoice_gateway_connections_endpoint').on(t.uuid),
    foreignKey({
      name: 'fk_invoice_gateway_connections_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_invoice_gateway_connections_user',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

export type InvoiceGatewayConnectionsRow = typeof invoiceGatewayConnections.$inferSelect;

export const invoicePaymentAttempts = pgTable(
  'invoice_payment_attempts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    invoiceId: idColumn('invoice_id').notNull(),
    connectionId: idColumn('connection_id'),
    provider: text('provider').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('pending'),
    externalId: text('external_id'),
    checkoutUrl: text('checkout_url'),
    paymentId: idColumn('payment_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_invoice_payment_attempts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_invoice_payment_attempts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_invoice_payment_attempts_invoice',
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_invoice_payment_attempts_connection',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [invoiceGatewayConnections.orgId, invoiceGatewayConnections.id],
    }).onDelete('set null'),
    index('idx_invoice_payment_attempts_invoice').on(t.orgId, t.invoiceId),
  ],
);

export type InvoicePaymentAttemptsRow = typeof invoicePaymentAttempts.$inferSelect;

export const invoiceGatewayEvents = pgTable(
  'invoice_gateway_events',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    connectionId: idColumn('connection_id').notNull(),
    eventId: text('event_id').notNull(),
    eventType: text('event_type').notNull(),
    outcome: text('outcome').notNull(),
    attemptId: idColumn('attempt_id'),
    detail: text('detail'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    foreignKey({
      name: 'fk_invoice_gateway_events_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_invoice_gateway_events_connection',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [invoiceGatewayConnections.orgId, invoiceGatewayConnections.id],
    }).onDelete('cascade'),
    unique('uq_invoice_gateway_events').on(t.orgId, t.connectionId, t.eventId),
  ],
);

export type InvoiceGatewayEventsRow = typeof invoiceGatewayEvents.$inferSelect;
