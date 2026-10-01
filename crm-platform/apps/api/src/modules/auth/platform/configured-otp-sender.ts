import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OtpTemplateState } from '@crm/contracts';
import type { Env } from '../../../config/env.schema';
import { DevLogOtpSender } from '../../../infra/providers/auth-registration-security/dev-log-otp-sender.adapter';
import type { CallOptions } from '../../../infra/providers/auth-registration-security/otp-http';
import {
  OtpSendError,
  type OtpSendInput,
  type OtpSenderPort,
} from '../../../infra/providers/auth-registration-security/otp-sender.port';
import { BridgeOtpSender } from '../../../infra/providers/auth-registration-security/bridge-otp-sender.adapter';
import { TwilioOtpSender } from '../../../infra/providers/auth-registration-security/twilio-otp-sender.adapter';
import { WabaOtpSender } from '../../../infra/providers/auth-registration-security/waba-otp-sender.adapter';
import { OtpSenderRegistryService } from './otp-sender-registry.service';
import { SecurityPolicyService } from './security-policy.service';

/**
 * `OTP_SENDER_PORT`: picks the sender from the registration settings at send
 * time, so changing the sender in the operator console takes effect on the next
 * sign-up with no restart. It resolves the registry entry (secrets decrypted
 * here, nowhere else) and hands the code to the adapter for its kind.
 */
@Injectable()
export class ConfiguredOtpSender implements OtpSenderPort {
  private readonly appName: string;
  /** Overridden in tests (short timeout); the defaults are the real thing. */
  transport: Pick<CallOptions, 'timeoutMs' | 'fetchImpl'> = {};

  constructor(
    private readonly policy: SecurityPolicyService,
    private readonly registry: OtpSenderRegistryService,
    private readonly dev: DevLogOtpSender,
    config: ConfigService<Env, true>,
  ) {
    this.appName = config.get('APP_NAME', { infer: true });
  }

  async send(input: OtpSendInput): Promise<void> {
    const { otp } = await this.policy.registration();
    await this.sendVia(otp.sender, otp.template, input);
  }

  /**
   * Delivers through one named sender: the saved one at sign-up, or whichever an
   * operator is testing. `template` is the saved OTP template; it applies only
   * to the sender it was created for.
   */
  async sendVia(
    ref: string | null,
    template: OtpTemplateState | null,
    input: OtpSendInput,
  ): Promise<void> {
    if (!ref) throw new OtpSendError('not_configured', 'No sender is selected.');
    const sender = await this.registry.resolve(ref);
    if (!sender) {
      throw new OtpSendError('not_configured', 'The sender is missing, incomplete or unavailable.');
    }
    const own = template && template.sender === ref ? template : null;
    const message = {
      templateBody: own?.kind === 'local' ? own.body : null,
      appName: this.appName,
    };

    switch (sender.kind) {
      case 'waba':
        if (!own || own.kind !== 'waba' || own.status !== 'approved') {
          throw new OtpSendError('template_not_approved', 'The OTP template is not approved yet.');
        }
        return new WabaOtpSender(
          sender,
          { name: own.name, language: own.language },
          this.transport,
        ).send(input);
      case 'twilio':
        return new TwilioOtpSender(sender, message, this.transport).send(input);
      case 'device':
        return new BridgeOtpSender(sender, message, this.transport).send(input);
      default:
        return this.dev.send(input);
    }
  }
}
