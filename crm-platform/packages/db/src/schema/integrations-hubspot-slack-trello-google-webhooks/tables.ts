/**
 * integrations-hubspot-slack-trello-google-webhooks: tables ported from Reference. Mirrors migrations/20261001102300_intg_threadwise_schema.sql.
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
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations, users } from '../foundation';

export const hubspotIntegrations = pgTable(
  'hubspot_integrations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    portalId: text('portal_id'),
    portalName: text('portal_name'),
    portalEmail: text('portal_email'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    accessToken: text('access_token').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    refreshToken: text('refresh_token').notNull(),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    scopes: text('scopes'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata'),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_hubspot_integrations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_hubspot_integrations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_hubspot_integrations_portal_id').on(t.orgId, t.portalId),
    foreignKey({
      name: 'fk_hubspot_integrations_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_hubspot_integrations_user_id').on(t.orgId, t.userId),
  ],
);

export type HubspotIntegrationsRow = typeof hubspotIntegrations.$inferSelect;
export type NewHubspotIntegrationsRow = typeof hubspotIntegrations.$inferInsert;

export const hubspotIntegrationLogs = pgTable(
  'hubspot_integration_logs',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('hubspot_integration_logs_id_seq')`),
    orgId: orgIdColumn(),
    integrationId: idColumn('integration_id').notNull(),
    eventType: text('event_type').notNull(),
    status: text('status').notNull().default('sent'),
    objectId: text('object_id'),
    payload: jsonb('payload'),
    response: jsonb('response'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_hubspot_integration_logs_integration_id_created_at').on(
      t.orgId,
      t.integrationId,
      t.createdAt,
    ),
  ],
);

export type HubspotIntegrationLogsRow = typeof hubspotIntegrationLogs.$inferSelect;
export type NewHubspotIntegrationLogsRow = typeof hubspotIntegrationLogs.$inferInsert;

export const incomingWebhooks = pgTable(
  'incoming_webhooks',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    name: text('name'),
    token: text('token').notNull(),
    forwardUrl: text('forward_url'),
    forwardEnabled: boolean('forward_enabled').notNull().default(false),
    leadConfig: jsonb('lead_config'),
    templateConfig: jsonb('template_config'),
    isActive: boolean('is_active').notNull().default(true),
    receivedCount: bigint('received_count', { mode: 'number' }).notNull().default(0),
    lastReceivedAt: timestamp('last_received_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_incoming_webhooks_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_incoming_webhooks_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_incoming_webhooks_token').on(t.token),
    foreignKey({
      name: 'fk_incoming_webhooks_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_incoming_webhooks_is_active').on(t.orgId, t.isActive),
    index('idx_incoming_webhooks_user_id').on(t.orgId, t.userId),
  ],
);

export type IncomingWebhooksRow = typeof incomingWebhooks.$inferSelect;
export type NewIncomingWebhooksRow = typeof incomingWebhooks.$inferInsert;

export const incomingWebhookEvents = pgTable(
  'incoming_webhook_events',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    incomingWebhookId: idColumn('incoming_webhook_id').notNull(),
    method: text('method').notNull().default('POST'),
    sourceIp: text('source_ip'),
    contentType: text('content_type'),
    headers: jsonb('headers'),
    payload: text('payload'),
    forwarded: boolean('forwarded').notNull().default(false),
    forwardStatus: smallint('forward_status'),
    forwardError: text('forward_error'),
    leadContactId: idColumn('lead_contact_id'),
    templateSendStatus: text('template_send_status'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_incoming_webhook_events_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_incoming_webhook_events_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_incoming_webhook_events_incoming_webhook_id',
      columns: [t.orgId, t.incomingWebhookId],
      foreignColumns: [incomingWebhooks.orgId, incomingWebhooks.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_incoming_webhook_events_lead_contact_id',
      columns: [t.orgId, t.leadContactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    index('idx_incoming_webhook_events_incoming_webhook_id').on(t.orgId, t.incomingWebhookId),
    index('idx_incoming_webhook_events_received_at').on(t.orgId, t.receivedAt),
  ],
);

export type IncomingWebhookEventsRow = typeof incomingWebhookEvents.$inferSelect;
export type NewIncomingWebhookEventsRow = typeof incomingWebhookEvents.$inferInsert;

export const slackIntegrations = pgTable(
  'slack_integrations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    teamId: text('team_id'),
    teamName: text('team_name'),
    botUserId: text('bot_user_id'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    botToken: text('bot_token').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    signingSecret: text('signing_secret').notNull(),
    slashCommand: text('slash_command').notNull().default('/wa'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_slack_integrations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_slack_integrations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_slack_integrations_team_id').on(t.teamId),
    foreignKey({
      name: 'fk_slack_integrations_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_slack_integrations_user_id').on(t.orgId, t.userId),
  ],
);

export type SlackIntegrationsRow = typeof slackIntegrations.$inferSelect;
export type NewSlackIntegrationsRow = typeof slackIntegrations.$inferInsert;

export const slackIntegrationLogs = pgTable(
  'slack_integration_logs',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('slack_integration_logs_id_seq')`),
    orgId: orgIdColumn(),
    integrationId: idColumn('integration_id'),
    event: text('event').notNull().default('command'),
    detail: text('detail'),
    status: text('status').notNull().default('ok'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_slack_integration_logs_integration_id').on(t.orgId, t.integrationId),
    index('idx_slack_integration_logs_created_at').on(t.orgId, t.createdAt),
  ],
);

export type SlackIntegrationLogsRow = typeof slackIntegrationLogs.$inferSelect;
export type NewSlackIntegrationLogsRow = typeof slackIntegrationLogs.$inferInsert;

export const trelloIntegrations = pgTable(
  'trello_integrations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    apiKey: text('api_key').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    apiSecret: text('api_secret').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    token: text('token').notNull(),
    boardId: text('board_id').notNull(),
    boardName: text('board_name'),
    webhookId: text('webhook_id'),
    events: jsonb('events'),
    notifyMode: text('notify_mode').notNull().default('assignee'),
    notifyNumber: text('notify_number'),
    memberMap: jsonb('member_map'),
    status: text('status').notNull().default('active'),
    metadata: jsonb('metadata'),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_trello_integrations_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_trello_integrations_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_trello_integrations_board_id').on(t.orgId, t.boardId),
    foreignKey({
      name: 'fk_trello_integrations_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_trello_integrations_user_id').on(t.orgId, t.userId),
    index('idx_trello_integrations_webhook_id').on(t.orgId, t.webhookId),
  ],
);

export type TrelloIntegrationsRow = typeof trelloIntegrations.$inferSelect;
export type NewTrelloIntegrationsRow = typeof trelloIntegrations.$inferInsert;

export const trelloIntegrationLogs = pgTable(
  'trello_integration_logs',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('trello_integration_logs_id_seq')`),
    orgId: orgIdColumn(),
    integrationId: idColumn('integration_id'),
    event: text('event').notNull().default('webhook'),
    detail: text('detail'),
    status: text('status').notNull().default('ok'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_trello_integration_logs_integration_id').on(t.orgId, t.integrationId),
    index('idx_trello_integration_logs_created_at').on(t.orgId, t.createdAt),
  ],
);

export type TrelloIntegrationLogsRow = typeof trelloIntegrationLogs.$inferSelect;
export type NewTrelloIntegrationLogsRow = typeof trelloIntegrationLogs.$inferInsert;

export const webhooks = pgTable(
  'webhooks',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    name: text('name'),
    environment: text('environment'),
    httpMethod: text('http_method').notNull().default('POST'),
    webhookUrl: text('webhook_url').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    secret: text('secret'),
    events: jsonb('events'),
    status: boolean('status').notNull().default(true),
    isFailing: boolean('is_failing').notNull().default(false),
    successCount: integer('success_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    retryCount: integer('retry_count').notNull().default(0),
    lastStatusCode: integer('last_status_code'),
    lastLatencyMs: integer('last_latency_ms'),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    lastError: text('last_error'),
    iconColor: text('icon_color'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_webhooks_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_webhooks_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_webhooks_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_webhooks_user_id').on(t.orgId, t.userId),
  ],
);

export type WebhooksRow = typeof webhooks.$inferSelect;
export type NewWebhooksRow = typeof webhooks.$inferInsert;

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('webhook_deliveries_id_seq')`),
    orgId: orgIdColumn(),
    webhookId: idColumn('webhook_id').notNull(),
    eventName: text('event_name').notNull(),
    statusCode: smallint('status_code'),
    latencyMs: integer('latency_ms'),
    isRetry: boolean('is_retry').notNull().default(false),
    attempts: smallint('attempts').notNull().default(1),
    payload: jsonb('payload'),
    responseBody: text('response_body'),
    error: text('error'),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.firedAt] }),
    index('idx_webhook_deliveries_fired_at').on(t.orgId, t.firedAt),
    index('idx_webhook_deliveries_webhook_id').on(t.orgId, t.webhookId),
  ],
);

export type WebhookDeliveriesRow = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDeliveriesRow = typeof webhookDeliveries.$inferInsert;
