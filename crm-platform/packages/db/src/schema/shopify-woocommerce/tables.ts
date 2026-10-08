/**
 * shopify-woocommerce: tables ported from WaDesk. Mirrors migrations/20261001101800_ecom_wadesk_schema.sql.
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
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';
import { waOrders } from '../checkout-orders-merchant-payments/tables';
import { invoices } from '../invoicing/tables';

export const shopifyIntegrations = pgTable(
  'shopify_integrations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    storeUrl: text('store_url').notNull(),
    storeName: text('store_name'),
    shopId: text('shop_id'),
    shopEmail: text('shop_email'),
    shopOwner: text('shop_owner'),
    shopPlan: text('shop_plan'),
    shopCurrency: text('shop_currency'),
    shopCountry: text('shop_country'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    accessToken: text('access_token').notNull(),
    scopes: text('scopes'),
    status: text('status').notNull().default('active'),
    webhookSecret: text('webhook_secret').notNull(),
    metadata: jsonb('metadata'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    productsSyncedAt: timestamp('products_synced_at', { withTimezone: true }),
    ordersSyncedAt: timestamp('orders_synced_at', { withTimezone: true }),
    customersSyncedAt: timestamp('customers_synced_at', { withTimezone: true }),
    syncStats: jsonb('sync_stats'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_shopify_integrations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_shopify_integrations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_shopify_integrations_store_url').on(t.orgId, t.storeUrl),
    foreignKey({
      name: 'fk_shopify_integrations_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_shopify_integrations_user_id').on(t.orgId, t.userId),
    index('idx_shopify_integrations_webhook_secret').on(t.orgId, t.webhookSecret),
  ],
);

export type ShopifyIntegrationsRow = typeof shopifyIntegrations.$inferSelect;
export type NewShopifyIntegrationsRow = typeof shopifyIntegrations.$inferInsert;

export const shopifyIntegrationEvents = pgTable(
  'shopify_integration_events',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    integrationId: idColumn('integration_id').notNull(),
    eventType: text('event_type').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    templateId: idColumn('template_id'),
    varMap: jsonb('var_map'),
    sendTo: text('send_to').notNull().default('customer'),
    adminNumber: text('admin_number'),
    delaySeconds: integer('delay_seconds').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_shopify_integration_events_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_shopify_integration_events_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_shopify_integration_events_integration_id_event_type').on(
      t.orgId,
      t.integrationId,
      t.eventType,
    ),
    foreignKey({
      name: 'fk_shopify_integration_events_integration_id',
      columns: [t.orgId, t.integrationId],
      foreignColumns: [shopifyIntegrations.orgId, shopifyIntegrations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_shopify_integration_events_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
  ],
);

export type ShopifyIntegrationEventsRow = typeof shopifyIntegrationEvents.$inferSelect;
export type NewShopifyIntegrationEventsRow = typeof shopifyIntegrationEvents.$inferInsert;

export const shopifyIntegrationLogs = pgTable(
  'shopify_integration_logs',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('shopify_integration_logs_id_seq')`),
    orgId: orgIdColumn(),
    integrationId: idColumn('integration_id').notNull(),
    eventType: text('event_type').notNull(),
    status: text('status').notNull().default('received'),
    recipient: text('recipient'),
    payload: jsonb('payload'),
    response: jsonb('response'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_shopify_integration_logs_integration_id_created_at').on(
      t.orgId,
      t.integrationId,
      t.createdAt,
    ),
    index('idx_shopify_integration_logs_integration_id_status').on(
      t.orgId,
      t.integrationId,
      t.status,
    ),
  ],
);

export type ShopifyIntegrationLogsRow = typeof shopifyIntegrationLogs.$inferSelect;
export type NewShopifyIntegrationLogsRow = typeof shopifyIntegrationLogs.$inferInsert;

export const shopifyStockWaitlist = pgTable(
  'shopify_stock_waitlist',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    integrationId: idColumn('integration_id').notNull(),
    shopifyProductId: text('shopify_product_id'),
    productName: text('product_name'),
    customerPhone: text('customer_phone').notNull(),
    status: text('status').notNull().default('waiting'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_shopify_stock_waitlist_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_shopify_stock_waitlist_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_shopify_stock_waitlist_integration_id',
      columns: [t.orgId, t.integrationId],
      foreignColumns: [shopifyIntegrations.orgId, shopifyIntegrations.id],
    }).onDelete('cascade'),
    index('idx_shopify_stock_waitlist_integration_id').on(t.orgId, t.integrationId),
    index('idx_shopify_stock_waitlist_shopify_product_id_status').on(
      t.orgId,
      t.shopifyProductId,
      t.status,
    ),
  ],
);

export type ShopifyStockWaitlistRow = typeof shopifyStockWaitlist.$inferSelect;
export type NewShopifyStockWaitlistRow = typeof shopifyStockWaitlist.$inferInsert;

export const woocommerceIntegrations = pgTable(
  'woocommerce_integrations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    storeUrl: text('store_url').notNull(),
    storeName: text('store_name'),
    storeCurrency: text('store_currency'),
    storeCountry: text('store_country'),
    storeVersion: text('store_version'),
    consumerKey: text('consumer_key').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    consumerSecret: text('consumer_secret').notNull(),
    status: text('status').notNull().default('active'),
    webhookSecret: text('webhook_secret').notNull(),
    metadata: jsonb('metadata'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    productsSyncedAt: timestamp('products_synced_at', { withTimezone: true }),
    ordersSyncedAt: timestamp('orders_synced_at', { withTimezone: true }),
    customersSyncedAt: timestamp('customers_synced_at', { withTimezone: true }),
    syncStats: jsonb('sync_stats'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_woocommerce_integrations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_woocommerce_integrations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_woocommerce_integrations_store_url').on(t.orgId, t.storeUrl),
    foreignKey({
      name: 'fk_woocommerce_integrations_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_woocommerce_integrations_user_id').on(t.orgId, t.userId),
    index('idx_woocommerce_integrations_webhook_secret').on(t.orgId, t.webhookSecret),
  ],
);

export type WoocommerceIntegrationsRow = typeof woocommerceIntegrations.$inferSelect;
export type NewWoocommerceIntegrationsRow = typeof woocommerceIntegrations.$inferInsert;

export const woocommerceIntegrationEvents = pgTable(
  'woocommerce_integration_events',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    integrationId: idColumn('integration_id').notNull(),
    eventType: text('event_type').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    templateId: idColumn('template_id'),
    varMap: jsonb('var_map'),
    sendTo: text('send_to').notNull().default('customer'),
    adminNumber: text('admin_number'),
    delaySeconds: integer('delay_seconds').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_woocommerce_integration_events_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_woocommerce_integration_events_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_woocommerce_integration_events_integration_id_event_type').on(
      t.orgId,
      t.integrationId,
      t.eventType,
    ),
    foreignKey({
      name: 'fk_woocommerce_integration_events_integration_id',
      columns: [t.orgId, t.integrationId],
      foreignColumns: [woocommerceIntegrations.orgId, woocommerceIntegrations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_woocommerce_integration_events_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
  ],
);

export type WoocommerceIntegrationEventsRow = typeof woocommerceIntegrationEvents.$inferSelect;
export type NewWoocommerceIntegrationEventsRow = typeof woocommerceIntegrationEvents.$inferInsert;

export const woocommerceIntegrationLogs = pgTable(
  'woocommerce_integration_logs',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('woocommerce_integration_logs_id_seq')`),
    orgId: orgIdColumn(),
    integrationId: idColumn('integration_id').notNull(),
    eventType: text('event_type').notNull(),
    status: text('status').notNull().default('received'),
    recipient: text('recipient'),
    payload: jsonb('payload'),
    response: jsonb('response'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_woocommerce_integration_logs_integration_id_created_at').on(
      t.orgId,
      t.integrationId,
      t.createdAt,
    ),
    index('idx_woocommerce_integration_logs_integration_id_status').on(
      t.orgId,
      t.integrationId,
      t.status,
    ),
  ],
);

export type WoocommerceIntegrationLogsRow = typeof woocommerceIntegrationLogs.$inferSelect;
export type NewWoocommerceIntegrationLogsRow = typeof woocommerceIntegrationLogs.$inferInsert;

export const woocommerceStockWaitlist = pgTable(
  'woocommerce_stock_waitlist',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    integrationId: idColumn('integration_id').notNull(),
    wooProductId: text('woo_product_id'),
    productName: text('product_name'),
    customerPhone: text('customer_phone').notNull(),
    status: text('status').notNull().default('waiting'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_woocommerce_stock_waitlist_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_woocommerce_stock_waitlist_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_woocommerce_stock_waitlist_integration_id',
      columns: [t.orgId, t.integrationId],
      foreignColumns: [woocommerceIntegrations.orgId, woocommerceIntegrations.id],
    }).onDelete('cascade'),
    index('idx_woocommerce_stock_waitlist_woo_product_id_status').on(
      t.orgId,
      t.wooProductId,
      t.status,
    ),
    index('idx_woocommerce_stock_waitlist_integration_id').on(t.orgId, t.integrationId),
  ],
);

export type WoocommerceStockWaitlistRow = typeof woocommerceStockWaitlist.$inferSelect;
export type NewWoocommerceStockWaitlistRow = typeof woocommerceStockWaitlist.$inferInsert;

export const shopifyCartRecoveries = pgTable(
  'shopify_cart_recoveries',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    integrationId: idColumn('integration_id').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    checkoutToken: text('checkout_token'),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: text('customer_email'),
    scheduledIds: jsonb('scheduled_ids'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_shopify_cart_recoveries_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_shopify_cart_recoveries_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_shopify_cart_recoveries_integration_id',
      columns: [t.orgId, t.integrationId],
      foreignColumns: [shopifyIntegrations.orgId, shopifyIntegrations.id],
    }).onDelete('cascade'),
    index('idx_shopify_cart_recoveries_customer_phone_status').on(
      t.orgId,
      t.customerPhone,
      t.status,
    ),
    index('idx_shopify_cart_recoveries_integration_id').on(t.orgId, t.integrationId),
  ],
);

export type ShopifyCartRecoveriesRow = typeof shopifyCartRecoveries.$inferSelect;
export type NewShopifyCartRecoveriesRow = typeof shopifyCartRecoveries.$inferInsert;

export const shopifyCodConfirmations = pgTable(
  'shopify_cod_confirmations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    integrationId: idColumn('integration_id').notNull(),
    shopifyOrderId: text('shopify_order_id'),
    orderName: text('order_name'),
    customerPhone: text('customer_phone').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_shopify_cod_confirmations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_shopify_cod_confirmations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_shopify_cod_confirmations_integration_id',
      columns: [t.orgId, t.integrationId],
      foreignColumns: [shopifyIntegrations.orgId, shopifyIntegrations.id],
    }).onDelete('cascade'),
    index('idx_shopify_cod_confirmations_customer_phone_status').on(
      t.orgId,
      t.customerPhone,
      t.status,
    ),
    index('idx_shopify_cod_confirmations_integration_id').on(t.orgId, t.integrationId),
  ],
);

export type ShopifyCodConfirmationsRow = typeof shopifyCodConfirmations.$inferSelect;
export type NewShopifyCodConfirmationsRow = typeof shopifyCodConfirmations.$inferInsert;

export const woocommerceCartRecoveries = pgTable(
  'woocommerce_cart_recoveries',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    integrationId: idColumn('integration_id').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    checkoutToken: text('checkout_token'),
    customerPhone: text('customer_phone').notNull(),
    customerEmail: text('customer_email'),
    scheduledIds: jsonb('scheduled_ids'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_woocommerce_cart_recoveries_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_woocommerce_cart_recoveries_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_woocommerce_cart_recoveries_integration_id',
      columns: [t.orgId, t.integrationId],
      foreignColumns: [woocommerceIntegrations.orgId, woocommerceIntegrations.id],
    }).onDelete('cascade'),
    index('idx_woocommerce_cart_recoveries_customer_phone_status').on(
      t.orgId,
      t.customerPhone,
      t.status,
    ),
    index('idx_woocommerce_cart_recoveries_integration_id').on(t.orgId, t.integrationId),
  ],
);

export type WoocommerceCartRecoveriesRow = typeof woocommerceCartRecoveries.$inferSelect;
export type NewWoocommerceCartRecoveriesRow = typeof woocommerceCartRecoveries.$inferInsert;

export const woocommerceCodConfirmations = pgTable(
  'woocommerce_cod_confirmations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    integrationId: idColumn('integration_id').notNull(),
    wooOrderId: text('woo_order_id'),
    orderName: text('order_name'),
    customerPhone: text('customer_phone').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_woocommerce_cod_confirmations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_woocommerce_cod_confirmations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_woocommerce_cod_confirmations_integration_id',
      columns: [t.orgId, t.integrationId],
      foreignColumns: [woocommerceIntegrations.orgId, woocommerceIntegrations.id],
    }).onDelete('cascade'),
    index('idx_woocommerce_cod_confirmations_customer_phone_status').on(
      t.orgId,
      t.customerPhone,
      t.status,
    ),
    index('idx_woocommerce_cod_confirmations_integration_id').on(t.orgId, t.integrationId),
  ],
);

export type WoocommerceCodConfirmationsRow = typeof woocommerceCodConfirmations.$inferSelect;
export type NewWoocommerceCodConfirmationsRow = typeof woocommerceCodConfirmations.$inferInsert;

/** One claimed delivery of a paid store order handed to invoicing (WD-ECOM-035): a redelivery finds the claim and does nothing. */
export const ecomInvoiceHandoffs = pgTable(
  'ecom_invoice_handoffs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    source: text('source').notNull(),
    deliveryId: text('delivery_id').notNull(),
    topic: text('topic'),
    waOrderId: idColumn('wa_order_id').notNull(),
    invoiceId: idColumn('invoice_id'),
    outcome: text('outcome').notNull().default('pending'),
    reason: text('reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('ecom_invoice_handoffs_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_ecom_invoice_handoffs_delivery').on(t.orgId, t.source, t.deliveryId),
    foreignKey({
      name: 'ecom_invoice_handoffs_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ecom_invoice_handoffs_org_id_wa_order_id_fkey',
      columns: [t.orgId, t.waOrderId],
      foreignColumns: [waOrders.orgId, waOrders.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ecom_invoice_handoffs_org_id_invoice_id_fkey',
      columns: [t.orgId, t.invoiceId],
      foreignColumns: [invoices.orgId, invoices.id],
    }),
    index('idx_ecom_invoice_handoffs_order').on(t.orgId, t.waOrderId),
  ],
);

export type EcomInvoiceHandoffsRow = typeof ecomInvoiceHandoffs.$inferSelect;
export type NewEcomInvoiceHandoffsRow = typeof ecomInvoiceHandoffs.$inferInsert;
