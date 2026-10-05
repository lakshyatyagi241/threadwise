import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  citext,
  createdAt,
  dataJsonb as _dataJsonb,
  idColumn,
  orgIdColumn,
  rowVersion,
  updatedAt,
} from './columns';
import { permEffectEnum, recordScopeEnum } from './enums';

export const organizations = pgTable('organizations', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  uuid: uuid('uuid').notNull(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  plan: text('plan').notNull().default('starter'),
  tier: text('tier').notNull().default('standard'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  /** Bumped on any role/grant change — part of the RBAC cache key. */
  rolesVersion: integer('roles_version').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable(
  'users',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    email: citext('email').notNull(),
    fullName: text('full_name').notNull(),
    passwordHash: text('password_hash'),
    authSubject: text('auth_subject'),
    status: text('status').notNull().default('active'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /** WaDesk workspace_user.invited_at / joined_at (wsp overlay). */
    invitedAt: timestamp('invited_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('users_org_id_uuid_key').on(t.orgId, t.uuid),
    uniqueIndex('users_org_id_email_key').on(t.orgId, t.email),
    index('idx_users_org_status').on(t.orgId, t.status),
    uniqueIndex('users_org_id_auth_subject_key')
      .on(t.orgId, t.authSubject)
      .where(sql`${t.authSubject} IS NOT NULL`),
  ],
);

export const teams = pgTable(
  'teams',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    name: text('name').notNull(),
    /** WaDesk team settings (wsp overlay). */
    slug: text('slug'),
    color: text('color').notNull().default('#075E54'),
    description: text('description'),
    defaultAssigneeId: idColumn('default_assignee_id'),
    assignmentStrategy: text('assignment_strategy').notNull().default('manual'),
    businessHours: jsonb('business_hours'),
    timezone: text('timezone'),
    deviceIds: jsonb('device_ids'),
    isDefault: boolean('is_default').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('teams_org_id_name_key').on(t.orgId, t.name),
    unique('uq_teams_org_slug').on(t.orgId, t.slug),
    index('idx_teams_org_default').on(t.orgId, t.isDefault),
    foreignKey({
      name: 'fk_teams_default_assignee_id',
      columns: [t.orgId, t.defaultAssigneeId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    orgId: orgIdColumn(),
    teamId: idColumn('team_id').notNull(),
    userId: idColumn('user_id').notNull(),
    /** WaDesk team_user.is_lead / capacity (wsp overlay). */
    isLead: boolean('is_lead').notNull().default(false),
    capacity: integer('capacity').notNull().default(20),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.teamId, t.userId] }),
    index('idx_team_members_user').on(t.orgId, t.userId),
  ],
);

export const permissionDefs = pgTable('permission_defs', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  category: text('category').notNull(),
  supportsScope: boolean('supports_scope').notNull().default(false),
  /** The plan feature that unlocks this key (an add-on's keys); null = a core key. Decides visibility in the Roles editor only. */
  planFeature: text('plan_feature'),
  /** The Marketplace app whose keys these are; the key shows in the Roles editor only while the workspace has the app installed. */
  appSlug: text('app_slug'),
});

export const roles = pgTable(
  'roles',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    name: text('name').notNull(),
    systemKey: text('system_key'),
    isLocked: boolean('is_locked').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('roles_org_id_name_key').on(t.orgId, t.name),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    orgId: orgIdColumn(),
    userId: idColumn('user_id').notNull(),
    roleId: idColumn('role_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId, t.roleId] })],
);

export const roleGrants = pgTable(
  'role_grants',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    roleId: idColumn('role_id').notNull(),
    permissionKey: text('permission_key').notNull(),
    effect: permEffectEnum('effect').notNull().default('allow'),
    recordScope: recordScopeEnum('record_scope').notNull().default('all'),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('role_grants_org_id_role_id_permission_key_key').on(
      t.orgId,
      t.roleId,
      t.permissionKey,
    ),
  ],
);

export const sequenceCounters = pgTable(
  'sequence_counters',
  {
    orgId: orgIdColumn(),
    moduleKey: text('module_key').notNull(),
    currentValue: bigint('current_value', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.moduleKey] })],
);
