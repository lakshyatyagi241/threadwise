import { describe, expect, it } from 'vitest';
import { logoutCall } from './logout-request';

const incoming = (extra: Record<string, string> = {}) =>
  new Headers({ 'user-agent': 'Test/1.0', 'accept-language': 'ar', ...extra });

describe('logoutCall', () => {
  it('ends an operator session from the refresh token alone, once the access cookie has lapsed', () => {
    const call = logoutCall('operator', { refreshToken: 'op-refresh' }, incoming());
    expect(call).not.toBeNull();
    expect(call!.path).toBe('/v2/platform/auth/logout');
    expect(JSON.parse(call!.body)).toEqual({ refreshToken: 'op-refresh' });
    expect(call!.headers.has('authorization')).toBe(false);
  });

  it('sends both tokens when both are present', () => {
    const call = logoutCall('operator', { accessToken: 'at', refreshToken: 'rt' }, incoming());
    expect(call!.headers.get('authorization')).toBe('Bearer at');
    expect(JSON.parse(call!.body)).toEqual({ refreshToken: 'rt' });
  });

  it('sends an empty body when only the access token is left', () => {
    const call = logoutCall('operator', { accessToken: 'at' }, incoming());
    expect(JSON.parse(call!.body)).toEqual({});
    expect(call!.headers.get('authorization')).toBe('Bearer at');
  });

  it('does the same for staff, against the staff endpoint', () => {
    const call = logoutCall('user', { refreshToken: 'rt' }, incoming());
    expect(call!.path).toBe('/v2/auth/logout');
    expect(JSON.parse(call!.body)).toEqual({ refreshToken: 'rt' });
  });

  it('has nothing to end when the browser holds no token', () => {
    expect(logoutCall('operator', {}, incoming())).toBeNull();
    expect(logoutCall('user', {}, incoming())).toBeNull();
  });

  it('forwards the request id and the browser identity, and makes an id when there is none', () => {
    const withId = logoutCall('user', { refreshToken: 'rt' }, incoming({ 'x-request-id': 'abc' }));
    expect(withId!.headers.get('x-request-id')).toBe('abc');
    expect(withId!.headers.get('user-agent')).toBe('Test/1.0');
    const without = logoutCall('user', { refreshToken: 'rt' }, incoming());
    expect(without!.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('does not forward a client-supplied address that no trusted proxy vouched for', () => {
    const call = logoutCall(
      'operator',
      { refreshToken: 'rt' },
      incoming({ 'x-forwarded-for': '203.0.113.9' }),
    );
    // WEB_TRUSTED_PROXY_HOPS is unset in tests: nothing is believed.
    expect(call!.headers.has('x-forwarded-for')).toBe(false);
  });
});
