import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { citext, createdAt, idColumn, rowVersion, updatedAt } from '../columns';
import { platformOperators } from '../auth-registration-security/core';

/**
 * Mirror of 20261013090000_rbac_platform_roles.sql. The SQL is the source of truth; this file exists so
 * queries are typed. Platform layer: no org_id, privileged access only.
 */

export const platformRoles = pgTable('platform_roles', {
  id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
  uuid: uuid('uuid').notNull(),
  name: citext('name').notNull(),
  description: text('description').notNull().default(''),
  isLocked: boolean('is_locked').notNull().default(false),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  rowVersion: rowVersion(),
});

export const platformPermissions = pgTable('platform_permissions', {
  id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
  uuid: uuid('uuid').notNull(),
  name: citext('name').notNull(),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const platformRolePermissions = pgTable(
  'platform_role_permissions',
  {
    roleId: idColumn('role_id')
      .notNull()
      .references(() => platformRoles.id, { onDelete: 'cascade' }),
    permissionId: idColumn('permission_id')
      .notNull()
      .references(() => platformPermissions.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index('idx_platform_role_permissions_perm').on(t.permissionId),
  ],
);

export const platformOperatorRoles = pgTable(
  'platform_operator_roles',
  {
    operatorId: idColumn('operator_id')
      .notNull()
      .references(() => platformOperators.id, { onDelete: 'cascade' }),
    roleId: idColumn('role_id')
      .notNull()
      .references(() => platformRoles.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.operatorId, t.roleId] }),
    index('idx_platform_operator_roles_role').on(t.roleId),
  ],
);

export type PlatformRoleRow = typeof platformRoles.$inferSelect;
export type PlatformPermissionRow = typeof platformPermissions.$inferSelect;
