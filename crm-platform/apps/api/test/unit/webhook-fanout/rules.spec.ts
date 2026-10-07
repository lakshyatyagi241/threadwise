import { describe, expect, it } from 'vitest';
import {
  forwardJobId,
  matchesFilter,
} from '../../../src/modules/webhook-fanout/webhook-fanout.rules';
import { isPrivateAddress, targetUrlProblem } from '../../../src/modules/webhook-fanout/url-guard';

describe('matchesFilter', () => {
  it('takes everything when the filter is empty or missing', () => {
    expect(matchesFilter(null, ['messages'])).toBe(true);
    expect(matchesFilter([], [])).toBe(true);
  });
  it('needs at least one matching field otherwise', () => {
    expect(matchesFilter(['messages'], ['messages', 'account_update'])).toBe(true);
    expect(matchesFilter(['messages'], ['account_update'])).toBe(false);
    expect(matchesFilter(['messages'], [])).toBe(false);
  });
});

describe('forwardJobId', () => {
  it('is the same for the same target and bytes, different otherwise', () => {
    const a = Buffer.from('{"a":1}');
    expect(forwardJobId(1, a)).toBe(forwardJobId(1, Buffer.from('{"a":1}')));
    expect(forwardJobId(1, a)).not.toBe(forwardJobId(2, a));
    expect(forwardJobId(1, a)).not.toBe(forwardJobId(1, Buffer.from('{"a":2}')));
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1', // IPv4-mapped loopback in the hex form Node writes
    '::ffff:a9fe:a9fe', // IPv4-mapped metadata address, hex
    '64:ff9b::7f00:1',
    '2002:7f00:1::1',
  ])('refuses %s', (a) => expect(isPrivateAddress(a)).toBe(true));
  it.each(['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (a) => expect(isPrivateAddress(a)).toBe(false),
  );
});

describe('targetUrlProblem', () => {
  it('accepts a plain https URL', () => {
    expect(targetUrlProblem('https://api.example.com/hook?x=1')).toBeNull();
  });
  it.each([
    'http://api.example.com/hook',
    'https://user:pw@api.example.com/hook',
    'https://localhost/hook',
    'https://svc.internal/hook',
    'https://127.0.0.1/hook',
    'https://[::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://[::ffff:169.254.169.254]/hook',
    'https://169.254.169.254/latest/meta-data',
    'not a url',
    'ftp://example.com',
  ])('refuses %s', (u) => expect(targetUrlProblem(u)).not.toBeNull());
});
