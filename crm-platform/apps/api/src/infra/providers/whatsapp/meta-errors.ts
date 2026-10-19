import { ChannelError } from '../chat-conversations/channel.port';
import { WabaApiError } from '../whatsapp-cloud-api-waba/waba-errors';

/**
 * What a Graph API failure means for us, as data: a table from Meta's error codes to a decision (our stable code, retry or not,
 * how long to wait, whether the credentials are the problem). One table so the rules are read in one place and tested row by row.
 *
 * Meta's codes come from its "Cloud API error codes" reference (the WhatsApp messaging, rate-limit, template, registration and
 * authorization families). Nothing here was exercised against a live account: the unit tests feed it recorded error bodies.
 *
 * Our `code` is what lands in `messages.failure_code` and is what the web translates, so it is stable and provider-neutral where a
 * neutral word exists (`SERVICE_WINDOW_CLOSED` is the platform's own code). The provider's number is kept in `providerCode` and in the
 * reason text (`#131047`), so support can look it up.
 */
export const META_FAILURE = {
  /** Meta 131047: more than 24 hours since the customer's last message; only a template is allowed. */
  WINDOW_CLOSED: 'SERVICE_WINDOW_CLOSED',
  /** Meta 131026: the number is not on WhatsApp, or the customer has not accepted the new terms, or the message cannot be delivered. */
  UNDELIVERABLE: 'RECIPIENT_UNDELIVERABLE',
  /** Meta 131021 / 131030 / 131009 on the recipient: the number is not one we may send to (the sender itself, not on the test list). */
  RECIPIENT_REFUSED: 'RECIPIENT_NOT_ALLOWED',
  /** Meta 131048: too many of our messages were flagged as spam; sending from this number is throttled for a while. */
  SPAM_RATE_LIMITED: 'SPAM_RATE_LIMITED',
  /** Meta 131056: too many messages to the same customer in a short time. */
  PAIR_RATE_LIMITED: 'PAIR_RATE_LIMITED',
  /** Meta 130429 / 131057 / 80007 / 4 / 17 / 32 / 613: throughput or API rate limits (131057: a throughput upgrade is in progress). */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Meta 131049: Meta chose not to deliver this message to protect the customer experience (mostly marketing). */
  ENGAGEMENT_BLOCKED: 'ECOSYSTEM_ENGAGEMENT_BLOCKED',
  /** Meta 190 / 102 / 463 / 467 / 460: the access token expired, was revoked or the session is invalid. */
  AUTH_EXPIRED: 'CHANNEL_AUTH_EXPIRED',
  /** Meta 10 / 200-299 / 131005: the token lacks a permission (whatsapp_business_messaging / _management) or access to the number. */
  PERMISSION_DENIED: 'CHANNEL_PERMISSION_DENIED',
  /** Meta 368 / 131031 / 131045: the account is restricted, locked, or its number is not registered/certified. */
  ACCOUNT_RESTRICTED: 'CHANNEL_ACCOUNT_RESTRICTED',
  NUMBER_NOT_REGISTERED: 'NUMBER_NOT_REGISTERED',
  /** Meta 33 / 100 on the phone number: the phone number id does not exist or is not reachable with this token. */
  PHONE_NUMBER_NOT_FOUND: 'PHONE_NUMBER_NOT_FOUND',
  TEMPLATE_MISSING: 'TEMPLATE_MISSING',
  TEMPLATE_PARAMS_INVALID: 'TEMPLATE_PARAMS_INVALID',
  TEMPLATE_PAUSED: 'TEMPLATE_PAUSED',
  TEMPLATE_REJECTED: 'TEMPLATE_REJECTED',
  UNSUPPORTED_MESSAGE: 'UNSUPPORTED_MESSAGE_TYPE',
  MEDIA_REJECTED: 'MEDIA_REJECTED',
  /** The request itself was refused as malformed (Meta 100, 131008, 131009, 131051, 135000). */
  REQUEST_INVALID: 'PROVIDER_REQUEST_INVALID',
  /** HTTP 5xx and Meta's own transient codes (1, 2, 131000, 131016). */
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  /** The connection failed before anything was sent: safe to try again. */
  PROVIDER_UNREACHABLE: 'PROVIDER_UNREACHABLE',
  /** The request may have been accepted although no answer came back (timeout, reset, unreadable 200): never resent by itself. */
  OUTCOME_UNKNOWN: 'PROVIDER_OUTCOME_UNKNOWN',
  /** Any other 4xx the table has no row for. */
  PROVIDER_REJECTED: 'PROVIDER_REJECTED',
  /** Meta accepted the call but the answer had no message id: it may or may not have sent, so it is not retried. */
  BAD_RESPONSE: 'PROVIDER_BAD_RESPONSE',
  NO_CREDENTIALS: 'CHANNEL_CREDENTIALS_MISSING',
} as const;

