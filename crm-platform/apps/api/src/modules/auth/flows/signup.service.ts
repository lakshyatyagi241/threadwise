import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  type SignupRequest,
  type SignupResendOtpRequest,
  type SignupResponse,
  type SignupVerifyOtpRequest,
  type SignupStartRequest,
  type SignupStartResponse,
  type SignupVerifyEmailCodeRequest,
  type SignupVerifyEmailCodeResponse,
  type SignupResendEmailCodeRequest,
  type SignupResendEmailCodeResponse,
  type SignupSetPasswordRequest,
  type Authenticated,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import type { DownloadedAvatar } from '../../../infra/providers/auth-registration-security/avatar-download';
import {
  OTP_SENDER_PORT,
  type OtpSenderPort,
} from '../../../infra/providers/auth-registration-security/otp-sender.port';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { MailService } from '../mail/mail.service';
import { RegistrationOtpService } from '../platform/registration-otp.service';
import { SecurityPolicyService } from '../platform/security-policy.service';
import { TenantDirectory } from '../platform/tenant-directory';
import { AuthAuditService } from '../security/auth-audit.service';
import { CaptchaService } from '../security/captcha.service';
import { PasswordService } from '../security/password.service';
import { RateLimitService } from '../security/rate-limit.service';
import { randomNumericCode, randomToken } from '../support/crypto-utils';
import {
  checkEmailDomain,
  domainHasNoMailServer,
  emailDomain,
  EMAIL_POLICY_MESSAGES,
} from '../support/email-policy';
import { normalizeIp } from '../support/ip';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { slugify, slugWithSuffix } from '../support/text';
import { LoginService, type ClientMeta } from './login.service';
import { maskPhone } from './phone-mask';
import { UserTokensService } from './user-tokens.service';

export interface SignupData {
  orgName: string;
  slug: string;
  /** The person typed the workspace address; false when it was derived from the name. */
  slugExplicit?: boolean;
  fullName: string;
  email: string;
  phoneE164: string | null;
  passwordHash: string;
  referralCode: string | null;
}

interface StagedSignup {
  data: SignupData & { phoneE164: string };
  otpHash: string;
  expiresAt: number;
  /** Read only by the resend cooldown. Wrong guesses are counted in `triesKey`, atomically. */
  lastSentAt: number;
  ip: string | null;
  /** Set when the staged sign-up came from the three-step flow, whose email code was already confirmed. */
  emailVerified?: boolean;
}

/**
 * The pre-account stage of the three-step sign-up (collect -> verify email code -> set password).
 * Deliberately shorter-lived than `StagedSignup`'s 7 days: nothing is created until the password
 * step, so there is no account to recover if the person wanders off.
 */
interface EmailStage {
  fullName: string;
  email: string;
  phoneE164: string | null;
  codeHash: string;
  codeExpiresAt: number;
  verified: boolean;
  /** Read only by the resend cooldown. Wrong guesses are counted in `triesKey`, atomically. */
  lastSentAt: number;
}

export interface CreateOptions {
  phoneVerified: boolean;
  emailVerified?: boolean;
  socialLink?: { provider: 'google' | 'facebook'; subject: string; email: string | null };
  /** Ask for the long-lived session; applied only while the "keep me signed in" policy is on. */
  remember?: boolean;
  /** `social` for a sign-up that came back from Google or Facebook. */
  loginMethod?: 'signup' | 'social';
  /** The social profile picture, already downloaded, stored with the new account. */
  avatar?: DownloadedAvatar | null;
  /**
   * The workspace address may already have been taken by the time the account is written. For an
   * address derived from the name that always means "pick another"; for one the person typed it
   * means "tell them" unless the form cannot be shown again (the sign-up code was already used up).
   */
  slugFallback?: boolean;
}

/**
 * How long a sign-up waits for its code. Reference keeps the pending sign-up in the session (7 days);
 * the code itself expires after `otp.ttlMinutes`, and a resend issues a fresh one at any time.
 */
const STAGE_TTL_SECONDS = 7 * 24 * 60 * 60;
/** The three-step email-verification flow's own, much shorter stage: 30 minutes to finish all three steps. */
const EMAIL_STAGE_TTL_SECONDS = 30 * 60;
const EMAIL_CODE_TTL_SECONDS = 5 * 60;
const EMAIL_CODE_LENGTH = 6;
const EMAIL_CODE_MAX_ATTEMPTS = 5;
const EMAIL_CODE_RESEND_COOLDOWN_SECONDS = 60;
/** Code mails per address per hour, start and resends together; the email twin of `OTP_SENDS_PER_NUMBER_PER_HOUR`. */
const EMAIL_CODE_SENDS_PER_ADDRESS_PER_HOUR = 5;
const SIGNUPS_PER_IP_PER_HOUR = 10;
const OTP_SENDS_PER_NUMBER_PER_HOUR = 5;
const OTP_SENDS_PER_IP_PER_HOUR = 15;
/** Reference's guest throttles: verify 10 a minute, resend 5 a minute, per client. */
const OTP_VERIFY_PER_IP_PER_MINUTE = 10;
const OTP_RESEND_PER_IP_PER_MINUTE = 5;
/** Attempts at finding a free address when someone else takes it in the same instant. */
const SLUG_ATTEMPTS = 5;

