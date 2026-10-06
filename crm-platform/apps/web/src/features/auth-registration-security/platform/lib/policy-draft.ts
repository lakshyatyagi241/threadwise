import {
  KEYWORD_LIST_MAX_CHARS,
  keywordListLength,
  securityPolicySchema,
  type SecurityPolicy,
  type SecurityPolicyPatch,
} from '@crm/contracts';
import { isValidAllowlistEntry } from './cidr';
import { formatList, parseList, sameList } from './list-text';

/**
 * The Security Center is one form over 34 policy controls (WD-AUTH-037). The
 * form edits a draft, numbers as text so a field can be blank, lists as the
 * textarea text; `buildPolicyPatch` turns draft + stored policy into the one
 * PATCH body, containing only what changed.
 */

export interface NumericSpec {
  min: number;
  max: number;
  /** The API also accepts 0 although the normal range starts higher (0 = off / unlimited). */
  allowZero?: boolean;
}

/** The numeric controls and their allowed range, as the Security Center form states it. */
const RANGES = {
  sessionTimeoutMinutes: { min: 5, max: 1440 },
  maxConcurrentSessions: { min: 1, max: 50 },
  lockoutAfterFailures: { min: 1, max: 50 },
  lockoutWindowMinutes: { min: 1, max: 1440 },
  passwordMinLength: { min: 6, max: 128 },
  passwordMaxAgeDays: { min: 0, max: 3650 },
  waMaxSendsPerMinute: { min: 0, max: 10_000 },
  waMaxSendsPerDay: { min: 0, max: 1_000_000 },
  waHoldOnLinksCount: { min: 0, max: 50 },
  apiRateLimitPerMinute: { min: 1, max: 100_000 },
  webhookReplayWindowSec: { min: 10, max: 3600 },
  deviceLogoutOnInactiveDays: { min: 0, max: 3650 },
  auditLogRetentionDays: { min: 0, max: 3650 },
} as const satisfies Record<string, { min: number; max: number }>;
export type NumericKey = keyof typeof RANGES;

/**
 * Whether the API takes 0 for a control whose range starts higher (0 = off / unlimited). Asked of the
 * contract itself, so the form can never offer a value the API refuses or hide one it accepts.
 */
const contractAcceptsZero = (key: NumericKey): boolean =>
  securityPolicySchema.shape[key].safeParse(0).success;

export const NUMERIC_FIELDS: Record<NumericKey, NumericSpec> = Object.fromEntries(
  (Object.keys(RANGES) as NumericKey[]).map((key) => [
    key,
    RANGES[key].min > 0
      ? { ...RANGES[key], allowZero: contractAcceptsZero(key) }
      : { ...RANGES[key] },
  ]),
) as Record<NumericKey, NumericSpec>;
export const NUMERIC_KEYS = Object.keys(NUMERIC_FIELDS) as NumericKey[];

export const BOOLEAN_KEYS = [
  'requireMfaForAll',
  'requireMfaForAdmins',
  'requireMfaForOwners',
  'requireMfaForSuperAdmins',
  'rememberMeEnabled',
  'passwordRequireUpper',
  'passwordRequireNumber',
  'passwordRequireSymbol',
  'waHoldOnScamPattern',
  'waRequireTemplateReview',
  'abuseBlockFinanceTerms',
  'abuseBlockShortLinks',
  'webhookSignatureRequired',
  'deviceTrustRequired',
  'ipAllowlistEnabled',
  'alertOnNewDevice',
  'alertOnNewCountry',
] as const satisfies ReadonlyArray<keyof SecurityPolicy>;
export type BooleanKey = (typeof BOOLEAN_KEYS)[number];

export const MFA_METHODS = ['totp', 'email', 'telegram'] as const;
export type MfaMethod = (typeof MFA_METHODS)[number];

/** The allowlist keeps per-entry limits; the keyword list is capped on its total length instead (see `KEYWORD_LIST_MAX_CHARS`). */
export const LIST_LIMITS = {
  ipAllowlistCidrs: { maxItems: 200, maxLength: 64 },
} as const;
export type ListKey = keyof typeof LIST_LIMITS | 'abuseBlockKeywordList';

export type PolicyDraft = { [K in BooleanKey]: boolean } & { [K in NumericKey]: string } & {
  allowedMfaMethods: MfaMethod[];
  waGuardrailsMode: SecurityPolicy['waGuardrailsMode'];
  alertChannel: SecurityPolicy['alertChannel'];
  abuseBlockKeywordList: string;
  ipAllowlistCidrs: string;
};

export function policyToDraft(p: SecurityPolicy): PolicyDraft {
  const draft = {
    allowedMfaMethods: [...p.allowedMfaMethods],
    waGuardrailsMode: p.waGuardrailsMode,
    alertChannel: p.alertChannel,
    abuseBlockKeywordList: formatList(p.abuseBlockKeywordList),
    ipAllowlistCidrs: formatList(p.ipAllowlistCidrs),
  } as PolicyDraft;
  for (const k of BOOLEAN_KEYS) draft[k] = p[k];
  for (const k of NUMERIC_KEYS) draft[k] = String(p[k]);
  return draft;
}

/** Why a control is invalid on the client. The component turns these into translated messages. */
export type FieldProblem =
  | { code: 'range'; min: number; max: number; allowZero: boolean }
  | { code: 'tooMany'; max: number }
  | { code: 'tooLong'; max: number }
  /** Characters over all the items together (the keyword list). */
  | { code: 'totalTooLong'; max: number }
  | { code: 'invalidEntry'; entry: string };
