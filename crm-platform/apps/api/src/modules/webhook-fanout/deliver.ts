import { assertPublicTarget } from './url-guard';

export interface DeliveryTarget {
  url: string;
  timeoutMs: number;
  authHeaderName: string | null;
  authHeaderValue: string | null;
}

export interface DeliveryInput {
  body: Buffer;
  signatureHeader?: string | null;
  contentType?: string | null;
  extraHeaders?: Record<string, string>;
}

export interface DeliveryOutcome {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  latencyMs: number;
  /** A 4xx other than 408/429 will not get better by retrying. */
  permanent: boolean;
}

/**
 * One POST of the raw bytes, nothing re-serialised. The original `X-Hub-Signature-256` rides along so the target can
 * verify it with the Meta app secret exactly as if Meta had called it. Redirects are not followed (a redirect is a way
 * around the address check) and the response body is never read.
 */
export async function deliver(
  target: DeliveryTarget,
  input: DeliveryInput,
): Promise<DeliveryOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const blocked = await assertPublicTarget(target.url);
  if (blocked)
    return { ok: false, statusCode: null, error: blocked, latencyMs: elapsed(), permanent: false };

  const headers: Record<string, string> = {
    'content-type': input.contentType || 'application/json',
    'user-agent': 'geta-webhook-forwarder/1',
    ...(input.extraHeaders ?? {}),
  };
  if (input.signatureHeader) headers['x-hub-signature-256'] = input.signatureHeader;
  if (target.authHeaderName && target.authHeaderValue)
    headers[target.authHeaderName.toLowerCase()] = target.authHeaderValue;

  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers,
      body: new Uint8Array(input.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(target.timeoutMs),
    });
    void res.body?.cancel().catch(() => undefined);
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      statusCode: res.status,
      error: ok ? null : `HTTP ${res.status}`,
      latencyMs: elapsed(),
      permanent: res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429,
    };
  } catch (err) {
    const e = err as Error;
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
    return {
      ok: false,
      statusCode: null,
      error: timedOut ? `Timed out after ${target.timeoutMs} ms` : e.message.slice(0, 300),
      latencyMs: elapsed(),
      permanent: false,
    };
  }
}
