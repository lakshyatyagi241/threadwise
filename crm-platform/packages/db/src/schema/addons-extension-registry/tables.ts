/**
 * addons-extension-registry: tables ported from Reference. Mirrors migrations/20261001100600_add_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const extensions = pgTable(
  'extensions',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    version: text('version').notNull().default('1.0.0'),
    purchaseCode: text('purchase_code'),
    status: text('status').notNull().default('active'),
    files: jsonb('files'),
    manifest: jsonb('manifest'),
    installedAt: timestamp('installed_at', { withTimezone: true }),
    installedBy: idColumn('installed_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_extensions_slug').on(t.slug),
    index('idx_extensions_installed_by').on(t.installedBy),
    index('idx_extensions_slug_status').on(t.slug, t.status),
  ],
);

export type ExtensionsRow = typeof extensions.$inferSelect;
export type NewExtensionsRow = typeof extensions.$inferInsert;

export const extensionApiTokens = pgTable(
  'extension_api_tokens',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    tokenHash: text('token_hash').notNull(),
    label: text('label'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_extension_api_tokens_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_extension_api_tokens_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_extension_api_tokens_token_hash').on(t.orgId, t.tokenHash),
    foreignKey({
      name: 'fk_extension_api_tokens_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_extension_api_tokens_user_id').on(t.orgId, t.userId),
  ],
);

export type ExtensionApiTokensRow = typeof extensionApiTokens.$inferSelect;
export type NewExtensionApiTokensRow = typeof extensionApiTokens.$inferInsert;
