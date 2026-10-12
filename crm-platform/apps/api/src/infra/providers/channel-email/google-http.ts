import { GoogleMailError } from './google-mail.errors';

type Json = Record<string, unknown>;

export interface SendOptions {
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  classify: (status: number, body: unknown) => GoogleMailError;
}

/**
 * One HTTP call to Google with a timeout. Every failure is a `GoogleMailError` (never a raw fetch error); a success answers the parsed JSON
 * body (`{}` when empty). Holds no state, no tenant and no secret of its own.
 */
export async function googleSend(url: string, opts: SendOptions): Promise<Json> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new GoogleMailError(
      timedOut ? 'timeout' : 'network',
      0,
      timedOut ? 'timeout' : ((err as { cause?: { code?: string } }).cause?.code ?? 'network'),
    );
  }
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) throw opts.classify(res.status, parsed);
  return (parsed && typeof parsed === 'object' ? parsed : {}) as Json;
}
