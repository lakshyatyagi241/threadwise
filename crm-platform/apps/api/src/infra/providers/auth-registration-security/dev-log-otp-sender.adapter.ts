import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { OtpSendError, type OtpSendInput, type OtpSenderPort } from './otp-sender.port';

/**
 * The `dev` sender kind: writes the code to the API log instead of WhatsApp.
 *
 * Refuses to run in production (the registry also refuses to create one there)
 * so a leftover entry surfaces as a failed send rather than silently logging codes.
 */
@Injectable()
export class DevLogOtpSender implements OtpSenderPort {
  private readonly logger = new Logger('REG-OTP');

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(input: OtpSendInput): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production') {
      throw new OtpSendError('not_configured', 'The log sender is not available in production.');
    }
    this.logger.warn(`dev OTP for ${input.to}: ${input.code} (valid ${input.ttlMinutes} min)`);
  }
}
