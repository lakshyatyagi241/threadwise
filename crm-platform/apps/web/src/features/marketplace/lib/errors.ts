import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { parseConsentProblems, type ConsentDiff } from './consent';
import { safeCheckoutPath } from './pricing';
import { safeInternalPath } from './routes';

/**
 * What a failed call means, chosen by problem `code` (never by the server's wording). The `kind` is also the message key under
 * `marketplace.errors`. Details the screens use come from the problem's `errors` pairs, which the API writes without secrets.
 */
export const MKT_ERROR_KINDS = [
  'network',
  'forbidden',
  'signedOut',
  'conflict',
  'validation',
  'rateLimited',
  'unavailable',
  'notFound',
  'appNotFound',
  'notInstalled',
  'alreadyInstalled',
  'appUnavailable',
  'appLockedPlan',
  'appLockedModule',
  'planLocked',
  'planLimitInstalled',
  'planLimitLeadSources',
  'planLimit',
  'consentRequired',
  'reconsentRequired',
  'scopeExceeds',
  'installationKilled',
  'installationDisabled',
  'credentialMissing',
  'noConnection',
  'leadPipeline',
  'subscriptionRequired',
  'notForSale',
  'trialUnavailable',
  'subscriptionNotFound',
  'subscriptionState',
  'renewalNotStopped',
  'unexpected',
] as const;
export type MktErrorKind = (typeof MKT_ERROR_KINDS)[number];

/** Message keys beyond one per kind: the variants that carry numbers (`{used}`, `{cap}`, `{seconds}`). */
export const MKT_ERROR_EXTRA_KEYS = [
  'rateLimitedWait',
  'planLimitCounts',
  'planLimitInstalledCounts',
  'planLimitLeadSourcesCounts',
] as const;

/** The limit keys the API names in `PLAN_LIMIT_REACHED`'s `limit` detail. */
export const INSTALLED_APPS_LIMIT_KEY = 'installed_apps';
export const LEAD_SOURCES_LIMIT_KEY = 'lead_sources';

export interface MktError {
  kind: MktErrorKind;
  requestId?: string;
  /** For the plan and lock kinds: where "upgrade" goes (same-site path only). */
  upgradeHref: string | null;
  /** `MKT_SCOPE_EXCEEDS_INSTALLER`: the permission keys the person lacks. */
  missingPermissions: string[];
  /** `MKT_CONSENT_REQUIRED`: which scopes were left out or never shown. Null for every other kind. */
  consent: ConsentDiff | null;
  /** Field-level problems by field key (`credentials.<key>` becomes `<key>`, `config.<key>` too). */
  fields: Record<string, string>;
  /** The plan limit a `PLAN_LIMIT_REACHED` named, when it did. */
  limit: { used: number | null; cap: number | null } | null;
  /** `MKT_SUBSCRIPTION_REQUIRED`: where to pay (the add-on checkout page; any other address is dropped). Null for every other kind. */
  checkoutPath: string | null;
}

const pick = (err: ApiError, path: string): string | undefined =>
  err.fieldErrors.find((e) => e.path === path)?.message;

const toNumber = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function fieldMap(err: ApiError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of err.fieldErrors) {
    const m = /^(?:credentials|config|clearCredentials)\.(.+)$/.exec(e.path);
    const key = m ? m[1]! : e.path;
    if (!(key in out)) out[key] = e.message;
  }
  return out;
}

