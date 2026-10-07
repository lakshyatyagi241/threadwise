/**
 * What a member of a suspended workspace may still call (ADR-0019). Matched on the first path segment after an optional `/api`
 * prefix and the version, the same way the trial gate does. Route-level `@AllowWhileGated({ suspended: true })` also opens a route.
 *
 *   OPEN       sign-in and out, the session probe, the shell and language the suspended screen draws with, the support desk
 *              (create and read a ticket: it is how the owner contacts the platform)
 *   READ_ONLY  billing and the account hub: look, never change (GET and HEAD only)
 */
export const SUSPENDED_OPEN_SEGMENTS: ReadonlySet<string> = new Set([
  'auth',
  'me',
  'i18n',
  'shell',
  'setup',
  'health',
  'support',
]);

export const SUSPENDED_READ_ONLY_SEGMENTS: ReadonlySet<string> = new Set([
  'billing',
  'plans',
  'payments',
  'account',
]);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function firstPathSegment(url: string): string | null {
  const path = url.split('?')[0] ?? '';
  const m = /^\/(?:api\/)?(?:v\d+\/)?([^/]+)/.exec(path);
  return m?.[1] ?? null;
}

/** True when a suspended workspace's member may call this URL with this method. */
export function suspendedPathAllowed(url: string, method: string): boolean {
  const segment = firstPathSegment(url);
  if (!segment) return false;
  if (SUSPENDED_OPEN_SEGMENTS.has(segment)) return true;
  return SUSPENDED_READ_ONLY_SEGMENTS.has(segment) && READ_METHODS.has(method.toUpperCase());
}
