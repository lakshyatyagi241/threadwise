import { OtpSendError, type OtpFailureReason } from './otp-sender.port';

/** Every OTP transport gives up after this long (WaDesk: 20 s on the bridge and on Twilio). */
export const OTP_HTTP_TIMEOUT_MS = 20_000;

const DETAIL_MAX = 240;

export interface CallOptions {
  timeoutMs?: number;
  /** Stored secrets to scrub from anything echoed back to an operator. */
  secrets?: readonly string[];
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Names the provider in error text, e.g. "Meta". */
  provider: string;
}

export interface ProviderResponse {
  status: number;
  ok: boolean;
  json: unknown;
}

/** Joins a base address and path segments, encoding each segment. */
export function joinUrl(base: string, ...segments: string[]): string {
  return [base.replace(/\/+$/, ''), ...segments.map((s) => encodeURIComponent(s))].join('/');
}

/** Replaces every stored secret (and its base64 form) in `text`. */
export function scrubSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    out = out.split(secret).join('***');
    out = out.split(Buffer.from(secret).toString('base64')).join('***');
  }
  return out;
}

const safeDetail = (text: string, secrets?: readonly string[]): string =>
  scrubSecrets(text.replace(/\s+/g, ' ').trim(), secrets).slice(0, DETAIL_MAX);

/**
 * One HTTP call with a timeout. Network-level failures become a typed
 * OtpSendError; an HTTP error status is returned for the caller to interpret
 * (each provider words its errors differently).
 */
export async function callProvider(
  url: string,
  init: RequestInit,
  opts: CallOptions,
): Promise<ProviderResponse> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(url, {
      ...init,
      // A token must not follow a redirect to another host.
      redirect: 'error',
      signal: AbortSignal.timeout(opts.timeoutMs ?? OTP_HTTP_TIMEOUT_MS),
    });
  } catch (err) {
    throw networkFailure(err, opts.provider);
  }
  let json: unknown;
  try {
    json = JSON.parse(await res.text());
  } catch {
    json = undefined;
  }
  return { status: res.status, ok: res.ok, json };
}

function networkFailure(err: unknown, provider: string): OtpSendError {
  const name = (err as { name?: string } | null)?.name;
  const code =
    (err as { cause?: { code?: string } } | null)?.cause?.code ?? (err as { code?: string }).code;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new OtpSendError('timeout', `${provider} did not answer in time.`);
  }
  if (code === 'ECONNREFUSED') {
    return new OtpSendError('connection_refused', `${provider} refused the connection.`);
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new OtpSendError('transport_error', `${provider} address could not be resolved.`);
  }
  return new OtpSendError('transport_error', `Could not reach ${provider}.`);
}

/** A typed failure for a non-2xx answer; `detail` is the provider's own words, scrubbed and trimmed. */
export function httpFailure(
  res: ProviderResponse,
  detail: string | null,
  opts: Pick<CallOptions, 'provider' | 'secrets'>,
): OtpSendError {
  const reason: OtpFailureReason =
    res.status === 401 || res.status === 403
      ? 'auth_failed'
      : res.status >= 500
        ? 'provider_error'
        : 'rejected';
  const head =
    reason === 'auth_failed'
      ? `${opts.provider} refused the credentials.`
      : `${opts.provider} answered ${res.status}.`;
  const tail = detail ? ` ${safeDetail(detail, opts.secrets)}` : '';
  return new OtpSendError(reason, `${head}${tail}`.trim());
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : null;

/** Meta Graph errors: `{ error: { message, error_user_msg, code } }`. */
export function metaErrorText(json: unknown): string | null {
  const error = asRecord(asRecord(json)?.error);
  if (!error) return null;
  const text = [error.error_user_msg, error.message].find(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  return text ?? null;
}

/** Twilio errors: `{ code, message, more_info }`. */
export function twilioErrorText(json: unknown): string | null {
  const body = asRecord(json);
  if (!body || typeof body.message !== 'string') return null;
  return typeof body.code === 'number' ? `(${body.code}) ${body.message}` : body.message;
}

/** The bridge's own errors: `{ message }` or `{ error }`. */
export function bridgeErrorText(json: unknown): string | null {
  const body = asRecord(json);
  if (!body) return null;
  for (const key of ['message', 'error']) {
    const v = body[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}
