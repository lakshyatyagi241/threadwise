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

const LINK = /https?:\/\/[^\s<>"']+/gi;

/** Phrases typical of phishing and prize scams. Own wording; extend via the keyword list. */
const SCAM = [
  /\byou(?:'ve| have)? (?:won|been selected)\b/i,
  /\bclaim (?:your )?(?:prize|reward|gift)\b/i,
  /\bverify (?:your )?account\b/i,
  /\baccount (?:is )?(?:suspended|blocked|locked)\b/i,
  /\bclick (?:here )?to (?:confirm|verify|unlock)\b/i,
  /\burgent action required\b/i,
  /\b(?:update|complete) (?:your )?kyc\b/i,
  /\b(?:double|triple) your (?:money|investment)\b/i,
  /\brisk[- ]free (?:profit|returns?)\b/i,
];

const FINANCE = [
  /\bguaranteed (?:returns?|profits?)\b/i,
  /\bbinary options?\b/i,
  /\bforex signals?\b/i,
  /\bcrypto (?:doubling|giveaway)\b/i,
  /\bloan (?:approved|offer)\b/i,
  /\bearn \S+ (?:per|a) day\b/i,
  /\binvestment opportunity\b/i,
  /\bget rich quick\b/i,
];

const SHORTENERS = new Set([
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
  'clck.ru',
  'shorte.st',
  'adf.ly',
  'short.io',
]);

export function evaluateContent(body: string, policy: SecurityPolicy): ScreenReason | null {
  const text = body.trim();
  if (!text) return null;
  const links = text.match(LINK) ?? [];

  if (policy.waHoldOnLinksCount > 0 && links.length > policy.waHoldOnLinksCount)
    return 'link_count';
  if (policy.waHoldOnScamPattern && SCAM.some((re) => re.test(text))) return 'scam_pattern';
  if (policy.abuseBlockFinanceTerms && FINANCE.some((re) => re.test(text))) return 'finance_terms';
  if (policy.abuseBlockShortLinks) {
    for (const url of links) {
      try {
        if (SHORTENERS.has(new URL(url).hostname.replace(/^www\./, '').toLowerCase()))
          return 'short_link';
      } catch {
        // an unparsable URL is not a shortener
      }
    }
  }
  const lower = text.toLowerCase();
  if (policy.abuseBlockKeywordList.some((k) => k && lower.includes(k.toLowerCase())))
    return 'keyword';
  return null;
}

/** Calendar-bucket stamps: minute `YYYYMMDDHHmm`, day `YYYYMMDD`, UTC. */
const stamp = (d: Date, len: 12 | 8): string => d.toISOString().replace(/[-:T]/g, '').slice(0, len);

/**
 * Pre-send screen for outbound messages (TW-AUTH-041): per-organization rate
 * caps and content filters in one of three modes (off, monitor, enforce).
 *
 * To be called from the shared outbound pipeline (inbox, broadcast, scheduled,
 * flows). The emergency halt is always checked first, in every mode, and for
 * bulk screens too (Reference's bulk path skipped it). Everything else fails open:
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
   * under it counts. Windows are fixed calendar buckets, not sliding.
   */
  private async checkRates(orgId: number, policy: SecurityPolicy): Promise<ScreenReason | null> {
    const now = new Date();
    if (policy.waMaxSendsPerMinute > 0) {
      const key = AuthKeys.sendMinute(orgId, stamp(now, 12));
      const used = Number((await this.redis.get(key)) ?? 0);
      if (used >= policy.waMaxSendsPerMinute) return 'rate_per_minute';
      await this.redis.multi().incr(key).expire(key, 120).exec();
    }
    if (policy.waMaxSendsPerDay > 0) {
      const key = AuthKeys.sendDay(orgId, stamp(now, 8));
      const used = Number((await this.redis.get(key)) ?? 0);
      if (used >= policy.waMaxSendsPerDay) return 'rate_per_day';
      await this.redis.multi().incr(key).expire(key, 90_000).exec();
    }
    return null;
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
