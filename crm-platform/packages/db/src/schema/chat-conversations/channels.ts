/**
 * chat-conversations: the channel registry. Mirrors migrations/20261014090000_chat_channels.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const chatChannels = pgTable(
  'channels',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('disconnected'),
    externalId: text('external_id'),
    displayAddress: text('display_address'),
    credentialsEnc: text('credentials_enc'),
    credentialHints: jsonb('credential_hints')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    webhookTokenHash: text('webhook_token_hash'),
    webhookTokenRotatedAt: timestamp('webhook_token_rotated_at', { withTimezone: true }),
    capabilities: jsonb('capabilities').$type<Record<string, unknown>>().notNull().default({}),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    // 20261016090000_chat_channel_health.sql
    businessAccountId: text('business_account_id'),
    health: jsonb('health').$type<Record<string, unknown>>(),
    healthCheckedAt: timestamp('health_checked_at', { withTimezone: true }),
    lastError: jsonb('last_error').$type<{ code: string; message: string; at: string }>(),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_channels_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_channels_org_id_kind_external_id').on(t.orgId, t.kind, t.externalId),
    foreignKey({
      name: 'fk_channels_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_channels_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check(
      'chk_channels_status',
      sql`${t.status} in ('connected', 'disconnected', 'error', 'needs_reauth')`,
    ),
    check(
      'chk_channels_business_account_id',
      sql`${t.businessAccountId} is null or ${t.businessAccountId} ~ '^[0-9]{5,32}$'`,
    ),
    check('chk_channels_health', sql`${t.health} is null or jsonb_typeof(${t.health}) = 'object'`),
    check(
      'chk_channels_last_error',
      sql`${t.lastError} is null or jsonb_typeof(${t.lastError}) = 'object'`,
    ),
    index('idx_channels_org_created').on(t.orgId, t.createdAt, t.id),
    index('idx_channels_created_by').on(t.orgId, t.createdBy),
    uniqueIndex('uq_channels_whatsapp_number')
      .on(t.externalId)
      .where(sql`${t.kind} = 'whatsapp_cloud' and ${t.externalId} is not null`),
  ],
);

export type ChatChannelsRow = typeof chatChannels.$inferSelect;
export type NewChatChannelsRow = typeof chatChannels.$inferInsert;
