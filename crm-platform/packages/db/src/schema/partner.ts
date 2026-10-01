import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from './columns';
import { apiKeyStatusEnum, partnerAgentStatusEnum } from './enums';
import { users } from './foundation';

/**
 * Sub-agents / channel partners: a third identity pool, separate from staff
 * `users` and from exam `candidates`. A table, not a role.
 */
export const partnerAgents = pgTable(
  'partner_agents',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    email: citext('email').notNull(),
    phone: text('phone'),
    passwordHash: text('password_hash'),
    status: partnerAgentStatusEnum('status').notNull().default('active'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('partner_agents_org_id_email_key').on(t.orgId, t.email),
    uniqueIndex('partner_agents_org_id_code_key').on(t.orgId, t.code),
  ],
);

/**
 * Agent -> contact mapping. This is the ONLY thing the partner side stores
 * about a lead; stage and details are read live from the CRM replica.
 */
export const partnerAgentLeads = pgTable(
  'partner_agent_leads',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    agentId: idColumn('agent_id').notNull(),
    contactId: idColumn('contact_id').notNull(),
    /** Verbatim snapshot of what the agent submitted — the commission record. */
    submittedPayload: jsonb('submitted_payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    collegeTag: text('college_tag'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('partner_agent_leads_org_id_agent_id_contact_id_key').on(
      t.orgId,
      t.agentId,
      t.contactId,
    ),
    index('idx_partner_leads_agent').on(t.orgId, t.agentId, t.submittedAt, t.id),
    index('idx_partner_leads_contact').on(t.orgId, t.contactId),
  ],
);

/**
 * API keys for external callers of /public/v1.
 *
 * `keyPrefix` is public and indexed globally — it resolves a request to an org
 * before any tenant context exists. `keyHash` is argon2 over the secret half;
 * `signingSecretEnc` is the HMAC secret, encrypted at the application layer.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    signingSecretEnc: text('signing_secret_enc').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    status: apiKeyStatusEnum('status').notNull().default('active'),
    rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(120),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Reference api_keys.revoked_at / user_id (api overlay). */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userId: idColumn('user_id'),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('uq_api_keys_prefix').on(t.keyPrefix),
    foreignKey({
      name: 'fk_api_keys_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_api_keys_org_status').on(t.orgId, t.status),
  ],
);

export type PartnerAgent = typeof partnerAgents.$inferSelect;
export type PartnerAgentLead = typeof partnerAgentLeads.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
