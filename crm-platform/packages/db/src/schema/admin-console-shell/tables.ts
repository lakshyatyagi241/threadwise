import { customType, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { orgIdColumn, updatedAt } from '../columns';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Mirror of 20261025090000_ashell_workspace_brand_assets.sql (the SQL is the source of truth). Slot is `logo` or `favicon`. */
export const workspaceBrandAssets = pgTable(
  'workspace_brand_assets',
  {
    orgId: orgIdColumn(),
    slot: text('slot').notNull(),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    etag: text('etag').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.slot] })],
);
