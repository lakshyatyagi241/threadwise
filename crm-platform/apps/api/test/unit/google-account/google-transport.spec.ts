import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  classifyApiError,
  classifyTokenError,
  GoogleCalendarError,
  googleFailureCode,
  parseRetryAfter,
} from '../../../src/infra/providers/appointments-booking/google-calendar.errors';
import { googleRequest } from '../../../src/infra/providers/appointments-booking/google-transport';

/** The shared Google transport (retries with jitter, Retry-After, timeouts) and the failure classification every Google call goes through. */
const saved = { ...process.env };
beforeEach(() => {
  process.env.GOOGLE_RETRY_BASE_MS = '1';
  process.env.GOOGLE_RETRIES = '2';
});
afterEach(() => {
  process.env = { ...saved };
});

const answer = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** A fetch that serves the given answers in order (an Error means the call failed before any answer) and counts calls. */
function sequence(...items: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = items[Math.min(calls.length - 1, items.length - 1)]!;
    if (next instanceof Error) throw next;
    return next.clone();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('retries', () => {
  it('repeats a transient failure and returns the answer that finally comes', async () => {
    const s = sequence(answer(503), answer(500), answer(200, { ok: 1 }));
    const out = await googleRequest('https://g.test/x', {
      classify: classifyApiError,
      fetchImpl: s.fetchImpl,
    });
    expect(out).toEqual({ ok: 1 });
    expect(s.calls).toHaveLength(3);
  });

  it('gives up after the configured number of extra attempts and throws the last failure', async () => {
    const s = sequence(answer(503));
    await expect(
      googleRequest('https://g.test/x', { classify: classifyApiError, fetchImpl: s.fetchImpl }),
    ).rejects.toMatchObject({ kind: 'server', status: 503 });
    expect(s.calls).toHaveLength(3);
  });

  it('retries a network error and a timeout, but never a bad request, a missing thing or a refused scope', async () => {
    const net = sequence(new TypeError('fetch failed'), answer(200, { a: 1 }));
    expect(
      await googleRequest('https://g.test/x', {
        classify: classifyApiError,
        fetchImpl: net.fetchImpl,
      }),
    ).toEqual({ a: 1 });

    for (const status of [400, 404, 403, 409]) {
      const s = sequence(answer(status, { error: { errors: [{ reason: 'x' }] } }));
      await expect(
        googleRequest('https://g.test/x', { classify: classifyApiError, fetchImpl: s.fetchImpl }),
      ).rejects.toBeInstanceOf(GoogleCalendarError);
      expect(s.calls).toHaveLength(1);
    }
  });

  it('does not repeat a call that must answer at once or cannot be repeated', async () => {
    const s = sequence(answer(503));
    await expect(
      googleRequest('https://g.test/x', {
        classify: classifyApiError,
        fetchImpl: s.fetchImpl,
        retries: 0,
      }),
    ).rejects.toMatchObject({ kind: 'server' });
    expect(s.calls).toHaveLength(1);
  });

  it('repeats a create-something call only when Google refused it before doing any work (429)', async () => {
    const five = sequence(answer(503));
    await expect(
      googleRequest('https://g.test/append', {
        method: 'POST',
        classify: classifyApiError,
        fetchImpl: five.fetchImpl,
        idempotent: false,
      }),
    ).rejects.toMatchObject({ kind: 'server' });
    expect(five.calls).toHaveLength(1);

    const limited = sequence(
      answer(429, { error: { status: 'RESOURCE_EXHAUSTED' } }),
      answer(200, { ok: 1 }),
    );
    expect(
      await googleRequest('https://g.test/append', {
        method: 'POST',
        classify: classifyApiError,
        fetchImpl: limited.fetchImpl,
        idempotent: false,
      }),
    ).toEqual({ ok: 1 });
    expect(limited.calls).toHaveLength(2);
  });

  it('honours a short Retry-After and hands a long one to the caller instead of sleeping on it', async () => {
    process.env.GOOGLE_RETRY_AFTER_CAP_SECONDS = '1';
    const short = sequence(answer(429, {}, { 'retry-after': '0' }), answer(200, { ok: 1 }));
    expect(
      await googleRequest('https://g.test/x', {
        classify: classifyApiError,
        fetchImpl: short.fetchImpl,
      }),
    ).toEqual({ ok: 1 });

    const long = sequence(answer(429, {}, { 'retry-after': '120' }));
    const err = await googleRequest('https://g.test/x', {
      classify: classifyApiError,
      fetchImpl: long.fetchImpl,
    }).catch((e: unknown) => e as GoogleCalendarError);
    expect(err).toMatchObject({ kind: 'rate_limit', retryAfterSeconds: 120 });
    expect(long.calls).toHaveLength(1);
  });

  it('sends the bearer token, refuses redirects, and does not put the token in an error', async () => {
    const s = sequence(answer(500, { error: 'secret-token-abc leaked?' }));
    const err = (await googleRequest('https://g.test/x', {
      token: 'secret-token-abc',
      classify: classifyApiError,
      fetchImpl: s.fetchImpl,
      retries: 0,
    }).catch((e: unknown) => e)) as Error;
    const init = s.calls[0]!.init;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-token-abc');
    expect(init.redirect).toBe('error');
    expect(String(err.message)).not.toContain('secret-token-abc');
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates, and ignores the rest', () => {
    expect(parseRetryAfter('17')).toBe(17);
    expect(parseRetryAfter(' 5 ')).toBe(5);
    expect(parseRetryAfter('999999')).toBe(3600);
    const now = Date.parse('2026-10-15T10:00:00Z');
    expect(parseRetryAfter('Thu, 15 Oct 2026 10:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('Thu, 15 Oct 2026 09:00:00 GMT', now)).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});

describe('classifying what Google answered', () => {
  const kind = (status: number, body: unknown) => classifyApiError(status, body).kind;

  it('tells a missing permission on the token from a file the account may not touch', () => {
    expect(
      kind(403, {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'Request had insufficient authentication scopes.',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      }),
    ).toBe('scope');
    expect(
      kind(403, {
        error: {
          code: 403,
          message: 'The caller does not have permission',
          status: 'PERMISSION_DENIED',
        },
      }),
    ).toBe('forbidden');
    expect(kind(403, { error: { errors: [{ reason: 'insufficientFilePermissions' }] } })).toBe(
      'forbidden',
    );
  });

  it('recognises an API the platform has not enabled, and rate limits worded either way', () => {
    expect(
      kind(403, {
        error: {
          code: 403,
          status: 'PERMISSION_DENIED',
          message: 'Google Sheets API has not been used in project 123 before or it is disabled.',
          details: [{ reason: 'SERVICE_DISABLED' }],
        },
      }),
    ).toBe('api_disabled');
    expect(kind(403, { error: { errors: [{ reason: 'accessNotConfigured' }] } })).toBe(
      'api_disabled',
    );
    expect(kind(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } })).toBe(
      'rate_limit',
    );
    expect(kind(429, { error: { status: 'RESOURCE_EXHAUSTED' } })).toBe('rate_limit');
  });

  it('maps every failure kind to one stable GOOGLE_ code', () => {
    const code = (k: ConstructorParameters<typeof GoogleCalendarError>[0]) =>
      googleFailureCode(new GoogleCalendarError(k, 0, ''));
    expect(code('invalid_grant')).toBe('GOOGLE_ACCOUNT_NEEDS_RECONNECT');
    expect(code('auth')).toBe('GOOGLE_ACCOUNT_NEEDS_RECONNECT');
    expect(code('invalid_client')).toBe('GOOGLE_ACCOUNT_NOT_CONFIGURED');
    expect(code('api_disabled')).toBe('GOOGLE_API_NOT_ENABLED');
    expect(code('scope')).toBe('GOOGLE_SCOPE_MISSING');
    expect(code('rate_limit')).toBe('GOOGLE_RATE_LIMITED');
    expect(code('not_found')).toBe('GOOGLE_NOT_FOUND');
    expect(code('gone')).toBe('GOOGLE_NOT_FOUND');
    expect(code('forbidden')).toBe('GOOGLE_ACCESS_DENIED');
    for (const k of ['server', 'network', 'timeout'] as const) {
      expect(code(k)).toBe('GOOGLE_UNAVAILABLE');
    }
    expect(code('conflict')).toBe('GOOGLE_BAD_REQUEST');
    expect(code('bad_request')).toBe('GOOGLE_BAD_REQUEST');
  });

  it('keeps the token endpoint wording for the OAuth calls', () => {
    expect(classifyTokenError(400, { error: 'invalid_grant' }).kind).toBe('invalid_grant');
    expect(classifyTokenError(401, { error: 'invalid_client' }).kind).toBe('invalid_client');
    expect(classifyTokenError(503, {}).kind).toBe('server');
  });
});
