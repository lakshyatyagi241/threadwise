import { WEBHOOK_HEADERS, type WebhookEnvelope } from '@crm/contracts';
import { guardedRequest } from '../../infra/net/guarded-http';
import { assertPublicTarget } from '../webhook-fanout';
import { sign } from './signing';

export interface SendOutcome {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  latencyMs: number;
  /** A 4xx other than 408/429 will not get better by retrying. */
  permanent: boolean;
  /** The first bytes of the answer, for the delivery log (never trusted, never rendered as HTML). */
  responseSnippet: string | null;
}

const TIMEOUT_MS = 10_000;
const SNIPPET_BYTES = 1024;

/**
 * One signed POST of an envelope to a customer's endpoint. The address is checked again here (a name can be repointed at an internal
 * host after it was saved), redirects are not followed (a redirect is a way around that check), and only the first kilobyte of the
 * answer is read.
 */
export async function send(
  url: string,
  secret: string | null,
  envelope: WebhookEnvelope,
): Promise<SendOutcome> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const fail = (
    error: string,
    statusCode: number | null = null,
    permanent = false,
  ): SendOutcome => ({
    ok: false,
    statusCode,
    error,
    latencyMs: elapsed(),
    permanent,
    responseSnippet: null,
  });

  const blocked = await assertPublicTarget(url);
  if (blocked) return fail(blocked, null, true);

  const body = JSON.stringify(envelope);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'geta-webhooks/1',
    [WEBHOOK_HEADERS.event]: envelope.event,
    [WEBHOOK_HEADERS.id]: envelope.id,
    [WEBHOOK_HEADERS.timestamp]: timestamp,
  };
  if (secret) headers[WEBHOOK_HEADERS.signature] = sign(secret, timestamp, body);

  try {
    // The address is checked inside the socket's own DNS lookup, so the address that was checked is the address that is connected to:
    // a name repointed at an internal host between the check above and this call cannot be reached (DNS rebinding), and redirects are
    // never followed.
    const res = await guardedRequest({
      method: 'POST',
      url: new URL(url),
      headers,
      body,
      timeoutMs: TIMEOUT_MS,
      allowPrivate: false,
      maxBytes: SNIPPET_BYTES,
    });
    const snippet = res.body.slice(0, SNIPPET_BYTES) || null;
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      statusCode: res.status,
      error: ok
        ? null
        : res.status >= 300 && res.status < 400
          ? `HTTP ${res.status} (redirects are not followed)`
          : `HTTP ${res.status}`,
      latencyMs: elapsed(),
      permanent: res.status >= 300 && res.status < 500 && res.status !== 408 && res.status !== 429,
      responseSnippet: snippet,
    };
  } catch (err) {
    const e = err as Error;
    const timedOut =
      e.name === 'TimeoutError' || e.name === 'AbortError' || e.message === 'timed out';
    return fail(timedOut ? `Timed out after ${TIMEOUT_MS / 1000} s` : 'Could not connect');
  }
}
