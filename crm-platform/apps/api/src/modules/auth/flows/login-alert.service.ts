import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { MailService } from '../mail/mail.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { networkPrefix, normalizeIp } from '../support/ip';
import { AuthKeys } from '../support/redis-keys';
import { describeAgent, fingerprint } from '../support/user-agent';

export interface LoginAlertInput {
  orgId: number;
  userId: number;
  email: string;
  name: string;
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
}

/**
 * New-device / new-location alert (TW-AUTH-018).
 *
 * Compares this sign-in with the user's previous session. "Device" is browser
 * family + OS family; "country" is the same network heuristic Reference used (no
 * geo database): first two IPv4 octets, or the first four IPv6 hextets.
 *
 * Runs after the login has committed and swallows every failure: an alert must
 * never fail a sign-in. It is in-process for now; it becomes an outbox
 * subscriber on `auth.login` when the subscriber registry exists (K2).
 */
@Injectable()
export class LoginAlertService {
  private readonly logger = new Logger(LoginAlertService.name);
  private readonly webUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly policy: SecurityPolicyService,
    private readonly mail: MailService,
    private readonly audit: AuthAuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.webUrl = config.get('WEB_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  async check(input: LoginAlertInput): Promise<void> {
    try {
      const policy = await this.policy.policy();
      if (!policy.alertOnNewDevice && !policy.alertOnNewCountry) return;

      const res = await this.db.txAs({ orgId: input.orgId, userId: input.userId }, async (tx) =>
        tx.execute(sql`
          SELECT host(ip) AS ip, user_agent FROM auth_sessions
          WHERE org_id = ${input.orgId} AND user_id = ${input.userId}
            AND uuid <> ${input.sessionId}::uuid
          ORDER BY created_at DESC LIMIT 1
        `),
      );
      const previous = res.rows[0] as unknown as
        { ip: string | null; user_agent: string | null } | undefined;
      // The first sign-in ever has nothing to compare with.
      if (!previous) return;

      const reasons: string[] = [];
      if (
        policy.alertOnNewDevice &&
        previous.user_agent &&
        input.userAgent &&
        fingerprint(previous.user_agent) !== fingerprint(input.userAgent)
      ) {
        reasons.push('a new device');
      }
      const before = networkPrefix(previous.ip);
      const now = networkPrefix(input.ip);
      if (policy.alertOnNewCountry && before && now && before !== now) {
        reasons.push('a different location');
      }
      if (reasons.length === 0) return;

      // One sign-in can fire more than once (refresh, social callback); mail once per 10 minutes.
      const dedupeKey = AuthKeys.alertDedupe(
        input.orgId,
        String(input.userId),
        `${input.ip}|${input.userAgent}`,
      );
      const fresh = await this.redis.set(dedupeKey, '1', 'EX', 600, 'NX');
      if (!fresh) return;

      const emailOn = policy.alertChannel === 'email' || policy.alertChannel === 'both';
      let sent = false;
      if (emailOn) {
        sent = await this.mail.sendLoginAlert(
          input.email,
          input.name,
          {
            when: new Date(),
            ip: normalizeIp(input.ip),
            browser: describeAgent(input.userAgent).label,
            reasons,
            signedIn: true,
          },
          `${this.webUrl}/account?tab=security`,
        );
      }
      // The WhatsApp channel is an explicit stub in Reference too: audited, not sent.
      await this.audit.recordStandalone({
        event: 'auth.alert_emitted',
        status: 'warning',
        orgId: input.orgId,
        actorType: 'user',
        actorId: input.userId,
        recordId: input.userId,
        payload: { reasons, channel: policy.alertChannel, emailSent: sent },
      });
    } catch (err) {
      this.logger.warn({ err }, 'login alert failed');
    }
  }
}