/**
 * Takes the staged sign-up out of Redis in one step, but only if it still carries the code hash the
 * caller just verified. A resend in between replaces the hash, and then the old code must not win.
 * Returns the staged JSON, 0 when the hash changed, nil when it is already gone (someone else
 * consumed it): so of any number of correct posts exactly one gets the data.
 */
const CONSUME_STAGED = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local staged = cjson.decode(raw)
if staged.otpHash ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
return raw
`;

const triesKey = (stagedKey: string) => `${stagedKey}:tries`;

/**
 * The email-stage twin of `CONSUME_STAGED`'s compare-at-write-time check: writes the verified
 * `EmailStage` (ARGV[2]) only if the stored stage still carries the code hash the caller just
 * compared against (ARGV[1]), keeping the stage's TTL. A resend in between replaces the hash, and
 * then the old code must not win. Returns 1 when written, 0 when the hash changed, nil when the
 * stage is gone.
 */
const MARK_EMAIL_STAGE_VERIFIED = `
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local stage = cjson.decode(raw)
if stage.codeHash ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 1
`;

/** Held by the one resend that won the cooldown; parallel resends that lose it are refused. */
const resendClaimKey = (stageKey: string) => `${stageKey}:resend`;

/**
 * Account creation (TW-AUTH-005/006/008-prep). Creates the organization and its
 * first user together; there is no global "user first" step.
 *
 * With registration OTP active, nothing is created until the WhatsApp code is
 * confirmed: no ghost accounts. The staged request keeps an argon2 hash of the
 * password, never the password (Reference kept it in the session in plaintext).
 *
 * The code check is race-safe: every guess is counted with one atomic INCR before the code is
 * compared, and the staged sign-up is consumed by one atomic compare-and-delete, so parallel
 * guesses cannot exceed `maxAttempts` and parallel correct posts cannot create two organizations.
 */
@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    private readonly policy: SecurityPolicyService,
    private readonly otp: RegistrationOtpService,
    private readonly captcha: CaptchaService,
    private readonly passwords: PasswordService,
    private readonly tenants: TenantDirectory,
    private readonly rate: RateLimitService,
    private readonly audit: AuthAuditService,
    private readonly outbox: OutboxService,
    private readonly mail: MailService,
    private readonly tokens: UserTokensService,
    private readonly login: LoginService,
    @Inject(OTP_SENDER_PORT) private readonly otpSender: OtpSenderPort,
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Step 1 of the three-step sign-up: collect name/email(/phone), refuse a duplicate identity
   * before anything is sent, then stage the pre-account data and mail a code. Nothing is created
   * yet — the organization and user only appear once the password step (Task 7) lands.
   */
  async start(req: SignupStartRequest, meta: ClientMeta): Promise<SignupStartResponse> {
    const registration = await this.policy.registration();
    if (!registration.publicRegistration) {
      throw new AppError(
        ERROR_CODES.AUTH_SIGNUP_CLOSED,
        'Registration is closed. Ask an administrator for an invitation.',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.captcha.assert(req.captchaToken, 'register');
    await this.assertEmailAllowed(req.email, registration);

    const ip = normalizeIp(meta.ip) ?? 'unknown';
    if (
      !(await this.rate.allow(AuthKeys.ipThrottle('signup', ip), SIGNUPS_PER_IP_PER_HOUR, 3600))
    ) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many sign-ups from this address. Try later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (await this.tenants.identityExists(req.email, req.phone ?? null)) {
      throw this.identityExistsError();
    }
    // Every /start opens a fresh code with a fresh guess budget, so it counts against the address.
    await this.assertEmailSendAllowed(req.email);

    const token = randomToken();
    const code = randomNumericCode(EMAIL_CODE_LENGTH);
    const stage: EmailStage = {
      fullName: req.fullName,
      email: req.email,
      phoneE164: req.phone ?? null,
      codeHash: await hash(code),
      codeExpiresAt: Date.now() + EMAIL_CODE_TTL_SECONDS * 1000,
      verified: false,
      lastSentAt: Date.now(),
    };
    const stageKey = AuthKeys.signupEmailStage(token);
    await this.redis.set(stageKey, JSON.stringify(stage), 'EX', EMAIL_STAGE_TTL_SECONDS);

    const sent = await this.mail.sendSignupCode(
      req.email,
      req.fullName,
      code,
      EMAIL_CODE_TTL_SECONDS / 60,
    );
    if (!sent) {
      // Don't leave a stage behind that nobody can ever complete: the code that would
      // unlock it was never delivered.
      await this.redis.del(stageKey);
      this.logger.error('sign-up code mail could not be sent');
      throw new AppError(
        ERROR_CODES.AUTH_OTP_SEND_FAILED,
        'We could not send the verification code. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    return {
      token,
      maskedEmail: maskEmail(req.email),
      expiresInSeconds: EMAIL_CODE_TTL_SECONDS,
      resendCooldownSeconds: EMAIL_CODE_RESEND_COOLDOWN_SECONDS,
      codeLength: EMAIL_CODE_LENGTH,
    };
  }

  /**
   * Step 2 of the three-step sign-up: check the emailed code against the staged `EmailStage`.
   * Race-safe like `verifyOtp`: every guess is counted with one atomic INCR on `triesKey` BEFORE the
   * comparison, so a burst of parallel guesses all get distinct numbers and no more than
   * `EMAIL_CODE_MAX_ATTEMPTS` of them are ever compared with the code.
   */
  async verifyEmailCode(
    req: SignupVerifyEmailCodeRequest,
    meta: ClientMeta,
  ): Promise<SignupVerifyEmailCodeResponse> {
    await this.throttleClient('signup-email-verify', meta, OTP_VERIFY_PER_IP_PER_MINUTE);

    const key = AuthKeys.signupEmailStage(req.token);
    const raw = await this.redis.get(key);
    if (!raw) throw this.signupExpired();
    const stage = JSON.parse(raw) as EmailStage;

    if (Date.now() > stage.codeExpiresAt) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_EXPIRED,
        'That code has expired. Please request a new one.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if ((await this.countGuess(key)) > EMAIL_CODE_MAX_ATTEMPTS) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS,
        'Too many attempts. Please request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const ok = await verify(stage.codeHash, req.code).catch(() => false);
    if (!ok) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_INVALID,
        'Incorrect code. Please try again.',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Compare-and-set against the hash this guess was actually checked with: a resend that replaced
    // the code mid-check makes this (old) code dead, and a consumed stage stays consumed.
    const comparedHash = stage.codeHash;
    stage.verified = true;
    const marked = await this.redis.eval(
      MARK_EMAIL_STAGE_VERIFIED,
      1,
      key,
      comparedHash,
      JSON.stringify(stage),
    );
    if (marked === 0) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_INVALID,
        'Incorrect code. Please try again.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (marked !== 1) throw this.signupExpired();
    await this.redis.del(triesKey(key));
    return { token: req.token };
  }

  /**
   * Issues a fresh code for the same staged sign-up: a genuinely new hash and expiry, a reset
   * guess allowance, and a new mail sent (the old code's mail is useless once this runs).
   */
  async resendEmailCode(
    req: SignupResendEmailCodeRequest,
    meta: ClientMeta,
  ): Promise<SignupResendEmailCodeResponse> {
    await this.throttleClient('signup-email-resend', meta, OTP_RESEND_PER_IP_PER_MINUTE);

    const key = AuthKeys.signupEmailStage(req.token);
    const raw = await this.redis.get(key);
    if (!raw) throw this.signupExpired();
    const stage = JSON.parse(raw) as EmailStage;

    const cooldown = () =>
      new AppError(
        ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN,
        'Please wait a moment before requesting another code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const sinceLast = (Date.now() - stage.lastSentAt) / 1000;
    if (sinceLast < EMAIL_CODE_RESEND_COOLDOWN_SECONDS) throw cooldown();
    // `lastSentAt` was read above, so parallel resends all pass that check together. Claim the
    // cooldown in one atomic step: only the winner goes on to mail a code and reset the guess
    // budget; the rest are refused before anything else happens.
    const claimKey = resendClaimKey(key);
    const claimed = await this.redis.set(
      claimKey,
      '1',
      'EX',
      EMAIL_CODE_RESEND_COOLDOWN_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') throw cooldown();
    try {
      await this.assertEmailSendAllowed(stage.email);
    } catch (err) {
      await this.redis.del(claimKey);
      throw err;
    }

    // Generate the new code/hash and attempt delivery BEFORE touching the stage in Redis: if the
    // send fails, the old code, old guess count and old cooldown timer must stay exactly as they were
    // (mirroring `start()`'s own rollback-on-failed-send behavior), otherwise the client gets a 201
    // for a code that was never delivered and the still-good old code is invalidated for nothing.
    const code = randomNumericCode(EMAIL_CODE_LENGTH);
    const codeHash = await hash(code);
    const sent = await this.mail.sendSignupCode(
      stage.email,
      stage.fullName,
      code,
      EMAIL_CODE_TTL_SECONDS / 60,
    );
    if (!sent) {
      // Nothing changed, so the cooldown claim is released too: an immediate retry may go through.
      await this.redis.del(claimKey);
      this.logger.error('sign-up code resend mail could not be sent');
      throw new AppError(
        ERROR_CODES.AUTH_OTP_SEND_FAILED,
        'We could not send the verification code. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }

    stage.codeHash = codeHash;
    stage.codeExpiresAt = Date.now() + EMAIL_CODE_TTL_SECONDS * 1000;
    stage.lastSentAt = Date.now();
    if (!(await this.stageWriteBack(key, stage))) throw this.signupExpired();
    // A fresh code starts with a fresh allowance of guesses.
    await this.redis.del(triesKey(key));

    return {
      expiresInSeconds: EMAIL_CODE_TTL_SECONDS,
      resendCooldownSeconds: EMAIL_CODE_RESEND_COOLDOWN_SECONDS,
    };
  }

  async signup(req: SignupRequest, meta: ClientMeta): Promise<SignupResponse> {
    const registration = await this.policy.registration();
    if (!registration.publicRegistration) {
      throw new AppError(
        ERROR_CODES.AUTH_SIGNUP_CLOSED,
        'Registration is closed. Ask an administrator for an invitation.',
        HttpStatus.FORBIDDEN,
      );
    }
    await this.captcha.assert(req.captchaToken, 'register');
    await this.assertEmailAllowed(req.email, registration);

    const ip = normalizeIp(meta.ip) ?? 'unknown';
    if (
      !(await this.rate.allow(AuthKeys.ipThrottle('signup', ip), SIGNUPS_PER_IP_PER_HOUR, 3600))
    ) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many sign-ups from this address. Try later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.passwords.assertAcceptable(req.password, {
      email: req.email,
      fullName: req.fullName,
    });
    const { slug, explicit } = await this.chooseSlug(req);
    const passwordHash = await this.passwords.hash(req.password);
    const otpActive = await this.otpGate(registration, req.phone ?? null);

    return this.createOrChallenge(
      {
        orgName: req.orgName,
        slug,
        slugExplicit: explicit,
        fullName: req.fullName,
        email: req.email,
        phoneE164: req.phone ?? null,
        passwordHash,
        referralCode: req.referralCode ?? null,
      },
      registration,
      otpActive,
      ip,
      meta,
      false,
    );
  }

  /**
   * Step 3 of the three-step sign-up: the email code was confirmed, now take the password and
   * create the account (or, with registration OTP active, stage it behind the phone code exactly as
   * `signup()` does). The workspace name is provisional ("Ada's Workspace"); the person renames it
   * during onboarding.
   */
  async setPassword(req: SignupSetPasswordRequest, meta: ClientMeta): Promise<SignupResponse> {
    const key = AuthKeys.signupEmailStage(req.token);
    const raw = await this.redis.get(key);
    if (!raw) throw this.signupExpired();
    const stage = JSON.parse(raw) as EmailStage;
    if (stage.verified !== true) {
      throw new AppError(
        ERROR_CODES.AUTH_EMAIL_NOT_VERIFIED,
        'Please verify your email first.',
        HttpStatus.FORBIDDEN,
      );
    }

    const registration = await this.policy.registration();
    if (!registration.publicRegistration) {
      throw new AppError(
        ERROR_CODES.AUTH_SIGNUP_CLOSED,
        'Registration is closed. Ask an administrator for an invitation.',
        HttpStatus.FORBIDDEN,
      );
    }
    // Everything that can refuse for a reason already known (identity taken meanwhile, password
    // policy, OTP config, missing number) runs BEFORE the stage is consumed, so it never burns a
    // verified stage.
    // Up to EMAIL_STAGE_TTL can pass since `start()`'s check; a parallel `/start` for the same address
    // may have created the account by now. Still check-then-act, but closes the multi-minute window.
    if (await this.tenants.identityExists(stage.email, stage.phoneE164)) {
      throw this.identityExistsError();
    }
    await this.passwords.assertAcceptable(req.password, {
      email: stage.email,
      fullName: stage.fullName,
    });
    const otpActive = await this.otpGate(registration, stage.phoneE164);

    // Single use from here on, whichever branch follows. DEL's count makes it race-safe: of any
    // number of parallel posts with the same token only one gets 1 and goes on to create.
    if ((await this.redis.del(key)) !== 1) throw this.signupExpired();

    const passwordHash = await this.passwords.hash(req.password);
    const fullName = stage.fullName.trim();
    const firstName = fullName.split(/\s+/)[0] || fullName;
    const orgName = `${firstName}'s Workspace`;
    const ip = normalizeIp(meta.ip) ?? 'unknown';

    return this.createOrChallenge(
      {
        orgName,
        slug: slugify(orgName),
        slugExplicit: false,
        fullName: stage.fullName,
        email: stage.email,
        phoneE164: stage.phoneE164,
        passwordHash,
        referralCode: req.referralCode ?? null,
      },
      registration,
      otpActive,
      ip,
      meta,
      true,
    );
  }

  /**
   * The static half of the create-or-challenge decision: whether the registration OTP step is
   * active, refusing when it is mandatory but inactive, or active with no number to send to. Kept
   * apart from `createOrChallenge` so `setPassword` can run it before it consumes the email stage.
   */
  private async otpGate(
    registration: Awaited<ReturnType<SecurityPolicyService['registration']>>,
    phoneE164: string | null,
  ): Promise<boolean> {
    // The real activation rule: enabled, a sender that can deliver and, for a WhatsApp Business
    // sender, an approved template. Otherwise sign-up silently skips the code (TW-AUTH-006).
    const otpActive = (await this.otp.statusFor(registration)).active;
    if (!otpActive && registration.requirePhoneVerification) {
      // Mandatory means fail closed: never create an account whose number was not verified.
      this.logger.error(
        'sign-up refused: phone verification is required but the code step is not active',
      );
      throw new AppError(
        ERROR_CODES.AUTH_OTP_SEND_FAILED,
        'Sign-up is temporarily unavailable. Please try again later.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    // OTP path: the number is required and is the one thing we must not let
    // be turned into a free SMS cannon.
    if (otpActive && !phoneE164) {
      throw AppError.validation('A mobile number is required to verify your account.', [
        { path: 'phone', message: 'A mobile number is required.' },
      ]);
    }
    return otpActive;
  }

  /**
   * The shared tail of `signup()` and `setPassword()`: create the account straight away, or, with
   * registration OTP active, stage it and send the phone code. `otpActive` comes from `otpGate`,
   * which has already refused the static failure cases. `emailVerified` is carried through the
   * staged record so an email already confirmed by code is not asked to verify again.
   */
  private async createOrChallenge(
    data: SignupData,
    registration: Awaited<ReturnType<SecurityPolicyService['registration']>>,
    otpActive: boolean,
    ip: string,
    meta: ClientMeta,
    emailVerified: boolean,
  ): Promise<SignupResponse> {
    if (!otpActive) {
      return this.create(
        data,
        emailVerified ? { phoneVerified: false, emailVerified: true } : { phoneVerified: false },
        meta,
      );
    }

    const phone = data.phoneE164;
    // `otpGate` refused an active OTP step without a number; this narrows the type.
    if (!phone) throw new Error('otpGate let an OTP sign-up through without a number');
    if (
      !(await this.rate.allow(AuthKeys.otpPhone(phone), OTP_SENDS_PER_NUMBER_PER_HOUR, 3600)) ||
      !(await this.rate.allow(AuthKeys.ipThrottle('otp', ip), OTP_SENDS_PER_IP_PER_HOUR, 3600))
    ) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many codes requested. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const challengeId = randomToken(24);
    const code = randomNumericCode(registration.otp.length);
    const staged: StagedSignup = {
      data: { ...data, phoneE164: phone },
      otpHash: await hash(code),
      expiresAt: Date.now() + registration.otp.ttlMinutes * 60_000,
      lastSentAt: Date.now(),
      ip,
      ...(emailVerified ? { emailVerified: true } : {}),
    };

    await this.sendCode(phone, code, registration.otp.ttlMinutes);
    await this.redis.setex(AuthKeys.signup(challengeId), STAGE_TTL_SECONDS, JSON.stringify(staged));

    return {
      status: 'otp_required',
      challengeId,
      maskedPhone: maskPhone(phone),
      expiresInSeconds: registration.otp.ttlMinutes * 60,
      resendCooldownSeconds: registration.otp.resendCooldownSec,
      codeLength: registration.otp.length,
    };
  }

  async verifyOtp(req: SignupVerifyOtpRequest, meta: ClientMeta): Promise<Authenticated> {
    const registration = await this.policy.registration();
    await this.throttleClient('otp-verify', meta, OTP_VERIFY_PER_IP_PER_MINUTE);

    const key = AuthKeys.signup(req.challengeId);
    const raw = await this.redis.get(key);
    if (!raw) throw this.signupExpired();
    const staged = JSON.parse(raw) as StagedSignup;

    if (Date.now() > staged.expiresAt) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_EXPIRED,
        'That code has expired. Request a new one.',
        HttpStatus.BAD_REQUEST,
      );
    }
    // Counted BEFORE the comparison and in one atomic step: a burst of parallel guesses all get
    // distinct numbers, so no more than `maxAttempts` of them are ever compared with the code.
    if ((await this.countGuess(key)) > registration.otp.maxAttempts) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS,
        'Too many attempts. Request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ok = await verify(staged.otpHash, req.code.trim()).catch(() => false);
    if (!ok) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_INVALID,
        'That code is not correct.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Single use: only one of any number of parallel correct posts gets the staged data.
    const claimed = await this.redis.eval(CONSUME_STAGED, 1, key, staged.otpHash);
    if (claimed === 0) {
      // A resend replaced the code while this one was being checked: this code is dead.
      throw new AppError(
        ERROR_CODES.AUTH_OTP_INVALID,
        'That code is not correct.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (typeof claimed !== 'string') throw this.signupExpired();
    await this.redis.del(triesKey(key));

    // The code is spent, so the person cannot be sent back to fix the address: a taken one falls
    // back to a free variant instead of stranding them.
    const consumed = JSON.parse(claimed) as StagedSignup;
    const result = await this.create(
      consumed.data,
      {
        phoneVerified: true,
        slugFallback: true,
        ...(consumed.emailVerified === true ? { emailVerified: true } : {}),
      },
      meta,
    );
    if (result.status !== 'authenticated')
      throw new Error('unreachable: create returns authenticated');
    return result;
  }

  async resendOtp(
    req: SignupResendOtpRequest,
    meta?: ClientMeta,
  ): Promise<{ expiresInSeconds: number; resendCooldownSeconds: number }> {
    const registration = await this.policy.registration();
    await this.throttleClient('otp-resend', meta ?? {}, OTP_RESEND_PER_IP_PER_MINUTE);

    const key = AuthKeys.signup(req.challengeId);
    const raw = await this.redis.get(key);
    if (!raw) throw this.signupExpired();
    const staged = JSON.parse(raw) as StagedSignup;

    if (Date.now() - staged.lastSentAt < registration.otp.resendCooldownSec * 1000) {
      const wait = Math.max(
        1,
        Math.ceil(
          (staged.lastSentAt + registration.otp.resendCooldownSec * 1000 - Date.now()) / 1000,
        ),
      );
      throw new AppError(
        ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN,
        'Please wait a moment before requesting another code.',
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: 'retryAfterSeconds', message: String(wait) }],
      );
    }
    if (
      !(await this.rate.allow(
        AuthKeys.otpPhone(staged.data.phoneE164),
        OTP_SENDS_PER_NUMBER_PER_HOUR,
        3600,
      ))
    ) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many codes requested. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = randomNumericCode(registration.otp.length);
    staged.otpHash = await hash(code);
    staged.expiresAt = Date.now() + registration.otp.ttlMinutes * 60_000;
    staged.lastSentAt = Date.now();
    await this.sendCode(staged.data.phoneE164, code, registration.otp.ttlMinutes);
    await this.redis.setex(key, STAGE_TTL_SECONDS, JSON.stringify(staged));
    // A fresh code starts with a fresh allowance of guesses.
    await this.redis.del(triesKey(key));

    return {
      expiresInSeconds: registration.otp.ttlMinutes * 60,
      resendCooldownSeconds: registration.otp.resendCooldownSec,
    };
  }

  // --- shared creation path ---------------------------------------------------------------------------------

  /**
   * Provisions the organization and opens the first session. Used by plain
   * sign-up, OTP-verified sign-up and social sign-up.
   *
   * Two sign-ups can pick the same address in the same instant (both pass the existence check, one
   * loses the INSERT). A derived address is simply drawn again, as Reference does; a typed one is
   * reported back unless `slugFallback` says the form cannot be shown again.
   */
  async create(data: SignupData, opts: CreateOptions, meta: ClientMeta): Promise<Authenticated> {
    const [registration, securityPolicy] = await Promise.all([
      this.policy.registration(),
      this.policy.policy(),
    ]);
    // 'off' auto-verifies, as Reference's auto_verify_email does; otherwise only a
    // provider-asserted email counts as verified at creation.
    const verifiedNow = registration.emailVerification === 'off' || opts.emailVerified === true;

    let slug = data.slug;
    let result: Awaited<ReturnType<TenantDirectory['provisionOrganization']>> | null = null;
    for (let attempt = 1; result === null; attempt++) {
      try {
        result = await this.tenants.provisionOrganization(
          {
            orgName: data.orgName,
            slug,
            fullName: data.fullName,
            email: data.email,
            passwordHash: data.passwordHash,
            phoneE164: data.phoneE164,
            phoneVerified: opts.phoneVerified,
            emailVerifiedAt: verifiedNow ? new Date() : null,
            locale: null,
            orgSettings: {
              onboardingStep: 'workspace',
              timezone: registration.defaultTimezone,
              trialDays: registration.trialDays,
              signupPlan: registration.defaultPlanId,
            },
            signupPlan: {
              defaultPlanSlug: registration.defaultPlanId,
              trialDays: registration.trialDays,
            },
          },
          (tx, r) => this.recordProvisioned(tx, r, data, opts, verifiedNow, registration),
        );
      } catch (err) {
        if (!(err instanceof AppError) || err.code !== ERROR_CODES.AUTH_SLUG_TAKEN) throw err;
        const typed = data.slugExplicit === true;
        if (typed && !opts.slugFallback) {
          throw new AppError(
            ERROR_CODES.AUTH_SLUG_TAKEN,
            'That workspace address is already taken.',
            HttpStatus.CONFLICT,
            [{ path: 'orgSlug', message: 'Already taken.' }],
          );
        }
        if (attempt >= SLUG_ATTEMPTS) throw err;
        slug = slugWithSuffix(typed ? data.slug : slugify(data.orgName));
      }
    }

    if (!verifiedNow) {
      // Fire-and-forget: sign-up must not fail, or wait, on the mail server.
      void this.sendVerification(
        result.org.id,
        result.org.slug,
        result.user.id,
        data.email,
        data.fullName,
      );
    }

    return this.login.completeLogin({
      org: { id: result.org.id, slug: result.org.slug, settings: { onboardingStep: 'workspace' } },
      user: {
        id: result.user.id,
        uuid: result.user.uuid,
        email: data.email,
        fullName: data.fullName,
      },
      // Reference signs a new account in without remembering it; a social sign-up always remembers.
      remember: opts.remember === true && securityPolicy.rememberMeEnabled,
      mfaVerified: false,
      method: opts.loginMethod ?? 'signup',
      meta,
    });
  }

  /** Everything that must commit together with the new organization. */
  private async recordProvisioned(
    tx: Tx,
    r: Awaited<ReturnType<TenantDirectory['provisionOrganization']>>,
    data: SignupData,
    opts: CreateOptions,
    verifiedNow: boolean,
    registration: Awaited<ReturnType<SecurityPolicyService['registration']>>,
  ): Promise<void> {
    if (opts.socialLink) {
      await tx.execute(sql`
        INSERT INTO social_identities (org_id, user_id, provider, provider_subject, email)
        VALUES (${r.org.id}, ${r.user.id}, ${opts.socialLink.provider}, ${opts.socialLink.subject}, ${opts.socialLink.email})
      `);
    }
    if (opts.avatar) {
      await tx.execute(sql`
        INSERT INTO user_avatars (org_id, user_id, mime, bytes, etag)
        VALUES (${r.org.id}, ${r.user.id}, ${opts.avatar.mime}, ${opts.avatar.bytes}, ${opts.avatar.etag})
      `);
    }
    await this.audit.record(tx, {
      event: 'auth.signup',
      status: 'success',
      orgId: r.org.id,
      actorType: 'user',
      actorId: r.user.id,
      recordId: r.user.id,
      payload: {
        phoneVerified: opts.phoneVerified,
        social: opts.socialLink?.provider ?? null,
        plan: r.plan.planSlug,
        trial: r.plan.trialEndsAt !== null,
      },
    });

    // The plan and trial were assigned in this same transaction (PLAN's
    // resolver, called by the tenant directory); the payload carries the
    // outcome. Consumers read these events; this domain does not call them.
    await this.outbox.emit(tx, {
      orgId: r.org.id,
      aggregateModule: 'auth',
      aggregateId: r.user.id,
      eventType: 'auth.user.registered',
      payload: {
        userUuid: r.user.uuid,
        orgUuid: r.org.uuid,
        email: data.email,
        referralCode: data.referralCode,
        trialDays: registration.trialDays,
        defaultPlanId: registration.defaultPlanId,
        planSlug: r.plan.planSlug,
        trialEndsAt: r.plan.trialEndsAt ? r.plan.trialEndsAt.toISOString() : null,
        phoneVerified: opts.phoneVerified,
      },
    });

    // HOOK for NOTIF (welcome notification, TW-AUTH-005 / Report E item 16): Reference drops an in-app
    // "Welcome" note on the new user at sign-up. NOTIF consumes this event and writes it; the auth
    // domain only announces that the account is ready.
    await this.outbox.emit(tx, {
      orgId: r.org.id,
      aggregateModule: 'auth',
      aggregateId: r.user.id,
      eventType: 'auth.signup_completed',
      payload: {
        userUuid: r.user.uuid,
        orgUuid: r.org.uuid,
        email: data.email,
        fullName: data.fullName,
        method: opts.socialLink?.provider ?? 'password',
        emailVerified: verifiedNow,
        phoneVerified: opts.phoneVerified,
        planSlug: r.plan.planSlug,
        trialEndsAt: r.plan.trialEndsAt ? r.plan.trialEndsAt.toISOString() : null,
      },
    });

    // HOOK for CPN (referrals): resolve the code the person arrived with and announce the
    // attribution. CPN's consumer writes the `referrals` row and, later, the first-payment bonus.
    const referral = await this.findReferrer(tx, data.referralCode, data.email);
    if (referral) {
      await this.outbox.emit(tx, {
        orgId: r.org.id,
        aggregateModule: 'auth',
        aggregateId: r.user.id,
        eventType: 'referral.attributed',
        payload: {
          referrerUserUuid: referral.userUuid,
          referrerOrgUuid: referral.orgUuid,
          referredUserUuid: r.user.uuid,
          referredOrgUuid: r.org.uuid,
          codeUsed: referral.code,
        },
      });
    }
  }

  /**
   * Who owns this referral code? An unknown code is ignored (the sign-up goes on), and so is a code
   * that belongs to the same email address: Reference skips a person referring themselves. The code map
   * (`referral_codes`) is CPN's table; this reads it inside the privileged provisioning transaction
   * and writes nothing there.
   */
  private async findReferrer(
    tx: Tx,
    rawCode: string | null,
    newEmail: string,
  ): Promise<{ code: string; userUuid: string; orgUuid: string } | null> {
    const code = (rawCode ?? '').trim().toUpperCase();
    if (!code) return null;
    const res = await tx.execute(sql`
      SELECT u.uuid AS user_uuid, o.uuid AS org_uuid, u.email
      FROM referral_codes rc
      JOIN users u ON u.org_id = rc.owner_org_id AND u.id = rc.user_id
      JOIN organizations o ON o.id = rc.owner_org_id
      WHERE upper(rc.code) = ${code}
      LIMIT 1
    `);
    const row = res.rows[0] as unknown as
      { user_uuid: string; org_uuid: string; email: string } | undefined;
    if (!row || row.email.toLowerCase() === newEmail.toLowerCase()) return null;
    return { code, userUuid: row.user_uuid, orgUuid: row.org_uuid };
  }

  async sendVerification(
    orgId: number,
    slug: string,
    userId: number,
    email: string,
    name: string,
  ): Promise<boolean> {
    try {
      const token = await this.db.txAs({ orgId, userId }, (tx) =>
        this.tokens.issue(tx, orgId, userId, 'email_verify', Ttl.verifyEmailSeconds),
      );
      return await this.mail.sendVerifyEmail(
        email,
        name,
        this.mail.link('/verify-email', { org: slug, token }),
      );
    } catch (err) {
      this.logger.warn({ err }, 'verification mail not sent');
      return false;
    }
  }

  // --- helpers ---------------------------------------------------------------------------------------------------------

  private async chooseSlug(req: SignupRequest): Promise<{ slug: string; explicit: boolean }> {
    if (req.orgSlug) {
      const slug = req.orgSlug.toLowerCase();
      if (await this.tenants.slugExists(slug)) {
        throw new AppError(
          ERROR_CODES.AUTH_SLUG_TAKEN,
          'That workspace address is already taken.',
          HttpStatus.CONFLICT,
          [{ path: 'orgSlug', message: 'Already taken.' }],
        );
      }
      return { slug, explicit: true };
    }
    const base = slugify(req.orgName);
    if (!(await this.tenants.slugExists(base))) return { slug: base, explicit: false };
    for (let i = 0; i < 5; i++) {
      const candidate = slugWithSuffix(base);
      if (!(await this.tenants.slugExists(candidate))) return { slug: candidate, explicit: false };
    }
    throw new AppError(
      ERROR_CODES.AUTH_SLUG_TAKEN,
      'Could not find a free workspace address. Try another name.',
      HttpStatus.CONFLICT,
    );
  }

  /**
   * Work address only: refuses free mailbox providers, throwaway domains, operator-blocked domains
   * and domains with no mail server. Used by password and social sign-up alike.
   */
  async assertEmailAllowed(
    email: string,
    registration: Awaited<ReturnType<SecurityPolicyService['registration']>>,
  ): Promise<void> {
    const verdict = checkEmailDomain(email, registration);
    let reason = verdict.ok ? null : verdict.reason;
    if (!reason && (registration.blockDisposableEmail || registration.businessEmailOnly)) {
      const domain = emailDomain(email);
      if (domain && (await domainHasNoMailServer(domain))) reason = 'no_mail_server';
    }
    if (!reason) return;
    await this.audit.recordStandalone({
      event: 'auth.signup',
      status: 'failure',
      actorType: 'anonymous',
      payload: { reason: `email_${reason}`, domain: emailDomain(email) },
    });
    throw AppError.validation(EMAIL_POLICY_MESSAGES[reason], [
      { path: 'email', message: EMAIL_POLICY_MESSAGES[reason] },
    ]);
  }

  /** One guess made against a staged sign-up; returns how many have been made (this one included). */
  private async countGuess(stagedKey: string): Promise<number> {
    const k = triesKey(stagedKey);
    const results = await this.redis.multi().incr(k).expire(k, STAGE_TTL_SECONDS, 'NX').exec();
    return Number(results?.[0]?.[1] ?? 1);
  }

  /**
   * Per-address cap on sign-up code mails (start + resends), from any client: the email twin of the
   * phone path's `otpPhone` counter. Stops a spread-out attacker from re-opening fresh guess budgets
   * (or mail-bombing the address) by rotating IPs.
   */
  private async assertEmailSendAllowed(email: string): Promise<void> {
    if (
      await this.rate.allow(
        AuthKeys.signupEmailSends(email),
        EMAIL_CODE_SENDS_PER_ADDRESS_PER_HOUR,
        3600,
      )
    ) {
      return;
    }
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Too many codes requested. Try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** Reference throttles the code pages per client: more than `max` a minute is refused. */
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

  /**
   * Read-modify-write of an `EmailStage`. `KEEPTTL` keeps the stage's own expiry, and `XX` makes the
   * write a no-op when the key is gone: without it, a write racing `setPassword`'s DEL (or the TTL)
   * would recreate the stage with NO expiry, still `verified`, and reusable for unlimited accounts.
   * Returns false when the stage no longer existed.
   */
  private async stageWriteBack(key: string, stage: EmailStage): Promise<boolean> {
    return (await this.redis.set(key, JSON.stringify(stage), 'KEEPTTL', 'XX')) === 'OK';
  }

  private identityExistsError(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_IDENTITY_EXISTS,
      'An account with this email already exists.',
      HttpStatus.CONFLICT,
      [
        {
          path: 'email',
          message:
            'An account with this email already exists. Sign in, or ask a workspace admin to invite you.',
        },
      ],
    );
  }

  private signupExpired(): AppError {
    return new AppError(
      ERROR_CODES.AUTH_SIGNUP_EXPIRED,
      'Please start registration again.',
      HttpStatus.BAD_REQUEST,
    );
  }

  private async sendCode(phone: string, code: string, ttlMinutes: number): Promise<void> {
    try {
      await this.otpSender.send({ to: phone, code, ttlMinutes });
    } catch (err) {
      this.logger.error({ err }, 'registration OTP could not be sent');
      throw new AppError(
        ERROR_CODES.AUTH_OTP_SEND_FAILED,
        'We could not send the verification code. Please try again.',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}

/**
 * "a***a@example.com" — first and last character of the local part kept, the rest starred out,
 * the domain shown in full. Display only, like `maskPhone`; never the full address.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}
