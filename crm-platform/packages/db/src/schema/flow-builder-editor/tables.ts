/**
 * flow-builder-editor: tables ported from Reference. Mirrors migrations/20261001101400_flb_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
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
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { chatChannels as channels } from '../chat-conversations';
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
    // 20261019090000_flr_runtime.sql: the channel a flow listens on and sends through (replaces the polymorphic trigger_device_id).
    triggerChannelId: idColumn('trigger_channel_id'),
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
    index('idx_flows_org_state').on(t.orgId, t.isPublished, t.isActive),
    // idx_flows_org_updated (updated_at DESC, id DESC) and idx_flows_name_trgm (gin) live in 20261020100100_flb_flows_shape.sql,
    // which also adds the flow_type / trigger_kind / name-length CHECKs.
    index('idx_flows_live_trigger')
      .on(t.orgId, t.triggerKind, t.triggerValue)
      .where(sql`${t.isPublished} AND ${t.isActive}`),
    foreignKey({
      name: 'fk_flows_trigger_channel_id',
      columns: [t.orgId, t.triggerChannelId],
      foreignColumns: [channels.orgId, channels.id],
    }).onDelete('set null'),
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

/** Mirrors migrations/20261028090000_flb_geta_publish.sql: the workspace's Geta console credentials (three sealed values). */
export const flbGetaPublishSettings = pgTable(
  'flb_geta_publish_settings',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    baseUrl: text('base_url'),
    origin: text('origin'),
    authorizationEnc: text('authorization_enc'),
    getaHostEnc: text('geta_host_enc'),
    chatbotRecordEnc: text('chatbot_record_enc'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('flb_geta_publish_settings_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('flb_geta_publish_settings_org_id_key').on(t.orgId),
  ],
);

export type FlbGetaPublishSettingsRow = typeof flbGetaPublishSettings.$inferSelect;
export type NewFlbGetaPublishSettingsRow = typeof flbGetaPublishSettings.$inferInsert;

/** The remote state of a flow's last publish on the Geta console, one row per flow. */
export const flbGetaPublishSyncs = pgTable(
  'flb_geta_publish_syncs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    flowId: idColumn('flow_id').notNull(),
    publishVersion: integer('publish_version').notNull().default(0),
    state: text('state').notNull().default('idle'),
    step: text('step'),
    failedStep: text('failed_step'),
    lastError: text('last_error'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    botId: text('bot_id'),
    configurationUpdatedVersion: integer('configuration_updated_version').notNull().default(0),
    chatbotOverrideEnc: text('chatbot_override_enc'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('flb_geta_publish_syncs_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('flb_geta_publish_syncs_org_id_flow_id_key').on(t.orgId, t.flowId),
    foreignKey({
      name: 'flb_geta_publish_syncs_org_id_flow_id_fkey',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('cascade'),
  ],
);

export type FlbGetaPublishSyncsRow = typeof flbGetaPublishSyncs.$inferSelect;
export type NewFlbGetaPublishSyncsRow = typeof flbGetaPublishSyncs.$inferInsert;
