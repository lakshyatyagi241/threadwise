import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { citext, createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';

/**
 * Mirror of 20261001090000_auth_core.sql. The SQL is the source of
 * truth; this file exists so queries are typed.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Binary column (profile photo bytes until object storage lands). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** Credentials lifecycle, MFA and verification state, one row per user. */
export const userSecurity = pgTable(
  'user_security',
  {
    orgId: orgIdColumn(),
    userId: idColumn('user_id').notNull(),
    emailVerifiedAt: ts('email_verified_at'),
    passwordChangedAt: ts('password_changed_at'),
    forcePasswordChange: boolean('force_password_change').notNull().default(false),
    lastLoginAt: ts('last_login_at'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecretEnc: text('mfa_secret_enc'),
    mfaConfirmedAt: ts('mfa_confirmed_at'),
    mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
    mfaRecoveryHashes: jsonb('mfa_recovery_hashes').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const userProfiles = pgTable(
  'user_profiles',
  {
    orgId: orgIdColumn(),
    userId: idColumn('user_id').notNull(),
    displayName: text('display_name'),
    phoneE164: text('phone_e164'),
    phoneVerifiedAt: ts('phone_verified_at'),
    locale: text('locale'),
    theme: text('theme').notNull().default('paper'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const userAvatars = pgTable(
  'user_avatars',
  {
    orgId: orgIdColumn(),
    userId: idColumn('user_id').notNull(),
    mime: text('mime').notNull(),
    bytes: bytea('bytes').notNull(),
    etag: text('etag').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    userId: idColumn('user_id').notNull(),
    refreshVersion: integer('refresh_version').notNull().default(1),
    rotatedAt: ts('rotated_at').notNull().defaultNow(),
    remember: boolean('remember').notNull().default(false),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('auth_sessions_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_auth_sessions_user').on(t.orgId, t.userId, t.createdAt),
    index('idx_auth_sessions_live')
      .on(t.orgId, t.userId, t.lastUsedAt)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export const userTokens = pgTable(
  'user_tokens',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    userId: idColumn('user_id').notNull(),
    kind: text('kind')
      .$type<'email_verify' | 'password_reset' | 'email_change' | 'invite'>()
      .notNull(),
    tokenHash: text('token_hash').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('user_tokens_org_id_kind_token_hash_key').on(t.orgId, t.kind, t.tokenHash),
    index('idx_user_tokens_user').on(t.orgId, t.userId, t.kind, t.createdAt),
  ],
);

export const socialIdentities = pgTable(
  'social_identities',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    userId: idColumn('user_id').notNull(),
    provider: text('provider').$type<'google' | 'facebook'>().notNull(),
    providerSubject: text('provider_subject').notNull(),
    email: text('email'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('social_identities_org_id_provider_provider_subject_key').on(
      t.orgId,
      t.provider,
      t.providerSubject,
    ),
    index('idx_social_identities_user').on(t.orgId, t.userId),
  ],
);

// --- platform layer: no org_id, privileged-only RLS --------------------------

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  isSecret: boolean('is_secret').notNull().default(false),
  updatedBy: idColumn('updated_by'),
  updatedAt: updatedAt(),
});

export const platformOperators = pgTable('platform_operators', {
  id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
  uuid: uuid('uuid').notNull(),
  email: citext('email').notNull(),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<'super_admin' | 'support' | 'auditor'>().notNull().default('support'),
  status: text('status').$type<'active' | 'suspended'>().notNull().default('active'),
  forcePasswordChange: boolean('force_password_change').notNull().default(false),
  passwordChangedAt: ts('password_changed_at'),
  lastLoginAt: ts('last_login_at'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSecretEnc: text('mfa_secret_enc'),
  mfaConfirmedAt: ts('mfa_confirmed_at'),
  mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
  mfaRecoveryHashes: jsonb('mfa_recovery_hashes').$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  rowVersion: rowVersion(),
});

export const platformSessions = pgTable(
  'platform_sessions',
  {
    id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    operatorId: idColumn('operator_id').notNull(),
    refreshVersion: integer('refresh_version').notNull().default(1),
    rotatedAt: ts('rotated_at').notNull().defaultNow(),
    mfaVerified: boolean('mfa_verified').notNull().default(false),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [index('idx_platform_sessions_operator').on(t.operatorId, t.createdAt)],
);

/** Mirror of 20261114090000_auth_webauthn_credentials.sql: passkeys as a second factor for workspace staff. */
export const webauthnCredentials = pgTable(
  'webauthn_credentials',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    userId: idColumn('user_id').notNull(),
    credentialId: text('credential_id').notNull(),
    publicKey: bytea('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports')
      .array()
      .notNull()
      .default(sql`'{}'`),
    deviceType: text('device_type').$type<'singleDevice' | 'multiDevice'>().notNull(),
    backedUp: boolean('backed_up').notNull().default(false),
    name: text('name').notNull(),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('webauthn_credentials_org_id_uuid_key').on(t.orgId, t.uuid),
    uniqueIndex('webauthn_credentials_credential_id_key').on(t.credentialId),
    index('idx_webauthn_credentials_user').on(t.orgId, t.userId),
  ],
);

/** Same, for platform operators (no organization; privileged access only). */
export const platformWebauthnCredentials = pgTable(
  'platform_webauthn_credentials',
  {
    id: idColumn('id').primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique(),
    operatorId: idColumn('operator_id').notNull(),
    credentialId: text('credential_id').notNull().unique(),
    publicKey: bytea('public_key').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    transports: text('transports')
      .array()
      .notNull()
      .default(sql`'{}'`),
    deviceType: text('device_type').$type<'singleDevice' | 'multiDevice'>().notNull(),
    backedUp: boolean('backed_up').notNull().default(false),
    name: text('name').notNull(),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [index('idx_platform_webauthn_operator').on(t.operatorId)],
);

export const securityEvents = pgTable(
  'security_events',
  {
    id: idColumn('id').primaryKey().generatedAlwaysAsIdentity(),
    at: ts('at').notNull().defaultNow(),
    /** The organization the event is about; not a tenant key (events outlive organizations). */
    subjectOrgId: idColumn('subject_org_id'),
    actorType: text('actor_type').notNull(),
    actorId: idColumn('actor_id'),
    event: text('event').notNull(),
    status: text('status').$type<'success' | 'failure' | 'warning' | 'info'>().notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('idx_security_events_at').on(t.at),
    index('idx_security_events_event').on(t.event, t.at),
  ],
);
