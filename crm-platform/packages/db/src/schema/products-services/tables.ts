/**
 * products-services: the Products and services add-on's table. Mirrors migrations/2037_products_services_app.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { waProducts } from '../catalog-products/tables';

export const salesItems = pgTable(
  'sales_items',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    kind: text('kind').notNull().default('product'),
    name: text('name').notNull(),
    sku: text('sku'),
    description: text('description'),
    unit: text('unit'),
    unitPriceMinor: bigint('unit_price_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    taxRatePercent: numeric('tax_rate_percent', { precision: 7, scale: 4 }),
    isActive: boolean('is_active').notNull().default(true),
    waProductId: idColumn('wa_product_id'),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('sales_items_org_id_uuid_key').on(t.orgId, t.uuid),
    // `uq_sales_items_sku` (unique on lower(sku)) and `idx_sales_items_list` (on lower(name)) are expression indexes: the SQL migration is their only declaration.
    index('idx_sales_items_kind').on(t.orgId, t.kind, t.isActive),
    index('idx_sales_items_wa_product')
      .on(t.orgId, t.waProductId)
      .where(sql`${t.waProductId} IS NOT NULL`),
    check('chk_sales_items_kind', sql`${t.kind} IN ('product', 'service')`),
    check('chk_sales_items_price', sql`${t.unitPriceMinor} >= 0`),
    check('chk_sales_items_currency', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    foreignKey({
      name: 'fk_sales_items_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_sales_items_wa_product',
      columns: [t.orgId, t.waProductId],
      foreignColumns: [waProducts.orgId, waProducts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_sales_items_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export type SalesItemsRow = typeof salesItems.$inferSelect;
export type NewSalesItemsRow = typeof salesItems.$inferInsert;
