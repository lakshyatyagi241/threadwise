/**
 * localization-translation: tables ported from WaDesk. Mirrors migrations/20261001100100_i18n_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
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
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';

export const languages = pgTable(
  'languages',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    nativeName: text('native_name'),
    direction: text('direction').notNull().default('ltr'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    check('chk_languages_direction', sql`${t.direction} in ('ltr', 'rtl')`),
    unique('uq_languages_code').on(t.code),
  ],
);

export type LanguagesRow = typeof languages.$inferSelect;
export type NewLanguagesRow = typeof languages.$inferInsert;

export const translationProviders = pgTable(
  'translation_providers',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    credentials: text('credentials'),
    extraConfig: jsonb('extra_config'),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_translation_providers_slug').on(t.slug),
    index('idx_translation_providers_is_active_is_default_sort_order').on(
      t.isActive,
      t.isDefault,
      t.sortOrder,
    ),
  ],
);

export type TranslationProvidersRow = typeof translationProviders.$inferSelect;
export type NewTranslationProvidersRow = typeof translationProviders.$inferInsert;

export const translationUsage = pgTable(
  'translation_usage',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('translation_usage_id_seq')`),
    orgId: orgIdColumn(),
    providerSlug: text('provider_slug').notNull(),
    sourceLang: text('source_lang').notNull(),
    targetLang: text('target_lang').notNull(),
    charsIn: integer('chars_in').notNull().default(0),
    charsOut: integer('chars_out').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    wasFallback: boolean('was_fallback').notNull().default(false),
    calledAt: timestamp('called_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_translation_usage_called_at').on(t.orgId, t.calledAt),
    index('idx_translation_usage_provider_slug_called_at').on(t.orgId, t.providerSlug, t.calledAt),
  ],
);

export type TranslationUsageRow = typeof translationUsage.$inferSelect;
export type NewTranslationUsageRow = typeof translationUsage.$inferInsert;
