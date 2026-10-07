/**
 * whatsapp-devices-baileys: tables ported from WaDesk. Mirrors migrations/20261001101000_wadev_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
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
