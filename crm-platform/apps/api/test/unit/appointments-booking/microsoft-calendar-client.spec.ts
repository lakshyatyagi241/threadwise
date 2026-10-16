import { afterEach, describe, expect, it } from 'vitest';
import { MICROSOFT_CALENDAR_SCOPES } from '@crm/contracts';
import { microsoftCalendarEnv } from '../../../src/config/domains/microsoft-calendar.env';
import {
  classifyGraphError,
  classifyMicrosoftTokenError,
  MicrosoftCalendarClient,
  MicrosoftCalendarError,
  microsoftHealthCode,
} from '../../../src/infra/providers/appointments-booking';
import { microsoftRequest } from '../../../src/infra/providers/appointments-booking/microsoft-transport';

/** The consent URL, the environment, the error classification and the transport of the Outlook adapter (BL-035). */
const creds = {
  clientId: '11111111-2222-3333-4444-555555555555',
  clientSecret: 's',
  tenant: 'common',
  redirectUri: 'https://app.test/v2/public/appointments/calendar/microsoft/callback',
};

describe('the consent URL', () => {
  const saved = process.env.MICROSOFT_CALENDAR_LOGIN_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.MICROSOFT_CALENDAR_LOGIN_URL;
    else process.env.MICROSOFT_CALENDAR_LOGIN_URL = saved;
  });

  it('asks for the calendar and offline access, and nothing about mail, files or contacts', () => {
    const url = new URL(new MicrosoftCalendarClient().authorizeUrl(creds, 'the-state'));
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe(creds.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(creds.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('the-state');
    const scopes = url.searchParams.get('scope')!.split(' ');
    expect(scopes).toEqual([...MICROSOFT_CALENDAR_SCOPES]);
    expect(scopes).toContain('offline_access');
    expect(scopes).toContain('Calendars.ReadWrite');
    expect(scopes.some((s) => /^(mail|files|contacts|directory)\./i.test(s))).toBe(false);
  });

  it('lets a person pick the account, or keeps the connected one on a reconnect', () => {
    const fresh = new URL(new MicrosoftCalendarClient().authorizeUrl(creds, 's'));
    expect(fresh.searchParams.get('prompt')).toBe('select_account');
    const again = new URL(
      new MicrosoftCalendarClient().authorizeUrl(creds, 's', 'ana@example.com'),
    );
    expect(again.searchParams.get('login_hint')).toBe('ana@example.com');
    expect(again.searchParams.get('prompt')).toBeNull();
  });

  it('uses the tenant in the authority, escaped, and the address in the environment', () => {
    process.env.MICROSOFT_CALENDAR_LOGIN_URL = 'http://127.0.0.1:9999/';
    const url = new MicrosoftCalendarClient().authorizeUrl({ ...creds, tenant: 'a b' }, 's');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9999\/a%20b\/oauth2\/v2\.0\/authorize\?/);
  });
});

describe('the environment', () => {
  it('has Microsoft\'s real addresses by default and a blank value means "not set"', () => {
    const env = microsoftCalendarEnv({
      MICROSOFT_CALENDAR_GRAPH_URL: '',
      MICROSOFT_CALENDAR_CLIENT_ID: ' ',
    });
    expect(env.MICROSOFT_CALENDAR_GRAPH_URL).toBe('https://graph.microsoft.com/v1.0');
    expect(env.MICROSOFT_CALENDAR_LOGIN_URL).toBe('https://login.microsoftonline.com');
    expect(env.MICROSOFT_CALENDAR_CLIENT_ID).toBeUndefined();
    expect(env.MICROSOFT_CALENDAR_HTTP_TIMEOUT_MS).toBe(8000);
  });

  it('refuses an address that is not a URL, naming the variable', () => {
    expect(() => microsoftCalendarEnv({ MICROSOFT_CALENDAR_GRAPH_URL: 'nope' })).toThrow(
      /MICROSOFT_CALENDAR_GRAPH_URL/,
    );
  });
});

describe('classifying a token answer', () => {
  const kind = (status: number, body: unknown) => classifyMicrosoftTokenError(status, body).kind;

  it('a refused refresh token needs a new consent', () => {
    expect(kind(400, { error: 'invalid_grant', error_codes: [70008] })).toBe('invalid_grant');
    expect(
      kind(400, { error: 'interaction_required', error_description: 'AADSTS50076: MFA' }),
    ).toBe('invalid_grant');
    expect(kind(400, { error: 'weird', error_codes: [700082] })).toBe('invalid_grant');
  });

  it("a wrong or expired secret is the platform's problem, not the workspace's", () => {
    expect(kind(401, { error: 'invalid_client', error_codes: [7000215] })).toBe('invalid_client');
    expect(kind(400, { error: 'x', error_description: 'AADSTS700016: app not found' })).toBe(
      'invalid_client',
    );
  });

  it('throttling and outages are transient; anything else is a bad request', () => {
    expect(kind(429, {})).toBe('rate_limit');
    expect(kind(503, null)).toBe('server');
    expect(kind(400, { error: 'invalid_request' })).toBe('bad_request');
  });
});

