import 'server-only';
import {
  operatorSessionResponseSchema,
  sessionResponseSchema,
  tokenPairSchema,
  type OperatorSessionResponse,
  type SessionResponse,
} from '@crm/contracts';
import { cookies, headers } from 'next/headers';
import { clientIpFrom } from './client-ip';
import { cookieNames, type SessionKind, type TokenPair } from './cookies';
import { REQUEST_PATH_HEADER, loginPath, refreshPath } from './next-path';

export const apiBase = () => process.env.API_URL ?? 'http://localhost:3000';

export interface SessionState<T> {
  /** The signed-in principal, or null. */
  session: T | null;
  /** No usable access token, but a refresh token exists: refresh instead of sending to login. */
  expired: boolean;
  /**
   * Set when the API refused the caller's address (operator IP allowlist, TW-AUTH-038): the address it
   * reports, or '' when it could not read one. The console shows the blocked screen instead of a login loop.
   */
  blockedIp?: string;
  /** Set when the API ended the session for inactivity (TW-AUTH-033): the configured limit, in minutes. */
  idleMinutes?: number;
}

/**
 * The browser's address, as the API should record it. The API sees this server as its only client,
 * so without the header an operator IP allowlist would be checked against the web server.
 */
async function clientAddressHeaders(): Promise<Record<string, string>> {
  const ip = clientIpFrom(await headers());
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
  if (res.status === 401) {
    const body = (await res.json().catch(() => null)) as {
      errors?: { path?: string; message?: string }[];
    } | null;
    const idle = body?.errors?.find((e) => e.path === 'reason')?.message === 'idle';
    if (idle) {
      // The refresh token is ended too, so there is nothing to rotate: go to sign-in with the reason.
      const minutes = Number(body?.errors?.find((e) => e.path === 'idleMinutes')?.message);
      return {
        session: null,
        expired: false,
        idleMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : undefined,
      };
    }
    return { session: null, expired: hasRefresh };
  }
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as {
      code?: string;
      errors?: { path?: string; message?: string }[];
    } | null;
    if (body?.code === 'AUTH_IP_BLOCKED') {
      const ip = body.errors?.find((e) => e.path === 'ip')?.message?.trim() ?? '';
      return { session: null, expired: false, blockedIp: ip };
    }
    return { session: null, expired: false };
  }
  if (!res.ok) return { session: null, expired: false };
  const parsed = parse(await res.json());
  return { session: parsed, expired: false };
}

/** The page the browser asked for (path and query), as recorded by the proxy; null outside a proxied request. */
export async function requestPath(): Promise<string | null> {
  return (await headers()).get(REQUEST_PATH_HEADER);
}

/**
 * Where a visitor without a usable session goes: the refresh route when a refresh token is still alive,
 * otherwise sign-in. Either way the page they asked for rides along as `?next=` (TW-AUTH-001/011).
 */
export async function signedOutTarget(expired: boolean, idleMinutes?: number): Promise<string> {
  const asked = await requestPath();
  return expired ? refreshPath(asked) : loginPath(asked, { idleMinutes });
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
