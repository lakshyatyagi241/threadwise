import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliver } from '../../../src/modules/webhook-fanout/deliver';

const target = {
  url: 'https://8.8.8.8/hook',
  timeoutMs: 2000,
  authHeaderName: 'X-Secret',
  authHeaderValue: 's3cret',
};
const body = Buffer.from('{"object":"whatsapp_business_account",  "spacing":"kept"}');

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number) {
  const fn = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('deliver', () => {
  it('posts the exact bytes with the original signature and the target header', async () => {
    const fetchFn = stubFetch(200);
    const out = await deliver(target, {
      body,
      signatureHeader: 'sha256=abc',
      contentType: 'application/json',
    });
    expect(out).toMatchObject({ ok: true, statusCode: 200, permanent: false });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(target.url);
    expect(Buffer.from(init.body as Uint8Array).equals(body)).toBe(true);
    expect(init.redirect).toBe('manual');
    const h = init.headers as Record<string, string>;
    expect(h['x-hub-signature-256']).toBe('sha256=abc');
    expect(h['x-secret']).toBe('s3cret');
    expect(h['content-type']).toBe('application/json');
  });

  it.each([
    [500, false],
    [503, false],
    [429, false],
    [408, false],
    [400, true],
    [404, true],
    [302, false],
  ])('status %i is permanent=%s', async (status, permanent) => {
    stubFetch(status);
    const out = await deliver(target, { body });
    expect(out.ok).toBe(false);
    expect(out.permanent).toBe(permanent);
  });

  it('reports a timeout as retryable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    });
    const out = await deliver(target, { body });
    expect(out).toMatchObject({ ok: false, statusCode: null, permanent: false });
    expect(out.error).toMatch(/Timed out/);
  });

  it('never calls out to a private address', async () => {
    const fetchFn = stubFetch(200);
    const out = await deliver({ ...target, url: 'https://10.0.0.5/hook' }, { body });
    expect(out.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
