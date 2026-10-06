import { z } from 'zod';

/**
 * The platform security policy (TW-AUTH-037): one typed document, one partial
 * PATCH, one audit event with a diff. Reference spread these over 34 `security.*`
 * rows and enforced about half of them; the enforcement matrix below says which
 * of ours are enforced, so the admin screen does not over-promise.
 */

/**
 * The keyword box is one text area in Reference, capped at 5000 characters with
 * no per-keyword limit. We keep a list, and cap the same total: the items joined
 * one per line, counted in characters (code points).
 */
export const KEYWORD_LIST_MAX_CHARS = 5000;
export const keywordListLength = (list: readonly string[]): number =>
  Array.from(list.join('\n')).length;

export const securityPolicySchema = z.object({
  // --- login and MFA
  requireMfaForAll: z.boolean().default(false),
  requireMfaForAdmins: z.boolean().default(false),
  requireMfaForOwners: z.boolean().default(false),
  /** Platform super admins. Off: they sign in with a password alone, enrolled or not. */
  requireMfaForSuperAdmins: z.boolean().default(false),
  /** Only 'totp' exists; the others are accepted and stored for parity. Reference's default is authenticator app + email. */
  allowedMfaMethods: z
    .array(z.enum(['totp', 'email', 'telegram']))
    .min(1)
    .default(['totp', 'email']),
  /** Idle minutes before a non-remembered session expires. 0 cannot be saved, as in Reference. */
  sessionTimeoutMinutes: z.number().int().min(5).max(1440).default(60),
  /** Devices signed in at once. 0 cannot be saved, as in Reference. */
  maxConcurrentSessions: z.number().int().min(1).max(50).default(5),
  rememberMeEnabled: z.boolean().default(true),
  /** Failed sign-ins before a lockout. 0 cannot be saved, as in Reference. */
  lockoutAfterFailures: z.number().int().min(1).max(50).default(5),
  lockoutWindowMinutes: z.number().int().min(1).max(1440).default(15),
  // --- password rules (sign-up, reset, change, admin-set)
  passwordMinLength: z.number().int().min(6).max(128).default(8),
  passwordRequireUpper: z.boolean().default(true),
  passwordRequireNumber: z.boolean().default(true),
  passwordRequireSymbol: z.boolean().default(false),
  /** 0 = never expires. */
  passwordMaxAgeDays: z.number().int().min(0).max(3650).default(0),
  // --- send guardrails
  waGuardrailsMode: z.enum(['off', 'monitor', 'enforce']).default('off'),
  waMaxSendsPerMinute: z.number().int().min(0).max(10_000).default(0),
  waMaxSendsPerDay: z.number().int().min(0).max(1_000_000).default(0),
  waHoldOnScamPattern: z.boolean().default(false),
  waHoldOnLinksCount: z.number().int().min(0).max(50).default(0),
  waRequireTemplateReview: z.boolean().default(false),
  // --- abuse filters
  abuseBlockFinanceTerms: z.boolean().default(false),
  abuseBlockShortLinks: z.boolean().default(false),
  abuseBlockKeywordList: z
    .array(z.string().trim().min(1))
    .refine((list) => keywordListLength(list) <= KEYWORD_LIST_MAX_CHARS, {
      message: `Keep the keyword list under ${KEYWORD_LIST_MAX_CHARS} characters.`,
    })
    .default([]),
  // --- API and webhooks
  apiRateLimitPerMinute: z.number().int().min(1).max(100_000).default(600),
  webhookSignatureRequired: z.boolean().default(true),
  webhookReplayWindowSec: z.number().int().min(10).max(3600).default(300),
  // --- devices
  deviceTrustRequired: z.boolean().default(false),
  deviceLogoutOnInactiveDays: z.number().int().min(0).max(3650).default(30),
  ipAllowlistEnabled: z.boolean().default(false),
  /** IPv4/IPv6 addresses or CIDRs. Applies to /v2/platform/* only. */
  ipAllowlistCidrs: z.array(z.string().trim().min(1).max(64)).max(200).default([]),
  // --- alerts and retention
  alertOnNewDevice: z.boolean().default(true),
  alertOnNewCountry: z.boolean().default(true),
  alertChannel: z.enum(['email', 'whatsapp', 'both']).default('email'),
  auditLogRetentionDays: z.number().int().min(0).max(3650).default(365),
});
export type SecurityPolicy = z.infer<typeof securityPolicySchema>;

