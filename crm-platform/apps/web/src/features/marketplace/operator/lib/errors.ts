import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

export type MarketErrorKind =
  /** Someone else saved first: offer a reload, never a blind retry. */
  | 'conflict'
  /** The operator lacks the platform permission the route demands. */
  | 'noAccess'
  /** The API named the paths that are wrong: the editors and fields show each one. */
  | 'problems'
  | 'general';

/** One `{ path, message }` pair of a problem+json body, sorted by the document or form field it belongs to. */
export interface ServerProblem {
  /** `manifest` and `recipe` are the two JSON editors; `field` is anything else (tagline, listing.logo, slug...). */
  target: 'manifest' | 'recipe' | 'field';
  /** The path inside the document (`scopes.0`), or the whole path of a form field. Empty for the document itself. */
  path: string;
  /** The server's text for the problem (contract messages, English). Shown with its path, never parsed. */
  message: string;
}

export interface MarketError {
  kind: MarketErrorKind;
  /** Message key under `marketplace.operator.errors`. */
  key: string;
  /** ICU values for the message (`permission`, `type`, `status`, `newest`, `seconds`, `detail`). */
  values?: Record<string, string>;
  requestId?: string;
  problems: ServerProblem[];
}

/** `manifest.scopes.0` -> the manifest editor, `scopes.0`. `recipe.mapping` likewise. Anything else is a form field. */
export function splitServerPath(raw: string): Pick<ServerProblem, 'target' | 'path'> {
  for (const target of ['manifest', 'recipe'] as const) {
    if (raw === target) return { target, path: '' };
    if (raw.startsWith(`${target}.`)) return { target, path: raw.slice(target.length + 1) };
  }
  return { target: 'field', path: raw };
}

export function serverProblems(err: ApiError): ServerProblem[] {
  return err.fieldErrors
    .filter((e) => e.path !== 'retryAfterSeconds')
    .map((e) => ({ ...splitServerPath(e.path), message: e.message }));
}

/**
 * Branches on the problem+json `code`, never on its message text. The only server text shown is the per-path problem list
 * (validation messages the contract writes without secrets) and the connector type / version / status the API names in `errors`.
 */
export function marketError(err: unknown): MarketError {
  if (!(err instanceof ApiError)) return { kind: 'general', key: 'unexpected', problems: [] };
  const requestId = err.requestId;
  const problems = serverProblems(err);
  const first = err.fieldErrors[0];
  const base = { requestId, problems };
  switch (err.code) {
    case ERROR_CODES.ROW_VERSION_CONFLICT:
      return { kind: 'conflict', key: 'conflict', ...base };
    case ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED:
      return {
        kind: 'noAccess',
        key: 'noAccess',
        values: { permission: first?.message ?? '' },
        requestId,
        problems: [],
      };
    case ERROR_CODES.MKT_MANIFEST_INVALID:
      return { kind: 'problems', key: 'manifestInvalid', ...base };
    case ERROR_CODES.MKT_RECIPE_INVALID:
      return { kind: 'problems', key: 'recipeInvalid', ...base };
    case ERROR_CODES.MKT_URL_REFUSED:
      return {
        kind: 'problems',
        key: first?.message ? 'urlRefused' : 'urlRefusedPlain',
        values: { detail: first?.message ?? '' },
        ...base,
      };
    case ERROR_CODES.MKT_CONNECTOR_NOT_AVAILABLE:
      return {
        kind: 'general',
        key: 'connectorNotAvailable',
        values: { type: first?.message ?? '' },
        ...base,
      };
    case ERROR_CODES.MKT_SLUG_TAKEN:
      return { kind: 'general', key: 'slugTaken', ...base };
    case ERROR_CODES.MKT_CATEGORY_NOT_FOUND:
      // 404: the category being edited or deleted is gone. 422: the manifest names a category that does not exist or is inactive.
      return err.status === 404
        ? { kind: 'general', key: 'categoryGone', ...base }
        : { kind: 'problems', key: 'categoryUnknown', ...base };
    case ERROR_CODES.MKT_CATEGORY_IN_USE:
      return { kind: 'general', key: 'categoryInUse', ...base };
    case ERROR_CODES.MKT_VERSION_STATE: {
      const status = first?.path === 'status' ? first.message : '';
      return {
        kind: 'general',
        key: status ? 'versionState' : 'versionStatePlain',
        values: { status },
        ...base,
      };
    }
    case ERROR_CODES.MKT_VERSION_EXISTS: {
      const newest = first?.message.startsWith('higher_than:')
        ? first.message.slice('higher_than:'.length)
        : '';
      return {
        kind: 'general',
        key: newest ? 'versionExists' : 'versionExistsPlain',
        values: { newest },
        ...base,
      };
    }
    case ERROR_CODES.MKT_APP_UNAVAILABLE:
      return { kind: 'general', key: 'appUnavailable', ...base };
    case ERROR_CODES.MKT_APP_NOT_FOUND:
      return { kind: 'general', key: 'appNotFound', ...base };
    case ERROR_CODES.MKT_SUBSCRIPTION_STATE:
      return { kind: 'general', key: 'subscriptionState', ...base };
    case ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND:
      return { kind: 'general', key: 'subscriptionNotFound', ...base };
    case ERROR_CODES.MKT_RENEWAL_NOT_STOPPED:
      return { kind: 'general', key: 'renewalNotStopped', ...base };
    case ERROR_CODES.NOT_FOUND:
      return { kind: 'general', key: 'notFound', ...base };
    case ERROR_CODES.RATE_LIMITED: {
      const seconds = err.fieldErrors.find((e) => e.path === 'retryAfterSeconds')?.message;
      return {
        kind: 'general',
        key: seconds ? 'rateLimited' : 'rateLimitedPlain',
        values: { seconds: seconds ?? '' },
        ...base,
      };
    }
    case ERROR_CODES.VALIDATION_FAILED:
      return {
        kind: 'problems',
        key: problems.length > 0 ? 'validationFields' : 'validation',
        ...base,
      };
    default:
      return { kind: 'general', key: err.status >= 500 ? 'unexpected' : 'request', ...base };
  }
}

/** True when the failure is "this operator may not use this screen". */
export const isNoAccess = (err: unknown): boolean =>
  err instanceof ApiError &&
  (err.code === ERROR_CODES.RBAC_PLATFORM_PERMISSION_REQUIRED ||
    (err.status === 403 && err.code === ERROR_CODES.FORBIDDEN));

export const isConflict = (err: unknown): boolean =>
  err instanceof ApiError && err.isRowVersionConflict;

/** Every key `marketError` can answer, so the messages test can prove each one has text in every language. */
export const MARKET_ERROR_KEYS = [
  'conflict',
  'noAccess',
  'manifestInvalid',
  'recipeInvalid',
  'urlRefused',
  'urlRefusedPlain',
  'connectorNotAvailable',
  'slugTaken',
  'categoryGone',
  'categoryUnknown',
  'categoryInUse',
  'versionState',
  'versionStatePlain',
  'versionExists',
  'versionExistsPlain',
  'appUnavailable',
  'appNotFound',
  'subscriptionState',
  'subscriptionNotFound',
  'notFound',
  'rateLimited',
  'rateLimitedPlain',
  'validationFields',
  'validation',
  'request',
  'unexpected',
] as const;
