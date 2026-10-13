import { QueryClient } from '@tanstack/react-query';
import { log } from '@/lib/observability/logger';
import { identifyUser } from '@/lib/observability/sentry';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { getSnapshot, resetSessionForTests, startSession } from './session-manager';
import { signOut } from './sign-out';

jest.mock('@/lib/observability/sentry', () => ({ identifyUser: jest.fn() }));

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('signOut', () => {
  it('tells the server which refresh token to end, then clears the phone, the cache and the error-report identity', async () => {
    const f = mockFetch(jsonResponse(200, { ok: true }));
    const queryClient = new QueryClient();
    queryClient.setQueryData(['session'], { user: 'previous person' });

    await signOut(queryClient);

    expect(f.calls[0]?.url).toBe('http://api.test/v2/auth/logout');
    expect(f.calls[0]?.body).toEqual({ refreshToken: 'refresh-1' });
    expect(f.calls[0]?.headers.Authorization).toBeUndefined();
    expect(getSnapshot().status).toBe('signedOut');
    expect(queryClient.getQueryData(['session'])).toBeUndefined();
    expect(identifyUser).toHaveBeenCalledWith(null);
  });

  it('signs out without an error report when the server answers with no body at all', async () => {
    const errors = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    mockFetch(jsonResponse(204));
    await signOut(new QueryClient());
    expect(getSnapshot().status).toBe('signedOut');
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('still signs out on the phone when the server cannot be reached', async () => {
    mockFetch(new TypeError('Network request failed'));
    await signOut(new QueryClient());
    expect(getSnapshot().status).toBe('signedOut');
  });

  it('still signs out when the server refuses the revoke', async () => {
    mockFetch(jsonResponse(500));
    await signOut(new QueryClient());
    expect(getSnapshot().status).toBe('signedOut');
  });
});
