import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type Authenticated,
  type Landing,
  type LoginRequest,
  type LoginResponse,
  type MfaLoginRequest,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { TenantDirectory, type OrgRef } from '../platform/tenant-directory';
import { SessionService } from '../sessions/session.service';
import { AccountGateService } from '../security/account-gate.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { CaptchaService } from '../security/captcha.service';
import { MfaService } from '../security/mfa.service';
import { PasswordService } from '../security/password.service';
import { RateLimitService } from '../security/rate-limit.service';
import { normalizeIp } from '../support/ip';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { randomToken } from '../support/crypto-utils';
import { LoginAlertService } from './login-alert.service';

import type { ClientMeta } from '../support/client-meta';
export type { ClientMeta };

interface UserRow {
  id: number;
  uuid: string;
  email: string;
  full_name: string;
  password_hash: string | null;
  status: string;
  mfa_enabled: boolean;
}

export interface CompleteLoginInput {
  org: Pick<OrgRef, 'id' | 'slug' | 'settings'>;
  user: { id: number; uuid: string; email: string; fullName: string };
  remember: boolean;
  mfaVerified: boolean;
  method: 'password' | 'mfa' | 'social' | 'signup' | 'switch';
  meta: ClientMeta;
}

interface MfaChallenge {
  orgId: number;
  userId: number;
  remember: boolean;
  method: CompleteLoginInput['method'];
}

const IP_THROTTLE_MAX = 40;
const IP_THROTTLE_WINDOW_SECONDS = 300;

/**
 * Password login, the MFA step-up, logout and workspace switching.
 * `completeLogin` is the single place a session is opened, so sign-up, social
 * sign-in and workspace switch all end the same way (WD-AUTH-001/012/017).
 */
