/**
 * What the live-demo guard lets through (WD-INST-029).
 *
 * WaDesk blocked DELETEs and a fixed list of URL fragments, so every route nobody remembered to list (the updater,
 * roles, devices) stayed writable on the public demo. Here it is the reverse: with DEMO_MODE on, every write is
 * refused unless it is listed below by exact method and route, or the handler opts in with `@DemoSafe()`.
 * Reads (GET, HEAD, OPTIONS) always pass. Because the check is on the HTTP method it covers the public and
 * partner APIs as well as the staff API.
 */
export const DEMO_SAFE_KEY = 'inst:demo-safe';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Sign-in and session upkeep: a demo visitor must be able to log in, keep the session alive and leave. Nothing that
 * creates accounts or changes credentials is here (sign-up, password, MFA setup stay blocked, as in WaDesk).
 */
export const DEMO_WRITE_ALLOWLIST: ReadonlySet<string> = new Set([
  'POST /v2/auth/login',
  'POST /v2/auth/staff/login',
  'POST /v2/auth/login/mfa',
  'POST /v2/auth/partner/login',
  'POST /v2/auth/clerk/session',
  'POST /v2/auth/refresh',
  'POST /v2/auth/logout',
  'POST /v2/auth/workspaces/switch',
  'POST /v2/platform/auth/login',
  'POST /v2/platform/auth/login/mfa',
  'POST /v2/platform/auth/refresh',
  'POST /v2/platform/auth/logout',
]);

export function normalizeRoute(path: string): string {
  const noQuery = path.split('?')[0] ?? '';
  return noQuery.length > 1 ? noQuery.replace(/\/+$/, '') : noQuery;
}

export function isWriteAllowedInDemo(input: {
  method: string;
  /** The matched route pattern (`/v2/contacts/:id`), not the concrete URL. */
  routePath: string;
  demoSafe: boolean;
}): boolean {
  const method = input.method.toUpperCase();
  if (READ_METHODS.has(method)) return true;
  if (input.demoSafe) return true;
  return DEMO_WRITE_ALLOWLIST.has(`${method} ${normalizeRoute(input.routePath)}`);
}
