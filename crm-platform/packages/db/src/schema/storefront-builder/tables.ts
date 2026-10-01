/**
 * storefront-builder: tables ported from WaDesk. Mirrors migrations/20261001101700_store_wadesk_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
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
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';
import { devices } from '../whatsapp-devices-baileys/tables';

export const waStorefronts = pgTable(
  'wa_storefronts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    deviceId: idColumn('device_id'),
    shopName: text('shop_name'),
    slug: text('slug').notNull(),
    customDomain: text('custom_domain'),
    customDomainVerified: boolean('custom_domain_verified').notNull().default(false),
    themeKey: text('theme_key').notNull().default('aurora'),
    enabled: boolean('enabled').notNull().default(true),
    settingsJson: jsonb('settings_json'),
    shippingJson: jsonb('shipping_json'),
    paymentProvider: text('payment_provider'),
    paymentConfigJson: jsonb('payment_config_json'),
    currencyCode: text('currency_code').notNull().default('INR'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_storefronts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_storefronts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_storefronts_custom_domain').on(t.customDomain),
    unique('uq_wa_storefronts_slug').on(t.slug),
    foreignKey({
      name: 'fk_wa_storefronts_device_id',
      columns: [t.orgId, t.deviceId],
      foreignColumns: [devices.orgId, devices.id],
    }).onDelete('set null'),
    index('idx_wa_storefronts_device_id').on(t.orgId, t.deviceId),
  ],
);

export type WaStorefrontsRow = typeof waStorefronts.$inferSelect;
export type NewWaStorefrontsRow = typeof waStorefronts.$inferInsert;

export const waStorefrontViews = pgTable(
  'wa_storefront_views',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    storefrontId: idColumn('storefront_id').notNull(),
    day: date('day').notNull(),
    views: integer('views').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_storefront_views_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_storefront_views_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_storefront_views_storefront_id_day').on(t.orgId, t.storefrontId, t.day),
    foreignKey({
      name: 'fk_wa_storefront_views_storefront_id',
      columns: [t.orgId, t.storefrontId],
      foreignColumns: [waStorefronts.orgId, waStorefronts.id],
    }).onDelete('cascade'),
  ],
);

export type WaStorefrontViewsRow = typeof waStorefrontViews.$inferSelect;
export type NewWaStorefrontViewsRow = typeof waStorefrontViews.$inferInsert;

export const storefrontCartRecoveries = pgTable(
  'storefront_cart_recoveries',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    storefrontId: idColumn('storefront_id').notNull(),
    customerPhone: text('customer_phone').notNull(),
    customerName: text('customer_name'),
    itemsJson: jsonb('items_json'),
    subtotalMinor: bigint('subtotal_minor', { mode: 'number' }).notNull().default(0),
    currencyCode: text('currency_code').notNull().default('INR'),
    scheduledIds: jsonb('scheduled_ids'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_storefront_cart_recoveries_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_storefront_cart_recoveries_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_storefront_cart_recoveries_storefront_id',
      columns: [t.orgId, t.storefrontId],
      foreignColumns: [waStorefronts.orgId, waStorefronts.id],
    }).onDelete('cascade'),
    index('idx_storefront_cart_recoveries_customer_phone').on(t.orgId, t.customerPhone),
    index('idx_storefront_cart_recoveries_storefront_id').on(t.orgId, t.storefrontId),
  ],
);

export type StorefrontCartRecoveriesRow = typeof storefrontCartRecoveries.$inferSelect;
export type NewStorefrontCartRecoveriesRow = typeof storefrontCartRecoveries.$inferInsert;
