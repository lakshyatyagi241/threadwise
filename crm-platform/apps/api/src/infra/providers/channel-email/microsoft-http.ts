import { MicrosoftMailError, parseRetryAfter } from './microsoft-mail.errors';

type Json = Record<string, unknown>;

export interface MicrosoftSendOptions {
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  timeoutMs: number;
  classify: (status: number, body: unknown, retryAfter: number | null) => MicrosoftMailError;
}

async function call(url: string, opts: MicrosoftSendOptions): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body as string | undefined,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new MicrosoftMailError(
      timedOut ? 'timeout' : 'network',
      0,
      timedOut ? 'timeout' : ((err as { cause?: { code?: string } }).cause?.code ?? 'network'),
    );
  }
}

async function failure(res: Response, opts: MicrosoftSendOptions): Promise<MicrosoftMailError> {
  const text = await res.text().catch(() => '');
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return opts.classify(res.status, parsed, parseRetryAfter(res.headers.get('retry-after')));
}

/**
 * One HTTP call to Microsoft with a timeout. Every failure is a `MicrosoftMailError` (never a raw fetch error); a success answers the parsed
 * JSON body (`{}` when empty). Holds no state, no tenant and no secret of its own.
 */
export async function microsoftSend(url: string, opts: MicrosoftSendOptions): Promise<Json> {
  const res = await call(url, opts);
  if (!res.ok) throw await failure(res, opts);
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

/** The raw bytes of a response (an attachment's `$value`). */
export async function microsoftBytes(url: string, opts: MicrosoftSendOptions): Promise<Buffer> {
  const res = await call(url, opts);
  if (!res.ok) throw await failure(res, opts);
  return Buffer.from(await res.arrayBuffer());
}

/** The status and headers of a response whose body does not matter (an upload-session chunk). */
export async function microsoftStatus(
  url: string,
  opts: MicrosoftSendOptions,
): Promise<{ status: number; body: Json }> {
  const res = await call(url, opts);
  if (!res.ok) throw await failure(res, opts);
  const text = await res.text();
  let body: Json = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (parsed && typeof parsed === 'object') body = parsed as Json;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}
