import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ERROR_CODES, type SecurityPolicy } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { AuthAuditService } from './auth-audit.service';
import { EmergencyHaltService } from './emergency-halt.service';
import { AuthKeys } from '../support/redis-keys';

export type ScreenReason =
  | 'link_count'
  | 'scam_pattern'
  | 'finance_terms'
  | 'short_link'
  | 'keyword'
  | 'rate_per_minute'
  | 'rate_per_day';

export interface ScreenContext {
  /** 'inbox' | 'broadcast' | 'scheduled' | ...: recorded with the decision. */
  source?: string;
}

/** Every scheme marker counts, even two links with no space between them. */
const LINK_MARKER = /https?:\/\//gi;

/**
 * Phrases typical of phishing and prize scams, written as patterns over the
 * lower-cased message. Each one stands for a family of wordings, not one
 * sentence: "account is / has been / was suspended / locked / blocked /
 * deactivated", "click (here) to confirm / verify / claim / reactivate / unlock",
 * "KYC ... required / pending / update", and so on. Extend with the keyword list.
 */
const SCAM = [
  /\byou(?:'?ve|\s+have|\s+ve)?\s+(?:won|been\s+selected)\b/,
  /\bcongratulations\b[^\n]{0,24}\b(?:won|selected|winner)\b/,
  /\bclaim\s+(?:your\s+)?(?:prize|reward|gift)\b/,
  /\bverify\s+(?:your\s+)?account\b/,
  /\baccount\s+(?:is\s+|has\s+been\s+|was\s+)?(?:suspended|locked|blocked|deactivated)\b/,
  /\bclick\s+(?:here\s+)?to\s+(?:confirm|verify|claim|reactivate|unlock)\b/,
  /\burgent\b[^\n]{0,24}\baction\s+required\b/,
  /\bkyc\b[^\n]{0,24}\b(?:required|pending|update)\b/,
  /\b(?:update|complete)\s+(?:your\s+)?kyc\b/,
  /\b(?:double|triple)\s+your\s+(?:money|investment)\b/,
  /\brisk[- ]free\s+(?:profits?|returns?)\b/,
];

/** Restricted financial phrasing, phrase-based so legitimate fintech copy is not flagged by one word. */
const FINANCE = [
  /\bguaranteed\s+(?:returns?|profits?|income)\b/,
  /\bbinary\s+options?\b/,
  /\bforex\s+(?:signals?|trading|tips)\b/,
  /\bcrypto(?:currency)?\s+(?:investment|doubling|signals?|giveaway)\b/,
  /\bloan\s+(?:approved|offer)\b/,
  /\binstant\s+(?:personal\s+)?loan\b/,
  /\binterest[- ]free\s+loan\b/,
  /\bearn\b[^\n]{0,18}\b(?:per\s+day|a\s+day|daily|weekly)\b/,
  /\binvestment\s+opportunity\b/,
  /\bget\s+rich\s+quick\b/,
];

/**
 * Link shorteners. Matched ANYWHERE in the text on word boundaries, the way
 * the reference does: a link with no scheme ("visit bit.ly/x") and a subdomain
 * ("go.bit.ly/x") are shortened links too. A longer word that merely ends the
 * same way ("habit.ly") is not.
 */
const SHORTENER_DOMAINS = [
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'rb.gy',
  'shorturl.at',
  'tiny.cc',
  'bit.do',
  'soo.gd',
  'clck.ru',
  't2m.io',
  'shorte.st',
  'adf.ly',
  'short.io',
];
const SHORT_LINK = new RegExp(
  `\\b(?:${SHORTENER_DOMAINS.map((d) => d.replace(/\./g, '\\.')).join('|')})\\b`,
);

export function evaluateContent(body: string, policy: SecurityPolicy): ScreenReason | null {
  const text = body.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (policy.waHoldOnLinksCount > 0) {
    const links = text.match(LINK_MARKER)?.length ?? 0;
    if (links > policy.waHoldOnLinksCount) return 'link_count';
  }
  if (policy.waHoldOnScamPattern && SCAM.some((re) => re.test(lower))) return 'scam_pattern';
  if (policy.abuseBlockFinanceTerms && FINANCE.some((re) => re.test(lower))) return 'finance_terms';
  if (policy.abuseBlockShortLinks && SHORT_LINK.test(lower)) return 'short_link';
  if (policy.abuseBlockKeywordList.some((k) => k && lower.includes(k.toLowerCase())))
    return 'keyword';
  return null;
}

const COUNT_UNLESS_AT_CAP = `
local used = tonumber(redis.call('GET', KEYS[1]) or '0')
if used >= tonumber(ARGV[1]) then return 1 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 0
`;

/** Calendar-bucket stamps: minute `YYYYMMDDHHmm`, day `YYYYMMDD`, UTC. */
const stamp = (d: Date, len: 12 | 8): string => d.toISOString().replace(/[-:T]/g, '').slice(0, len);

/**
 * Pre-send screen for outbound messages (WD-AUTH-041): per-organization rate
 * caps and content filters in one of three modes (off, monitor, enforce).
 *
 * To be called from the shared outbound pipeline (inbox, broadcast, scheduled,
 * flows). The emergency halt is always checked first, in every mode, and for
 * bulk screens too (WaDesk's bulk path skipped it). Everything else fails open:
 * a bug in a content check must not stop all messaging.
 */
@Injectable()
export class SendPolicyService {
  private readonly logger = new Logger(SendPolicyService.name);

  constructor(
    private readonly policy: SecurityPolicyService,
    private readonly halt: EmergencyHaltService,
    private readonly audit: AuthAuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** One-to-one send: halt, then content, then rate caps. */
  async screen(orgId: number, body: string, context: ScreenContext = {}): Promise<void> {
    await this.halt.assertNotHalted();
    try {
      const policy = await this.policy.policy();
      if (policy.waGuardrailsMode === 'off') return;

      const reason = evaluateContent(body, policy) ?? (await this.checkRates(orgId, policy));
      if (reason) await this.decide(orgId, policy, reason, context);
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.warn({ err }, 'send screen failed open');
    }
  }

  /** Bulk send (campaign, broadcast, scheduled): halt and content once per batch, no rate caps. */
  async screenBulk(orgId: number, body: string, context: ScreenContext = {}): Promise<void> {
    await this.halt.assertNotHalted();
    try {
      const policy = await this.policy.policy();
      if (policy.waGuardrailsMode === 'off') return;
      const reason = evaluateContent(body, policy);
      if (reason) await this.decide(orgId, policy, reason, context);
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.warn({ err }, 'bulk send screen failed open');
    }
  }

  /**
   * A check at or over the cap returns the violation without counting; one
   * under it counts. Windows are fixed calendar buckets, not sliding. The
   * read-compare-increment is ONE script, so two sends racing at cap-1 cannot
   * both pass. As in the reference, the minute counter has already moved when
   * the day cap then refuses.
   */
  private async checkRates(orgId: number, policy: SecurityPolicy): Promise<ScreenReason | null> {
    const now = new Date();
    if (policy.waMaxSendsPerMinute > 0) {
      const key = AuthKeys.sendMinute(orgId, stamp(now, 12));
      if (await this.countAgainst(key, policy.waMaxSendsPerMinute, 120)) return 'rate_per_minute';
    }
    if (policy.waMaxSendsPerDay > 0) {
      const key = AuthKeys.sendDay(orgId, stamp(now, 8));
      if (await this.countAgainst(key, policy.waMaxSendsPerDay, 90_000)) return 'rate_per_day';
    }
    return null;
  }

  /** True when the counter is already at the cap (and is left alone); otherwise counts this send. */
  private async countAgainst(key: string, cap: number, ttlSeconds: number): Promise<boolean> {
    const over = await this.redis.eval(COUNT_UNLESS_AT_CAP, 1, key, cap, ttlSeconds);
    return Number(over) === 1;
  }

  private async decide(
    orgId: number,
    policy: SecurityPolicy,
    reason: ScreenReason,
    context: ScreenContext,
  ): Promise<void> {
    const enforce = policy.waGuardrailsMode === 'enforce';
    await this.audit.recordStandalone({
      event: enforce ? 'security.send_blocked' : 'security.send_flagged',
      status: 'warning',
      orgId,
      actorType: 'system',
      payload: { reason, source: context.source ?? null },
    });
    if (enforce) {
      throw new AppError(
        ERROR_CODES.AUTH_SEND_BLOCKED,
        `Send blocked by security policy (${reason.replace(/_/g, ' ')}).`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'reason', message: reason }],
      );
    }
  }
}
