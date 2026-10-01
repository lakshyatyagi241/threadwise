import { describe, expect, it } from 'vitest';
import { ipAllowed, ipMatches, isValidAllowlistEntry, normalizeIp, wouldLockOut } from './cidr';

describe('normalizeIp', () => {
  it('strips the IPv4-mapped prefix', () =>
    expect(normalizeIp('::ffff:203.0.113.9')).toBe('203.0.113.9'));
  it('keeps plain addresses and rejects junk', () => {
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normalizeIp('999.1.1.1')).toBeNull();
    expect(normalizeIp('not an ip')).toBeNull();
    expect(normalizeIp(null)).toBeNull();
  });
});

describe('isValidAllowlistEntry', () => {
  it('accepts addresses and CIDRs of both families', () => {
    for (const ok of ['203.0.113.9', '203.0.113.0/24', '2001:db8::/32', '::1', '10.0.0.0/8']) {
      expect(isValidAllowlistEntry(ok)).toBe(true);
    }
  });
  it('rejects typos and out-of-range prefixes', () => {
    for (const bad of [
      '203.0.113',
      '203.0.113.0/33',
      '2001:db8::/129',
      '10.0.0.0/',
      'abc',
      '1.2.3.4/5/6',
      '01.2.3.4',
    ]) {
      expect(isValidAllowlistEntry(bad)).toBe(false);
    }
  });
});

describe('ipMatches', () => {
  it('matches an exact address', () => {
    expect(ipMatches('203.0.113.9', '203.0.113.9')).toBe(true);
    expect(ipMatches('203.0.113.9', '203.0.113.10')).toBe(false);
  });
  it('matches inside a CIDR and not outside it', () => {
    expect(ipMatches('203.0.113.9', '203.0.113.0/24')).toBe(true);
    expect(ipMatches('198.51.100.4', '203.0.113.0/24')).toBe(false);
    expect(ipMatches('10.1.2.3', '10.0.0.0/8')).toBe(true);
    expect(ipMatches('10.1.2.3', '10.0.0.0/32')).toBe(false);
  });
  it('compares prefixes that are not on a byte boundary', () => {
    expect(ipMatches('192.168.5.1', '192.168.4.0/22')).toBe(true);
    expect(ipMatches('192.168.8.1', '192.168.4.0/22')).toBe(false);
  });
  it('never matches across address families', () => {
    expect(ipMatches('2001:db8::1', '203.0.113.0/24')).toBe(false);
    expect(ipMatches('203.0.113.9', '2001:db8::/32')).toBe(false);
  });
  it('matches IPv6 ranges', () => {
    expect(ipMatches('2001:db8:1::5', '2001:db8::/32')).toBe(true);
    expect(ipMatches('2001:db9::5', '2001:db8::/32')).toBe(false);
    expect(ipMatches('::1', '::1')).toBe(true);
  });
  it('treats an IPv4-mapped caller as IPv4', () => {
    expect(ipMatches('::ffff:203.0.113.9', '203.0.113.0/24')).toBe(true);
  });
  it('lets an unparsable entry match nothing', () =>
    expect(ipMatches('203.0.113.9', 'garbage')).toBe(false));
});

describe('ipAllowed / wouldLockOut', () => {
  it('allows when any entry matches', () =>
    expect(ipAllowed('10.0.0.5', ['1.1.1.1', '10.0.0.0/24'])).toBe(true));

  it('warns when the caller is not covered by an enabled list', () => {
    expect(wouldLockOut('198.51.100.4', true, ['203.0.113.0/24'])).toBe(true);
  });
  it('does not warn when the caller is covered, the list is off, or the list is empty', () => {
    expect(wouldLockOut('203.0.113.9', true, ['203.0.113.0/24'])).toBe(false);
    expect(wouldLockOut('198.51.100.4', false, ['203.0.113.0/24'])).toBe(false);
    expect(wouldLockOut('198.51.100.4', true, [])).toBe(false);
  });
  it('does not warn when the caller address is unknown', () => {
    expect(wouldLockOut(null, true, ['203.0.113.0/24'])).toBe(false);
  });
});
