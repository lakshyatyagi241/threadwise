/**
 * auth-registration-security: tables ported from Reference. Mirrors migrations/20261001100000_auth_threadwise_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
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

export const userSettings = pgTable(
  'user_settings',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id').notNull(),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    country: text('country'),
    zip: text('zip'),
    countryCode: text('country_code'),
    notes: text('notes'),
    welcomeEmailSentAt: timestamp('welcome_email_sent_at', { withTimezone: true }),
    autoAiSummarizeEnabled: boolean('auto_ai_summarize_enabled').notNull().default(false),
    inboxLastSeenAt: timestamp('inbox_last_seen_at', { withTimezone: true }),
    quickAccess: jsonb('quick_access'),
    hasSeenIntro: boolean('has_seen_intro').notNull().default(false),
    sheetsKeyHash: text('sheets_key_hash'),
    sheetsKeySuffix: text('sheets_key_suffix'),
    sheetsKeyCreatedAt: timestamp('sheets_key_created_at', { withTimezone: true }),
    sheetsKeyLastUsedAt: timestamp('sheets_key_last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_user_settings_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_user_settings_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_user_settings_user_id').on(t.orgId, t.userId),
    foreignKey({
      name: 'fk_user_settings_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    index('idx_user_settings_sheets_key_hash').on(t.orgId, t.sheetsKeyHash),
  ],
);

export type UserSettingsRow = typeof userSettings.$inferSelect;
export type NewUserSettingsRow = typeof userSettings.$inferInsert;
