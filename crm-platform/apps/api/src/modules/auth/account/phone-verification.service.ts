import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type PhoneVerificationChallenge,
  type PhoneVerificationConfirmRequest,
  type PhoneVerificationConfirmResponse,
  type PhoneVerificationResendResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import {
  OTP_SENDER_PORT,
  type OtpSenderPort,
} from '../../../infra/providers/auth-registration-security/otp-sender.port';
import { maskPhone } from '../flows/phone-mask';
import { RegistrationOtpService } from '../platform/registration-otp.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { AuthAuditService } from '../security/auth-audit.service';
import { RateLimitService } from '../security/rate-limit.service';
import { randomNumericCode } from '../support/crypto-utils';
import { normalizeIp } from '../support/ip';
import { AuthKeys } from '../support/redis-keys';

/** What waits in Redis for one person's number: the number the code was sent to (not whatever the profile says by the time it comes back). */
interface PendingVerification {
  phoneE164: string;
  otpHash: string;
  expiresAt: number;
  lastSentAt: number;
}

/** The same limits as the sign-up code and the phone sign-in code, so no door is a cheaper way to send codes to a number. */
const SENDS_PER_NUMBER_PER_HOUR = 5;
const SENDS_PER_IP_PER_HOUR = 15;
const FAILED_CODES_PER_NUMBER_PER_HOUR = 10;
/** Codes one person may ask for in a day, across every number they try, so one account cannot be used to send codes to many numbers. */
const SENDS_PER_PERSON_PER_DAY = 10;
/** A request outlives its code a little, so "expired" can be told apart from "never asked". */
const GRACE_SECONDS = 60;

