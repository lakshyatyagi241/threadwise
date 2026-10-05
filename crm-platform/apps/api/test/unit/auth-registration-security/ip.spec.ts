import { describe, expect, it } from 'vitest';
import {
  ipAllowed,
  ipMatches,
  isValidAllowlistEntry,
  networkPrefix,
  normalizeIp,
} from '../../../src/modules/auth/support/ip';

describe('ip helpers', () => {
  it('strips the IPv4-mapped IPv6 prefix and rejects garbage', () => {
    expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeIp(' 10.0.0.1 ')).toBe('10.0.0.1');
    expect(normalizeIp('not-an-ip')).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });

  it('matches exact addresses and CIDR ranges', () => {
    expect(ipMatches('203.0.113.9', '203.0.113.0/24')).toBe(true);
    expect(ipMatches('198.51.100.4', '203.0.113.0/24')).toBe(false);
    expect(ipMatches('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipMatches('10.1.2.3', '10.1.2.3')).toBe(true);
    expect(ipMatches('10.1.2.4', '10.1.2.3')).toBe(false);
    expect(ipMatches('1.2.3.4', '0.0.0.0/0')).toBe(true);
  });

  it('handles prefix lengths that are not byte aligned', () => {
    expect(ipMatches('192.168.1.130', '192.168.1.128/25')).toBe(true);
    expect(ipMatches('192.168.1.127', '192.168.1.128/25')).toBe(false);
  });

  it('matches IPv6 ranges and never mixes address families', () => {
    expect(ipMatches('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(ipMatches('2001:db9::1', '2001:db8::/32')).toBe(false);
    expect(ipMatches('::1', '::1')).toBe(true);
    expect(ipMatches('203.0.113.9', '2001:db8::/32')).toBe(false);
    expect(ipMatches('2001:db8::1', '203.0.113.0/24')).toBe(false);
  });

  it('never matches an unparsable entry (it cannot widen access)', () => {
    expect(ipMatches('1.2.3.4', 'garbage')).toBe(false);
    expect(ipMatches('1.2.3.4', '1.2.3.4/99')).toBe(false);
    expect(ipAllowed('1.2.3.4', ['nope', '5.6.7.8'])).toBe(false);
    expect(ipAllowed('1.2.3.4', ['nope', '1.2.3.0/24'])).toBe(true);
  });

  it('treats a malformed prefix as unparsable instead of a /0 that allows everyone', () => {
    for (const bad of [
      '10.0.0.5/',
      '10.0.0.5/-1',
      '10.0.0.5/8/8',
      '10.0.0.5/ 8',
      '10.0.0.5/8.5',
      '/24',
    ]) {
      expect(ipMatches('198.51.100.7', bad), bad).toBe(false);
      expect(isValidAllowlistEntry(bad), bad).toBe(false);
    }
    expect(ipAllowed('198.51.100.7', ['10.0.0.5/'])).toBe(false);
  });

  it('validates allowlist entries at save time', () => {
    expect(isValidAllowlistEntry('203.0.113.0/24')).toBe(true);
    expect(isValidAllowlistEntry('2001:db8::/32')).toBe(true);
    expect(isValidAllowlistEntry('1.2.3.4')).toBe(true);
    expect(isValidAllowlistEntry('1.2.3.4/40')).toBe(false);
    expect(isValidAllowlistEntry('hello')).toBe(false);
  });

  it('computes the same-network prefix used by the new-location alert', () => {
    expect(networkPrefix('203.0.113.9')).toBe('203.0');
    expect(networkPrefix('203.0.5.1')).toBe('203.0');
    expect(networkPrefix('198.51.100.4')).toBe('198.51');
    expect(networkPrefix(null)).toBeNull();
  });
});
