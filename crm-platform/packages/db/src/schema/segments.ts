import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from './columns';

/**
 * Segments: saved rules over contacts that fill themselves (product extension). The membership is
 * never stored; `member_count_cache` is only a cache (see migration 20261011090000_seg_segments).
 */
export const segments = pgTable(
  'segments',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'),
    visibility: text('visibility').$type<'private' | 'shared'>().notNull().default('private'),
    ownerId: idColumn('owner_id'),
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull(),
    rulesVersion: integer('rules_version').notNull().default(1),
    memberCountCache: integer('member_count_cache'),
    memberCountAt: timestamp('member_count_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('segments_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_segments_owner').on(t.orgId, t.ownerId),
  ],
);

export type Segment = typeof segments.$inferSelect;
