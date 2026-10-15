import { describe, expect, it, vi } from 'vitest';
import { guardedRequest } from '../../../src/infra/net/guarded-http';
import { deliver } from '../../../src/modules/webhook-fanout/deliver';

vi.mock('../../../src/infra/net/guarded-http', () => ({ guardedRequest: vi.fn() }));

const target = {
  url: 'https://8.8.8.8/hook',
  timeoutMs: 2000,
  authHeaderName: 'X-Secret',
  authHeaderValue: 's3cret',
};
const body = Buffer.from('{"object":"whatsapp_business_account",  "spacing":"kept"}');

function stubFetch(status: number) {
  const fn = vi.mocked(guardedRequest);
  fn.mockReset();
  fn.mockResolvedValue({ status, body: '', headers: {} });
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
    const req = fetchFn.mock.calls[0]![0];
    expect(req.url.href).toBe(target.url);
    expect(Buffer.isBuffer(req.body) && req.body.equals(body)).toBe(true);
    expect(req.allowPrivate).toBe(false); // the address is checked inside the socket lookup
    const h = req.headers;
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
    vi.mocked(guardedRequest).mockReset();
    vi.mocked(guardedRequest).mockRejectedValue(new Error('timed out'));
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
