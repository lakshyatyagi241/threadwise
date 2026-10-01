import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecaptchaAdapter } from '../../../src/infra/providers/auth-registration-security/recaptcha.adapter';

const v2 = { version: 'v2' as const, secret: 'sek', threshold: 0 };
const v3 = { version: 'v3' as const, secret: 'sek', threshold: 0.5 };
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('RecaptchaAdapter', () => {
  it('posts the secret, token and client address to siteverify', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply({ success: true }));
    expect(await new RecaptchaAdapter().verify(v2, { token: 'tok', remoteIp: '203.0.113.9' })).toBe(
      true,
    );
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://www.google.com/recaptcha/api/siteverify');
    expect(Object.fromEntries(new URLSearchParams(String(init!.body)))).toEqual({
      secret: 'sek',
      response: 'tok',
      remoteip: '203.0.113.9',
    });
  });

  it('refuses without a token and does not call Google', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await new RecaptchaAdapter().verify(v2, { token: '' })).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses when Google says no, answers with an error status, or is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({ success: false }));
    expect(await new RecaptchaAdapter().verify(v2, { token: 't' })).toBe(false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply({}, 500));
    expect(await new RecaptchaAdapter().verify(v2, { token: 't' })).toBe(false);
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));
    expect(await new RecaptchaAdapter().verify(v2, { token: 't' })).toBe(false);
  });

  it('v3 needs a score at or above the threshold', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockResolvedValueOnce(reply({ success: true, score: 0.9, action: 'login' }));
    expect(await new RecaptchaAdapter().verify(v3, { token: 't', expectedAction: 'login' })).toBe(
      true,
    );
    spy.mockResolvedValueOnce(reply({ success: true, score: 0.3, action: 'login' }));
    expect(await new RecaptchaAdapter().verify(v3, { token: 't', expectedAction: 'login' })).toBe(
      false,
    );
    spy.mockResolvedValueOnce(reply({ success: true, action: 'login' }));
    expect(await new RecaptchaAdapter().verify(v3, { token: 't' })).toBe(false);
  });

  it('v3 rejects a token minted for another form', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      reply({ success: true, score: 0.9, action: 'register' }),
    );
    expect(await new RecaptchaAdapter().verify(v3, { token: 't', expectedAction: 'login' })).toBe(
      false,
    );
  });
});