function kindOf(err: ApiError): MktErrorKind {
  switch (err.code) {
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.UNAUTHENTICATED:
      return 'signedOut';
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return 'conflict';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.NOT_FOUND:
      return 'notFound';
    case ERROR_CODES.MKT_APP_NOT_FOUND:
      return 'appNotFound';
    case ERROR_CODES.MKT_NOT_INSTALLED:
      return 'notInstalled';
    case ERROR_CODES.MKT_ALREADY_INSTALLED:
      return 'alreadyInstalled';
    case ERROR_CODES.MKT_APP_UNAVAILABLE:
      return 'appUnavailable';
    case ERROR_CODES.MKT_APP_LOCKED:
      return pick(err, 'reason') === 'module_disabled' ? 'appLockedModule' : 'appLockedPlan';
    case ERROR_CODES.PLAN_FEATURE_LOCKED:
      return 'planLocked';
    case ERROR_CODES.PLAN_LIMIT_REACHED: {
      const key = pick(err, 'limit');
      if (key === INSTALLED_APPS_LIMIT_KEY) return 'planLimitInstalled';
      if (key === LEAD_SOURCES_LIMIT_KEY) return 'planLimitLeadSources';
      return 'planLimit';
    }
    case ERROR_CODES.MKT_CONSENT_REQUIRED:
      return 'consentRequired';
    case ERROR_CODES.MKT_RECONSENT_REQUIRED:
      return 'reconsentRequired';
    case ERROR_CODES.MKT_SCOPE_EXCEEDS_INSTALLER:
      return 'scopeExceeds';
    case ERROR_CODES.MKT_INSTALLATION_KILLED:
      return 'installationKilled';
    case ERROR_CODES.MKT_INSTALLATION_DISABLED:
      return 'installationDisabled';
    case ERROR_CODES.MKT_CREDENTIAL_MISSING:
      return 'credentialMissing';
    case ERROR_CODES.MKT_NO_CONNECTION:
      return 'noConnection';
    case ERROR_CODES.MKT_LEAD_PIPELINE_UNAVAILABLE:
      return 'leadPipeline';
    case ERROR_CODES.MKT_SUBSCRIPTION_REQUIRED:
      return 'subscriptionRequired';
    case ERROR_CODES.MKT_NOT_FOR_SALE:
      return 'notForSale';
    case ERROR_CODES.MKT_TRIAL_UNAVAILABLE:
      return 'trialUnavailable';
    case ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND:
      return 'subscriptionNotFound';
    case ERROR_CODES.MKT_SUBSCRIPTION_STATE:
      return 'subscriptionState';
    case ERROR_CODES.MKT_RENEWAL_NOT_STOPPED:
      return 'renewalNotStopped';
  }
  // A route that is not deployed answers 404 or 501 without one of our codes for it.
  if (err.status === 404 || err.status === 501) return 'unavailable';
  return 'unexpected';
}

export function mktError(error: unknown): MktError {
  if (!(error instanceof ApiError)) {
    return {
      kind: 'network',
      upgradeHref: null,
      missingPermissions: [],
      consent: null,
      fields: {},
      limit: null,
      checkoutPath: null,
    };
  }
  const kind = kindOf(error);
  const upgrade = pick(error, 'upgradeUrl');
  const isPlan =
    kind === 'planLocked' ||
    kind === 'planLimit' ||
    kind === 'planLimitInstalled' ||
    kind === 'planLimitLeadSources' ||
    kind === 'appLockedPlan';
  return {
    kind,
    requestId: error.requestId,
    upgradeHref: isPlan ? safeInternalPath(upgrade) : null,
    missingPermissions:
      kind === 'scopeExceeds'
        ? error.fieldErrors.filter((e) => e.path === 'permission').map((e) => e.message)
        : [],
    consent: kind === 'consentRequired' ? parseConsentProblems(error.fieldErrors) : null,
    fields: kind === 'validation' || kind === 'credentialMissing' ? fieldMap(error) : {},
    limit:
      kind === 'planLimitInstalled' || kind === 'planLimitLeadSources' || kind === 'planLimit'
        ? { used: toNumber(pick(error, 'used')), cap: toNumber(pick(error, 'limitValue')) }
        : null,
    checkoutPath:
      kind === 'subscriptionRequired' ? safeCheckoutPath(pick(error, 'checkoutPath')) : null,
  };
}

/** A plan gate: the whole Marketplace (or one app) is behind something the workspace does not have. */
export const isPlanGate = (e: MktError): boolean =>
  e.kind === 'planLocked' ||
  e.kind === 'appLockedPlan' ||
  e.kind === 'planLimit' ||
  e.kind === 'planLimitInstalled' ||
  e.kind === 'planLimitLeadSources';

/** The kinds after which nothing was installed or changed, so the person may try again as is. */
export const isRetryable = (e: MktError): boolean =>
  e.kind === 'network' ||
  e.kind === 'rateLimited' ||
  e.kind === 'leadPipeline' ||
  e.kind === 'unexpected';

export const isRowVersionConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.isRowVersionConflict;

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;

/** Seconds a 429 asked the caller to wait, from the `Retry-After` the client folds into the problem's details. */
export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  const n = Number(error.fieldErrors.find((e) => e.path === 'retryAfterSeconds')?.message);
  return Number.isFinite(n) && n > 0 ? n : null;
}
