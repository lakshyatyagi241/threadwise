/**
 * Errors from Meta Graph / Interakt, normalised once so nothing above the adapter parses Meta's shapes (TW-WABA-051).
 *
 * Interakt relays Meta's `error` object unchanged, but Geta's own code crashes when a proxy answers with a body that has no
 * `error` key (an HTML 502, a bare string); `fromResponse` therefore accepts any body.
 */

export interface MetaErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
  error_user_title?: string;
  error_user_msg?: string;
  error_data?: { details?: string; messaging_product?: string };
  fbtrace_id?: string;
}

/** The token lacks `whatsapp_business_management`: nothing else can work until it is regenerated. */
export const SUBCODE_MISSING_BUSINESS_MANAGEMENT = 1349174;

export class WabaApiError extends Error {
  override readonly name = 'WabaApiError';

  constructor(
    message: string,
    /** HTTP status; 0 when the request never got an answer (timeout, DNS, TLS). */
    readonly status: number,
    readonly code: number | null,
    readonly subcode: number | null,
    readonly userTitle: string | null,
    readonly userMessage: string | null,
    readonly fbtraceId: string | null,
    readonly transient: boolean,
    /** The raw decoded body, kept for logs and audit; never shown to a user. */
    readonly body: unknown,
    /**
     * True when the request may have reached Meta and been acted on although no usable answer came back (a timeout, a reset, a 200
     * whose body could not be read). Repeating a send after such an error can deliver it twice (RET-031, RET-032).
     */
    readonly outcomeMayHaveCommitted = false,
    /**
     * Set only by the platform's own send limiter (`WabaApiError.held`): how long the caller should wait before trying again. Meta's
     * answers never carry it, so a throttle that came from Meta and one the limiter chose can be told apart.
     */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }

  /**
   * A send the platform's limiter handed back before it reached Meta: the number's queue is deeper than the maximum local wait. It reads
   * as a throughput limit (HTTP 429, Meta's 130429) to every caller that already backs off on one, with the wait the limiter computed.
   */
  static held(retryAfterMs: number, message: string): WabaApiError {
    return new WabaApiError(
      message,
      429,
      130429,
      null,
      null,
      null,
      null,
      true,
      null,
      false,
      retryAfterMs,
    );
  }

  /** True when the platform's own limiter produced this error (nothing was sent to Meta). */
  get heldLocally(): boolean {
    return this.retryAfterMs !== null;
  }

  static fromResponse(status: number, body: unknown): WabaApiError {
    const err = extractError(body);
    const message = describeMetaError(err) ?? `Request failed (HTTP ${status})`;
    return new WabaApiError(
      message,
      status,
      typeof err?.code === 'number' ? err.code : null,
      typeof err?.error_subcode === 'number' ? err.error_subcode : null,
      err?.error_user_title ?? null,
      err?.error_user_msg ?? null,
      err?.fbtrace_id ?? null,
      err?.is_transient === true,
      body,
    );
  }

  static network(cause: unknown, options: { bodyUnreadable?: boolean } = {}): WabaApiError {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const timedOut =
      cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    return new WabaApiError(
      timedOut ? 'Meta did not answer in time' : `Could not reach Meta: ${reason}`,
      0,
      null,
      null,
      null,
      null,
      null,
      true,
      null,
      options.bodyUnreadable === true || !neverLeft(cause),
    );
  }

  /** Worth retrying with backoff: network failure, 5xx, Meta's own transient flag, or a throughput limit. */
  get retryable(): boolean {
    if (this.transient || this.status === 0 || this.status >= 500 || this.status === 429)
      return true;
    return (
      this.code === 130429 ||
      this.code === 131057 ||
      this.code === 131056 ||
      this.code === 4 ||
      this.code === 80007
    );
  }

  get missingBusinessManagement(): boolean {
    return this.subcode === SUBCODE_MISSING_BUSINESS_MANAGEMENT;
  }
}

