/**
 * workspaces-teams-tenancy: tables ported from Reference. Mirrors migrations/20261001102500_wsp_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { aiAgents } from '../ai-agents-training/tables';
import { platformOperators } from '../auth-registration-security/core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { plans } from '../plans-subscriptions-trials/plans';
import { devices, waProviderConfigs } from '../whatsapp-devices-baileys/tables';

export const impersonationSessions = pgTable(
  'impersonation_sessions',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    /** The platform operator inside the workspace (never a workspace user). */
    operatorId: idColumn('operator_id')
      .notNull()
      .references(() => platformOperators.id, { onDelete: 'restrict' }),
    /** The organization the session acts in (baseline name kept). */
    targetWorkspaceId: idColumn('target_workspace_id').notNull(),
    /** The workspace owner the operator acts as. */
    targetUserId: idColumn('target_user_id').notNull(),
    reason: text('reason').notNull(),
    readOnly: boolean('read_only').notNull().default(false),
    ip: text('ip'),
    userAgent: text('user_agent'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** operator | expiry | new_session | access_revoked */
    endedBy: text('ended_by'),
    /** sha256 of the one-time code; the code itself is never stored. */
    handoffCodeHash: text('handoff_code_hash'),
    handoffExpiresAt: timestamp('handoff_expires_at', { withTimezone: true }).notNull(),
    handoffUsedAt: timestamp('handoff_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    foreignKey({
      name: 'fk_impersonation_sessions_target_workspace_id',
      columns: [t.targetWorkspaceId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_impersonation_sessions_target_user',
      columns: [t.targetWorkspaceId, t.targetUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    uniqueIndex('uq_impersonation_sessions_one_open')
      .on(t.operatorId)
      .where(sql`${t.endedAt} IS NULL`),
    uniqueIndex('uq_impersonation_sessions_handoff')
      .on(t.handoffCodeHash)
      .where(sql`${t.handoffCodeHash} IS NOT NULL`),
    index('idx_impersonation_sessions_operator_started').on(t.operatorId, t.startedAt.desc()),
    index('idx_impersonation_sessions_open_expiry')
      .on(t.expiresAt)
      .where(sql`${t.endedAt} IS NULL`),
    index('idx_impersonation_sessions_target_workspace_id').on(t.targetWorkspaceId),
  ],
);

export type ImpersonationSessionsRow = typeof impersonationSessions.$inferSelect;
export type NewImpersonationSessionsRow = typeof impersonationSessions.$inferInsert;

export const userDeviceTokens = pgTable(
  'user_device_tokens',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    deviceId: idColumn('device_id'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    fcmToken: text('fcm_token').notNull(),
    tokenHash: text('token_hash').notNull(),
    platform: text('platform'),
    deviceInfo: jsonb('device_info'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_user_device_tokens_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_user_device_tokens_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_user_device_tokens_token_hash').on(t.tokenHash),
    foreignKey({
      name: 'fk_user_device_tokens_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_user_device_tokens_device_id',
      columns: [t.orgId, t.deviceId],
      foreignColumns: [devices.orgId, devices.id],
    }).onDelete('set null'),
    index('idx_user_device_tokens_device_id').on(t.orgId, t.deviceId),
    index('idx_user_device_tokens_user_id').on(t.orgId, t.userId),
  ],
);

export type UserDeviceTokensRow = typeof userDeviceTokens.$inferSelect;
export type NewUserDeviceTokensRow = typeof userDeviceTokens.$inferInsert;

export const workspaceAddons = pgTable(
  'workspace_addons',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    packageId: idColumn('package_id').notNull(),
    orderId: idColumn('order_id'),
    status: text('status').notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_workspace_addons_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_workspace_addons_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_workspace_addons_package_id',
      columns: [t.packageId],
      foreignColumns: [plans.id],
    }).onDelete('restrict'),
    index('idx_workspace_addons_package_id').on(t.orgId, t.packageId),
    index('idx_workspace_addons_status').on(t.orgId, t.status),
    // one purchase = one row: a replayed order finalisation is a no-op (20261002130000_add_addon_registry.sql)
    uniqueIndex('uq_workspace_addons_order')
      .on(t.orgId, t.orderId, t.packageId)
      .where(sql`${t.orderId} IS NOT NULL`),
  ],
);

