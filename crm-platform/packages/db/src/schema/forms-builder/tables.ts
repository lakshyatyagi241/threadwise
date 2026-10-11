/**
 * forms-builder: the Forms add-on's tables. Mirrors migrations/20261031100000_forms_core.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
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
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { companies, contacts } from '../crm';
import { deals } from '../deals-pipelines/tables';
import { organizations, users } from '../foundation';

export const webForms = pgTable(
  'web_forms',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    publicKey: text('public_key').notNull(),
    status: text('status').notNull().default('draft'),
    draftDefinition: jsonb('draft_definition').$type<Record<string, unknown>>().notNull(),
    publishedVersionId: idColumn('published_version_id'),
    allowedOrigins: text('allowed_origins')
      .array()
      .notNull()
      .default(sql`'{}'`),
    captchaMode: text('captcha_mode').notNull().default('inherit'),
    honeypot: boolean('honeypot').notNull().default(true),
    notify: jsonb('notify')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({ owner: true, userIds: [], emails: [] }),
    retentionDays: integer('retention_days').default(365),
    ownerRule: jsonb('owner_rule')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({ mode: 'unassigned', userIds: [] }),
    rateLimits: jsonb('rate_limits').$type<Record<string, unknown>>().notNull().default({}),
    /** Round-robin position. Bookkeeping: a write touching only this does not bump row_version. */
    rrCursor: bigint('rr_cursor', { mode: 'number' }).notNull().default(0),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_web_forms_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_web_forms_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_web_forms_status', sql`${t.status} in ('draft', 'published', 'paused', 'archived')`),
    check('chk_web_forms_captcha', sql`${t.captchaMode} in ('inherit', 'on', 'off')`),
    check('chk_web_forms_name', sql`btrim(${t.name}) <> '' and char_length(${t.name}) <= 120`),
    check('chk_web_forms_key', sql`${t.publicKey} ~ '^[A-Za-z0-9]{22}$'`),
    check('chk_web_forms_definition', sql`jsonb_typeof(${t.draftDefinition}) = 'object'`),
    check(
      'chk_web_forms_retention',
      sql`${t.retentionDays} is null or ${t.retentionDays} between 30 and 3650`,
    ),
    check('chk_web_forms_origins', sql`cardinality(${t.allowedOrigins}) <= 20`),
    check('chk_web_forms_owner_rule', sql`jsonb_typeof(${t.ownerRule}) = 'object'`),
    check('chk_web_forms_notify', sql`jsonb_typeof(${t.notify}) = 'object'`),
    check('chk_web_forms_rates', sql`jsonb_typeof(${t.rateLimits}) = 'object'`),
    check(
      'chk_web_forms_published',
      sql`${t.status} not in ('published', 'paused') or ${t.publishedVersionId} is not null`,
    ),
    foreignKey({
      name: 'fk_web_forms_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    // `uq_web_forms_name` (unique on lower(name) among non-archived forms) is an expression index: the SQL migration is its only declaration.
    // `fk_web_forms_published_version` points at web_form_versions, which points back here: declared in the migration only.
    uniqueIndex('uq_web_forms_public_key').on(t.publicKey),
    index('idx_web_forms_status').on(t.orgId, t.status),
    index('idx_web_forms_recent').on(t.orgId, t.createdAt.desc(), t.id.desc()),
    index('idx_web_forms_created_by')
      .on(t.orgId, t.createdBy)
      .where(sql`${t.createdBy} is not null`),
    index('idx_web_forms_published_version')
      .on(t.orgId, t.publishedVersionId)
      .where(sql`${t.publishedVersionId} is not null`),
  ],
);

export type WebFormsRow = typeof webForms.$inferSelect;
export type NewWebFormsRow = typeof webForms.$inferInsert;

