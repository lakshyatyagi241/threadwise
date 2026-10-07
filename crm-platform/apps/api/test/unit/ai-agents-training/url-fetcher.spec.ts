import { afterEach, describe, expect, it, vi } from 'vitest';

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { isBlockedAddress } from '../../../src/infra/providers/ai-agents-training/blocked-address';
import { safeGet } from '../../../src/infra/providers/ai-agents-training/safe-get';
import { HttpTrainingUrlFetcher } from '../../../src/infra/providers/ai-agents-training/http-training-url-fetcher.adapter';

const guarded = vi.fn();
const fetcher = new HttpTrainingUrlFetcher();
fetcher.request = (url, opts) => guarded({ url, ...opts });
const PUBLIC = 'http://93.184.216.34';

afterEach(() => guarded.mockReset());

describe('URL knowledge fetch: SSRF refusals (WD-AIAG-007)', () => {
  it.each([
    ['not a URL', 'invalid URL'],
    ['file:///etc/passwd', 'invalid URL'],
    ['ftp://example.com/', 'scheme ftp not allowed (use http or https)'],
    ['gopher://example.com/', 'scheme gopher not allowed (use http or https)'],
    ['javascript:alert(1)', 'invalid URL'],
    ['http://127.0.0.1:6379/', 'private'],
    ['http://localhost/', 'private'],
    ['http://169.254.169.254/latest/meta-data/', 'private'],
    ['http://10.0.0.5/', 'private'],
    ['http://192.168.1.1/', 'private'],
    ['http://[::1]/', 'private'],
    ['http://[fd00::1]/', 'private'],
    ['http://[::ffff:127.0.0.1]/', 'private'],
    ['http://[::ffff:a9fe:a9fe]/', 'private'],
    ['http://[64:ff9b::7f00:1]/', 'private'],
    ['http://[2002:7f00:1::]/', 'private'],
    ['http://0.0.0.0/', 'private'],
    ['http://2130706433/', 'private'],
    ['http://metadata.google.internal/', 'metadata host not allowed'],
    ['http://service.internal/', 'metadata host not allowed'],
  ])('%s is refused before any request is made', async (url, why) => {
    const res = await fetcher.fetch(url);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain(why);
    expect(guarded).not.toHaveBeenCalled();
  });

  it('a host that does not resolve is refused', async () => {
    const res = await fetcher.fetch('http://no-such-host.invalid/');
    expect(res).toEqual({ ok: false, error: 'hostname did not resolve to a public IP' });
  });

  it('a public page is fetched and its body and type returned', async () => {
    guarded.mockResolvedValue({
      status: 200,
      body: '<p>hi</p>',
      headers: { 'content-type': 'text/html' },
    });
    const res = await fetcher.fetch(`${PUBLIC}/faq`);
    expect(res).toEqual({ ok: true, body: '<p>hi</p>', contentType: 'text/html' });
    expect(String(guarded.mock.calls[0]![0].url)).toBe(`${PUBLIC}/faq`);
  });

  it('a redirect to the cloud metadata address is refused on the second hop', async () => {
    guarded.mockResolvedValueOnce({
      status: 302,
      body: '',
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
    });
    const res = await fetcher.fetch(`${PUBLIC}/go`);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('private');
    expect(guarded).toHaveBeenCalledTimes(1);
  });

  it('a relative redirect is resolved and followed; more than five hops stops', async () => {
    guarded.mockResolvedValueOnce({ status: 301, body: '', headers: { location: '/final' } });
    guarded.mockResolvedValueOnce({ status: 200, body: 'ok', headers: {} });
    expect(await fetcher.fetch(`${PUBLIC}/start`)).toMatchObject({ ok: true, body: 'ok' });
    expect(String(guarded.mock.calls[1]![0].url)).toBe(`${PUBLIC}/final`);

    guarded.mockReset();
    guarded.mockResolvedValue({ status: 302, body: '', headers: { location: '/loop' } });
    expect(await fetcher.fetch(`${PUBLIC}/loop`)).toEqual({
      ok: false,
      error: 'too many redirects',
    });
  });

  it('a non-2xx answer is a failed entry with the status', async () => {
    guarded.mockResolvedValue({ status: 404, body: 'nope', headers: {} });
    expect(await fetcher.fetch(`${PUBLIC}/missing`)).toEqual({
      ok: false,
      error: 'fetch failed: HTTP 404',
    });
  });

  it('a socket error never leaks its text', async () => {
    guarded.mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:80 /srv/secret/path'));
    const res = await fetcher.fetch(`${PUBLIC}/x`);
    expect(res).toEqual({ ok: false, error: 'fetch failed: could not reach the page' });
    guarded.mockRejectedValue(new Error('timed out'));
    expect(await fetcher.fetch(`${PUBLIC}/x`)).toEqual({
      ok: false,
      error: 'fetch failed: timed out',
    });
  });
});

describe('the address rule', () => {
  it.each([
    '127.0.0.1',
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::7f00:1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    'not-an-ip',
  ])('%s is blocked', (a) => expect(isBlockedAddress(a)).toBe(true));

  it.each([
    '93.184.216.34',
    '8.8.8.8',
    '172.32.0.1',
    '100.63.255.255',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('%s is public', (a) => expect(isBlockedAddress(a)).toBe(false));
});

describe('the socket (DNS rebinding and size)', () => {
  const opts = { timeoutMs: 2000, maxBytes: 1000 };

  it('a name that resolves to a blocked address is refused at connect time, even beside a public one', async () => {
    await expect(
      safeGet(new URL('http://rebind.example/'), {
        ...opts,
        resolve: async () => [
          { address: '93.184.216.34', family: 4 },
          { address: '::ffff:7f00:1', family: 6 },
        ],
      }),
    ).rejects.toThrow(/private networks/);
  });

  it('a name that resolves to nothing is refused', async () => {
    await expect(
      safeGet(new URL('http://empty.example/'), { ...opts, resolve: async () => [] }),
    ).rejects.toThrow();
  });

  it('a local server is unreachable through a name that resolves to loopback, and by literal', async () => {
    const server = createServer((_, res) => res.end('secret'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(safeGet(new URL(`http://127.0.0.1:${port}/`), opts)).rejects.toThrow(/private/);
      await expect(
        safeGet(new URL(`http://app.example:${port}/`), {
          ...opts,
          resolve: async () => [{ address: '127.0.0.1', family: 4 }],
        }),
      ).rejects.toThrow(/private/);
    } finally {
      server.close();
    }
  });
});
