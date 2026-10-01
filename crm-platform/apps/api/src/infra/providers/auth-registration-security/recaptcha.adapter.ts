import { Injectable, Logger } from '@nestjs/common';
import type { CaptchaConfig, CaptchaPort, CaptchaVerifyInput } from './captcha.port';

const SITEVERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const TIMEOUT_MS = 10_000;

interface SiteverifyResponse {
  success?: boolean;
  score?: number;
  action?: string;
}

/** Google reCAPTCHA v2 (checkbox) and v3 (score). */
@Injectable()
export class RecaptchaAdapter implements CaptchaPort {
  private readonly logger = new Logger(RecaptchaAdapter.name);

  async verify(config: CaptchaConfig, input: CaptchaVerifyInput): Promise<boolean> {
    if (!input.token) return false;

    try {
      const body = new URLSearchParams({ secret: config.secret, response: input.token });
      if (input.remoteIp) body.set('remoteip', input.remoteIp);

      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return false;

      const json = (await res.json()) as SiteverifyResponse;
      if (json.success !== true) return false;

      if (config.version === 'v3') {
        const threshold = config.threshold > 0 ? config.threshold : 0.5;
        if (typeof json.score !== 'number' || json.score < threshold) return false;
        // WaDesk never compared the action Google echoes back, so a token
        // minted for one form was accepted on any other.
        if (input.expectedAction && json.action && json.action !== input.expectedAction) {
          return false;
        }
      }
      return true;
    } catch (err) {
      this.logger.warn({ err }, 'recaptcha verification failed closed');
      return false;
    }
  }
}
