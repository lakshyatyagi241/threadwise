import { ERROR_CODES, PLAN_UPGRADE_PATH } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/**
 * What the person is told about a failed call, chosen by the problem `code`, never by the server's wording. The only server text that
 * is ever shown is the detail of a field error (a path plus a short code such as `unknown_property`, or a validation message), and
 * those go through `detailIssue` first so a known code is translated.
 */

export type LeadErrorKind =
  /** Someone else saved the source first: offer a reload, never a blind retry. */
  | 'conflict'
  /** The role lacks `leads.sources.*` for this call. */
  | 'noAccess'
  /** The plan has no `lead_sources` feature. */
  | 'locked'
  /** The plan's cap on lead sources is reached. */
  | 'planLimit'
  /** Belongs to one input (or several) of a form. */
  | 'field'
  | 'notFound'
  | 'signedOut'
  | 'general';

export interface LeadFieldIssue {
  /** The field the problem belongs to, dotted (`name`, `defaults.owner.userIds`, `mapping.customFields.budget`). */
  path: string;
  /** Message key under `lead-sources.errors` (or `lead-sources.errors.details`). */
  key: string;
  values?: Record<string, string>;
}

export interface LeadError {
  kind: LeadErrorKind;
  /** Message key under `lead-sources.errors`. */
  key: string;
  /** The form field a single-field error belongs to. */
  field?: string;
  issues: LeadFieldIssue[];
  values?: Record<string, string>;
  requestId?: string;
  /** Plan problems: where to upgrade (same-site path only). */
  upgradeUrl?: string;
  /** Plan problems: the plan feature or limit key that stopped the call (`lead_sources`). */
  feature?: string;
}

/** The short codes the API puts in `errors[].message` for LEAD_MAPPING_INVALID and LEAD_DEFAULTS_INVALID. */
export const LEAD_DETAIL_CODES = [
  'unknown_property',
  'not_mappable',
  'unknown_pipeline',
  'unknown_stage',
  'stage_not_in_pipeline',
  'pipeline_required',
  'unknown_or_lost_stage',
  'unknown_or_inactive_user',
  'template_required',
  'template_not_found',
  'template_not_sendable',
  'sender_not_found',
] as const;
const DETAIL_SET: ReadonlySet<string> = new Set(LEAD_DETAIL_CODES);

/** One `{ path, message }` of the API becomes a translated issue; an unknown message is shown verbatim (it carries no secret). */
export function detailIssue(path: string, message: string): LeadFieldIssue {
  const code = message.split(':')[0] ?? message;
  if (DETAIL_SET.has(code)) return { path, key: `details.${code}` };
  return { path, key: 'detailVerbatim', values: { message } };
}

const sameSitePath = (v: string | undefined): string | undefined =>
  v && v.startsWith('/') && !v.startsWith('//') ? v : undefined;

function detail(err: ApiError, path: string): string | undefined {
  return err.fieldErrors.find((f) => f.path === path)?.message;
}

/** Plan problems carry `feature`, `reason` and `upgradeUrl` as field errors; keep only a same-site upgrade link. */
function planValues(err: ApiError) {
  return {
    upgradeUrl: sameSitePath(detail(err, 'upgradeUrl')) ?? PLAN_UPGRADE_PATH,
    feature: detail(err, 'feature'),
  };
}

/** `used` and `limit` as text for a message, only when the problem carries both as whole numbers (never a guess). */
function planCounts(err: ApiError): { used: string; limit: string } | undefined {
  const used = Number(detail(err, 'used'));
  const limit = Number(detail(err, 'limitValue'));
  return Number.isInteger(used) && Number.isInteger(limit) && used >= 0 && limit > 0
    ? { used: String(used), limit: String(limit) }
    : undefined;
}

/** The issues of a problem that name a field: the contract's own validation messages and the API's detail codes. */
function issuesOf(err: ApiError, translateCodes: boolean): LeadFieldIssue[] {
  return err.fieldErrors
    .filter(
      (f) =>
        ![
          'upgradeUrl',
          'feature',
          'reason',
          'retryAfterSeconds',
          'limit',
          'limitValue',
          'used',
        ].includes(f.path),
    )
    .map((f) =>
      translateCodes
        ? detailIssue(f.path, f.message)
        : { path: f.path, key: 'validationField', values: { message: f.message } },
    );
}

