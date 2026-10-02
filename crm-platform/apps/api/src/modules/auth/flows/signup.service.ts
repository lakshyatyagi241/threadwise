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
 * How long a sign-up waits for its code. WaDesk keeps the pending sign-up in the session (7 days);
 * the code itself expires after `otp.ttlMinutes`, and a resend issues a fresh one at any time.
 */
const STAGE_TTL_SECONDS = 7 * 24 * 60 * 60;
const SIGNUPS_PER_IP_PER_HOUR = 10;
const OTP_SENDS_PER_NUMBER_PER_HOUR = 5;
const OTP_SENDS_PER_IP_PER_HOUR = 15;
/** WaDesk's guest throttles: verify 10 a minute, resend 5 a minute, per client. */
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
 * Account creation (WD-AUTH-005/006/008-prep). Creates the organization and its
 * first user together; there is no global "user first" step.
 *
 * With registration OTP active, nothing is created until the WhatsApp code is
 * confirmed: no ghost accounts. The staged request keeps an argon2 hash of the
 * password, never the password (WaDesk kept it in the session in plaintext).
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

    // The real activation rule: enabled, a sender that can deliver and, for a WhatsApp Business
    // sender, an approved template. Otherwise sign-up silently skips the code (WD-AUTH-006).
    const otpActive = (await this.otp.statusFor(registration)).active;
    if (!otpActive) {
      return this.create(
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
        { phoneVerified: false },
        meta,
      );
    }

    // OTP path: the number is required and is the one thing we must not let
    // be turned into a free SMS cannon.
    if (!req.phone) {
      throw AppError.validation('A mobile number is required to verify your account.', [
        { path: 'phone', message: 'A mobile number is required.' },
      ]);
    }
    if (
      !(await this.rate.allow(AuthKeys.otpPhone(req.phone), OTP_SENDS_PER_NUMBER_PER_HOUR, 3600)) ||
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
      data: {
        orgName: req.orgName,
        slug,
        slugExplicit: explicit,
        fullName: req.fullName,
        email: req.email,
        phoneE164: req.phone,
        passwordHash,
        referralCode: req.referralCode ?? null,
      },
      otpHash: await hash(code),
      expiresAt: Date.now() + registration.otp.ttlMinutes * 60_000,
      lastSentAt: Date.now(),
      ip,
    };

    await this.sendCode(req.phone, code, registration.otp.ttlMinutes);
    await this.redis.setex(AuthKeys.signup(challengeId), STAGE_TTL_SECONDS, JSON.stringify(staged));

    return {
      status: 'otp_required',
      challengeId,
      maskedPhone: maskPhone(req.phone),
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
    const result = await this.create(
      (JSON.parse(claimed) as StagedSignup).data,
      { phoneVerified: true, slugFallback: true },
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
   * loses the INSERT). A derived address is simply drawn again, as WaDesk does; a typed one is
   * reported back unless `slugFallback` says the form cannot be shown again.
   */
  async create(data: SignupData, opts: CreateOptions, meta: ClientMeta): Promise<Authenticated> {
    const [registration, securityPolicy] = await Promise.all([
      this.policy.registration(),
      this.policy.policy(),
    ]);
    // 'off' auto-verifies, as WaDesk's auto_verify_email does; otherwise only a
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
      // WaDesk signs a new account in without remembering it; a social sign-up always remembers.
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

    // HOOK for NOTIF (welcome notification, WD-AUTH-005 / Report E item 16): WaDesk drops an in-app
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
   * that belongs to the same email address: WaDesk skips a person referring themselves. The code map
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

  /** One guess made against a staged sign-up; returns how many have been made (this one included). */
  private async countGuess(stagedKey: string): Promise<number> {
    const k = triesKey(stagedKey);
    const results = await this.redis.multi().incr(k).expire(k, STAGE_TTL_SECONDS, 'NX').exec();
    return Number(results?.[0]?.[1] ?? 1);
  }

  /** WaDesk throttles the code pages per client: more than `max` a minute is refused. */
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
