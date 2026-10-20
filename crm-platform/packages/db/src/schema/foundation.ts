import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
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
  /** Inactivity lifecycle (20261116090000_org_lifecycle.sql, ADR-0028). */
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  /** Per-workspace overrides; null = platform default (90 / 180). */
  archiveAfterDays: integer('archive_after_days'),
  deleteAfterDays: integer('delete_after_days'),
  retentionExempt: boolean('retention_exempt').notNull().default(false),
  retentionExemptReason: text('retention_exempt_reason'),
  retentionExemptUntil: timestamp('retention_exempt_until', { withTimezone: true }),
  retentionExemptBy: text('retention_exempt_by'),
  retentionExemptAt: timestamp('retention_exempt_at', { withTimezone: true }),
  legalHold: boolean('legal_hold').notNull().default(false),
  /** Set when the owner deletes the workspace themselves (status 'deleted'); the sweep erases it after a grace period. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Append-only compliance record. No FK on purpose: it outlives the workspace. */
export const orgLifecycleLog = pgTable('org_lifecycle_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  orgId: bigint('org_id', { mode: 'number' }).notNull(),
  orgUuid: uuid('org_uuid').notNull(),
  eventType: text('event_type').notNull(),
  stage: text('stage').$type<'archive' | 'delete'>(),
  reminderNo: smallint('reminder_no'),
  inactivityCycle: timestamp('inactivity_cycle', { withTimezone: true }),
  daysInactive: integer('days_inactive'),
  actorType: text('actor_type').notNull().default('system'),
  actorRef: text('actor_ref'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

/** Object-store keys owed a purge after a workspace erasure. */
export const storagePurgeQueue = pgTable('storage_purge_queue', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  orgId: bigint('org_id', { mode: 'number' }).notNull(),
  orgUuid: uuid('org_uuid').notNull(),
  storageKey: text('storage_key').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  purgedAt: timestamp('purged_at', { withTimezone: true }),
  createdAt: createdAt(),
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
    /** Reference workspace_user.invited_at / joined_at (wsp overlay). */
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
    /** Reference team settings (wsp overlay). */
    slug: text('slug'),
    color: text('color').notNull().default('#075E54'),
    description: text('description'),
    defaultAssigneeId: idColumn('default_assignee_id'),
    /** Round robin cursor of the team's own method (migration 20270301090000): the person who took the last turn. */
    assignmentCursor: idColumn('assignment_cursor'),
    assignmentStrategy: text('assignment_strategy').notNull().default('manual'),
    businessHours: jsonb('business_hours'),
    timezone: text('timezone'),
    deviceIds: jsonb('device_ids'),
    isDefault: boolean('is_default').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    /** Teams v2 (BL-381): the optional parent team (no cycles: trigger `trg_teams_guard_parent`). */
    parentTeamId: idColumn('parent_team_id'),
    /** The team's manager. Cleared if the user row is deleted; a deactivated lead stays recorded. */
    leadUserId: idColumn('lead_user_id'),
    receivesConversations: boolean('receives_conversations').notNull().default(true),
    receivesRecords: boolean('receives_records').notNull().default(true),
    /** Reserved for the `team_and_below` scope (phase T2); stored, not read yet. */
    isScopeBoundary: boolean('is_scope_boundary').notNull().default(true),
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
      name: 'fk_teams_parent_team_id',
      columns: [t.orgId, t.parentTeamId],
      foreignColumns: [t.orgId, t.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_teams_lead_user_id',
      columns: [t.orgId, t.leadUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
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
    /** Reference team_user.capacity (wsp overlay). */
    capacity: integer('capacity').notNull().default(20),
    /** Teams v2: 'member' | 'lead' (replaced the unused is_lead). */
    role: text('role').notNull().default('member'),
    /** The person's main team, for reporting; at most one per person (partial unique index). */
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.teamId, t.userId] }),
    index('idx_team_members_user').on(t.orgId, t.userId),
    index('idx_team_members_team').on(t.orgId, t.teamId),
    uniqueIndex('uq_team_members_one_primary')
      .on(t.orgId, t.userId)
      .where(sql`${t.isPrimary}`),
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

/** The platform's own sales records, kept after an erasure for the tax-law period, without the buyer's identity. */
export const financialRecordsArchive = pgTable('financial_records_archive', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
  orgUuid: uuid('org_uuid').notNull(),
  orderUuid: uuid('order_uuid').notNull(),
  orderNumber: text('order_number').notNull(),
  kind: text('kind'),
  status: text('status').notNull(),
  currency: text('currency').notNull(),
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  discountAmount: numeric('discount_amount', { precision: 12, scale: 4 }).notNull(),
  taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull(),
  taxAmount: numeric('tax_amount', { precision: 12, scale: 4 }).notNull(),
  totalAmount: numeric('total_amount', { precision: 12, scale: 4 }).notNull(),
  billingCountry: text('billing_country'),
  billingTaxId: text('billing_tax_id'),
  gatewaySlug: text('gateway_slug'),
  gatewayOrderId: text('gateway_order_id'),
  gatewayPaymentId: text('gateway_payment_id'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  orderCreatedAt: timestamp('order_created_at', { withTimezone: true }).notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true }).notNull().defaultNow(),
  retainUntil: timestamp('retain_until', { withTimezone: true }).notNull(),
});
