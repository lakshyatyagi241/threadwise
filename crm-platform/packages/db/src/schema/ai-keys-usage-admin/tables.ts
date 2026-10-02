/**
 * ai-keys-usage-admin: tables ported from WaDesk. Mirrors migrations/20261001100900_aiadm_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';

export const adminAiKeys = pgTable(
  'admin_ai_keys',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    provider: text('provider').notNull(),
    name: text('name').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    apiKey: text('api_key'),
    /** Last four characters of the key, so a screen can say which one is saved. Not a secret. */
    keyLast4: text('key_last4'),
    defaultModel: text('default_model'),
    extraConfig: text('extra_config'),
    isActive: boolean('is_active').notNull().default(false),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [unique('uq_admin_ai_keys_provider').on(t.provider)],
);

export type AdminAiKeysRow = typeof adminAiKeys.$inferSelect;
export type NewAdminAiKeysRow = typeof adminAiKeys.$inferInsert;

export const aiProviderKeys = pgTable(
  'ai_provider_keys',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    provider: text('provider').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    apiKey: text('api_key').notNull(),
    keyLast4: text('key_last4'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_ai_provider_keys_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_ai_provider_keys_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_ai_provider_keys_provider').on(t.orgId, t.provider),
  ],
);

export type AiProviderKeysRow = typeof aiProviderKeys.$inferSelect;
export type NewAiProviderKeysRow = typeof aiProviderKeys.$inferInsert;

export const aiTokenUsage = pgTable(
  'ai_token_usage',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('ai_token_usage_id_seq')`),
    orgId: orgIdColumn(),
    provider: text('provider').notNull(),
    model: text('model'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    billedAgainst: text('billed_against').notNull().default('admin'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_ai_token_usage_created_at').on(t.orgId, t.createdAt),
  ],
);

export type AiTokenUsageRow = typeof aiTokenUsage.$inferSelect;
export type NewAiTokenUsageRow = typeof aiTokenUsage.$inferInsert;