export type WorkspaceAddonsRow = typeof workspaceAddons.$inferSelect;
export type NewWorkspaceAddonsRow = typeof workspaceAddons.$inferInsert;

export const workspaceEmailAccounts = pgTable(
  'workspace_email_accounts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    mailtrixyAccountId: idColumn('mailtrixy_account_id').notNull(),
    mtxWorkspaceId: idColumn('mtx_workspace_id'),
    /** Highest MailTrixy message id already imported (pull cursor) */
    mtxLastMessageId: idColumn('mtx_last_message_id'),
    email: text('email'),
    name: text('name'),
    provider: text('provider'),
    status: text('status').notNull().default('connected'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_workspace_email_accounts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_workspace_email_accounts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_workspace_email_accounts_mailtrixy_account_id').on(t.orgId, t.mailtrixyAccountId),
  ],
);

export type WorkspaceEmailAccountsRow = typeof workspaceEmailAccounts.$inferSelect;
export type NewWorkspaceEmailAccountsRow = typeof workspaceEmailAccounts.$inferInsert;

export const workspaceFlags = pgTable(
  'workspace_flags',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    flag: text('flag').notNull(),
    reason: text('reason'),
    flaggedByUserId: idColumn('flagged_by_user_id'),
    clearedAt: timestamp('cleared_at', { withTimezone: true }),
    clearedByUserId: idColumn('cleared_by_user_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_workspace_flags_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_workspace_flags_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_workspace_flags_flagged_by_user_id',
      columns: [t.orgId, t.flaggedByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_workspace_flags_cleared_by_user_id',
      columns: [t.orgId, t.clearedByUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_workspace_flags_flag').on(t.orgId, t.flag),
    index('idx_workspace_flags_cleared_at').on(t.orgId, t.clearedAt),
  ],
);

export type WorkspaceFlagsRow = typeof workspaceFlags.$inferSelect;
export type NewWorkspaceFlagsRow = typeof workspaceFlags.$inferInsert;

export const workspaceIgAccounts = pgTable(
  'workspace_ig_accounts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    instaflowAccountId: text('instaflow_account_id').notNull(),
    username: text('username'),
    name: text('name'),
    avatar: text('avatar'),
    status: text('status').notNull().default('connected'),
    followers: integer('followers'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_workspace_ig_accounts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_workspace_ig_accounts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_workspace_ig_accounts_instaflow_account_id').on(t.orgId, t.instaflowAccountId),
  ],
);

export type WorkspaceIgAccountsRow = typeof workspaceIgAccounts.$inferSelect;
export type NewWorkspaceIgAccountsRow = typeof workspaceIgAccounts.$inferInsert;

export const workspacePaymentConfigs = pgTable(
  'workspace_payment_configs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    providerConfigId: idColumn('provider_config_id'),
    configName: text('config_name').notNull(),
    paymentType: text('payment_type').notNull().default('upi'),
    country: text('country').notNull().default('IN'),
    currency: text('currency').notNull().default('INR'),
    merchantCategory: text('merchant_category'),
    isActive: boolean('is_active').notNull().default(true),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_workspace_payment_configs_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_workspace_payment_configs_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_workspace_payment_configs_config_name').on(t.orgId, t.configName),
    foreignKey({
      name: 'fk_workspace_payment_configs_provider_config_id',
      columns: [t.orgId, t.providerConfigId],
      foreignColumns: [waProviderConfigs.orgId, waProviderConfigs.id],
    }).onDelete('set null'),
    index('idx_workspace_payment_configs_provider_config_id').on(t.orgId, t.providerConfigId),
  ],
);

export type WorkspacePaymentConfigsRow = typeof workspacePaymentConfigs.$inferSelect;
export type NewWorkspacePaymentConfigsRow = typeof workspacePaymentConfigs.$inferInsert;

export const workspaceSettings = pgTable(
  'workspace_settings',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    ownerUserId: idColumn('owner_user_id'),
    customDomain: text('custom_domain'),
    cnameVerified: boolean('cname_verified').notNull().default(false),
    enabledEngines: text('enabled_engines'),
    defaultEngine: text('default_engine'),
    metaAgentEnabled: boolean('meta_agent_enabled').notNull().default(false),
    aiResponderMode: text('ai_responder_mode').notNull().default('threadwise_only'),
    billingCycle: text('billing_cycle').notNull().default('monthly'),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    planEndsAt: timestamp('plan_ends_at', { withTimezone: true }),
    capMonthlyMessages: bigint('cap_monthly_messages', { mode: 'number' }),
    capDailyMessages: bigint('cap_daily_messages', { mode: 'number' }),
    capDevices: integer('cap_devices'),
    capUsers: integer('cap_users'),
    planOverrides: text('plan_overrides'),
    brandPrimary: text('brand_primary'),
    brandAccent: text('brand_accent'),
    brandBackground: text('brand_background'),
    brandLogoPath: text('brand_logo_path'),
    brandFaviconPath: text('brand_favicon_path'),
    brandingFooter: text('branding_footer'),
    notificationPrefs: text('notification_prefs'),
    autoTranslateLanguages: text('auto_translate_languages'),
    defaultLanguage: text('default_language'),
    inboxTranslate: boolean('inbox_translate').notNull().default(true),
    flowBuilderMode: text('flow_builder_mode'),
    dataResidency: text('data_residency').notNull().default('any'),
    appointmentSettings: text('appointment_settings'),
    timezone: text('timezone').notNull().default('UTC'),
    autoPickupDelaySec: integer('auto_pickup_delay_sec').notNull().default(15),
    voicemailDelaySec: integer('voicemail_delay_sec').notNull().default(25),
    defaultVoiceAiAgentId: idColumn('default_voice_ai_agent_id'),
    currency: text('currency'),
    businessHours: text('business_hours'),
    locale: text('locale').notNull().default('en'),
    brandColor: text('brand_color').default('#075E54'),
    industry: text('industry'),
    country: text('country'),
    sizeRange: text('size_range'),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    skipOnboardingEmail: boolean('skip_onboarding_email').notNull().default(false),
    billToPlatformCredit: boolean('bill_to_platform_credit').notNull().default(false),
    preSeedSampleData: boolean('pre_seed_sample_data').notNull().default(false),
    adminNote: text('admin_note'),
    dealsAutoFromOrders: boolean('deals_auto_from_orders').notNull().default(false),
    dealsAutoMinMinor: bigint('deals_auto_min_minor', { mode: 'number' }),
    waCopilotEnabled: boolean('wa_copilot_enabled').notNull().default(false),
    dataWipedAt: timestamp('data_wiped_at', { withTimezone: true }),
    inboxAway: boolean('inbox_away').notNull().default(false),
    /** TIB2: a new or reopened conversation of a contact who already has an agent goes to that agent first (routing rules run otherwise). */
    routingKeepContactAgent: boolean('routing_keep_contact_agent').notNull().default(false),
    /** Handoff and assignment settings (BL-404, migration 20270301090000); every default is the behaviour of before. */
    handoffAutoAssign: boolean('handoff_auto_assign').notNull().default(true),
    handoffClaimSetsOwner: boolean('handoff_claim_sets_owner').notNull().default(false),
    handoffOwnerMode: text('handoff_owner_mode')
      .$type<'independent' | 'owner_first' | 'keep_in_sync'>()
      .notNull()
      .default('independent'),
    handoffContinuityDays: integer('handoff_continuity_days'),
    handoffPromptOwnerOnReassign: boolean('handoff_prompt_owner_on_reassign')
      .notNull()
      .default(false),
    handoffNotifyQueue: boolean('handoff_notify_queue').notNull().default(true),
    /** Waiting queue timers (migration 20270324090000): all off by default; the minutes count only while the team is open. */
    handoffWqRemindMinutes: integer('handoff_wq_remind_minutes'),
    handoffWqOverflowMinutes: integer('handoff_wq_overflow_minutes'),
    handoffWqOverflowTeamId: idColumn('handoff_wq_overflow_team_id'),
    handoffWqUnclaimedMinutes: integer('handoff_wq_unclaimed_minutes'),
    handoffWqUnclaimedAction: text('handoff_wq_unclaimed_action')
      .$type<'keep' | 'message' | 'bot'>()
      .notNull()
      .default('keep'),
    handoffWqUnclaimedMessage: text('handoff_wq_unclaimed_message'),
    /** Away rules (migration 20270326090000): both off by default. */
    handoffReturnOnAway: boolean('handoff_return_on_away').notNull().default(false),
    handoffAutoOfflineMin: integer('handoff_auto_offline_min'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_workspace_settings_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_workspace_settings_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_workspace_settings_org').on(t.orgId),
    foreignKey({
      name: 'fk_workspace_settings_owner_user_id',
      columns: [t.orgId, t.ownerUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_workspace_settings_default_voice_ai_agent_id',
      columns: [t.orgId, t.defaultVoiceAiAgentId],
      foreignColumns: [aiAgents.orgId, aiAgents.id],
    }).onDelete('set null'),
    index('idx_workspace_settings_data_wiped_at').on(t.orgId, t.dataWipedAt),
    index('idx_workspace_settings_default_voice_ai_agent_id').on(t.orgId, t.defaultVoiceAiAgentId),
    index('idx_workspace_settings_owner_user_id').on(t.orgId, t.ownerUserId),
  ],
);

export type WorkspaceSettingsRow = typeof workspaceSettings.$inferSelect;
export type NewWorkspaceSettingsRow = typeof workspaceSettings.$inferInsert;

/** Member leave (BL-112). Mirrors migrations/20261129090000_member_leave.sql, including the exclusion constraint Drizzle cannot express. */
export const memberLeaves = pgTable(
  'member_leaves',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    reason: text('reason'),
    status: text('status').notNull().default('scheduled'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('member_leaves_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'member_leaves_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_leaves_org_id_user_id_fkey',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_leaves_org_id_created_by_fkey',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    uniqueIndex('uq_member_leaves_active')
      .on(t.orgId, t.userId)
      .where(sql`${t.status} = 'active'`),
    index('idx_member_leaves_user').on(t.orgId, t.userId, t.startsOn.desc()),
    index('idx_member_leaves_sweep_start')
      .on(t.startsOn)
      .where(sql`${t.status} = 'scheduled'`),
    index('idx_member_leaves_sweep_end')
      .on(t.endsOn)
      .where(sql`${t.status} = 'active' AND ${t.endsOn} IS NOT NULL`),
  ],
);

export type MemberLeavesRow = typeof memberLeaves.$inferSelect;
export type NewMemberLeavesRow = typeof memberLeaves.$inferInsert;

/** One optional delegate per member (BL-112). */
export const memberDelegates = pgTable(
  'member_delegates',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id').notNull(),
    delegateUserId: idColumn('delegate_user_id').notNull(),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('member_delegates_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('member_delegates_org_id_user_id_key').on(t.orgId, t.userId),
    foreignKey({
      name: 'member_delegates_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_delegates_org_id_user_id_fkey',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_delegates_org_id_delegate_user_id_fkey',
      columns: [t.orgId, t.delegateUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'member_delegates_org_id_created_by_fkey',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_member_delegates_delegate').on(t.orgId, t.delegateUserId),
  ],
);

export type MemberDelegatesRow = typeof memberDelegates.$inferSelect;
export type NewMemberDelegatesRow = typeof memberDelegates.$inferInsert;

/** Reassign batches (BL-112 phase 2). Mirrors migrations/20261130090000_owner_reassign.sql; the owner stamp columns on contacts and deals are set by a trigger. */
export const ownerReassignBatches = pgTable(
  'owner_reassign_batches',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    fromUserId: idColumn('from_user_id').notNull(),
    toKind: text('to_kind').notNull(),
    toUserId: idColumn('to_user_id'),
    toTeamId: idColumn('to_team_id'),
    includeDeals: boolean('include_deals').notNull().default(true),
    reason: text('reason'),
    restoreOn: date('restore_on'),
    status: text('status').notNull().default('applied'),
    movedContacts: integer('moved_contacts').notNull().default(0),
    movedDeals: integer('moved_deals').notNull().default(0),
    restoredContacts: integer('restored_contacts').notNull().default(0),
    restoredDeals: integer('restored_deals').notNull().default(0),
    notRestored: integer('not_restored').notNull().default(0),
    remaining: integer('remaining').notNull().default(0),
    undoUntil: timestamp('undo_until', { withTimezone: true }).notNull(),
    restoredAt: timestamp('restored_at', { withTimezone: true }),
    restoredBy: idColumn('restored_by'),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('owner_reassign_batches_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'owner_reassign_batches_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'owner_reassign_batches_org_id_from_user_id_fkey',
      columns: [t.orgId, t.fromUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'owner_reassign_batches_org_id_to_user_id_fkey',
      columns: [t.orgId, t.toUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'owner_reassign_batches_org_id_created_by_fkey',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'owner_reassign_batches_org_id_restored_by_fkey',
      columns: [t.orgId, t.restoredBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_owner_reassign_from').on(t.orgId, t.fromUserId, t.createdAt.desc()),
    index('idx_owner_reassign_sweep')
      .on(t.restoreOn)
      .where(sql`${t.status} = 'applied' AND ${t.restoreOn} IS NOT NULL`),
  ],
);

export type OwnerReassignBatchesRow = typeof ownerReassignBatches.$inferSelect;

/** Contact and deal auto-assignment (BL-013). Mirrors migrations/20261130090100_contact_assignment.sql. */
export const assignmentSettings = pgTable(
  'assignment_settings',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    enabled: boolean('enabled').notNull().default(false),
    applyToImports: boolean('apply_to_imports').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('assignment_settings_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('assignment_settings_org_id_key').on(t.orgId),
    foreignKey({
      name: 'assignment_settings_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
  ],
);

export const assignmentRules = pgTable(
  'assignment_rules',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    conditions: jsonb('conditions').notNull().default({}),
    /** Record assignment rules: the condition tree (null = no condition, the fallback). 20270115090000_record_assignment_rules.sql */
    description: text('description').notNull().default(''),
    rules: jsonb('rules'),
    reassignOnUpdate: boolean('reassign_on_update').notNull().default(false),
    updatedBy: idColumn('updated_by'),
    strategy: text('strategy').notNull(),
    userIds: jsonb('user_ids').notNull().default([]),
    teamIds: jsonb('team_ids').notNull().default([]),
    skipOffline: boolean('skip_offline').notNull().default(true),
    rrCursor: bigint('rr_cursor', { mode: 'number' }),
    sort: integer('sort').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    firedCount: bigint('fired_count', { mode: 'number' }).notNull().default(0),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('assignment_rules_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'assignment_rules_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assignment_rules_org_id_created_by_fkey',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_assignment_rules_updated_by',
      columns: [t.orgId, t.updatedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_assignment_rules_order').on(t.orgId, t.subject, t.sort, t.id),
  ],
);

/** One decision of the assignment engine, ids only (no personal data). Mirrors migrations/20270115090000_record_assignment_rules.sql. */
export const assignmentRuns = pgTable(
  'assignment_runs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    subject: text('subject').notNull(),
    recordId: idColumn('record_id').notNull(),
    ruleId: idColumn('rule_id'),
    ruleName: text('rule_name'),
    outcome: text('outcome').notNull(),
    reason: text('reason').notNull(),
    ownerId: idColumn('owner_id'),
    method: text('method'),
    origin: text('origin').notNull().default('manual'),
    trigger: text('trigger').notNull().default('created'),
    trace: jsonb('trace').notNull().default([]),
    ownerStamp: timestamp('owner_stamp', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('assignment_runs_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'assignment_runs_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assignment_runs_org_id_rule_id_fkey',
      columns: [t.orgId, t.ruleId],
      foreignColumns: [assignmentRules.orgId, assignmentRules.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'assignment_runs_org_id_owner_id_fkey',
      columns: [t.orgId, t.ownerId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_assignment_runs_recent').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('idx_assignment_runs_record').on(t.orgId, t.subject, t.recordId, t.id.desc()),
  ],
);
