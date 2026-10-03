import type { ChannelHealth, ChannelHealthIssue } from '@crm/contracts';
import { ChannelError } from '../chat-conversations/channel.port';
import type {
  PhoneInfo,
  TokenInspection,
  WabaDetails,
} from '../whatsapp-cloud-api-waba/waba-admin.port';
import { META_FAILURE } from './meta-errors';

/**
 * What the live reads of a WhatsApp number say about whether it can send, as one snapshot with a sorted list of issues and one word
 * (`blocked`, `attention`, `healthy`). Pure: the adapter does the reads, this decides (Reference's WabaHealthService rules, TW-WABA-022).
 *
 * Every read is independent: one that fails leaves the others in the snapshot and adds its own issue. Nothing in an issue carries a
 * secret (the messages come from Meta's error text, already scrubbed). The reads themselves are the WABA domain's (`WabaAdminPort`),
 * so the inbox and the WhatsApp numbers page look at the same Meta nodes.
 */
export type Read<T> = { ok: true; value: T } | { ok: false; error: ChannelError };

export interface HealthInputs {
  now: Date;
  phone: Read<PhoneInfo>;
  /** null: no account id stored, so the account and the subscription were not asked. */
  waba: Read<WabaDetails> | null;
  /** Names of the apps subscribed to the account's webhooks. */
  subscribedApps: Read<string[]> | null;
  /** null: no token to inspect (an Interakt number holds the partner key, not a Meta token), or the platform has no Meta app. */
  token: Read<TokenInspection> | null;
}

const WEEK_MS = 7 * 24 * 3_600_000;

export interface HealthVerdict {
  health: ChannelHealth;
  /** Meta refused the access token (or the permission it needs): a person must paste a new one. */
  needsReauth: boolean;
  /** The provider refused the PLATFORM's credential: nothing the customer can fix. */
  providerFault: boolean;
}

const ORDER = { critical: 0, warning: 1, info: 2 } as const;

function issue(
  severity: ChannelHealthIssue['severity'],
  code: string,
  title: string,
  detail: string | null = null,
): ChannelHealthIssue {
  return { severity, code, title, detail };
}

