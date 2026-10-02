import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_PRIVACY_URL,
  GOOGLE_TERMS_URL,
  SCRIPT_WAIT_MS,
  recaptchaScriptUrl,
  withTimeout,
} from './captcha';

describe('recaptchaScriptUrl', () => {
  it('v3 loads the library with the site key, v2 renders explicitly; both carry the language', () => {
    expect(recaptchaScriptUrl({ version: 'v3', siteKey: 'k 1' }, 'ar')).toBe(
      'https://www.google.com/recaptcha/api.js?render=k%201&hl=ar',
    );
    expect(recaptchaScriptUrl({ version: 'v2', siteKey: 'k' }, 'en')).toBe(
      'https://www.google.com/recaptcha/api.js?render=explicit&hl=en',
    );
  });
});

describe('v3 token budget', () => {
  afterEach(() => vi.useRealTimers());

  it('waits at most six seconds in total, then gives up so the form is submitted anyway', async () => {
    vi.useFakeTimers();
    expect(SCRIPT_WAIT_MS).toBe(6000);
    const never = new Promise<string>(() => undefined);
    const outcome = withTimeout(never, SCRIPT_WAIT_MS).then(
      () => 'token',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(5999);
    await vi.advanceTimersByTimeAsync(2);
    expect(await outcome).toBe('timeout');
  });

  it('returns the token as soon as there is one', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve('tok'), SCRIPT_WAIT_MS)).resolves.toBe('tok');
  });

  it('passes a failure through unchanged', async () => {
    await expect(withTimeout(Promise.reject(new Error('blocked')), 1000)).rejects.toThrow(
      'blocked',
    );
  });
});

describe('notice links', () => {
  it('point at Google privacy and terms pages', () => {
    expect(GOOGLE_PRIVACY_URL).toBe('https://policies.google.com/privacy');
    expect(GOOGLE_TERMS_URL).toBe('https://policies.google.com/terms');
  });
});
