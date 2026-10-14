/**
 * whatsapp-devices-baileys: tables ported from Reference. Mirrors migrations/20261001101000_wadev_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const devices = pgTable(
  'devices',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    assignedUserId: idColumn('assigned_user_id'),
    deviceName: text('device_name').notNull(),
    countryCode: text('country_code'),
    phoneNumber: text('phone_number').notNull(),
    region: text('region'),
    active: boolean('active').notNull().default(false),
    activateAfterPairing: boolean('activate_after_pairing').notNull().default(true),
    status: text('status').notNull().default('disconnected'),
    proxyEnabled: boolean('proxy_enabled').notNull().default(false),
    proxyType: text('proxy_type'),
    proxyHost: text('proxy_host'),
    proxyPort: smallint('proxy_port'),
    proxyUsername: text('proxy_username'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    proxyPassword: text('proxy_password'),
    proxyStatus: text('proxy_status'),
    proxyEgressIp: text('proxy_egress_ip'),
    proxyCheckedAt: timestamp('proxy_checked_at', { withTimezone: true }),
    sent24h: integer('sent_24h').notNull().default(0),
    failed24h: integer('failed_24h').notNull().default(0),
    warmerConfig: jsonb('warmer_config'),
    warmDay: date('warm_day'),
    warmDayCount: integer('warm_day_count').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** Personal-connect (20261104090000): the richer state the runtime writes with `status`; `status` stays for the senders. */
    connectionState: text('connection_state').notNull().default('created'),
    stateReason: text('state_reason'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }),
    /** Country code + local number as digits, kept by the API; unique per workspace where set. */
    phoneDigits: text('phone_digits'),
    /** The history import chosen for the pairing in progress (20261202090000): `none`, `recent` or `full`. Reset when the run ends. */
    historyImportMode: text('history_import_mode').notNull().default('none'),
    /** The risk acknowledgement that led to this device. */
    consentId: idColumn('consent_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_devices_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_devices_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_devices_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_devices_assigned_user_id',
      columns: [t.orgId, t.assignedUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_devices_consent',
      columns: [t.orgId, t.consentId],
      foreignColumns: [deviceRiskAcknowledgements.orgId, deviceRiskAcknowledgements.id],
    }).onDelete('set null'),
    uniqueIndex('uq_devices_org_phone_digits')
      .on(t.orgId, t.phoneDigits)
      .where(sql`${t.phoneDigits} IS NOT NULL`),
    index('idx_devices_connection_state').on(t.orgId, t.connectionState),
    index('idx_devices_active').on(t.orgId, t.active),
    index('idx_devices_assigned_user_id').on(t.orgId, t.assignedUserId),
    index('idx_devices_region').on(t.orgId, t.region),
    index('idx_devices_status').on(t.orgId, t.status),
    index('idx_devices_user_id_active').on(t.orgId, t.userId, t.active),
  ],
);

export type DevicesRow = typeof devices.$inferSelect;
export type NewDevicesRow = typeof devices.$inferInsert;

/** Who accepted which version of the personal-connect risk notice. Append-only (trigger); mirrors 20261104090000_wadev_personal_connect.sql. */
export const deviceRiskAcknowledgements = pgTable(
  'device_risk_acknowledgements',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    userName: text('user_name').notNull(),
    policyVersion: text('policy_version').notNull(),
    /** SHA-256 (hex) of the canonical English text of that version. */
    textSha256: text('text_sha256').notNull(),
    locale: text('locale').notNull().default('en'),
    deviceUuid: uuid('device_uuid'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_device_risk_acknowledgements_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_device_risk_acknowledgements_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_device_risk_ack_user',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_device_risk_ack_user_version').on(t.orgId, t.userId, t.policyVersion),
  ],
);

export type DeviceRiskAcknowledgementsRow = typeof deviceRiskAcknowledgements.$inferSelect;
export type NewDeviceRiskAcknowledgementsRow = typeof deviceRiskAcknowledgements.$inferInsert;

export const waProviderConfigs = pgTable(
  'wa_provider_configs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    provider: text('provider').notNull(),
    status: text('status').notNull().default('pending'),
    callingEnabled: boolean('calling_enabled').notNull().default(false),
    callingEnabledAt: timestamp('calling_enabled_at', { withTimezone: true }),
    callingEnabledMeta: jsonb('calling_enabled_meta'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    credentialsJson: text('credentials_json'),
    metaJson: jsonb('meta_json'),
    phoneNumber: text('phone_number'),
    displayLabel: text('display_label'),
    isPrimary: boolean('is_primary').notNull().default(false),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastHealthAt: timestamp('last_health_at', { withTimezone: true }),
    warmerConfig: jsonb('warmer_config'),
    warmDay: date('warm_day'),
    warmDayCount: integer('warm_day_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_provider_configs_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_provider_configs_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_wa_provider_configs_provider_status').on(t.orgId, t.provider, t.status),
    index('idx_wa_provider_configs_is_primary').on(t.orgId, t.isPrimary),
  ],
);

export type WaProviderConfigsRow = typeof waProviderConfigs.$inferSelect;
export type NewWaProviderConfigsRow = typeof waProviderConfigs.$inferInsert;

