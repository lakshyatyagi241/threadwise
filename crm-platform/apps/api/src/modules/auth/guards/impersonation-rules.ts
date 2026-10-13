/**
 * What an operator acting as a workspace owner may not do (TW-WSP-032/033, ADR 0020). Reference put no limit on an impersonating
 * admin; this is the guard rail the port notes ask for. Matching is on the path after the optional `/api` prefix and the
 * version, so `/v2/account/password` and `/api/v2/account/password` are the same route.
 */

/** Methods a read-only session may still use. Everything else is refused with WSP_IMPERSONATION_READ_ONLY. */
export const IMPERSONATION_READ_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The one write a read-only session may make: ending itself. */
export const IMPERSONATION_STOP_PATH = 'auth/impersonation/stop';

export interface ForbiddenRule {
  /** Omitted: every method. */
  method?: string;
  /** Matched against the path without prefix, version, query or trailing slash. */
  path: RegExp;
  why: string;
}

/**
 * Refused for every act-as session, read-only or not, with WSP_IMPERSONATION_FORBIDDEN. These are the owner's own credentials and
 * identity, plus the operator console: acting as the owner must never become a way to take the account over or to widen the
 * operator's own reach.
 */
export const IMPERSONATION_FORBIDDEN: readonly ForbiddenRule[] = [
  {
    path: /^platform(\/|$)/,
    why: 'the operator console is not reachable from a workspace identity',
  },
  { path: /^account\/password$/, why: 'changing the owner password' },
  { path: /^account\/email-change(\/confirm)?$/, why: 'changing the owner email' },
  { path: /^account\/mfa(\/|$)/, why: 'two-factor setup, disable and recovery codes' },
  { path: /^account\/sessions(\/|$)/, why: "the owner's own sessions" },
  { method: 'DELETE', path: /^account$/, why: 'deleting the owner account' },
  { path: /^developer\/keys(\/|$)/, why: 'workspace API keys' },
  { path: /^ai\/provider-keys(\/|$)/, why: "the workspace's own third-party provider keys" },
  {
    path: /(^|\/)(exports?|downloads?)(\/|$)/,
    why: 'exporting or downloading workspace data (personal data is masked in an act-as session)',
  },
  { path: /^auth\/workspaces\/switch$/, why: 'opening a session in another workspace' },
];

/** The route as the rules see it: lower-case, no query, no `/api`, no version, no trailing slash. */
export function normalizeRoute(url: string): string {
  const path = (url.split('?')[0] ?? '').toLowerCase();
  return path.replace(/^\/(?:api\/)?(?:v\d+\/)?/, '').replace(/\/+$/, '');
}

export type ImpersonationVerdict = 'allow' | 'forbidden' | 'read_only';

/** The decision for one request of an act-as session. Forbidden outranks read-only: the stronger answer wins. */
export function impersonationVerdict(
  url: string,
  method: string,
  readOnly: boolean,
): ImpersonationVerdict {
  const route = normalizeRoute(url);
  const m = method.toUpperCase();
  if (IMPERSONATION_FORBIDDEN.some((r) => (!r.method || r.method === m) && r.path.test(route))) {
    return 'forbidden';
  }
  if (readOnly && !IMPERSONATION_READ_METHODS.has(m) && route !== IMPERSONATION_STOP_PATH) {
    return 'read_only';
  }
  return 'allow';
}
