import { beforeEach, describe, expect, it, vi } from 'vitest';

const guarded = vi.hoisted(() => ({ guardedRequest: vi.fn() }));
vi.mock('../../../src/infra/net/guarded-http', () => guarded);

import { deliver } from '../../../src/modules/webhook-fanout/deliver';

const target = {
  url: 'https://8.8.8.8/hook',
  timeoutMs: 2000,
  authHeaderName: 'X-Secret',
  authHeaderValue: 's3cret',
};
const body = Buffer.from('{"object":"whatsapp_business_account",  "spacing":"kept"}');

beforeEach(() => {
  guarded.guardedRequest.mockReset();
});

const answer = (status: number) =>
  guarded.guardedRequest.mockResolvedValue({ status, body: '', headers: {} });

describe('deliver', () => {
  it('posts the exact bytes with the original signature and the target header, to the checked address only', async () => {
    answer(200);
    const out = await deliver(target, {
      body,
      signatureHeader: 'sha256=abc',
      contentType: 'application/json',
    });
    expect(out).toMatchObject({ ok: true, statusCode: 200, permanent: false });
    const req = guarded.guardedRequest.mock.calls[0]![0];
    expect(String(req.url)).toBe(target.url);
    expect(req.method).toBe('POST');
    expect(req.allowPrivate).toBe(false);
    expect(req.timeoutMs).toBe(2000);
    expect(Buffer.from(req.body as Uint8Array).equals(body)).toBe(true);
    expect(req.headers['x-hub-signature-256']).toBe('sha256=abc');
    expect(req.headers['x-secret']).toBe('s3cret');
    expect(req.headers['content-type']).toBe('application/json');
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
    answer(status);
    const out = await deliver(target, { body });
    expect(out.ok).toBe(false);
    expect(out.permanent).toBe(permanent);
  });

  it('reports a timeout as retryable', async () => {
    guarded.guardedRequest.mockImplementation(async () => {
      throw new Error('timed out');
    });
    const out = await deliver(target, { body });
    expect(out).toMatchObject({ ok: false, statusCode: null, permanent: false });
    expect(out.error).toMatch(/Timed out/);
  });

  it('never calls out to a private address', async () => {
    const out = await deliver({ ...target, url: 'https://10.0.0.5/hook' }, { body });
    expect(out.ok).toBe(false);
    expect(guarded.guardedRequest).not.toHaveBeenCalled();
  });

  it('reports a name repointed at an internal address after the check as a failed, retryable delivery', async () => {
    guarded.guardedRequest.mockImplementation(async () => {
      throw new Error('addresses on private networks are not allowed');
    });
    const out = await deliver(target, { body });
    expect(out).toMatchObject({ ok: false, statusCode: null, permanent: false });
    expect(out.error).toContain('private networks');
  });
});
