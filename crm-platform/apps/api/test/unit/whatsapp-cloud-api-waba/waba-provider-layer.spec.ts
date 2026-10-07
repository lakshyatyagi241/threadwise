import { describe, expect, it } from 'vitest';
import { readWabaEnv, type WabaEnv } from '../../../src/config/domains/whatsapp-cloud-api-waba.env';
import { WabaAdminClient } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.client';
import {
  classifySendError,
  describeMetaError,
  translateConnectError,
  translateRegisterError,
  WabaApiError,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { MetaCloudProvider } from '../../../src/infra/providers/whatsapp/meta-cloud.provider';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  json: unknown;
}

/** Answers calls in order from `replies`; each reply is `[status, body]` or a function of the call. */
function fakeFetch(replies: Array<[number, unknown] | ((c: Call) => [number, unknown])>) {
  const calls: Call[] = [];
  const impl: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    const call: Call = {
      url,
      method: String(init?.method),
      headers,
      json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const next = replies[Math.min(calls.length - 1, replies.length - 1)];
    const [status, body] = typeof next === 'function' ? next(call) : next;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { calls, impl };
}

const env = (over: Record<string, unknown> = {}): WabaEnv =>
  readWabaEnv({
    META_APP_ID: 'app1',
    META_APP_SECRET: 'sec1',
    META_EMBEDDED_CONFIG_ID: 'cfg1',
    INTERAKT_PARTNER_AUTH_KEY: 'partner-key',
    INTERAKT_SOLUTION_ID: 'sol1',
    META_SYSTEM_USER_ID: 'sysuser',
    META_SYSTEM_USER_TOKEN: 'sys-token',
    ...over,
  });

const make = (replies: Parameters<typeof fakeFetch>[0], over?: Record<string, unknown>) => {
  const f = fakeFetch(replies);
  const e = env(over);
  const http = new WabaHttp(e);
  http.fetchImpl = f.impl;
  const admin = new WabaAdminClient(e, http);
  admin.sleep = async () => undefined;
  return { ...f, e, http, admin };
};

describe('environment', () => {
  it('defaults to Interakt on v25.0 and rejects a malformed version', () => {
    const e = readWabaEnv({});
    expect(e.WABA_DEFAULT_PROVIDER).toBe('interakt');
    expect(e.INTERAKT_API_VERSION).toBe('v25.0');
    expect(e.INTERAKT_MEDIA_API_VERSION).toBe('v17.0');
    expect(() => readWabaEnv({ META_API_VERSION: '25' })).toThrow(/META_API_VERSION/);
  });

  it('treats an empty string as unset', () => {
    expect(readWabaEnv({ META_APP_ID: '', WABA_DEFAULT_PROVIDER: '' }).META_APP_ID).toBeUndefined();
  });
});

describe('WabaHttp', () => {
  it('routes Interakt calls to amped-express with the partner key and WABA header', async () => {
    const { calls, http } = make([[200, { ok: true }]]);
    await http.call(
      { provider: 'interakt', authKey: 'k', wabaId: 'W1', phoneNumberId: 'P1' },
      { method: 'POST', path: '/P1/messages', json: { a: 1 } },
    );
    expect(calls[0]!.url).toBe('https://amped-express.interakt.ai/api/v25.0/P1/messages');
    expect(calls[0]!.headers).toMatchObject({
      'x-access-token': 'k',
      'x-waba-id': 'W1',
      'x-phone-number-id': 'P1',
    });
    expect(calls[0]!.headers['authorization']).toBeUndefined();
    expect(calls[0]!.json).toEqual({ a: 1 });
  });

  it('routes Meta calls to Graph with a bearer token and keeps the token out of the URL', async () => {
    const { calls, http } = make([[200, {}]]);
    await http.call(
      { provider: 'meta', accessToken: 'tok' },
      { method: 'GET', path: '/123', query: { fields: 'a,b' } },
    );
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v25.0/123?fields=a%2Cb');
    expect(calls[0]!.headers['authorization']).toBe('Bearer tok');
    expect(calls[0]!.url).not.toContain('tok');
  });

  it('lets one call pin an older Interakt version (media_handle)', async () => {
    const { calls, http } = make([[200, {}]]);
    await http.call(
      { provider: 'interakt', authKey: 'k', wabaId: 'W' },
      { method: 'POST', path: '/P/media_handle', apiVersion: 'v17.0' },
    );
    expect(calls[0]!.url).toContain('/api/v17.0/P/media_handle');
  });

  it('turns a Meta error body into a WabaApiError with code, subcode and trace', async () => {
    const { http } = make([
      [
        400,
        {
          error: {
            message: 'bad',
            code: 100,
            error_subcode: 33,
            error_user_msg: 'Fix it',
            fbtrace_id: 'T1',
          },
        },
      ],
    ]);
    const err = await http
      .call({ provider: 'meta', accessToken: 't' }, { method: 'GET', path: '/x' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(WabaApiError);
    expect(err).toMatchObject({ status: 400, code: 100, subcode: 33, fbtraceId: 'T1' });
    expect(err.message).toBe('Fix it (code 100/33, trace T1)');
  });

  it('survives a proxy answering with HTML instead of an error object', async () => {
    const { http } = make([[502, '<html>bad gateway</html>']]);
    const err = (await http
      .call({ provider: 'meta', accessToken: 't' }, { method: 'GET', path: '/x' })
      .catch((e) => e)) as WabaApiError;
    expect(err).toBeInstanceOf(WabaApiError);
    expect(err.status).toBe(502);
    expect(err.retryable).toBe(true);
  });

  it('reports a network failure as retryable status 0', async () => {
    const http = new WabaHttp(env());
    http.fetchImpl = async () => {
      throw new TypeError('fetch failed');
    };
    const err = (await http
      .call({ provider: 'meta', accessToken: 't' }, { method: 'GET', path: '/x' })
      .catch((e) => e)) as WabaApiError;
    expect(err.status).toBe(0);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('Could not reach Meta');
  });
});

describe('error text', () => {
  it('prefers error_user_msg, adds a distinct title, appends code and trace', () => {
    expect(
      describeMetaError({
        message: 'm',
        error_user_msg: 'User words',
        error_user_title: 'Title',
        code: 1,
        fbtrace_id: 'x',
      }),
    ).toBe('Title - User words (code 1, trace x)');
    expect(describeMetaError({ message: 'plain' })).toBe('plain');
  });

  const e = (status: number, error: Record<string, unknown>) =>
    WabaApiError.fromResponse(status, { error });

  it('translates token and permission failures', () => {
    expect(translateConnectError(e(400, { code: 190, error_subcode: 463, message: 'x' }))).toMatch(
      /expired/,
    );
    expect(translateConnectError(e(400, { code: 190, error_subcode: 467, message: 'x' }))).toMatch(
      /session/i,
    );
    expect(
      translateConnectError(e(403, { code: 200, error_subcode: 1349174, message: 'x' })),
    ).toMatch(/whatsapp_business_management/);
    expect(translateConnectError(e(400, { code: 4000, message: 'boom' }))).toBe(
      'Meta error 4000: boom',
    );
  });

  it('hints at the PIN when a number already has two-step verification', () => {
    expect(translateRegisterError(e(400, { code: 133005, message: 'm' }))).toMatch(/exact PIN/);
    expect(translateRegisterError(e(400, { code: 133008, message: 'm' }))).toMatch(
      /wait a few minutes/,
    );
  });

  it('classifies send failures so callers branch on a kind, not on text', () => {
    const k = (code: number) => classifySendError(e(400, { code, message: 'x' }));
    expect(k(131049)).toBe('frequency_capped');
    expect(k(130429)).toBe('rate_limited');
    expect(k(131056)).toBe('rate_limited');
    expect(k(131047)).toBe('window_closed');
    expect(k(131050)).toBe('opted_out');
    expect(k(131026)).toBe('undeliverable');
    expect(k(132001)).toBe('template');
    expect(k(190)).toBe('auth');
    expect(k(133010)).toBe('not_registered');
    expect(k(9999)).toBe('permanent');
    expect(classifySendError(WabaApiError.fromResponse(503, {}))).toBe('transient');
  });
});

describe('WabaAdminClient onboarding calls', () => {
  it('exchanges the Embedded Signup code against Graph without a redirect_uri', async () => {
    const { calls, admin } = make([[200, { access_token: 'BISU', expires_in: 5184000 }]]);
    const r = await admin.exchangeCode('CODE');
    expect(r).toEqual({ accessToken: 'BISU', expiresInSeconds: 5184000 });
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://graph.facebook.com/v25.0/oauth/access_token');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'app1',
      client_secret: 'sec1',
      code: 'CODE',
    });
    expect(u.searchParams.has('redirect_uri')).toBe(false);
  });

  it('refuses to start without a Meta app and says what to set', async () => {
    const { admin } = make([[200, {}]], { META_APP_ID: '', META_APP_SECRET: '' });
    await expect(admin.exchangeCode('c')).rejects.toThrow(/META_APP_ID and META_APP_SECRET/);
  });

  it('reads the WABA ids a token was granted from debug_token granular scopes', async () => {
    const { calls, admin } = make([
      [
        200,
        {
          data: {
            is_valid: true,
            user_id: 'U1',
            scopes: ['whatsapp_business_management'],
            granular_scopes: [
              { scope: 'business_management', target_ids: ['B'] },
              { scope: 'whatsapp_business_management', target_ids: ['W1', 'W2'] },
            ],
          },
        },
      ],
    ]);
    const t = await admin.inspectToken('BISU');
    expect(t.wabaIds).toEqual(['W1', 'W2']);
    expect(t.userId).toBe('U1');
    expect(new URL(calls[0]!.url).searchParams.get('input_token')).toBe('BISU');
    // The inspector is the platform's system user, never the token being inspected.
    expect(calls[0]!.headers['authorization']).toBe('Bearer sys-token');
  });

  it('falls back to the platform business client WABAs when no scope lists one', async () => {
    const { calls, admin } = make(
      [
        [200, { data: { is_valid: true, user_id: 'U', granular_scopes: [] } }],
        [200, { data: [{ id: 'W9' }] }],
      ],
      { META_BUSINESS_ID: 'BIZ' },
    );
    expect(await admin.discoverWabaId('BISU')).toBe('W9');
    expect(calls[1]!.url).toContain('/BIZ/client_whatsapp_business_accounts');
  });

  it('lists phone numbers with the display number stripped of spaces', async () => {
    const { admin } = make([
      [
        200,
        {
          data: [
            {
              id: 'P1',
              verified_name: 'Acme',
              display_phone_number: '+91 91122 90122',
              quality_rating: 'GREEN',
            },
          ],
        },
      ],
    ]);
    const phones = await admin.listPhoneNumbers('tok', 'W1');
    expect(phones[0]).toMatchObject({
      id: 'P1',
      displayPhoneNumber: '+919112290122',
      // kept as Meta wrote it, for the one partner that wants Meta's own formatting
      displayPhoneNumberRaw: '+91 91122 90122',
      verifiedName: 'Acme',
      qualityRating: 'GREEN',
    });
  });

  it('registers the WABA with Interakt using the raw partner key and the tp-signup body', async () => {
    const { calls, admin } = make([[200, {}]]);
    expect(await admin.registerWithInterakt('W1', '+919112290122')).toBe(true);
    expect(calls[0]!.url).toBe('https://api.interakt.ai/v1/organizations/tp-signup/');
    expect(calls[0]!.headers['authorization']).toBe('partner-key');
    expect(calls[0]!.json).toEqual({
      entry: [
        {
          changes: [
            {
              value: {
                event: 'PARTNER_ADDED',
                waba_info: { waba_id: 'W1', solution_id: 'sol1', phone_number: '+919112290122' },
              },
            },
          ],
        },
      ],
      object: 'tech_partner',
    });
  });

  it('does not fail the connect when Interakt registration fails', async () => {
    const { admin } = make([[500, { error: { message: 'down' } }]]);
    expect(await admin.registerWithInterakt('W1', null)).toBe(false);
  });
});

describe('WabaAdminClient.subscribe', () => {
  const cb = { url: 'https://hooks.example.com/v2/public/webhooks/whatsapp', verifyToken: 'vt' };
  const direct = {
    provider: 'meta' as const,
    wabaId: 'W1',
    phoneNumberId: 'P1',
    accessToken: 'tok',
  };

  it('direct: one atomic subscribe+override call when Meta accepts it', async () => {
    const { calls, admin } = make([[200, { success: true }]]);
    const r = await admin.subscribe(direct, cb);
    expect(r).toEqual({ ok: true, overrideApplied: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.json).toEqual({ override_callback_uri: cb.url, verify_token: 'vt' });
  });

  it('direct: falls back to a plain subscribe, then retries the override up to 3 times', async () => {
    const refused: [number, unknown] = [
      400,
      { error: { code: 100, message: '(#100) override not allowed' } },
    ];
    const { calls, admin } = make([refused, [200, { success: true }], refused, refused, refused]);
    const r = await admin.subscribe(direct, cb);
    expect(r).toEqual({ ok: true, overrideApplied: false });
    // atomic, plain, then 3 override retries
    expect(calls).toHaveLength(5);
    expect(calls[1]!.json).toBeUndefined();
  });

  it('direct: succeeds on a later override retry (Meta propagation race)', async () => {
    const refused: [number, unknown] = [400, { error: { code: 100, message: 'x' } }];
    const { admin } = make([refused, [200, {}], refused, [200, {}]]);
    expect(await admin.subscribe(direct, cb)).toEqual({ ok: true, overrideApplied: true });
  });

  it('direct: a token without whatsapp_business_management stops at once with subcode 1349174', async () => {
    const { calls, admin } = make([
      [403, { error: { code: 200, error_subcode: 1349174, message: 'perm' } }],
    ]);
    const r = await admin.subscribe(direct, cb);
    expect(r.ok).toBe(false);
    expect(r.error?.missingBusinessManagement).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('direct: a plain subscribe failure is a hard failure', async () => {
    const { admin } = make([
      [400, { error: { code: 100, message: 'a' } }],
      [400, { error: { code: 190, message: 'b' } }],
    ]);
    const r = await admin.subscribe(direct, cb);
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe(190);
  });

  it('interakt: subscribes on Graph with the business token, then overrides the callback through Interakt', async () => {
    const { calls, admin } = make([
      [200, { success: true }],
      [200, { success: true }],
    ]);
    const r = await admin.subscribe(
      { ...direct, provider: 'interakt', authKey: 'partner-key' },
      cb,
    );
    expect(r).toEqual({ ok: true, overrideApplied: true });
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v25.0/W1/subscribed_apps');
    expect(calls[0]!.headers['authorization']).toBe('Bearer tok');
    expect(calls[1]!.url).toBe('https://amped-express.interakt.ai/api/v25.0/P1');
    expect(calls[1]!.headers).toMatchObject({ 'x-access-token': 'partner-key', 'x-waba-id': 'W1' });
    expect(calls[1]!.json).toEqual({
      webhook_configuration: { override_callback_uri: cb.url, verify_token: 'vt' },
    });
  });

  it('interakt: drops verify_token when Interakt rejects it, and stays ok when no override sticks', async () => {
    const refused: [number, unknown] = [400, { error: { message: 'unknown field' } }];
    const { calls, admin } = make([[200, {}], refused, [200, {}]]);
    const r = await admin.subscribe({ ...direct, provider: 'interakt', authKey: 'k' }, cb);
    expect(r).toEqual({ ok: true, overrideApplied: true });
    expect(calls[2]!.json).toEqual({ webhook_configuration: { override_callback_uri: cb.url } });

    const both = make([[200, {}], refused, refused]);
    expect(
      await both.admin.subscribe({ ...direct, provider: 'interakt', authKey: 'k' }, cb),
    ).toEqual({
      ok: true,
      overrideApplied: false,
    });
  });
});

describe('platform readiness', () => {
  it('lists exactly what is missing for the default route', () => {
    const { admin } = make([[200, {}]], {
      META_EMBEDDED_CONFIG_ID: '',
      INTERAKT_PARTNER_AUTH_KEY: '',
    });
    const r = admin.readiness();
    expect(r.embeddedSignupReady).toBe(false);
    expect(r.missing).toEqual(['META_EMBEDDED_CONFIG_ID', 'INTERAKT_PARTNER_AUTH_KEY']);
    expect(r).not.toHaveProperty('appSecret');
  });

  it('is ready when everything for the route is set; Meta direct does not need Interakt values', () => {
    expect(make([[200, {}]]).admin.readiness().embeddedSignupReady).toBe(true);
    const meta = make([[200, {}]], {
      WABA_DEFAULT_PROVIDER: 'meta',
      INTERAKT_PARTNER_AUTH_KEY: '',
      INTERAKT_SOLUTION_ID: '',
    });
    expect(meta.admin.readiness().embeddedSignupReady).toBe(true);
  });
});

describe('MetaCloudProvider sends', () => {
  const guard = {
    beforeSend: async () => undefined,
    withFooter: async (i: { body: string }) => i.body,
  };
  const provider = (replies: Parameters<typeof fakeFetch>[0]) => {
    const f = make(replies);
    return { ...f, provider: new MetaCloudProvider(f.http, guard) };
  };

  it('sends a text through Interakt with the envelope Geta uses, on the configured version', async () => {
    const { calls, provider: p } = provider([[200, { messages: [{ id: 'wamid.A' }] }]]);
    const r = await p.sendText(
      { senderId: 'P1', accessToken: '', route: 'interakt', authKey: 'k', businessAccountId: 'W1' },
      { to: '+91 99999-99999', body: 'Hello', clientReference: 'c1' },
    );
    expect(r.providerMessageId).toBe('wamid.A');
    expect(calls[0]!.url).toBe('https://amped-express.interakt.ai/api/v25.0/P1/messages');
    expect(calls[0]!.json).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919999999999',
      type: 'text',
      text: { preview_url: false, body: 'Hello' },
    });
  });

  it('sends direct to Meta with a bearer token', async () => {
    const { calls, provider: p } = provider([[200, { messages: [{ id: 'wamid.B' }] }]]);
    await p.sendText(
      { senderId: 'P1', accessToken: 'tok' },
      { to: '919999999999', body: 'Hi', clientReference: 'c' },
    );
    expect(calls[0]!.url).toBe('https://graph.facebook.com/v25.0/P1/messages');
    expect(calls[0]!.headers['authorization']).toBe('Bearer tok');
  });

  it('posts marketing templates to /marketing_messages only on a Marketing-Messages-Lite number', async () => {
    const lite = provider([[200, { messages: [{ id: 'w1' }] }]]);
    await lite.provider.sendTemplate(
      { senderId: 'P', accessToken: 't', marketingLite: true },
      {
        to: '919999999999',
        templateName: 't',
        language: 'en',
        variables: {},
        clientReference: 'c',
        category: 'MARKETING',
      },
    );
    expect(lite.calls[0]!.url).toContain('/P/marketing_messages');

    const plain = provider([[200, { messages: [{ id: 'w2' }] }]]);
    await plain.provider.sendTemplate(
      { senderId: 'P', accessToken: 't' },
      {
        to: '919999999999',
        templateName: 't',
        language: 'en',
        variables: {},
        clientReference: 'c',
        category: 'MARKETING',
      },
    );
    expect(plain.calls[0]!.url).toContain('/P/messages');

    const utility = provider([[200, { messages: [{ id: 'w3' }] }]]);
    await utility.provider.sendTemplate(
      { senderId: 'P', accessToken: 't', marketingLite: true },
      {
        to: '919999999999',
        templateName: 't',
        language: 'en',
        variables: {},
        clientReference: 'c',
        category: 'UTILITY',
      },
    );
    expect(utility.calls[0]!.url).toContain('/P/messages');
  });

  it('wraps media, interactive and reactions under their type key and quotes with context', async () => {
    const { calls, provider: p } = provider([[200, { messages: [{ id: 'w' }] }]]);
    await p.sendMessage(
      { senderId: 'P', accessToken: 't' },
      {
        to: '919999999999',
        type: 'image',
        body: { link: 'https://cdn.example.com/a.jpg', caption: 'cap' },
        clientReference: 'c',
        replyToProviderMessageId: 'wamid.Q',
      },
    );
    expect(calls[0]!.json).toMatchObject({
      type: 'image',
      image: { link: 'https://cdn.example.com/a.jpg', caption: 'cap' },
      context: { message_id: 'wamid.Q' },
    });
  });

  it('keeps Meta codes on a failed send so the caller can classify it', async () => {
    const { provider: p } = provider([
      [400, { error: { code: 131049, message: 'frequency cap' } }],
    ]);
    const err = (await p
      .sendText(
        { senderId: 'P', accessToken: 't' },
        { to: '919999999999', body: 'x', clientReference: 'c' },
      )
      .catch((e) => e)) as WabaApiError;
    expect(classifySendError(err)).toBe('frequency_capped');
  });

  it('fails a 200 that carries no message id, and one flagged failed', async () => {
    const none = provider([[200, {}]]);
    await expect(
      none.provider.sendText(
        { senderId: 'P', accessToken: 't' },
        { to: '9', body: 'x', clientReference: 'c' },
      ),
    ).rejects.toThrow(/no message id/);
    const failed = provider([[200, { messages: [{ id: 'w', message_status: 'failed' }] }]]);
    await expect(
      failed.provider.sendText(
        { senderId: 'P', accessToken: 't' },
        { to: '9', body: 'x', clientReference: 'c' },
      ),
    ).rejects.toThrow(/rejected/);
  });

  it('refuses an Interakt number that lost its auth key instead of sending unauthenticated', async () => {
    const { provider: p } = provider([[200, {}]]);
    await expect(
      p.sendText(
        { senderId: 'P', accessToken: '', route: 'interakt' },
        { to: '9', body: 'x', clientReference: 'c' },
      ),
    ).rejects.toThrow(/auth key and WABA id/);
  });

  it('never throws from a failed mark-read', async () => {
    const { provider: p } = provider([[500, {}]]);
    await expect(
      p.markRead({ senderId: 'P', accessToken: 't' }, 'wamid.X', true),
    ).resolves.toBeUndefined();
  });
});
