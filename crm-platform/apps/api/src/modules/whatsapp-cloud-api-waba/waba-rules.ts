import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Pure rules of the WhatsApp number domain: no database, no network. Everything that decides something lives here so a test
 * can pin it; the services only gather facts and apply the verdict.
 */

/** The path both Meta and Interakt are told to deliver to; one URL serves every workspace (the payload names the number). */
export const WEBHOOK_PATH = '/v2/public/webhooks/whatsapp';

/**
 * The callback URL registered with Meta/Interakt. It carries a platform secret in `?k=`: Interakt documents no body signature,
 * so the URL is what proves a POST came from whoever we registered it with. Meta-signed requests do not need it but may carry it.
 */
export function webhookUrl(publicBase: string | undefined | null, urlKey?: string): string | null {
  if (!publicBase) return null;
  const base = `${publicBase.replace(/\/+$/, '')}${WEBHOOK_PATH}`;
  return urlKey ? `${base}?k=${urlKey}` : base;
}

/** The `?k=` secret, derived from the credentials key so every instance agrees and nothing extra is stored. */
export function inboundUrlKey(credentialsKeyB64: string): string {
  return createHmac('sha256', Buffer.from(credentialsKeyB64, 'base64'))
    .update('waba-webhook-url-key')
    .digest('hex')
    .slice(0, 32);
}

export type WebhookAuthResult =
  { ok: true; via: 'signature' | 'url_key' } | { ok: false; reason: string };

/**
 * Who is calling. A valid body signature is proof; failing that, the secret in the URL we registered is. Both absent or both
 * wrong is a forged request. `requireSignature` closes the URL-key door for deployments whose BSP does sign.
 */
export function authenticateWebhook(input: {
  signatureHeader: string | undefined;
  /** True when the raw body verifies against any secret that could legitimately have signed it. */
  signatureValid: boolean;
  queryKey: string | undefined;
  expectedKey: string;
  requireSignature: boolean;
}): WebhookAuthResult {
  if (input.signatureHeader && input.signatureValid) return { ok: true, via: 'signature' };
  if (input.requireSignature)
    return { ok: false, reason: input.signatureHeader ? 'invalid signature' : 'missing signature' };
  if (input.queryKey && timingSafeEqualStr(input.queryKey, input.expectedKey))
    return { ok: true, via: 'url_key' };
  return { ok: false, reason: input.signatureHeader ? 'invalid signature' : 'missing signature' };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The verify token Meta echoes during the GET handshake. `WHATSAPP_VERIFY_TOKEN` when the operator set one; otherwise derived
 * from the credentials key, so every instance and every restart agree without a settings table to store it in (WaDesk
 * generated and persisted a random one; Meta verified subscriptions against it, so it must never change under a live number).
 */
export function verifyTokenFor(configured: string | undefined, credentialsKeyB64: string): string {
  if (configured && configured.trim()) return configured.trim();
  return createHmac('sha256', Buffer.from(credentialsKeyB64, 'base64'))
    .update('waba-webhook-verify-token')
    .digest('hex')
    .slice(0, 40);
}

/** A six-digit two-step-verification PIN (WaDesk `str_pad(random_int(0,999999),6,'0')`). */
export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** WaDesk strips non-digits from a typed PIN. */
export function cleanPin(raw: string | undefined | null): string | null {
  const digits = (raw ?? '').replace(/\D+/g, '');
  return digits.length === 6 ? digits : null;
}

/** On-Premises API numbers were shut down by Meta on 23 Oct 2025; they cannot send until registered on the Cloud API. */
export function isOnPremise(platformType: string | null | undefined): boolean {
  return (platformType ?? '').toUpperCase() === 'ON_PREMISE';
}

export function isCoexistence(platformType: string | null | undefined): boolean {
  const t = (platformType ?? '').toUpperCase();
  return t === 'COEXISTENCE' || t === 'SMB_APP';
}

/** `TIER_1K` to a number of conversations per day; unknown tiers read as the smallest, like Geta. */
const TIER_LIMITS: Record<string, number> = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,
  TIER_2K: 2_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: 1_000_000,
  UNLIMITED: 1_000_000,
};
export function tierLimit(tier: string | null | undefined): number {
  return TIER_LIMITS[(tier ?? '').toUpperCase()] ?? 250;
}

