import { describe, expect, it } from 'vitest';
import { clientIpFrom, clientIpHeader, trustedProxyHops } from './client-ip';

const h = (xff?: string) => new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff });

describe('clientIpFrom', () => {
  it('never believes the header when no proxy is trusted', () => {
    expect(clientIpFrom(h('203.0.113.9'), 0)).toBeNull();
    expect(clientIpHeader(h('203.0.113.9'), 0)).toEqual({});
  });

  it('counts from the right so a forged leftmost entry is ignored', () => {
    expect(clientIpFrom(h('6.6.6.6, 198.51.100.7'), 1)).toBe('198.51.100.7');
    expect(clientIpFrom(h('6.6.6.6, 198.51.100.7, 10.0.0.2'), 2)).toBe('198.51.100.7');
  });

  it('refuses a list shorter than the trusted hop count', () => {
    expect(clientIpFrom(h('198.51.100.7'), 2)).toBeNull();
    expect(clientIpFrom(h(), 1)).toBeNull();
  });

  it('accepts IPv6, bracketed and ported forms, and rejects non-addresses', () => {
    expect(clientIpFrom(h('2001:db8::1'), 1)).toBe('2001:db8::1');
    expect(clientIpFrom(h('[2001:db8::1]:443'), 1)).toBe('2001:db8::1');
    expect(clientIpFrom(h('198.51.100.7:51234'), 1)).toBe('198.51.100.7');
    expect(clientIpFrom({ get: () => 'evil\r\nx-admin: 1' }, 1)).toBeNull();
    expect(clientIpFrom(h('not-an-ip'), 1)).toBeNull();
  });

  it('reads the hop count from the environment, defaulting to zero', () => {
    expect(trustedProxyHops({})).toBe(0);
    expect(trustedProxyHops({ WEB_TRUSTED_PROXY_HOPS: '2' })).toBe(2);
    expect(trustedProxyHops({ WEB_TRUSTED_PROXY_HOPS: 'x' })).toBe(0);
    expect(trustedProxyHops({ WEB_TRUSTED_PROXY_HOPS: '-3' })).toBe(0);
  });
});
