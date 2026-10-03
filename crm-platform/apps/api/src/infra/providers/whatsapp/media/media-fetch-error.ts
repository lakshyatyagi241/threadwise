/**
 * Why a WhatsApp media transfer failed, in a vocabulary the inbox can show and the worker can act on.
 *
 * `retryable` is the only thing the media-fetch worker looks at to choose between "try again with backoff" and "stop and mark the file
 * failed". Every message here is safe to store on a message row and show to an agent: it never contains a token, a signed download
 * url or a header (see `redact`).
 */
export const MEDIA_FAILURE = {
  /** The channel has no usable access token (not connected, or the vault could not open it). */
  NO_CREDENTIALS: 'MEDIA_NO_CREDENTIALS',
  /** Meta refused our token (revoked or expired): a retry cannot fix it until the channel is reconnected. */
  AUTH: 'MEDIA_AUTH_FAILED',
  /** The media id is not (or no longer) on Meta's side: ids expire about 30 days after delivery. */
  EXPIRED: 'MEDIA_EXPIRED',
  /** Larger than the channel's limit for that kind, announced by Meta or noticed while streaming. */
  TOO_LARGE: 'MEDIA_TOO_LARGE',
  /** The bytes are a type the platform's upload policy refuses (a script behind an image mime, a blocked extension, ...). */
  REJECTED: 'MEDIA_REJECTED',
  /** The download address was refused by the SSRF guard (not https, not a Meta host, resolves to a private address, bad redirect). */
  URL_REJECTED: 'MEDIA_URL_REJECTED',
  /** The bytes did not match the sha256 Meta announced. Retried once or twice (a cut connection), then failed. */
  SHA256_MISMATCH: 'MEDIA_SHA256_MISMATCH',
  /** Transport trouble or a 5xx / 429 from Meta, a timeout, a connection cut half way. */
  DOWNLOAD_FAILED: 'MEDIA_DOWNLOAD_FAILED',
  /** Meta answered something we did not expect (a malformed lookup answer, a status we have no rule for). */
  UNEXPECTED: 'MEDIA_UNEXPECTED_RESPONSE',
} as const;
export type MediaFailureCode = (typeof MEDIA_FAILURE)[keyof typeof MEDIA_FAILURE];

export class MediaFetchError extends Error {
  constructor(
    readonly code: MediaFailureCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'MediaFetchError';
  }
}

/** Removes a secret (an access token) from text that may have been copied from a library error. Empty secrets are ignored. */
export function redact(text: string, ...secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  }
  // Whatever the secrets were, a bearer token never leaves in a message.
  return out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
}

/** A download url with its query and fragment cut off: the query of a Meta media url carries a signature, so logs get host and path only. */
export function safeUrlForLog(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[unparseable url]';
  }
}
