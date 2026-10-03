/**
 * Why an outbound message did not go, in plain language. The failure code on a message is either a Meta error code (`131047`) the
 * adapter classified, or a platform code (`AUTH_SEND_HALTED`); the provider's own `reason` text is kept as the fallback for a code
 * nobody has mapped. The wording lives in `messages/<locale>/channel-whatsapp-cloud.json` under `inbox.failure.<kind>`.
 */
export const FAILURE_KINDS = [
  'windowClosed',
  'undeliverable',
  'recipientNotAllowed',
  'rateLimit',
  'spamLimited',
  'engagementBlocked',
  'tokenExpired',
  'accountRestricted',
  'mediaRejected',
  'templateProblem',
  'providerDown',
  'sendPaused',
  'channelOff',
  'planLimit',
  'unknown',
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

/**
 * The codes the Meta adapter stores (`META_FAILURE` in the API's `meta-errors.ts`, which keeps Meta's own number in the reason
 * text), the platform's own, and Meta's bare numbers for a failure that was recorded before the adapter classified it.
 */
const BY_CODE: Record<string, FailureKind> = {
  // the 24 hour window
  SERVICE_WINDOW_CLOSED: 'windowClosed',
  '131047': 'windowClosed',
  // the recipient cannot be reached
  RECIPIENT_UNDELIVERABLE: 'undeliverable',
  '131026': 'undeliverable',
  RECIPIENT_NOT_ALLOWED: 'recipientNotAllowed',
  '131021': 'recipientNotAllowed',
  '131030': 'recipientNotAllowed',
  ECOSYSTEM_ENGAGEMENT_BLOCKED: 'engagementBlocked',
  '131049': 'engagementBlocked',
  // sending too fast, or too many reports against the number
  SPAM_RATE_LIMITED: 'spamLimited',
  '131048': 'spamLimited',
  PAIR_RATE_LIMITED: 'rateLimit',
  RATE_LIMITED: 'rateLimit',
  '131056': 'rateLimit',
  '130429': 'rateLimit',
  '80007': 'rateLimit',
  '4': 'rateLimit',
  '17': 'rateLimit',
  '613': 'rateLimit',
  // the access token or its permissions
  CHANNEL_AUTH_EXPIRED: 'tokenExpired',
  CHANNEL_PERMISSION_DENIED: 'tokenExpired',
  CHANNEL_CREDENTIALS_MISSING: 'tokenExpired',
  CHANNEL_NEEDS_REAUTH: 'tokenExpired',
  CHANNEL_TOKEN_EXPIRED: 'tokenExpired',
  '190': 'tokenExpired',
  '10': 'tokenExpired',
  '200': 'tokenExpired',
  '131005': 'tokenExpired',
  // the account itself
  CHANNEL_ACCOUNT_RESTRICTED: 'accountRestricted',
  NUMBER_NOT_REGISTERED: 'accountRestricted',
  PHONE_NUMBER_NOT_FOUND: 'accountRestricted',
  '131031': 'accountRestricted',
  '131042': 'accountRestricted',
  '133010': 'accountRestricted',
  // the file or the kind of message
  MEDIA_REJECTED: 'mediaRejected',
  UNSUPPORTED_MESSAGE_TYPE: 'mediaRejected',
  '131051': 'mediaRejected',
  '131052': 'mediaRejected',
  '131053': 'mediaRejected',
  // templates (the send screen is not built yet; the reasons still read)
  TEMPLATE_MISSING: 'templateProblem',
  TEMPLATE_PARAMS_INVALID: 'templateProblem',
  TEMPLATE_PAUSED: 'templateProblem',
  TEMPLATE_REJECTED: 'templateProblem',
  // Meta side
  PROVIDER_ERROR: 'providerDown',
  PROVIDER_UNREACHABLE: 'providerDown',
  PROVIDER_BAD_RESPONSE: 'providerDown',
  '131000': 'providerDown',
  '131016': 'providerDown',
  '131057': 'providerDown',
  // the platform
  AUTH_SEND_HALTED: 'sendPaused',
  CHANNEL_DISCONNECTED: 'channelOff',
  PLAN_LIMIT_REACHED: 'planLimit',
};

function lookupKey(code: string): string {
  const upper = code.trim().toUpperCase();
  const numeric = /^(?:META|WHATSAPP|WA|GRAPH)[_-]?(\d{1,6})$/.exec(upper);
  return numeric ? numeric[1]! : upper;
}

export function failureKind(code: string | null | undefined): FailureKind {
  if (!code) return 'unknown';
  return BY_CODE[lookupKey(code)] ?? 'unknown';
}

/** The failures the person fixes in the channel settings, not by editing the message: the reconnect link is offered with them. */
export const needsChannelFix = (kind: FailureKind): boolean =>
  kind === 'tokenExpired' || kind === 'accountRestricted' || kind === 'channelOff';

/**
 * What the thread shows under a failed bubble: the kind (which picks the wording) and the provider's own reason, kept so that an
 * unmapped code still says something and a mapped one can show the original as a tooltip for whoever has to look it up.
 * Provider text is shown as it came; it is data, not a key.
 */
export function describeFailure(failure: { code: string | null; reason: string | null } | null): {
  kind: FailureKind;
  reason: string | null;
} {
  return { kind: failureKind(failure?.code), reason: failure?.reason?.trim() || null };
}