export function maskToken(token: string | null | undefined): string | null {
  if (!token) return null;
  return token.length <= 8 ? '••••' : `••••${token.slice(-4)}`;
}

// --- health (WD-WABA-021, 022) ---------------------------------------------------------------------------------------

export type HealthSeverity = 'ok' | 'warning' | 'error';

export interface HealthIssue {
  key: string;
  severity: Exclude<HealthSeverity, 'ok'>;
  title: string;
  solution: string;
}

export interface HealthFacts {
  status: string;
  hasToken: boolean;
  tokenExpiresAt: Date | null;
  platformType: string | null;
  qualityRating: string | null;
  nameStatus: string | null;
  codeVerificationStatus: string | null;
  inboundWired: boolean | null;
  /** True when the live read from Meta failed (token rejected or Meta unreachable). */
  liveReadFailed: boolean;
  liveReadError: string | null;
  /** The WABA node, when it could be read. */
  accountReviewStatus?: string | null;
  businessVerificationStatus?: string | null;
  /** Scopes the token holds; null = could not be inspected. */
  tokenScopes?: string[] | null;
  /** Apps subscribed to the WABA's webhooks; null = could not be read. */
  subscribedApps?: number | null;
  /** Meta's error code when the template list could not be read. */
  templatesErrorCode?: number | null;
}

const DAY_MS = 86_400_000;

/** The problems a number has, worst first, each with what to do (the health page's list). */
export function deriveHealth(
  f: HealthFacts,
  now: Date,
): { overall: HealthSeverity; issues: HealthIssue[] } {
  const issues: HealthIssue[] = [];
  const add = (i: HealthIssue) => issues.push(i);

  if (f.status === 'disconnected') {
    add({
      key: 'disconnected',
      severity: 'error',
      title: 'This number is disconnected',
      solution: 'Reconnect it with Embedded Signup or paste a fresh access token.',
    });
  }
  if (f.status !== 'disconnected' && !f.hasToken) {
    add({
      key: 'no_token',
      severity: 'error',
      title: 'No access token is stored',
      solution: "Paste this number's access token so sending and template sync work.",
    });
  }
  if (f.liveReadFailed) {
    add({
      key: 'meta_unreachable',
      severity: 'error',
      title: f.liveReadError ?? 'Meta did not accept the stored token',
      solution: 'Renew the token; if it was revoked or expired, reconnect the number.',
    });
  }
  if (isOnPremise(f.platformType)) {
    add({
      key: 'on_premise',
      severity: 'error',
      title: 'The number is not on the Cloud API',
      solution: 'Verify and register it on the Cloud API in WhatsApp Manager, then connect again.',
    });
  }
  if (f.tokenExpiresAt) {
    const left = f.tokenExpiresAt.getTime() - now.getTime();
    if (left <= 0)
      add({
        key: 'token_expired',
        severity: 'error',
        title: 'The access token has expired',
        solution: 'Renew the token or reconnect the number.',
      });
    else if (left < 7 * DAY_MS)
      add({
        key: 'token_expiring',
        severity: 'warning',
        title: 'The access token expires within 7 days',
        solution: 'Renew the token now.',
      });
  }
  const quality = (f.qualityRating ?? '').toUpperCase();
  if (quality === 'RED')
    add({
      key: 'quality_red',
      severity: 'error',
      title: 'Quality rating is low (red)',
      solution: 'Pause marketing to this number, review recent complaints and template content.',
    });
  else if (quality === 'YELLOW')
    add({
      key: 'quality_yellow',
      severity: 'warning',
      title: 'Quality rating is medium (yellow)',
      solution: 'Send fewer promotional messages and review blocked or reported conversations.',
    });
  const name = (f.nameStatus ?? '').toUpperCase();
  if (name === 'DECLINED')
    add({
      key: 'name_declined',
      severity: 'warning',
      title: 'The display name was declined',
      solution: "Submit a new display name that follows Meta's naming rules.",
    });
  if ((f.codeVerificationStatus ?? '').toUpperCase() === 'NOT_VERIFIED') {
    add({
      key: 'not_verified',
      severity: 'warning',
      title: 'The number is not verified',
      solution: 'Verify it in WhatsApp Manager.',
    });
  }
  const review = (f.accountReviewStatus ?? '').toUpperCase();
  if (review && review !== 'APPROVED') {
    add({
      key: 'account_review',
      severity: review === 'PENDING' ? 'warning' : 'error',
      title: `Account review: ${review}`,
      solution:
        'Check the account review status in Meta Business Suite and answer anything Meta asks.',
    });
  }
  const verification = (f.businessVerificationStatus ?? '').toLowerCase();
  if (verification && verification !== 'verified') {
    add({
      key: 'business_unverified',
      severity: 'warning',
      title: `Business verification: ${verification.replace(/_/g, ' ')}`,
      solution:
        'Verify the business in Meta Business Suite; an unverified business has a lower messaging limit.',
    });
  }
  if (f.tokenScopes) {
    const has = (s: string) => f.tokenScopes!.includes(s);
    if (!has('whatsapp_business_messaging'))
      add({
        key: 'scope_messaging',
        severity: 'error',
        title: 'The token cannot send messages (whatsapp_business_messaging is missing)',
        solution: 'Generate a new System User token with both WhatsApp scopes.',
      });
    else if (!has('whatsapp_business_management'))
      add({
        key: 'scope_management',
        severity: 'warning',
        title: 'The token cannot manage templates (whatsapp_business_management is missing)',
        solution:
          'Sending works, but template sync and creation are blocked. Generate a new token with both scopes.',
      });
  }
  if (f.subscribedApps === 0) {
    add({
      key: 'no_subscribed_app',
      severity: 'error',
      title: "No app is subscribed to this number's webhooks",
      solution:
        'Use Fix inbound; inbound messages and delivery statuses will not arrive until an app is subscribed.',
    });
  }
  if (f.templatesErrorCode === 3 || f.templatesErrorCode === 200 || f.templatesErrorCode === 10) {
    add({
      key: 'templates_unreadable',
      severity: 'warning',
      title: 'Templates cannot be read for this account',
      solution:
        f.templatesErrorCode === 10
          ? 'The WABA may have been removed or un-shared from the connected business. Reconnect it.'
          : 'The app lacks whatsapp_business_management (Advanced Access needs Meta App Review).',
    });
  }
  if (f.status === 'connected' && f.inboundWired === false) {
    add({
      key: 'inbound_not_wired',
      severity: 'warning',
      title: 'Incoming messages are not reaching this platform',
      solution: 'Use Fix inbound to re-subscribe; if it persists, reconnect the number.',
    });
  }

  const rank = { error: 0, warning: 1 } as const;
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const overall: HealthSeverity = issues.some((i) => i.severity === 'error')
    ? 'error'
    : issues.length
      ? 'warning'
      : 'ok';
  return { overall, issues };
}

