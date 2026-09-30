export const ACCESS_COOKIE = 'crm_at';
export const REFRESH_COOKIE = 'crm_rt';
export const THEME_COOKIE = 'crm_theme';
const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

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

/** Tokens live only in httpOnly cookies, so page JavaScript can never read them. */
export function setSessionCookies(store: CookieWriter, t: TokenPair) {
  store.set(ACCESS_COOKIE, t.accessToken, { ...base(), maxAge: t.expiresIn });
  store.set(REFRESH_COOKIE, t.refreshToken, { ...base(), maxAge: REFRESH_TTL_SECONDS });
}

export function clearSessionCookies(store: CookieWriter) {
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}