describe('classifying a Graph answer', () => {
  const kind = (status: number, code?: string) =>
    classifyGraphError(status, code ? { error: { code } } : null).kind;

  it('maps the cases the adapter treats differently', () => {
    expect(kind(401)).toBe('auth');
    expect(kind(404, 'ErrorItemNotFound')).toBe('not_found');
    expect(kind(410)).toBe('gone');
    expect(kind(409)).toBe('conflict');
    expect(kind(403, 'ErrorAccessDenied')).toBe('forbidden');
    expect(kind(500)).toBe('server');
    expect(kind(400, 'ErrorInvalidRequest')).toBe('bad_request');
  });

  it('throttling is a rate limit whatever the status, and an account with no mailbox is forbidden', () => {
    expect(kind(429)).toBe('rate_limit');
    expect(kind(503, 'ErrorServerBusy')).toBe('rate_limit');
    expect(kind(404, 'MailboxNotEnabledForRESTAPI')).toBe('forbidden');
  });

  it('only account-level failures are worth a line on the settings card', () => {
    const code = (k: ConstructorParameters<typeof MicrosoftCalendarError>[0]) =>
      microsoftHealthCode(new MicrosoftCalendarError(k, 0, ''));
    expect(code('rate_limit')).toBe('MICROSOFT_RATE_LIMITED');
    expect(code('forbidden')).toBe('MICROSOFT_ACCESS_DENIED');
    expect(code('timeout')).toBe('MICROSOFT_UNAVAILABLE');
    expect(code('not_found')).toBeUndefined();
    expect(code('bad_request')).toBeUndefined();
  });
});

describe('the transport', () => {
  const answers = (
    ...list: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>
  ) => {
    let calls = 0;
    const fetchImpl = (async () => {
      const a = list[Math.min(calls, list.length - 1)]!;
      calls += 1;
      return new Response(a.body === undefined ? null : JSON.stringify(a.body), {
        status: a.status,
        headers: a.headers,
      });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls: () => calls };
  };
  const base = { classify: classifyGraphError };

  it('returns the parsed body, and {} for an empty one', async () => {
    const ok = answers({ status: 200, body: { a: 1 } });
    expect(await microsoftRequest('http://x', { ...base, fetchImpl: ok.fetchImpl })).toEqual({
      a: 1,
    });
    const empty = answers({ status: 204 });
    expect(await microsoftRequest('http://x', { ...base, fetchImpl: empty.fetchImpl })).toEqual({});
  });

  it('repeats a transient failure, but not a refusal', async () => {
    process.env.MICROSOFT_CALENDAR_RETRY_BASE_MS = '1';
    const flaky = answers({ status: 503 }, { status: 200, body: { ok: true } });
    expect(await microsoftRequest('http://x', { ...base, fetchImpl: flaky.fetchImpl })).toEqual({
      ok: true,
    });
    expect(flaky.calls()).toBe(2);
    const refused = answers({ status: 403, body: { error: { code: 'ErrorAccessDenied' } } });
    await expect(
      microsoftRequest('http://x', { ...base, fetchImpl: refused.fetchImpl }),
    ).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(refused.calls()).toBe(1);
    delete process.env.MICROSOFT_CALENDAR_RETRY_BASE_MS;
  });

  it('does not sleep on a Retry-After longer than the cap: the error carries the hint', async () => {
    const slow = answers({ status: 429, headers: { 'retry-after': '120' } });
    await expect(
      microsoftRequest('http://x', { ...base, fetchImpl: slow.fetchImpl }),
    ).rejects.toMatchObject({
      kind: 'rate_limit',
      retryAfterSeconds: 120,
    });
    expect(slow.calls()).toBe(1);
  });

  it('retries: 0 asks once', async () => {
    const down = answers({ status: 500 });
    await expect(
      microsoftRequest('http://x', { ...base, retries: 0, fetchImpl: down.fetchImpl }),
    ).rejects.toMatchObject({ kind: 'server' });
    expect(down.calls()).toBe(1);
  });

  it('a network failure is a typed error, never a raw one', async () => {
    const fetchImpl = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as unknown as typeof fetch;
    await expect(
      microsoftRequest('http://x', { ...base, retries: 0, fetchImpl }),
    ).rejects.toMatchObject({
      kind: 'network',
      reason: 'ECONNREFUSED',
    });
  });
});
