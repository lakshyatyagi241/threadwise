/**
 * A scripted `fetch` for tests: queue the answers in order, then assert on the calls. No network, no timers, and a test that
 * makes a call nobody scripted fails loudly instead of hanging.
 */
type Script = Response | Error | ((init: RequestInit) => Promise<Response>);

export function jsonResponse(
  status: number,
  body?: unknown,
  headers: Record<string, string> = {},
): Response {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => lower[k.toLowerCase()] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

export interface FetchCall {
  url: string;
  init: RequestInit;
  headers: Record<string, string>;
  body: unknown;
}

export function mockFetch(...script: Script[]) {
  const queue = [...script];
  const calls: FetchCall[] = [];
  const fn = jest.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      init,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const next = queue.shift();
    if (!next)
      throw new Error(`fetch called with nothing scripted: ${init.method ?? 'GET'} ${url}`);
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(init);
    return next;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return { fn, calls, remaining: () => queue.length };
}

export const TOKEN_PAIR = (n: number) => ({
  accessToken: `access-${n}`,
  refreshToken: `refresh-${n}`,
  expiresIn: 900,
});
