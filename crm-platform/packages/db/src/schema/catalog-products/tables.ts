/**
 * catalog-products: tables ported from WaDesk. Mirrors migrations/20261001105000_cat_wadesk_schema.sql.
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
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { waOrders } from '../checkout-orders-merchant-payments/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { waStorefronts } from '../storefront-builder/tables';

export const waCatalogs = pgTable(
  'wa_catalogs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    provider: text('provider').notNull(),
    catalogId: text('catalog_id').notNull(),
    catalogName: text('catalog_name'),
    wabaId: text('waba_id'),
    phoneNumberId: text('phone_number_id'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    accessTokenEnc: text('access_token_enc'),
    isCartEnabled: boolean('is_cart_enabled').notNull().default(true),
    isCatalogVisible: boolean('is_catalog_visible').notNull().default(true),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_catalogs_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_catalogs_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_catalogs_provider').on(t.orgId, t.provider),
    index('idx_wa_catalogs_catalog_id').on(t.orgId, t.catalogId),
  ],
);

export type WaCatalogsRow = typeof waCatalogs.$inferSelect;
export type NewWaCatalogsRow = typeof waCatalogs.$inferInsert;

export const waProducts = pgTable(
  'wa_products',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    storefrontId: idColumn('storefront_id'),
    shopifyProductId: text('shopify_product_id'),
    wooProductId: text('woo_product_id'),
    userId: idColumn('user_id'),
    sku: text('sku'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    bodyHtml: text('body_html'),
    priceMinor: bigint('price_minor', { mode: 'number' }).notNull().default(0),
    comparePriceMinor: bigint('compare_price_minor', { mode: 'number' }),
    weightGrams: integer('weight_grams'),
    category: text('category'),
    tagsJson: jsonb('tags_json'),
    aliasesJson: jsonb('aliases_json'),
    status: text('status').notNull().default('active'),
    availability: text('availability').notNull().default('in stock'),
    condition: text('condition').notNull().default('new'),
    brand: text('brand'),
    productUrl: text('product_url'),
    googleProductCategory: text('google_product_category'),
    currencyCode: text('currency_code').notNull().default('INR'),
    imageUrl: text('image_url'),
    galleryJson: jsonb('gallery_json'),
    inStock: boolean('in_stock').notNull().default(true),
    stockQty: integer('stock_qty'),
    reservedQty: integer('reserved_qty').notNull().default(0),
    sortOrder: integer('sort_order').notNull().default(0),
    metaRetailerId: text('meta_retailer_id'),
    metaSyncStatus: text('meta_sync_status'),
    metaSyncedAt: timestamp('meta_synced_at', { withTimezone: true }),
    metaBatchHandle: text('meta_batch_handle'),
    metaLastError: text('meta_last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_products_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_products_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_wa_products_availability',
      sql`${t.availability} in ('in stock', 'out of stock', 'available for order', 'discontinued')`,
    ),
    check('chk_wa_products_condition', sql`${t.condition} in ('new', 'refurbished', 'used')`),
    unique('uq_wa_products_slug').on(t.orgId, t.slug),
    foreignKey({
      name: 'fk_wa_products_storefront_id',
      columns: [t.orgId, t.storefrontId],
      foreignColumns: [waStorefronts.orgId, waStorefronts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_products_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    index('idx_wa_products_shopify_product_id').on(t.orgId, t.shopifyProductId),
    index('idx_wa_products_storefront_id').on(t.orgId, t.storefrontId),
    index('idx_wa_products_user_id').on(t.orgId, t.userId),
    index('idx_wa_products_woo_product_id').on(t.orgId, t.wooProductId),
    index('idx_wa_products_category').on(t.orgId, t.category),
    index('idx_wa_products_in_stock_sort_order').on(t.orgId, t.inStock, t.sortOrder),
    index('idx_wa_products_status').on(t.orgId, t.status),
    index('idx_wa_products_meta_sync_status').on(t.orgId, t.metaSyncStatus),
  ],
);

export type WaProductsRow = typeof waProducts.$inferSelect;
export type NewWaProductsRow = typeof waProducts.$inferInsert;

export const waProductReviews = pgTable(
  'wa_product_reviews',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    storefrontId: idColumn('storefront_id'),
    productId: idColumn('product_id').notNull(),
    orderId: idColumn('order_id'),
    customerName: text('customer_name'),
    rating: smallint('rating').notNull().default(5),
    body: text('body'),
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_product_reviews_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_product_reviews_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_product_reviews_storefront_id',
      columns: [t.orgId, t.storefrontId],
      foreignColumns: [waStorefronts.orgId, waStorefronts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_product_reviews_product_id',
      columns: [t.orgId, t.productId],
      foreignColumns: [waProducts.orgId, waProducts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_product_reviews_order_id',
      columns: [t.orgId, t.orderId],
      foreignColumns: [waOrders.orgId, waOrders.id],
    }).onDelete('set null'),
    index('idx_wa_product_reviews_product_id').on(t.orgId, t.productId),
  ],
);

export type WaProductReviewsRow = typeof waProductReviews.$inferSelect;
export type NewWaProductReviewsRow = typeof waProductReviews.$inferInsert;

export const waProductSets = pgTable(
  'wa_product_sets',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    name: text('name').notNull(),
    slug: text('slug'),
    description: text('description'),
    productIds: jsonb('product_ids'),
    isActive: boolean('is_active').notNull().default(true),
    metaSetId: text('meta_set_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_product_sets_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_product_sets_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_product_sets_slug').on(t.orgId, t.slug),
    foreignKey({
      name: 'fk_wa_product_sets_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

export type WaProductSetsRow = typeof waProductSets.$inferSelect;
export type NewWaProductSetsRow = typeof waProductSets.$inferInsert;

export const waStockReservations = pgTable(
  'wa_stock_reservations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    productId: idColumn('product_id').notNull(),
    orderId: idColumn('order_id'),
    ref: text('ref'),
    qty: integer('qty').notNull(),
    status: text('status').notNull().default('held'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_stock_reservations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_stock_reservations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_stock_reservations_product_id',
      columns: [t.orgId, t.productId],
      foreignColumns: [waProducts.orgId, waProducts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_stock_reservations_order_id',
      columns: [t.orgId, t.orderId],
      foreignColumns: [waOrders.orgId, waOrders.id],
    }).onDelete('set null'),
    index('idx_wa_stock_reservations_expires_at').on(t.orgId, t.expiresAt),
    index('idx_wa_stock_reservations_order_id').on(t.orgId, t.orderId),
    index('idx_wa_stock_reservations_product_id').on(t.orgId, t.productId),
    index('idx_wa_stock_reservations_ref').on(t.orgId, t.ref),
  ],
);

export type WaStockReservationsRow = typeof waStockReservations.$inferSelect;
export type NewWaStockReservationsRow = typeof waStockReservations.$inferInsert;
