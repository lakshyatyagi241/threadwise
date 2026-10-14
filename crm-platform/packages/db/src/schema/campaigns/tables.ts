/**
 * campaigns: tables ported from Reference. Mirrors migrations/20261001103000_camp_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
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
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { flows } from '../flow-builder-editor/tables';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';

/**
 * A recurring broadcast: one row per series, one child `wpcampaigns` row per occurrence (`series_id`, `occurrence_no`). The worker's
 * planner creates the child that is due and moves `next_index` / `next_run_at` along the rule.
 */
export const campSeries = pgTable(
  'camp_series',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    rule: jsonb('rule').notNull(),
    blueprint: jsonb('blueprint').notNull(),
    templateId: idColumn('template_id'),
    provider: text('provider').notNull(),
    deviceId: idColumn('device_id'),
    nextIndex: integer('next_index').notNull().default(0),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    occurrencesCreated: integer('occurrences_created').notNull().default(0),
    occurrencesSkipped: integer('occurrences_skipped').notNull().default(0),
    lastOccurrenceAt: timestamp('last_occurrence_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('camp_series_org_id_uuid_key').on(t.orgId, t.uuid),
    check('ck_camp_series_status', sql`status IN ('active', 'paused', 'ended', 'cancelled')`),
    foreignKey({
      name: 'fk_camp_series_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_camp_series_template',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_camp_series_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_camp_series_due')
      .on(t.nextRunAt)
      .where(sql`status = 'active' AND next_run_at IS NOT NULL`),
    index('idx_camp_series_org_status').on(t.orgId, t.status, t.id.desc()),
  ],
);
export type CampSeriesRow = typeof campSeries.$inferSelect;

/**
 * The broadcast wizard's CSV audience (migrations/20261104090000_camp_wizard_csv_uploads.sql): one parsed upload, and its rows
 * (valid, duplicate or invalid). `expires_at` NULL pins it to a recurring broadcast; otherwise the worker deletes it after a week.
 */
export const campWizardCsv = pgTable(
  'camp_wizard_csv',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    fileName: text('file_name').notNull(),
    totalRows: integer('total_rows').notNull().default(0),
    validCount: integer('valid_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    invalidCount: integer('invalid_count').notNull().default(0),
    createdBy: idColumn('created_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('camp_wizard_csv_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'camp_wizard_csv_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_camp_wizard_csv_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_camp_wizard_csv_expiry')
      .on(t.expiresAt)
      .where(sql`expires_at IS NOT NULL`),
  ],
);

export const campWizardCsvRows = pgTable(
  'camp_wizard_csv_rows',
  {
    orgId: orgIdColumn(),
    uploadId: idColumn('upload_id').notNull(),
    line: integer('line').notNull(),
    kind: text('kind').notNull(),
    rawValue: text('raw_value'),
    phone: text('phone'),
    digits: text('digits'),
    name: text('name'),
    reason: text('reason'),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.uploadId, t.line] }),
    check('ck_camp_wizard_csv_rows_kind', sql`kind IN ('valid', 'duplicate', 'invalid')`),
    foreignKey({
      name: 'fk_camp_wizard_csv_rows_upload',
      columns: [t.orgId, t.uploadId],
      foreignColumns: [campWizardCsv.orgId, campWizardCsv.id],
    }).onDelete('cascade'),
    index('idx_camp_wizard_csv_rows_valid')
      .on(t.orgId, t.uploadId, t.digits)
      .where(sql`kind = 'valid'`),
  ],
);