/** Connection errors that happen before a single byte of the request is sent: the call cannot have been acted on. */
const NEVER_SENT = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** True only when the error proves the request never left. Anything else (a timeout, a reset, an unknown error) is treated as possibly sent. */
function neverLeft(cause: unknown): boolean {
  for (let e: unknown = cause, depth = 0; e && depth < 4; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && NEVER_SENT.has(code)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

function extractError(body: unknown): MetaErrorBody | null {
  if (!body || typeof body !== 'object') return null;
  const e = (body as { error?: unknown }).error;
  if (e && typeof e === 'object') return e as MetaErrorBody;
  return null;
}

/**
 * Meta's own words first (`error_user_msg`, then `error_data.details`, then `message`), prefixed with the user title when it
 * adds information and suffixed with `(code N[/sub], trace X)`.
 */
export function describeMetaError(err: MetaErrorBody | null): string | null {
  if (!err) return null;
  const primary =
    err.error_user_msg || err.error_data?.details || err.message || 'Unknown Meta error';
  const title =
    err.error_user_title && !primary.includes(err.error_user_title)
      ? `${err.error_user_title} - `
      : '';
  const code =
    err.code !== undefined
      ? ` (code ${err.code}${err.error_subcode !== undefined ? `/${err.error_subcode}` : ''}${
          err.fbtrace_id ? `, trace ${err.fbtrace_id}` : ''
        })`
      : '';
  return `${title}${primary}${code}`;
}

/** The connect and token actions' copy (Reference `wabaErrorMessage`). */
export function translateConnectError(err: WabaApiError): string {
  if (err.status === 0) return err.message;
  if (err.missingBusinessManagement) {
    return 'The token is missing the whatsapp_business_management permission. Generate a new System User token with both whatsapp_business_messaging and whatsapp_business_management.';
  }
  const raw = (err.body as { error?: MetaErrorBody } | null)?.error?.message ?? err.message;
  if (err.code === 190) {
    if (err.subcode === 463)
      return 'The access token has expired. Generate a new permanent System User token.';
    if (err.subcode === 467)
      return 'The Meta session is no longer valid. Re-authorize and try again.';
    if (err.subcode === 460) return 'The Facebook password changed. Re-authorize and try again.';
    return `Meta rejected the token: ${raw}`;
  }
  if (err.code === 100) {
    return `Meta rejected a parameter: ${raw}. For Embedded Signup, check the app's Facebook Login settings and Config ID.`;
  }
  return `Meta error ${err.code ?? 'unknown'}${err.subcode ? `/${err.subcode}` : ''}: ${raw}`;
}

/** Number registration hints (TW-WABA-012). */
export function translateRegisterError(err: WabaApiError): string {
  const base = `(#${err.code ?? '?'}) ${err.userMessage ?? (err.body as { error?: MetaErrorBody } | null)?.error?.message ?? err.message}`;
  switch (err.code) {
    case 133005:
      return `${base}. The number already has a two-step-verification PIN: enter that exact PIN.`;
    case 133006:
      return `${base}. The number needs re-verification in Meta Business Suite first.`;
    case 133008:
    case 133009:
      return `${base}. Too many attempts: wait a few minutes and try again.`;
    case 100:
      return `${base}. The number may be managed by the WhatsApp Business app (coexistence): finish setup in Meta Business Suite; if sends still fail use Fix inbound or reconnect.`;
    default:
      return base;
  }
}

/** What to do about a failed send. Geta only branches on 131049; the rest is what the codes mean in Meta's docs. */
export type SendFailureKind =
  | 'frequency_capped' // 131049: the user got enough marketing today, try again later
  | 'rate_limited' // 130429 / 131057 / 131056 / 4 / 80007: slow down and retry
  | 'window_closed' // 131047: free-form outside the 24h window
  | 'opted_out' // 131050: the user stopped marketing from this business
  | 'undeliverable' // 131026: not a WhatsApp number / cannot receive
  | 'spam_limited' // 131048
  | 'template' // 132000-132016: template missing, paused, params mismatch
  | 'auth' // 190, 10, 200-299: the token or permissions: pause the number, not the message
  | 'not_registered' // 133010
  | 'transient'
  | 'permanent';

export function classifySendError(err: WabaApiError): SendFailureKind {
  const c = err.code;
  if (c === 131049) return 'frequency_capped';
  if (c === 130429 || c === 131057 || c === 131056 || c === 4 || c === 80007) return 'rate_limited';
  if (c === 131047) return 'window_closed';
  if (c === 131050) return 'opted_out';
  if (c === 131026) return 'undeliverable';
  if (c === 131048) return 'spam_limited';
  if (c === 133010) return 'not_registered';
  if (c !== null && c >= 132000 && c <= 132099) return 'template';
  if (c === 190 || c === 10 || (c !== null && c >= 200 && c <= 299)) return 'auth';
  if (err.retryable) return 'transient';
  return 'permanent';
}
