import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type MfaEnableResponse,
  type MfaSetupResponse,
  type MfaStatusResponse,
} from '@crm/contracts';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { toIsoString, type DateLike } from '../support/dates';
import { MfaAttemptLimiter } from '../support/mfa-attempts';
import { createRecoveryCodes, consumeRecoveryCode } from '../support/recovery-codes';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../support/totp';
import { AccountGateService } from './account-gate.service';
import { AuthAuditService } from './auth-audit.service';
import { PasswordService } from './password.service';

export interface MfaSecretState {
  enabled: boolean;
  secretEnc: string | null;
  lastStep: number | null;
  recoveryHashes: string[];
}

/**
 * TOTP lifecycle for staff users (TW-AUTH-030/032): setup, enable, disable,
 * recovery codes, and the verification used by the login challenge.
 *
 * The pending secret lives in Redis (encrypted, 10 minutes), not in the
 * database and not in a session: an abandoned setup leaves nothing behind.
 */
@Injectable()
export class MfaService {
  private readonly issuer: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly audit: AuthAuditService,
    private readonly gates: AccountGateService,
    private readonly limiter: MfaAttemptLimiter,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.issuer = config.get('APP_NAME', { infer: true });
  }

  async status(orgId: number, userId: number): Promise<MfaStatusResponse> {
    const state = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT mfa_enabled, mfa_confirmed_at, jsonb_array_length(mfa_recovery_hashes) AS remaining
        FROM user_security WHERE org_id = ${orgId} AND user_id = ${userId}
      `),
    );
    const row = state.rows[0] as unknown as
      { mfa_enabled: boolean; mfa_confirmed_at: DateLike | null; remaining: number } | undefined;
    const gate = await this.gates.stateFor(orgId, userId);
    return {
      enabled: row?.mfa_enabled ?? false,
      confirmedAt: row?.mfa_confirmed_at ? toIsoString(row.mfa_confirmed_at) : null,
      recoveryCodesRemaining: row?.remaining ?? 0,
      required: gate.mfaEnrolmentRequired || (row?.mfa_enabled ?? false),
    };
  }

  /** Idempotent within the TTL: reloading the pane shows the same secret. */
  async beginSetup(orgId: number, userId: number, email: string): Promise<MfaSetupResponse> {
    const current = await this.status(orgId, userId);
    if (current.enabled) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Two-factor authentication is already on.',
        HttpStatus.CONFLICT,
      );
    }
    const key = AuthKeys.mfaSetup(orgId, String(userId));
    const existing = await this.redis.get(key);
    const secret = existing ? this.crypto.decrypt(existing) : generateTotpSecret();
    if (!existing) {
      await this.redis.setex(key, Ttl.mfaSetupSeconds, this.crypto.encrypt(secret));
    }
    return {
      secret,
      otpauthUrl: otpauthUrl(this.issuer, email, secret),
      expiresInSeconds: Ttl.mfaSetupSeconds,
    };
  }

  async enable(orgId: number, userId: number, code: string): Promise<MfaEnableResponse> {
    // Five wrong codes in fifteen minutes, counted with sign-in and with the confirmation
    // passwords below: enrolling is a second-factor guess target too (TW-AUTH-030).
    await this.limiter.assertAvailable('user', orgId, userId);
    const key = AuthKeys.mfaSetup(orgId, String(userId));
    const stored = await this.redis.get(key);
    if (!stored) {
      throw new AppError(
        ERROR_CODES.AUTH_MFA_SETUP_EXPIRED,
        'Setup expired. Start again to get a new code.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const secret = this.crypto.decrypt(stored);
    const step = verifyTotp(secret, code);
    if (step === null) {
      await this.limiter.recordFailure('user', orgId, userId);
      await this.audit.recordStandalone({
        event: 'auth.mfa_failed',
        status: 'failure',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { phase: 'enrol' },
      });
      throw new AppError(
        ERROR_CODES.AUTH_MFA_INVALID_CODE,
        'That code is not valid.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // The pending secret is consumed first: of two simultaneous confirmations only
    // one gets to enrol (and to see the recovery codes); the other finds the setup gone.
    if ((await this.redis.del(key)) === 0) {
      throw new AppError(
        ERROR_CODES.AUTH_MFA_SETUP_EXPIRED,
        'Setup expired. Start again to get a new code.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { plain, hashes } = await createRecoveryCodes();
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await tx.execute(sql`
        INSERT INTO user_security (org_id, user_id, mfa_enabled, mfa_secret_enc, mfa_confirmed_at, mfa_last_step, mfa_recovery_hashes)
        VALUES (${orgId}, ${userId}, true, ${this.crypto.encrypt(secret)}, now(), ${step}, ${JSON.stringify(hashes)}::jsonb)
        ON CONFLICT (org_id, user_id) DO UPDATE
          SET mfa_enabled = true, mfa_secret_enc = EXCLUDED.mfa_secret_enc, mfa_confirmed_at = now(),
              mfa_last_step = EXCLUDED.mfa_last_step, mfa_recovery_hashes = EXCLUDED.mfa_recovery_hashes
      `);
      await this.audit.record(tx, {
        event: 'auth.mfa_enabled',
        status: 'success',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
      });
    });
    await this.limiter.clear('user', orgId, userId);
    await this.gates.invalidate(orgId, userId);
    return { recoveryCodes: plain };
  }

  async disable(orgId: number, userId: number, password: string): Promise<void> {
    await this.assertPassword(orgId, userId, password);
    // A policy that requires MFA does not block turning it off: the account
    // gate flags the user as needing to enrol again, which is the same outcome
    // without a second code path.
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await tx.execute(sql`
        UPDATE user_security
        SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_confirmed_at = NULL,
            mfa_last_step = NULL, mfa_recovery_hashes = '[]'::jsonb
        WHERE org_id = ${orgId} AND user_id = ${userId}
      `);
      await this.audit.record(tx, {
        event: 'auth.mfa_disabled',
        status: 'info',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
      });
    });
    await this.gates.invalidate(orgId, userId);
  }

  async regenerateRecoveryCodes(
    orgId: number,
    userId: number,
    password: string,
  ): Promise<MfaEnableResponse> {
    await this.assertPassword(orgId, userId, password);
    const status = await this.status(orgId, userId);
    if (!status.enabled) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        'Two-factor authentication is not on.',
        HttpStatus.CONFLICT,
      );
    }
    const { plain, hashes } = await createRecoveryCodes();
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await tx.execute(sql`
        UPDATE user_security SET mfa_recovery_hashes = ${JSON.stringify(hashes)}::jsonb
        WHERE org_id = ${orgId} AND user_id = ${userId}
      `);
      await this.audit.record(tx, {
        event: 'auth.mfa_recovery_regenerated',
        status: 'info',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
      });
    });
    return { recoveryCodes: plain };
  }

  // --- login challenge --------------------------------------------------------------------

  async loadState(orgId: number, userId: number): Promise<MfaSecretState> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT mfa_enabled, mfa_secret_enc, mfa_last_step, mfa_recovery_hashes
        FROM user_security WHERE org_id = ${orgId} AND user_id = ${userId}
      `),
    );
    const row = res.rows[0] as unknown as
      | {
          mfa_enabled: boolean;
          mfa_secret_enc: string | null;
          mfa_last_step: number | null;
          mfa_recovery_hashes: string[];
        }
      | undefined;
    return {
      enabled: row?.mfa_enabled ?? false,
      secretEnc: row?.mfa_secret_enc ?? null,
      lastStep: row?.mfa_last_step ?? null,
      recoveryHashes: row?.mfa_recovery_hashes ?? [],
    };
  }

  /**
   * Checks an authenticator code and records its time-step so it cannot be
   * replayed. Returns whether it was accepted.
   */
  async verifyCode(
    orgId: number,
    userId: number,
    state: MfaSecretState,
    code: string,
  ): Promise<boolean> {
    if (!state.secretEnc) return false;
    const step = verifyTotp(this.crypto.decrypt(state.secretEnc), code, Date.now(), state.lastStep);
    if (step === null) return false;
    // Advance the spent time-step only if nobody did meanwhile: two simultaneous
    // submissions of the same code cannot both pass.
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        UPDATE user_security SET mfa_last_step = ${step}
        WHERE org_id = ${orgId} AND user_id = ${userId}
          AND (mfa_last_step IS NULL OR mfa_last_step < ${step})
        RETURNING 1
      `),
    );
    return res.rows.length > 0;
  }

  /** Consumes a recovery code. Returns whether one matched. */
  async verifyRecoveryCode(
    orgId: number,
    userId: number,
    state: MfaSecretState,
    candidate: string,
  ): Promise<boolean> {
    const remaining = await consumeRecoveryCode(state.recoveryHashes, candidate);
    if (remaining === null) return false;
    await this.db.txAs({ orgId, userId }, async (tx) => {
      await tx.execute(sql`
        UPDATE user_security SET mfa_recovery_hashes = ${JSON.stringify(remaining)}::jsonb
        WHERE org_id = ${orgId} AND user_id = ${userId}
      `);
      await this.audit.record(tx, {
        event: 'auth.mfa_recovery_used',
        status: 'warning',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { remaining: remaining.length },
      });
    });
    return true;
  }

  /** The password gate of disable / regenerate: wrong guesses draw on the same budget as wrong codes. */
  private async assertPassword(orgId: number, userId: number, password: string): Promise<void> {
    await this.limiter.assertAvailable('user', orgId, userId);
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`SELECT password_hash FROM users WHERE org_id = ${orgId} AND id = ${userId}`),
    );
    const hash = (res.rows[0] as unknown as { password_hash: string | null } | undefined)
      ?.password_hash;
    if (!(await this.passwords.verifyOrDummy(hash, password))) {
      await this.limiter.recordFailure('user', orgId, userId);
      await this.audit.recordStandalone({
        event: 'auth.mfa_failed',
        status: 'failure',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { phase: 'confirm' },
      });
      throw new AppError(
        ERROR_CODES.AUTH_CURRENT_PASSWORD_WRONG,
        'The password you entered is not correct.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }
}