export function buildHealth(input: HealthInputs): HealthVerdict {
  const issues: ChannelHealthIssue[] = [];
  let needsReauth = false;
  let providerFault = false;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;
  const fail = (e: ChannelError, title: string) => {
    issues.push(issue('critical', e.code, title, e.message));
    errorCode ??= e.code;
    errorMessage ??= e.message;
    if (e.needsReauth) needsReauth = true;
    if (e.providerFault) providerFault = true;
  };

  // --- the number ------------------------------------------------------------------------------------------------------------
  const phone = input.phone.ok ? input.phone.value : null;
  if (!input.phone.ok) {
    const e = input.phone.error;
    fail(
      e,
      e.needsReauth
        ? 'Meta does not accept the access token'
        : e.code === META_FAILURE.PHONE_NUMBER_NOT_FOUND
          ? 'Meta does not know this phone number id'
          : 'The phone number could not be read from Meta',
    );
  } else {
    const p = input.phone.value;
    const status = p.status ?? null;
    if (status && ['BANNED', 'DELETED', 'MIGRATED', 'RESTRICTED'].includes(status)) {
      issues.push(issue('critical', `NUMBER_${status}`, `The number is ${status.toLowerCase()}`));
    } else if (status && ['FLAGGED', 'PENDING', 'RATE_LIMITED'].includes(status)) {
      issues.push(
        issue(
          'warning',
          `NUMBER_${status}`,
          `The number is ${status.toLowerCase().replace('_', ' ')}`,
        ),
      );
    }
    if (p.qualityRating === 'RED') {
      issues.push(
        issue(
          'warning',
          'QUALITY_RED',
          'Message quality is low',
          'Meta may limit how many customers you can message.',
        ),
      );
    } else if (p.qualityRating === 'YELLOW') {
      issues.push(issue('info', 'QUALITY_YELLOW', 'Message quality is medium'));
    }
    if (p.platformType === 'ON_PREMISE') {
      issues.push(
        issue(
          'critical',
          'ON_PREMISE_NUMBER',
          'The number is still on the retired On-Premises API',
          'Verify and register it on the Cloud API in WhatsApp Manager, then connect again.',
        ),
      );
    }
    if (p.codeVerificationStatus && p.codeVerificationStatus !== 'VERIFIED') {
      issues.push(
        issue(
          'warning',
          'NUMBER_NOT_VERIFIED',
          'The number is not verified',
          p.codeVerificationStatus,
        ),
      );
    }
  }

  // --- the account -----------------------------------------------------------------------------------------------------------
  if (input.waba) {
    if (!input.waba.ok) {
      const e = input.waba.error;
      issues.push(
        issue(
          'warning',
          'ACCOUNT_UNREADABLE',
          'The WhatsApp Business Account could not be read',
          e.providerCode === '10'
            ? 'The account was removed or un-shared from this token, or the app is not a provider for it.'
            : e.message,
        ),
      );
      if (e.needsReauth && e.providerCode !== '10') needsReauth = true;
    } else {
      const w = input.waba.value;
      const review = w.accountReviewStatus;
      if (review && review !== 'APPROVED') {
        issues.push(
          issue(
            review === 'PENDING' ? 'warning' : 'critical',
            'ACCOUNT_REVIEW',
            `Account review: ${review}`,
          ),
        );
      }
      const biz = w.businessVerificationStatus;
      if (biz && biz.toLowerCase() !== 'verified') {
        issues.push(
          issue(
            'warning',
            'BUSINESS_NOT_VERIFIED',
            `Business verification: ${biz}`,
            'Unverified businesses have lower messaging limits.',
          ),
        );
      }
    }
  } else {
    issues.push(
      issue(
        'info',
        'NO_ACCOUNT_ID',
        'No WhatsApp Business Account id stored',
        'Add it to check the webhook subscription and the account.',
      ),
    );
  }

  // --- the webhook subscription ------------------------------------------------------------------------------------------------
  let subscribed: boolean | null = null;
  if (input.subscribedApps?.ok) {
    subscribed = input.subscribedApps.value.length > 0;
    if (!subscribed) {
      issues.push(
        issue(
          'critical',
          'NO_WEBHOOK_SUBSCRIPTION',
          'No app is subscribed to this account',
          'Inbound messages and delivery receipts will not reach the inbox. Use Subscribe.',
        ),
      );
    }
  } else if (input.subscribedApps && !input.subscribedApps.ok) {
    issues.push(
      issue(
        'warning',
        'SUBSCRIPTION_UNREADABLE',
        'The webhook subscription could not be read',
        input.subscribedApps.error.message,
      ),
    );
  }

  // --- the token itself ------------------------------------------------------------------------------------------------------
  let token: ChannelHealth['token'] = { valid: null, expiresAt: null, scopes: null };
  if (input.token?.ok) {
    const t = input.token.value;
    const expiresMs = t.expiresAt ? t.expiresAt.getTime() : null;
    token = {
      valid: t.isValid,
      expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
      scopes: t.scopes,
    };
    if (!t.isValid) {
      issues.push(issue('critical', 'TOKEN_INVALID', 'The access token is no longer valid'));
      needsReauth = true;
      errorCode ??= META_FAILURE.AUTH_EXPIRED;
      errorMessage ??= 'The access token is no longer valid.';
    } else if (expiresMs !== null) {
      const left = expiresMs - input.now.getTime();
      if (left <= 0) {
        issues.push(issue('critical', 'TOKEN_EXPIRED', 'The access token has expired'));
        needsReauth = true;
      } else if (left < WEEK_MS) {
        issues.push(
          issue(
            'warning',
            'TOKEN_EXPIRING',
            'The access token expires within 7 days',
            `Expires ${new Date(expiresMs).toISOString()}. Use a permanent System User token.`,
          ),
        );
      }
    }
    if (t.scopes.length > 0) {
      if (!t.scopes.includes('whatsapp_business_messaging')) {
        issues.push(
          issue(
            'critical',
            'TOKEN_SCOPE_MISSING',
            'The token cannot send messages',
            'It lacks whatsapp_business_messaging.',
          ),
        );
      }
      if (!t.scopes.includes('whatsapp_business_management')) {
        issues.push(
          issue(
            'warning',
            'TOKEN_MANAGEMENT_SCOPE_MISSING',
            'The token cannot manage the account',
            'It lacks whatsapp_business_management (needed to subscribe webhooks and sync templates).',
          ),
        );
      }
    }
  } else if (input.token && !input.token.ok) {
    issues.push(
      issue(
        'info',
        'TOKEN_NOT_INSPECTED',
        'The token could not be inspected',
        input.token.error.message,
      ),
    );
  }

  issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const critical = issues.find((i) => i.severity === 'critical');
  if (critical) {
    errorCode ??= critical.code;
    errorMessage ??= critical.detail ?? critical.title;
  }
  const overall = critical
    ? 'blocked'
    : issues.some((i) => i.severity === 'warning')
      ? 'attention'
      : 'healthy';

  return {
    needsReauth,
    providerFault,
    health: {
      ok: phone !== null && !critical,
      overall,
      checkedAt: input.now.toISOString(),
      displayName: phone?.verifiedName ?? null,
      displayPhoneNumber: phone?.displayPhoneNumber ?? null,
      qualityRating: phone?.qualityRating ?? null,
      messagingLimitTier: phone?.messagingLimitTier ?? null,
      phoneStatus: phone?.status ?? null,
      codeVerificationStatus: phone?.codeVerificationStatus ?? null,
      nameStatus: phone?.nameStatus ?? null,
      platformType: phone?.platformType ?? null,
      token,
      webhook: { subscribed },
      issues,
      errorCode: critical || !input.phone.ok ? errorCode : null,
      errorMessage: critical || !input.phone.ok ? errorMessage : null,
    },
  };
}
