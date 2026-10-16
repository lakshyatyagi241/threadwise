import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { platformOperators } from '../auth-registration-security/core';
import { organizations, users } from '../foundation';
import { plans } from '../plans-subscriptions-trials/plans';

/**
 * Mirror of 20261021090000_mkt_catalogue.sql and 20261021090100_mkt_installations.sql. The SQL is the source of truth; this file
 * exists so queries are typed.
 *
 * The catalogue (categories, apps, versions) and `market_requests` are platform-owned: no org_id, writes only on the privileged path
 * (the operator API). Installations, consents, connections, deliveries and votes are tenant tables (org_id, forced RLS).
 */

export type MarketAppKind = 'mini_app' | 'integration';
export type MarketAppStatus = 'draft' | 'in_review' | 'published' | 'hidden' | 'killed';
export type MarketVersionStatus =
  'draft' | 'in_review' | 'approved' | 'rejected' | 'published' | 'retired';
export type MarketPricingModel = 'free' | 'paid_monthly';
export type MarketConnectorType =
  'oauth' | 'push' | 'pull' | 'email_parse' | 'webhook_relay' | 'client';

export const marketplaceCategories = pgTable(
  'marketplace_categories',
  {
    id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom().unique(),
    kind: text('kind').$type<MarketAppKind>().notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_marketplace_categories_kind_slug').on(t.kind, t.slug),
    check('chk_marketplace_categories_kind', sql`${t.kind} in ('mini_app', 'integration')`),
    check('chk_marketplace_categories_slug', sql`${t.slug} ~ '^[a-z][a-z0-9-]{1,47}$'`),
  ],
);
export type MarketplaceCategoriesRow = typeof marketplaceCategories.$inferSelect;

