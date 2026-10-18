import {
  DPDP_ATTESTABLE_CHECKS,
  DPDP_CODE_CHECKS,
  DPDP_LIVE_CHECKS,
  ERROR_CODES,
  dpdpAttestInputSchema,
  type DpdpAttestInput,
  type DpdpCheckKey,
  type DpdpCheckSource,
  type DpdpCheckView,
  type DpdpItemStatus,
  type DpdpRegisterResponse,
  type OperatorRole,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The chips above the list: every row, or the rows of one status. `not_applicable` has no chip (those rows are not counted). */
export type StatusFilter = 'all' | DpdpItemStatus;
export const STATUS_FILTERS: readonly StatusFilter[] = [
  'all',
  'not_following',
  'partial',
  'unverified',
  'following',
];

/** The rows of the chosen status in each group, in the order the server sent them; a group left empty is dropped. */
export function filterGroups(
  groups: DpdpRegisterResponse['groups'],
  filter: StatusFilter,
): DpdpRegisterResponse['groups'] {
  if (filter === 'all') return groups;
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.status === filter) }))
    .filter((group) => group.items.length > 0);
}

export type StatusTone = 'good' | 'warn' | 'bad' | 'neutral';

const TONES: Record<DpdpItemStatus, StatusTone> = {
  following: 'good',
  partial: 'warn',
  not_following: 'bad',
  unverified: 'neutral',
  not_applicable: 'neutral',
};

export const statusTone = (status: DpdpItemStatus): StatusTone => TONES[status];

/** The five statuses of the summary strip, worst first like the list. */
const COUNT_ORDER = [
  'not_following',
  'partial',
  'unverified',
  'following',
  'not_applicable',
] as const satisfies readonly DpdpItemStatus[];

/**
 * The count of each status. The API's summary leaves `not_applicable` out (those rows are listed but not counted), so that one
 * comes from the items.
 */
export function statusCounts(
  register: Pick<DpdpRegisterResponse, 'summary' | 'groups'>,
): { status: DpdpItemStatus; count: number }[] {
  const { summary, groups } = register;
  const counts: Record<DpdpItemStatus, number> = {
    not_following: summary.notFollowing,
    partial: summary.partial,
    unverified: summary.unverified,
    following: summary.following,
    not_applicable: groups.reduce(
      (n, group) => n + group.items.filter((item) => item.status === 'not_applicable').length,
      0,
    ),
  };
  return COUNT_ORDER.map((status) => ({ status, count: counts[status] }));
}

/** The width of each part of the stacked bar, as a percentage of the counted obligations. Zero counted draws an empty bar. */
export function barShares(
  summary: DpdpRegisterResponse['summary'],
): { status: DpdpItemStatus; percent: number }[] {
  const counted = statusCounts({ summary, groups: [] }).filter(
    (s) => s.status !== 'not_applicable',
  );
  return counted.map(({ status, count }) => ({
    status,
    percent: summary.total > 0 ? (count / summary.total) * 100 : 0,
  }));
}

/** Every check key, live then attested then code. */
export const ALL_CHECK_KEYS: readonly DpdpCheckKey[] = [
  ...DPDP_LIVE_CHECKS,
  ...DPDP_ATTESTABLE_CHECKS,
  ...DPDP_CODE_CHECKS,
];

/**
 * The message key of a check. A check key has a dot (`mfa.operators`) and next-intl reads a dot as nesting, so the message file
 * names it `mfa_operators`.
 */
export const checkMessageKey = (key: DpdpCheckKey): string => key.replaceAll('.', '_');

/**
 * The details only one check can return: the texts that say what that check read (`checks.<key>.details.<detail>`). The compiler
 * asks for an entry whenever the contract gains a check. Attested and code checks return only the shared details below.
 */
export const CHECK_DETAILS: Record<DpdpCheckKey, readonly string[]> = {
  'mfa.operators': ['mfa_on', 'mfa_off'],
  'mfa.workspace_admins': ['mfa_on', 'mfa_off'],
  'logs.audit_retention': ['retention_ok', 'retention_unlimited', 'retention_below_floor'],
  'logs.session_retention': ['retention_ok', 'retention_below_floor'],
  'redis.auth': ['redis_auth_on', 'redis_auth_off'],
  'crypto.rotation_complete': ['rotation_complete', 'previous_keys_present'],
  'lifecycle.enabled': ['lifecycle_on', 'lifecycle_off'],
  'errors.vendor_region': [
    'sentry_off',
    'region_india',
    'region_outside_india',
    'region_unrecognised',
    'region_unrecognised_host',
  ],
  'ai.platform_key_off': ['no_platform_key', 'platform_key_set'],
  'consent.default_opt_in': [
    'default_opt_in',
    'default_opt_out',
    'default_opt_in_counts',
    'default_opt_out_counts',
  ],
  'hosting.region_documented': [],
  'storage.encrypted_at_rest': [],
  'backup.offsite_configured': [],
  'backup.restore_drill': [],
  'security.pentest_report': [],
  'legal.counsel_engaged': [],
  'legal.vendor_dpas': [],
  'governance.contacts_named': [],
  'pii.column_encryption': [],
  'rls.privileged_guc_fixed': [],
  'logs.erasure_keeps_year': [],
  'ci.security_jobs_scheduled': [],
  'ai.workspace_switch': [],
  'transfer.country_killswitch': [],
  'dpa.acceptance_persisted': [],
  'consent.lawful_basis_dpdp': [],
  'lifecycle.exit_and_orphans_fixed': [],
  'evidence.board_pack': [],
  'grievance.intake_built': [],
};

/**
 * The details any check can return (`details.<detail>`): a probe that could not read, a missing variable, the state of an
 * attestation, and a code check. One text each, so the 29 checks do not carry 29 copies for translators.
 */