export type PolicyProblems = Partial<Record<keyof SecurityPolicy, FieldProblem>>;

export function numberProblem(raw: string, spec: NumericSpec): number | FieldProblem | null {
  const text = raw.trim();
  if (text === '') return null;
  const problem: FieldProblem = {
    code: 'range',
    min: spec.min,
    max: spec.max,
    allowZero: spec.allowZero === true,
  };
  if (!/^-?\d+$/.test(text)) return problem;
  const value = Number(text);
  if (spec.allowZero && value === 0) return 0;
  return value >= spec.min && value <= spec.max ? value : problem;
}

/**
 * Draft + stored policy -> the PATCH body and any client-side problems.
 * Blank numeric fields keep the stored value (they are simply not sent), the
 * MFA method list can never be emptied (none ticked keeps the previous list),
 * and a field equal to the stored value is not sent.
 */
export function buildPolicyPatch(
  base: SecurityPolicy,
  draft: PolicyDraft,
): { patch: SecurityPolicyPatch; problems: PolicyProblems } {
  const patch: Record<string, unknown> = {};
  const problems: PolicyProblems = {};

  for (const key of BOOLEAN_KEYS) if (draft[key] !== base[key]) patch[key] = draft[key];

  for (const key of NUMERIC_KEYS) {
    const parsed = numberProblem(draft[key], NUMERIC_FIELDS[key]);
    if (parsed === null) continue;
    if (typeof parsed === 'object') problems[key] = parsed;
    else if (parsed !== base[key]) patch[key] = parsed;
  }

  if (draft.waGuardrailsMode !== base.waGuardrailsMode)
    patch.waGuardrailsMode = draft.waGuardrailsMode;
  if (draft.alertChannel !== base.alertChannel) patch.alertChannel = draft.alertChannel;

  if (draft.allowedMfaMethods.length > 0) {
    const next = MFA_METHODS.filter((m) => draft.allowedMfaMethods.includes(m));
    const prev = MFA_METHODS.filter((m) => base.allowedMfaMethods.includes(m));
    if (!sameList(next, prev)) patch.allowedMfaMethods = next;
  }

  for (const key of ['abuseBlockKeywordList', 'ipAllowlistCidrs'] as const) {
    const items = parseList(draft[key]);
    if (key === 'abuseBlockKeywordList') {
      if (keywordListLength(items) > KEYWORD_LIST_MAX_CHARS)
        problems[key] = { code: 'totalTooLong', max: KEYWORD_LIST_MAX_CHARS };
    } else {
      const limit = LIST_LIMITS[key];
      if (items.length > limit.maxItems) problems[key] = { code: 'tooMany', max: limit.maxItems };
      else if (items.some((i) => i.length > limit.maxLength))
        problems[key] = { code: 'tooLong', max: limit.maxLength };
      else {
        const bad = items.find((i) => !isValidAllowlistEntry(i));
        if (bad) problems[key] = { code: 'invalidEntry', entry: bad };
      }
    }
    if (!problems[key] && !sameList(items, base[key])) patch[key] = items;
  }

  return { patch: patch as SecurityPolicyPatch, problems };
}

/** Which tab each control lives on, so a rejected field can bring its tab to the front. */
export type SecurityTab = 'summary' | 'login' | 'whatsapp' | 'abuse' | 'api' | 'devices' | 'danger';
export const SECURITY_TABS: readonly SecurityTab[] = [
  'summary',
  'login',
  'whatsapp',
  'abuse',
  'api',
  'devices',
  'danger',
];

export const FIELD_TAB: Record<keyof SecurityPolicy, SecurityTab> = {
  requireMfaForAll: 'login',
  requireMfaForAdmins: 'login',
  requireMfaForOwners: 'login',
  requireMfaForSuperAdmins: 'login',
  allowedMfaMethods: 'login',
  sessionTimeoutMinutes: 'login',
  maxConcurrentSessions: 'devices',
  rememberMeEnabled: 'login',
  lockoutAfterFailures: 'login',
  lockoutWindowMinutes: 'login',
  passwordMinLength: 'login',
  passwordRequireUpper: 'login',
  passwordRequireNumber: 'login',
  passwordRequireSymbol: 'login',
  passwordMaxAgeDays: 'login',
  waGuardrailsMode: 'whatsapp',
  waMaxSendsPerMinute: 'whatsapp',
  waMaxSendsPerDay: 'whatsapp',
  waHoldOnScamPattern: 'whatsapp',
  waHoldOnLinksCount: 'whatsapp',
  waRequireTemplateReview: 'whatsapp',
  abuseBlockFinanceTerms: 'abuse',
  abuseBlockShortLinks: 'abuse',
  abuseBlockKeywordList: 'abuse',
  apiRateLimitPerMinute: 'api',
  webhookSignatureRequired: 'api',
  webhookReplayWindowSec: 'api',
  deviceTrustRequired: 'devices',
  deviceLogoutOnInactiveDays: 'devices',
  ipAllowlistEnabled: 'api',
  ipAllowlistCidrs: 'api',
  alertOnNewDevice: 'login',
  alertOnNewCountry: 'login',
  alertChannel: 'devices',
  auditLogRetentionDays: 'devices',
};

export const isPolicyKey = (key: string): key is keyof SecurityPolicy => key in FIELD_TAB;