export const securityPolicyPatchSchema = securityPolicySchema.partial();
export type SecurityPolicyPatch = z.infer<typeof securityPolicyPatchSchema>;

export const enforcementStatusSchema = z.enum(['enforced', 'partial', 'reserved']);

export const enforcementItemSchema = z.object({
  /** Human label of the row. */
  key: z.string(),
  /** The policy keys this row covers; the screen maps controls to rows through this list. */
  controls: z.array(z.string()).min(1),
  consumer: z.string(),
  status: enforcementStatusSchema,
});

export const riskSeveritySchema = z.enum(['high', 'medium', 'watch']);

export const riskItemSchema = z.object({
  severity: riskSeveritySchema,
  /** The event name, e.g. auth.lockout. */
  signal: z.string(),
  /** A label from the event, or '' when it has none worth showing (never the event name again). */
  detail: z.string(),
  /** The workspace's name; null when the event belongs to no workspace (see `scope`). */
  workspace: z.string().nullable(),
  /**
   * What `workspace: null` means: the event is a platform-level one (the screen
   * shows "<app name> Platform"), or it belongs to nothing at all (a dash).
   */
  scope: z.enum(['workspace', 'platform', 'none']),
  /** Who did it: the person's name, never the actor type. 'System' when there is no actor. */
  actor: z.string(),
  actorKind: z.enum(['user', 'platform_operator', 'system']),
  at: z.string().datetime(),
});

export const coverageBucketSchema = z.object({
  key: z.enum(['admin_access', 'send_abuse', 'api_hardening', 'incident_readiness']),
  percent: z.number().int().min(0).max(100),
  /** Controls switched on in this bucket, and how many it has ("2/4"). */
  enabled: z.number().int().nonnegative(),
  total: z.number().int().positive(),
});

export const securityOverviewResponseSchema = z.object({
  /** The platform's display name, for "<app name> Platform" in the risk queue. */
  appName: z.string(),
  policy: securityPolicySchema,
  emergencyHalt: z.boolean(),
  kpis: z.object({
    /** 0-100, ten points per enabled control. */
    score: z.number().int().min(0).max(100),
    openRisks: z.number().int().nonnegative(),
    highPriorityRisks: z.number().int().nonnegative(),
    blockedAttempts24h: z.number().int().nonnegative(),
    warnings24h: z.number().int().nonnegative(),
    operatorMfa: z.object({
      enrolled: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    webhookFailurePct: z.number().min(0).max(100),
  }),
  risks: z.array(riskItemSchema),
  coverage: z.array(coverageBucketSchema),
  enforcement: z.array(enforcementItemSchema),
  /** The caller's address as the API sees it, shown next to the allowlist. */
  yourIp: z.string().nullable(),
});
export type SecurityOverviewResponse = z.infer<typeof securityOverviewResponseSchema>;

export const dangerActionResponseSchema = z.object({
  action: z.enum([
    'revoke_sessions',
    'force_password_reset',
    'rotate_webhook_secrets',
    'halt_sends',
    'resume_sends',
  ]),
  /** Users, sessions or workspaces touched, depending on the action. */
  affected: z.number().int().nonnegative(),
});
export type DangerActionResponse = z.infer<typeof dangerActionResponseSchema>;

export const securityEventSchema = z.object({
  id: z.string(),
  at: z.string().datetime(),
  event: z.string(),
  status: z.enum(['success', 'failure', 'warning', 'info']),
  actorType: z.string(),
  /** The actor's public id (user or operator uuid); null for system events or a deleted account. */
  actorId: z.string().uuid().nullable(),
  /** Resolved at read time, so it is current: null when the actor no longer exists. */
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  /** Organization uuid when the event belongs to one. */
  orgId: z.string().uuid().nullable(),
  orgSlug: z.string().nullable(),
  orgName: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  payload: z.record(z.unknown()),
});
export const securityEventListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(256).optional(),
  event: z.string().max(80).optional(),
  /** Case-insensitive text search in the event name (what the risk queue's Inspect link uses). */
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(['success', 'failure', 'warning', 'info']).optional(),
});
export type SecurityEventListQuery = z.infer<typeof securityEventListQuerySchema>;
export const securityEventListResponseSchema = z.object({
  data: z.array(securityEventSchema),
  page: z.object({ nextCursor: z.string().nullable(), hasMore: z.boolean(), limit: z.number() }),
});