const MIN = 60_000;

interface Rule {
  /** Meta error codes this row covers. */
  codes: readonly number[];
  /** Optional `error_subcode` values that narrow the row; empty = any. */
  subcodes?: readonly number[];
  code: string;
  retryable: boolean;
  /** How long to wait before the next attempt, for a retryable row. */
  retryAfterMs?: number;
  needsReauth?: boolean;
  /** Our sentence, used when Meta's own is no more specific. */
  reason: string;
}

/** First match wins: the narrower rows (with subcodes) come first. */
export const META_ERROR_RULES: readonly Rule[] = [
  // --- the token --------------------------------------------------------------------------------------------------------------
  {
    codes: [190],
    subcodes: [463],
    code: META_FAILURE.AUTH_EXPIRED,
    retryable: false,
    needsReauth: true,
    reason:
      'The WhatsApp access token has expired. Generate a new permanent System User token and paste it.',
  },
  {
    codes: [190],
    subcodes: [467],
    code: META_FAILURE.AUTH_EXPIRED,
    retryable: false,
    needsReauth: true,
    reason: 'The WhatsApp access token session is no longer valid. Reconnect with a new token.',
  },
  {
    codes: [190],
    subcodes: [460],
    code: META_FAILURE.AUTH_EXPIRED,
    retryable: false,
    needsReauth: true,
    reason:
      'The Facebook password changed, which invalidated the token. Reconnect with a new token.',
  },
  {
    codes: [190, 102],
    code: META_FAILURE.AUTH_EXPIRED,
    retryable: false,
    needsReauth: true,
    reason: 'Meta no longer accepts the WhatsApp access token. Reconnect with a new token.',
  },
  {
    codes: [10, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 299, 131005],
    code: META_FAILURE.PERMISSION_DENIED,
    retryable: false,
    needsReauth: true,
    reason:
      'The token lacks a permission. Generate a token with whatsapp_business_messaging and whatsapp_business_management and paste it.',
  },
  // --- the 24 hour rule and the recipient --------------------------------------------------------------------------------------
  {
    codes: [131047],
    code: META_FAILURE.WINDOW_CLOSED,
    retryable: false,
    reason:
      'More than 24 hours have passed since the customer last wrote. Send an approved template instead.',
  },
  {
    codes: [131026],
    code: META_FAILURE.UNDELIVERABLE,
    retryable: false,
    reason:
      'The message could not be delivered: the number is not on WhatsApp, or the customer cannot receive it.',
  },
  {
    codes: [131021, 131030],
    code: META_FAILURE.RECIPIENT_REFUSED,
    retryable: false,
    reason:
      'This number cannot be messaged from this account (it is the sender, or not on the test recipient list).',
  },
  {
    codes: [131049],
    code: META_FAILURE.ENGAGEMENT_BLOCKED,
    retryable: false,
    reason: 'Meta did not deliver this message to keep the customer experience healthy.',
  },
  // --- rate limits (retry later) -----------------------------------------------------------------------------------------------
  {
    codes: [131048],
    code: META_FAILURE.SPAM_RATE_LIMITED,
    retryable: true,
    retryAfterMs: 15 * MIN,
    reason:
      'Sending is limited for a while because too many recent messages were reported as spam.',
  },
  {
    codes: [131056],
    code: META_FAILURE.PAIR_RATE_LIMITED,
    retryable: true,
    retryAfterMs: 1 * MIN,
    reason: 'Too many messages to this customer in a short time. Retrying shortly.',
  },
  {
    codes: [130429],
    code: META_FAILURE.RATE_LIMITED,
    retryable: true,
    retryAfterMs: 10_000,
    reason: 'The number reached its message throughput. Retrying shortly.',
  },
  {
    codes: [80007],
    code: META_FAILURE.RATE_LIMITED,
    retryable: true,
    retryAfterMs: 1 * MIN,
    reason: 'The WhatsApp account reached its API rate limit. Retrying shortly.',
  },
  {
    codes: [4, 17, 32, 613],
    code: META_FAILURE.RATE_LIMITED,
    retryable: true,
    retryAfterMs: 5 * MIN,
    reason: 'The Meta app reached its API rate limit. Retrying later.',
  },
  // --- the account -------------------------------------------------------------------------------------------------------------
  {
    codes: [368, 131031],
    code: META_FAILURE.ACCOUNT_RESTRICTED,
    retryable: false,
    reason:
      'The WhatsApp account is restricted or locked by Meta. Check the account in WhatsApp Manager.',
  },
  {
    codes: [131045, 133010, 133004, 133005, 133006, 133008, 133009, 133015, 133016],
    code: META_FAILURE.NUMBER_NOT_REGISTERED,
    retryable: false,
    reason: 'The phone number is not registered on the Cloud API. Register it in WhatsApp Manager.',
  },
  {
    codes: [33, 100],
    subcodes: [33],
    code: META_FAILURE.PHONE_NUMBER_NOT_FOUND,
    retryable: false,
    reason: 'Meta does not know this phone number id, or the token cannot see it.',
  },
  {
    codes: [33],
    code: META_FAILURE.PHONE_NUMBER_NOT_FOUND,
    retryable: false,
    reason: 'Meta does not know this phone number id, or the token cannot see it.',
  },
  // --- templates ---------------------------------------------------------------------------------------------------------------
  {
    codes: [132001],
    code: META_FAILURE.TEMPLATE_MISSING,
    retryable: false,
    reason: 'The template does not exist in this language on this account.',
  },
  {
    codes: [132000, 132012],
    code: META_FAILURE.TEMPLATE_PARAMS_INVALID,
    retryable: false,
    reason: 'The template variables do not match what the approved template expects.',
  },
  {
    codes: [132015, 132016],
    code: META_FAILURE.TEMPLATE_PAUSED,
    retryable: false,
    reason: 'The template is paused or disabled because of its quality.',
  },
  {
    codes: [132005, 132007, 132068, 132069],
    code: META_FAILURE.TEMPLATE_REJECTED,
    retryable: false,
    reason: 'Meta refused the template content.',
  },
  // --- the content -------------------------------------------------------------------------------------------------------------
  {
    codes: [131051],
    code: META_FAILURE.UNSUPPORTED_MESSAGE,
    retryable: false,
    reason: 'WhatsApp does not support this message type.',
  },
  {
    codes: [131052, 131053],
    code: META_FAILURE.MEDIA_REJECTED,
    retryable: false,
    reason: 'Meta could not use the media file (download, upload or unsupported type).',
  },
  {
    codes: [131008, 131009, 135000, 100],
    code: META_FAILURE.REQUEST_INVALID,
    retryable: false,
    reason: 'Meta refused the request as malformed.',
  },
  {
    // Meta is raising the number's throughput and the number is unusable for up to a minute (a THROUGHPUT_UPGRADE webhook follows).
    codes: [131057],
    code: META_FAILURE.RATE_LIMITED,
    retryable: true,
    retryAfterMs: 65_000,
    reason:
      'The number is being upgraded to higher throughput and cannot send for up to a minute. Retrying.',
  },
  // --- Meta's own transient failures -------------------------------------------------------------------------------------------
  {
    codes: [1, 2, 131000, 131016],
    code: META_FAILURE.PROVIDER_ERROR,
    retryable: true,
    retryAfterMs: 30_000,
    reason: 'Meta had a temporary problem. Retrying.',
  },
];

