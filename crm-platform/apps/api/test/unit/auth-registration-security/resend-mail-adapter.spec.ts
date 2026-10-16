import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/config/env.schema';
import { MailError } from '../../../src/infra/providers/auth-registration-security/mail.port';
import { ResendMailAdapter } from '../../../src/infra/providers/auth-registration-security/resend-mail.adapter';

const FAKE_API_KEY = 're_test_fake_key_for_unit_tests';

const config = (env: Partial<{ RESEND_API_KEY: string; SMTP_FROM: string }> = {}) =>
  ({
    get: (k: string) =>
      ({
        RESEND_API_KEY: FAKE_API_KEY,
        SMTP_FROM: 'no-reply@example.test',
        ...env,
      })[k],
  }) as unknown as ConfigService<Env, true>;

const message = { to: 'a@b.test', subject: 'hi', text: 'hello', html: '<p>hello</p>' };

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('ResendMailAdapter', () => {
  it('posts to the Resend API with the mapped fields and the bearer key', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200, { id: 'abc' }));
    await new ResendMailAdapter(config()).send(message);

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe('https://api.resend.com/emails');
    expect(init!.method).toBe('POST');
    const headers = init!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${FAKE_API_KEY}`);
    expect(JSON.parse(String(init!.body))).toEqual({
      from: 'no-reply@example.test',
      to: 'a@b.test',
      subject: 'hi',
      text: 'hello',
      html: '<p>hello</p>',
      reply_to: undefined,
    });
  });

  it('reports not_configured when the API key is missing, without calling Resend', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(new ResendMailAdapter(config({ RESEND_API_KEY: undefined })).send(message)).rejects.toMatchObject(
      { reason: 'not_configured' } satisfies Partial<MailError>,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports not_configured when the sender address is unset', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(
      new ResendMailAdapter(config({ SMTP_FROM: undefined })).send(message),
    ).rejects.toMatchObject({ reason: 'not_configured' });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([401, 403])('maps HTTP %d to auth_failed', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(status, { message: 'bad key' }));
    await expect(new ResendMailAdapter(config()).send(message)).rejects.toMatchObject({
      reason: 'auth_failed',
    });
  });

  it('maps a network-level fetch rejection to connection_refused', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new ResendMailAdapter(config()).send(message)).rejects.toMatchObject({
      reason: 'connection_refused',
    });
  });

  it('maps an abort/timeout to timeout', async () => {
    const timeoutError = new DOMException('The operation was aborted.', 'TimeoutError');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(timeoutError);
    await expect(new ResendMailAdapter(config()).send(message)).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  it('maps a generic non-2xx response to transport_error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(422, { message: 'missing field' }));
    await expect(new ResendMailAdapter(config()).send(message)).rejects.toMatchObject({
      reason: 'transport_error',
    });
  });

  it('never logs the API key or the authorization header', async () => {
    const calls: unknown[] = [];
    const adapter = new ResendMailAdapter(config());
    const logger = (adapter as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger;
    vi.spyOn(logger, 'warn').mockImplementation((...args: unknown[]) => {
      calls.push(args);
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(401, { message: 'bad key' }));

    await expect(adapter.send(message)).rejects.toMatchObject({ reason: 'auth_failed' });

    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain(FAKE_API_KEY);
    expect(serialized.toLowerCase()).not.toContain('bearer');
  });
});
