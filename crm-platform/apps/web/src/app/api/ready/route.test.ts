import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET as ready } from './route';
import { GET as health } from '../health/route';

afterEach(() => vi.unstubAllGlobals());

describe('web health and readiness', () => {
  it('liveness never calls the API', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await health()).status).toBe(200);
    expect(f).not.toHaveBeenCalled();
  });
  it('ready is 200 when the API answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect((await ready()).status).toBe(200);
  });
  it('ready is 503 with a fixed body when the API fails, and leaks nothing', async () => {
    process.env.API_URL = 'http://secret-host.internal:3000';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED secret-host.internal:3000')));
    const res = await ready();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/secret-host|ECONNREFUSED|3000/);
  });
  it('ready is 503 when the API answers 5xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    expect((await ready()).status).toBe(503);
  });
});