// --- webhook routing -------------------------------------------------------------------------------------------------

export interface WebhookChange {
  wabaId: string;
  phoneNumberId: string | null;
  field: string;
  value: Record<string, unknown>;
  /** Epoch seconds from the entry. */
  time: number | null;
}

/** Splits a Meta envelope into one item per change, each carrying the ids that route it to a workspace. */
export function splitWebhook(payload: unknown): WebhookChange[] {
  const body = payload as {
    object?: string;
    entry?: Array<{
      id?: string;
      time?: number;
      changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
    }>;
  };
  if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return [];
  const out: WebhookChange[] = [];
  for (const entry of body.entry) {
    if (!entry?.id || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!change?.field || !change.value || typeof change.value !== 'object') continue;
      const metadata = change.value.metadata as { phone_number_id?: string } | undefined;
      out.push({
        wabaId: String(entry.id),
        phoneNumberId: metadata?.phone_number_id ? String(metadata.phone_number_id) : null,
        field: change.field,
        value: change.value,
        time: typeof entry.time === 'number' ? entry.time : null,
      });
    }
  }
  return out;
}

/** Fields the ingest worker acts on; every other field is acknowledged and dropped (Meta retries a 4xx/5xx for days). */
export const HANDLED_FIELDS = new Set([
  'messages',
  'message_template_status_update',
  'message_template_quality_update',
  'template_category_update',
  'message_template_components_update',
  'phone_number_quality_update',
  'phone_number_name_update',
  'account_update',
  'account_review_update',
  'flows',
]);
