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
    check('chk_channels_status', sql`${t.status} in ('connected', 'disconnected', 'error')`),
    index('idx_channels_org_created').on(t.orgId, t.createdAt, t.id),
    index('idx_channels_created_by').on(t.orgId, t.createdBy),
  ],
);

export type ChatChannelsRow = typeof chatChannels.$inferSelect;
export type NewChatChannelsRow = typeof chatChannels.$inferInsert;
