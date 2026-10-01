/**
 * Bot gate for the guest forms (TW-AUTH-003).
 *
 * Configuration is passed per call, not injected: it lives in platform
 * settings and an operator can change it without a restart.
 */
export interface CaptchaConfig {
  version: 'v2' | 'v3';
  secret: string;
  /** v3 only. A stored 0 means "use 0.5", as Reference does. */
  threshold: number;
}

export interface CaptchaVerifyInput {
  token: string;
  remoteIp?: string;
  /** v3 action name the page executed, e.g. 'login'. Checked when the provider returns one. */
  expectedAction?: string;
}

export interface CaptchaPort {
  /** Fails closed: any doubt (network, bad JSON, low score) is `false`. */
  verify(config: CaptchaConfig, input: CaptchaVerifyInput): Promise<boolean>;
}

export const CAPTCHA_PORT = Symbol('CAPTCHA_PORT');
