import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from './columns';

/** Tags and saved list views over `contacts` — Phase 11 (docs/phase-plan.md). */

export const tags = pgTable(
  'tags',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    name: citext('name').notNull(),
    color: text('color'),
    /** Reference tags.description (tib1 overlay). */
    description: text('description'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('tags_org_id_uuid_key').on(t.orgId, t.uuid),
    uniqueIndex('tags_org_id_name_key').on(t.orgId, t.name),
  ],
);

export const contactTags = pgTable(
  'contact_tags',
  {
    orgId: orgIdColumn(),
    contactId: idColumn('contact_id').notNull(),
    tagId: idColumn('tag_id').notNull(),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.contactId, t.tagId] }),
    index('idx_contact_tags_tag').on(t.orgId, t.tagId),
  ],
);

export const contactViews = pgTable(
  'contact_views',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    name: text('name').notNull(),
    filter: jsonb('filter').$type<Record<string, unknown>>().notNull().default({}),
    position: integer('position').notNull().default(0),
    isShared: boolean('is_shared').notNull().default(false),
    /** 'me' | 'everyone' | 'selected' (the people in `contact_view_users`). `isShared` is true for any mode but 'me'. */
    shareMode: text('share_mode').notNull().default('me'),
    /** What people it is shared with may do: 'can_view' | 'can_edit'. */
    accessType: text('access_type').notNull().default('can_view'),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('contact_views_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_contact_views_created_by').on(t.orgId, t.createdBy),
  ],
);

export const contactViewFavorites = pgTable(
  'contact_view_favorites',
  {
    orgId: orgIdColumn(),
    viewId: idColumn('view_id').notNull(),
    userId: idColumn('user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.viewId, t.userId] })],
);

export const contactViewUsers = pgTable(
  'contact_view_users',
  {
    orgId: orgIdColumn(),
    viewId: idColumn('view_id').notNull(),
    userId: idColumn('user_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.viewId, t.userId] }),
    index('idx_contact_view_users_user').on(t.orgId, t.userId),
  ],
);

export type Tag = typeof tags.$inferSelect;
export type ContactView = typeof contactViews.$inferSelect;
