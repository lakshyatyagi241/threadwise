import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  parseOtpSenderRef,
  registrationSettingsPatchSchema,
  registrationSettingsSchema,
  type OtpStatus,
  type OtpTestRequest,
  type OtpTestResponse,
  type RegistrationSettings,
  type RegistrationSettingsResponse,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { OtpSendError } from '../../../infra/providers/auth-registration-security/otp-sender.port';
import { AuthAuditService } from '../security/auth-audit.service';
import { RateLimitService } from '../security/rate-limit.service';
import { randomNumericCode } from '../support/crypto-utils';
import { AuthKeys } from '../support/redis-keys';
import { maskPhone } from '../flows/phone-mask';
import { ConfiguredOtpSender } from './configured-otp-sender';
import { evaluateOtpActivation } from './otp-activation';
import { OtpSenderRegistryService } from './otp-sender-registry.service';
import { SecurityPolicyService } from './security-policy.service';

export const OTP_TESTS_PER_HOUR = 5;

type OtpKnob = 'ttlMinutes' | 'length' | 'resendCooldownSec' | 'maxAttempts';
const OTP_KNOBS: readonly OtpKnob[] = ['ttlMinutes', 'length', 'resendCooldownSec', 'maxAttempts'];
/** The documented defaults (WaDesk: 5 minutes, 6 digits, 60 seconds, 5 attempts), straight from the schema. */
const OTP_KNOB_DEFAULTS = registrationSettingsSchema.parse({}).otp;

/**
 * A blank field of the OTP form means "use the default", never 0 and never an error (WaDesk's
 * validity box saves 5 when left empty). `null`, an empty or blank string and NaN are blank; a
 * whole number typed as text is read as the number. A number out of range is still refused.
 */
export function withDefaultKnobs(body: unknown): unknown {
  const otp = (body as { otp?: Record<string, unknown> } | null)?.otp;
  if (!otp || typeof otp !== 'object') return body;
  const next: Record<string, unknown> = { ...otp };
  for (const knob of OTP_KNOBS) {
    if (!(knob in next)) continue;
    const v = next[knob];
    if (v === null || (typeof v === 'number' && Number.isNaN(v))) {
      next[knob] = OTP_KNOB_DEFAULTS[knob];
    } else if (typeof v === 'string') {
      const t = v.trim();
      next[knob] = t === '' ? OTP_KNOB_DEFAULTS[knob] : /^\d+$/.test(t) ? Number(t) : v;
    }
  }
  return { ...(body as object), otp: next };
}

/**
 * The sign-up code as a platform feature: is it on, change its settings, and
 * send an operator a test. One injectable so the mobile two-factor (MOB) can
 * reuse the same activation rule and sender (WD-AUTH-006 port notes).
 */
@Injectable()
export class RegistrationOtpService {
  private readonly logger = new Logger(RegistrationOtpService.name);

  constructor(
    private readonly policy: SecurityPolicyService,
    private readonly registry: OtpSenderRegistryService,
    private readonly sender: ConfiguredOtpSender,
    private readonly rate: RateLimitService,
    private readonly audit: AuthAuditService,
  ) {}

  /** The activation rule (WD-AUTH-006 rule 1) applied to the saved settings. */
  async statusFor(registration: RegistrationSettings): Promise<OtpStatus> {
    const { otp } = registration;
    return evaluateOtpActivation({
      enabled: otp.enabled,
      sender: otp.sender,
      template: otp.template,
      senderState: otp.sender ? await this.registry.stateOf(otp.sender) : 'missing',
    });
  }

  async status(): Promise<OtpStatus> {
    return this.statusFor(await this.policy.registration());
  }

  /** True when sign-up must ask for a code. Anything else skips the step silently. */
  async isActive(): Promise<boolean> {
    return (await this.status()).active;
  }

  /** What GET and PATCH registration return: the stored settings plus the live verdict. */
  async settingsResponse(
    registration?: RegistrationSettings,
  ): Promise<RegistrationSettingsResponse> {
    const reg = registration ?? (await this.policy.registration());
    return { ...reg, otpStatus: await this.statusFor(reg) };
  }