/** One member in the cached roster of a personal-number group (`wa_device_groups.participants`). */
export interface WaDeviceGroupParticipant {
  jid: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  admin: 'superadmin' | 'admin' | null;
}
/** One person waiting to be let in (`wa_device_groups.join_requests`). */
export interface WaDeviceGroupJoinRequest {
  jid: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  requestedAt: string | null;
}

/**
 * The groups of a personal (unofficial) number. Mirrors migration 20261120090000_wa_device_groups.sql. `groupJid` is the BARE id (no
 * `@g.us`), the same as the inbox thread key `g:<id>`. A group the number left is kept with `leftAt` set. `inviteCode` is a bearer secret.
 */
export const waDeviceGroups = pgTable(
  'wa_device_groups',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    deviceId: idColumn('device_id').notNull(),
    groupJid: text('group_jid').notNull(),
    subject: text('subject'),
    description: text('description'),
    size: integer('size').notNull().default(0),
    isAdmin: boolean('is_admin').notNull().default(false),
    announce: boolean('announce').notNull().default(false),
    restrictInfo: boolean('restrict_info').notNull().default(false),
    joinApproval: boolean('join_approval').notNull().default(false),
    memberAddMode: text('member_add_mode').notNull().default('all_member_add'),
    ownerJid: text('owner_jid'),
    addressingMode: text('addressing_mode'),
    inviteCode: text('invite_code'),
    pictureUrl: text('picture_url'),
    creationAt: timestamp('creation_at', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    leftAt: timestamp('left_at', { withTimezone: true }),
    participants: jsonb('participants')
      .$type<WaDeviceGroupParticipant[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    joinRequests: jsonb('join_requests')
      .$type<WaDeviceGroupJoinRequest[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdByUserId: idColumn('created_by_user_id'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_device_groups_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_wa_device_groups_device_jid').on(t.orgId, t.deviceId, t.groupJid),
    foreignKey({
      name: 'wa_device_groups_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_device_groups_device_id',
      columns: [t.orgId, t.deviceId],
      foreignColumns: [devices.orgId, devices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_device_groups_created_by_user_id',
      columns: [t.orgId, t.createdByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check(
      'ck_wa_device_groups_member_add_mode',
      sql`${t.memberAddMode} in ('all_member_add', 'admin_add')`,
    ),
    index('idx_wa_device_groups_list').on(t.orgId, t.deviceId, t.createdAt.desc(), t.id.desc()),
  ],
);

export type WaDeviceGroupsRow = typeof waDeviceGroups.$inferSelect;
export type NewWaDeviceGroupsRow = typeof waDeviceGroups.$inferInsert;

/** One run of the opt-in history import of a personal number. Mirrors 20261202090000_wa_device_history_import.sql. Counts only: no text, no phone. */
export const waDeviceHistoryImports = pgTable(
  'wa_device_history_imports',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    deviceId: idColumn('device_id').notNull(),
    mode: text('mode').notNull(),
    state: text('state').notNull().default('idle'),
    requestedByUserId: idColumn('requested_by_user_id'),
    windowDays: integer('window_days').notNull(),
    maxMessages: integer('max_messages').notNull(),
    maxMessagesPerChat: integer('max_messages_per_chat').notNull(),
    maxChats: integer('max_chats').notNull(),
    chatsCount: integer('chats_count').notNull().default(0),
    contactsCount: integer('contacts_count').notNull().default(0),
    messagesCount: integer('messages_count').notNull().default(0),
    batchesCount: integer('batches_count').notNull().default(0),
    progress: smallint('progress').notNull().default(0),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    lastBatchAt: timestamp('last_batch_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_device_history_imports_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'wa_device_history_imports_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_device_history_imports_device',
      columns: [t.orgId, t.deviceId],
      foreignColumns: [devices.orgId, devices.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_device_history_imports_user',
      columns: [t.orgId, t.requestedByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check('ck_wa_device_history_imports_mode', sql`${t.mode} in ('recent', 'full')`),
    check(
      'ck_wa_device_history_imports_state',
      sql`${t.state} in ('idle', 'running', 'done', 'failed', 'cancelled', 'limit_reached')`,
    ),
    check('ck_wa_device_history_imports_progress', sql`${t.progress} between 0 and 100`),
    check(
      'ck_wa_device_history_imports_counts',
      sql`${t.chatsCount} >= 0 and ${t.contactsCount} >= 0 and ${t.messagesCount} >= 0 and ${t.batchesCount} >= 0`,
    ),
    uniqueIndex('uq_wa_device_history_imports_active')
      .on(t.orgId, t.deviceId)
      .where(sql`${t.state} in ('idle', 'running')`),
    index('idx_wa_device_history_imports_device').on(t.orgId, t.deviceId, t.id.desc()),
    index('idx_wa_device_history_imports_sweep')
      .on(t.state, t.lastBatchAt)
      .where(sql`${t.state} in ('idle', 'running')`),
  ],
);

export type WaDeviceHistoryImportsRow = typeof waDeviceHistoryImports.$inferSelect;
