import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { inboundUrlKey } from '../../../src/modules/whatsapp-cloud-api-waba/waba-rules';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Connecting WhatsApp numbers end to end (WD-WABA-004..020): the real API, a real Postgres with row-level security, a real
 * Redis. Only Meta Graph and Interakt are faked, at the HTTP edge, so every URL, header and body the platform sends is asserted.
 */
Object.assign(process.env, {
  META_APP_ID: 'app-1',
  META_APP_SECRET: 'app-secret-1',
  META_EMBEDDED_CONFIG_ID: 'cfg-1',
  INTERAKT_PARTNER_AUTH_KEY: 'partner-key-1',
  INTERAKT_SOLUTION_ID: 'solution-1',
  META_SYSTEM_USER_ID: 'sys-user-1',
  META_SYSTEM_USER_TOKEN: 'sys-token-1',
  WABA_WEBHOOK_PUBLIC_URL: 'https://hooks.test',
});

let h: Harness;
let api: Api;
let http: WabaHttp;

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  json: unknown;
}
let calls: Call[] = [];
/** Replace a route's answer for one test; first matching rule wins. */
let rules: Array<{ match: RegExp; status: number; body: unknown | ((c: Call) => unknown) }> = [];

const G = 'https://graph.facebook.com/v25.0';
const CALLBACK = `https://hooks.test/v2/public/webhooks/whatsapp?k=${inboundUrlKey(Buffer.alloc(32, 7).toString('base64'))}`;

const defaults = () => [
  {
    match: /POST .*\/oauth\/access_token|GET .*\/oauth\/access_token/,
    status: 200,
    body: { access_token: 'BISU-TOKEN-1', expires_in: 5184000 },
  },
  {
    match: /GET .*\/debug_token/,
    status: 200,
    body: {
      data: {
        is_valid: true,
        user_id: 'U1',
        scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
        granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['W1'] }],
      },
    },
  },
  {
    match: /GET .*\/W1\/phone_numbers/,
    status: 200,
    body: {
      data: [
        {
          id: 'P1',
          verified_name: 'Acme Store',
          display_phone_number: '+91 91122 90122',
          quality_rating: 'GREEN',
          messaging_limit_tier: 'TIER_250',
          platform_type: 'CLOUD_API',
          name_status: 'APPROVED',
          code_verification_status: 'VERIFIED',
        },
      ],
    },
  },
  {
    match: /GET .*\/W1\?fields=owner_business_info/,
    status: 200,
    body: { owner_business_info: { id: 'B1', name: 'Acme Pvt Ltd' } },
  },
  {
    match: /GET .*\/B1\?fields=verification_status/,
    status: 200,
    body: { verification_status: 'verified' },
  },
  {
    match: /POST https:\/\/api\.interakt\.ai\/v1\/organizations\/tp-signup\//,
    status: 200,
    body: {},
  },
  { match: /POST .*\/W1\/assigned_users/, status: 200, body: { success: true } },
  {
    match: /POST .*graph\.facebook\.com.*\/W1\/subscribed_apps/,
    status: 200,
    body: { success: true },
  },
  {
    match: /POST https:\/\/amped-express\.interakt\.ai\/api\/v25\.0\/P1$/,
    status: 200,
    body: { success: true },
  },
  {
    match: /GET .*\/W1\/subscribed_apps/,
    status: 200,
    body: {
      data: [{ whatsapp_business_api_data: { id: 'app-1', override_callback_uri: CALLBACK } }],
    },
  },
];

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  http = h.app.get(WabaHttp);
  const fake: FetchLike = async (url, init) => {
    const call: Call = {
      method: String(init?.method),
      url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const rule = rules.find((r) => r.match.test(`${call.method} ${call.url}`));
    if (!rule)
      return new Response(
        JSON.stringify({ error: { message: `unstubbed ${call.method} ${call.url}`, code: 1 } }),
        { status: 404 },
      );
    const body = typeof rule.body === 'function' ? rule.body(call) : rule.body;
    return new Response(JSON.stringify(body), { status: rule.status });
  };
  http.fetchImpl = fake;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

/**
 * One Meta number lives in one workspace (migration unique index), and these tests reuse the same stub ids in fresh tenants,
 * so each test releases what it connected. The container database is the test's own.
 */
afterEach(async () => {
  await h.owner.query(`DELETE FROM wa_provider_configs WHERE provider = 'waba'`);
});

beforeEach(() => {
  calls = [];
  rules = defaults();
});

const post = (t: Tenant, path: string, body?: unknown, key = `k${Math.random()}`) =>
  api
    .as(t.admin)
    .post(path)
    .set('idempotency-key', key)
    .send((body ?? {}) as object);

/** A tenant with the numeric ids Meta uses; `W1`/`P1` in the stubs are the display names. */
const ids = { waba: 'W1', phone: 'P1' };
// The contract only accepts the numeric ids Meta shows, so the stubs answer for numeric ones.
const numeric = { waba: '100200300', phone: '555000111' };
function useNumericIds() {
  rules = defaults().map((r) => ({
    ...r,
    match: new RegExp(
      r.match.source.replace(/W1/g, numeric.waba).replace(/P1/g, numeric.phone),
      r.match.flags,
    ),
  }));
  rules.forEach((r) => {
    if (typeof r.body === 'object' && r.body !== null) {
      r.body = JSON.parse(
        JSON.stringify(r.body)
          .replace(/"W1"/g, `"${numeric.waba}"`)
          .replace(/"P1"/g, `"${numeric.phone}"`),
      );
    }
  });
  ids.waba = numeric.waba;
  ids.phone = numeric.phone;
}

describe('readiness', () => {
  it('tells the browser what it needs and never the app secret', async () => {
    const t = await api.signup('wr');
    const res = await api.as(t.admin).get('/v2/waba/readiness');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      embeddedSignupReady: true,
      appId: 'app-1',
      configId: 'cfg-1',
      solutionId: 'solution-1',
      graphVersion: 'v25.0',
      defaultProvider: 'interakt',
      missing: [],
      webhookUrl: CALLBACK,
    });
    expect(JSON.stringify(res.body)).not.toContain('app-secret-1');
    expect(JSON.stringify(res.body)).not.toContain('partner-key-1');
  });
});

