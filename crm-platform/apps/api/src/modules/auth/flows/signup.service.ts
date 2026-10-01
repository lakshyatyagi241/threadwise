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
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
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
import { maskPhone, slugify, slugWithSuffix } from '../support/text';
import { UserTokensService } from './user-tokens.service';
import { LoginService, type ClientMeta } from './login.service';

export interface SignupData {
  orgName: string;
  slug: string;
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
  attempts: number;
  lastSentAt: number;
  ip: string | null;
}

const STAGE_TTL_SECONDS = 30 * 60;
const SIGNUPS_PER_IP_PER_HOUR = 10;
const OTP_SENDS_PER_NUMBER_PER_HOUR = 5;
const OTP_SENDS_PER_IP_PER_HOUR = 15;

/**
 * Account creation (TW-AUTH-005/006/008-prep). Creates the organization and its
 * first user together; there is no global "user first" step.
 *
 * With registration OTP active, nothing is created until the WhatsApp code is
 * confirmed: no ghost accounts. The staged request keeps an argon2 hash of the
 * password, never the password (Reference kept it in the session in plaintext).
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
    const slug = await this.chooseSlug(req);
    const passwordHash = await this.passwords.hash(req.password);

    // The real activation rule: enabled, a sender that can deliver and, for a WhatsApp Business
    // sender, an approved template. Otherwise sign-up silently skips the code (TW-AUTH-006).
    const otpActive = (await this.otp.statusFor(registration)).active;
    if (!otpActive) {
      return this.create(
        {
          orgName: req.orgName,
          slug,
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
        fullName: req.fullName,
        email: req.email,
        phoneE164: req.phone,
        passwordHash,
        referralCode: req.referralCode ?? null,
      },
      otpHash: await hash(code),
      expiresAt: Date.now() + registration.otp.ttlMinutes * 60_000,
      attempts: 0,
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
    const key = AuthKeys.signup(req.challengeId);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new AppError(
        ERROR_CODES.AUTH_SIGNUP_EXPIRED,
        'Please start registration again.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const staged = JSON.parse(raw) as StagedSignup;

    if (Date.now() > staged.expiresAt) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_EXPIRED,
        'That code has expired. Request a new one.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (staged.attempts >= registration.otp.maxAttempts) {
      throw new AppError(
        ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS,
        'Too many attempts. Request a new code.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const ok = await verify(staged.otpHash, req.code.trim()).catch(() => false);
    if (!ok) {
      staged.attempts += 1;
      await this.redis.setex(key, STAGE_TTL_SECONDS, JSON.stringify(staged));
      throw new AppError(
        ERROR_CODES.AUTH_OTP_INVALID,
        'That code is not correct.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.redis.del(key);
    const result = await this.create(staged.data, { phoneVerified: true }, meta);
    if (result.status !== 'authenticated')
      throw new Error('unreachable: create returns authenticated');
    return result;
  }

  async resendOtp(
    req: SignupResendOtpRequest,
  ): Promise<{ expiresInSeconds: number; resendCooldownSeconds: number }> {
    const registration = await this.policy.registration();
    const key = AuthKeys.signup(req.challengeId);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new AppError(
        ERROR_CODES.AUTH_SIGNUP_EXPIRED,
        'Please start registration again.',
        HttpStatus.BAD_REQUEST,
      );
    }
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
    staged.attempts = 0;
    staged.lastSentAt = Date.now();
    await this.sendCode(staged.data.phoneE164, code, registration.otp.ttlMinutes);
    await this.redis.setex(key, STAGE_TTL_SECONDS, JSON.stringify(staged));

    return {
      expiresInSeconds: registration.otp.ttlMinutes * 60,
      resendCooldownSeconds: registration.otp.resendCooldownSec,
    };
  }

  // --- shared creation path ---------------------------------------------------------------------------------

  /**
   * Provisions the organization and opens the first session. Used by plain
   * sign-up, OTP-verified sign-up and social sign-up.
   */
  async create(
    data: SignupData,
    opts: {
      phoneVerified: boolean;
      emailVerified?: boolean;
      socialLink?: { provider: 'google' | 'facebook'; subject: string; email: string | null };
    },
    meta: ClientMeta,
  ): Promise<Authenticated> {
    const registration = await this.policy.registration();
    // 'off' auto-verifies, as Reference's auto_verify_email does; otherwise only a
    // provider-asserted email counts as verified at creation.
    const verifiedNow = registration.emailVerification === 'off' || opts.emailVerified === true;

    const result = await this.tenants.provisionOrganization(
      {
        orgName: data.orgName,
        slug: data.slug,
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
      async (tx, r) => {
        if (opts.socialLink) {
          await tx.execute(sql`
            INSERT INTO social_identities (org_id, user_id, provider, provider_subject, email)
            VALUES (${r.org.id}, ${r.user.id}, ${opts.socialLink.provider}, ${opts.socialLink.subject}, ${opts.socialLink.email})
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
        // outcome. Consumers: CPN (referral attribution), NOTIF (welcome).
        // They read this event; this domain does not call them.
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
      },
    );

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
      remember: false,
      mfaVerified: false,
      method: 'signup',
      meta,
    });
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

  private async chooseSlug(req: SignupRequest): Promise<string> {
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
      return slug;
    }
    const base = slugify(req.orgName);
    if (!(await this.tenants.slugExists(base))) return base;
    for (let i = 0; i < 5; i++) {
      const candidate = slugWithSuffix(base);
      if (!(await this.tenants.slugExists(candidate))) return candidate;
    }
    throw new AppError(
      ERROR_CODES.AUTH_SLUG_TAKEN,
      'Could not find a free workspace address. Try another name.',
      HttpStatus.CONFLICT,
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
