/**
 * Calling readiness (EXT-CALL-007 to 011): what stands between a connected WhatsApp number and "calls can be placed and answered", as a
 * checklist the workspace admin can read, and the reasons Meta gives when it refuses a calling request. Not in Reference, which showed
 * only an on/off switch and Meta's raw refusal text.
 *
 * The server sends stable CODES, never sentences: the web chooses the words (in the person's language) from the code, so nothing
 * is ever parsed out of a message. See docs/threadwise-port/plan/calling-number-readiness-build.md.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/** The rows of the checklist, in the order they are shown. */
export const CALLING_CHECK_KEYS = [
  'plan_feature',
  'connection',
  'not_coexistence',
  'number_registered',
  'messaging_limit',
  'token_scopes',
  'webhook_subscribed',
  'calls_field',
  'calling_enabled',
  'turn',
  'dialler_permissions',
  'recording_consent',
] as const;
export type CallingCheckKey = (typeof CALLING_CHECK_KEYS)[number];

export const CALLING_CHECK_STATES = ['ok', 'warn', 'fail'] as const;
export type CallingCheckState = (typeof CALLING_CHECK_STATES)[number];

/**
 * What a check found. One code per outcome of a row; the same code never means two things. The web holds one sentence for what was
 * found and, for a warn or a fail, one for what to do.
 */
export const CALLING_CHECK_CODES = [
  // plan_feature
  'plan_ok',
  'plan_missing',
  // connection
  'connected',
  'not_connected',
  'no_credentials',
  // not_coexistence
  'cloud_api_only',
  'coexistence',
  'on_premise',
  // number_registered
  'number_ok',
  'number_not_verified',
  'number_not_live',
  // messaging_limit
  'limit_ok',
  'limit_test_number',
  'limit_low',
  'limit_unknown',
  'quality_low',
  // token_scopes
  'scopes_ok',
  'scope_missing',
  'token_invalid',
  'token_expiring',
  'scopes_unverifiable',
  // webhook_subscribed
  'subscribed_ok',
  'waba_not_subscribed',
  // calls_field
  'calls_field_ok',
  'calls_field_added',
  'calls_field_missing',
  'calls_field_unverifiable',
  // calling_enabled
  'calling_on',
  'calling_off',
  'icon_hidden',
  // turn
  'turn_ok',
  'turn_missing',
  'turn_incomplete',
  'ice_invalid',
  // dialler_permissions
  'dialler_ok',
  'dialler_none',
  // recording_consent
  'recording_off',
  'recording_configured',
  'recording_notice_missing',
  // any row whose Meta read failed, or that waits on a row above it
  'meta_unreadable',
  'not_checked',
] as const;
export type CallingCheckCode = (typeof CALLING_CHECK_CODES)[number];

export const callingCheckSchema = z.object({
  key: z.enum(CALLING_CHECK_KEYS),
  state: z.enum(CALLING_CHECK_STATES),
  code: z.enum(CALLING_CHECK_CODES),
  /** Values the sentence needs (a limit tier, a scope name, a count); never text a person has to read as it is. */
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
export type CallingCheck = z.infer<typeof callingCheckSchema>;

/**
 * Where a number stands: `blocked` (a fail other than "calling is off"), `ready_to_enable` (everything else is fine and calling is off),
 * `attention` (calling is on and something is a warning), `ready`, or `never_checked`.
 */
export const CALLING_READINESS_STATUSES = [
  'never_checked',
  'blocked',
  'ready_to_enable',
  'attention',
  'ready',
] as const;
export type CallingReadinessStatus = (typeof CALLING_READINESS_STATUSES)[number];

/** Why a check ran: a number was connected, a person asked, the schedule came round, the health page opened, or a person turned calling on. */
export const CALLING_CHECK_SOURCES = ['connect', 'manual', 'schedule', 'health', 'enable'] as const;
export type CallingCheckSource = (typeof CALLING_CHECK_SOURCES)[number];

export const callingReadinessSchema = z.object({
  numberId: uuidSchema,
  phoneNumber: z.string().nullable(),
  displayLabel: z.string().nullable(),
  connectionStatus: z.string(),
  status: z.enum(CALLING_READINESS_STATUSES),
  /** The local switch: what the Call button follows. After a check it agrees with Meta's own setting when Meta could be read. */
  callingEnabled: z.boolean(),
  /** Meta's own calling status at the last check; null when Meta could not be read. */
  metaCallingStatus: z.enum(['ENABLED', 'DISABLED']).nullable(),
  checks: z.array(callingCheckSchema),
  checkedAt: z.string().nullable(),
  source: z.enum(CALLING_CHECK_SOURCES).nullable(),
});
export type CallingReadiness = z.infer<typeof callingReadinessSchema>;

export const callingReadinessListSchema = z.object({ rows: z.array(callingReadinessSchema) });
export type CallingReadinessList = z.infer<typeof callingReadinessListSchema>;

// --- workspace setting: turn calling on by itself after a number is connected --------------------------------------------------------

/** `GET /v2/calling/settings`, and the result of `PUT`. Off until a workspace admin turns it on: calling is never switched on silently. */
export const callingSettingsSchema = z.object({
  autoEnableOnConnect: z.boolean(),
  /** Null until the first save; required on every later save. */
  rowVersion: z.number().int().nullable(),
  updatedAt: z.string().nullable(),
});
export type CallingSettings = z.infer<typeof callingSettingsSchema>;

export const updateCallingSettingsInputSchema = z.object({
  autoEnableOnConnect: z.boolean(),
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateCallingSettingsInput = z.infer<typeof updateCallingSettingsInputSchema>;

// --- why Meta said no ---------------------------------------------------------------------------------------------------------------------

/**
 * The reason behind a `CALL_META_REFUSED` problem, carried as `details: [{ path: 'reason', message: <one of these> }]`. The server
 * maps Meta's error code (and, for the few that have no stable code, its wording) to one of these; the web translates it. `unknown`
 * means Meta's own words are the best there is, and the problem's `message` carries them.
 */
export const CALLING_META_REASONS = [
  'prerequisites',
  'coexistence',
  'permission_scope',
  'token_expired',
  'calling_not_enabled',
  'no_call_permission',
  'permission_request_limit',
  'receiver_uncallable',
  'meta_unreachable',
  'unknown',
] as const;
export type CallingMetaReason = (typeof CALLING_META_REASONS)[number];

export const callingMetaReasonSchema = z.enum(CALLING_META_REASONS);

/**
 * `POST /v2/calling/numbers/:id/readiness/check`: why the person asked. `manual` is the Check again button, `health` the health page
 * opening, `enable` the check that follows a person turning calling on. `connect` and `schedule` belong to the system.
 */
export const checkReadinessInputSchema = z.object({
  source: z.enum(['manual', 'health', 'enable']).default('manual'),
});
export type CheckReadinessInput = z.infer<typeof checkReadinessInputSchema>;
