import { describe, expect, it, vi } from 'vitest';
import { guardedRequest } from '../../../src/infra/net/guarded-http';
import { send } from '../../../src/modules/outbound-webhooks/send';

// The real contracts barrel pulls in Nest decorators; only the header names are needed here.
vi.mock('@crm/contracts', () => ({
  WEBHOOK_HEADERS: { event: 'x-event', id: 'x-id', timestamp: 'x-ts', signature: 'x-sig' },
}));
// The barrel also exports Nest services; the real guard lives in url-guard.
vi.mock('../../../src/modules/webhook-fanout', () => import('../../../src/modules/webhook-fanout/url-guard'));
vi.mock('../../../src/infra/net/guarded-http', () => ({ guardedRequest: vi.fn() }));

const envelope = { id: 'evt_1', event: 'contact.created' } as never;

describe('outbound webhook send', () => {
  it('connects through the socket-level guard (no resolve-then-fetch gap) and keeps 1 KB of the answer', async () => {
    vi.mocked(guardedRequest).mockResolvedValue({ status: 200, body: 'x'.repeat(5000), headers: {} });
    const out = await send('https://8.8.8.8/hook', 'secret', envelope);
    expect(out.ok).toBe(true);
    expect(out.responseSnippet).toHaveLength(1024);
    expect(vi.mocked(guardedRequest).mock.calls[0]![0].allowPrivate).toBe(false);
  });
  it('never calls out to a private address', async () => {
    vi.mocked(guardedRequest).mockClear();
    const out = await send('https://10.0.0.5/hook', null, envelope);
    expect(out.ok).toBe(false);
    expect(guardedRequest).not.toHaveBeenCalled();
  });
  it('does not follow a redirect and says so', async () => {
    vi.mocked(guardedRequest).mockResolvedValue({ status: 302, body: '', headers: {} });
    const out = await send('https://8.8.8.8/hook', null, envelope);
    expect(out).toMatchObject({ ok: false, statusCode: 302, permanent: true });
    expect(out.error).toMatch(/redirects are not followed/);
  });
});
