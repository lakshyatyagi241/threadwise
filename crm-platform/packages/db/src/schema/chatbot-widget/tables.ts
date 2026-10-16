/**
 * chatbot-widget: tables ported from Reference. Mirrors migrations/20261001103300_wgt_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { aiChatAssistants } from '../ai-agents-training/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { flows } from '../flow-builder-editor/tables';
import { organizations, users } from '../foundation';

export const chatbotWidgets = pgTable(
  'chatbot_widgets',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    assistantId: idColumn('assistant_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    embedToken: text('embed_token').notNull(),
    mode: text('mode').notNull().default('ai'),
    targetWhatsappCc: text('target_whatsapp_cc'),
    targetWhatsappNumber: text('target_whatsapp_number'),
    prefilledMessage: text('prefilled_message'),
    position: text('position').notNull().default('bottom_right'),
    buttonColor: text('button_color').notNull().default('#075E54'),
    buttonImageUrl: text('button_image_url'),
    headerTitle: text('header_title').notNull().default('Chat with us'),
    headerBg: text('header_bg').notNull().default('#075E54'),
    headerTextColor: text('header_text_color').notNull().default('#FFFFFF'),
    welcomeMessage: text('welcome_message'),
    messageBubbleColor: text('message_bubble_color').notNull().default('#FFFFFF'),
    messageTextColor: text('message_text_color').notNull().default('#222222'),
    bodyBgKind: text('body_bg_kind').notNull().default('color'),
    bodyBgColor: text('body_bg_color').notNull().default('#ECE5DD'),
    bodyBgImageUrl: text('body_bg_image_url'),
    autoOpen: boolean('auto_open').notNull().default(false),
    buttonLabel: text('button_label').notNull().default('Start chat'),
    actionButtonBg: text('action_button_bg').notNull().default('#075E54'),
    actionButtonTextColor: text('action_button_text_color').notNull().default('#FFFFFF'),
    collectName: boolean('collect_name').notNull().default(true),
    collectEmail: boolean('collect_email').notNull().default(false),
    collectPhone: boolean('collect_phone').notNull().default(false),
    status: text('status').notNull().default('active'),
    allowedDomains: jsonb('allowed_domains'),
    // migrations/20261010100300_wgt_launcher_config.sql: the WhatsApp widget's look and placement, one object (TW-WGT-028).
    launcher: jsonb('launcher')
      .notNull()
      .default(sql`'{}'::jsonb`),
    // migrations/20261223090000_widget_age_gate.sql: the optional age question of the intake form (BL-218). `{}` = off.
    ageGate: jsonb('age_gate')
      .notNull()
      .default(sql`'{}'::jsonb`),
    // migrations/20261114090000_wgt_flow_bots.sql: the flow bot this widget belongs to, and when its owner first saved Customize.
    flowId: idColumn('flow_id'),
    customizedAt: timestamp('customized_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_chatbot_widgets_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_chatbot_widgets_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_chatbot_widgets_embed_token').on(t.embedToken),
    unique('uq_chatbot_widgets_slug').on(t.orgId, t.slug),
    foreignKey({
      name: 'fk_chatbot_widgets_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_chatbot_widgets_assistant_id',
      columns: [t.orgId, t.assistantId],
      foreignColumns: [aiChatAssistants.orgId, aiChatAssistants.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_chatbot_widgets_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('cascade'),
    uniqueIndex('uq_chatbot_widgets_flow_id')
      .on(t.orgId, t.flowId)
      .where(sql`${t.flowId} IS NOT NULL`),
    index('idx_chatbot_widgets_assistant_id').on(t.orgId, t.assistantId),
    index('idx_chatbot_widgets_user_id').on(t.orgId, t.userId),
    index('idx_chatbot_widgets_status').on(t.orgId, t.status),
    // migrations/20261010100100_wgt_public_lookup.sql
    check('chk_chatbot_widgets_mode', sql`${t.mode} IN ('ai', 'whatsapp', 'both')`),
    check('chk_chatbot_widgets_position', sql`${t.position} IN ('bottom_right', 'bottom_left')`),
    check('chk_chatbot_widgets_body_bg_kind', sql`${t.bodyBgKind} IN ('color', 'image')`),
    check('chk_chatbot_widgets_status', sql`${t.status} IN ('active', 'paused')`),
    check('chk_chatbot_widgets_launcher_object', sql`jsonb_typeof(${t.launcher}) = 'object'`),
    check(
      'chk_chatbot_widgets_age_gate_object',
      sql`jsonb_typeof(${t.ageGate}) = 'object' AND pg_column_size(${t.ageGate}) <= 512`,
    ),
  ],
);

export type ChatbotWidgetsRow = typeof chatbotWidgets.$inferSelect;
export type NewChatbotWidgetsRow = typeof chatbotWidgets.$inferInsert;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * Mirror of migrations/20261118090000_wgt_flow_widget_assets.sql (the SQL is the source of truth): the logo and the popup picture
 * a flow bot's widget carries, one row per flow and slot, replaced in place and deleted with the flow.
 */
export const flowWidgetAssets = pgTable(
  'flow_widget_assets',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    flowId: idColumn('flow_id').notNull(),
    slot: text('slot').notNull(),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    etag: text('etag').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('flow_widget_assets_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('flow_widget_assets_org_id_flow_id_slot_key').on(t.orgId, t.flowId, t.slot),
    foreignKey({
      name: 'flow_widget_assets_org_id_flow_id_fkey',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('cascade'),
    check('chk_flow_widget_assets_slot', sql`${t.slot} IN ('logo', 'popup')`),
    check(
      'chk_flow_widget_assets_mime',
      sql`${t.mime} IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')`,
    ),
    check('chk_flow_widget_assets_size', sql`octet_length(${t.bytes}) <= 1048576`),
  ],
);

export type FlowWidgetAssetsRow = typeof flowWidgetAssets.$inferSelect;

export const chatbotWidgetVisitors = pgTable(
  'chatbot_widget_visitors',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    widgetId: idColumn('widget_id').notNull(),
    conversationId: idColumn('conversation_id'),
    visitorUuid: text('visitor_uuid').notNull(),
    name: text('name'),
    email: text('email'),
    phone: text('phone'),
    referrerUrl: text('referrer_url'),
    userAgent: text('user_agent'),
    ip: text('ip'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    // migrations/20261223090000_widget_age_gate.sql: when this visitor's answer passed the widget's age gate (BL-218).
    ageCheckedAt: timestamp('age_checked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_chatbot_widget_visitors_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_chatbot_widget_visitors_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_chatbot_widget_visitors_visitor_uuid').on(t.visitorUuid),
    foreignKey({
      name: 'fk_chatbot_widget_visitors_widget_id',
      columns: [t.orgId, t.widgetId],
      foreignColumns: [chatbotWidgets.orgId, chatbotWidgets.id],
    }).onDelete('cascade'),
    index('idx_chatbot_widget_visitors_conversation_id').on(t.orgId, t.conversationId),
    index('idx_chatbot_widget_visitors_widget_id').on(t.orgId, t.widgetId),
    // migrations/20261010100100_wgt_public_lookup.sql
    index('idx_chatbot_widget_visitors_uuid_widget').on(t.orgId, t.widgetId, t.visitorUuid),
  ],
);

export type ChatbotWidgetVisitorsRow = typeof chatbotWidgetVisitors.$inferSelect;
export type NewChatbotWidgetVisitorsRow = typeof chatbotWidgetVisitors.$inferInsert;
