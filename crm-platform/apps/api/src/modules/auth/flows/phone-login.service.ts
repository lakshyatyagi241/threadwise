import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type PasswordLoginResponse,
  type PhoneLoginChallenge,
  type PhoneLoginResendRequest,
  type PhoneLoginResendResponse,
  type PhoneLoginStartRequest,
  type PhoneLoginVerifyRequest,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import {
  OTP_SENDER_PORT,
  type OtpSenderPort,
} from '../../../infra/providers/auth-registration-security/otp-sender.port';
import { RegistrationOtpService } from '../platform/registration-otp.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { TenantDirectory, type OrgRef } from '../platform/tenant-directory';
import { AuthAuditService } from '../security/auth-audit.service';
import { CaptchaService } from '../security/captcha.service';
import { RateLimitService } from '../security/rate-limit.service';
import { randomNumericCode, randomToken } from '../support/crypto-utils';
import { normalizeIp } from '../support/ip';
import { AuthKeys } from '../support/redis-keys';
import { LoginService, type ClientMeta, type UserRow } from './login.service';
import { maskPhone } from './phone-mask';

/** What waits in Redis for one phone sign-in. A number with no account gets the same record with a code nobody was sent. */
interface PhoneChallenge {
  phoneE164: string;
  otpHash: string;
  expiresAt: number;
  lastSentAt: number;
  remember: boolean;
  /** True when the number belongs to at least one account: only then was a code sent. Never leaves the server. */
  known: boolean;
}

/** The same limits as the sign-up code (`SignupService`), so a number cannot be used as a free SMS cannon through either door. */
const SENDS_PER_NUMBER_PER_HOUR = 5;
const SENDS_PER_IP_PER_HOUR = 15;
const START_PER_IP_PER_MINUTE = 10;
const VERIFY_PER_IP_PER_MINUTE = 10;
const RESEND_PER_IP_PER_MINUTE = 5;
/** Wrong codes per number per hour across all its challenges. A resend gives a new code, but not a new allowance of guesses. */
const FAILED_CODES_PER_NUMBER_PER_HOUR = 10;
/** A challenge outlives its code a little, so "expired" can be told apart from "never existed". */
const GRACE_SECONDS = 60;

/**
 * Takes the challenge out of Redis in one step, but only if it still carries the code hash the caller just verified. A resend
 * in between replaces the hash, and then the old code must not win. Of any number of correct posts exactly one gets it.
 */
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
 * Sign-in with a mobile number and a one-time code. The code goes out through the same sender as the sign-up code, and only a
 * number that was verified on an account can sign in. A correct code is a credential like a correct password: it goes on to the
 * second factor when the account has one, or to the workspace choice when the number is in several, and the session is opened by
 * `LoginService`, so every gate and audit entry is the one password sign-in has.
 *
 * Nobody can use this to find out who has an account: starting, resending and a wrong code answer the same way for a number with
 * no account (the code is simply never sent), and a failed send is not reported.
 */
@Injectable()
export class PhoneLoginService {
  private readonly logger = new Logger(PhoneLoginService.name);

