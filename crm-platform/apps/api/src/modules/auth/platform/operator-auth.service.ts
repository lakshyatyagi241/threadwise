import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
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
import { EpochService } from '../sessions/epoch.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { CaptchaService } from '../security/captcha.service';
import { PasswordService } from '../security/password.service';
import { RateLimitService } from '../security/rate-limit.service';
import { consumeRecoveryCode, createRecoveryCodes } from '../support/recovery-codes';
import { randomToken } from '../support/crypto-utils';
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

const OPERATOR_SESSION_SECONDS = 12 * 60 * 60;

const toSummary = (o: OperatorRow): OperatorSummary => ({
  id: o.uuid,
  email: o.email,
  fullName: o.full_name,
  role: o.role,
  mfaEnabled: o.mfa_enabled,
});

/**
 * Platform operators (ADR-0019): staff of the company running the platform, not
 * of a customer. Same mechanics as tenant login (lockout, captcha, MFA step-up,
 * refresh rotation), different table and a stricter profile: 12-hour sessions,
 * no "remember me", MFA mandatory for `super_admin`, IP allowlist applied.
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

    const operator = await this.findByEmail(req.email);
    const ok = await this.passwords.verifyOrDummy(operator?.password_hash, req.password);
    if (!operator || !ok || operator.status !== 'active') {
      if (policy.lockoutAfterFailures > 0)
        await this.rate.hit(lockKey, policy.lockoutWindowMinutes * 60);
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

    if (operator.mfa_enabled) {
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
    const attempts = await this.redis.incr(attemptsKey);
    if (attempts === 1) await this.redis.expire(attemptsKey, Ttl.mfaChallengeSeconds);
    if (attempts > Ttl.mfaMaxAttempts) {
      await this.redis.del(key);
      throw expired();
    }

    const operator = await this.findById(challenge.operatorId);
    if (!operator || operator.status !== 'active') throw expired();

    let accepted = false;
    if (req.code && operator.mfa_secret_enc) {
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
    return this.complete(operator, true, meta);
  }

  private async complete(
    operator: OperatorRow,
    mfaVerified: boolean,
    meta: { ip?: string | null; userAgent?: string | null },
  ): Promise<OperatorLoginResponse> {
    const ep = await this.epoch.current();
    const sid = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO platform_sessions (operator_id, mfa_verified, ip, user_agent, expires_at)
        VALUES (${operator.id}, ${mfaVerified}, ${normalizeIp(meta.ip)}::inet, ${meta.userAgent?.slice(0, 512) ?? null},
                now() + make_interval(secs => ${OPERATOR_SESSION_SECONDS}))
        RETURNING uuid
      `);
      await tx.execute(
        sql`UPDATE platform_operators SET last_login_at = now() WHERE id = ${operator.id}`,
      );
      return (res.rows[0] as unknown as { uuid: string }).uuid;
    });
    await this.redis
      .set(AuthKeys.activity(sid), String(Date.now()), 'EX', 24 * 3600)
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
        rm: true,
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
    return {
      status: 'authenticated',
      tokens,
      operator: toSummary(operator),
      mfaEnrolmentRequired: operator.role === 'super_admin' && !operator.mfa_enabled,
    };
  }

  // --- refresh / logout / session -----------------------------------------------------------------------------

  async refresh(refreshToken: string): Promise<TokenPair> {
    const claims = await this.tokens.verifyRefresh(refreshToken);
    if (claims.typ !== 'platform_operator' || !claims.sid || claims.rv === undefined) {
      throw AppError.unauthenticated('Invalid or expired refresh token');
    }
    if ((claims.ep ?? 0) < (await this.epoch.current()))
      throw AppError.unauthenticated('Invalid or expired refresh token');

    const decision = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT s.id, s.refresh_version, s.rotated_at, s.expires_at, s.revoked_at, o.status
        FROM platform_sessions s JOIN platform_operators o ON o.id = s.operator_id
        WHERE s.uuid = ${claims.sid}::uuid AND s.operator_id = ${claims.sub}
        FOR UPDATE OF s
      `);
      const row = res.rows[0] as unknown as
        | {
            id: number;
            refresh_version: number;
            rotated_at: DateLike;
            expires_at: DateLike;
            revoked_at: DateLike | null;
            status: string;
          }
        | undefined;
      if (!row || row.revoked_at || toMs(row.expires_at) <= Date.now() || row.status !== 'active')
        return { ok: false as const };
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
        rm: true,
      },
      {
        refreshTtlSeconds: Math.max(
          60,
          Math.floor((decision.expiresAt.getTime() - Date.now()) / 1000),
        ),
      },
    );
  }

  async logout(): Promise<void> {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'platform_operator' || !ctx.sessionId) return;
    await this.store.tx(async (tx) => {
      await tx.execute(
        sql`UPDATE platform_sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE uuid = ${ctx.sessionId}::uuid AND revoked_at IS NULL`,
      );
    });
    await this.redis
      .set(AuthKeys.revoked(ctx.sessionId), '1', 'EX', Ttl.accessRevocationSeconds)
      .catch(() => undefined);
    await this.audit.recordStandalone({
      event: 'platform.auth.logout',
      status: 'info',
      actorType: 'platform_operator',
      actorId: ctx.actorId,
    });
  }

  async session(): Promise<OperatorSessionResponse> {
    const ctx = RequestContextStore.require();
    const operator = await this.findById(ctx.actorId!);
    if (!operator || operator.status !== 'active') throw AppError.unauthenticated();
    return {
      operator: toSummary(operator),
      mfaEnrolmentRequired: operator.role === 'super_admin' && !operator.mfa_enabled,
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

  async mfaSetup(): Promise<MfaSetupResponse> {
    const ctx = RequestContextStore.require();
    const operator = await this.findById(ctx.actorId!);
    if (!operator) throw AppError.unauthenticated();
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

  async mfaEnable(code: string): Promise<MfaEnableResponse> {
    const ctx = RequestContextStore.require();
    const operator = await this.findById(ctx.actorId!);
    if (!operator) throw AppError.unauthenticated();
    const stored = await this.redis.get(AuthKeys.mfaSetup(0, operator.uuid));
    if (!stored)
      throw new AppError(
        ERROR_CODES.AUTH_MFA_SETUP_EXPIRED,
        'Setup expired. Start again.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    const secret = this.crypto.decrypt(stored);
    const step = verifyTotp(secret, code);
    if (step === null)
      throw new AppError(
        ERROR_CODES.AUTH_MFA_INVALID_CODE,
        'That code is not valid.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

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
    await this.audit.recordStandalone({
      event: 'platform.auth.mfa_enabled',
      status: 'success',
      actorType: 'platform_operator',
      actorId: operator.id,
    });
    return { recoveryCodes: plain };
  }
}
