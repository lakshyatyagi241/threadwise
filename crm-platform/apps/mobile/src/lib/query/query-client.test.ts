import NetInfo from '@react-native-community/netinfo';
import { ApiError, CLIENT_ERROR_CODES } from '@/lib/api/errors';
import { createQueryClient, isRetryable, wireQueryEnvironment } from './query-client';

describe('createQueryClient', () => {
  it('retries reads only for transient failures and never retries a mutation', () => {
    const defaults = createQueryClient().getDefaultOptions();
    const retry = defaults.queries?.retry as (failures: number, error: unknown) => boolean;
    expect(retry(0, new ApiError(503, 'INTERNAL', 'x'))).toBe(true);
    expect(retry(0, new ApiError(404, 'NOT_FOUND', 'x'))).toBe(false);
    expect(defaults.mutations?.retry).toBe(false);
  });
});

describe('isRetryable', () => {
  it('is true for connectivity failures and server errors, false for the server’s answers', () => {
    expect(isRetryable(new ApiError(0, CLIENT_ERROR_CODES.NETWORK, 'x'))).toBe(true);
    expect(isRetryable(new ApiError(502, 'INTERNAL', 'x'))).toBe(true);
    expect(isRetryable(new ApiError(403, 'RBAC_FORBIDDEN', 'x'))).toBe(false);
    expect(isRetryable(new Error('boom'))).toBe(false);
  });
});

describe('wireQueryEnvironment', () => {
  it('asks the API, not Google or Android, whether the phone is online', async () => {
    wireQueryEnvironment();
    const configure = jest.mocked(NetInfo.configure);
    expect(configure).toHaveBeenCalledTimes(1);
    const config = configure.mock.calls[0]![0];
    // An unvalidated LAN or hotspot network must not look offline: that paused every request and left each screen on its skeleton.
    expect(config.useNativeReachability).toBe(false);
    expect(config.reachabilityUrl).toBe('http://api.test/health');
    expect(await config.reachabilityTest!({ status: 200 } as Response)).toBe(true);
    expect(await config.reachabilityTest!({ status: 503 } as Response)).toBe(false);
  });
});
