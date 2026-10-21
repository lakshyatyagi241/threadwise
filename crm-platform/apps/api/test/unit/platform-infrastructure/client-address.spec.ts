import { describe, expect, it } from 'vitest';
import { clientKey } from '../../../src/modules/platform-infrastructure/rate-limit/client-address';

describe('clientKey', () => {
  it('leaves an IPv4 address as it is', () => {
    expect(clientKey('203.0.113.9')).toBe('203.0.113.9');
  });

  it('counts an IPv4-mapped IPv6 address as the IPv4 client it is', () => {
    expect(clientKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(clientKey('::FFFF:203.0.113.9')).toBe('203.0.113.9');
  });

  it('counts every address of one IPv6 /64 as one client', () => {
    const one = clientKey('2001:db8:abcd:12::1');
    expect(one).toBe('2001:db8:abcd:12::/64');
    expect(clientKey('2001:db8:abcd:12::ffff')).toBe(one);
    expect(clientKey('2001:db8:abcd:12:1:2:3:4')).toBe(one);
    expect(clientKey('2001:0DB8:ABCD:0012:0000:0000:0000:0001')).toBe(one);
  });

  it('keeps two different /64 blocks apart', () => {
    expect(clientKey('2001:db8:abcd:12::1')).not.toBe(clientKey('2001:db8:abcd:13::1'));
    expect(clientKey('2001:db8:abcd:12::1')).not.toBe(clientKey('2001:db9:abcd:12::1'));
  });

  it('reads compressed, leading-zero and zone-id spellings of one address the same way', () => {
    expect(clientKey('fe80::1%eth0')).toBe(clientKey('fe80:0:0:0:0:0:0:1'));
    expect(clientKey('::1')).toBe('0:0:0:0::/64');
  });

  it('reads an IPv6 address with an embedded IPv4 tail', () => {
    expect(clientKey('64:ff9b::203.0.113.9')).toBe('64:ff9b:0:0::/64');
  });

  it('puts a missing or malformed address in the unknown bucket, never throws', () => {
    for (const bad of [
      undefined,
      null,
      '',
      '   ',
      'not-an-ip',
      '1.2.3',
      '1.2.3.4.5',
      '2001:db8::zz',
      '1:2:3:4:5:6:7:8:9',
      '::1::2',
      '256.1.1.1',
    ]) {
      expect(clientKey(bad as string | undefined)).toBe('unknown');
    }
  });
});
