import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookEnvelope } from '@crm/contracts';

const guarded = vi.hoisted(() => ({ guardedRequest: vi.fn() }));
vi.mock('../../../src/infra/net/guarded-http', () => guarded);

import { send } from '../../../src/modules/outbound-webhooks/send';

const envelope = { id: 'evt_1', event: 'contact.created', data: {} } as unknown as WebhookEnvelope;

describe('customer webhook send: the connection is made to the address that was checked', () => {
  beforeEach(() => {
    guarded.guardedRequest.mockReset();
  });

  it('goes through the connect-time guard with private addresses off and no redirect following', async () => {
    guarded.guardedRequest.mockResolvedValue({ status: 200, body: 'ok', headers: {} });
    const out = await send('https://93.184.216.34/hook', 'secret', envelope);
    expect(out).toMatchObject({ ok: true, statusCode: 200, responseSnippet: 'ok' });
    const req = guarded.guardedRequest.mock.calls[0]![0];
    expect(req.allowPrivate).toBe(false);
    expect(req.method).toBe('POST');
    expect(String(req.url)).toBe('https://93.184.216.34/hook');
    expect(req.maxBytes).toBe(1024);
  });

  it('never makes a request for an internal address', async () => {
    const out = await send('https://169.254.169.254/latest', null, envelope);
    expect(out.ok).toBe(false);
    expect(out.permanent).toBe(true);
    expect(guarded.guardedRequest).not.toHaveBeenCalled();
  });

  it('reports a name that is repointed at an internal address after the check as a failed delivery, with no body leaked', async () => {
    guarded.guardedRequest.mockImplementation(async () => {
      throw new Error('addresses on private networks are not allowed');
    });
    const out = await send('https://93.184.216.34/hook', null, envelope);
    expect(out).toMatchObject({ ok: false, error: 'Could not connect', responseSnippet: null });
  });

  it('words a redirect as not followed, and treats it as permanent', async () => {
    guarded.guardedRequest.mockResolvedValue({
      status: 302,
      body: '',
      headers: { location: 'http://10.0.0.1/' },
    });
    const out = await send('https://93.184.216.34/hook', null, envelope);
    expect(out).toMatchObject({
      ok: false,
      statusCode: 302,
      permanent: true,
      responseSnippet: null,
    });
    expect(out.error).toContain('redirects are not followed');
  });

  it('words a timeout as a timeout', async () => {
    guarded.guardedRequest.mockImplementation(async () => {
      throw new Error('timed out');
    });
    expect((await send('https://93.184.216.34/hook', null, envelope)).error).toMatch(/Timed out/);
  });

  it('a 429 or 503 with Retry-After tells the queue how long to wait; other answers do not (RF-07)', async () => {
    guarded.guardedRequest.mockResolvedValue({
      status: 429,
      body: '',
      headers: { 'retry-after': '120' },
    });
    expect(await send('https://93.184.216.34/hook', null, envelope)).toMatchObject({
      ok: false,
      permanent: false,
      retryAfterMs: 120_000,
    });
    guarded.guardedRequest.mockResolvedValue({
      status: 500,
      body: '',
      headers: { 'retry-after': '120' },
    });
    expect((await send('https://93.184.216.34/hook', null, envelope)).retryAfterMs).toBeNull();
    guarded.guardedRequest.mockResolvedValue({ status: 429, body: '', headers: {} });
    expect((await send('https://93.184.216.34/hook', null, envelope)).retryAfterMs).toBeNull();
  });
});
