/**
 * message-templates: tables ported from Reference. Mirrors migrations/20261001101300_tpl_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { waProviderConfigs } from '../whatsapp-devices-baileys/tables';

export const waTemplates = pgTable(
  'wa_templates',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    templateName: text('template_name').notNull(),
    header: text('header'),
    headerLocation: jsonb('header_location'),
    templateBody: text('template_body').notNull(),
    footer: text('footer'),
    codeExpirationMinutes: smallint('code_expiration_minutes'),
    buttons: jsonb('buttons'),
    carouselData: jsonb('carousel_data'),
    variableMap: jsonb('variable_map'),
    rejectionReason: text('rejection_reason'),
    rejectionReasonCode: text('rejection_reason_code'),
    category: text('category').notNull().default('utility'),
    metaCategory: text('meta_category'),
    templateType: text('template_type').notNull().default('standard'),
    attachmentType: text('attachment_type'),
    attachmentFile: text('attachment_file'),
    headerSampleUrl: text('header_sample_url'),
    language: text('language').notNull().default('en_US'),
    parameterFormat: text('parameter_format').notNull().default('POSITIONAL'),
    status: text('status').notNull().default('pending'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    pausedUntil: timestamp('paused_until', { withTimezone: true }),
    providerConfigId: idColumn('provider_config_id'),
    metaTemplateId: text('meta_template_id'),
    twilioContentSid: text('twilio_content_sid'),
    metaStatus: text('meta_status'),
    channel: text('channel'),
    qualityScore: text('quality_score'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_templates_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_templates_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_templates_meta_template_id').on(t.metaTemplateId),
    foreignKey({
      name: 'fk_wa_templates_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_templates_provider_config_id',
      columns: [t.orgId, t.providerConfigId],
      foreignColumns: [waProviderConfigs.orgId, waProviderConfigs.id],
    }).onDelete('set null'),
    index('idx_wa_templates_category_status').on(t.orgId, t.category, t.status),
    index('idx_wa_templates_provider_config_id_meta_status').on(
      t.orgId,
      t.providerConfigId,
      t.metaStatus,
    ),
    index('idx_wa_templates_channel').on(t.orgId, t.channel),
    index('idx_wa_templates_meta_status').on(t.orgId, t.metaStatus),
    index('idx_wa_templates_status').on(t.orgId, t.status),
    index('idx_wa_templates_twilio_content_sid').on(t.orgId, t.twilioContentSid),
    index('idx_wa_templates_user_id_status').on(t.orgId, t.userId, t.status),
  ],
);

export type WaTemplatesRow = typeof waTemplates.$inferSelect;
export type NewWaTemplatesRow = typeof waTemplates.$inferInsert;
