import { describe, expect, it } from 'vitest';
import {
  assertAllowedUrl,
  downloadAuthApplies,
  downloadPolicy,
  guardedLookup,
  isPublicAddress,
  type DnsResolver,
} from '../../../src/infra/providers/whatsapp/media/media-url-guard';
import {
  MEDIA_FAILURE,
  MediaFetchError,
} from '../../../src/infra/providers/whatsapp/media/media-fetch-error';
import type { MediaProviderProfile } from '../../../src/infra/providers/whatsapp/media/media-provider';
import { whatsappMediaConfig } from '../../../src/infra/providers/whatsapp/media/whatsapp-media.config';

const cfg = whatsappMediaConfig({ NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const prodCfg = whatsappMediaConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);

const meta: MediaProviderProfile = {
  baseUrl: 'https://graph.facebook.com',
  apiVersion: 'v23.0',
  credentialMode: 'channel_token',
  buildHeaders: ({ channelToken }): Record<string, string> =>
    channelToken ? { authorization: `Bearer ${channelToken}` } : {},
  capabilities: { mediaUpload: true },
};
const interakt: MediaProviderProfile = {
  baseUrl: 'https://amped-express.interakt.ai/api',
  apiVersion: 'v24.0',
  credentialMode: 'platform_token',
  buildHeaders: () => ({ 'x-access-token': 'platform-token-123', 'x-waba-id': '999' }),
  capabilities: { mediaUpload: false },
};
const fakeLocal: MediaProviderProfile = { ...meta, baseUrl: 'http://127.0.0.1:45678' };

const rejected = (fn: () => unknown): MediaFetchError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof MediaFetchError) return err;
    throw err;
  }
  throw new Error('expected the url to be refused');
};

describe('isPublicAddress: only addresses routable on the public internet', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '157.240.22.35', // a Meta address
    '172.15.255.255',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '2a03:2880:f12f:83:face:b00c:0:25de',
  ])('%s is public', (a) => expect(isPublicAddress(a)).toBe(true));

  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '127.0.0.1',
    '127.255.255.254',
    '169.254.169.254', // the cloud metadata address
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.0.2.1',
    '198.51.100.7',
    '203.0.113.9',
    '198.18.0.1',
    '100.64.0.1', // carrier NAT
    '100.127.255.255',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:7f00:1', // the same, in hex form
    '::ffff:10.1.2.3',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1', // NAT64 of loopback
    '2002:7f00:1::1', // 6to4 of loopback
    '2002:a9fe:a9fe::1', // 6to4 of the metadata address
  ])('%s is not public', (a) => expect(isPublicAddress(a)).toBe(false));

  it('anything that is not an address is not public', () => {
    for (const a of ['', 'localhost', 'example.com', '999.1.1.1', '1.2.3', '1.2.3.4.5', '::g']) {
      expect(isPublicAddress(a)).toBe(false);
    }
  });
});

