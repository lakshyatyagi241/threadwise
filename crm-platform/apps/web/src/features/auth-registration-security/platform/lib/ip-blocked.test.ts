import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { blockedAddress, createIpBlockStore, isIpBlocked } from './ip-blocked';

const blocked = (ip: string) =>
  new ApiError(403, 'AUTH_IP_BLOCKED', 'Access is not allowed.', 'req-1', [
    { path: 'ip', message: ip },
  ]);

describe('isIpBlocked', () => {
  it('matches only a 403 with the stable IP-block code', () => {
    expect(isIpBlocked(blocked('203.0.113.9'))).toBe(true);
    expect(isIpBlocked(new ApiError(403, 'AUTH_OPERATOR_ROLE_REQUIRED', 'no'))).toBe(false);
    expect(isIpBlocked(new ApiError(401, 'AUTH_IP_BLOCKED', 'no'))).toBe(false);
    expect(isIpBlocked(new Error('AUTH_IP_BLOCKED'))).toBe(false);
    expect(isIpBlocked(null)).toBe(false);
  });
});

describe('blockedAddress', () => {
  it('reads the address from the ip field error', () => {
    expect(blockedAddress(blocked('203.0.113.9'))).toBe('203.0.113.9');
    expect(blockedAddress(blocked(' 2001:db8::7 '))).toBe('2001:db8::7');
  });
  it('is null when the API could not read the caller address', () => {
    expect(blockedAddress(blocked(''))).toBeNull();
    expect(blockedAddress(new ApiError(403, 'AUTH_IP_BLOCKED', 'no'))).toBeNull();
  });
  it('ignores other field errors', () => {
    const e = new ApiError(403, 'AUTH_IP_BLOCKED', 'no', undefined, [
      { path: 'route', message: '/x' },
    ]);
    expect(blockedAddress(e)).toBeNull();
  });
});

describe('ipBlockStore', () => {
  it('starts clear, remembers the address and tells subscribers once', () => {
    const store = createIpBlockStore();
    const seen = vi.fn();
    const off = store.subscribe(seen);
    expect(store.get()).toBeNull();
    store.report('203.0.113.9');
    expect(store.get()).toEqual({ ip: '203.0.113.9' });
    store.report('203.0.113.9');
    expect(seen).toHaveBeenCalledTimes(1);
    store.report(null);
    expect(store.get()).toEqual({ ip: null });
    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });
  it('clears, tells subscribers only when there was something, and stops after unsubscribe', () => {
    const store = createIpBlockStore();
    const seen = vi.fn();
    const off = store.subscribe(seen);
    store.clear();
    expect(seen).not.toHaveBeenCalled();
    store.report('198.51.100.4');
    store.clear();
    expect(store.get()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
    store.report('198.51.100.4');
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