export function leadError(err: unknown): LeadError {
  if (!(err instanceof ApiError)) {
    // A response that did not match its contract is a different failure from a network that did not answer.
    const bad = err instanceof Error && err.name === 'ZodError';
    return { kind: 'general', key: bad ? 'badResponse' : 'network', issues: [] };
  }
  const requestId = err.requestId;
  const base = { issues: [] as LeadFieldIssue[], requestId };
  switch (err.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return { ...base, kind: 'conflict', key: 'conflict' };
    case ERROR_CODES.FORBIDDEN:
      return { ...base, kind: 'noAccess', key: 'noAccess' };
    case ERROR_CODES.UNAUTHENTICATED:
      return { ...base, kind: 'signedOut', key: 'signedOut' };
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return { ...base, kind: 'locked', key: 'planLocked', ...planValues(err) };
    case ERROR_CODES.PLAN_LIMIT_REACHED: {
      // The problem carries `used` (how many the workspace has) and `limitValue` (the cap): "You have used 5 of 5 lead sources".
      const counts = planCounts(err);
      return counts
        ? { ...base, kind: 'planLimit', key: 'planLimitUsed', values: counts, ...planValues(err) }
        : { ...base, kind: 'planLimit', key: 'planLimit', ...planValues(err) };
    }
    case ERROR_CODES.LEAD_SOURCE_NAME_TAKEN:
      return {
        ...base,
        kind: 'field',
        key: 'nameTaken',
        field: 'name',
        issues: [{ path: 'name', key: 'nameTaken' }],
      };
    case ERROR_CODES.LEAD_MAPPING_INVALID: {
      const issues = issuesOf(err, true);
      return { ...base, kind: 'field', key: 'mappingInvalid', issues };
    }
    case ERROR_CODES.LEAD_DEFAULTS_INVALID: {
      const issues = issuesOf(err, true);
      return { ...base, kind: 'field', key: 'defaultsInvalid', issues };
    }
    case ERROR_CODES.LEAD_EVENT_NOT_RETRYABLE:
      return { ...base, kind: 'general', key: 'notRetryable' };
    case ERROR_CODES.LEAD_PAYLOAD_PURGED:
      return { ...base, kind: 'general', key: 'payloadPurged' };
    case ERROR_CODES.LEAD_SOURCE_PAUSED:
      return { ...base, kind: 'general', key: 'sourcePaused' };
    case ERROR_CODES.NOT_FOUND:
      return { ...base, kind: 'notFound', key: 'notFound' };
    case ERROR_CODES.RATE_LIMITED: {
      const seconds = detail(err, 'retryAfterSeconds');
      return seconds
        ? { ...base, kind: 'general', key: 'rateLimitedWait', values: { seconds } }
        : { ...base, kind: 'general', key: 'rateLimited' };
    }
    case ERROR_CODES.VALIDATION_FAILED: {
      const issues = issuesOf(err, false);
      return issues.length > 0
        ? { ...base, kind: 'field', key: 'validation', issues }
        : { ...base, kind: 'general', key: 'validation' };
    }
    default:
      return { ...base, kind: 'general', key: err.status >= 500 ? 'unexpected' : 'request' };
  }
}

/** The issues of an error as `path -> first issue`, for forms that show one line under each input. */
export function issuesByPath(error: LeadError | null): Record<string, LeadFieldIssue> {
  const out: Record<string, LeadFieldIssue> = {};
  for (const i of error?.issues ?? []) if (!(i.path in out)) out[i.path] = i;
  return out;
}

export const isPlanLocked = (err: unknown): boolean =>
  err instanceof ApiError && err.code === ERROR_CODES.PLAN_FEATURE_LOCKED;
export const isRowVersionConflict = (err: unknown): boolean =>
  err instanceof ApiError && err.isRowVersionConflict;
export const isForbidden = (err: unknown): boolean =>
  err instanceof ApiError && err.code === ERROR_CODES.FORBIDDEN;

/** Every key `leadError` can answer (under `lead-sources.errors`), so the messages test proves each has text in every language. */
export const LEAD_ERROR_KEYS = [
  'conflict',
  'noAccess',
  'signedOut',
  'planLocked',
  'planLimit',
  'planLimitUsed',
  'nameTaken',
  'mappingInvalid',
  'defaultsInvalid',
  'notRetryable',
  'payloadPurged',
  'sourcePaused',
  'notFound',
  'rateLimited',
  'rateLimitedWait',
  'validation',
  'validationField',
  'detailVerbatim',
  'badResponse',
  'network',
  'unexpected',
  'request',
] as const;