  constructor(
    private readonly policy: SecurityPolicyService,
    private readonly otp: RegistrationOtpService,
    private readonly captcha: CaptchaService,
    private readonly tenants: TenantDirectory,
    private readonly rate: RateLimitService,
    private readonly audit: AuthAuditService,
    private readonly login: LoginService,
    @Inject(OTP_SENDER_PORT) private readonly otpSender: OtpSenderPort,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async start(req: PhoneLoginStartRequest, meta: ClientMeta): Promise<PhoneLoginChallenge> {
    const registration = await this.policy.registration();
    // The code step is the platform's own switch (and needs a sender that can deliver): without it there is nothing to send.
    if (!(await this.otp.statusFor(registration)).active) throw this.unavailable();

    await this.throttleClient('phone-login', meta, START_PER_IP_PER_MINUTE);
    await this.captcha.assert(req.captchaToken, 'login');
    await this.assertSendAllowed(req.phone, meta);

    const accounts = await this.tenants.activeAccountsForVerifiedPhone(req.phone);
    const code = randomNumericCode(registration.otp.length);
    const challenge: PhoneChallenge = {
      phoneE164: req.phone,
      // Hashed for every number, so the work is the same whether or not the number is known.
      otpHash: await hash(code),
      expiresAt: Date.now() + registration.otp.ttlMinutes * 60_000,
      lastSentAt: Date.now(),
      remember: req.remember && (await this.policy.policy()).rememberMeEnabled,
      known: accounts.length > 0,
    };
    const challengeId = randomToken(24);
    await this.redis.setex(
      AuthKeys.phoneLogin(challengeId),
      registration.otp.ttlMinutes * 60 + GRACE_SECONDS,
      JSON.stringify(challenge),
    );
    // Not awaited: the call to the sender takes far longer than a lookup, so waiting for it only for numbers that have an
    // account would show, by the time the answer takes, which numbers those are.
    if (challenge.known) void this.sendCode(req.phone, code, registration.otp.ttlMinutes);
    return {
      challengeId,
      maskedPhone: maskPhone(req.phone),
      expiresInSeconds: registration.otp.ttlMinutes * 60,
      resendCooldownSeconds: registration.otp.resendCooldownSec,
      codeLength: registration.otp.length,
    };
  }

  async resend(req: PhoneLoginResendRequest, meta: ClientMeta): Promise<PhoneLoginResendResponse> {
    const registration = await this.policy.registration();
    if (!(await this.otp.statusFor(registration)).active) throw this.unavailable();
    await this.throttleClient('phone-resend', meta, RESEND_PER_IP_PER_MINUTE);

    const key = AuthKeys.phoneLogin(req.challengeId);
    const challenge = await this.load(key);

    const cooldownMs = registration.otp.resendCooldownSec * 1000;
    if (Date.now() - challenge.lastSentAt < cooldownMs) {
      const wait = Math.max(1, Math.ceil((challenge.lastSentAt + cooldownMs - Date.now()) / 1000));
      throw new AppError(
        ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN,
        'Please wait a moment before requesting another code.',
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: 'retryAfterSeconds', message: String(wait) }],
      );
    }
    await this.assertSendAllowed(challenge.phoneE164, meta);