export const wpcampaigns = pgTable(
  'wpcampaigns',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    scheduledMessageId: idColumn('scheduled_message_id'),
    campaignName: text('campaign_name').notNull(),
    deviceId: idColumn('device_id'),
    campaignType: text('campaign_type').notNull().default('text'),
    status: text('status').notNull().default('draft'),
    abTesting: boolean('ab_testing').notNull().default(false),
    abSplit: smallint('ab_split').notNull().default(50),
    customMessage: text('custom_message'),
    customMessageB: text('custom_message_b'),
    customHeader: text('custom_header'),
    customFooter: text('custom_footer'),
    customButtons: jsonb('custom_buttons'),
    customQuickReplies: jsonb('custom_quick_replies'),
    customVariableMap: jsonb('custom_variable_map'),
    customImage: text('custom_image'),
    customVideo: text('custom_video'),
    customDocument: text('custom_document'),
    templateId: idColumn('template_id'),
    templateIdA: idColumn('template_id_a'),
    templateIdB: idColumn('template_id_b'),
    templateOverrides: jsonb('template_overrides'),
    templateOverridesB: jsonb('template_overrides_b'),
    flowId: idColumn('flow_id'),
    flowIdB: idColumn('flow_id_b'),
    useAttributes: boolean('use_attributes').notNull().default(false),
    trackingEnabled: boolean('tracking_enabled').notNull().default(true),
    /** Retry a transient failure under the platform's retry settings; false makes the first failure final. */
    retryFailed: boolean('retry_failed').notNull().default(true),
    scheduleType: text('schedule_type').notNull().default('now'),
    sendDate: date('send_date'),
    sendTime: time('send_time'),
    timezone: text('timezone'),
    repeatInterval: text('repeat_interval'),
    repeatUntil: date('repeat_until'),
    throttleMinSec: smallint('throttle_min_sec'),
    throttleMaxSec: smallint('throttle_max_sec'),
    batchSize: smallint('batch_size'),
    batchPauseMin: smallint('batch_pause_min'),
    dailyLimit: integer('daily_limit'),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nodeScheduleId: text('node_schedule_id'),
    totalRecipients: integer('total_recipients').notNull().default(0),
    sentCount: integer('sent_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    readCount: integer('read_count').notNull().default(0),
    respondedCount: integer('responded_count').notNull().default(0),
    clickedCount: integer('clicked_count').notNull().default(0),
    metaClickedCount: integer('meta_clicked_count').notNull().default(0),
    metaAnalyticsSyncedAt: timestamp('meta_analytics_synced_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    provider: text('provider').notNull().default('baileys'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** The broadcast wizard's `{ draft, launch? }`; null on a campaign the classic builder made. */
    wizard: jsonb('wizard'),
    seriesId: idColumn('series_id'),
    occurrenceNo: integer('occurrence_no'),
    runAt: timestamp('run_at', { withTimezone: true }),
    retryEnabled: boolean('retry_enabled').notNull().default(false),
    retryUntil: timestamp('retry_until', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wpcampaigns_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wpcampaigns_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wpcampaigns_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wpcampaigns_template_id_a',
      columns: [t.orgId, t.templateIdA],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wpcampaigns_template_id_b',
      columns: [t.orgId, t.templateIdB],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wpcampaigns_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wpcampaigns_flow_id_b',
      columns: [t.orgId, t.flowIdB],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wpcampaigns_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_wpcampaigns_created_by').on(t.orgId, t.createdBy),
    index('idx_wpcampaigns_scheduled_message_id').on(t.orgId, t.scheduledMessageId),
    index('idx_wpcampaigns_provider').on(t.orgId, t.provider),
    foreignKey({
      name: 'fk_wpcampaigns_series',
      columns: [t.orgId, t.seriesId],
      foreignColumns: [campSeries.orgId, campSeries.id],
    }).onDelete('set null'),
    check('ck_wpcampaigns_wizard_series', sql`(series_id IS NULL) = (occurrence_no IS NULL)`),
    uniqueIndex('uq_wpcampaigns_series_occurrence')
      .on(t.orgId, t.seriesId, t.occurrenceNo)
      .where(sql`series_id IS NOT NULL`),
    index('idx_wpcampaigns_wizard')
      .on(t.orgId, t.id.desc())
      .where(sql`wizard IS NOT NULL`),
    index('idx_wpcampaigns_retry')
      .on(t.retryEnabled)
      .where(sql`retry_enabled`),
  ],
);

export type WpcampaignsRow = typeof wpcampaigns.$inferSelect;
export type NewWpcampaignsRow = typeof wpcampaigns.$inferInsert;

export const wpCampaignContacts = pgTable(
  'wp_campaign_contacts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    campaignId: idColumn('campaign_id').notNull(),
    contactId: idColumn('contact_id'),
    variant: text('variant'),
    status: text('status').notNull().default('queued'),
    sendAttempts: smallint('send_attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    phoneNumber: text('phone_number'),
    recipientName: text('recipient_name'),
    whatsappMessageId: text('whatsapp_message_id'),
    trackingId: text('tracking_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    response: text('response'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    clicked: boolean('clicked').notNull().default(false),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    clickCount: integer('click_count').notNull().default(0),
    unsubscribed: boolean('unsubscribed').notNull().default(false),
    isUnsubscribed: boolean('is_unsubscribed').notNull().default(false),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    /** The provider's error code of the last failure (`131049`: Meta's frequency cap). */
    errorCode: text('error_code'),
    /** scheduled, sending, sent, recovered or exhausted: see the 20261031090000 migration. */
    retryState: text('retry_state'),
    retryCount: smallint('retry_count').notNull().default(0),
    retryFirstSentAt: timestamp('retry_first_sent_at', { withTimezone: true }),
    retryNextAt: timestamp('retry_next_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wp_campaign_contacts_org_id_uuid').on(t.orgId, t.uuid),
    check(
      'ck_wp_campaign_contacts_retry_state',
      sql`retry_state IS NULL OR retry_state IN ('scheduled', 'sending', 'sent', 'recovered', 'exhausted')`,
    ),
    index('idx_wp_campaign_contacts_retry_due')
      .on(t.retryNextAt)
      .where(sql`retry_state = 'scheduled'`),
    index('idx_wp_campaign_contacts_retry_open')
      .on(t.orgId, t.campaignId)
      .where(sql`retry_state IN ('scheduled', 'sending', 'sent')`),
    foreignKey({
      name: 'fk_wp_campaign_contacts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wp_campaign_contacts_campaign_id',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [wpcampaigns.orgId, wpcampaigns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wp_campaign_contacts_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    index('idx_wp_campaign_contacts_campaign_id_status_send_attempts').on(
      t.orgId,
      t.campaignId,
      t.status,
      t.sendAttempts,
    ),
    index('idx_wp_campaign_contacts_contact_id').on(t.orgId, t.contactId),
    index('idx_wp_campaign_contacts_next_attempt_at').on(t.orgId, t.nextAttemptAt),
    index('idx_wp_campaign_contacts_tracking_id').on(t.orgId, t.trackingId),
    // The Message History feed, newest send first (20261126090000).
    index('idx_wp_campaign_contacts_org_at').on(
      t.orgId,
      sql`(COALESCE(${t.sentAt}, ${t.createdAt})) DESC`,
      t.id.desc(),
    ),
  ],
);

export type WpCampaignContactsRow = typeof wpCampaignContacts.$inferSelect;
export type NewWpCampaignContactsRow = typeof wpCampaignContacts.$inferInsert;

/** One row per frequency-cap retry actually executed: the proof it ran once, and when. */
export const campRetryAttempts = pgTable(
  'camp_retry_attempts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    campaignId: idColumn('campaign_id').notNull(),
    recipientId: idColumn('recipient_id').notNull(),
    attemptNo: smallint('attempt_no').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
    outcome: text('outcome').notNull(),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('camp_retry_attempts_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_camp_retry_attempts_recipient_attempt').on(t.orgId, t.recipientId, t.attemptNo),
    check('ck_camp_retry_attempts_outcome', sql`outcome IN ('sent', 'frequency_cap', 'failed')`),
    foreignKey({
      name: 'fk_camp_retry_attempts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_camp_retry_attempts_campaign',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [wpcampaigns.orgId, wpcampaigns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_camp_retry_attempts_recipient',
      columns: [t.orgId, t.recipientId],
      foreignColumns: [wpCampaignContacts.orgId, wpCampaignContacts.id],
    }).onDelete('cascade'),
    index('idx_camp_retry_attempts_campaign').on(t.orgId, t.campaignId, t.executedAt),
  ],
);
export type CampRetryAttemptsRow = typeof campRetryAttempts.$inferSelect;

/** A test message sent from the wizard: logged, and charged by the wallet when its delivery is reported. */
export const campTestSends = pgTable(
  'camp_test_sends',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    campaignId: idColumn('campaign_id').notNull(),
    templateId: idColumn('template_id'),
    provider: text('provider').notNull(),
    toPhone: text('to_phone').notNull(),
    status: text('status').notNull().default('sent'),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    renderedBody: text('rendered_body'),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('camp_test_sends_org_id_uuid_key').on(t.orgId, t.uuid),
    check('ck_camp_test_sends_status', sql`status IN ('sent', 'delivered', 'read', 'failed')`),
    foreignKey({
      name: 'fk_camp_test_sends_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_camp_test_sends_campaign',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [wpcampaigns.orgId, wpcampaigns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_camp_test_sends_template',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_camp_test_sends_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_camp_test_sends_campaign').on(t.orgId, t.campaignId, t.id.desc()),
    index('idx_camp_test_sends_message')
      .on(t.providerMessageId)
      .where(sql`provider_message_id IS NOT NULL`),
  ],
);
export type CampTestSendsRow = typeof campTestSends.$inferSelect;
