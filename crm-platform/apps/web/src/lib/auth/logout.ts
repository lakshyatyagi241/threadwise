import 'server-only';
import { cookies } from 'next/headers';
import {
  OP_ACCESS_COOKIE,
  OP_REFRESH_COOKIE,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
} from './cookies';
import type { SessionKind } from './cookies';
import { logoutCall } from './logout-request';
import { apiBase } from './server';

/**
 * Ends the session of the calling browser: the API revokes it (the access token proves who is asking; the
 * refresh token lets it end the session even after the 15-minute access token has lapsed), then the cookies are
 * cleared whatever the API answered. WaDesk's logout always invalidated the session, never only the cookie.
 */
async function logoutSession(req: Request, kind: SessionKind): Promise<void> {
  const store = await cookies();
  const names =
    kind === 'operator'
      ? { access: OP_ACCESS_COOKIE, refresh: OP_REFRESH_COOKIE }
      : { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE };
  const call = logoutCall(
    kind,
    { accessToken: store.get(names.access)?.value, refreshToken: store.get(names.refresh)?.value },
    req.headers,
  );
  if (call) {
    // Best effort: a failed revoke must not keep the person signed in on this browser.
    await fetch(`${apiBase()}${call.path}`, {
      method: 'POST',
      headers: call.headers,
      body: call.body,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined);
  }
  clearSessionCookies(store, kind);
}

/** Staff sign-out (workspace users). */
export const logoutStaff = (req: Request): Promise<void> => logoutSession(req, 'user');

/** Platform-operator sign-out: the same rule, the operator cookies and the operator endpoint. */
export const logoutOperator = (req: Request): Promise<void> => logoutSession(req, 'operator');
