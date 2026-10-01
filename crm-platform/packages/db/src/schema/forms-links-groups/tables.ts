/**
 * forms-links-groups: tables ported from WaDesk. Mirrors migrations/20261001103400_wfl_wadesk_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
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
import { contacts } from '../crm';
import { organizations, users } from '../foundation';
import { waProviderConfigs } from '../whatsapp-devices-baileys/tables';

export const waChatLinks = pgTable(
  'wa_chat_links',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    countryCode: text('country_code').notNull(),
    phoneNumber: text('phone_number').notNull(),
    welcomeMessage: text('welcome_message'),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    clickCount: bigint('click_count', { mode: 'number' }).notNull().default(0),
    lastClickedAt: timestamp('last_clicked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_chat_links_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_chat_links_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_chat_links_slug').on(t.slug),
    foreignKey({
      name: 'fk_wa_chat_links_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_wa_chat_links_user_id').on(t.orgId, t.userId),
    index('idx_wa_chat_links_status').on(t.orgId, t.status),
  ],
);

export type WaChatLinksRow = typeof waChatLinks.$inferSelect;
export type NewWaChatLinksRow = typeof waChatLinks.$inferInsert;

export const waForms = pgTable(
  'wa_forms',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    title: text('title').notNull(),
    purpose: text('purpose'),
    slug: text('slug').notNull(),
    audienceType: text('audience_type').notNull().default('lead_capture'),
    submissionCap: integer('submission_cap').notNull().default(0),
    capReachedNote: text('cap_reached_note'),
    sendButtonLabel: text('send_button_label').notNull().default('Send'),
    thankYouNote: text('thank_you_note'),
    definitionJson: jsonb('definition_json'),
    status: text('status').notNull().default('draft'),
    metaFlowId: text('meta_flow_id'),
    providerConfigId: idColumn('provider_config_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishError: text('publish_error'),
    submissionCount: integer('submission_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_forms_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_forms_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_forms_slug').on(t.orgId, t.slug),
    foreignKey({
      name: 'fk_wa_forms_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_forms_provider_config_id',
      columns: [t.orgId, t.providerConfigId],
      foreignColumns: [waProviderConfigs.orgId, waProviderConfigs.id],
    }).onDelete('set null'),
    index('idx_wa_forms_user_id').on(t.orgId, t.userId),
    index('idx_wa_forms_status').on(t.orgId, t.status),
  ],
);

export type WaFormsRow = typeof waForms.$inferSelect;
export type NewWaFormsRow = typeof waForms.$inferInsert;

export const waFormSubmissions = pgTable(
  'wa_form_submissions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    formId: idColumn('form_id').notNull(),
    contactId: idColumn('contact_id'),
    conversationId: idColumn('conversation_id'),
    flowToken: text('flow_token'),
    callerPhone: text('caller_phone'),
    answersJson: jsonb('answers_json'),
    metaPayload: jsonb('meta_payload'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_form_submissions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_form_submissions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_form_submissions_form_id',
      columns: [t.orgId, t.formId],
      foreignColumns: [waForms.orgId, waForms.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wa_form_submissions_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    index('idx_wa_form_submissions_contact_id').on(t.orgId, t.contactId),
    index('idx_wa_form_submissions_conversation_id').on(t.orgId, t.conversationId),
    index('idx_wa_form_submissions_flow_token').on(t.orgId, t.flowToken),
    index('idx_wa_form_submissions_form_id_submitted_at').on(t.orgId, t.formId, t.submittedAt),
    index('idx_wa_form_submissions_submitted_at').on(t.orgId, t.submittedAt),
  ],
);

export type WaFormSubmissionsRow = typeof waFormSubmissions.$inferSelect;
export type NewWaFormSubmissionsRow = typeof waFormSubmissions.$inferInsert;

export const waGroups = pgTable(
  'wa_groups',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    devicePhone: text('device_phone'),
    groupJid: text('group_jid').notNull(),
    subject: text('subject'),
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    groupCode: text('group_code'),
    metaJson: jsonb('meta_json'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_groups_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_groups_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_groups_group_jid').on(t.orgId, t.groupJid),
    index('idx_wa_groups_device_phone').on(t.orgId, t.devicePhone),
    index('idx_wa_groups_group_code').on(t.orgId, t.groupCode),
  ],
);

export type WaGroupsRow = typeof waGroups.$inferSelect;
export type NewWaGroupsRow = typeof waGroups.$inferInsert;

export const waGroupMembers = pgTable(
  'wa_group_members',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    groupJid: text('group_jid').notNull(),
    phone: text('phone').notNull(),
    isAdmin: boolean('is_admin').notNull().default(false),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_group_members_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_group_members_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_group_members_group_jid_phone').on(t.orgId, t.groupJid, t.phone),
    index('idx_wa_group_members_phone').on(t.orgId, t.phone),
  ],
);

export type WaGroupMembersRow = typeof waGroupMembers.$inferSelect;
export type NewWaGroupMembersRow = typeof waGroupMembers.$inferInsert;