export const webFormVersions = pgTable(
  'web_form_versions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    formId: idColumn('form_id').notNull(),
    version: integer('version').notNull(),
    /** Frozen: an update trigger refuses any change. */
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    publishedBy: idColumn('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_web_form_versions_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_web_form_versions_number').on(t.orgId, t.formId, t.version),
    foreignKey({
      name: 'fk_web_form_versions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_web_form_versions_number', sql`${t.version} >= 1`),
    check('chk_web_form_versions_definition', sql`jsonb_typeof(${t.definition}) = 'object'`),
    foreignKey({
      name: 'fk_web_form_versions_form',
      columns: [t.orgId, t.formId],
      foreignColumns: [webForms.orgId, webForms.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_web_form_versions_published_by',
      columns: [t.orgId, t.publishedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_web_form_versions_form').on(t.orgId, t.formId, t.version.desc()),
    index('idx_web_form_versions_published_by')
      .on(t.orgId, t.publishedBy)
      .where(sql`${t.publishedBy} is not null`),
  ],
);

export type WebFormVersionsRow = typeof webFormVersions.$inferSelect;
export type NewWebFormVersionsRow = typeof webFormVersions.$inferInsert;

export const webFormSubmissions = pgTable(
  'web_form_submissions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    formId: idColumn('form_id').notNull(),
    versionId: idColumn('version_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    receiptToken: text('receipt_token').notNull(),
    status: text('status').notNull().default('received'),
    reason: text('reason'),
    error: text('error'),
    /** What the visitor sent. Personal data: emptied by the retention sweep and by erase. */
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
    contactId: idColumn('contact_id'),
    companyId: idColumn('company_id'),
    dealId: idColumn('deal_id'),
    utm: jsonb('utm').$type<Record<string, unknown>>().notNull().default({}),
    referrer: text('referrer'),
    pageUrl: text('page_url'),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    consent: jsonb('consent').$type<Record<string, unknown>>(),
    spamScore: integer('spam_score').notNull().default(0),
    /** A second paid notification arrived for a submission already paid: kept for a manual refund. */
    duplicatePayment: boolean('duplicate_payment').notNull().default(false),
    answersExpiresAt: timestamp('answers_expires_at', { withTimezone: true }),
    payloadPurgedAt: timestamp('payload_purged_at', { withTimezone: true }),
    erasedAt: timestamp('erased_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_web_form_submissions_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_web_form_submissions_idempotency').on(t.orgId, t.formId, t.idempotencyKey),
    unique('uq_web_form_submissions_receipt').on(t.receiptToken),
    foreignKey({
      name: 'fk_web_form_submissions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_web_form_submissions_status',
      sql`${t.status} in ('received', 'created', 'updated', 'needs_review', 'awaiting_payment', 'paid', 'failed', 'spam')`,
    ),
    check('chk_web_form_submissions_key', sql`char_length(${t.idempotencyKey}) between 8 and 64`),
    check('chk_web_form_submissions_answers', sql`jsonb_typeof(${t.answers}) = 'object'`),
    check('chk_web_form_submissions_utm', sql`jsonb_typeof(${t.utm}) = 'object'`),
    foreignKey({
      name: 'fk_web_form_submissions_form',
      columns: [t.orgId, t.formId],
      foreignColumns: [webForms.orgId, webForms.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_web_form_submissions_version',
      columns: [t.orgId, t.versionId],
      foreignColumns: [webFormVersions.orgId, webFormVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_web_form_submissions_contact',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_web_form_submissions_company',
      columns: [t.orgId, t.companyId],
      foreignColumns: [companies.orgId, companies.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_web_form_submissions_deal',
      columns: [t.orgId, t.dealId],
      foreignColumns: [deals.orgId, deals.id],
    }).onDelete('set null'),
    index('idx_web_form_submissions_recent').on(t.orgId, t.formId, t.createdAt.desc(), t.id.desc()),
    index('idx_web_form_submissions_status').on(
      t.orgId,
      t.formId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('idx_web_form_submissions_contact')
      .on(t.orgId, t.contactId)
      .where(sql`${t.contactId} is not null`),
    index('idx_web_form_submissions_company')
      .on(t.orgId, t.companyId)
      .where(sql`${t.companyId} is not null`),
    index('idx_web_form_submissions_deal')
      .on(t.orgId, t.dealId)
      .where(sql`${t.dealId} is not null`),
    index('idx_web_form_submissions_version').on(t.orgId, t.versionId),
    index('idx_web_form_submissions_month')
      .on(t.orgId, t.createdAt)
      .where(sql`${t.status} <> 'spam'`),
    index('idx_web_form_submissions_expiry')
      .on(t.answersExpiresAt)
      .where(sql`${t.answersExpiresAt} is not null and ${t.payloadPurgedAt} is null`),
  ],
);

export type WebFormSubmissionsRow = typeof webFormSubmissions.$inferSelect;
export type NewWebFormSubmissionsRow = typeof webFormSubmissions.$inferInsert;

export const webFormUsageMonthly = pgTable(
  'web_form_usage_monthly',
  {
    orgId: orgIdColumn(),
    /** First day of the month, UTC. */
    period: date('period', { mode: 'string' }).notNull(),
    spamBlocked: integer('spam_blocked').notNull().default(0),
    aiGenerations: integer('ai_generations').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.period] }),
    foreignKey({
      name: 'fk_web_form_usage_monthly_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_web_form_usage_period', sql`${t.period} = date_trunc('month', ${t.period})::date`),
  ],
);

export type WebFormUsageMonthlyRow = typeof webFormUsageMonthly.$inferSelect;

/** A stream: no foreign key (the service deletes a form's events with the form; the sweep removes the rest after 90 days). */
export const webFormEvents = pgTable(
  'web_form_events',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('web_form_events_id_seq')`),
    orgId: orgIdColumn(),
    formId: idColumn('form_id').notNull(),
    versionId: idColumn('version_id'),
    visitId: text('visit_id').notNull(),
    kind: text('kind').notNull(),
    stepIndex: integer('step_index'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    check(
      'chk_web_form_events_kind',
      sql`${t.kind} in ('view', 'start', 'step', 'submit', 'complete')`,
    ),
    index('idx_web_form_events_form').on(t.orgId, t.formId, t.createdAt.desc()),
    index('idx_web_form_events_form_kind').on(t.orgId, t.formId, t.kind),
  ],
);

export type WebFormEventsRow = typeof webFormEvents.$inferSelect;

/** One payment attempt of a submission (migrations/20261117090000_forms_payments.sql). The server computed `amountMinor`; `reference` is ours (`FRM-<uuid>`). */
export const webFormPayments = pgTable(
  'web_form_payments',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    submissionId: idColumn('submission_id').notNull(),
    reference: text('reference').notNull(),
    gatewaySlug: text('gateway_slug').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status').notNull().default('pending'),
    settledVia: text('settled_via'),
    providerRef: text('provider_ref'),
    linkUrl: text('link_url'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_web_form_payments_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_web_form_payments_reference').on(t.orgId, t.reference),
    foreignKey({
      name: 'web_form_payments_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_web_form_payments_status',
      sql`${t.status} in ('pending', 'paid', 'failed', 'expired')`,
    ),
    check(
      'chk_web_form_payments_via',
      sql`${t.settledVia} is null or ${t.settledVia} in ('gateway', 'manual')`,
    ),
    check('chk_web_form_payments_amount', sql`${t.amountMinor} > 0`),
    check('chk_web_form_payments_currency', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('chk_web_form_payments_paid', sql`(${t.status} = 'paid') = (${t.paidAt} is not null)`),
    foreignKey({
      name: 'fk_web_form_payments_submission',
      columns: [t.orgId, t.submissionId],
      foreignColumns: [webFormSubmissions.orgId, webFormSubmissions.id],
    }).onDelete('cascade'),
    index('idx_web_form_payments_submission').on(t.orgId, t.submissionId, t.id.desc()),
    index('idx_web_form_payments_pending')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export type WebFormPaymentsRow = typeof webFormPayments.$inferSelect;
export type NewWebFormPaymentsRow = typeof webFormPayments.$inferInsert;
