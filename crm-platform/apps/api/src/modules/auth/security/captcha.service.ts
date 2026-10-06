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

  /**
   * What a guest form needs to draw the widget: the provider version and the PUBLIC site key. Null when the gate is off or half-configured
   * (then there is nothing to draw and `assert` lets everything through). The secret never leaves the settings service.
   */
  async publicConfig(): Promise<{ version: 'v2' | 'v3'; siteKey: string } | null> {
    const config = await this.settings.captchaConfig();
    return config ? { version: config.version, siteKey: config.siteKey } : null;
  }

  async assert(
    token: string | undefined,
    action: 'login' | 'register' | 'forgot' | 'operator' | 'contact' | 'form',
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
