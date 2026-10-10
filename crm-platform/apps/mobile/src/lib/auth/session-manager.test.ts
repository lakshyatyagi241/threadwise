import * as SecureStore from 'expo-secure-store';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import {
  endSession,
  getAccessToken,
  getSnapshot,
  refreshTokens,
  resetSessionForTests,
  restoreSession,
  startSession,
} from './session-manager';

const stored = () => (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => {
  resetSessionForTests();
  jest.restoreAllMocks();
});

describe('restoreSession', () => {
  it('is signed out when nothing is stored', async () => {
    await restoreSession();
    expect(getSnapshot()).toEqual({ status: 'signedOut', tokens: null });
  });

  it('restores a stored session', async () => {
    await startSession(TOKEN_PAIR(1));
    resetSessionForTests();
    await restoreSession();
    expect(getSnapshot().status).toBe('signedIn');
    expect(getSnapshot().tokens?.refreshToken).toBe('refresh-1');
  });

  it('treats a corrupt keychain entry as signed out and removes it', async () => {
    stored().set('crm.auth.v1', '{not json');
    await restoreSession();
    expect(getSnapshot().status).toBe('signedOut');
    expect(stored().size).toBe(0);
  });

  it('treats an unreadable keychain as signed out', async () => {
    jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValueOnce(new Error('keystore reset'));
    await restoreSession();
    expect(getSnapshot().status).toBe('signedOut');
  });
});

describe('startSession / endSession', () => {
  it('stores both tokens as one keychain item', async () => {
    await startSession(TOKEN_PAIR(1));
    expect(stored().size).toBe(1);
    expect(JSON.parse([...stored().values()][0] as string)).toMatchObject({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
    });
  });

  it('clears memory and keychain on sign-out', async () => {
    await startSession(TOKEN_PAIR(1));
    await endSession();
    expect(getSnapshot()).toEqual({ status: 'signedOut', tokens: null });
    expect(stored().size).toBe(0);
  });
});

describe('getAccessToken', () => {
  it('returns the current token without a request while it is fresh', async () => {
    const f = mockFetch();
    await startSession(TOKEN_PAIR(1));
    expect(await getAccessToken()).toBe('access-1');
    expect(f.fn).not.toHaveBeenCalled();
  });

  it('is null when signed out', async () => {
    expect(await getAccessToken()).toBeNull();
  });

  it('rotates ahead of expiry (inside the 30 s margin)', async () => {
    const f = mockFetch(jsonResponse(200, TOKEN_PAIR(2)));
    await startSession({ ...TOKEN_PAIR(1), expiresIn: 20 });
    expect(await getAccessToken()).toBe('access-2');
    expect(f.calls[0]?.url).toBe('http://api.test/v2/auth/refresh');
    expect(f.calls[0]?.body).toEqual({ refreshToken: 'refresh-1' });
  });

  it('falls back to the old token when offline, and stays signed in', async () => {
    mockFetch(new Error('Network request failed'));
    await startSession({ ...TOKEN_PAIR(1), expiresIn: 10 });
    expect(await getAccessToken()).toBe('access-1');
    expect(getSnapshot().status).toBe('signedIn');
  });
});

describe('refreshTokens', () => {
  it('shares one rotation between concurrent callers', async () => {
    const f = mockFetch(jsonResponse(200, TOKEN_PAIR(2)));
    await startSession(TOKEN_PAIR(1));
    const [a, b, c] = await Promise.all([refreshTokens(), refreshTokens(), refreshTokens()]);
    expect(f.fn).toHaveBeenCalledTimes(1);
    expect(a?.accessToken).toBe('access-2');
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(getSnapshot().tokens?.refreshToken).toBe('refresh-2');
  });

  it('ends the session when the server refuses (revoked or reused token)', async () => {
    mockFetch(
      jsonResponse(401, { type: 'x', title: 'x', status: 401, code: 'AUTH_TOKEN_INVALID' }),
    );
    await startSession(TOKEN_PAIR(1));
    expect(await refreshTokens()).toBeNull();
    expect(getSnapshot().status).toBe('signedOut');
    expect(stored().size).toBe(0);
  });

  it('keeps the session when the phone is offline', async () => {
    mockFetch(new Error('Network request failed'));
    await startSession(TOKEN_PAIR(1));
    await expect(refreshTokens()).rejects.toMatchObject({ code: 'CLIENT_NETWORK' });
    expect(getSnapshot().status).toBe('signedIn');
  });

  it('keeps the session on a 5xx or a 429', async () => {
    mockFetch(jsonResponse(503), jsonResponse(429, undefined, { 'Retry-After': '5' }));
    await startSession(TOKEN_PAIR(1));
    await expect(refreshTokens()).rejects.toMatchObject({ status: 503 });
    await expect(refreshTokens()).rejects.toMatchObject({ status: 429 });
    expect(getSnapshot().status).toBe('signedIn');
  });

  it('rejects an answer that is not a token pair without touching the stored session', async () => {
    mockFetch(jsonResponse(200, { nope: true }));
    await startSession(TOKEN_PAIR(1));
    await expect(refreshTokens()).rejects.toMatchObject({ code: 'CLIENT_CONTRACT_MISMATCH' });
    expect(getSnapshot().tokens?.refreshToken).toBe('refresh-1');
  });

  it('does not resurrect a session that was ended while the rotation was in flight', async () => {
    let release: (r: Response) => void = () => undefined;
    mockFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    await startSession(TOKEN_PAIR(1));
    const pending = refreshTokens();
    await endSession();
    release(jsonResponse(200, TOKEN_PAIR(2)));
    await pending;
    expect(getSnapshot().status).toBe('signedOut');
    expect(stored().size).toBe(0);
  });

  it('is a no-op when signed out', async () => {
    const f = mockFetch();
    expect(await refreshTokens()).toBeNull();
    expect(f.fn).not.toHaveBeenCalled();
  });
});
