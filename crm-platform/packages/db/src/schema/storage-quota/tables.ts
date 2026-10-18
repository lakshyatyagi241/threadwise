/**
 * storage-quota: the workspace storage meter (docs/specs/storage-quota-and-archival.md section 4.1, backlog BL-300). Mirrors
 * migrations/20270105090000_storage_quota_tables.sql. The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file
 * and the database disagree.
 */
import {
  bigint,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';

const bytes = (name: string) => bigint(name, { mode: 'number' }).notNull().default(0);

export const storageOrgState = pgTable(
  'storage_org_state',
  {
    orgId: orgIdColumn(),
    hotBytes: bytes('hot_bytes'),
    reservedBytes: bytes('reserved_bytes'),
    graceUsedBytes: bytes('grace_used_bytes'),
    capBytes: bytes('cap_bytes'),
    level: text('level').notNull().default('ok'),
    levelCycle: integer('level_cycle').notNull().default(0),
    overSince: timestamp('over_since', { withTimezone: true }),
    mode: text('mode').notNull().default('inherit'),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }),
    lastDriftBytes: bytes('last_drift_bytes'),
    backfilledAt: timestamp('backfilled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId] }),
    foreignKey({
      name: 'storage_org_state_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_storage_org_state_hot').on(t.hotBytes.desc()),
  ],
);

export const storageUsage = pgTable(
  'storage_usage',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    category: text('category').notNull(),
    hotBytes: bytes('hot_bytes'),
    coldBytes: bytes('cold_bytes'),
    objects: bytes('objects'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_storage_usage_category').on(t.orgId, t.category),
    foreignKey({
      name: 'storage_usage_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export const storageObjects = pgTable(
  'storage_objects',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    key: text('key').notNull(),
    category: text('category').notNull(),
    bytes: bytes('bytes'),
    sha256: text('sha256'),
    state: text('state').notNull().default('live'),
    tier: text('tier').notNull().default('hot'),
    ownerTable: text('owner_table'),
    ownerId: idColumn('owner_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
    coldAt: timestamp('cold_at', { withTimezone: true }),
    restoredUntil: timestamp('restored_until', { withTimezone: true }),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_storage_objects_uuid').on(t.orgId, t.uuid),
    unique('uq_storage_objects_key').on(t.orgId, t.key),
    foreignKey({
      name: 'storage_objects_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_storage_objects_category').on(t.orgId, t.category, t.tier),
  ],
);

export const storageReservations = pgTable(
  'storage_reservations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    bytes: bigint('bytes', { mode: 'number' }).notNull(),
    category: text('category').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_storage_reservations_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'storage_reservations_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_storage_reservations_expiry').on(t.expiresAt),
  ],
);
