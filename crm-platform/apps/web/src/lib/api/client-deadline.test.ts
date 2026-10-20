import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_CALL_TIMEOUT_MS, apiFetch } from './client';

describe('apiFetch when the API is silent', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('puts a deadline on a call that has none of its own', async () => {
    const seen: Array<AbortSignal | undefined> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_ok, bad) => {
            seen.push(init.signal ?? undefined);
            init.signal?.addEventListener('abort', () => bad(init.signal!.reason));
          }),
      ),
    );
    const spy = vi.spyOn(AbortSignal, 'timeout');
    apiFetch('/contacts').catch(() => undefined);
    expect(spy).toHaveBeenCalledWith(API_CALL_TIMEOUT_MS);
    expect(seen[0]).toBeDefined();
    spy.mockRestore();
  });

  it("a caller's own signal wins, and aborting it rejects the call", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_ok, bad) => {
            seen = init.signal ?? undefined;
            init.signal?.addEventListener('abort', () => bad(init.signal!.reason));
          }),
      ),
    );
    const own = new AbortController();
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const call = apiFetch('/contacts', { signal: own.signal });
    expect(spy).not.toHaveBeenCalled();
    expect(seen).toBe(own.signal);
    own.abort();
    await expect(call).rejects.toBeDefined();
    spy.mockRestore();
  });

  it('the deadline is a real timer: a silent API rejects the call instead of hanging it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_ok, bad) => {
            init.signal?.addEventListener('abort', () => bad(init.signal!.reason));
          }),
      ),
    );
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(50));
    const t0 = Date.now();
    await expect(apiFetch('/contacts')).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - t0).toBeLessThan(1_000);
    spy.mockRestore();
  });
});
