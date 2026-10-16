/**
 * platform-payment-gateways: tables ported from Reference. Mirrors migrations/20261001104700_paygw_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
  customType,
  integer,
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
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { coupons, creditPackages } from '../coupons-credits-referral-currency/tables';
import { companies, contacts } from '../crm';
import { deals } from '../deals-pipelines/tables';
import { organizations, users } from '../foundation';
import { invoices } from '../invoicing/tables';
import { subscriptions } from '../plans-subscriptions-trials/tables';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

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
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
    reference: text('reference'),
    note: text('note'),
    gatewayPaymentId: text('gateway_payment_id'),
    recordedBy: idColumn('recorded_by'),
    kind: text('kind').notNull().default('payment'),
    refundOfId: idColumn('refund_of_id'),
    receiptNumber: text('receipt_number'),
    attemptId: idColumn('attempt_id'),
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
    unique('uq_payments_receipt').on(t.orgId, t.receiptNumber),
    index('idx_payments_refund_of').on(t.orgId, t.refundOfId),
    index('idx_payments_list').on(t.orgId, t.paidAt, t.id),
    index('idx_payments_created').on(t.orgId, t.createdAt, t.id),
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

/** A provider plan already created for this account, price and interval, so a checkout reuses it (platform-level, no tenant). */
export const gatewayPlanCache = pgTable(
  'gateway_plan_cache',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    gateway: text('gateway').notNull(),
    accountHash: text('account_hash').notNull(),
    currency: text('currency').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    intervalUnit: text('interval_unit').notNull(),
    intervalCount: integer('interval_count').notNull(),
    gatewayPlanId: text('gateway_plan_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('uq_gateway_plan_cache').on(
      t.gateway,
      t.accountHash,
      t.currency,
      t.amountMinor,
      t.intervalUnit,
      t.intervalCount,
    ),
  ],
);

export const orders = pgTable(
  'orders',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    orderNumber: text('order_number').notNull(),
    userId: idColumn('user_id'),
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
    // 20261005100000_paygw_core.sql
    kind: text('kind').notNull().default('plan'),
    planSlug: text('plan_slug'),
    returnToken: text('return_token').notNull(),
    walletTopupMinor: bigint('wallet_topup_minor', { mode: 'number' }),
    /** The wallet a top-up credits, fixed when the order is placed; null = the platform currency (older orders). */
    walletUnit: text('wallet_unit'),
    idempotencyKey: text('idempotency_key'),
    // 20261017090000_paygw_admin_billing.sql: the line printed on a manual invoice.
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_orders_return_token').on(t.returnToken),
    unique('uq_orders_idempotency_key').on(t.orgId, t.idempotencyKey),
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
    index('idx_orders_status').on(t.orgId, t.status),
    // 20261017090000_paygw_admin_billing.sql
    index('idx_orders_created_all').on(t.createdAt.desc(), t.id.desc()),
    index('idx_orders_paid_at_paid')
      .on(t.paidAt)
      .where(sql`status = 'paid'`),
    index('idx_orders_proof_queue')
      .on(t.proofSubmittedAt.desc())
      .where(sql`proof_submitted_at IS NOT NULL AND status IN ('pending', 'awaiting_approval')`),
  ],
);

export type OrdersRow = typeof orders.$inferSelect;
export type NewOrdersRow = typeof orders.$inferInsert;

/** 20261018090000_paygw_proof_and_subscriptions.sql: the bytes of an offline-payment proof, one per order. */
export const orderProofBlobs = pgTable(
  'order_proof_blobs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    orderId: idColumn('order_id').notNull(),
    mime: text('mime').notNull(),
    byteSize: integer('byte_size').notNull(),
    bytes: bytea('bytes').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_order_proof_blobs_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_order_proof_blobs_order_id').on(t.orgId, t.orderId),
    foreignKey({
      name: 'fk_order_proof_blobs_order_id',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }).onDelete('cascade'),
  ],
);

export type OrderProofBlobsRow = typeof orderProofBlobs.$inferSelect;
export type NewOrderProofBlobsRow = typeof orderProofBlobs.$inferInsert;

/** A refund through the payment provider (migrations/20261118090000_paygw_refunds.sql). Written `pending` BEFORE the provider is asked. */
export const orderRefunds = pgTable(
  'order_refunds',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    orderId: idColumn('order_id'),
    subscriptionId: idColumn('subscription_id'),
    gateway: text('gateway').notNull(),
    gatewayPaymentId: text('gateway_payment_id').notNull(),
    gatewayRefundId: text('gateway_refund_id'),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('pending'),
    reason: text('reason').notNull(),
    failure: text('failure'),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('order_refunds_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'order_refunds_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_order_refunds_order',
      columns: [t.orgId, t.orderId],
      foreignColumns: [orders.orgId, orders.id],
    }),
    foreignKey({
      name: 'fk_order_refunds_subscription',
      columns: [t.orgId, t.subscriptionId],
      foreignColumns: [subscriptions.orgId, subscriptions.id],
    }),
    check(
      'chk_order_refunds_target',
      sql`${t.orderId} is not null or ${t.subscriptionId} is not null`,
    ),
    check('chk_order_refunds_amount', sql`${t.amountMinor} > 0`),
    check('chk_order_refunds_currency', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('chk_order_refunds_status', sql`${t.status} in ('pending', 'processed', 'failed')`),
    index('idx_order_refunds_payment').on(t.orgId, t.gateway, t.gatewayPaymentId),
    index('idx_order_refunds_order')
      .on(t.orgId, t.orderId)
      .where(sql`${t.orderId} is not null`),
    index('idx_order_refunds_subscription')
      .on(t.orgId, t.subscriptionId)
      .where(sql`${t.subscriptionId} is not null`),
  ],
);

export type OrderRefundsRow = typeof orderRefunds.$inferSelect;