export const GENERIC_DETAILS: readonly string[] = [
  'probe_error',
  'probe_missing',
  'env_missing',
  'attestation_missing',
  'attestation_expired',
  'attested_pass',
  'attested_fail',
  'code_declared',
];

/** The text for a detail this build does not know (the API can be newer than the console). It shows the code. */
export const UNRECOGNISED_DETAIL_KEY = 'details.unrecognised';

/** What the API sends as the params of a check. */
type Params = NonNullable<DpdpCheckView['params']>;
/** The values a message is given. next-intl takes no booleans, so those travel as the words `true` and `false`. */
export type DetailValues = Record<string, string | number>;

/** Some details have a second text that names the numbers or the host; the API sends the same detail either way. */
function variantOf(detail: string, params: Params | undefined): string {
  if (detail === 'region_unrecognised' && typeof params?.host === 'string') {
    return 'region_unrecognised_host';
  }
  if (
    (detail === 'default_opt_in' || detail === 'default_opt_out') &&
    typeof params?.on === 'number' &&
    typeof params?.total === 'number'
  ) {
    return `${detail}_counts`;
  }
  return detail;
}

/**
 * The params as the text shows them: a region as capitals (`US`), a comma-joined provider list with spaces, a switch as the word
 * `true` or `false` (the lifecycle text picks its wording with a select on it).
 */
function displayParams(params: Params | undefined): DetailValues {
  const out: DetailValues = {};
  for (const [name, value] of Object.entries(params ?? {})) {
    out[name] = typeof value === 'boolean' ? String(value) : value;
  }
  if (typeof out.region === 'string') out.region = out.region.toUpperCase();
  if (typeof out.providers === 'string') {
    out.providers = out.providers
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .join(', ');
  }
  return out;
}

/**
 * Which message (a key under the `dpdp-register-admin` root) and which values show the detail of a check. The attestation values
 * (who, when) are added by the caller, which formats the dates.
 */
export function detailMessage(check: Pick<DpdpCheckView, 'key' | 'detail' | 'params'>): {
  key: string;
  values: DetailValues;
} {
  const detail = variantOf(check.detail, check.params);
  const values = displayParams(check.params);
  if (CHECK_DETAILS[check.key].includes(detail)) {
    return { key: `checks.${checkMessageKey(check.key)}.details.${detail}`, values };
  }
  if (GENERIC_DETAILS.includes(detail)) return { key: `details.${detail}`, values };
  return { key: UNRECOGNISED_DETAIL_KEY, values: { ...values, detail: check.detail } };
}

/** A lapsed attestation is the check's own detail. An attached attestation alone says nothing: a valid one carries it too. */
export const isLapsed = (check: Pick<DpdpCheckView, 'detail'> & Partial<DpdpCheckView>): boolean =>
  check.detail === 'attestation_expired';

/** Only a super admin records a statement, and only on a check whose source is `attested`. The API enforces both. */
export const canAttest = (role: OperatorRole, source: DpdpCheckSource): boolean =>
  role === 'super_admin' && source === 'attested';

/** Every role reads the history, but only attested checks have one. */
export const canViewHistory = (source: DpdpCheckSource): boolean => source === 'attested';

/** The link when it is a well-formed https address, else null: the page never links anything else. */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** The failures the dialog has a sentence for (`errors.<kind>`). */
export const ERROR_KINDS = [
  'forbidden',
  'validation',
  'notFound',
  'network',
  'request',
  'unexpected',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** Which message to show for a failed call. Branches on the stable code and status, never on the server's wording. */
export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (error.code === ERROR_CODES.VALIDATION_FAILED) return 'validation';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 422) return 'validation';
  return error.status >= 500 ? 'unexpected' : 'request';
}

/** The limits of a statement. Mirrors the contract schema (a test proves the two agree). */
export const ATTEST_LIMITS = {
  noteMin: 10,
  noteMax: 2000,
  daysMin: 1,
  daysMax: 365,
  daysDefault: 90,
} as const;

/** The dialog's working copy. The expiry stays text until it is validated. */
export interface AttestDraft {
  result: 'pass' | 'fail';
  note: string;
  evidenceUrl: string;
  expiresInDays: string;
}

export const emptyAttestDraft = (): AttestDraft => ({
  result: 'pass',
  note: '',
  evidenceUrl: '',
  expiresInDays: String(ATTEST_LIMITS.daysDefault),
});

export type AttestErrors = {
  note?: 'short' | 'long';
  evidenceUrl?: 'link';
  expiresInDays?: 'range';
};

/**
 * The POST body for the draft, or what is wrong with it. The contract schema is the validator, so the dialog can never disagree
 * with the server. A blank evidence link is left out of the body: the schema refuses an empty string.
 */
export function buildAttestInput(
  draft: AttestDraft,
): { ok: true; body: DpdpAttestInput } | { ok: false; errors: AttestErrors } {
  const days = draft.expiresInDays.trim();
  const evidenceUrl = draft.evidenceUrl.trim();
  const candidate = {
    result: draft.result,
    note: draft.note,
    expiresInDays: /^\d+$/.test(days) ? Number(days) : Number.NaN,
    ...(evidenceUrl ? { evidenceUrl } : {}),
  };
  const parsed = dpdpAttestInputSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, body: parsed.data };

  const errors: AttestErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field === 'note' && !errors.note) errors.note = issue.code === 'too_big' ? 'long' : 'short';
    else if (field === 'evidenceUrl') errors.evidenceUrl = 'link';
    else if (field === 'expiresInDays') errors.expiresInDays = 'range';
  }
  return { ok: false, errors };
}
