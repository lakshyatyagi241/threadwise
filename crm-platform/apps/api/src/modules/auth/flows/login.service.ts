import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type Authenticated,
  type SecurityPolicy,
  type Landing,
  type LoginRequest,
  type LoginResponse,
  type MfaLoginRequest,
  type PasswordLoginResponse,
  type SelectWorkspaceRequest,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { incrWithTtl } from '../../../infra/redis/incr-with-ttl';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { TenantDirectory, type OrgRef } from '../platform/tenant-directory';
import { SessionService } from '../sessions/session.service';
import { AccountAttackGuard } from '../security/account-attack.service';
import { AccountGateService } from '../security/account-gate.service';
import { WebAuthnService } from '../security/webauthn.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { CaptchaService } from '../security/captcha.service';
import { MfaService } from '../security/mfa.service';
import { PasswordService } from '../security/password.service';
import { RateLimitService } from '../security/rate-limit.service';
import { normalizeIp } from '../support/ip';
import { MfaAttemptLimiter } from '../support/mfa-attempts';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { randomToken, sha256Hex } from '../support/crypto-utils';
import { TokenService, type TokenClaims } from '../token.service';
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
  method: 'password' | 'mfa' | 'social' | 'signup' | 'switch' | 'invite';
  meta: ClientMeta;
}

interface MfaChallenge {
  orgId: number;
  userId: number;
  remember: boolean;
  method: CompleteLoginInput['method'];
  /**
   * The failed-password counter to clear once the second factor succeeds.
   * Clearing it at the password step would hand a password-holder a fresh
   * five-attempt lockout budget for every challenge they draw.
   */
  lockKey?: string;
}

/** The workspaces a password opened, held while the person picks one. Never leaves the server. */
interface WorkspaceChoice {
  remember: boolean;
  options: Array<{ orgId: number; userId: number; slug: string; lockKey: string }>;
}

/** Failed sign-ins from one address, across emails, before it is slowed down. */
const IP_FAILURE_MAX = 40;
const IP_FAILURE_WINDOW_SECONDS = 300;

