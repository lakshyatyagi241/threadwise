/**
 * Return-path handling for `?next=` (TW-AUTH-001). Reference ignored the parameter; here it is
 * honoured, but only for same-site relative paths, so it cannot become an open redirect.
 */

/** Guest pages are never a useful destination after signing in (and would bounce straight back). */
const GUEST_PREFIXES = [
  '/login',
  '/logout',
  '/signup',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-otp',
  '/find-workspace',
  '/auth/',
];

const BASE = 'http://relative.invalid';

function isUnsafeChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code < 0x20 || code === 0x7f || ch === '\\';
}

/** The path to navigate to, or null when the value is missing or not a safe relative path. */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 2048) return null;
  // Control characters and backslashes are interpreted differently by browsers and servers.
  if ([...value].some(isUnsafeChar)) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  // Percent-encoded slashes at the start would be decoded into a protocol-relative URL by some proxies.
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decoded.startsWith('//') || decoded.startsWith('/\\')) return null;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return null;
  if (
    GUEST_PREFIXES.some(
      (p) => url.pathname === p || url.pathname.startsWith(p.endsWith('/') ? p : `${p}/`),
    )
  ) {
    return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Where to go once signed in: the safe return path, else the home router (`/`), which applies `homePathFor`. */
export function postLoginTarget(next: string | null | undefined): string {
  return safeNextPath(next) ?? '/';
}

/** Header the proxy sets on every request so server components can tell which page was asked for. */
export const REQUEST_PATH_HEADER = 'x-crm-path';

/**
 * Sign-in address for a visitor who asked for `current` without a session: `/login?next=...` so the
 * page they wanted is where they land afterwards. A path that is not worth returning to (home, guest
 * pages, API routes) gives plain `/login`.
 */
export function loginPath(
  current: string | null | undefined,
  opts: { expired?: boolean; idleMinutes?: number } = {},
): string {
  const next = safeNextPath(current);
  const params = new URLSearchParams();
  if (opts.idleMinutes && opts.idleMinutes > 0) {
    // Signed out for inactivity (TW-AUTH-033): the login page says how long the limit is.
    params.set('expired', 'idle');
    params.set('minutes', String(Math.floor(opts.idleMinutes)));
  } else if (opts.expired) params.set('expired', '1');
  if (next && next !== '/') params.set('next', next);
  const qs = params.toString();
  return qs ? `/login?${qs}` : '/login';
}

/**
 * Address that rotates the session and then sends the browser on to `current`, for a visitor whose access
 * token lapsed but whose refresh token is still alive.
 */
export function refreshPath(current: string | null | undefined): string {
  const next = safeNextPath(current);
  return next && next !== '/'
    ? `/api/auth/refresh?next=${encodeURIComponent(next)}`
    : '/api/auth/refresh?next=/';
}