    const code = randomNumericCode(registration.otp.length);
    challenge.otpHash = await hash(code);
    challenge.expiresAt = Date.now() + registration.otp.ttlMinutes * 60_000;
    challenge.lastSentAt = Date.now();
    await this.redis.setex(
      key,
      registration.otp.ttlMinutes * 60 + GRACE_SECONDS,
      JSON.stringify(challenge),
    );
    // Not awaited, for the reason given in `start`.
    if (challenge.known) void this.sendCode(challenge.phoneE164, code, registration.otp.ttlMinutes);
    // A fresh code starts with a fresh allowance of guesses.
    await this.redis.del(triesKey(key));
    return {
      expiresInSeconds: registration.otp.ttlMinutes * 60,
      resendCooldownSeconds: registration.otp.resendCooldownSec,
    };
  }

  async verify(req: PhoneLoginVerifyRequest, meta: ClientMeta): Promise<PasswordLoginResponse> {
    const registration = await this.policy.registration();
    await this.throttleClient('phone-verify', meta, VERIFY_PER_IP_PER_MINUTE);

    const key = AuthKeys.phoneLogin(req.challengeId);
    const challenge = await this.load(key);
    if (Date.now() > challenge.expiresAt) throw this.expired();

    // Past the cap for the number, nothing is compared, so asking for new codes cannot keep a guesser going.
    const failKey = AuthKeys.otpPhoneFails(challenge.phoneE164);
    if ((await this.rate.peek(failKey)).count >= FAILED_CODES_PER_NUMBER_PER_HOUR) {
      throw this.tooManyAttempts();
    }
    // Counted BEFORE the comparison and in one atomic step: a burst of parallel guesses all get distinct numbers, so no more
    // than `maxAttempts` of them are ever compared with the code.
    if ((await this.countGuess(key, registration.otp.ttlMinutes)) > registration.otp.maxAttempts) {
      throw this.tooManyAttempts();
    }
    const ok = await verify(challenge.otpHash, req.code.trim()).catch(() => false);
    if (!ok) {
      await this.rate.hit(failKey, 3600);
      await this.audit.recordStandalone({
        event: 'auth.failed',
        status: 'failure',
        payload: { identifier: maskPhone(challenge.phoneE164), reason: 'phone_code' },
      });
      throw this.invalidCode();
    }

    // Single use: only one of any number of parallel correct posts gets to go on.
    const claimed = await this.redis.eval(CONSUME, 1, key, challenge.otpHash);
    if (claimed === 0) throw this.invalidCode();
    if (typeof claimed !== 'string') throw this.expired();
    await this.redis.del(triesKey(key));
    await this.rate.reset(failKey);

    return this.signIn(challenge, meta);
  }

  /** The code was right: find who the number belongs to now (it may have changed since the code was sent) and sign them in. */
  private async signIn(
    challenge: PhoneChallenge,
    meta: ClientMeta,
  ): Promise<PasswordLoginResponse> {
    const policy = await this.policy.policy();
    const ip = normalizeIp(meta.ip) ?? 'unknown';
    const accounts = await this.tenants.activeAccountsForVerifiedPhone(challenge.phoneE164);

    const usable: Array<{ org: OrgRef; row: UserRow; lockKey: string }> = [];
    let locked: AppError | null = null;
    for (const account of accounts) {
      const loaded = await this.login.loadOrgAndUser(account.orgId, account.userId);
      if (!loaded || loaded.org.status !== 'active' || loaded.user.status !== 'active') continue;
      // A workspace that locked this account after failed password guesses stays locked: a phone code is no way around it.
      const lockKey = AuthKeys.lockout(loaded.org.id, loaded.user.email, ip);
      try {
        await this.login.assertNotLocked(lockKey, policy, {
          orgId: loaded.org.id,
          email: loaded.user.email,
        });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        locked ??= err;
        continue;
      }
      usable.push({ org: loaded.org, row: loaded.user, lockKey });
    }

    if (usable.length === 0) {
      if (locked) throw locked;
      throw this.invalidCode();
    }
    const only = usable.length === 1 ? usable[0] : undefined;
    if (only) {
      return this.login.afterCredential(
        only.org,
        only.row,
        challenge.remember,
        only.lockKey,
        meta,
        'phone',
      );
    }
    return this.login.offerWorkspaces(
      usable.map((u) => ({ org: u.org, userId: u.row.id, lockKey: u.lockKey })),
      challenge.remember,
      'phone',
    );
  }

  // --- helpers ------------------------------------------------------------------------------------

  private async load(key: string): Promise<PhoneChallenge> {
    const raw = await this.redis.get(key);
    if (!raw) throw this.expired();
    return JSON.parse(raw) as PhoneChallenge;
  }

  /** Counts a code send against the number and the address. Counted for every number, known or not, so the limit tells nothing. */
  private async assertSendAllowed(phone: string, meta: ClientMeta): Promise<void> {
    const ip = normalizeIp(meta.ip) ?? 'unknown';
    if (
      (await this.rate.allow(AuthKeys.otpPhone(phone), SENDS_PER_NUMBER_PER_HOUR, 3600)) &&
      (await this.rate.allow(AuthKeys.ipThrottle('otp', ip), SENDS_PER_IP_PER_HOUR, 3600))
    ) {
      return;
    }
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many codes requested. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async throttleClient(scope: string, meta: ClientMeta, max: number): Promise<void> {
    const ip = normalizeIp(meta.ip) ?? 'unknown';
    const { count, retryAfterSeconds } = await this.rate.hit(AuthKeys.ipThrottle(scope, ip), 60);
    if (count <= max) return;
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many attempts. Slow down.',
      HttpStatus.TOO_MANY_REQUESTS,
      [{ path: 'retryAfterSeconds', message: String(retryAfterSeconds) }],
    );
  }

  /** One guess made against a challenge; returns how many have been made (this one included). */
  private async countGuess(key: string, ttlMinutes: number): Promise<number> {
    const k = triesKey(key);
    const results = await this.redis
      .multi()
      .incr(k)
      .expire(k, ttlMinutes * 60 + GRACE_SECONDS, 'NX')
      .exec();
    return Number(results?.[0]?.[1] ?? 1);
  }

  /**
   * A failed send is logged and not reported: telling the caller would show which numbers have an account. The person asks
   * again (the resend cooldown applies) and an operator sees the log.
   */
  private async sendCode(phone: string, code: string, ttlMinutes: number): Promise<void> {
    try {
      await this.otpSender.send({ to: phone, code, ttlMinutes });
    } catch (err) {
      this.logger.error({ err }, 'phone sign-in code could not be sent');
    }
  }

  private unavailable(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_OTP_SEND_FAILED,
      'Signing in with a phone number is not available right now.',
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

  private tooManyAttempts(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS,
      'Too many attempts. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private invalidCode(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_OTP_INVALID,
      'That code is not correct.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