describe('Embedded Signup through Interakt (WD-WABA-009)', () => {
  it('exchanges the code, registers the WABA with Interakt, points the callback here, and saves the number', async () => {
    useNumericIds();
    const t = await api.signup('we');
    const res = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'CODE-1',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = res.body.connection;
    expect(c).toMatchObject({
      provider: 'interakt',
      status: 'connected',
      isPrimary: true,
      phoneNumber: '+919112290122',
      verifiedName: 'Acme Store',
      displayLabel: 'Acme Store',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
      businessId: 'B1',
      qualityRating: 'GREEN',
      messagingLimitTier: 'TIER_250',
      connectedVia: 'embedded',
      hasToken: true,
      inboundWired: true,
    });
    expect(res.body.warnings).toEqual([]);
    // Nothing secret comes back.
    expect(JSON.stringify(res.body)).not.toMatch(/BISU-TOKEN-1|partner-key-1/);

    // The exact conversation with Meta and Interakt.
    const byUrl = (re: RegExp) => calls.find((x) => re.test(`${x.method} ${x.url}`))!;
    const exchange = new URL(byUrl(/GET .*oauth\/access_token/).url);
    expect(Object.fromEntries(exchange.searchParams)).toEqual({
      client_id: 'app-1',
      client_secret: 'app-secret-1',
      code: 'CODE-1',
    });
    const tp = byUrl(/tp-signup/);
    expect(tp.headers.authorization).toBe('partner-key-1');
    expect(JSON.stringify(tp.json)).toContain(`"waba_id":"${ids.waba}"`);
    expect(JSON.stringify(tp.json)).toContain('"solution_id":"solution-1"');
    const sub = byUrl(new RegExp(`POST ${G.replace(/\./g, '\\.')}/${ids.waba}/subscribed_apps`));
    expect(sub.headers.authorization).toBe('Bearer BISU-TOKEN-1');
    const override = byUrl(
      new RegExp(`POST https://amped-express\\.interakt\\.ai/api/v25\\.0/${ids.phone}$`),
    );
    expect(override.headers).toMatchObject({
      'x-access-token': 'partner-key-1',
      'x-waba-id': ids.waba,
    });
    expect(override.json).toMatchObject({
      webhook_configuration: { override_callback_uri: CALLBACK },
    });
    // Embedded Signup registers the number itself: no register call on the Interakt route.
    expect(calls.some((x) => /\/register$/.test(x.url))).toBe(false);

    // The credentials are encrypted at rest and carry both keys.
    const row = (
      await h.owner.query(
        `SELECT credentials_json, meta_json, is_primary FROM wa_provider_configs WHERE uuid = $1`,
        [c.id],
      )
    ).rows[0];
    expect(row.credentials_json).toMatch(/^v1:/);
    expect(row.credentials_json).not.toContain('BISU-TOKEN-1');
    expect(row.meta_json).toMatchObject({
      provider: 'interakt',
      waba_id: ids.waba,
      phone_number_id: ids.phone,
      business_verified: true,
    });

    expect(await api.auditCount(t.orgId, 'wa_provider_configs', 'insert')).toBe(1);
    expect(await api.events(t.orgId, 'whatsapp.connection.connected')).toHaveLength(1);
  });

  it('reconnecting the same number reuses its card and keeps it primary', async () => {
    useNumericIds();
    const t = await api.signup('wre');
    const first = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'C1',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    const second = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'C2',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    expect(second.status).toBe(201);
    expect(second.body.connection.id).toBe(first.body.connection.id);
    const list = await api.as(t.admin).get('/v2/waba/numbers');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].isPrimary).toBe(true);
  });

  it('refuses a WABA the token was not granted, however the browser says it is', async () => {
    useNumericIds();
    const t = await api.signup('wf');
    const res = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'C',
      wabaId: '999999999',
      phoneNumberId: ids.phone,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WABA_ID_MISMATCH');
    expect((await api.as(t.admin).get('/v2/waba/numbers')).body.items).toHaveLength(0);
  });

  it('refuses a phone number that is not on the WABA', async () => {
    useNumericIds();
    const t = await api.signup('wp');
    const res = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'C',
      wabaId: ids.waba,
      phoneNumberId: '777000888',
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('WABA_ID_MISMATCH');
  });

  it("says so when Meta rejects the code, in Meta's words, and saves nothing", async () => {
    useNumericIds();
    rules.unshift({
      match: /oauth\/access_token/,
      status: 400,
      body: {
        error: { message: 'Invalid verification code format.', code: 100, fbtrace_id: 'TR1' },
      },
    });
    const t = await api.signup('wx');
    const res = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'BAD',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WABA_PROVIDER_REJECTED');
    expect(res.body.detail).toContain('Meta token exchange failed');
    expect(res.body.detail).toContain('Invalid verification code format');
    expect((await api.as(t.admin).get('/v2/waba/numbers')).body.items).toHaveLength(0);
  });

  it("reports a Meta outage as retryable, not as the user's mistake", async () => {
    useNumericIds();
    rules.unshift({ match: /oauth\/access_token/, status: 503, body: '<html>bad gateway</html>' });
    const t = await api.signup('wo');
    const res = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'C',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('WABA_PROVIDER_UNAVAILABLE');
  });

  it('stops when the token lacks whatsapp_business_management, with the fix in the message', async () => {
    useNumericIds();
    rules.unshift({
      match: /POST .*subscribed_apps/,
      status: 403,
      body: { error: { message: 'perm', code: 200, error_subcode: 1349174 } },
    });
    const t = await api.signup('wm');
    const res = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'C',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WABA_MISSING_PERMISSION');
    expect(res.body.detail).toMatch(/whatsapp_business_management/);
    expect((await api.as(t.admin).get('/v2/waba/numbers')).body.items).toHaveLength(0);
  });

  it('still saves the number when Interakt will not take the callback override, and warns', async () => {
    useNumericIds();
    rules.unshift({
      match: /POST https:\/\/amped-express\.interakt\.ai/,
      status: 400,
      body: { error: { message: 'nope' } },
    });
    rules.unshift({ match: /GET .*\/subscribed_apps/, status: 200, body: { data: [] } });
    const t = await api.signup('ww');
    const res = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'C',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    expect(res.status).toBe(201);
    expect(res.body.connection.inboundWired).toBeNull();
    expect(res.body.warnings.join(' ')).toContain(CALLBACK);
  });

  it('one number lives in one workspace', async () => {
    useNumericIds();
    const a = await api.signup('wa1');
    const b = await api.signup('wa2');
    expect(
      (
        await post(a, '/v2/waba/numbers/connect/embedded', {
          code: 'C',
          wabaId: ids.waba,
          phoneNumberId: ids.phone,
        })
      ).status,
    ).toBe(201);
    const res = await post(b, '/v2/waba/numbers/connect/embedded', {
      code: 'C',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WABA_NUMBER_IN_USE');
    // Disconnecting releases the claim.
    const first = (await api.as(a.admin).get('/v2/waba/numbers')).body.items[0];
    expect((await post(a, `/v2/waba/numbers/${first.id}/disconnect`)).status).toBe(200);
    expect(
      (
        await post(b, '/v2/waba/numbers/connect/embedded', {
          code: 'C',
          wabaId: ids.waba,
          phoneNumberId: ids.phone,
        })
      ).status,
    ).toBe(201);
  });
});