  /**
   * Partial update of the registration settings. The one addition over the
   * policy service: a chosen sender must exist in the registry (and `dev` only
   * outside production), so a typo cannot silently turn the code step off.
   */
  async patchRegistration(
    body: unknown,
    operatorId: number,
  ): Promise<{ before: RegistrationSettings; after: RegistrationSettings }> {
    const patch = registrationSettingsPatchSchema.parse(withDefaultKnobs(body));
    const sender = patch.otp?.sender;
    if (typeof sender === 'string') await this.assertSelectable(sender, 'otp.sender');
    return this.policy.patchRegistration(patch, operatorId);
  }

  /** A sender the operator can pick: it exists, and `dev` is not offered in production. */
  async assertSelectable(ref: string, path: string): Promise<void> {
    const state = await this.registry.stateOf(ref);
    if (state === 'missing') {
      throw AppError.validation('That sender does not exist. Add it under Manage senders first.', [
        { path, message: 'That sender does not exist.' },
      ]);
    }
    if (state === 'dev_in_production') {
      throw AppError.validation('The log sender is not available in production.', [
        { path, message: 'Not available in production.' },
      ]);
    }
  }

  /**
   * Sends a real code to a number an operator typed, through the saved sender
   * (or the one named), so a new sender can be checked before sign-ups depend
   * on it. Rate-limited per operator, audited, and the code is never returned.
   */
  async testSend(operatorId: number, input: OtpTestRequest): Promise<OtpTestResponse> {
    const registration = await this.policy.registration();
    const ref = input.sender ?? registration.otp.sender;
    if (!ref || !parseOtpSenderRef(ref)) {
      throw AppError.validation('Pick a sender first.', [
        { path: 'sender', message: 'Pick a sender first.' },
      ]);
    }
    const state = await this.registry.stateOf(ref);
    if (state === 'missing' || state === 'dev_in_production') {
      await this.assertSelectable(ref, 'sender');
    }
    if (state === 'incomplete') {
      throw AppError.validation(
        'This sender is missing credentials. Finish it under Manage senders.',
        [{ path: 'sender', message: 'This sender is missing credentials.' }],
      );
    }

    // Counted before the send, so failed attempts cost a slot too.
    const { count, retryAfterSeconds } = await this.rate.hit(AuthKeys.otpTest(operatorId), 3600);
    if (count > OTP_TESTS_PER_HOUR) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many test codes. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: 'retryAfterSeconds', message: String(retryAfterSeconds) }],
      );
    }

    const code = randomNumericCode(registration.otp.length);
    const sentTo = maskPhone(input.to);
    try {
      await this.sender.sendVia(ref, registration.otp.template, {
        to: input.to,
        code,
        ttlMinutes: registration.otp.ttlMinutes,
      });
    } catch (err) {
      const reason = err instanceof OtpSendError ? err.reason : 'transport_error';
      const message = err instanceof OtpSendError ? err.message : 'The code could not be sent.';
      if (!(err instanceof OtpSendError)) this.logger.error({ err }, 'OTP test send failed');
      await this.audit.recordStandalone({
        event: 'platform.settings.otp_test_sent',
        status: 'failure',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { sender: ref, to: sentTo, outcome: reason },
      });
      throw new AppError(
        ERROR_CODES.AUTH_OTP_SEND_FAILED,
        `The test code could not be sent. ${message}`,
        HttpStatus.BAD_GATEWAY,
        [{ path: 'reason', message: reason }],
      );
    }
    await this.audit.recordStandalone({
      event: 'platform.settings.otp_test_sent',
      status: 'info',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload: { sender: ref, to: sentTo, outcome: 'sent' },
    });
    return {
      ok: true,
      sender: ref,
      sentTo,
      remainingThisHour: Math.max(0, OTP_TESTS_PER_HOUR - count),
    };
  }
}
