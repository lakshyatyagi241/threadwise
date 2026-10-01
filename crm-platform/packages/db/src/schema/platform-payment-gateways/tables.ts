/**
 * platform-payment-gateways: tables ported from Reference. Mirrors migrations/20261001104700_paygw_threadwise_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
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
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { coupons, creditPackages } from '../coupons-credits-referral-currency/tables';
import { companies, contacts } from '../crm';
import { deals } from '../deals-pipelines/tables';
import { organizations, users } from '../foundation';
import { invoices } from '../invoicing/tables';
import { packages } from '../plans-subscriptions-trials/tables';

export const payments = pgTable(
  'payments',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    invoiceId: idColumn('invoice_id'),
    dealId: idColumn('deal_id'),
    contactId: idColumn('contact_id'),
    companyId: idColumn('company_id'),
    waOrderId: idColumn('wa_order_id'),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('USD'),
    method: text('method').notNull().default('manual'),
    source: text('source').notNull().default('manual'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    reference: text('reference'),
    note: text('note'),
    gatewayPaymentId: text('gateway_payment_id'),
    recordedBy: idColumn('recorded_by'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_payments_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_payments_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_payments_source_gateway_payment_id').on(t.orgId, t.source, t.gatewayPaymentId),
    foreignKey({
      name: 'fk_payments_invoice_id',
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_payments_deal_id',
      columns: [t.orgId, t.dealId],
      foreignColumns: [deals.orgId, deals.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_payments_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_payments_company_id',
      columns: [t.orgId, t.companyId],
      foreignColumns: [companies.orgId, companies.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_payments_recorded_by',
      columns: [t.orgId, t.recordedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_payments_company_id').on(t.orgId, t.companyId),
    index('idx_payments_contact_id').on(t.orgId, t.contactId),
    index('idx_payments_deal_id').on(t.orgId, t.dealId),
    index('idx_payments_invoice_id').on(t.orgId, t.invoiceId),
    index('idx_payments_paid_at').on(t.orgId, t.paidAt),
    index('idx_payments_wa_order_id').on(t.orgId, t.waOrderId),
  ],
);

export type PaymentsRow = typeof payments.$inferSelect;
export type NewPaymentsRow = typeof payments.$inferInsert;

export const paymentGateways = pgTable(
  'payment_gateways',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(false),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    credentials: text('credentials'),
    mode: text('mode').notNull().default('sandbox'),
    extraConfig: jsonb('extra_config'),
    supportedCurrencies: jsonb('supported_currencies'),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_payment_gateways_slug').on(t.slug),
    index('idx_payment_gateways_is_active_sort_order').on(t.isActive, t.sortOrder),
  ],
);

export type PaymentGatewaysRow = typeof paymentGateways.$inferSelect;
export type NewPaymentGatewaysRow = typeof paymentGateways.$inferInsert;

export const orders = pgTable(
  'orders',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    orderNumber: text('order_number').notNull(),
    userId: idColumn('user_id'),
    packageId: idColumn('package_id'),
    billingPeriod: text('billing_period').notNull().default('monthly'),
    autoRenew: boolean('auto_renew').notNull().default(true),
    creditPackageId: idColumn('credit_package_id'),
    couponId: idColumn('coupon_id'),
    couponCode: text('coupon_code'),
    gatewayId: idColumn('gateway_id'),
    gatewaySlug: text('gateway_slug'),
    currency: text('currency').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    discountAmount: numeric('discount_amount', { precision: 12, scale: 4 })
      .notNull()
      .default('0.0000'),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0.00'),
    taxAmount: numeric('tax_amount', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    totalAmount: numeric('total_amount', { precision: 12, scale: 4 }).notNull().default('0.0000'),
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    billingCompany: text('billing_company'),
    billingAddress: text('billing_address'),
    billingCity: text('billing_city'),
    billingPostal: text('billing_postal'),
    billingCountry: text('billing_country'),
    billingTaxId: text('billing_tax_id'),
    baseAmountUsd: numeric('base_amount_usd', { precision: 12, scale: 2 }),
    exchangeRate: numeric('exchange_rate', { precision: 16, scale: 6 }),
    status: text('status').notNull().default('pending'),
    gatewayOrderId: text('gateway_order_id'),
    gatewayPaymentId: text('gateway_payment_id'),
    gatewayPayload: jsonb('gateway_payload'),
    failureReason: text('failure_reason'),
    paymentProofPath: text('payment_proof_path'),
    paymentReference: text('payment_reference'),
    proofNote: text('proof_note'),
    proofSubmittedAt: timestamp('proof_submitted_at', { withTimezone: true }),
    reviewedBy: idColumn('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_orders_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_orders_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_orders_order_number').on(t.orderNumber),
    foreignKey({
      name: 'fk_orders_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_orders_package_id',
      columns: [t.packageId],
      foreignColumns: [packages.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_orders_credit_package_id',
      columns: [t.creditPackageId],
      foreignColumns: [creditPackages.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_orders_coupon_id',
      columns: [t.couponId],
      foreignColumns: [coupons.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_orders_gateway_id',
      columns: [t.gatewayId],
      foreignColumns: [paymentGateways.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_orders_reviewed_by',
      columns: [t.orgId, t.reviewedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_orders_coupon_id').on(t.orgId, t.couponId),
    index('idx_orders_credit_package_id').on(t.orgId, t.creditPackageId),
    index('idx_orders_gateway_order_id').on(t.orgId, t.gatewayOrderId),
    index('idx_orders_package_id').on(t.orgId, t.packageId),
    index('idx_orders_status').on(t.orgId, t.status),
  ],
);

export type OrdersRow = typeof orders.$inferSelect;
export type NewOrdersRow = typeof orders.$inferInsert;