/** Takes the request out of Redis only if it still carries the hash just verified: a resend in between kills the old code. */
const CONSUME = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local c = cjson.decode(raw)
if c.otpHash ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return raw
`;

const triesKey = (key: string) => `${key}:tries`;

/**
 * Lets a signed-in person prove they hold the number on their own profile. Until then that number cannot be used to sign in: a
 * number somebody typed into a profile (their own, or an administrator's entry for them) proves nothing about who holds it. The code
 * is sent to the number as saved now and only that number is marked verified, so a number changed in between is never confirmed by
 * the code of the old one.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    private readonly policy: SecurityPolicyService,
    private readonly otp: RegistrationOtpService,
    private readonly rate: RateLimitService,
    private readonly audit: AuthAuditService,
    private readonly db: DatabaseService,
    @Inject(OTP_SENDER_PORT) private readonly otpSender: OtpSenderPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private actor() {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId, ip: normalizeIp(ctx.ip) ?? 'unknown' };
  }

  async start(): Promise<PhoneVerificationChallenge> {
    const { orgId, userId, ip } = this.actor();
    const registration = await this.policy.registration();
    if (!(await this.otp.statusFor(registration)).active) throw this.unavailable();

    const profile = await this.profile(orgId, userId);
    if (!profile.phone) {
      throw AppError.validation('Add a mobile number first.', [
        { path: 'phone', message: 'Add a mobile number first.' },
      ]);
    }
    if (profile.verified) {
      throw AppError.validation('This number is already verified.', [
        { path: 'phone', message: 'This number is already verified.' },
      ]);
    }
    // Asking again for the same number counts as a resend: the cooldown applies to it too.
    const earlier = await this.redis.get(AuthKeys.phoneVerify(orgId, userId));
    if (earlier) {
      const previous = JSON.parse(earlier) as PendingVerification;
      if (previous.phoneE164 === profile.phone) {
        this.assertCooldownOver(previous.lastSentAt, registration.otp.resendCooldownSec);
      }
    }
    await this.assertSendAllowed(profile.phone, ip, orgId, userId);

    const code = randomNumericCode(registration.otp.length);
    const pending: PendingVerification = {
      phoneE164: profile.phone,
      otpHash: await hash(code),
      expiresAt: Date.now() + registration.otp.ttlMinutes * 60_000,
      lastSentAt: Date.now(),
    };
    // The person is signed in, so a failed send is told to them (it hides nobody's number): they can try again.
    await this.sendCode(profile.phone, code, registration.otp.ttlMinutes);
    await this.redis.setex(
      AuthKeys.phoneVerify(orgId, userId),
      registration.otp.ttlMinutes * 60 + GRACE_SECONDS,
      JSON.stringify(pending),
    );
    return {
      maskedPhone: maskPhone(profile.phone),
      expiresInSeconds: registration.otp.ttlMinutes * 60,
      resendCooldownSeconds: registration.otp.resendCooldownSec,
      codeLength: registration.otp.length,
    };
  }

  async resend(): Promise<PhoneVerificationResendResponse> {
    const { orgId, userId, ip } = this.actor();
    const registration = await this.policy.registration();
    if (!(await this.otp.statusFor(registration)).active) throw this.unavailable();

    const key = AuthKeys.phoneVerify(orgId, userId);
    const pending = await this.load(key);
    const profile = await this.profile(orgId, userId);
    // The number was changed or already verified since the code went out: there is nothing to resend to.
    if (profile.verified || profile.phone !== pending.phoneE164) throw this.expired();

    this.assertCooldownOver(pending.lastSentAt, registration.otp.resendCooldownSec);
    await this.assertSendAllowed(pending.phoneE164, ip, orgId, userId);

    const code = randomNumericCode(registration.otp.length);
    pending.otpHash = await hash(code);
    pending.expiresAt = Date.now() + registration.otp.ttlMinutes * 60_000;
    pending.lastSentAt = Date.now();
    await this.sendCode(pending.phoneE164, code, registration.otp.ttlMinutes);
    await this.redis.setex(
      key,
      registration.otp.ttlMinutes * 60 + GRACE_SECONDS,
      JSON.stringify(pending),
    );
    // A fresh code starts with a fresh allowance of guesses.
    await this.redis.del(triesKey(key));
    return {
      expiresInSeconds: registration.otp.ttlMinutes * 60,
      resendCooldownSeconds: registration.otp.resendCooldownSec,
    };
  }

  async confirm(req: PhoneVerificationConfirmRequest): Promise<PhoneVerificationConfirmResponse> {
    const { orgId, userId } = this.actor();
    const registration = await this.policy.registration();

    const key = AuthKeys.phoneVerify(orgId, userId);
    const pending = await this.load(key);
    if (Date.now() > pending.expiresAt) throw this.expired();

    // Wrong codes are counted per number across new requests too, so asking for a new code does not give the guesses back.
    const failKey = AuthKeys.otpPhoneFails(pending.phoneE164);
    if ((await this.rate.peek(failKey)).count >= FAILED_CODES_PER_NUMBER_PER_HOUR) {
      throw this.tooManyAttempts();
    }
    // Counted BEFORE the comparison and in one atomic step: parallel guesses all get distinct numbers.
    if ((await this.countGuess(key, registration.otp.ttlMinutes)) > registration.otp.maxAttempts) {
      throw this.tooManyAttempts();
    }
    const ok = await verify(pending.otpHash, req.code.trim()).catch(() => false);
    if (!ok) {
      await this.rate.hit(failKey, 3600);
      await this.audit.recordStandalone({
        event: 'auth.failed',
        status: 'failure',
        orgId,
        actorType: 'user',
        actorId: userId,
        recordId: userId,
        payload: { reason: 'phone_verification_code', identifier: maskPhone(pending.phoneE164) },
      });
      throw this.invalidCode();
    }

    // Single use: only one of any number of parallel correct posts goes on.
    const claimed = await this.redis.eval(CONSUME, 1, key, pending.otpHash);
    if (claimed === 0) throw this.invalidCode();
    if (typeof claimed !== 'string') throw this.expired();
    await this.redis.del(triesKey(key));
    await this.rate.reset(failKey);

    // Only the number the code went to is marked: if the profile holds another one now, nothing is verified.
    const marked = await this.db.txAs({ orgId, userId }, async (tx) => {
      const res = await tx.execute(sql`
        UPDATE user_profiles SET phone_verified_at = now()
        WHERE org_id = ${orgId} AND user_id = ${userId} AND phone_e164 = ${pending.phoneE164}
        RETURNING user_id
      `);
      if (res.rows.length > 0) {
        await this.audit.record(tx, {
          event: 'auth.phone_verified',
          status: 'success',
          orgId,
          actorType: 'user',
          actorId: userId,
          recordId: userId,
          payload: { identifier: maskPhone(pending.phoneE164) },
        });
      }
      return res.rows.length > 0;
    });
    if (!marked) throw this.expired();
    return { verified: true };
  }

  // --- helpers ------------------------------------------------------------------------------------

  private async profile(
    orgId: number,
    userId: number,
  ): Promise<{ phone: string | null; verified: boolean }> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT phone_e164, phone_verified_at FROM user_profiles
        WHERE org_id = ${orgId} AND user_id = ${userId}
      `),
    );
    const row = res.rows[0] as
      { phone_e164: string | null; phone_verified_at: Date | null } | undefined;
    return { phone: row?.phone_e164 ?? null, verified: Boolean(row?.phone_verified_at) };
  }

  private async load(key: string): Promise<PendingVerification> {
    const raw = await this.redis.get(key);
    if (!raw) throw this.expired();
    return JSON.parse(raw) as PendingVerification;
  }

  /** Refuses a new code before `cooldownSec` has passed since the last one, telling the caller how long is left. */
  private assertCooldownOver(lastSentAt: number, cooldownSec: number): void {
    const cooldownMs = cooldownSec * 1000;
    if (Date.now() - lastSentAt >= cooldownMs) return;
    const wait = Math.max(1, Math.ceil((lastSentAt + cooldownMs - Date.now()) / 1000));
    throw new AppError(
      ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN,
      'Please wait a moment before requesting another code.',
      HttpStatus.TOO_MANY_REQUESTS,
      [{ path: 'retryAfterSeconds', message: String(wait) }],
    );
  }

  private async assertSendAllowed(
    phone: string,
    ip: string,
    orgId: number,
    userId: number,
  ): Promise<void> {
    if (
      (await this.rate.allow(AuthKeys.otpPhone(phone), SENDS_PER_NUMBER_PER_HOUR, 3600)) &&
      (await this.rate.allow(AuthKeys.ipThrottle('otp', ip), SENDS_PER_IP_PER_HOUR, 3600)) &&
      (await this.rate.allow(
        AuthKeys.phoneVerifySends(orgId, userId),
        SENDS_PER_PERSON_PER_DAY,
        86_400,
      ))
    ) {
      return;
    }
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many codes requested. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async countGuess(key: string, ttlMinutes: number): Promise<number> {
    const k = triesKey(key);
    const results = await this.redis
      .multi()
      .incr(k)
      .expire(k, ttlMinutes * 60 + GRACE_SECONDS, 'NX')
      .exec();
    return Number(results?.[0]?.[1] ?? 1);
  }

  private async sendCode(phone: string, code: string, ttlMinutes: number): Promise<void> {
    try {
      await this.otpSender.send({ to: phone, code, ttlMinutes });
    } catch (err) {
      this.logger.error({ err }, 'phone verification code could not be sent');
      throw new AppError(
        ERROR_CODES.AUTH_OTP_SEND_FAILED,
        'We could not send the verification code. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  private unavailable(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_OTP_SEND_FAILED,
      'Verifying a phone number is not available right now.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private expired(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_OTP_EXPIRED,
      'That code has expired. Request a new one.',
      HttpStatus.BAD_REQUEST,
    );
  }

  private invalidCode(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_OTP_INVALID,
      'That code is not correct.',
      HttpStatus.BAD_REQUEST,
    );
  }

  private tooManyAttempts(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS,
      'Too many attempts. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
