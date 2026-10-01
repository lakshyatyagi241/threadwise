/**
 * flow-builder-editor: tables ported from Reference. Mirrors migrations/20261001101400_flb_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
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
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const flows = pgTable(
  'flows',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    flowName: text('flow_name').notNull(),
    flowData: jsonb('flow_data'),
    flowFilePath: text('flow_file_path'),
    category: text('category'),
    triggerKind: text('trigger_kind').notNull().default('keyword'),
    triggerValue: bigint('trigger_value', { mode: 'number' }),
    triggerKeywords: text('trigger_keywords'),
    triggerDeviceId: idColumn('trigger_device_id'),
    isPublished: boolean('is_published').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    provider: text('provider').notNull().default('baileys'),
    flowType: text('flow_type').notNull().default('chat'),
    instaflowFlowId: idColumn('instaflow_flow_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_flows_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_flows_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flows_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_flows_category').on(t.orgId, t.category),
    index('idx_flows_flow_type').on(t.orgId, t.flowType),
    index('idx_flows_instaflow_flow_id').on(t.orgId, t.instaflowFlowId),
    index('idx_flows_trigger_kind_trigger_value').on(t.orgId, t.triggerKind, t.triggerValue),
    index('idx_flows_user_id_is_active').on(t.orgId, t.userId, t.isActive),
    index('idx_flows_provider').on(t.orgId, t.provider),
  ],
);

export type FlowsRow = typeof flows.$inferSelect;
export type NewFlowsRow = typeof flows.$inferInsert;

export const flowConnectedDevices = pgTable(
  'flow_connected_devices',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    flowId: idColumn('flow_id').notNull(),
    deviceNumber: text('device_number').notNull(),
    deviceName: text('device_name'),
    status: text('status').notNull().default('active'),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_flow_connected_devices_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_flow_connected_devices_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_flow_connected_devices_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('cascade'),
    index('idx_flow_connected_devices_flow_id_status').on(t.orgId, t.flowId, t.status),
  ],
);

export type FlowConnectedDevicesRow = typeof flowConnectedDevices.$inferSelect;
export type NewFlowConnectedDevicesRow = typeof flowConnectedDevices.$inferInsert;

export const flowTemplates = pgTable(
  'flow_templates',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    flowType: text('flow_type').notNull().default('chat'),
    category: text('category'),
    flowData: jsonb('flow_data').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdBy: idColumn('created_by'),
    cloneCount: integer('clone_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    index('idx_flow_templates_category').on(t.category),
    index('idx_flow_templates_flow_type').on(t.flowType),
    index('idx_flow_templates_is_active').on(t.isActive),
  ],
);

export type FlowTemplatesRow = typeof flowTemplates.$inferSelect;
export type NewFlowTemplatesRow = typeof flowTemplates.$inferInsert;
