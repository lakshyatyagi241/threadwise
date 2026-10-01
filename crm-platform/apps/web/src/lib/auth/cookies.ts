/** Staff session. */
export const ACCESS_COOKIE = 'crm_at';
export const REFRESH_COOKIE = 'crm_rt';
/** '1' when "keep me signed in" was ticked: lets a refresh keep the long lifetime. */
export const REMEMBER_COOKIE = 'crm_rm';
/** Platform operator session (a different identity pool, a different cookie set). */
export const OP_ACCESS_COOKIE = 'crm_op_at';
export const OP_REFRESH_COOKIE = 'crm_op_rt';
export const THEME_COOKIE = 'crm_theme';
/** Last workspace slug used to sign in, so the login form can prefill it. Not a credential. */
export const ORG_COOKIE = 'crm_org';

const REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 30;
const OPERATOR_TTL_SECONDS = 60 * 60 * 12;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export type SessionKind = 'user' | 'operator';

interface CookieWriter {
  set(name: string, value: string, options: Record<string, unknown>): unknown;
  delete(name: string): unknown;
}

const base = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
});

/**
 * Tokens live only in httpOnly cookies, so page JavaScript can never read them.
 * Without "keep me signed in" the refresh cookie is a browser-session cookie
 * (gone when the browser closes), matching the server-side 24 h absolute limit.
 */
export function setSessionCookies(
  store: CookieWriter,
  t: TokenPair,
  opts: { remember?: boolean; kind?: SessionKind } = {},
) {
  const kind = opts.kind ?? 'user';
  if (kind === 'operator') {
    store.set(OP_ACCESS_COOKIE, t.accessToken, { ...base(), maxAge: t.expiresIn });
    store.set(OP_REFRESH_COOKIE, t.refreshToken, { ...base(), maxAge: OPERATOR_TTL_SECONDS });
    return;
  }
  const remember = opts.remember ?? false;
  store.set(ACCESS_COOKIE, t.accessToken, { ...base(), maxAge: t.expiresIn });
  store.set(REFRESH_COOKIE, t.refreshToken, {
    ...base(),
    ...(remember ? { maxAge: REMEMBER_TTL_SECONDS } : {}),
  });
  store.set(REMEMBER_COOKIE, remember ? '1' : '0', {
    ...base(),
    ...(remember ? { maxAge: REMEMBER_TTL_SECONDS } : {}),
  });
}

export function clearSessionCookies(store: CookieWriter, kind: SessionKind = 'user') {
  if (kind === 'operator') {
    store.delete(OP_ACCESS_COOKIE);
    store.delete(OP_REFRESH_COOKIE);
    return;
  }
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  store.delete(REMEMBER_COOKIE);
}

export const cookieNames = (kind: SessionKind) =>
  kind === 'operator'
    ? { access: OP_ACCESS_COOKIE, refresh: OP_REFRESH_COOKIE }
    : { access: ACCESS_COOKIE, refresh: REFRESH_COOKIE };
