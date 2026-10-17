/**
 * node-bridge-runtime: tables ported from Reference. Mirrors migrations/20261001101200_node_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';
import { devices } from '../whatsapp-devices-baileys/tables';

export const deviceAuthState = pgTable(
  'device_auth_state',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    deviceId: idColumn('device_id').notNull(),
    name: text('name').notNull(),
    value: text('value').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_device_auth_state_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_device_auth_state_device_name').on(t.orgId, t.deviceId, t.name),
    foreignKey({
      name: 'fk_device_auth_state_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'device_auth_state_org_id_device_id_fkey',
      columns: [t.orgId, t.deviceId],
      foreignColumns: [devices.orgId, devices.id],
    }).onDelete('cascade'),
  ],
);

export type DeviceAuthStateRow = typeof deviceAuthState.$inferSelect;
export type NewDeviceAuthStateRow = typeof deviceAuthState.$inferInsert;

/**
 * The per-workspace allow-list of the unofficial WhatsApp engine (owner decision 2026-10-06). A row means the workspace may use
 * personal numbers while the platform switch is on; no row means off. Mirrors migrations/20261103090000_unofficial_whatsapp_workspaces.sql.
 */
export const unofficialWhatsappWorkspaces = pgTable(
  'unofficial_whatsapp_workspaces',
  {
    orgId: orgIdColumn(),
    enabledAt: timestamp('enabled_at', { withTimezone: true }).notNull().defaultNow(),
    enabledByOperatorId: bigint('enabled_by_operator_id', { mode: 'number' }),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId] }),
    foreignKey({
      name: 'unofficial_whatsapp_workspaces_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export type UnofficialWhatsappWorkspaceRow = typeof unofficialWhatsappWorkspaces.$inferSelect;
export type NewUnofficialWhatsappWorkspaceRow = typeof unofficialWhatsappWorkspaces.$inferInsert;