/**
 * Password login, the MFA step-up, logout and workspace switching.
 * `completeLogin` is the single place a session is opened, so sign-up, social
 * sign-in and workspace switch all end the same way (TW-AUTH-001/012/017).
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
    private readonly mfaLimiter: MfaAttemptLimiter,
    private readonly tokens: TokenService,
    private readonly policy: SecurityPolicyService,
    private readonly audit: AuthAuditService,
    private readonly captcha: CaptchaService,
    private readonly gates: AccountGateService,
    private readonly mfa: MfaService,
    private readonly alerts: LoginAlertService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly attack: AccountAttackGuard,
    private readonly webauthn: WebAuthnService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // --- password login ---------------------------------------------------------------------

  async login(req: LoginRequest, meta: ClientMeta): Promise<PasswordLoginResponse> {
    const policy = await this.policy.policy();
    const ip = normalizeIp(meta.ip) ?? 'unknown';

    let org: OrgRef | null;
    if (req.orgSlug) {
      org = await this.tenants.findOrgBySlug(req.orgSlug);
    } else {
      const orgs = await this.tenants.activeOrgsForEmail(req.email);
      // Several workspaces: the password decides which of them to offer.
      if (orgs.length > 1) return this.loginAcrossWorkspaces(req, orgs, policy, ip, meta);
      org = orgs[0] ?? null;
    }
    if (!org || org.status !== 'active') {
      // Same work and same answer as a wrong password: no organization oracle.
      await this.passwords.verifyOrDummy(null, req.password);
      await this.countIpFailure('login', ip);
      await this.audit.recordStandalone({
        event: 'auth.failed',
        status: 'failure',
        payload: { identifier: req.email.slice(0, 191), reason: 'unknown_organization' },
      });
      throw this.invalid();
    }

    // Order is deliberate (TW-AUTH-002): lockout first, so a locked-out user
    // with the right password is still refused; then captcha; then credentials.
    const lockKey = AuthKeys.lockout(org.id, req.email, ip);
    await this.assertNotLocked(lockKey, policy, { orgId: org.id, email: req.email });
    await this.captcha.assert(req.captchaToken, 'login');

    // A per-IP ceiling across emails; Reference throttled per email only, so one
    // address could try unlimited accounts. Only FAILED attempts count: people
    // behind one office or carrier address signing in successfully must not
    // lock each other out.
    await this.assertIpUnderCeiling('login', ip);
    // The per-address limits above cannot see guesses spread over many addresses: this one counts the account itself.
    await this.attack.assertAllowed(
      'staff',
      org.id,
      req.email,
      normalizeIp(meta.ip),
      req.captchaToken,
      policy,
    );

    const row = await this.findUser(org.id, req.email);
    const passwordOk = await this.passwords.verifyOrDummy(row?.password_hash, req.password);
    if (!row || !passwordOk) {
      await this.recordFailedSignIn(lockKey, policy);
      await this.attack.recordFailure('staff', org.id, req.email, policy);
      await this.countIpFailure('login', ip);
      await this.auditFailedSignIn(org.id, row, req.email);
      throw this.invalid();
    }

    return this.afterPassword(org, row, req.remember && policy.rememberMeEnabled, lockKey, meta);
  }

  /**
   * The email is in several workspaces and the request named none. The password is checked against every
   * one of them: no match is the usual wrong-password answer, one match signs straight in, and several
   * matches return the cards to pick from. Only workspaces the password opened are listed, so the answer
   * never reveals a workspace the visitor could not already enter.
   */
  private async loginAcrossWorkspaces(
    req: LoginRequest,
    orgs: OrgRef[],
    policy: SecurityPolicy,
    ip: string,
    meta: ClientMeta,
  ): Promise<PasswordLoginResponse> {
    await this.captcha.assert(req.captchaToken, 'login');
    await this.assertIpUnderCeiling('login', ip);

    const matches: Array<{ org: OrgRef; row: UserRow; lockKey: string }> = [];
    const failures: Array<{ org: OrgRef; row: UserRow | undefined; lockKey: string }> = [];
    let locked: { org: OrgRef; lockKey: string } | null = null;
    let challenged: AppError | null = null;
    for (const org of orgs) {
      const lockKey = AuthKeys.lockout(org.id, req.email, ip);
      if (
        policy.lockoutAfterFailures > 0 &&
        (await this.rate.peek(lockKey)).count >= policy.lockoutAfterFailures
      ) {
        locked ??= { org, lockKey };
        continue;
      }
      try {
        await this.attack.assertAllowed(
          'staff',
          org.id,
          req.email,
          normalizeIp(meta.ip),
          req.captchaToken,
          policy,
        );
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        challenged ??= err;
        continue;
      }
      const row = await this.findUser(org.id, req.email);
      const ok = await this.passwords.verifyOrDummy(row?.password_hash, req.password);
      if (row && ok) matches.push({ org, row, lockKey });
      else failures.push({ org, row, lockKey });
    }

    if (matches.length === 0) {
      // A wrong password counts against every workspace it was tried on; a right password for one of
      // them never costs the others anything (people keep different passwords per workspace).
      for (const f of failures) {
        await this.recordFailedSignIn(f.lockKey, policy);
        await this.attack.recordFailure('staff', f.org.id, req.email, policy);
        await this.auditFailedSignIn(f.org.id, f.row, req.email);
      }
      if (challenged && failures.length === 0) throw challenged;
      if (locked) {
        await this.assertNotLocked(locked.lockKey, policy, {
          orgId: locked.org.id,
          email: req.email,
        });
      }
      await this.countIpFailure('login', ip);
      throw this.invalid();
    }

    const remember = req.remember && policy.rememberMeEnabled;
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only) return this.afterPassword(only.org, only.row, remember, only.lockKey, meta);

    const details = await this.tenants.workspaceCardDetails(
      matches.map((m) => ({ orgId: m.org.id, userId: m.row.id })),
    );
    const token = randomToken(32);
    const pending: WorkspaceChoice = {
      remember,
      options: matches.map((m) => ({
        orgId: m.org.id,
        userId: m.row.id,
        slug: m.org.slug,
        lockKey: m.lockKey,
      })),
    };
    await this.redis.setex(
      AuthKeys.workspaceChoice(token),
      Ttl.workspaceChoiceSeconds,
      JSON.stringify(pending),
    );
    return {
      status: 'workspace_required',
      selectionToken: token,
      expiresInSeconds: Ttl.workspaceChoiceSeconds,
      workspaces: matches.map((m) => ({
        slug: m.org.slug,
        name: m.org.name,
        role: details.get(m.org.id)?.role ?? null,
        memberCount: details.get(m.org.id)?.memberCount ?? 0,
      })),
    };
  }

  /** The card the person picked: the password already matched there, so this goes on to the second factor or the session. */
  async selectWorkspace(req: SelectWorkspaceRequest, meta: ClientMeta): Promise<LoginResponse> {
    const key = AuthKeys.workspaceChoice(req.selectionToken);
    const raw = await this.redis.get(key);
    if (!raw) throw this.challengeExpired();
    const pending = JSON.parse(raw) as WorkspaceChoice;
    const choice = pending.options.find((o) => o.slug.toLowerCase() === req.orgSlug.toLowerCase());
    // A wrong slug leaves the token alive so the person can pick again; only a used one is spent.
    if (!choice) throw this.invalid();
    await this.redis.del(key);

    const loaded = await this.loadOrgAndUser(choice.orgId, choice.userId);
    if (!loaded || loaded.org.status !== 'active') throw this.invalid();
    return this.afterPassword(loaded.org, loaded.user, pending.remember, choice.lockKey, meta);
  }

  /** The password held: ask for the second factor when the account has one, else open the session. */
  private async afterPassword(
    org: OrgRef,
    row: UserRow,
    remember: boolean,
    lockKey: string,
    meta: ClientMeta,
  ): Promise<LoginResponse> {
    // A suspended person signs in like anyone else and is then held at the
    // suspended screen by the account gate (TW-AUTH-016); refusing them here
    // would hide the reason and the way to sign out.
    if (row.mfa_enabled) {
      return this.issueMfaChallenge({
        orgId: org.id,
        userId: row.id,
        remember,
        method: 'password',
        lockKey,
      });
    }
    await this.rate.reset(lockKey);
    return this.completeLogin({
      org,
      user: { id: row.id, uuid: row.uuid, email: row.email, fullName: row.full_name },
      remember,
      mfaVerified: false,
      method: 'password',
      meta,
    });
  }

  private async auditFailedSignIn(
    orgId: number,
    row: UserRow | undefined,
    email: string,
  ): Promise<void> {
    await this.audit.recordStandalone({
      event: 'auth.failed',
      status: 'failure',
      orgId,
      actorType: 'user',
      actorId: row?.id ?? null,
      recordId: row?.id ?? 0,
      payload: { identifier: email.slice(0, 191) },
    });
  }

  // --- lockout and throttles, shared by every credential check ------------------------------------

  /**
   * Refuses (and audits) while the lockout counter for `key` is at the limit.
   * Used by password sign-in, the Clerk exchange and the partner portal so all
   * of them stop at the same place.
   */
  async assertNotLocked(
    key: string,
    policy: Pick<SecurityPolicy, 'lockoutAfterFailures'>,
    who: { orgId: number; email: string },
  ): Promise<void> {
    if (policy.lockoutAfterFailures <= 0) return;
    const state = await this.rate.peek(key);
    if (state.count < policy.lockoutAfterFailures) return;
    await this.audit.recordStandalone({
      event: 'auth.lockout',
      status: 'warning',
      orgId: who.orgId,
      payload: { identifier: who.email.slice(0, 191) },
    });
    const minutes = Math.max(1, Math.ceil(state.retryAfterSeconds / 60));
    throw new AppError(
      ERROR_CODES.AUTH_ACCOUNT_LOCKED,
      `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      HttpStatus.TOO_MANY_REQUESTS,
      [{ path: 'retryAfterSeconds', message: String(state.retryAfterSeconds) }],
    );
  }

  /** Counts one failed credential check toward the lockout (a fixed window from the first failure). */
  async recordFailedSignIn(
    key: string,
    policy: Pick<SecurityPolicy, 'lockoutAfterFailures' | 'lockoutWindowMinutes'>,
  ): Promise<void> {
    if (policy.lockoutAfterFailures <= 0) return;
    await this.rate.hit(key, policy.lockoutWindowMinutes * 60);
  }

  async clearLockout(key: string): Promise<void> {
    await this.rate.reset(key);
  }

  private async assertIpUnderCeiling(scope: string, ip: string): Promise<void> {
    const state = await this.rate.peek(AuthKeys.ipFailures(scope, ip));
    if (state.count < IP_FAILURE_MAX) return;
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many attempts. Slow down.',
      HttpStatus.TOO_MANY_REQUESTS,
      [{ path: 'retryAfterSeconds', message: String(state.retryAfterSeconds) }],
    );
  }

  private async countIpFailure(scope: string, ip: string): Promise<void> {
    await this.rate.hit(AuthKeys.ipFailures(scope, ip), IP_FAILURE_WINDOW_SECONDS);
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
      passkey:
        (await this.webauthn.count({
          pool: 'user',
          orgId: challenge.orgId,
          userId: challenge.userId,
        })) > 0,
    };
  }

  /** Options for "Use a passkey" at the second-factor step. Bounded per challenge so it cannot be used to probe. */
  async passkeyLoginOptions(challengeToken: string) {
    const raw = await this.redis.get(AuthKeys.mfaChallenge(challengeToken));
    if (!raw) throw this.challengeExpired();
    const challenge = JSON.parse(raw) as MfaChallenge;
    await this.mfaLimiter.assertAvailable('user', challenge.orgId, challenge.userId);
    if (
      !(await this.rate.allow(
        `auth:wa-opts:${sha256Hex(challengeToken)}`,
        10,
        Ttl.mfaChallengeSeconds,
      ))
    ) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many attempts. Slow down.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.webauthn.loginOptions(
      { pool: 'user', orgId: challenge.orgId, userId: challenge.userId },
      sha256Hex(challengeToken),
    );
  }

  async loginMfa(req: MfaLoginRequest, meta: ClientMeta): Promise<Authenticated> {
    const key = AuthKeys.mfaChallenge(req.challengeToken);
    const raw = await this.redis.get(key);
    if (!raw) throw this.challengeExpired();
    const challenge = JSON.parse(raw) as MfaChallenge;

    // Bounded attempts per challenge: six digits are brute-forceable otherwise.
    const attemptsKey = AuthKeys.mfaAttempts(req.challengeToken);
    const attempts = await incrWithTtl(this.redis, attemptsKey, Ttl.mfaChallengeSeconds);
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

    // Across challenges too: a new challenge only costs the password, so the
    // guessing budget belongs to the person, not to the challenge (TW-AUTH-030).
    try {
      await this.mfaLimiter.assertAvailable('user', challenge.orgId, challenge.userId);
    } catch (err) {
      await this.audit.recordStandalone({
        event: 'auth.mfa_failed',
        status: 'warning',
        orgId: challenge.orgId,
        actorType: 'user',
        actorId: challenge.userId,
        recordId: challenge.userId,
        payload: { reason: 'locked' },
      });
      throw err;
    }

    const state = await this.mfa.loadState(challenge.orgId, challenge.userId);
    const ok = req.webauthn
      ? await this.webauthn.verifyLogin(
          { pool: 'user', orgId: challenge.orgId, userId: challenge.userId },
          sha256Hex(req.challengeToken),
          req.webauthn,
        )
      : req.code
        ? await this.mfa.verifyCode(challenge.orgId, challenge.userId, state, req.code)
        : await this.mfa.verifyRecoveryCode(
            challenge.orgId,
            challenge.userId,
            state,
            req.recoveryCode ?? '',
          );
    if (!ok) {
      await this.mfaLimiter.recordFailure('user', challenge.orgId, challenge.userId);
      await this.audit.recordStandalone({
        event: 'auth.mfa_failed',
        status: 'failure',
        orgId: challenge.orgId,
        actorType: 'user',
        actorId: challenge.userId,
        recordId: challenge.userId,
        payload: {
          phase: 'login',
          method: req.webauthn ? 'passkey' : req.code ? 'totp' : 'recovery',
        },
      });
      throw new AppError(
        ERROR_CODES.AUTH_MFA_INVALID_CODE,
        'That code is not valid.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    // Single use: the challenge cannot be replayed once it has produced a session.
    await this.redis.del(key, attemptsKey);
    await this.mfaLimiter.clear('user', challenge.orgId, challenge.userId);
    // The password counter is cleared only now that both factors held (TW-AUTH-002).
    if (challenge.lockKey) await this.rate.reset(challenge.lockKey);

    // A suspended person gets a session too and lands on the suspended screen.
    const loaded = await this.loadOrgAndUser(challenge.orgId, challenge.userId);
    if (!loaded) throw AppError.unauthenticated('Invalid credentials');
    return this.completeLogin({
      org: loaded.org,
      user: {
        id: loaded.user.id,
        uuid: loaded.user.uuid,
        email: loaded.user.email,
        fullName: loaded.user.full_name,
      },
      // A social sign-in that stopped for a second factor is still a social sign-in.
      remember:
        challenge.remember ||
        (challenge.method === 'social' && (await this.policy.policy()).rememberMeEnabled),
      mfaVerified: true,
      method: 'mfa',
      meta,
    });
  }

  // --- the one place a session is opened ----------------------------------------------------------

  async completeLogin(input: CompleteLoginInput): Promise<Authenticated> {
    // Social sign-in is always remembered, as in Reference (nobody ticks a box on a
    // provider's consent screen), but never against the platform's own switch.
    const remember =
      input.method === 'social'
        ? input.remember || (await this.policy.policy()).rememberMeEnabled
        : input.remember;
    const { tokens, sessionId } = await this.sessions.create({
      orgId: input.org.id,
      userId: input.user.id,
      userUuid: input.user.uuid,
      remember,
      mfaVerified: input.mfaVerified,
      ip: input.meta.ip,
      userAgent: input.meta.userAgent,
    });

    // The session exists from here on. Bookkeeping that fails must not turn a
    // successful sign-in into an error response (the person would be left with
    // a live session they never received), so it is logged and the login goes on.
    await this.recordSignIn({ ...input, remember });

    const state = await this.gates.stateFor(input.org.id, input.user.id);
    // Moving between workspaces is not a new sign-in from a new place (TW-AUTH-018).
    if (input.method !== 'switch') {
      void this.attack.rememberNetwork(
        'staff',
        input.org.id,
        input.user.email,
        normalizeIp(input.meta.ip),
      );
      void this.alerts.check({
        subject: {
          kind: 'user',
          orgId: input.org.id,
          userId: input.user.id,
          orgSlug: input.org.slug,
        },
        email: input.user.email,
        name: input.user.fullName,
        sessionId,
        ip: input.meta.ip ?? null,
        userAgent: input.meta.userAgent ?? null,
      });
    }

    return {
      status: 'authenticated',
      orgSlug: input.org.slug,
      tokens,
      landing: await this.landingFor(input.org, input.user.id, state.isAdmin),
      flags: this.gates.toFlags(state),
      remember,
    };
  }

  /**
   * Everything a sign-in leaves behind besides the session (TW-AUTH-017), in two
   * independent steps so a failing audit sink cannot lose the user's own state:
   *
   *  - the user's rows: last login, invite acceptance (`joined_at`, as Reference
   *    stamps `workspace_user.joined_at` at the first login), and the two
   *    stamps that keep a policy from locking a new account out at once;
   *  - the audit row and the outbox event, in one transaction.
   */
  private async recordSignIn(input: CompleteLoginInput): Promise<void> {
    const { org, user } = input;
    try {
      const registration = await this.policy.registration();
      // With verification off every account counts as verified, so the address
      // is stamped the first time the person signs in (Reference stamps on the fly).
      const autoVerify = registration.emailVerification === 'off';
      // Social and Clerk accounts hold a password nobody knows, so a maximum
      // password age has nothing to measure from: their clock starts now.
      const stampPassword = input.method === 'social';
      await this.db.txAs({ orgId: org.id, userId: user.id }, async (tx) => {
        await tx.execute(sql`
          INSERT INTO user_security (org_id, user_id, last_login_at, email_verified_at, password_changed_at)
          VALUES (${org.id}, ${user.id}, now(),
                  CASE WHEN ${autoVerify}::boolean THEN now() END,
                  CASE WHEN ${stampPassword}::boolean THEN now() END)
          ON CONFLICT (org_id, user_id) DO UPDATE
            SET last_login_at = now(),
                email_verified_at = COALESCE(user_security.email_verified_at, EXCLUDED.email_verified_at),
                password_changed_at = COALESCE(user_security.password_changed_at, EXCLUDED.password_changed_at)
        `);
        await tx.execute(sql`
          UPDATE users SET joined_at = now()
          WHERE org_id = ${org.id} AND id = ${user.id} AND joined_at IS NULL
        `);
      });
      if (autoVerify || stampPassword) await this.gates.invalidate(org.id, user.id);
    } catch (err) {
      this.logger.error({ err, orgId: org.id, userId: user.id }, 'sign-in bookkeeping failed');
    }

    try {
      await this.db.txAs({ orgId: org.id, userId: user.id }, async (tx) => {
        await this.audit.record(tx, {
          event: 'auth.login',
          status: 'success',
          orgId: org.id,
          actorType: 'user',
          actorId: user.id,
          recordId: user.id,
          payload: { method: input.method, remember: input.remember },
        });
        await this.outbox.emit(tx, {
          orgId: org.id,
          aggregateModule: 'auth',
          aggregateId: user.id,
          eventType: 'auth.login.succeeded',
          payload: { userUuid: user.uuid, method: input.method },
        });
      });
    } catch (err) {
      this.logger.error({ err, orgId: org.id, userId: user.id }, 'sign-in audit failed');
    }
  }

  /**
   * One function decides where a person lands (TW-AUTH-011), shared by login
   * and the session probe. Unfinished onboarding wins (for the Owner); then what the
   * person may open: someone who cannot open the dashboard but can work conversations goes to the inbox.
   */
  async landingFor(
    org: Pick<OrgRef, 'id' | 'settings'>,
    userId: number,
    isAdmin: boolean,
  ): Promise<Landing> {
    const grants = await this.rbac.grantsForUser(org.id, userId);
    // Finishing the workspace's onboarding (branding, profile) is the Owner's job: the owner-only settings key says who that is.
    const step = (org.settings as { onboardingStep?: string }).onboardingStep;
    if (step && step !== 'done' && this.rbac.can(grants, 'org.owner_settings.manage').allowed)
      return 'onboarding';
    if (isAdmin) return 'dashboard';
    // TW-RBAC-035: the landing follows what the person may open, not a role name. Reference sent Agents and Viewers to the team inbox
    // and Managers and above to the dashboard; the dashboard needs dash.dashboard.read, which the Manager preset and above hold.
    if (this.rbac.can(grants, 'dash.dashboard.read').allowed) return 'dashboard';
    return this.rbac.can(grants, 'inbox.conversation.read').allowed ? 'inbox' : 'dashboard';
  }

  // --- logout -------------------------------------------------------------------------------------------

  /**
   * Ends the session behind whichever credential the caller still holds.
   *
   * The access token lasts 15 minutes; a person who returns after lunch holds
   * only the refresh token, and that is the credential that would keep the
   * session alive. So sign-out must work from the refresh token alone, and from
   * an access token that has just expired (its signature still proves whose it
   * was). A credential that is missing or unverifiable ends nothing and is not
   * an error: signing out is always allowed to finish.
   */
  async logout(
    creds: { accessToken?: string | null; refreshToken?: string | null } = {},
  ): Promise<void> {
    const targets = new Map<string, { orgId: number; userId: number }>();
    const add = (claims: TokenClaims | undefined) => {
      if (claims?.typ === 'user' && claims.sid) {
        targets.set(claims.sid, { orgId: claims.org, userId: claims.sub });
      }
    };
    if (creds.accessToken) {
      add(await this.tokens.verifyAccessIgnoringExpiry(creds.accessToken).catch(() => undefined));
    }
    if (creds.refreshToken) {
      add(await this.tokens.verifyRefresh(creds.refreshToken).catch(() => undefined));
    }

    for (const [sid, who] of targets) {
      const ended = await this.sessions.revoke(who.orgId, sid, 'logout');
      if (!ended) continue;
      await this.audit.recordStandalone({
        event: 'auth.logout',
        status: 'info',
        orgId: who.orgId,
        actorType: 'user',
        actorId: who.userId,
        recordId: who.userId,
      });
    }
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
