import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { MailService, type LoginAlertReason } from '../mail/mail.service';
import { PlatformStore } from '../platform/platform-store';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { networkPrefix, normalizeIp } from '../support/ip';
import { AuthKeys } from '../support/redis-keys';
import { describeAgent, fingerprint } from '../support/user-agent';

/** Who signed in: a person in a workspace, or a platform operator. */
export type LoginAlertSubject =
  | { kind: 'user'; orgId: number; userId: number; orgSlug: string }
  | { kind: 'operator'; operatorId: number };

export interface LoginAlertInput {
  subject: LoginAlertSubject;
  email: string;
  name: string;
  /** The session that was just opened; it is excluded from "the previous sign-in". */
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
}

/** User agents are stored in audit payloads cut to this length. */
const UA_AUDIT_CHARS = 120;
/** One alert per person and browser/network in this window. */
const DEDUPE_SECONDS = 600;

/**
 * New-device / new-location alert (WD-AUTH-018), for workspace users and for
 * platform operators alike.
 *
 * Compares this sign-in with the person's previous session. "Device" is
 * browser family + OS family; "country" is the same network heuristic WaDesk
 * used (no geo database): first two IPv4 octets, or the first four IPv6
 * hextets.
 *
 * Order follows WaDesk: when a sign-in qualifies, the `auth.alert_emitted`
 * audit row is written FIRST and for every qualifying sign-in; the ten-minute
 * dedupe then only suppresses the mail. The audit trail therefore shows every
 * suspicious sign-in even when the mailbox was spared a duplicate.
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
    private readonly platform: PlatformStore,
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

      const previous = await this.previousSession(input);
      // The first sign-in ever has nothing to compare with.
      if (!previous) return;

      const reasons: LoginAlertReason[] = [];
      if (
        policy.alertOnNewDevice &&
        previous.user_agent &&
        input.userAgent &&
        fingerprint(previous.user_agent) !== fingerprint(input.userAgent)
      ) {
        reasons.push('new-device');
      }
      const before = networkPrefix(previous.ip);
      const now = networkPrefix(input.ip);
      if (policy.alertOnNewCountry && before && now && before !== now) {
        reasons.push('new-country');
      }
      if (reasons.length === 0) return;

      const { subject } = input;
      await this.audit.recordStandalone({
        event: subject.kind === 'user' ? 'auth.alert_emitted' : 'platform.auth.alert_emitted',
        status: 'warning',
        ...(subject.kind === 'user'
          ? {
              orgId: subject.orgId,
              actorType: 'user',
              actorId: subject.userId,
              recordId: subject.userId,
            }
          : { actorType: 'platform_operator', actorId: subject.operatorId }),
        payload: {
          reasons,
          channel: policy.alertChannel,
          prevIp: previous.ip,
          prevUa: (previous.user_agent ?? '').slice(0, UA_AUDIT_CHARS),
          thisIp: normalizeIp(input.ip),
          thisUa: (input.userAgent ?? '').slice(0, UA_AUDIT_CHARS),
        },
      });

      // One sign-in can fire more than once (refresh, social callback); mail once per 10 minutes.
      const who = subject.kind === 'user' ? String(subject.userId) : `op${subject.operatorId}`;
      const dedupeKey = AuthKeys.alertDedupe(
        subject.kind === 'user' ? subject.orgId : 0,
        who,
        `${input.ip}|${input.userAgent}`,
      );
      const fresh = await this.redis.set(dedupeKey, '1', 'EX', DEDUPE_SECONDS, 'NX');
      if (!fresh) return;

      // The WhatsApp channel is an explicit stub in WaDesk too: audited above, not sent.
      const emailOn = policy.alertChannel === 'email' || policy.alertChannel === 'both';
      if (!emailOn) return;
      await this.mail.sendLoginAlert(
        input.email,
        input.name,
        {
          when: new Date(),
          ip: normalizeIp(input.ip),
          browser: describeAgent(input.userAgent).label,
          reasons,
          signedIn: true,
        },
        this.actionUrl(subject),
      );
    } catch (err) {
      this.logger.warn({ err }, 'login alert failed');
    }
  }

  /**
   * Where the mail sends the recipient. For a workspace user it is the
   * password-reset page, which works while signed out: the case this alert is
   * for is someone ELSE having signed in, and an authenticated settings page
   * would just bounce the real owner to a login form. Operators have no
   * reset flow of their own, so theirs opens the console's security page.
   */
  private actionUrl(subject: LoginAlertSubject): string {
    return subject.kind === 'user'
      ? this.mail.link('/forgot-password', { org: subject.orgSlug })
      : `${this.webUrl}/admin/account/security`;
  }

  private async previousSession(
    input: LoginAlertInput,
  ): Promise<{ ip: string | null; user_agent: string | null } | undefined> {
    const { subject } = input;
    if (subject.kind === 'user') {
      const res = await this.db.txAs({ orgId: subject.orgId, userId: subject.userId }, async (tx) =>
        tx.execute(sql`
            SELECT host(ip) AS ip, user_agent FROM auth_sessions
            WHERE org_id = ${subject.orgId} AND user_id = ${subject.userId}
              AND uuid <> ${input.sessionId}::uuid
            ORDER BY created_at DESC LIMIT 1
          `),
      );
      return res.rows[0] as unknown as { ip: string | null; user_agent: string | null } | undefined;
    }
    return this.platform.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT host(ip) AS ip, user_agent FROM platform_sessions
        WHERE operator_id = ${subject.operatorId} AND uuid <> ${input.sessionId}::uuid
        ORDER BY created_at DESC LIMIT 1
      `);
      return res.rows[0] as unknown as { ip: string | null; user_agent: string | null } | undefined;
    });
  }
}
