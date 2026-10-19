import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  MFA_REAUTH_WINDOW_SECONDS,
  type MfaEnableResponse,
  type MfaLoginRequest,
  type MfaSetupResponse,
  type OperatorLoginRequest,
  type OperatorLoginResponse,
  type OperatorSessionResponse,
  type OperatorSummary,
  type TokenPair,
} from '@crm/contracts';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { incrWithTtl } from '../../../infra/redis/incr-with-ttl';
import { LoginAlertService } from '../flows/login-alert.service';
import { EpochService } from '../sessions/epoch.service';
import { idleTimeoutError } from '../sessions/session.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { CaptchaService } from '../security/captcha.service';
import { PasswordService } from '../security/password.service';
import { RateLimitService } from '../security/rate-limit.service';
import { MfaAttemptLimiter } from '../support/mfa-attempts';
import { consumeRecoveryCode, createRecoveryCodes } from '../support/recovery-codes';
import { MailService } from '../mail/mail.service';
import { AccountAttackGuard } from '../security/account-attack.service';
import { WebAuthnService } from '../security/webauthn.service';
import { randomToken, sha256Hex } from '../support/crypto-utils';
import { toMs, type DateLike } from '../support/dates';
import { ipAllowed, normalizeIp } from '../support/ip';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../support/totp';
import { TokenService } from '../token.service';
import { PlatformStore } from './platform-store';
import { SecurityPolicyService } from './security-policy.service';

interface OperatorRow {
  id: number;
  uuid: string;
  email: string;
  full_name: string;
  password_hash: string;
  role: 'super_admin' | 'support' | 'auditor';
  status: 'active' | 'suspended';
  mfa_enabled: boolean;
  mfa_secret_enc: string | null;
  mfa_last_step: number | null;
  mfa_recovery_hashes: string[];
}

interface OperatorChallenge {
  operatorId: number;
}

/** Absolute lifetime of an operator session. Operators have no "keep me signed in". */
const OPERATOR_SESSION_SECONDS = 12 * 60 * 60;

const toSummary = (o: OperatorRow): OperatorSummary => ({
  id: o.uuid,
  email: o.email,
  fullName: o.full_name,
  role: o.role,
  mfaEnabled: o.mfa_enabled,
});

/**
 * Platform operators: staff of the company running the platform, not
 * of a customer. Same mechanics as tenant login (lockout, captcha, MFA step-up,
 * refresh rotation, idle timeout, session cap, new-device alert), different
 * table and a stricter profile: 12-hour sessions, no "remember me", MFA
 * mandatory for `super_admin` and wherever the security policy asks for it
 * (operators are Reference's "admins"), IP allowlist applied.
 */
@Injectable()
export class OperatorAuthService {
  private readonly issuer: string;

  constructor(
    private readonly store: PlatformStore,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly policy: SecurityPolicyService,
    private readonly rate: RateLimitService,
    private readonly audit: AuthAuditService,
    private readonly captcha: CaptchaService,
    private readonly epoch: EpochService,
    private readonly crypto: CryptoService,
    private readonly mfaLimiter: MfaAttemptLimiter,
    private readonly alerts: LoginAlertService,
    private readonly attack: AccountAttackGuard,
    private readonly mail: MailService,
    private readonly webauthn: WebAuthnService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.issuer = `${config.get('APP_NAME', { infer: true })} Platform`;
  }

  // --- access rules ---------------------------------------------------------------------------------

  /** Shared by login and the route guard so both apply the same allowlist. */
  async assertIpAllowed(ip: string | null | undefined, route: string): Promise<void> {
    const policy = await this.policy.policy();
    // Disabled, or enabled with an empty list, lets everyone in: an empty list
    // must not be able to lock every operator out.
    if (!policy.ipAllowlistEnabled || policy.ipAllowlistCidrs.length === 0) return;
    const addr = normalizeIp(ip);
    if (addr && ipAllowed(addr, policy.ipAllowlistCidrs)) return;
    await this.audit.recordStandalone({
      event: 'platform.access.blocked_by_ip',
      status: 'failure',
      actorType: 'platform_operator',
      payload: { route, cidrs: policy.ipAllowlistCidrs.length },
    });
    throw new AppError(
      ERROR_CODES.AUTH_IP_BLOCKED,
      `Access from ${addr ?? 'this address'} is not allowed.`,
      HttpStatus.FORBIDDEN,
      [{ path: 'ip', message: addr ?? '' }],
    );
  }