@Injectable()
export class LoginService {
  private readonly logger = new Logger(LoginService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly tenants: TenantDirectory,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly rate: RateLimitService,
    private readonly policy: SecurityPolicyService,
    private readonly audit: AuthAuditService,
    private readonly captcha: CaptchaService,
    private readonly gates: AccountGateService,
    private readonly mfa: MfaService,
    private readonly alerts: LoginAlertService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // --- password login ---------------------------------------------------------------------

  async login(req: LoginRequest, meta: ClientMeta): Promise<LoginResponse> {
    const policy = await this.policy.policy();
    const ip = normalizeIp(meta.ip) ?? 'unknown';

    const org = await this.tenants.findOrgBySlug(req.orgSlug);
    if (!org || org.status !== 'active') {
      // Same work and same answer as a wrong password: no organization oracle.
      await this.passwords.verifyOrDummy(null, req.password);
      await this.audit.recordStandalone({
        event: 'auth.failed',
        status: 'failure',
        payload: { identifier: req.email.slice(0, 191), reason: 'unknown_organization' },
      });
      throw this.invalid();
    }

    // Order is deliberate (WD-AUTH-002): lockout first, so a locked-out user
    // with the right password is still refused; then captcha; then credentials.
    const lockKey = AuthKeys.lockout(org.id, req.email, ip);
    if (policy.lockoutAfterFailures > 0) {
      const state = await this.rate.peek(lockKey);
      if (state.count >= policy.lockoutAfterFailures) {
        await this.audit.recordStandalone({
          event: 'auth.lockout',
          status: 'warning',
          orgId: org.id,
          payload: { identifier: req.email.slice(0, 191) },
        });
        const minutes = Math.max(1, Math.ceil(state.retryAfterSeconds / 60));
        throw new AppError(
          ERROR_CODES.AUTH_ACCOUNT_LOCKED,
          `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
          HttpStatus.TOO_MANY_REQUESTS,
          [{ path: 'retryAfterSeconds', message: String(state.retryAfterSeconds) }],
        );
      }
    }
    await this.captcha.assert(req.captchaToken, 'login');

    // A per-IP ceiling across emails; WaDesk throttled per email only, so one
    // address could try unlimited accounts.
    if (
      !(await this.rate.allow(
        AuthKeys.ipThrottle('login', ip),
        IP_THROTTLE_MAX,
        IP_THROTTLE_WINDOW_SECONDS,
      ))
    ) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many attempts. Slow down.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const row = await this.findUser(org.id, req.email);
    const passwordOk = await this.passwords.verifyOrDummy(row?.password_hash, req.password);
    if (!row || !passwordOk) {
      if (policy.lockoutAfterFailures > 0) {
        await this.rate.hit(lockKey, policy.lockoutWindowMinutes * 60);
      }
      await this.audit.recordStandalone({
        event: 'auth.failed',
        status: 'failure',
        orgId: org.id,
        actorType: 'user',
        actorId: row?.id ?? null,
        recordId: row?.id ?? 0,
        payload: { identifier: req.email.slice(0, 191) },
      });
      throw this.invalid();
    }

    if (row.status !== 'active') {
      await this.audit.recordStandalone({
        event: 'auth.failed',
        status: 'failure',
        orgId: org.id,
        actorType: 'user',
        actorId: row.id,
        recordId: row.id,
        payload: { reason: 'suspended' },
      });
      throw new AppError(
        ERROR_CODES.AUTH_ACCOUNT_SUSPENDED,
        'Your account is suspended.',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.rate.reset(lockKey);
    const remember = req.remember && policy.rememberMeEnabled;

    if (row.mfa_enabled) {
      return this.issueMfaChallenge({
        orgId: org.id,
        userId: row.id,
        remember,
        method: 'password',
      });
    }
    return this.completeLogin({
      org,
      user: { id: row.id, uuid: row.uuid, email: row.email, fullName: row.full_name },
      remember,
      mfaVerified: false,
      method: 'password',
      meta,
    });
  }

  // --- MFA step-up ----------------------------------------------------------------------------

  async issueMfaChallenge(challenge: MfaChallenge): Promise<LoginResponse> {
    const token = randomToken(32);
    await this.redis.setex(
      AuthKeys.mfaChallenge(token),
      Ttl.mfaChallengeSeconds,
      JSON.stringify(challenge),
    );
    return {
      status: 'mfa_required',
      challengeToken: token,
      expiresInSeconds: Ttl.mfaChallengeSeconds,
    };
  }

  async loginMfa(req: MfaLoginRequest, meta: ClientMeta): Promise<Authenticated> {
    const key = AuthKeys.mfaChallenge(req.challengeToken);
    const raw = await this.redis.get(key);
    if (!raw) throw this.challengeExpired();
    const challenge = JSON.parse(raw) as MfaChallenge;

    // Bounded attempts per challenge: six digits are brute-forceable otherwise.
    const attemptsKey = AuthKeys.mfaAttempts(req.challengeToken);
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) await this.redis.expire(attemptsKey, Ttl.mfaChallengeSeconds);
    if (attempts > Ttl.mfaMaxAttempts) {
      await this.redis.del(key);
      await this.audit.recordStandalone({
        event: 'auth.mfa_failed',
        status: 'failure',
        orgId: challenge.orgId,
        actorType: 'user',
        actorId: challenge.userId,
        recordId: challenge.userId,
        payload: { reason: 'too_many_attempts' },
      });
      throw this.challengeExpired();
    }

    const state = await this.mfa.loadState(challenge.orgId, challenge.userId);
    const ok = req.code
      ? await this.mfa.verifyCode(challenge.orgId, challenge.userId, state, req.code)
      : await this.mfa.verifyRecoveryCode(
          challenge.orgId,
          challenge.userId,
          state,
          req.recoveryCode ?? '',
        );
    if (!ok) {
      await this.audit.recordStandalone({
        event: 'auth.mfa_failed',
        status: 'failure',
        orgId: challenge.orgId,
        actorType: 'user',
        actorId: challenge.userId,
        recordId: challenge.userId,
        payload: { phase: 'login', method: req.code ? 'totp' : 'recovery' },
      });
      throw new AppError(
        ERROR_CODES.AUTH_MFA_INVALID_CODE,
        'That code is not valid.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Single use: the challenge cannot be replayed once it has produced a session.
    await this.redis.del(key, attemptsKey);

    const loaded = await this.loadOrgAndUser(challenge.orgId, challenge.userId);
    if (!loaded || loaded.user.status !== 'active') {
      throw AppError.unauthenticated('Invalid credentials');
    }
    return this.completeLogin({
      org: loaded.org,
      user: {
        id: loaded.user.id,
        uuid: loaded.user.uuid,
        email: loaded.user.email,
        fullName: loaded.user.full_name,
      },
      remember: challenge.remember,
      mfaVerified: true,
      method: 'mfa',
      meta,
    });
  }

  // --- the one place a session is opened ----------------------------------------------------------

  async completeLogin(input: CompleteLoginInput): Promise<Authenticated> {
    const { tokens, sessionId } = await this.sessions.create({
      orgId: input.org.id,
      userId: input.user.id,
      userUuid: input.user.uuid,
      remember: input.remember,
      mfaVerified: input.mfaVerified,
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
    });

    await this.db.txAs({ orgId: input.org.id, userId: input.user.id }, async (tx) => {
      await tx.execute(sql`
        INSERT INTO user_security (org_id, user_id, last_login_at)
        VALUES (${input.org.id}, ${input.user.id}, now())
        ON CONFLICT (org_id, user_id) DO UPDATE SET last_login_at = now()
      `);
      await this.audit.record(tx, {
        event: 'auth.login',
        status: 'success',
        orgId: input.org.id,
        actorType: 'user',
        actorId: input.user.id,
        recordId: input.user.id,
        payload: { method: input.method, remember: input.remember },
      });
      await this.outbox.emit(tx, {
        orgId: input.org.id,
        aggregateModule: 'auth',
        aggregateId: input.user.id,
        eventType: 'auth.login.succeeded',
        payload: { userUuid: input.user.uuid, method: input.method },
      });
    });

    const state = await this.gates.stateFor(input.org.id, input.user.id);
    void this.alerts.check({
      orgId: input.org.id,
      userId: input.user.id,
      email: input.user.email,
      name: input.user.fullName,
      sessionId,
      ip: input.meta.ip ?? null,
      userAgent: input.meta.userAgent ?? null,
    });

    return {
      status: 'authenticated',
      orgSlug: input.org.slug,
      tokens,
      landing: await this.landingFor(input.org, input.user.id, state.isAdmin),
      flags: this.gates.toFlags(state),
    };
  }

  /**
   * One function decides where a person lands (WD-AUTH-011), shared by login
   * and the session probe. Unfinished onboarding wins; then role: people who
   * can work conversations but not administer go to the inbox.
   */
  async landingFor(
    org: Pick<OrgRef, 'id' | 'settings'>,
    userId: number,
    isAdmin: boolean,
  ): Promise<Landing> {
    const step = (org.settings as { onboardingStep?: string }).onboardingStep;
    if (step && step !== 'done' && isAdmin) return 'onboarding';
    if (isAdmin) return 'dashboard';
    const grants = await this.rbac.grantsForUser(org.id, userId);
    const canInbox = this.rbac.can(grants, 'inbox.conversation.read').allowed;
    const canRecords = this.rbac.can(grants, 'record.contacts.read').allowed;
    return canInbox && !canRecords ? 'inbox' : 'dashboard';
  }

  // --- logout -------------------------------------------------------------------------------------------

  async logout(): Promise<void> {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId || !ctx.sessionId) return;

    await this.sessions.revoke(ctx.orgId, ctx.sessionId, 'logout');
    await this.audit.recordStandalone({
      event: 'auth.logout',
      status: 'info',
      orgId: ctx.orgId,
      actorType: 'user',
      actorId: ctx.userId,
      recordId: ctx.userId,
    });
  }

  // --- helpers ---------------------------------------------------------------------------------------------

  private invalid(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      'Those credentials do not match.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private challengeExpired(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED,
      'That sign-in expired. Start again.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  private async findUser(orgId: number, email: string): Promise<UserRow | undefined> {
    const res = await this.db.txAs({ orgId }, async (tx) =>
      tx.execute(sql`
        SELECT u.id, u.uuid, u.email, u.full_name, u.password_hash, u.status,
               COALESCE(s.mfa_enabled, false) AS mfa_enabled
        FROM users u
        LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE u.org_id = ${orgId} AND u.email = ${email}
      `),
    );
    return res.rows[0] as unknown as UserRow | undefined;
  }

  async loadOrgAndUser(
    orgId: number,
    userId: number,
  ): Promise<{ org: OrgRef; user: UserRow } | null> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT o.id AS org_id, o.uuid AS org_uuid, o.slug, o.name, o.status AS org_status, o.plan, o.settings,
               u.id, u.uuid, u.email, u.full_name, u.password_hash, u.status,
               COALESCE(s.mfa_enabled, false) AS mfa_enabled
        FROM users u
        JOIN organizations o ON o.id = u.org_id
        LEFT JOIN user_security s ON s.org_id = u.org_id AND s.user_id = u.id
        WHERE u.org_id = ${orgId} AND u.id = ${userId}
      `),
    );
    const r = res.rows[0] as unknown as
      | (UserRow & {
          org_id: number;
          org_uuid: string;
          slug: string;
          name: string;
          org_status: string;
          plan: string;
          settings: Record<string, unknown>;
        })
      | undefined;
    if (!r) return null;
    return {
      org: {
        id: r.org_id,
        uuid: r.org_uuid,
        slug: r.slug,
        name: r.name,
        status: r.org_status,
        plan: r.plan,
        settings: r.settings,
      },
      user: r,
    };
  }
}
