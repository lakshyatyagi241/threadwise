import { boolean, index, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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

    data: dataJsonb(),
    displayId: text('display_id'),
    isArchived: boolean('is_archived').notNull().default(false),
    /** Trigger-maintained. Read-only from the application's point of view. */
    searchVector: tsvector('search_vector'),

    /** Id in the legacy Geta system. Null for natively created rows. */
    legacyId: text('legacy_id'),
    /** Attribution for leads that came in through a channel partner. */
    submittedByAgentId: idColumn('submitted_by_agent_id'),

    createdBy: idColumn('created_by'),
    updatedBy: idColumn('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('contacts_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_contacts_org_created').on(t.orgId, t.createdAt, t.id),
    index('idx_contacts_org_owner').on(t.orgId, t.ownerId, t.createdAt),
    index('idx_contacts_org_stage').on(t.orgId, t.lifecycleStage, t.createdAt),
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
