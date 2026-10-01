import 'server-only';
import {
  operatorSessionResponseSchema,
  sessionResponseSchema,
  tokenPairSchema,
  type OperatorSessionResponse,
  type SessionResponse,
} from '@crm/contracts';
import { cookies, headers } from 'next/headers';
import { cookieNames, type SessionKind, type TokenPair } from './cookies';

export const apiBase = () => process.env.API_URL ?? 'http://localhost:3000';

export interface SessionState<T> {
  /** The signed-in principal, or null. */
  session: T | null;
  /** No usable access token, but a refresh token exists: refresh instead of sending to login. */
  expired: boolean;
}

/**
 * The browser's address, as the API should record it. The API sees this server as its only client,
 * so without the header an operator IP allowlist would be checked against the web server.
 */
async function clientAddressHeaders(): Promise<Record<string, string>> {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
  return ip ? { 'X-Forwarded-For': ip } : {};
}

async function probe<T>(
  kind: SessionKind,
  path: string,
  parse: (json: unknown) => T | null,
): Promise<SessionState<T>> {
  const store = await cookies();
  const names = cookieNames(kind);
  const at = store.get(names.access)?.value;
  const hasRefresh = Boolean(store.get(names.refresh)?.value);
  if (!at) return { session: null, expired: hasRefresh };
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { Authorization: `Bearer ${at}`, ...(await clientAddressHeaders()) },
    cache: 'no-store',
  });
  if (res.status === 401) return { session: null, expired: hasRefresh };
  if (!res.ok) return { session: null, expired: false };
  const parsed = parse(await res.json());
  return { session: parsed, expired: false };
}

/** Server-side staff session check: everything the shell needs (user, org, permissions, flags) in one call. */
export function getSession(): Promise<SessionState<SessionResponse>> {
  return probe('user', '/v2/auth/session', (j) => {
    const r = sessionResponseSchema.safeParse(j);
    return r.success ? r.data : null;
  });
}

export function getOperatorSession(): Promise<SessionState<OperatorSessionResponse>> {
  return probe('operator', '/v2/platform/auth/session', (j) => {
    const r = operatorSessionResponseSchema.safeParse(j);
    return r.success ? r.data : null;
  });
}

/** Rotates the refresh token. Null on any failure (the caller then clears cookies). */
export async function refreshTokens(
  refreshToken: string,
  kind: SessionKind = 'user',
): Promise<TokenPair | null> {
  const path = kind === 'operator' ? '/v2/platform/auth/refresh' : '/v2/auth/refresh';
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await clientAddressHeaders()) },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const parsed = tokenPairSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

/** Where a signed-in person goes: one function, shared by login, `/` and guest-page redirects (TW-AUTH-011). */
export function homePathFor(s: SessionResponse): string {
  if (s.flags.suspended) return '/suspended';
  if (s.landing === 'onboarding') return '/onboarding';
  return s.landing === 'inbox' ? '/inbox' : '/dashboard';
}
