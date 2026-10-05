/**
 * checkout-orders-merchant-payments: tables ported from WaDesk. Mirrors migrations/20261001104900_chk_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations } from '../foundation';
import { invoices } from '../invoicing/tables';
import { salesOrders } from '../invoicing/tables-extra';
import { waStorefronts } from '../storefront-builder/tables';
import { workspacePaymentConfigs } from '../workspaces-teams-tenancy/tables';

export const waCoupons = pgTable(
  'wa_coupons',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    storefrontId: idColumn('storefront_id'),
    code: text('code').notNull(),
    type: text('type').notNull().default('percent'),
    amount: bigint('amount', { mode: 'number' }).notNull().default(0),
    minSubtotalMinor: bigint('min_subtotal_minor', { mode: 'number' }),
    maxDiscountMinor: bigint('max_discount_minor', { mode: 'number' }),
    freeShipping: boolean('free_shipping').notNull().default(false),
    active: boolean('active').notNull().default(true),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    usageLimit: integer('usage_limit'),
    usedCount: integer('used_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_coupons_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_coupons_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_coupons_code').on(t.orgId, t.code),
    foreignKey({
      name: 'fk_wa_coupons_storefront_id',
      columns: [t.orgId, t.storefrontId],
      foreignColumns: [waStorefronts.orgId, waStorefronts.id],
    }).onDelete('set null'),
  ],
);

export type WaCouponsRow = typeof waCoupons.$inferSelect;
export type NewWaCouponsRow = typeof waCoupons.$inferInsert;

export const waMerchantGateways = pgTable(
  'wa_merchant_gateways',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    storefrontId: idColumn('storefront_id').notNull().default(0),
    slug: text('slug').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    credentials: text('credentials'),
    mode: text('mode').notNull().default('live'),
    active: boolean('active').notNull().default(true),
    /** The one row a checkout or an invoice uses in its scope (the workspace, or one shop). */
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    meta: jsonb('meta'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_merchant_gateways_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_merchant_gateways_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_merchant_gateways_storefront_id_slug').on(t.orgId, t.storefrontId, t.slug),
    // storefront_id 0 is the whole workspace, so there is no foreign key to wa_storefronts: a trigger removes a deleted shop's rows.
    uniqueIndex('uq_wa_merchant_gateways_default')
      .on(t.orgId, t.storefrontId)
      .where(sql`${t.isDefault}`),
  ],
);

export type WaMerchantGatewaysRow = typeof waMerchantGateways.$inferSelect;
export type NewWaMerchantGatewaysRow = typeof waMerchantGateways.$inferInsert;