/** The retry hint is never allowed to exceed this: a stuck message must come back to a person within an hour. */
export const MAX_RETRY_AFTER_MS = 60 * MIN;

interface MetaErrorBody {
  message?: unknown;
  type?: unknown;
  code?: unknown;
  error_subcode?: unknown;
  is_transient?: unknown;
  error_user_title?: unknown;
  error_user_msg?: unknown;
  fbtrace_id?: unknown;
  error_data?: { details?: unknown };
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Removes every secret from text that came from outside before it can reach a log, a message row or a screen. */
export function scrub(text: string, secrets: readonly (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  return out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/EAA[A-Za-z0-9]{20,}/g, '[redacted]');
}

/**
 * The sentence an agent reads: Meta's own words when it is specific (`error_user_msg`, then `error_data.details`, then `message`),
 * with the title in front when it adds information, and the code and trace id behind (Reference's `MetaError::describe`).
 */
export function describeMetaError(
  error: MetaErrorBody | undefined,
  secrets: readonly (string | undefined)[] = [],
): string {
  if (!error) return 'Unknown Meta error';
  const primary =
    str(error.error_user_msg) ??
    str(error.error_data?.details) ??
    str(error.message) ??
    'Unknown Meta error';
  const title = str(error.error_user_title);
  const lead =
    title && !primary.toLowerCase().includes(title.toLowerCase())
      ? `${title} - ${primary}`
      : primary;
  const code = num(error.code);
  const sub = num(error.error_subcode);
  const trace = str(error.fbtrace_id);
  const tail = [
    code !== null ? `#${code}${sub !== null ? `/${sub}` : ''}` : null,
    trace ? `trace ${trace}` : null,
  ]
    .filter(Boolean)
    .join(', ');
  return scrub(tail ? `${lead} (${tail})` : lead, secrets).slice(0, 480);
}

export interface ClassifiedFailure {
  code: string;
  retryable: boolean;
  needsReauth: boolean;
  retryAfterMs: number | null;
  providerCode: string | null;
  /** Our sentence, the generic one for the row. */
  reason: string;
}

/**
 * Meta error code (and optional subcode) to a decision; `null` when the table has no row. Also used for the `errors` of a failed
 * delivery status, which carry the same codes.
 */
export function classifyMetaCode(
  code: number | null,
  subcode: number | null = null,
): ClassifiedFailure | null {
  if (code === null) return null;
  const rule = META_ERROR_RULES.find(
    (r) =>
      r.codes.includes(code) && (!r.subcodes || (subcode !== null && r.subcodes.includes(subcode))),
  );
  if (!rule) return null;
  return {
    code: rule.code,
    retryable: rule.retryable,
    needsReauth: rule.needsReauth ?? false,
    retryAfterMs: rule.retryable ? Math.min(rule.retryAfterMs ?? 30_000, MAX_RETRY_AFTER_MS) : null,
    providerCode: String(code),
    reason: rule.reason,
  };
}

/**
 * A failed call through `WabaHttp` as the `ChannelError` the dispatch worker acts on. `WabaHttp` has already turned the answer into a
 * `WabaApiError` (HTTP status, Meta's code and subcode, the decoded body); this is the table lookup that gives it our vocabulary.
 *
 * Order of decisions: (1) Meta's own code through the table; (2) Meta saying the failure is transient; (3) the HTTP status
 * (401 and 403 are about the token, 429 and 5xx are worth another try, other 4xx are not). The reason carries Meta's words
 * (`describeMetaError`) because they are usually more specific than ours; the access token is scrubbed out of it. A connection that
 * failed before any answer (status 0) is retryable only when it provably never left (refused, unresolved name); a timeout or reset is `OUTCOME_UNKNOWN`.
 */
export function metaFailure(
  err: WabaApiError,
  secrets: readonly (string | undefined)[] = [],
): ChannelError {
  if (err.status === 0 && err.outcomeMayHaveCommitted) {
    return new ChannelError(
      META_FAILURE.OUTCOME_UNKNOWN,
      `${scrub(err.message, secrets)}. The message may still have been delivered: check the conversation before sending it again.`,
      false,
      { outcomeMayHaveCommitted: true },
    );
  }
  if (err.status === 0) {
    return new ChannelError(META_FAILURE.PROVIDER_UNREACHABLE, scrub(err.message, secrets), true, {
      retryAfterMs: 10_000,
    });
  }
  const error = (err.body as { error?: MetaErrorBody } | null)?.error;
  const code = num(error?.code) ?? err.code;
  const sub = num(error?.error_subcode) ?? err.subcode;
  const meta = describeMetaError(error ?? { message: err.message }, secrets);

  const row = classifyMetaCode(code, sub);
  if (row) {
    return new ChannelError(row.code, `${meta}`, row.retryable, {
      needsReauth: row.needsReauth,
      // The platform's own limiter knows exactly how long a turn takes; Meta's table value is the fallback.
      retryAfterMs: err.retryAfterMs ?? row.retryAfterMs,
      providerCode: row.providerCode,
    });
  }
  const providerCode = code !== null ? String(code) : String(err.status);
  if (error?.is_transient === true || err.transient || err.status === 429 || err.status >= 500) {
    return new ChannelError(
      err.status === 429 ? META_FAILURE.RATE_LIMITED : META_FAILURE.PROVIDER_ERROR,
      meta,
      true,
      { retryAfterMs: err.status === 429 ? MIN : 30_000, providerCode },
    );
  }
  if (err.status === 401 || err.status === 403) {
    return new ChannelError(META_FAILURE.AUTH_EXPIRED, meta, false, {
      needsReauth: true,
      providerCode,
    });
  }
  return new ChannelError(META_FAILURE.PROVIDER_REJECTED, meta, false, { providerCode });
}
