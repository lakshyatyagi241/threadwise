/**
 * whatsapp-cloud-api-waba: tables ported from Reference. Mirrors migrations/20261001101100_waba_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
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
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations, users } from '../foundation';
import { waProviderConfigs } from '../whatsapp-devices-baileys/tables';

export const wabaGroups = pgTable(
  'waba_groups',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    providerConfigId: idColumn('provider_config_id').notNull(),
    groupId: text('group_id').notNull(),
    subject: text('subject'),
    description: text('description'),
    inviteLink: text('invite_link'),
    joinApprovalMode: text('join_approval_mode'),
    participantCount: integer('participant_count').notNull().default(0),
    suspended: boolean('suspended').notNull().default(false),
    creationTimestamp: timestamp('creation_timestamp', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    metaJson: jsonb('meta_json'),
    /** Who made the group from here (migration 20261109090000); null for a webhook-mirrored group. */
    createdByUserId: idColumn('created_by_user_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_waba_groups_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_waba_groups_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_waba_groups_provider_config_id_group_id').on(t.orgId, t.providerConfigId, t.groupId),
    foreignKey({
      name: 'fk_waba_groups_provider_config_id',
      columns: [t.orgId, t.providerConfigId],
      foreignColumns: [waProviderConfigs.orgId, waProviderConfigs.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_waba_groups_created_by_user_id',
      columns: [t.orgId, t.createdByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_waba_groups_list').on(t.orgId, t.providerConfigId, t.createdAt.desc(), t.id.desc()),
  ],
);

export type WabaGroupsRow = typeof wabaGroups.$inferSelect;
export type NewWabaGroupsRow = typeof wabaGroups.$inferInsert;

export const waCustomerProfiles = pgTable(
  'wa_customer_profiles',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    phone: text('phone').notNull(),
    name: text('name'),
    company: text('company'),
    address: text('address'),
    /** The CRM contact behind this phone (migration 20261029090000); null when none could be made. */
    contactId: idColumn('contact_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_customer_profiles_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_customer_profiles_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    index('idx_wa_customer_profiles_contact_id')
      .on(t.orgId, t.contactId)
      .where(sql`contact_id IS NOT NULL`),
    foreignKey({
      name: 'fk_wa_customer_profiles_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_customer_profiles_phone').on(t.orgId, t.phone),
  ],
);

export type WaCustomerProfilesRow = typeof waCustomerProfiles.$inferSelect;
export type NewWaCustomerProfilesRow = typeof waCustomerProfiles.$inferInsert;
