import { clientIpHeader } from './client-ip';
import type { SessionKind } from './cookies';

/** What the sign-out call to the API looks like, built without a server so the rule is tested. */
export interface LogoutCall {
  /** API path (POST). */
  path: string;
  headers: Headers;
  body: string;
}

const PATHS: Record<SessionKind, string> = {
  user: '/v2/auth/logout',
  operator: '/v2/platform/auth/logout',
};

/**
 * The call that ends a session at the API, or null when this browser holds no token of that kind (nothing to end).
 *
 * Both logout endpoints are public: the access token proves who is asking, and the refresh token lets the API end
 * the session even after the 15-minute access token has lapsed and its cookie is gone. So the refresh token is sent
 * whenever it exists, for staff and for platform operators alike. Without it a lapsed access cookie would leave the
 * session alive on the server although the browser looks signed out.
 */
export function logoutCall(
  kind: SessionKind,
  tokens: { accessToken?: string; refreshToken?: string },
  incoming: Headers,
): LogoutCall | null {
  if (!tokens.accessToken && !tokens.refreshToken) return null;
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...clientIpHeader(incoming),
  });
  for (const name of ['x-request-id', 'user-agent', 'accept-language']) {
    const v = incoming.get(name);
    if (v) headers.set(name, v);
  }
  if (!headers.has('x-request-id')) headers.set('x-request-id', crypto.randomUUID());
  if (tokens.accessToken) headers.set('authorization', `Bearer ${tokens.accessToken}`);
  return {
    path: PATHS[kind],
    headers,
    body: JSON.stringify(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
  };
}