export const marketplaceApps = pgTable(
  'marketplace_apps',
  {
    id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom().unique(),
    slug: text('slug').notNull().unique(),
    kind: text('kind').$type<MarketAppKind>().notNull(),
    categoryId: idColumn('category_id')
      .notNull()
      .references(() => marketplaceCategories.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    tagline: text('tagline').notNull().default(''),
    status: text('status').$type<MarketAppStatus>().notNull().default('draft'),
    firstParty: boolean('first_party').notNull().default(false),
    featured: boolean('featured').notNull().default(false),
    planFeature: text('plan_feature'),
    sortOrder: integer('sort_order').notNull().default(100),
    connectorType: text('connector_type').$type<MarketConnectorType>(),
    listing: jsonb('listing').$type<Record<string, unknown>>().notNull().default({}),
    // References marketplace_app_versions (ON DELETE SET NULL) in the database; not declared here because the two tables point at each other.
    currentVersionId: idColumn('current_version_id'),
    installCount: integer('install_count').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    killedAt: timestamp('killed_at', { withTimezone: true }),
    killReason: text('kill_reason'),
    /** The platform operator's pricing (20261023090000_mkt_pricing.sql). The manifest's own `pricing` is only the developer's proposal. */
    pricingModel: text('pricing_model').$type<MarketPricingModel>().notNull().default('free'),
    priceAmount: numeric('price_amount', { precision: 12, scale: 2 }),
    priceCurrency: text('price_currency'),
    annualAmount: numeric('annual_amount', { precision: 12, scale: 2 }),
    trialDays: integer('trial_days').notNull().default(0),
    purchasable: boolean('purchasable').notNull().default(true),
    includedPlanFeature: text('included_plan_feature'),
    includedMinPlan: text('included_min_plan').references(() => plans.slug, {
      onUpdate: 'cascade',
      onDelete: 'set null',
    }),
    priceChangedAt: timestamp('price_changed_at', { withTimezone: true }),
    /** Plan feature keys a subscription to this FIRST-PARTY app grants; the app's add-on carries them. */
    grantsPlanFeatures: text('grants_plan_features')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The operator may comp the workspaces that already have the granted features (an explicit action). */
    grandfatherExisting: boolean('grandfather_existing').notNull().default(false),
    /** `recurring`: the card renews the app on its own (the app's add-on is an autopay pack); `one_time`: a prepaid month, renewed by paying again. */
    billingMode: text('billing_mode').$type<'one_time' | 'recurring'>().notNull().default('one_time'),
    createdByOperatorId: idColumn('created_by_operator_id').references(() => platformOperators.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    index('idx_marketplace_apps_pricing')
      .on(t.pricingModel)
      .where(sql`${t.pricingModel} <> 'free'`),
    check('chk_marketplace_apps_pricing_model', sql`${t.pricingModel} in ('free', 'paid_monthly')`),
    check(
      'chk_marketplace_apps_pricing',
      sql`(${t.pricingModel} = 'free' and ${t.priceAmount} is null and ${t.priceCurrency} is null and ${t.annualAmount} is null and ${t.trialDays} = 0 and ${t.includedPlanFeature} is null and ${t.includedMinPlan} is null and cardinality(${t.grantsPlanFeatures}) = 0 and not ${t.grandfatherExisting}) or (${t.pricingModel} = 'paid_monthly' and ((${t.priceAmount} > 0 and ${t.priceCurrency} ~ '^[A-Z]{3}$') or (${t.status} in ('draft', 'in_review') and ${t.priceAmount} is null and ${t.priceCurrency} is null)) and (${t.annualAmount} is null or ${t.annualAmount} > 0))`,
    ),
    check('chk_marketplace_apps_trial_days', sql`${t.trialDays} between 0 and 90`),
    check('chk_marketplace_apps_billing_mode', sql`${t.billingMode} in ('one_time', 'recurring')`),
    check(
      'chk_marketplace_apps_recurring_paid',
      sql`${t.billingMode} = 'one_time' or ${t.pricingModel} = 'paid_monthly'`,
    ),
    index('idx_marketplace_apps_browse').on(t.kind, t.categoryId, t.status),
    index('idx_marketplace_apps_published_at')
      .on(t.publishedAt, t.id)
      .where(sql`${t.status} = 'published'`),
    index('idx_marketplace_apps_popular')
      .on(t.installCount, t.id)
      .where(sql`${t.status} = 'published'`),
    check(
      'chk_marketplace_apps_status',
      sql`${t.status} in ('draft', 'in_review', 'published', 'hidden', 'killed')`,
    ),
  ],
);
export type MarketplaceAppsRow = typeof marketplaceApps.$inferSelect;

export const marketplaceAppVersions = pgTable(
  'marketplace_app_versions',
  {
    id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom().unique(),
    appId: idColumn('app_id')
      .notNull()
      .references(() => marketplaceApps.id, { onDelete: 'cascade' }),
    version: text('version').notNull(),
    status: text('status').$type<MarketVersionStatus>().notNull().default('draft'),
    manifest: jsonb('manifest').$type<Record<string, unknown>>().notNull(),
    recipe: jsonb('recipe').$type<Record<string, unknown>>(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    changelog: text('changelog').notNull().default(''),
    reviewNote: text('review_note'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedByOperatorId: idColumn('reviewed_by_operator_id').references(
      () => platformOperators.id,
      {
        onDelete: 'set null',
      },
    ),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdByOperatorId: idColumn('created_by_operator_id').references(() => platformOperators.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_marketplace_app_versions_version').on(t.appId, t.version),
    index('idx_marketplace_app_versions_app').on(t.appId, t.createdAt, t.id),
    check(
      'chk_marketplace_app_versions_status',
      sql`${t.status} in ('draft', 'in_review', 'approved', 'rejected', 'published', 'retired')`,
    ),
  ],
);
export type MarketplaceAppVersionsRow = typeof marketplaceAppVersions.$inferSelect;

export const workspaceAppInstallations = pgTable(
  'workspace_app_installations',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    appId: idColumn('app_id')
      .notNull()
      .references(() => marketplaceApps.id, { onDelete: 'restrict' }),
    installedVersionId: idColumn('installed_version_id')
      .notNull()
      .references(() => marketplaceAppVersions.id, { onDelete: 'restrict' }),
    pendingVersionId: idColumn('pending_version_id').references(() => marketplaceAppVersions.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<'active' | 'disabled' | 'killed'>().notNull().default('active'),
    grantedScopes: text('granted_scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** CryptoService envelope of the credential fields the admin entered. Never leaves the API. */
    credentialsEnc: text('credentials_enc'),
    credentialHints: jsonb('credential_hints')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    healthStatus: text('health_status')
      .$type<'unknown' | 'healthy' | 'degraded' | 'error' | 'needs_reauth'>()
      .notNull()
      .default('unknown'),
    healthCheckedAt: timestamp('health_checked_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    installedBy: idColumn('installed_by'),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    killedAt: timestamp('killed_at', { withTimezone: true }),
    killReason: text('kill_reason'),
    /** Paused because the paid app's subscription ended; resubscribing switches it back on (20261023090000_mkt_pricing.sql). */
    pausedBySubscription: boolean('paused_by_subscription').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    check(
      'chk_workspace_app_installations_paused',
      sql`not ${t.pausedBySubscription} or ${t.status} = 'disabled'`,
    ),
    unique('workspace_app_installations_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_workspace_app_installations_app').on(t.orgId, t.appId),
    foreignKey({
      name: 'workspace_app_installations_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_workspace_app_installations_installed_by',
      columns: [t.orgId, t.installedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_workspace_app_installations_app').on(t.appId, t.status),
    index('idx_workspace_app_installations_org_status').on(t.orgId, t.status),
    index('idx_workspace_app_installations_installed_by').on(t.orgId, t.installedBy),
    check(
      'chk_workspace_app_installations_status',
      sql`${t.status} in ('active', 'disabled', 'killed')`,
    ),
  ],
);
export type WorkspaceAppInstallationsRow = typeof workspaceAppInstallations.$inferSelect;

export const marketplaceConsents = pgTable(
  'marketplace_consents',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    installationId: idColumn('installation_id'),
    appId: idColumn('app_id')
      .notNull()
      .references(() => marketplaceApps.id, { onDelete: 'restrict' }),
    versionId: idColumn('version_id')
      .notNull()
      .references(() => marketplaceAppVersions.id, { onDelete: 'restrict' }),
    action: text('action').$type<'install' | 'reconsent' | 'uninstall'>().notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    previousScopes: text('previous_scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    dataChoice: text('data_choice').$type<'keep' | 'delete'>(),
    consentedBy: idColumn('consented_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('marketplace_consents_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'marketplace_consents_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_marketplace_consents_installation',
      columns: [t.orgId, t.installationId],
      foreignColumns: [workspaceAppInstallations.orgId, workspaceAppInstallations.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_marketplace_consents_user',
      columns: [t.orgId, t.consentedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_marketplace_consents_installation').on(t.orgId, t.installationId, t.createdAt),
    index('idx_marketplace_consents_app').on(t.orgId, t.appId, t.createdAt),
    index('idx_marketplace_consents_version').on(t.versionId),
    index('idx_marketplace_consents_user').on(t.orgId, t.consentedBy),
    check(
      'chk_marketplace_consents_action',
      sql`${t.action} in ('install', 'reconsent', 'uninstall')`,
    ),
  ],
);
export type MarketplaceConsentsRow = typeof marketplaceConsents.$inferSelect;

export const marketplaceConnections = pgTable(
  'marketplace_connections',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    installationId: idColumn('installation_id').notNull(),
    connectorType: text('connector_type').$type<MarketConnectorType>().notNull(),
    publicKey: text('public_key').notNull(),
    /** CryptoService envelope of the secret that authenticates deliveries. Never leaves the API. */
    secretEnc: text('secret_enc'),
    secretHint: text('secret_hint'),
    status: text('status')
      .$type<'active' | 'paused' | 'error' | 'disabled'>()
      .notNull()
      .default('active'),
    pollIntervalSeconds: integer('poll_interval_seconds'),
    nextPollAt: timestamp('next_poll_at', { withTimezone: true }),
    pollCursor: text('poll_cursor'),
    /** When a request was last made to the portal; the portal's minimum interval and "Sync now" are kept against it. */
    lastPollAt: timestamp('last_poll_at', { withTimezone: true }),
    /** A narrower window than the recipe's, after a window held more leads than one answer can carry. */
    pollWindowSeconds: integer('poll_window_seconds'),
    lastPollLeads: integer('last_poll_leads'),
    leadSourceId: idColumn('lead_source_id'),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    receivedCount: bigint('received_count', { mode: 'number' }).notNull().default(0),
    acceptedCount: bigint('accepted_count', { mode: 'number' }).notNull().default(0),
    duplicateCount: bigint('duplicate_count', { mode: 'number' }).notNull().default(0),
    failedCount: bigint('failed_count', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('marketplace_connections_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_marketplace_connections_installation').on(t.orgId, t.installationId),
    unique('uq_marketplace_connections_public_key').on(t.publicKey),
    foreignKey({
      name: 'marketplace_connections_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_marketplace_connections_installation',
      columns: [t.orgId, t.installationId],
      foreignColumns: [workspaceAppInstallations.orgId, workspaceAppInstallations.id],
    }).onDelete('cascade'),
    index('idx_marketplace_connections_due')
      .on(t.nextPollAt)
      .where(sql`${t.connectorType} = 'pull' and ${t.status} = 'active'`),
    check(
      'chk_marketplace_connections_status',
      sql`${t.status} in ('active', 'paused', 'error', 'disabled')`,
    ),
    check(
      'chk_marketplace_connections_window',
      sql`${t.pollWindowSeconds} is null or ${t.pollWindowSeconds} > 0`,
    ),
  ],
);
export type MarketplaceConnectionsRow = typeof marketplaceConnections.$inferSelect;

export const marketplaceConnectionEvents = pgTable(
  'marketplace_connection_events',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    connectionId: idColumn('connection_id').notNull(),
    externalId: text('external_id').notNull(),
    status: text('status').$type<'accepted' | 'failed' | 'rejected'>().notNull(),
    error: text('error'),
    seenCount: integer('seen_count').notNull().default(1),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('marketplace_connection_events_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_marketplace_connection_events_external').on(t.orgId, t.connectionId, t.externalId),
    foreignKey({
      name: 'marketplace_connection_events_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_marketplace_connection_events_connection',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [marketplaceConnections.orgId, marketplaceConnections.id],
    }).onDelete('cascade'),
    index('idx_marketplace_connection_events_recent').on(
      t.orgId,
      t.connectionId,
      t.receivedAt,
      t.id,
    ),
    index('idx_marketplace_connection_events_age').on(t.receivedAt),
    check(
      'chk_marketplace_connection_events_status',
      sql`${t.status} in ('accepted', 'failed', 'rejected')`,
    ),
  ],
);
export type MarketplaceConnectionEventsRow = typeof marketplaceConnectionEvents.$inferSelect;

/** Mirror of 20261024090000_mkt_portal_engine.sql: a portal's delivery, stored whole before it is answered and processed by the worker. */
export const marketplaceInboundEvents = pgTable(
  'marketplace_inbound_events',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    connectionId: idColumn('connection_id').notNull(),
    method: text('method').$type<'POST' | 'GET'>().notNull(),
    format: text('format').$type<'json' | 'form' | 'xml' | 'query'>().notNull(),
    contentType: text('content_type'),
    /** The raw body, or the query string of a GET; NULL once processed. */
    body: text('body'),
    headers: jsonb('headers').$type<Record<string, string>>().notNull().default({}),
    sourceIp: text('source_ip'),
    status: text('status')
      .$type<'received' | 'processing' | 'processed' | 'rejected' | 'failed'>()
      .notNull()
      .default('received'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    error: text('error'),
    leadsReceived: integer('leads_received').notNull().default(0),
    leadsAccepted: integer('leads_accepted').notNull().default(0),
    leadsDuplicate: integer('leads_duplicate').notNull().default(0),
    leadsRejected: integer('leads_rejected').notNull().default(0),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('marketplace_inbound_events_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'marketplace_inbound_events_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_marketplace_inbound_events_connection',
      columns: [t.orgId, t.connectionId],
      foreignColumns: [marketplaceConnections.orgId, marketplaceConnections.id],
    }).onDelete('cascade'),
    index('idx_marketplace_inbound_events_due')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('received', 'failed')`),
    index('idx_marketplace_inbound_events_stuck')
      .on(t.claimedAt)
      .where(sql`${t.status} = 'processing'`),
    index('idx_marketplace_inbound_events_recent').on(t.orgId, t.connectionId, t.receivedAt, t.id),
    index('idx_marketplace_inbound_events_age').on(t.receivedAt),
    check(
      'chk_marketplace_inbound_events_status',
      sql`${t.status} in ('received', 'processing', 'processed', 'rejected', 'failed')`,
    ),
    check('chk_marketplace_inbound_events_method', sql`${t.method} in ('POST', 'GET')`),
    check(
      'chk_marketplace_inbound_events_format',
      sql`${t.format} in ('json', 'form', 'xml', 'query')`,
    ),
  ],
);
export type MarketplaceInboundEventsRow = typeof marketplaceInboundEvents.$inferSelect;

export const marketRequests = pgTable(
  'market_requests',
  {
    id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom().unique(),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    kind: text('kind').$type<MarketAppKind>().notNull().default('integration'),
    categorySlug: text('category_slug'),
    website: text('website'),
    status: text('status')
      .$type<'open' | 'planned' | 'building' | 'shipped' | 'declined'>()
      .notNull()
      .default('open'),
    voteCount: integer('vote_count').notNull().default(0),
    operatorNote: text('operator_note'),
    createdByOrgId: idColumn('created_by_org_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    unique('uq_market_requests_name_key').on(t.kind, t.nameKey),
    index('idx_market_requests_votes').on(t.voteCount, t.id),
    index('idx_market_requests_created').on(t.createdAt, t.id),
    index('idx_market_requests_org').on(t.createdByOrgId),
    check(
      'chk_market_requests_status',
      sql`${t.status} in ('open', 'planned', 'building', 'shipped', 'declined')`,
    ),
  ],
);
export type MarketRequestsRow = typeof marketRequests.$inferSelect;

export const marketRequestVotes = pgTable(
  'market_request_votes',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    requestId: idColumn('request_id')
      .notNull()
      .references(() => marketRequests.id, { onDelete: 'cascade' }),
    userId: idColumn('user_id'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_market_request_votes_org_request').on(t.orgId, t.requestId),
    foreignKey({
      name: 'market_request_votes_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_market_request_votes_user',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_market_request_votes_request').on(t.requestId),
    index('idx_market_request_votes_user').on(t.orgId, t.userId),
  ],
);
export type MarketRequestVotesRow = typeof marketRequestVotes.$inferSelect;

/**
 * Mirror of 20261023090000_mkt_pricing.sql: one row per (workspace, app) for the whole relationship. It is NOT the entitlement (the add-on
 * purchase row in `workspace_addons` is); it records cancel-at-period-end, lapse and comp for the manage page, the operator's view and the
 * lapse sweep. Only the privileged path writes it.
 */
export const marketplaceSubscriptions = pgTable(
  'marketplace_subscriptions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    appId: idColumn('app_id')
      .notNull()
      .references(() => marketplaceApps.id, { onDelete: 'restrict' }),
    packId: idColumn('pack_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'restrict' }),
    status: text('status').$type<'active' | 'lapsed'>().notNull().default('active'),
    source: text('source').$type<'purchase' | 'trial' | 'comp'>().notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    amount: numeric('amount', { precision: 12, scale: 2 }),
    currency: text('currency'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    lapsedAt: timestamp('lapsed_at', { withTimezone: true }),
    renewalsCount: integer('renewals_count').notNull().default(0),
    /** A live provider subscription will charge this one again; cleared when it ends for any reason (20261222090000). */
    autorenew: boolean('autorenew').notNull().default(false),
    /** The provider reported a failed renewal charge and has not recovered; `graceEndsAt` is when the app stops working if it does not. */
    paymentFailedAt: timestamp('payment_failed_at', { withTimezone: true }),
    graceEndsAt: timestamp('grace_ends_at', { withTimezone: true }),
    /** The last renewal the provider made (a manual renewal does not set it). */
    lastRenewedAt: timestamp('last_renewed_at', { withTimezone: true }),
    /** The provider subscription was ended while the app was still paid; a cancellation cannot be taken back. Cleared when a new autopay starts. */
    autorenewStoppedAt: timestamp('autorenew_stopped_at', { withTimezone: true }),
    compedByOperatorId: idColumn('comped_by_operator_id').references(() => platformOperators.id, {
      onDelete: 'set null',
    }),
    compNote: text('comp_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('marketplace_subscriptions_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_marketplace_subscriptions_app').on(t.orgId, t.appId),
    foreignKey({
      name: 'marketplace_subscriptions_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    uniqueIndex('uq_marketplace_subscriptions_uuid').on(t.uuid),
    index('idx_marketplace_subscriptions_app').on(t.appId, t.status),
    index('idx_marketplace_subscriptions_org').on(t.orgId, t.status),
    index('idx_marketplace_subscriptions_pack').on(t.packId),
    index('idx_marketplace_subscriptions_comped_by').on(t.compedByOperatorId),
    index('idx_marketplace_subscriptions_due')
      .on(t.currentPeriodEnd)
      .where(sql`${t.status} = 'active'`),
    check('chk_marketplace_subscriptions_status', sql`${t.status} in ('active', 'lapsed')`),
    check(
      'chk_marketplace_subscriptions_grace',
      sql`${t.graceEndsAt} is null or ${t.paymentFailedAt} is not null`,
    ),
    check(
      'chk_marketplace_subscriptions_autorenew',
      sql`not ${t.autorenew} or ${t.source} = 'purchase'`,
    ),
    check(
      'chk_marketplace_subscriptions_source',
      sql`${t.source} in ('purchase', 'trial', 'comp')`,
    ),
  ],
);
export type MarketplaceSubscriptionsRow = typeof marketplaceSubscriptions.$inferSelect;
