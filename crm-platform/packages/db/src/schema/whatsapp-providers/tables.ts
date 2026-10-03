import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, rowVersion, updatedAt } from '../columns';
import { platformOperators } from '../auth-registration-security/core';
import { organizations } from '../foundation';

/**
 * Mirror of 20261018090000_whatsapp_providers.sql. The SQL is the source of truth; this file exists so queries are typed.
 * `whatsapp_providers` is platform-owned (no org_id, privileged-only RLS); the assignment is a tenant-readable, operator-written row.
 */

export interface WhatsappProviderCapabilitiesJson {
  mediaUpload: boolean;
}

export interface WhatsappProviderTestJson {
  ok: boolean;
  testedAt: string;
  latencyMs: number;
  httpStatus: number | null;
  errorCode: string | null;
  message: string | null;
}

export const whatsappProviders = pgTable(
  'whatsapp_providers',
  {
    id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom().unique(),
    key: text('key').notNull().unique(),
    label: text('label').notNull(),
    builtin: text('builtin').$type<'meta' | 'interakt'>(),
    adapterKind: text('adapter_kind').notNull().default('meta_graph'),
    baseUrl: text('base_url').notNull(),
    apiVersion: text('api_version').notNull(),
    authScheme: text('auth_scheme').$type<'bearer' | 'custom_headers'>().notNull(),
    headerTemplates: jsonb('header_templates')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    credentialMode: text('credential_mode').$type<'platform_token' | 'channel_token'>().notNull(),
    /** CryptoService envelope of the provider's secrets. Never leaves the API. */
    credentialsEnc: text('credentials_enc'),
    credentialHints: jsonb('credential_hints')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    webhookMode: text('webhook_mode')
      .$type<'meta_app_level' | 'number_level_override'>()
      .notNull()
      .default('number_level_override'),
    signatureScheme: text('signature_scheme')
      .$type<'meta_app_secret_sha256' | 'shared_secret_header' | 'none'>()
      .notNull()
      .default('meta_app_secret_sha256'),
    signatureHeaderName: text('signature_header_name'),
    billingMode: text('billing_mode')
      .$type<'provider_credit_line' | 'customer_direct' | 'meta_reseller'>()
      .notNull()
      .default('provider_credit_line'),
    capabilities: jsonb('capabilities')
      .$type<WhatsappProviderCapabilitiesJson>()
      .notNull()
      .default({ mediaUpload: true }),
    onboarding: text('onboarding')
      .$type<'manual' | 'embedded_signup'>()
      .notNull()
      .default('manual'),
    onboardingAppId: text('onboarding_app_id'),
    onboardingConfigId: text('onboarding_config_id'),
    status: text('status')
      .$type<'active' | 'disabled' | 'archived'>()
      .notNull()
      .default('disabled'),
    isDefault: boolean('is_default').notNull().default(false),
    notes: text('notes'),
    lastTest: jsonb('last_test').$type<WhatsappProviderTestJson>(),
    lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
    createdByOperatorId: idColumn('created_by_operator_id').references(() => platformOperators.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    uniqueIndex('uq_whatsapp_providers_default')
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
    check('chk_whatsapp_providers_status', sql`${t.status} in ('active', 'disabled', 'archived')`),
  ],
);

export type WhatsappProvidersRow = typeof whatsappProviders.$inferSelect;
export type NewWhatsappProvidersRow = typeof whatsappProviders.$inferInsert;

export const orgWhatsappProviderAssignment = pgTable(
  'org_whatsapp_provider_assignment',
  {
    orgId: idColumn('org_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    providerId: idColumn('provider_id')
      .notNull()
      .references(() => whatsappProviders.id, { onDelete: 'restrict' }),
    note: text('note'),
    assignedByOperatorId: idColumn('assigned_by_operator_id').references(
      () => platformOperators.id,
      { onDelete: 'set null' },
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: integer('row_version').notNull().default(1),
  },
  (t) => [index('idx_org_whatsapp_provider_assignment_provider').on(t.providerId)],
);

export type OrgWhatsappProviderAssignmentRow = typeof orgWhatsappProviderAssignment.$inferSelect;
export type NewOrgWhatsappProviderAssignmentRow = typeof orgWhatsappProviderAssignment.$inferInsert;
