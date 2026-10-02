import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  citext,
  createdAt,
  dataJsonb,
  idColumn,
  orgIdColumn,
  rowVersion,
  tsvector,
  updatedAt,
} from './columns';
import { recordLifecycleEnum } from './enums';

export const companies = pgTable(
  'companies',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    name: text('name'),
    domain: text('domain'),
    /** WaDesk company fields (ctp overlay). */
    email: citext('email'),
    phone: text('phone'),
    industry: text('industry'),
    sizeRange: text('size_range'),
    address: text('address'),
    notes: text('notes'),
    ownerId: idColumn('owner_id'),
    lifecycleState: recordLifecycleEnum('lifecycle_state').notNull().default('active'),
    status: text('status'),
    data: dataJsonb(),
    displayId: text('display_id'),
    isArchived: boolean('is_archived').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('companies_org_id_uuid_key').on(t.orgId, t.uuid),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    name: text('name'),
    /** Additive alongside `name` — see docs/global-schema-design.dbml. */
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: citext('email'),
    phone: text('phone'),
    companyId: idColumn('company_id'),
    ownerId: idColumn('owner_id'),

    /** Trigger-maintained dedup keys. Never written by the application. */
    normalizedEmail: citext('normalized_email'),
    normalizedPhone: text('normalized_phone'),

    lifecycleState: recordLifecycleEnum('lifecycle_state').notNull().default('active'),
    status: text('status'),
    /** Funnel position — what the sub-agent portal reads live. */
    lifecycleStage: text('lifecycle_stage').notNull().default('new'),
    lifecycleStageDate: timestamp('lifecycle_stage_date', { withTimezone: true }),
    previousLifecycleStage: text('previous_lifecycle_stage'),
    previousLifecycleStageDate: timestamp('previous_lifecycle_stage_date', { withTimezone: true }),
    /** Only meaningful when status='closed_lost'. Options via status_options. */
    lostReason: text('lost_reason'),
    otherLostReason: text('other_lost_reason'),
    wonAt: timestamp('won_at', { withTimezone: true }),
    lostAt: timestamp('lost_at', { withTimezone: true }),
    leadScore: integer('lead_score'),
    /** Enum values are org-configurable via status_options, not a fixed set here. */
    whatsappSubscriptionStatus: text('whatsapp_subscription_status'),
    smsSubscriptionStatus: text('sms_subscription_status'),
    emailSubscriptionStatus: text('email_subscription_status'),
    emailConfirmed: boolean('email_confirmed').notNull().default(false),
    faxNumber: text('fax_number'),
    /** Bumped on note/activity/meeting write. Backs the list 'Last Activity' column. */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),

    data: dataJsonb(),
    displayId: text('display_id'),
    isArchived: boolean('is_archived').notNull().default(false),
    /** Trigger-maintained. Read-only from the application's point of view. */
    searchVector: tsvector('search_vector'),

    /** Id in the legacy Geta system. Null for natively created rows. */
    legacyId: text('legacy_id'),
    /** Attribution for leads that came in through a channel partner. */
    submittedByAgentId: idColumn('submitted_by_agent_id'),

    /** WaDesk contact fields (con overlay). `mobile` is `phone`; `contact_group` is contact_group_members. */
    title: text('title'),
    middleName: text('middle_name'),
    language: text('language'),
    address: text('address'),
    countryCode: text('country_code'),
    channel: text('channel'),
    channelUid: text('channel_uid'),
    imageUrl: text('image_url'),
    subject: text('subject'),
    message: text('message'),
    isUnsubscribed: boolean('is_unsubscribed').notNull().default(false),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    /** Where the contact came from (the import's source knob, "import", ...). */
    source: text('source'),
    /** The CSV import that created the contact; null for everything else. */
    importJobId: idColumn('import_job_id'),

    createdBy: idColumn('created_by'),
    updatedBy: idColumn('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('contacts_org_id_uuid_key').on(t.orgId, t.uuid),
    uniqueIndex('uq_contacts_org_channel_uid')
      .on(t.orgId, t.channel, t.channelUid)
      .where(sql`${t.channel} IS NOT NULL AND ${t.channelUid} IS NOT NULL`),
    index('idx_contacts_org_unsubscribed')
      .on(t.orgId)
      .where(sql`${t.isUnsubscribed}`),
    index('idx_contacts_org_import_job')
      .on(t.orgId, t.importJobId)
      .where(sql`${t.importJobId} IS NOT NULL`),
    index('idx_contacts_org_source')
      .on(t.orgId, t.source)
      .where(sql`${t.source} IS NOT NULL`),
    index('idx_contacts_org_created').on(t.orgId, t.createdAt, t.id),
    index('idx_contacts_org_owner').on(t.orgId, t.ownerId, t.createdAt),
    index('idx_contacts_org_stage').on(t.orgId, t.lifecycleStage, t.createdAt),
    index('idx_contacts_org_last_activity').on(t.orgId, t.lastActivityAt),
  ],
);

export const contactIdentities = pgTable(
  'contact_identities',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    contactId: idColumn('contact_id').notNull(),
    /** phone | email | whatsapp | web_visitor */
    kind: text('kind').notNull(),
    /** Normalised value: E.164, lowercased email, or a visitor uuid. */
    value: text('value').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    verified: boolean('verified').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    // The auto-merge backbone: an identity maps to exactly one contact per org.
    uniqueIndex('contact_identities_org_id_kind_value_key').on(t.orgId, t.kind, t.value),
    index('idx_contact_identities_contact').on(t.orgId, t.contactId),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type ContactIdentity = typeof contactIdentities.$inferSelect;
