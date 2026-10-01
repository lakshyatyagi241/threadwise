/**
 * chatbot-widget: tables ported from WaDesk. Mirrors migrations/20261001103300_wgt_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { aiChatAssistants } from '../ai-agents-training/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
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
    index('idx_chatbot_widgets_assistant_id').on(t.orgId, t.assistantId),
    index('idx_chatbot_widgets_user_id').on(t.orgId, t.userId),
    index('idx_chatbot_widgets_status').on(t.orgId, t.status),
  ],
);

export type ChatbotWidgetsRow = typeof chatbotWidgets.$inferSelect;
export type NewChatbotWidgetsRow = typeof chatbotWidgets.$inferInsert;

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
  ],
);

export type ChatbotWidgetVisitorsRow = typeof chatbotWidgetVisitors.$inferSelect;
export type NewChatbotWidgetVisitorsRow = typeof chatbotWidgetVisitors.$inferInsert;