describe('assertAllowedUrl: the address itself', () => {
  const download = downloadPolicy(meta, cfg);

  it('accepts https on a Meta media host, with its query', () => {
    const u = assertAllowedUrl(
      'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=123&ext=1&hash=abc',
      download,
    );
    expect(u.hostname).toBe('lookaside.fbsbx.com');
    expect(assertAllowedUrl('https://scontent.xx.fbcdn.net/v/t1/file.jpg', download).protocol).toBe(
      'https:',
    );
    expect(assertAllowedUrl('https://mmg.whatsapp.net/d/f/abc', download).hostname).toBe(
      'mmg.whatsapp.net',
    );
  });

  it('refuses plain http', () => {
    const e = rejected(() => assertAllowedUrl('http://lookaside.fbsbx.com/x', download));
    expect(e.code).toBe(MEDIA_FAILURE.URL_REJECTED);
    expect(e.retryable).toBe(false);
    expect(e.message).toMatch(/not https/);
  });

  it.each([
    ['an address literal', 'https://8.8.8.8/x'],
    ['the metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['IPv6 loopback', 'https://[::1]/x'],
    ['an IPv4-mapped IPv6 literal', 'https://[::ffff:7f00:1]/x'],
    ['localhost', 'https://localhost/x'],
    ['a host that only ends like a Meta host', 'https://evilfbsbx.com/x'],
    ['a Meta host as a path', 'https://evil.example.com/lookaside.fbsbx.com'],
    ['a Meta host in the credentials position', 'https://lookaside.fbsbx.com@evil.example.com/x'],
    ['credentials in the url', 'https://user:pass@lookaside.fbsbx.com/x'],
    ['an unexpected port', 'https://lookaside.fbsbx.com:8443/x'],
    ['another scheme', 'ftp://lookaside.fbsbx.com/x'],
    ['file scheme', 'file:///etc/passwd'],
    ['not a url', 'lookaside.fbsbx.com/x'],
    ['empty', ''],
  ])('refuses %s', (_why, url) => {
    expect(rejected(() => assertAllowedUrl(url, download)).code).toBe(MEDIA_FAILURE.URL_REJECTED);
  });

  it('refuses a host that is not on the list (a plausible-looking one)', () => {
    expect(
      rejected(() => assertAllowedUrl('https://files.example.com/x', download)).message,
    ).toMatch(/not a WhatsApp media host/);
  });

  it('the host the provider lookup answered with is allowed for that download only', () => {
    const answered = 'https://cdn.bsp-storage.example/files/abc?sig=1';
    expect(assertAllowedUrl(answered, downloadPolicy(interakt, cfg, answered)).hostname).toBe(
      'cdn.bsp-storage.example',
    );
    // another download from the same provider has no such host on its list
    expect(rejected(() => assertAllowedUrl(answered, downloadPolicy(interakt, cfg))).code).toBe(
      MEDIA_FAILURE.URL_REJECTED,
    );
  });

  it('an address literal is refused even when the lookup answered with it', () => {
    const answered = 'https://10.0.0.5/files/abc';
    expect(
      rejected(() => assertAllowedUrl(answered, downloadPolicy(interakt, cfg, answered))).message,
    ).toMatch(/ip address/);
  });
});

describe('the loopback relaxation (a fake Graph server) is for development and tests only', () => {
  it("outside production, plain http on the profile's own loopback host is accepted, any port", () => {
    const policy = downloadPolicy(fakeLocal, cfg);
    expect(assertAllowedUrl('http://127.0.0.1:9999/files/1', policy).hostname).toBe('127.0.0.1');
    expect(assertAllowedUrl('http://127.0.0.1:45678/v23.0/1', policy).port).toBe('45678');
  });

  it('even then, other loopback names and other private hosts stay refused', () => {
    const policy = downloadPolicy(fakeLocal, cfg);
    expect(rejected(() => assertAllowedUrl('http://localhost:9999/x', policy)).code).toBe(
      MEDIA_FAILURE.URL_REJECTED,
    );
    expect(rejected(() => assertAllowedUrl('http://10.0.0.1/x', policy)).code).toBe(
      MEDIA_FAILURE.URL_REJECTED,
    );
    expect(rejected(() => assertAllowedUrl('http://169.254.169.254/x', policy)).code).toBe(
      MEDIA_FAILURE.URL_REJECTED,
    );
  });

  it('production refuses a profile that is not https, before any request is made', () => {
    expect(rejected(() => downloadPolicy(fakeLocal, prodCfg)).code).toBe(
      MEDIA_FAILURE.URL_REJECTED,
    );
    expect(rejected(() => downloadPolicy(fakeLocal, prodCfg)).message).toMatch(/must be https/);
  });

  it('a non-loopback http provider is refused outside production too', () => {
    const lan: MediaProviderProfile = { ...meta, baseUrl: 'http://10.1.1.1:8080' };
    expect(rejected(() => downloadPolicy(lan, cfg)).code).toBe(MEDIA_FAILURE.URL_REJECTED);
  });
});

describe('guardedLookup: the address checked is the address connected to', () => {
  const answers =
    (...addresses: string[]): DnsResolver =>
    (_host, cb) =>
      cb(
        null,
        addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
      );
  const run = (
    policy = downloadPolicy(meta, cfg),
    resolver: DnsResolver,
    host = 'lookaside.fbsbx.com',
  ) =>
    new Promise<{ err: NodeJS.ErrnoException | null; address?: unknown }>((resolve) =>
      guardedLookup(policy, resolver)(host, { all: true }, (err, address) =>
        resolve({ err, address }),
      ),
    );

  it('passes a name that resolves to public addresses only', async () => {
    const r = await run(undefined, answers('157.240.22.35', '2a03:2880::1'));
    expect(r.err).toBeNull();
    expect(r.address).toHaveLength(2);
  });

  it('refuses a name that resolves to a private address (DNS pointing inside)', async () => {
    const r = await run(undefined, answers('10.0.0.8'));
    expect(r.err?.code).toBe('EBLOCKED');
  });

  it.each(['::ffff:7f00:1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::1'])(
    'refuses a name that resolves to %s (an IPv6 form of an internal IPv4 address)',
    async (address) => {
      const r = await run(undefined, answers('157.240.22.35', address));
      expect(r.err?.code).toBe('EBLOCKED');
    },
  );

  it('refuses when ANY of the answers is private, so a mixed answer cannot be used to rebind', async () => {
    const r = await run(undefined, answers('157.240.22.35', '127.0.0.1'));
    expect(r.err?.code).toBe('EBLOCKED');
  });

  it('refuses loopback, link local, unique-local and mapped forms', async () => {
    for (const a of ['127.0.0.1', '169.254.169.254', 'fd00::1', '::ffff:10.0.0.1', '::1']) {
      expect((await run(undefined, answers(a))).err?.code, a).toBe('EBLOCKED');
    }
  });

  it('the one loopback host a test profile names may resolve to loopback', async () => {
    const r = await run(
      downloadPolicy({ ...meta, baseUrl: 'http://localhost:1' }, cfg),
      answers('127.0.0.1'),
      'localhost',
    );
    expect(r.err).toBeNull();
  });

  it('answers the single-address form of lookup too', async () => {
    const out = await new Promise<{ err: unknown; address: unknown; family: unknown }>((resolve) =>
      guardedLookup(downloadPolicy(meta, cfg), answers('157.240.22.35'))(
        'lookaside.fbsbx.com',
        {},
        (err, address, family) => resolve({ err, address, family }),
      ),
    );
    expect(out).toEqual({ err: null, address: '157.240.22.35', family: 4 });
  });

  it('passes a resolver error through and refuses an empty answer', async () => {
    const failing: DnsResolver = (_h, cb) =>
      cb(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }), []);
    expect((await run(undefined, failing)).err?.code).toBe('ENOTFOUND');
    expect((await run(undefined, answers())).err?.code).toBe('ENOTFOUND');
  });
});

describe("downloadAuthApplies: where the provider's credentials may go", () => {
  it('direct Meta: the token goes to Graph and to Meta media hosts, never to another host', () => {
    expect(downloadAuthApplies('graph.facebook.com', meta)).toBe(true);
    expect(downloadAuthApplies('lookaside.fbsbx.com', meta)).toBe(true);
    expect(downloadAuthApplies('scontent.xx.fbcdn.net', meta)).toBe(true);
    expect(downloadAuthApplies('cdn.bsp-storage.example', meta)).toBe(false);
    expect(downloadAuthApplies('evil.example.com', meta)).toBe(false);
  });

  it("a BSP: its headers go to its own host only, not to Meta's CDN and not to a storage host it named", () => {
    expect(downloadAuthApplies('amped-express.interakt.ai', interakt)).toBe(true);
    expect(downloadAuthApplies('lookaside.fbsbx.com', interakt)).toBe(false);
    expect(downloadAuthApplies('cdn.bsp-storage.example', interakt)).toBe(false);
  });
});
