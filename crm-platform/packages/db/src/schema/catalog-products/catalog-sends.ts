/**
 * catalog-products: the catalog send log. Mirrors migrations/20261010100100_cat_catalog_sends.sql (not part of the generated
 * Reference schema in tables.ts: Reference read these rows out of the inbox message table).
 */
import {
  bigint,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const catCatalogSends = pgTable(
  'cat_catalog_sends',
  {
    orgId: orgIdColumn(),
    id: bigint('id', { mode: 'number' }).notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    recipient: text('recipient').notNull(),
    mode: text('mode').notNull(),
    header: text('header'),
    body: text('body'),
    footer: text('footer'),
    productIds: jsonb('product_ids').notNull().default([]),
    productNames: jsonb('product_names').notNull().default([]),
    status: text('status').notNull(),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('cat_catalog_sends_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'cat_catalog_sends_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_cat_catalog_sends_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_cat_catalog_sends_recent').on(t.orgId, t.id),
  ],
);

export type CatCatalogSendsRow = typeof catCatalogSends.$inferSelect;
export type NewCatCatalogSendsRow = typeof catCatalogSends.$inferInsert;
