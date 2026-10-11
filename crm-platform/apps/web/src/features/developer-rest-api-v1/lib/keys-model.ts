import {
  API_KEY_NAME_MAX,
  API_SCOPES,
  API_SCOPE_RESOURCES,
  ERROR_CODES,
  type ApiKeyResponse,
  type ApiScope,
  type ApiScopeResource,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The pure half of the Developers console (WD-API-001 to 004, 151): which key is live, the name rule, the quickstart, error kinds. */

/** The path every customer-API URL starts with (WaDesk's base URL, kept as is). */
export const API_V1_PATH = '/api/v1';
export const DOCS_PATH = '/developers/docs';
/** Where "Back" and the breadcrumb go: Settings is our equivalent of WaDesk's More menu. */
export const BACK_PATH = '/settings';
/** The key list is fetched in one page: a workspace holds a handful of keys (plan cap), revoked ones included. */
export const LIST_LIMIT = 100;
/** How long a copy button shows its confirmation. */
export const COPIED_MS = 1800;
export const PLACEHOLDER_KEY = 'YOUR_API_KEY';

/** Live = not revoked. An expired but unrevoked key still counts as active, as in WaDesk (WD-API-151 rule 1). */
export function activeKeys(keys: readonly ApiKeyResponse[]): ApiKeyResponse[] {
  return keys.filter((k) => k.status === 'active' && k.revokedAt === null);
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: 'required' | 'tooLong' };

/** The form rule: required, 1 to 120 characters after trimming (the API trims too). */
export function checkName(raw: string): NameCheck {
  const name = raw.trim();
  if (name.length === 0) return { ok: false, error: 'required' };
  if (name.length > API_KEY_NAME_MAX) return { ok: false, error: 'tooLong' };
  return { ok: true, name };
}

/** A key with no scopes is full access (WaDesk parity, WD-API-008), and the list says so. */
export function isFullAccess(key: Pick<ApiKeyResponse, 'scopes'>): boolean {
  return key.scopes.length === 0;
}

/** One row of the scope picker: a resource and its two scopes, `read` before `write`. */
export interface ScopeRow {
  resource: ApiScopeResource;
  read: ApiScope;
  write: ApiScope;
}

export const SCOPE_ROWS: readonly ScopeRow[] = API_SCOPE_RESOURCES.map((resource) => ({
  resource,
  read: `${resource}:read`,
  write: `${resource}:write`,
}));

/** `<resource>:write` also grants `<resource>:read` (the guard expands it), so a ticked write shows its read as implied. */
export function isReadImplied(picked: readonly ApiScope[], row: ScopeRow): boolean {
  return picked.includes(row.write);
}

export function toggleScope(picked: readonly ApiScope[], scope: ApiScope): ApiScope[] {
  return picked.includes(scope) ? picked.filter((s) => s !== scope) : [...picked, scope];
}

export type ScopesCheck = { ok: true; scopes: ApiScope[] } | { ok: false; error: 'noScopes' };

/**
 * What the form sends. Restriction off is no scopes, which the API reads as full access. Restriction on with nothing ticked is refused
 * here rather than sent: an empty list would silently make the key full access, the opposite of what the person asked for. The list goes
 * out in picker order, without a `read` its `write` already implies.
 */
export function checkScopes(restrict: boolean, picked: readonly ApiScope[]): ScopesCheck {
  if (!restrict) return { ok: true, scopes: [] };
  const scopes = API_SCOPES.filter(
    (s) => picked.includes(s) && !(s.endsWith(':read') && picked.includes(writeOf(s))),
  );
  return scopes.length === 0 ? { ok: false, error: 'noScopes' } : { ok: true, scopes };
}

function writeOf(read: ApiScope): ApiScope {
  return read.replace(/:read$/, ':write') as ApiScope;
}

/** The base URL shown in the rail: the public API origin without a trailing slash, plus `/api/v1`. */
export function baseUrlOf(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${API_V1_PATH}`;
}

/** The copy-ready first request. It carries the real key only when the person just created one, otherwise the placeholder. */
export function quickstartCurl(
  baseUrl: string,
  brand: string,
  key: string = PLACEHOLDER_KEY,
): string {
  const body = JSON.stringify({ to: '919812345678', type: 'text', text: `Hello from ${brand}` });
  return [
    `curl -X POST '${baseUrl}/messages' \\`,
    `  -H 'Authorization: Bearer ${key}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${body.replace(/'/g, `'\\''`)}'`,
  ].join('\n');
}

/**
 * The one-time secret. It lives only in the screen's memory: a reload, a navigation or a revoke of that key ends it. Nothing here
 * touches storage, the URL or the query cache, so a refetch of the list can never bring it back.
 */
export interface OneTimeKey {
  keyId: string;
  secret: string;
}

export function afterRevoke(shown: OneTimeKey | null, revokedId: string): OneTimeKey | null {
  return shown && shown.keyId === revokedId ? null : shown;
}

export type KeyErrorKind =
  'planLimit' | 'planLocked' | 'forbidden' | 'validation' | 'notFound' | 'network' | 'unexpected';

/** Which message a failed call gets. Branches on the stable `code` (then the status), never on the wording. */
export function errorKind(error: unknown): KeyErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (error.code === ERROR_CODES.PLAN_LIMIT_REACHED) return 'planLimit';
  if (error.code === ERROR_CODES.PLAN_FEATURE_LOCKED) return 'planLocked';
  if (error.code === ERROR_CODES.FORBIDDEN || error.status === 403) return 'forbidden';
  if (error.code === ERROR_CODES.VALIDATION_FAILED || error.status === 422 || error.status === 400)
    return 'validation';
  if (error.status === 404) return 'notFound';
  return 'unexpected';
}

/** The inline message under the name field when the server rejected `name`, else null. */
export function nameFieldError(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  return error.fieldErrors.find((f) => f.path === 'name')?.message ?? null;
}

/** "Last used" as a short relative time ("3 minutes ago"), or null when the key was never used. */
export function relativeTime(iso: string | null, locale: string, now = Date.now()): string | null {
  if (!iso) return null;
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  if (!Number.isFinite(seconds)) return null;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(Math.min(seconds, 0), 'second');
}

/** "Created Oct 6, 2026". */
export function dateLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
