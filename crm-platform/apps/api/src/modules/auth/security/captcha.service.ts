import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import {
  CAPTCHA_PORT,
  type CaptchaPort,
} from '../../../infra/providers/auth-registration-security/captcha.port';
import { AuthSettingsService } from '../platform/auth-settings.service';

/**
 * Applies the reCAPTCHA gate to a guest form (TW-AUTH-003).
 *
 * Off (or half-configured) means no gate at all, as in Reference. When on, a
 * missing or failing token is refused BEFORE any credential check, so a bot
 * learns nothing about whether an account exists.
 */
@Injectable()
export class CaptchaService {
  constructor(
    private readonly settings: AuthSettingsService,
    @Inject(CAPTCHA_PORT) private readonly port: CaptchaPort,
  ) {}

  async assert(
    token: string | undefined,
    action: 'login' | 'register' | 'forgot' | 'operator',
  ): Promise<void> {
    const config = await this.settings.captchaConfig();
    if (!config) return;

    const ok = token
      ? await this.port.verify(config, {
          token,
          remoteIp: RequestContextStore.peek()?.ip,
          expectedAction: action,
        })
      : false;

    if (!ok) {
      throw new AppError(
        ERROR_CODES.AUTH_CAPTCHA_FAILED,
        'Please complete the captcha and try again.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
