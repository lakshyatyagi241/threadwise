import { tokenPairSchema, type TokenPair } from '@crm/contracts';
import { env } from '@/config/env';
import { ApiError, CLIENT_ERROR_CODES, toApiError } from '@/lib/api/errors';
import { clientHeaders } from '@/lib/api/client-headers';
import { clearTokens, readTokens, writeTokens, type StoredTokens } from './token-store';

/**
 * Owns the signed-in state of the whole app: the tokens, rotating them, and ending the session.
 *
 * Rules this file exists to keep (docs/adr/0023):
 *  - one refresh at a time (`refreshing`): the API rotates refresh tokens and treats a reused one as theft, so two screens
 *    that both hit a 401 must share one rotation, never race two;
 *  - a refresh that fails because the SERVER said no (4xx) ends the session; one that fails because the phone is offline does
 *    not: a tunnel must not sign anyone out;
 *  - the refresh call is made with plain `fetch`, never `apiFetch`, so a 401 on refresh cannot recurse into another refresh.
 */

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';
export interface AuthState {
  status: AuthStatus;
  tokens: StoredTokens | null;
}

/** Refresh this long before the access token expires, so a request in flight never carries a token that dies on the way. */
const REFRESH_MARGIN_MS = 30_000;

let state: AuthState = { status: 'loading', tokens: null };
let refreshing: Promise<StoredTokens | null> | null = null;
const listeners = new Set<() => void>();

function set(next: AuthState): void {
  state = next;
  listeners.forEach((l) => l());
}

export const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getSnapshot = (): AuthState => state;

/** Called once at launch, before anything is rendered that depends on the session. */
export async function restoreSession(): Promise<void> {
  const tokens = await readTokens();
  set({ status: tokens ? 'signedIn' : 'signedOut', tokens });
}

function toStored(pair: TokenPair, now = Date.now()): StoredTokens {
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    accessExpiresAt: now + pair.expiresIn * 1000,
  };
}

/** After a successful sign-in, MFA step or workspace switch. */
export async function startSession(pair: TokenPair): Promise<void> {
  const tokens = toStored(pair);
  await writeTokens(tokens);
  set({ status: 'signedIn', tokens });
}

/** Ends the session on this phone. Callers that can also tell the server do so first (see `signOut` in features/auth). */
export async function endSession(): Promise<void> {
  refreshing = null;
  await clearTokens();
  set({ status: 'signedOut', tokens: null });
}

/** The refresh token, for the one request that needs it besides refreshing: telling the server to end the session. */
export const currentRefreshToken = (): string | null => state.tokens?.refreshToken ?? null;

/** A usable access token, rotating first when it is about to expire. Null when signed out or when the rotation was refused. */
export async function getAccessToken(): Promise<string | null> {
  const tokens = state.tokens;
  if (!tokens) return null;
  if (tokens.accessExpiresAt - Date.now() > REFRESH_MARGIN_MS) return tokens.accessToken;
  try {
    return (await refreshTokens())?.accessToken ?? null;
  } catch {
    // Offline: send what we have. If it has expired the server answers 401 and the caller sees a normal error.
    return tokens.accessToken;
  }
}

/**
 * Rotates the refresh token. Resolves to the new tokens, or null when the server refused (the session is then ended).
 * Rejects with an `ApiError` when the server could not be reached; the session is kept.
 */
export function refreshTokens(): Promise<StoredTokens | null> {
  if (refreshing) return refreshing;
  const used = state.tokens?.refreshToken;
  if (!used) return Promise.resolve(null);

  const attempt = (async (): Promise<StoredTokens | null> => {
    let res: Response;
    try {
      res = await fetch(`${env.apiUrl}/v2/auth/refresh`, {
        method: 'POST',
        headers: { ...clientHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: used }),
      });
    } catch {
      throw new ApiError(0, CLIENT_ERROR_CODES.NETWORK, 'Could not reach the server');
    }
    const text = await res.text();
    const json: unknown = safeJson(text);
    if (!res.ok) {
      if (res.status >= 500 || res.status === 429) {
        throw toApiError(
          res.status,
          json,
          res.headers.get('x-request-id'),
          res.headers.get('retry-after'),
        );
      }
      // The server said no: the refresh token is expired, revoked, reused or its session was ended. Nothing to retry.
      await endSession();
      return null;
    }
    const parsed = tokenPairSchema.safeParse(json);
    if (!parsed.success) {
      throw new ApiError(
        res.status,
        CLIENT_ERROR_CODES.CONTRACT_MISMATCH,
        'Unreadable refresh answer',
      );
    }
    // The session may have been ended while the request was in flight (sign-out pressed): do not resurrect it.
    if (state.tokens?.refreshToken !== used) return state.tokens;
    const next = toStored(parsed.data);
    await writeTokens(next);
    set({ status: 'signedIn', tokens: next });
    return next;
  })();

  const shared = attempt.finally(() => {
    if (refreshing === shared) refreshing = null;
  });
  refreshing = shared;
  return shared;
}

function safeJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Test seam: back to the launch state. */
export function resetSessionForTests(): void {
  refreshing = null;
  state = { status: 'loading', tokens: null };
  listeners.clear();
}