export const waOrders = pgTable(
  'wa_orders',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    source: text('source').notNull(),
    customerPhone: text('customer_phone'),
    customerName: text('customer_name'),
    customerEmail: text('customer_email'),
    customerAddress: text('customer_address'),
    itemsJson: jsonb('items_json').notNull(),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    shippingMinor: bigint('shipping_minor', { mode: 'number' }).notNull().default(0),
    taxMinor: bigint('tax_minor', { mode: 'number' }).notNull().default(0),
    taxInclusive: boolean('tax_inclusive').notNull().default(false),
    taxLinesJson: jsonb('tax_lines_json'),
    discountMinor: bigint('discount_minor', { mode: 'number' }).notNull().default(0),
    couponCode: text('coupon_code'),
    paymentMethod: text('payment_method').notNull().default('prepaid'),
    rtoScore: smallint('rto_score'),
    rtoBand: text('rto_band'),
    currencyCode: text('currency_code').notNull().default('INR'),
    status: text('status').notNull().default('new'),
    paymentLink: text('payment_link'),
    notes: text('notes'),
    waMessageId: text('wa_message_id'),
    storefrontId: idColumn('storefront_id'),
    shopifyOrderId: text('shopify_order_id'),
    wooOrderId: text('woo_order_id'),
    metaJson: jsonb('meta_json'),
    recoveryToken: text('recovery_token'),
    waPaymentReferenceId: text('wa_payment_reference_id'),
    waPaymentStatus: text('wa_payment_status'),
    waPaymentTxnId: text('wa_payment_txn_id'),
    waPaymentConfigId: idColumn('wa_payment_config_id'),
    /** The CRM contact this buyer is (find-or-create by phone); null when none could be made (contact cap, no usable phone). */
    contactId: idColumn('contact_id'),
    /** The sales order and the invoice made from this order (migration 20261029090000). */
    salesOrderId: idColumn('sales_order_id'),
    invoiceId: idColumn('invoice_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_orders_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_orders_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_orders_storefront_id',
      columns: [t.orgId, t.storefrontId],
      foreignColumns: [waStorefronts.orgId, waStorefronts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_orders_wa_payment_config_id',
      columns: [t.orgId, t.waPaymentConfigId],
      foreignColumns: [workspacePaymentConfigs.orgId, workspacePaymentConfigs.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_orders_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_orders_sales_order_id',
      columns: [t.orgId, t.salesOrderId],
      foreignColumns: [salesOrders.orgId, salesOrders.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_orders_invoice_id',
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }).onDelete('set null'),
    index('idx_wa_orders_contact_id')
      .on(t.orgId, t.contactId)
      .where(sql`contact_id IS NOT NULL`),
    index('idx_wa_orders_sales_order_id')
      .on(t.orgId, t.salesOrderId)
      .where(sql`sales_order_id IS NOT NULL`),
    index('idx_wa_orders_invoice_id')
      .on(t.orgId, t.invoiceId)
      .where(sql`invoice_id IS NOT NULL`),
    index('idx_wa_orders_recovery_token').on(t.orgId, t.recoveryToken),
    index('idx_wa_orders_shopify_order_id').on(t.orgId, t.shopifyOrderId),
    index('idx_wa_orders_storefront_id').on(t.orgId, t.storefrontId),
    index('idx_wa_orders_wa_payment_reference_id').on(t.orgId, t.waPaymentReferenceId),
    index('idx_wa_orders_woo_order_id').on(t.orgId, t.wooOrderId),
    index('idx_wa_orders_source').on(t.orgId, t.source),
    index('idx_wa_orders_status_created_at').on(t.orgId, t.status, t.createdAt),
  ],
);

export type WaOrdersRow = typeof waOrders.$inferSelect;
export type NewWaOrdersRow = typeof waOrders.$inferInsert;

export const waOrderItems = pgTable(
  'wa_order_items',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    orderId: idColumn('order_id').notNull(),
    productId: idColumn('product_id'),
    retailerId: text('retailer_id').notNull(),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
    quantity: integer('quantity').notNull().default(1),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull().default(0),
    currencyCode: text('currency_code').notNull().default('INR'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_order_items_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_order_items_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_order_items_order_id',
      columns: [t.orgId, t.orderId],
      foreignColumns: [waOrders.orgId, waOrders.id],
    }).onDelete('cascade'),
    index('idx_wa_order_items_order_id').on(t.orgId, t.orderId),
    index('idx_wa_order_items_product_id').on(t.orgId, t.productId),
    index('idx_wa_order_items_retailer_id').on(t.orgId, t.retailerId),
  ],
);

export type WaOrderItemsRow = typeof waOrderItems.$inferSelect;
export type NewWaOrderItemsRow = typeof waOrderItems.$inferInsert;

export const waPendingOrders = pgTable(
  'wa_pending_orders',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    customerPhone: text('customer_phone').notNull(),
    ref: text('ref').notNull(),
    itemsJson: jsonb('items_json'),
    unavailableJson: jsonb('unavailable_json'),
    totalMinor: bigint('total_minor', { mode: 'number' }).notNull().default(0),
    currencyCode: text('currency_code'),
    customerLang: text('customer_lang'),
    shipName: text('ship_name'),
    shipCompany: text('ship_company'),
    shipAddress: text('ship_address'),
    groupCode: text('group_code'),
    orderMediaPath: text('order_media_path'),
    orderMediaType: text('order_media_type'),
    orderMediaTranscript: text('order_media_transcript'),
    status: text('status').notNull().default('pending'),
    orderId: idColumn('order_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_pending_orders_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_pending_orders_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_pending_orders_customer_phone').on(t.orgId, t.customerPhone),
    foreignKey({
      name: 'fk_wa_pending_orders_order_id',
      columns: [t.orgId, t.orderId],
      foreignColumns: [waOrders.orgId, waOrders.id],
    }).onDelete('set null'),
    index('idx_wa_pending_orders_expires_at').on(t.orgId, t.expiresAt),
    index('idx_wa_pending_orders_ref').on(t.orgId, t.ref),
  ],
);

export type WaPendingOrdersRow = typeof waPendingOrders.$inferSelect;
export type NewWaPendingOrdersRow = typeof waPendingOrders.$inferInsert;