  /**
   * Must this operator have a second factor? Super admins when the policy's
   * `requireMfaForSuperAdmins` switch is on; everyone else when the policy asks for it. Operators are the platform's
   * "admins", and each owns their own seat, so all three switches (everyone,
   * admins, owners) reach them (TW-AUTH-032).
   */
  async mfaRequired(operator: Pick<OperatorRow, 'role'>): Promise<boolean> {
    const p = await this.policy.policy();
    if (operator.role === 'super_admin') return p.requireMfaForSuperAdmins;
    return p.requireMfaForAll || p.requireMfaForAdmins || p.requireMfaForOwners;
  }

  async mfaEnrolmentRequired(
    operator: Pick<OperatorRow, 'role' | 'mfa_enabled'>,
  ): Promise<boolean> {
    return !operator.mfa_enabled && (await this.mfaRequired(operator));
  }

  private async findByEmail(email: string): Promise<OperatorRow | undefined> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`SELECT * FROM platform_operators WHERE email = ${email}`);
      return res.rows[0] as unknown as OperatorRow | undefined;
    });
  }

  async findById(id: number): Promise<OperatorRow | undefined> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(sql`SELECT * FROM platform_operators WHERE id = ${id}`);
      return res.rows[0] as unknown as OperatorRow | undefined;
    });
  }

  // --- login ------------------------------------------------------------------------------------------------

  async login(
    req: OperatorLoginRequest,
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<OperatorLoginResponse> {
    await this.assertIpAllowed(meta.ip, 'platform/auth/login');
    const policy = await this.policy.policy();
    const ip = normalizeIp(meta.ip) ?? 'unknown';
    const lockKey = AuthKeys.lockout(0, req.email, ip);

    if (policy.lockoutAfterFailures > 0) {
      const state = await this.rate.peek(lockKey);
      if (state.count >= policy.lockoutAfterFailures) {
        await this.audit.recordStandalone({
          event: 'platform.auth.lockout',
          status: 'warning',
          actorType: 'platform_operator',
          payload: { identifier: req.email },
        });
        throw new AppError(
          ERROR_CODES.AUTH_ACCOUNT_LOCKED,
          `Too many failed attempts. Try again in ${Math.max(1, Math.ceil(state.retryAfterSeconds / 60))} minute(s).`,
          HttpStatus.TOO_MANY_REQUESTS,
          [{ path: 'retryAfterSeconds', message: String(state.retryAfterSeconds) }],
        );
      }
    }
    await this.captcha.assert(req.captchaToken, 'operator');
    // Guesses spread over many addresses never trip the per-address lockout above; this counts the operator account itself.
    await this.attack.assertAllowed(
      'operator',
      0,
      req.email,
      normalizeIp(meta.ip),
      req.captchaToken,
      policy,
    );

    const operator = await this.findByEmail(req.email);
    const ok = await this.passwords.verifyOrDummy(operator?.password_hash, req.password);
    if (!operator || !ok || operator.status !== 'active') {
      if (policy.lockoutAfterFailures > 0)
        await this.rate.hit(lockKey, policy.lockoutWindowMinutes * 60);
      await this.attack.recordFailure('operator', 0, req.email, policy);
      await this.audit.recordStandalone({
        event: 'platform.auth.failed',
        status: 'failure',
        actorType: 'platform_operator',
        actorId: operator?.id ?? null,
        payload: { identifier: req.email },
      });
      throw new AppError(
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        'Those credentials do not match.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.rate.reset(lockKey);

    // A super admin is challenged only while the switch is on, even if they enrolled earlier.
    if (
      operator.mfa_enabled &&
      (operator.role !== 'super_admin' || (await this.mfaRequired(operator)))
    ) {
      const token = randomToken(32);
      await this.redis.setex(
        AuthKeys.mfaChallenge(token),
        Ttl.mfaChallengeSeconds,
        JSON.stringify({ operatorId: operator.id } satisfies OperatorChallenge),
      );
      return {
        status: 'mfa_required',
        challengeToken: token,
        expiresInSeconds: Ttl.mfaChallengeSeconds,
        passkey: (await this.webauthn.count({ pool: 'operator', operatorId: operator.id })) > 0,
      };
    }
    return this.complete(operator, false, meta);
  }

  async loginMfa(
    req: MfaLoginRequest,
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<OperatorLoginResponse> {
    await this.assertIpAllowed(meta.ip, 'platform/auth/login/mfa');
    const key = AuthKeys.mfaChallenge(req.challengeToken);
    const raw = await this.redis.get(key);
    const expired = () =>
      new AppError(
        ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED,
        'That sign-in expired. Start again.',
        HttpStatus.UNAUTHORIZED,
      );
    if (!raw) throw expired();
    const challenge = JSON.parse(raw) as OperatorChallenge;
    // An operator challenge is never valid for a tenant user: the payload shape differs.
    if (typeof challenge.operatorId !== 'number') throw expired();

    const attemptsKey = AuthKeys.mfaAttempts(req.challengeToken);
    const attempts = await incrWithTtl(this.redis, attemptsKey, Ttl.mfaChallengeSeconds);
    if (attempts > Ttl.mfaMaxAttempts) {
      await this.redis.del(key);
      throw expired();
    }

    const operator = await this.findById(challenge.operatorId);
    if (!operator || operator.status !== 'active') throw expired();
    // Across challenges: a new challenge costs only the password (TW-AUTH-030).
    await this.mfaLimiter.assertAvailable('operator', 0, operator.id);

    let accepted = false;
    if (req.webauthn) {
      accepted = await this.webauthn.verifyLogin(
        { pool: 'operator', operatorId: operator.id },
        sha256Hex(req.challengeToken),
        req.webauthn,
      );
    } else if (req.code && operator.mfa_secret_enc) {
      const step = verifyTotp(
        this.crypto.decrypt(operator.mfa_secret_enc),
        req.code,
        Date.now(),
        operator.mfa_last_step,
      );
      if (step !== null) {
        accepted = true;
        await this.store.tx(async (tx) => {
          await tx.execute(
            sql`UPDATE platform_operators SET mfa_last_step = ${step} WHERE id = ${operator.id}`,
          );
        });
      }
    } else if (req.recoveryCode) {
      const remaining = await consumeRecoveryCode(operator.mfa_recovery_hashes, req.recoveryCode);
      if (remaining) {
        accepted = true;
        await this.store.tx(async (tx) => {
          await tx.execute(
            sql`UPDATE platform_operators SET mfa_recovery_hashes = ${JSON.stringify(remaining)}::jsonb WHERE id = ${operator.id}`,
          );
        });
      }
    }
    if (!accepted) {
      await this.mfaLimiter.recordFailure('operator', 0, operator.id);
      await this.audit.recordStandalone({
        event: 'platform.auth.mfa_failed',
        status: 'failure',
        actorType: 'platform_operator',
        actorId: operator.id,
      });
      throw new AppError(
        ERROR_CODES.AUTH_MFA_INVALID_CODE,
        'That code is not valid.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.redis.del(key, attemptsKey);
    await this.mfaLimiter.clear('operator', 0, operator.id);
    return this.complete(operator, true, meta);
  }

  private async complete(
    operator: OperatorRow,
    mfaVerified: boolean,
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<OperatorLoginResponse> {
    const ep = await this.epoch.current();
    const policy = await this.policy.policy();
    void this.attack.rememberNetwork('operator', 0, operator.email, normalizeIp(meta.ip));
    const { sid, evicted } = await this.store.tx(async (tx) => {
      // One operator's issuance is serial, so two sign-ins cannot both slip under the cap.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-sessions:${operator.id}`}, 0))`,
      );
      // Concurrent-session cap (TW-AUTH-034) applies to operators like users: the oldest go.
      let victims: string[] = [];
      if (policy.maxConcurrentSessions > 0) {
        const live = await tx.execute(sql`
          SELECT uuid FROM platform_sessions
          WHERE operator_id = ${operator.id} AND revoked_at IS NULL AND expires_at > now()
          ORDER BY last_used_at ASC
        `);
        const over = live.rows.length - policy.maxConcurrentSessions + 1;
        if (over > 0) {
          victims = (live.rows as unknown as Array<{ uuid: string }>)
            .slice(0, over)
            .map((r) => r.uuid);
          await tx.execute(sql`
            UPDATE platform_sessions SET revoked_at = now(), revoked_reason = 'session_cap'
            WHERE operator_id = ${operator.id}
              AND uuid IN (${sql.join(
                victims.map((v) => sql`${v}::uuid`),
                sql`, `,
              )})
          `);
        }
      }
      const res = await tx.execute(sql`
        INSERT INTO platform_sessions (operator_id, mfa_verified, ip, user_agent, expires_at)
        VALUES (${operator.id}, ${mfaVerified}, ${normalizeIp(meta.ip)}::inet, ${meta.userAgent?.slice(0, 512) ?? null},
                now() + make_interval(secs => ${OPERATOR_SESSION_SECONDS}))
        RETURNING uuid
      `);
      await tx.execute(
        sql`UPDATE platform_operators SET last_login_at = now() WHERE id = ${operator.id}`,
      );
      return { sid: (res.rows[0] as unknown as { uuid: string }).uuid, evicted: victims };
    });
    await Promise.all(
      evicted.map((id) =>
        this.redis
          .set(AuthKeys.revoked(id), '1', 'EX', Ttl.accessRevocationSeconds)
          .catch(() => undefined),
      ),
    );
    if (evicted.length > 0) {
      await this.audit.recordStandalone({
        event: 'platform.auth.concurrent_sessions_evicted',
        status: 'warning',
        actorType: 'platform_operator',
        actorId: operator.id,
        payload: { cap: policy.maxConcurrentSessions, evicted: evicted.length },
      });
    }
    await this.redis
      .set(AuthKeys.activity(sid), String(Date.now()), 'EX', 24 * 3600)
      .catch(() => undefined);
    await this.redis
      .set(AuthKeys.capChecked(sid), String(policy.maxConcurrentSessions), 'EX', 24 * 3600)
      .catch(() => undefined);

    const tokens = await this.tokens.issue(
      {
        sub: operator.id,
        org: 0,
        typ: 'platform_operator',
        uid: operator.uuid,
        sid,
        ep,
        rv: 1,
        // Operators cannot ask to be remembered, so the idle rule always applies to them.
        rm: false,
      },
      { refreshTtlSeconds: OPERATOR_SESSION_SECONDS },
    );
    await this.audit.recordStandalone({
      event: 'platform.auth.login',
      status: 'success',
      actorType: 'platform_operator',
      actorId: operator.id,
      payload: { role: operator.role },
    });
    // New device / new location, for operators as for users (TW-AUTH-018); never fails the sign-in.
    void this.alerts.check({
      subject: { kind: 'operator', operatorId: operator.id },
      email: operator.email,
      name: operator.full_name,
      sessionId: sid,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    });
    return {
      status: 'authenticated',
      tokens,
      operator: toSummary(operator),
      mfaEnrolmentRequired: await this.mfaEnrolmentRequired(operator),
    };
  }

  /**
   * The cap was lowered after this operator session opened: trim the live set
   * to the newest `cap` on the next request (the user-side twin lives in
   * SessionService). Never throws.
   */
  async enforceCapIfChanged(
    operatorId: number,
    sid: string,
    cap: number,
    marker: string | null,
  ): Promise<void> {
    if (marker === String(cap)) return;
    try {
      if (cap > 0) {
        const victims = await this.store.tx(async (tx) => {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-sessions:${operatorId}`}, 0))`,
          );
          const live = await tx.execute(sql`
            SELECT uuid FROM platform_sessions
            WHERE operator_id = ${operatorId} AND revoked_at IS NULL AND expires_at > now()
            ORDER BY (uuid = ${sid}::uuid) DESC, last_used_at DESC, uuid DESC
          `);
          const doomed = (live.rows as unknown as Array<{ uuid: string }>)
            .slice(cap)
            .map((r) => r.uuid);
          if (doomed.length === 0) return doomed;
          await tx.execute(sql`
            UPDATE platform_sessions SET revoked_at = now(), revoked_reason = 'session_cap'
            WHERE operator_id = ${operatorId}
              AND uuid IN (${sql.join(
                doomed.map((v) => sql`${v}::uuid`),
                sql`, `,
              )})
          `);
          return doomed;
        });
        await Promise.all(
          victims.map((id) =>
            this.redis
              .set(AuthKeys.revoked(id), '1', 'EX', Ttl.accessRevocationSeconds)
              .catch(() => undefined),
          ),
        );
        if (victims.length > 0) {
          await this.audit.recordStandalone({
            event: 'platform.auth.concurrent_sessions_evicted',
            status: 'warning',
            actorType: 'platform_operator',
            actorId: operatorId,
            payload: { cap, evicted: victims.length, trigger: 'cap_lowered' },
          });
        }
      }
      await this.redis
        .set(AuthKeys.capChecked(sid), String(cap), 'EX', 24 * 3600)
        .catch(() => undefined);
    } catch {
      // A failing sweep must not fail the request that triggered it.
    }
  }

  // --- refresh / logout / session -----------------------------------------------------------------------------

  async refresh(refreshToken: string): Promise<TokenPair> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    if (claims.typ !== 'platform_operator' || !claims.sid || claims.rv === undefined) {
      throw AppError.unauthenticated('Invalid or expired refresh token');
    }
    if ((claims.ep ?? 0) < (await this.epoch.current()))
      throw AppError.unauthenticated('Invalid or expired refresh token');

    const policy = await this.policy.policy();
    const lastActivity = Number(
      (await this.redis.get(AuthKeys.activity(claims.sid)).catch(() => null)) ?? 0,
    );
    const decision = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.id, s.refresh_version, s.rotated_at, s.last_used_at, s.expires_at, s.revoked_at,
               s.revoked_reason, o.status
        FROM platform_sessions s JOIN platform_operators o ON o.id = s.operator_id
        WHERE s.uuid = ${claims.sid}::uuid AND s.operator_id = ${claims.sub}
        FOR UPDATE OF s
      `);
      const row = res.rows[0] as unknown as
        | {
            id: number;
            refresh_version: number;
            rotated_at: DateLike;
            last_used_at: DateLike;
            expires_at: DateLike;
            revoked_at: DateLike | null;
            revoked_reason: string | null;
            status: string;
          }
        | undefined;
      if (row?.revoked_reason === 'idle') return { ok: false as const, idle: true as const };
      if (!row || row.revoked_at || toMs(row.expires_at) <= Date.now() || row.status !== 'active')
        return { ok: false as const };
      // Idle timeout (TW-AUTH-033): operators cannot be "remembered", so it always applies.
      const idleMs = policy.sessionTimeoutMinutes * 60_000;
      const active = Math.max(toMs(row.last_used_at), lastActivity);
      if (idleMs > 0 && Date.now() - active > idleMs) {
        await tx.execute(
          sql`UPDATE platform_sessions SET revoked_at = now(), revoked_reason = 'idle' WHERE id = ${row.id}`,
        );
        return {
          ok: false as const,
          idle: true as const,
          idleSeconds: Math.round((Date.now() - active) / 1000),
        };
      }
      const grace = Date.now() - toMs(row.rotated_at) <= Ttl.refreshGraceSeconds * 1000;
      if (claims.rv === row.refresh_version) {
        await tx.execute(
          sql`UPDATE platform_sessions SET refresh_version = refresh_version + 1, rotated_at = now(), last_used_at = now() WHERE id = ${row.id}`,
        );
        return {
          ok: true as const,
          rv: row.refresh_version + 1,
          expiresAt: new Date(toMs(row.expires_at)),
        };
      }
      if (claims.rv === row.refresh_version - 1 && grace) {
        return {
          ok: true as const,
          rv: row.refresh_version,
          expiresAt: new Date(toMs(row.expires_at)),
        };
      }
      await tx.execute(
        sql`UPDATE platform_sessions SET revoked_at = now(), revoked_reason = 'refresh_reuse' WHERE id = ${row.id}`,
      );
      return { ok: false as const };
    });
    if (!decision.ok) {
      await this.redis
        .set(AuthKeys.revoked(claims.sid), '1', 'EX', Ttl.accessRevocationSeconds)
        .catch(() => undefined);
      if ('idleSeconds' in decision) {
        await this.audit.recordStandalone({
          event: 'platform.auth.session_timeout',
          status: 'warning',
          actorType: 'platform_operator',
          actorId: claims.sub,
          payload: {
            idleSeconds: decision.idleSeconds,
            limitMinutes: policy.sessionTimeoutMinutes,
          },
        });
      }
      if ('idle' in decision) throw idleTimeoutError(policy.sessionTimeoutMinutes);
      throw AppError.unauthenticated('Invalid or expired refresh token');
    }
    await this.redis
      .set(AuthKeys.activity(claims.sid), String(Date.now()), 'EX', 24 * 3600)
      .catch(() => undefined);
    return this.tokens.issue(
      {
        sub: claims.sub,
        org: 0,
        typ: 'platform_operator',
        uid: claims.uid,
        sid: claims.sid,
        ep: await this.epoch.current(),
        rv: decision.rv,
        rm: false,
      },
      {
        refreshTtlSeconds: Math.max(
          60,
          Math.floor((decision.expiresAt.getTime() - Date.now()) / 1000),
        ),
      },
    );
  }

  /**
   * Ends the operator session behind the access token (even an expired one) and/or the refresh token
   * the browser still holds, so signing out always works, as for users. A request that already carries
   * an authenticated operator context uses it as well.
   */
  async logout(
    creds: { accessToken?: string | null; refreshToken?: string | null } | string | null = {},
  ): Promise<void> {
    const given = typeof creds === 'string' || creds === null ? { refreshToken: creds } : creds;
    const targets = new Map<string, number | null>();
    const add = (claims: { typ?: string; sid?: string; sub: number } | undefined) => {
      if (claims?.typ === 'platform_operator' && claims.sid) targets.set(claims.sid, claims.sub);
    };
    const ctx = RequestContextStore.peek();
    if (ctx?.actorType === 'platform_operator' && ctx.sessionId) {
      targets.set(ctx.sessionId, ctx.actorId ?? null);
    }
    if (given.accessToken) {
      add(await this.tokens.verifyAccessIgnoringExpiry(given.accessToken).catch(() => undefined));
    }
    if (given.refreshToken) {
      add(await this.tokens.verifyRefresh(given.refreshToken).catch(() => undefined));
    }

    for (const [sid, operatorId] of targets) {
      const ended = await this.store.tx(async (tx) => {
        const res = await tx.execute(
          sql`UPDATE platform_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE uuid = ${sid}::uuid AND revoked_at IS NULL RETURNING 1`,
        );
        return res.rows.length;
      });
      await this.redis
        .set(AuthKeys.revoked(sid), '1', 'EX', Ttl.accessRevocationSeconds)
        .catch(() => undefined);
      if (!ended) continue;
      await this.audit.recordStandalone({
        event: 'platform.auth.logout',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
      });
    }
  }

  async session(): Promise<OperatorSessionResponse> {
    const ctx = RequestContextStore.require();
    const operator = await this.findById(ctx.actorId!);
    if (!operator || operator.status !== 'active') throw AppError.unauthenticated();
    return {
      operator: toSummary(operator),
      mfaEnrolmentRequired: await this.mfaEnrolmentRequired(operator),
      sessionId: ctx.sessionId ?? '',
    };
  }

  /** Revokes every operator session (used by "revoke all sessions"). */
  async revokeAllSessions(): Promise<number> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`UPDATE platform_sessions SET revoked_at = now(), revoked_reason = 'revoke_all' WHERE revoked_at IS NULL RETURNING 1`,
      );
      return res.rows.length;
    });
  }

  // --- MFA enrolment ------------------------------------------------------------------------------------------------

  /**
   * Recent authentication, as for staff users: a session that signed in within MFA_REAUTH_WINDOW_SECONDS passes, an older
   * one must send the password. Enrolling the attacker's authenticator on a hijacked operator session would hand over the
   * highest-privilege account, so this matters more here than anywhere.
   */
  private async assertRecentAuth(operator: OperatorRow, password?: string): Promise<void> {
    if (password) {
      await this.mfaLimiter.assertAvailable('operator', 0, operator.id);
      if (!(await this.passwords.verifyOrDummy(operator.password_hash, password))) {
        await this.mfaLimiter.recordFailure('operator', 0, operator.id);
        await this.audit.recordStandalone({
          event: 'platform.auth.mfa_failed',
          status: 'failure',
          actorType: 'platform_operator',
          actorId: operator.id,
          payload: { phase: 'confirm' },
        });
        throw new AppError(
          ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG,
          'The password you entered is not correct.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return;
    }
    const sid = RequestContextStore.peek()?.sessionId;
    if (sid) {
      const res = await this.store.tx(async (tx) =>
        tx.execute(sql`
          SELECT (now() - created_at) < make_interval(secs => ${MFA_REAUTH_WINDOW_SECONDS}) AS fresh
          FROM platform_sessions WHERE operator_id = ${operator.id} AND uuid = ${sid}::uuid
        `),
      );
      if ((res.rows[0] as { fresh?: boolean } | undefined)?.fresh === true) return;
    }
    throw new AppError(
      ERROR_CODES.AUTH_REAUTH_REQUIRED,
      'Confirm your password to continue.',
      HttpStatus.FORBIDDEN,
    );
  }

  /** Options for "Use a passkey" at the operator's second-factor step. */
  async passkeyLoginOptions(challengeToken: string) {
    const raw = await this.redis.get(AuthKeys.mfaChallenge(challengeToken));
    if (!raw)
      throw new AppError(
        ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED,
        'That sign-in expired. Start again.',
        HttpStatus.UNAUTHORIZED,
      );
    const challenge = JSON.parse(raw) as OperatorChallenge;
    if (typeof challenge.operatorId !== 'number') {
      throw new AppError(
        ERROR_CODES.AUTH_MFA_CHALLENGE_EXPIRED,
        'That sign-in expired. Start again.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    await this.mfaLimiter.assertAvailable('operator', 0, challenge.operatorId);
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
      { pool: 'operator', operatorId: challenge.operatorId },
      sha256Hex(challengeToken),
    );
  }

  // --- passkeys of the signed-in operator ----------------------------------------------------------------------

  private async currentOperator(): Promise<OperatorRow> {
    const ctx = RequestContextStore.require();
    const operator = await this.findById(ctx.actorId!);
    if (!operator) throw AppError.unauthenticated();
    return operator;
  }

  async listPasskeys() {
    const operator = await this.currentOperator();
    return { data: await this.webauthn.list({ pool: 'operator', operatorId: operator.id }) };
  }

  private assertMfaOn(operator: OperatorRow): void {
    if (!operator.mfa_enabled) {
      throw new AppError(
        ERROR_CODES.AUTH_PASSKEY_NEEDS_MFA,
        'Turn on two-factor authentication with an authenticator app first, then add a passkey.',
        HttpStatus.CONFLICT,
      );
    }
  }

  async passkeyOptions(password?: string) {
    const operator = await this.currentOperator();
    this.assertMfaOn(operator);
    await this.assertRecentAuth(operator, password);
    return this.webauthn.registrationOptions(
      { pool: 'operator', operatorId: operator.id },
      { userName: operator.email, displayName: operator.full_name },
    );
  }

  async registerPasskey(response: Record<string, unknown>, name: string, password?: string) {
    const operator = await this.currentOperator();
    this.assertMfaOn(operator);
    await this.assertRecentAuth(operator, password);
    const item = await this.webauthn.register(
      { pool: 'operator', operatorId: operator.id },
      response,
      name,
    );
    void this.mail.sendMfaChanged(
      operator.email,
      operator.full_name,
      'passkey-added',
      this.mail.link('/platform/login', {}),
    );
    return item;
  }

  async removePasskey(id: string, password: string) {
    const operator = await this.currentOperator();
    await this.assertRecentAuth(operator, password);
    if (!(await this.webauthn.remove({ pool: 'operator', operatorId: operator.id }, id)))
      throw AppError.notFound('Passkey', id);
    void this.mail.sendMfaChanged(
      operator.email,
      operator.full_name,
      'passkey-removed',
      this.mail.link('/platform/login', {}),
    );
    return { ok: true };
  }

  async mfaSetup(password?: string): Promise<MfaSetupResponse> {
    const ctx = RequestContextStore.require();
    const operator = await this.findById(ctx.actorId!);
    if (!operator) throw AppError.unauthenticated();
    await this.assertRecentAuth(operator, password);
    if (operator.mfa_enabled)
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Two-factor authentication is already on.',
        HttpStatus.CONFLICT,
      );
    const key = AuthKeys.mfaSetup(0, operator.uuid);
    const existing = await this.redis.get(key);
    const secret = existing ? this.crypto.decrypt(existing) : generateTotpSecret();
    if (!existing) await this.redis.setex(key, Ttl.mfaSetupSeconds, this.crypto.encrypt(secret));
    return {
      secret,
      otpauthUrl: otpauthUrl(this.issuer, operator.email, secret),
      expiresInSeconds: Ttl.mfaSetupSeconds,
    };
  }

  async mfaEnable(code: string, password?: string): Promise<MfaEnableResponse> {
    const ctx = RequestContextStore.require();
    const operator = await this.findById(ctx.actorId!);
    if (!operator) throw AppError.unauthenticated();
    // A wrong enrolment code counts against the same budget as a wrong sign-in code.
    await this.mfaLimiter.assertAvailable('operator', 0, operator.id);
    await this.assertRecentAuth(operator, password);
    const stored = await this.redis.get(AuthKeys.mfaSetup(0, operator.uuid));
    if (!stored)
      throw new AppError(
        ERROR_CODES.AUTH_MFA_SETUP_EXPIRED,
        'Setup expired. Start again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const secret = this.crypto.decrypt(stored);
    const step = verifyTotp(secret, code);
    if (step === null) {
      await this.mfaLimiter.recordFailure('operator', 0, operator.id);
      await this.audit.recordStandalone({
        event: 'platform.auth.mfa_failed',
        status: 'failure',
        actorType: 'platform_operator',
        actorId: operator.id,
        payload: { phase: 'enrol' },
      });
      throw new AppError(
        ERROR_CODES.AUTH_MFA_INVALID_CODE,
        'That code is not valid.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const { plain, hashes } = await createRecoveryCodes();
    await this.store.tx(async (tx) => {
      await tx.execute(sql`
        UPDATE platform_operators
        SET mfa_enabled = true, mfa_secret_enc = ${this.crypto.encrypt(secret)}, mfa_confirmed_at = now(),
            mfa_last_step = ${step}, mfa_recovery_hashes = ${JSON.stringify(hashes)}::jsonb
        WHERE id = ${operator.id}
      `);
    });
    await this.redis.del(AuthKeys.mfaSetup(0, operator.uuid));
    await this.mfaLimiter.clear('operator', 0, operator.id);
    await this.audit.recordStandalone({
      event: 'platform.auth.mfa_enabled',
      status: 'success',
      actorType: 'platform_operator',
      actorId: operator.id,
    });
    void this.mail.sendMfaChanged(
      operator.email,
      operator.full_name,
      'enabled',
      this.mail.link('/platform/login', {}),
    );
    return { recoveryCodes: plain };
  }
}