describe('manual connect (WD-WABA-006)', () => {
  const manual = (over: Record<string, unknown> = {}) => ({
    phoneNumberId: numeric.phone,
    wabaId: numeric.waba,
    accessToken: 'EAAG-pasted-system-user-token-0001',
    displayLabel: 'Support line',
    ...over,
  });
  const phoneProbe = (over: Record<string, unknown> = {}) => ({
    match: new RegExp(`GET .*/${numeric.phone}\\?fields=`),
    status: 200,
    body: {
      id: numeric.phone,
      verified_name: 'Acme Store',
      display_phone_number: '+91 91122 90122',
      platform_type: 'CLOUD_API',
      quality_rating: 'GREEN',
      ...over,
    },
  });

  it('probes the number, subscribes with an override, saves, and registers it with a PIN it keeps to itself', async () => {
    useNumericIds();
    rules.unshift(phoneProbe(), {
      match: /POST .*\/register$/,
      status: 200,
      body: { success: true },
    });
    const t = await api.signup('mc');
    const res = await post(t, '/v2/waba/numbers/connect/manual', manual());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.connection).toMatchObject({
      provider: 'meta',
      connectedVia: 'manual',
      displayLabel: 'Support line',
      isPrimary: true,
      hasToken: true,
    });
    const sub = calls.find(
      (c) => c.method === 'POST' && c.url.endsWith(`/${numeric.waba}/subscribed_apps`),
    )!;
    // The platform app extends the pasted token to a long-lived one (fb_exchange_token) and the extended token is used from then on.
    const extend = calls.find((c) => /fb_exchange_token/.test(c.url))!;
    expect(new URL(extend.url).searchParams.get('fb_exchange_token')).toBe(
      'EAAG-pasted-system-user-token-0001',
    );
    expect(sub.headers.authorization).toBe('Bearer BISU-TOKEN-1');
    expect(sub.json).toMatchObject({ override_callback_uri: CALLBACK });
    const reg = calls.find((c) => /\/register$/.test(c.url))!;
    expect(reg.json).toMatchObject({
      messaging_product: 'whatsapp',
      pin: expect.stringMatching(/^\d{6}$/),
    });
    expect(JSON.stringify(res.body)).not.toContain(String((reg.json as { pin: string }).pin) + '"');
    expect(JSON.stringify(res.body)).not.toContain('EAAG-pasted');
  });

  it('refuses a number still on the On-Premises API and says what to do', async () => {
    useNumericIds();
    rules.unshift(
      phoneProbe({ platform_type: 'ON_PREMISE', code_verification_status: 'NOT_VERIFIED' }),
    );
    const t = await api.signup('mo');
    const res = await post(t, '/v2/waba/numbers/connect/manual', manual());
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('WABA_ON_PREMISE');
    expect(res.body.detail).toMatch(/Cloud API/);
    expect(res.body.detail).toMatch(/not verified/);
    expect((await api.as(t.admin).get('/v2/waba/numbers')).body.items).toHaveLength(0);
  });

  it('translates an expired token (190/463) into advice', async () => {
    useNumericIds();
    rules.unshift({
      match: new RegExp(`GET .*/${numeric.phone}\\?fields=`),
      status: 401,
      body: { error: { message: 'Error validating access token', code: 190, error_subcode: 463 } },
    });
    const t = await api.signup('me');
    const res = await post(t, '/v2/waba/numbers/connect/manual', manual());
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/expired/);
    expect(res.body.errors?.[0]?.path).toBe('accessToken');
  });

  it('rejects ids that are not numeric before calling Meta', async () => {
    const t = await api.signup('mv');
    const res = await post(t, '/v2/waba/numbers/connect/manual', manual({ phoneNumberId: 'abc' }));
    expect(res.status).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it('the pre-save check reports each thing the token can and cannot do', async () => {
    useNumericIds();
    rules.unshift(phoneProbe(), {
      match: /GET .*\/debug_token/,
      status: 200,
      body: {
        data: { is_valid: true, scopes: ['whatsapp_business_messaging'], granular_scopes: [] },
      },
    });
    const t = await api.signup('mx');
    const res = await post(t, '/v2/waba/numbers/verify-token', {
      accessToken: 'EAAG-token-to-check-000001',
      phoneNumberId: numeric.phone,
      wabaId: numeric.waba,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    const byKey = Object.fromEntries(
      (res.body.checks as Array<{ key: string; ok: boolean; detail: string }>).map((c) => [
        c.key,
        c,
      ]),
    );
    expect(byKey.token!.ok).toBe(true);
    expect(byKey.management_scope!.ok).toBe(false);
    expect(byKey.management_scope!.detail).toContain('whatsapp_business_management');
    expect(byKey.phone!.ok).toBe(true);
    expect(byKey.cloud_api!.ok).toBe(true);
  });
});

describe('who may do what', () => {
  it('reading, connecting and managing are separate keys', async () => {
    useNumericIds();
    const t = await api.signup('wk');
    const reader = await api.member(t, 'reader', [['waba.numbers.read']]);
    const none = await api.member(t, 'none', []);
    expect((await api.as(reader.token).get('/v2/waba/numbers')).status).toBe(200);
    expect((await api.as(none.token).get('/v2/waba/numbers')).status).toBe(403);
    const connect = await api
      .as(reader.token)
      .post('/v2/waba/numbers/connect/embedded')
      .set('idempotency-key', 'k1')
      .send({ code: 'C' });
    expect(connect.status).toBe(403);

    const made = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'C',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    const id = made.body.connection.id;
    expect((await api.as(reader.token).post(`/v2/waba/numbers/${id}/disconnect`)).status).toBe(403);
    expect((await api.as(reader.token).delete(`/v2/waba/numbers/${id}`)).status).toBe(403);
  });

  it("another workspace's number is a 404, never a 403", async () => {
    useNumericIds();
    const a = await api.signup('wt1');
    const b = await api.signup('wt2');
    const made = await post(a, '/v2/waba/numbers/connect/embedded', {
      code: 'C',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    const id = made.body.connection.id;
    for (const [m, p] of [
      ['get', `/v2/waba/numbers/${id}`],
      ['get', `/v2/waba/numbers/${id}/health`],
      ['post', `/v2/waba/numbers/${id}/primary`],
      ['post', `/v2/waba/numbers/${id}/resubscribe`],
      ['post', `/v2/waba/numbers/${id}/disconnect`],
    ] as const) {
      const res = await api.as(b.admin)[m](p);
      expect(res.status, `${m} ${p}`).toBe(404);
    }
    expect((await api.as(b.admin).delete(`/v2/waba/numbers/${id}`)).status).toBe(404);
    expect((await api.as(a.admin).get(`/v2/waba/numbers/${id}`)).status).toBe(200);
  });
});

describe('keeping a number healthy', () => {
  async function connected(label: string) {
    useNumericIds();
    const t = await api.signup(label);
    const made = await post(t, '/v2/waba/numbers/connect/embedded', {
      code: 'C',
      wabaId: ids.waba,
      phoneNumberId: ids.phone,
    });
    return { t, id: made.body.connection.id as string };
  }

  it('Fix inbound re-subscribes and verifies (WD-WABA-014)', async () => {
    const { t, id } = await connected('hf');
    calls = [];
    const res = await post(t, `/v2/waba/numbers/${id}/resubscribe`);
    expect(res.status).toBe(200);
    expect(res.body.connection.inboundWired).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/subscribed_apps'))).toBe(true);
  });

  it('the health page reads Meta live and lists what is wrong, worst first (WD-WABA-021, 022)', async () => {
    const { t, id } = await connected('hh');
    rules.unshift({
      match: new RegExp(
        `GET https://amped-express\\.interakt\\.ai/api/v25\\.0/${ids.phone}\\?fields=`,
      ),
      status: 200,
      body: {
        id: ids.phone,
        verified_name: 'Acme Store',
        display_phone_number: '+91 91122 90122',
        quality_rating: 'RED',
        platform_type: 'CLOUD_API',
        messaging_limit_tier: 'TIER_1K',
      },
    });
    const res = await api.as(t.admin).get(`/v2/waba/numbers/${id}/health`);
    expect(res.status).toBe(200);
    expect(res.body.overall).toBe('error');
    expect(res.body.issues.map((i: { key: string }) => i.key)).toContain('quality_red');
    expect(res.body.connection.messagingLimitTier).toBe('TIER_1K');
    expect(res.body.connection.qualityRating).toBe('RED');
    expect(res.body.tokenHint).toMatch(/^••••/);
    expect(JSON.stringify(res.body)).not.toContain('BISU-TOKEN-1');
  });

  it('a rejected live read is reported, not thrown', async () => {
    const { t, id } = await connected('hx');
    rules.unshift({
      match: /GET https:\/\/amped-express/,
      status: 401,
      body: { error: { message: 'Error validating access token', code: 190, error_subcode: 463 } },
    });
    const res = await api.as(t.admin).get(`/v2/waba/numbers/${id}/health`);
    expect(res.status).toBe(200);
    expect(res.body.issues[0].key).toBe('meta_unreachable');
    expect(res.body.issues[0].title).toMatch(/expired/);
  });

  it('registers on the Cloud API with a typed PIN and remembers it; Meta\'s "already" is success (WD-WABA-012)', async () => {
    const { t, id } = await connected('hr');
    rules.unshift({ match: /POST .*\/register$/, status: 200, body: { success: true } });
    const ok = await post(t, `/v2/waba/numbers/${id}/register`, { pin: '123456' });
    expect(ok.status).toBe(200);
    expect(calls.find((c) => /\/register$/.test(c.url))!.json).toEqual({
      messaging_product: 'whatsapp',
      pin: '123456',
    });

    calls = [];
    rules.unshift({
      match: /POST .*\/register$/,
      status: 400,
      body: { error: { message: 'Phone number is already registered', code: 133016 } },
    });
    expect((await post(t, `/v2/waba/numbers/${id}/register`, {})).status).toBe(200);
    // No PIN typed: the stored one is reused rather than a new random one that would lock the number.
    expect(calls.find((c) => /\/register$/.test(c.url))!.json).toMatchObject({ pin: '123456' });
  });

  it('hints at the PIN when two-step verification is already on', async () => {
    const { t, id } = await connected('hp');
    rules.unshift({
      match: /POST .*\/register$/,
      status: 400,
      body: { error: { message: 'Incorrect PIN', code: 133005 } },
    });
    const res = await post(t, `/v2/waba/numbers/${id}/register`, { pin: '654321' });
    expect(res.status).toBe(422);
    expect(res.body.detail).toMatch(/exact PIN/);
    expect((await post(t, `/v2/waba/numbers/${id}/register`, { pin: '12' })).status).toBe(422);
  });

  it('replaces the token only when Meta accepts it (WD-WABA-019)', async () => {
    const { t, id } = await connected('ht');
    rules.unshift({
      match: new RegExp(`GET .*/${ids.phone}\\?fields=`),
      status: 401,
      body: { error: { message: 'bad', code: 190 } },
    });
    const bad = await api
      .as(t.admin)
      .put(`/v2/waba/numbers/${id}/token`)
      .send({ accessToken: 'EAAG-a-bad-replacement-token' });
    expect(bad.status).toBe(422);

    rules.unshift({
      match: new RegExp(`GET https://graph\\.facebook\\.com/.*/${ids.phone}\\?fields=`),
      status: 200,
      body: { id: ids.phone, display_phone_number: '+91 91122 90122' },
    });
    rules.splice(1, 1);
    const good = await api
      .as(t.admin)
      .put(`/v2/waba/numbers/${id}/token`)
      .send({ accessToken: 'EAAG-a-good-replacement-token' });
    expect(good.status).toBe(200);
    expect(good.body.hasToken).toBe(true);
    expect(JSON.stringify(good.body)).not.toContain('EAAG-a-good');
  });

  it('renewing swaps the token in place, and says so when Meta cannot renew it (WD-WABA-020)', async () => {
    const { t, id } = await connected('hn');
    rules.unshift({
      match: /GET .*oauth\/access_token/,
      status: 200,
      body: { access_token: 'BISU-TOKEN-2', expires_in: 5184000 },
    });
    const ok = await post(t, `/v2/waba/numbers/${id}/token/renew`);
    expect(ok.status).toBe(200);
    const row = (
      await h.owner.query(`SELECT meta_json FROM wa_provider_configs WHERE uuid = $1`, [id])
    ).rows[0];
    expect(typeof row.meta_json.token_expires_at).toBe('string');
    expect(calls.find((c) => /fb_exchange_token/.test(c.url))).toBeTruthy();

    rules.unshift({
      match: /GET .*oauth\/access_token/,
      status: 400,
      body: { error: { message: 'revoked', code: 190 } },
    });
    const bad = await post(t, `/v2/waba/numbers/${id}/token/renew`);
    expect(bad.status).toBe(422);
    expect(bad.body.detail).toMatch(/reconnect/);
  });

  it('keeps one primary: promote, disconnect hands it on, remove hands it on (WD-WABA-016..018)', async () => {
    useNumericIds();
    const t = await api.signup('hpr');
    const a = (
      await post(t, '/v2/waba/numbers/connect/embedded', {
        code: 'C',
        wabaId: ids.waba,
        phoneNumberId: ids.phone,
      })
    ).body.connection;
    // A second number on the same WABA: another phone id in the list.
    rules.unshift({
      match: new RegExp(`GET .*/${ids.waba}/phone_numbers`),
      status: 200,
      body: {
        data: [
          {
            id: '555000222',
            verified_name: 'Second line',
            display_phone_number: '+91 90000 00002',
            platform_type: 'CLOUD_API',
          },
        ],
      },
    });
    rules.unshift({
      match: /POST https:\/\/amped-express\.interakt\.ai\/api\/v25\.0\/555000222$/,
      status: 200,
      body: { success: true },
    });
    const b = (
      await post(t, '/v2/waba/numbers/connect/embedded', {
        code: 'C',
        wabaId: ids.waba,
        phoneNumberId: '555000222',
      })
    ).body.connection;
    expect(b.isPrimary).toBe(false);

    const promoted = await post(t, `/v2/waba/numbers/${b.id}/primary`);
    expect(promoted.body.isPrimary).toBe(true);
    const list1 = (await api.as(t.admin).get('/v2/waba/numbers')).body.items;
    expect(list1.filter((x: { isPrimary: boolean }) => x.isPrimary)).toHaveLength(1);
    expect(list1[0].id).toBe(b.id);

    const disc = await post(t, `/v2/waba/numbers/${b.id}/disconnect`);
    expect(disc.body).toMatchObject({ status: 'disconnected', isPrimary: false, hasToken: false });
    const list2 = (await api.as(t.admin).get('/v2/waba/numbers')).body.items;
    expect(list2.find((x: { id: string }) => x.id === a.id).isPrimary).toBe(true);

    expect((await api.as(t.admin).delete(`/v2/waba/numbers/${a.id}`)).status).toBe(204);
    expect((await api.as(t.admin).get(`/v2/waba/numbers/${a.id}`)).status).toBe(404);
    expect(await api.events(t.orgId, 'whatsapp.connection.disconnected')).toHaveLength(1);
    expect(await api.events(t.orgId, 'whatsapp.connection.removed')).toHaveLength(1);
  });

  it('rename honours the row version', async () => {
    const { t, id } = await connected('hv');
    const cur = (await api.as(t.admin).get(`/v2/waba/numbers/${id}`)).body;
    const ok = await api
      .as(t.admin)
      .patch(`/v2/waba/numbers/${id}`)
      .send({ displayLabel: 'Sales', rowVersion: cur.rowVersion });
    expect(ok.status).toBe(200);
    expect(ok.body.displayLabel).toBe('Sales');
    const stale = await api
      .as(t.admin)
      .patch(`/v2/waba/numbers/${id}`)
      .send({ displayLabel: 'Late', rowVersion: cur.rowVersion });
    expect(stale.status).toBe(409);
  });

  it("reads and updates the business profile with Meta's limits (WD-WABA profile)", async () => {
    const { t, id } = await connected('hbp');
    rules.unshift({
      match: /GET .*whatsapp_business_profile/,
      status: 200,
      body: {
        data: [
          {
            about: 'Hello',
            websites: ['https://acme.test'],
            vertical: 'RETAIL',
            profile_picture_url: 'https://cdn.test/p.jpg',
          },
        ],
      },
    });
    const got = await api.as(t.admin).get(`/v2/waba/numbers/${id}/profile`);
    expect(got.body).toMatchObject({
      about: 'Hello',
      vertical: 'RETAIL',
      websites: ['https://acme.test'],
    });

    expect(
      (
        await api
          .as(t.admin)
          .put(`/v2/waba/numbers/${id}/profile`)
          .send({ about: 'x'.repeat(140) })
      ).status,
    ).toBe(422);
    expect(
      (
        await api
          .as(t.admin)
          .put(`/v2/waba/numbers/${id}/profile`)
          .send({ websites: ['ftp://x'] })
      ).status,
    ).toBe(422);
    expect((await api.as(t.admin).put(`/v2/waba/numbers/${id}/profile`).send({})).status).toBe(422);

    rules.unshift({
      match: /POST .*whatsapp_business_profile/,
      status: 200,
      body: { success: true },
    });
    const put = await api
      .as(t.admin)
      .put(`/v2/waba/numbers/${id}/profile`)
      .send({ about: 'Open daily', vertical: 'RETAIL' });
    expect(put.status).toBe(200);
    expect(
      calls.find((c) => c.method === 'POST' && /whatsapp_business_profile/.test(c.url))!.json,
    ).toEqual({
      messaging_product: 'whatsapp',
      about: 'Open daily',
      vertical: 'RETAIL',
    });
  });
});
