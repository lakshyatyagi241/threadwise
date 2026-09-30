import 'server-only';
import { userResponseSchema, type UserResponse } from '@crm/contracts';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, REFRESH_COOKIE, type TokenPair } from './cookies';

export const apiBase = () => process.env.API_URL ?? 'http://localhost:3000';

export type Session = { user: UserResponse; expired?: false } | { user: null; expired: boolean };

/** Server-side session check. `expired` means a refresh token exists, so the caller should refresh instead of logging out. */
export async function getSession(): Promise<Session> {
  const store = await cookies();
  const at = store.get(ACCESS_COOKIE)?.value;
  const hasRefresh = Boolean(store.get(REFRESH_COOKIE)?.value);
  if (!at) return { user: null, expired: hasRefresh };
  const res = await fetch(`${apiBase()}/v2/users/me`, {
    headers: { Authorization: `Bearer ${at}` },
    cache: 'no-store',
  });
  if (res.status === 401) return { user: null, expired: hasRefresh };
  if (!res.ok) return { user: null, expired: false };
  const parsed = userResponseSchema.safeParse(await res.json());
  return parsed.success ? { user: parsed.data } : { user: null, expired: false };
}

export async function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  const res = await fetch(`${apiBase()}/v2/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const t = (await res.json()) as Partial<TokenPair>;
  return t.accessToken && t.refreshToken && typeof t.expiresIn === 'number'
    ? (t as TokenPair)
    : null;
}
