import { afterEach, describe, expect, it } from 'vitest';
import { checkProviderBaseUrl } from '@crm/contracts';
import {
  assertPublicUrl,
  isNonPublicAddress,
  UnsafeProviderUrlError,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/provider-url-guard';

const publicHost = async () => ['93.184.216.34'];

describe('the shape of a provider address (contracts)', () => {
  it.each([
    'https://api.pinnacle.io',
    'https://api.pinnacle.io/wa/',
    'https://amped-express.interakt.ai/api',
  ])('accepts %s', (u) => {
    expect(checkProviderBaseUrl(u).ok).toBe(true);
  });

  it.each([
    ['http://api.pinnacle.io', 'https'],
    ['https://169.254.169.254', 'IP address'],
    ['https://127.0.0.1', 'IP address'],
    ['https://[::1]', 'IP address'],
    ['https://localhost', 'public host name'],
    ['https://metadata.internal', 'internal'],
    ['https://db.svc.cluster.local', 'internal'],
    ['https://api.pinnacle.io:8443', 'port'],
    ['https://user:pass@api.pinnacle.io', 'credentials'],
    ['https://api.pinnacle.io/?x=1', 'query'],
    ['https://api.pinnacle.io/#frag', 'query'],
    ['ftp://api.pinnacle.io', 'https'],
    ['not a url', 'spaces'],
    ['nohost', 'valid URL'],
    ['', 'between'],
  ])('refuses %s', (u, why) => {
    const v = checkProviderBaseUrl(u);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toContain(why);
  });

  it('plain http on a loopback host only when the caller says it is development', () => {
    expect(checkProviderBaseUrl('http://127.0.0.1:4010').ok).toBe(false);
    expect(checkProviderBaseUrl('http://127.0.0.1:4010', { allowDevLoopback: true })).toMatchObject(
      { ok: true, devLoopback: true },
    );
    expect(checkProviderBaseUrl('http://10.0.0.5', { allowDevLoopback: true }).ok).toBe(false);
  });
});

describe('addresses a provider must not live on', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '127.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('%s is refused', (a) => {
    expect(isNonPublicAddress(a)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (a) => {
      expect(isNonPublicAddress(a)).toBe(false);
    },
  );
});

describe('assertPublicUrl', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('accepts https on a host that resolves to public addresses', async () => {
    await expect(
      assertPublicUrl('https://api.pinnacle.io/wa/v24.0', { resolve: publicHost }),
    ).resolves.toBeUndefined();
  });

  it('refuses a name that resolves to a private address, even if only one of several does', async () => {
    await expect(
      assertPublicUrl('https://api.pinnacle.io', { resolve: async () => ['10.0.0.8'] }),
    ).rejects.toBeInstanceOf(UnsafeProviderUrlError);
    await expect(
      assertPublicUrl('https://api.pinnacle.io', {
        resolve: async () => ['93.184.216.34', '169.254.169.254'],
      }),
    ).rejects.toThrow('private or reserved');
  });

  it('refuses a name that does not resolve', async () => {
    await expect(
      assertPublicUrl('https://api.pinnacle.io', {
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toThrow('does not resolve');
    await expect(
      assertPublicUrl('https://api.pinnacle.io', { resolve: async () => [] }),
    ).rejects.toThrow('does not resolve');
  });

  it('refuses http and IP literals before any lookup', async () => {
    const resolve = async () => {
      throw new Error('must not look up');
    };
    await expect(assertPublicUrl('http://api.pinnacle.io', { resolve })).rejects.toThrow('https');
    await expect(assertPublicUrl('https://10.0.0.1', { resolve })).rejects.toThrow('IP address');
  });

  it('development flag: a loopback stand-in is accepted over http, a private https address is still not', async () => {
    process.env.NODE_ENV = 'test';
    await expect(
      assertPublicUrl('http://127.0.0.1:4010/graph', { allowDevHosts: true }),
    ).resolves.toBeUndefined();
    await expect(
      assertPublicUrl('http://10.0.0.1', { allowDevHosts: true }),
    ).rejects.toBeInstanceOf(UnsafeProviderUrlError);
    await expect(
      assertPublicUrl('http://127.0.0.1:4010', { allowDevHosts: false }),
    ).rejects.toBeInstanceOf(UnsafeProviderUrlError);
  });

  it('production ignores the development flag', async () => {
    process.env.NODE_ENV = 'production';
    await expect(
      assertPublicUrl('http://127.0.0.1:4010', { allowDevHosts: true }),
    ).rejects.toBeInstanceOf(UnsafeProviderUrlError);
  });
});
