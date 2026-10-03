import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  channelProviderInfoSchema,
  listAssignmentsResponseSchema,
  switchWorkspaceProviderResponseSchema,
  testWhatsappProviderResponseSchema,
  whatsappProviderListSchema,
  whatsappProviderSchema,
} from '@crm/contracts';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { authOf } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { WabaConnectService } from '../../../src/modules/whatsapp-cloud-api-waba';
import { inboundUrlKey } from '../../../src/modules/whatsapp-cloud-api-waba/waba-rules';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { Api, bearer, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The WhatsApp provider registry end to end through HTTP: the operator API (permissions, validation, secrets that never come back,
 * default uniqueness, assignments, the live test, the number switch with its dry run and rollback), the resolver's precedence when a
 * number is connected, the tenant-safe provider info, and the webhook's per-provider signature scheme. The real API, a real Postgres with
 * row-level security, a real Redis; only the providers (Meta Graph, Interakt, the BSP under test) are faked, at the HTTP edge, so every
 * address, header and body the platform sends is asserted. Nothing here ran against a live BSP account.
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
  // The platform setting the registry falls back to; the registry is empty of defaults and overrides at the start.
  WABA_DEFAULT_PROVIDER: 'meta',
  // The stand-in providers below live at made-up public names: skip the DNS check (development only, never in production).
  WABA_PROVIDER_ALLOW_PRIVATE_HOSTS: 'true',
});

let h: Harness;
let api: Api;
let http: WabaHttp;
let superToken = '';
let supportToken = '';
let viewerToken = '';

const PIN = 'https://api.bspone.io/wa/v24.0';
const G = 'https://graph.facebook.com/v25.0';
const CALLBACK = `https://hooks.test/v2/public/webhooks/whatsapp?k=${inboundUrlKey(Buffer.alloc(32, 7).toString('base64'))}`;
const PIN_TOKEN = 'pinnacle-partner-token-7788';
const PIN_WEBHOOK_SECRET = 'whsec-pinnacle-9911';
const PIN_VERIFY = 'verify-pinnacle-5544';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  json: unknown;
}
let calls: Call[] = [];
type Rule = { match: RegExp; status: number; body: unknown };
let rules: Rule[] = [];

let counter = 0;
const uniq = (p: string) => `${p}${Date.now()}${counter++}`;
const nextIds = () => {
  counter += 1;
  return {
    waba: `1002${String(Date.now()).slice(-6)}${counter}`,
    phone: `5550${String(Date.now()).slice(-6)}${counter}`,
  };
};

const op = (token: string, method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
  request(h.app.getHttpServer())
    [method](`/v2/platform/whatsapp-providers${path}`)
    .set(bearer(token));
const sup = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
  op(superToken, method, path);

const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
async function login(email: string): Promise<string> {
  const res = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/login')
    .send({ email, password: OPERATOR_PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.tokens.accessToken as string;
}

/** What the stand-in providers answer. Replaced per test; the first matching rule wins. */
const defaults = (waba: string, phone: string): Rule[] => [
  {
    match: /oauth\/access_token/,
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
        granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: [waba] }],
      },
    },
  },
  {
    match: new RegExp(`GET .*/${waba}/phone_numbers`),
    status: 200,
    body: {
      data: [
        {
          id: phone,
          verified_name: 'Acme Store',
          display_phone_number: '+91 91122 90122',
          quality_rating: 'GREEN',
          platform_type: 'CLOUD_API',
          code_verification_status: 'VERIFIED',
        },
      ],
    },
  },
  {
    match: new RegExp(`GET .*/${waba}\\?fields=owner_business_info`),
    status: 200,
    body: { owner_business_info: { id: 'B1', name: 'Acme' } },
  },
  {
    match: /GET .*\/B1\?fields=verification_status/,
    status: 200,
    body: { verification_status: 'verified' },
  },
  { match: /POST .*\/assigned_users/, status: 200, body: { success: true } },
  { match: new RegExp(`POST ${G}/${phone}/register`), status: 200, body: { success: true } },
  { match: new RegExp(`POST ${G}/${waba}/subscribed_apps`), status: 200, body: { success: true } },
  {
    match: /GET .*\/subscribed_apps/,
    status: 200,
    body: {
      data: [{ whatsapp_business_api_data: { id: 'app-1', override_callback_uri: CALLBACK } }],
    },
  },
  // The BSP under test (platform token, number-level override).
  {
    match: new RegExp(`POST ${PIN}/${waba}/subscribed_apps`),
    status: 200,
    body: { success: true },
  },
  { match: new RegExp(`POST ${PIN}/${phone}$`), status: 200, body: { success: true } },
  { match: /GET https:\/\/api\.bspone\.io\/wa\/v24\.0\/me/, status: 200, body: { id: 'me' } },
];

const fake: FetchLike = async (url, init) => {
  const call: Call = {
    method: String(init?.method),
    url,
    headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    json: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  };
  calls.push(call);
  const rule = rules.find((r) => r.match.test(`${call.method} ${call.url}`));
  if (!rule) {
    return new Response(
      JSON.stringify({ error: { message: `unstubbed ${call.method} ${call.url}`, code: 1 } }),
      {
        status: 404,
      },
    );
  }
  return new Response(JSON.stringify(rule.body), { status: rule.status });
};

const PINNACLE = {
  key: 'pinnacle',
  label: 'Pinnacle BSP',
  baseUrl: 'https://api.bspone.io/wa',
  apiVersion: 'v24.0',
  authScheme: 'custom_headers',
  headerTemplates: {
    'x-api-key': '{{providerToken}}',
    'x-waba-id': '{{wabaId}}',
    'x-phone-number-id': '{{phoneNumberId}}',
  },
  credentialMode: 'platform_token',
  signatureScheme: 'shared_secret_header',
  signatureHeaderName: 'x-bsp-secret',
  billingMode: 'provider_credit_line',
  capabilities: { mediaUpload: false },
  onboarding: 'embedded_signup',
  credentials: {
    providerToken: PIN_TOKEN,
    webhookSecret: PIN_WEBHOOK_SECRET,
    verifyToken: PIN_VERIFY,
  },
};

const TOKENCO = {
  key: 'tokenco',
  label: 'Token Co',
  baseUrl: 'https://graph.tokenco.io',
  apiVersion: 'v22.0',
  authScheme: 'bearer',
  credentialMode: 'channel_token',
  signatureScheme: 'meta_app_secret_sha256',
  credentials: { appSecret: 'tokenco-app-secret-1' },
};

let pinnacleId = '';
let tokencoId = '';

async function createProvider(body: Record<string, unknown>, activate = true) {
  const res = await sup('post', '').send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  let p = whatsappProviderSchema.parse(res.body);
  if (activate) {
    const on = await sup('post', `/${p.id}/activate`).send({ rowVersion: p.rowVersion });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    p = whatsappProviderSchema.parse(on.body);
  }
  return p;
}

const providerOf = async (id: string) =>
  whatsappProviderSchema.parse((await sup('get', `/${id}`)).body);

const clearDefault = async () => {
  await sup('delete', '/default');
};

const connect = (t: Tenant, ids: { waba: string; phone: string }) =>
  api
    .as(t.admin)
    .post('/v2/waba/numbers/connect/embedded')
    .set('idempotency-key', `k${Math.random()}`)
    .send({ code: 'CODE-1', wabaId: ids.waba, phoneNumberId: ids.phone });

/** A connected number straight into the table, the way the connect flow leaves it. */
async function seedNumber(
  t: Tenant,
  ids: { waba: string; phone: string },
  opts: {
    providerKey?: string;
    status?: string;
    token?: string | null;
    authKey?: string;
    legacy?: boolean;
  } = {},
): Promise<string> {
  const crypto = h.app.get(CryptoService);
  const key = opts.providerKey ?? 'meta';
  const creds =
    opts.status === 'disconnected'
      ? null
      : crypto.encrypt(
          JSON.stringify({
            ...(opts.token === null ? {} : { access_token: opts.token ?? `TOKEN-${ids.phone}` }),
            ...(opts.authKey ? { auth_key: opts.authKey } : {}),
          }),
        );
  const meta = {
    provider: key === 'interakt' ? 'interakt' : 'meta',
    ...(opts.legacy ? {} : { provider_key: key }),
    waba_id: ids.waba,
    phone_number_id: ids.phone,
  };
  const res = await h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, credentials_json, meta_json, connected_at)
     VALUES ($1, 'waba', $2, $3, $4, $5, $6::jsonb, now()) RETURNING uuid`,
    [
      t.orgId,
      opts.status ?? 'connected',
      `+1555${ids.phone.slice(-7)}`,
      `Number ${ids.phone.slice(-4)}`,
      creds,
      JSON.stringify(meta),
    ],
  );
  return res.rows[0].uuid as string;
}

const numberRow = async (uuid: string) =>
  (await h.owner.query(`SELECT * FROM wa_provider_configs WHERE uuid = $1`, [uuid])).rows[0] as {
    id: number;
    meta_json: Record<string, unknown>;
    credentials_json: string | null;
  };

const outboxEvents = async (orgId: number) =>
  (
    await h.owner.query(
      `SELECT event_type, payload FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'wa_provider_configs' ORDER BY id`,
      [orgId],
    )
  ).rows as Array<{ event_type: string; payload: Record<string, unknown> }>;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  http = h.app.get(WabaHttp);
  http.fetchImpl = fake;

  superToken = await login(OPERATOR_EMAIL);
  const setup = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/mfa/setup')
    .set(bearer(superToken));
  const enabled = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(superToken))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  supportToken = await login('support@platform.test');

  // An operator who may only READ the registry: a custom role with the view key and nothing else.
  const role = await request(h.app.getHttpServer())
    .post('/v2/platform/roles')
    .set(bearer(superToken))
    .send({ name: 'WhatsApp viewer', permissions: ['platform.whatsapp_providers.view'] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT 'viewer@platform.test', 'Viewer', password_hash, 'auditor' FROM platform_operators WHERE email = $1`,
    [OPERATOR_EMAIL],
  );
  const staff = await request(h.app.getHttpServer())
    .get('/v2/platform/staff')
    .set(bearer(superToken));
  const viewer = (staff.body.data as Array<{ id: string; email: string }>).find(
    (s) => s.email === 'viewer@platform.test',
  )!;
  const set = await request(h.app.getHttpServer())
    .put(`/v2/platform/staff/${viewer.id}/roles`)
    .set(bearer(superToken))
    .send({ roleIds: [role.body.id] });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  viewerToken = await login('viewer@platform.test');

  pinnacleId = (await createProvider(PINNACLE)).id;
  tokencoId = (await createProvider(TOKENCO)).id;
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(() => {
  calls = [];
  rules = defaults('0', '0');
});

afterEach(async () => {
  await h.owner.query(`DELETE FROM wa_provider_configs WHERE provider = 'waba'`);
  await h.owner.query(`DELETE FROM org_whatsapp_provider_assignment`);
  await clearDefault();
});

describe('who may use the operator API', () => {
  const paths = ['', '/assignments', `/${'00000000-0000-4000-8000-000000000000'}`];

  it('a workspace user is refused and an anonymous visitor is 401', async () => {
    const t = await api.signup('wpa');
    for (const p of paths) {
      const tenant = await request(h.app.getHttpServer())
        .get(`/v2/platform/whatsapp-providers${p}`)
        .set(bearer(t.admin));
      expect([401, 403], p).toContain(tenant.status);
      const anon = await request(h.app.getHttpServer()).get(`/v2/platform/whatsapp-providers${p}`);
      expect(anon.status, p).toBe(401);
    }
  });

  it('a staff role without the key is refused and the permission is named', async () => {
    const res = await op(supportToken, 'get', '');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('RBAC_PLATFORM_PERMISSION_REQUIRED');
    expect(JSON.stringify(res.body)).toContain('platform.whatsapp_providers.view');
  });

  it('view is not enough to change anything or to switch numbers', async () => {
    expect((await op(viewerToken, 'get', '')).status).toBe(200);
    expect((await op(viewerToken, 'get', '/assignments')).status).toBe(200);
    const create = await op(viewerToken, 'post', '').send({ ...PINNACLE, key: 'nope' });
    expect(create.status).toBe(403);
    expect(JSON.stringify(create.body)).toContain('platform.whatsapp_providers.manage');
    const t = await api.signup('wpv');
    const switchBody = { targetProviderId: pinnacleId, dryRun: true };
    const sw = await op(viewerToken, 'post', `/workspaces/${await orgUuid(t)}/switch`).send(
      switchBody,
    );
    expect(sw.status).toBe(403);
    expect(JSON.stringify(sw.body)).toContain('platform.whatsapp_providers.switch');
    expect(
      (
        await op(viewerToken, 'put', `/workspaces/${await orgUuid(t)}/assignment`).send({
          providerId: pinnacleId,
        })
      ).status,
    ).toBe(403);
    expect((await op(viewerToken, 'delete', '/default')).status).toBe(403);
  });
});

async function orgUuid(t: Tenant): Promise<string> {
  return (await h.owner.query(`SELECT uuid FROM organizations WHERE id = $1`, [t.orgId])).rows[0]
    .uuid as string;
}

describe('the providers and their secrets', () => {
  it('lists the two built-in providers from the live WABA settings, never their values', async () => {
    const res = await sup('get', '');
    expect(res.status).toBe(200);
    const list = whatsappProviderListSchema.parse(res.body);
    const meta = list.data.find((p) => p.key === 'meta')!;
    const interakt = list.data.find((p) => p.key === 'interakt')!;
    expect(meta).toMatchObject({
      builtin: 'meta',
      credentialMode: 'channel_token',
      baseUrl: 'https://graph.facebook.com',
      status: 'active',
    });
    expect(interakt).toMatchObject({
      builtin: 'interakt',
      credentialMode: 'platform_token',
      capabilities: { mediaUpload: false },
      signatureScheme: 'none',
    });
    expect(interakt.credentials.providerToken).toEqual({ set: true, last4: 'ey-1' });
    expect(meta.credentials.appSecret).toEqual({ set: true, last4: 'et-1' });
    const text = JSON.stringify(res.body);
    for (const secret of ['partner-key-1', 'app-secret-1', 'sys-token-1'])
      expect(text).not.toContain(secret);
  });

  it('creates a provider disabled, seals its secrets and never returns them', async () => {
    const res = await sup('post', '').send({ ...PINNACLE, key: 'sealed-one' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const p = whatsappProviderSchema.parse(res.body);
    expect(p).toMatchObject({
      status: 'disabled',
      builtin: null,
      isDefault: false,
      signatureScheme: 'shared_secret_header',
      webhookPath: '/v2/public/webhooks/whatsapp',
    });
    expect(p.credentials.providerToken).toEqual({ set: true, last4: '7788' });
    expect(p.credentials.appSecret).toEqual({ set: false, last4: null });

    const stored = (
      await h.owner.query(
        `SELECT credentials_enc, credential_hints FROM whatsapp_providers WHERE key = 'sealed-one'`,
      )
    ).rows[0];
    expect(stored.credentials_enc).toMatch(/^v1:/);
    for (const secret of [PIN_TOKEN, PIN_WEBHOOK_SECRET, PIN_VERIFY]) {
      expect(stored.credentials_enc).not.toContain(secret);
      expect(JSON.stringify(stored.credential_hints)).not.toContain(secret);
      expect(JSON.stringify((await sup('get', '')).body)).not.toContain(secret);
      expect(JSON.stringify((await sup('get', `/${p.id}`)).body)).not.toContain(secret);
    }
    // The trail names what changed, not the values.
    const events = (
      await h.owner.query(
        `SELECT payload FROM security_events WHERE event = 'platform.whatsapp_providers.created'`,
      )
    ).rows;
    expect(events.length).toBeGreaterThan(0);
    for (const secret of [PIN_TOKEN, PIN_WEBHOOK_SECRET, PIN_VERIFY])
      expect(JSON.stringify(events)).not.toContain(secret);
  });

  it('refuses addresses, headers and keys that are not safe', async () => {
    const bad: Array<[Record<string, unknown>, number | number[]]> = [
      [{ baseUrl: 'http://api.bspone.io' }, [400, 422]],
      [{ baseUrl: 'https://169.254.169.254' }, [400, 422]],
      [{ baseUrl: 'https://localhost' }, [400, 422]],
      [{ baseUrl: 'https://db.internal' }, [400, 422]],
      [{ baseUrl: 'https://user:pw@api.bspone.io' }, [400, 422]],
      [{ headerTemplates: { host: 'evil.test', 'x-api-key': '{{providerToken}}' } }, [400, 422]],
      [
        { headerTemplates: { 'x-api-key': '{{providerToken}}', 'x-evil': '{{secrets}}' } },
        [400, 422],
      ],
      [{ headerTemplates: { 'x-api-key': 'static-value' } }, [400, 422]],
      [{ key: 'Bad Key!' }, [400, 422]],
      [{ signatureScheme: 'shared_secret_header', signatureHeaderName: null }, [400, 422]],
      [{ credentials: { providerToken: 'has space in it' } }, [400, 422]],
    ];
    for (const [over, status] of bad) {
      const res = await sup('post', '').send({ ...PINNACLE, key: uniq('bad'), ...over });
      expect(Array.isArray(status) ? status : [status], JSON.stringify(over)).toContain(res.status);
    }
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM whatsapp_providers WHERE key LIKE 'bad%'`,
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it('refuses a taken key, including the built-in ones', async () => {
    for (const key of ['pinnacle', 'meta', 'interakt']) {
      const res = await sup('post', '').send({ ...PINNACLE, key });
      expect(res.status, key).toBe(409);
      expect(res.body.code).toBe('WAP_PROVIDER_KEY_TAKEN');
    }
  });

  it('updates with a version check; absent secrets keep their value, sent ones replace, cleared ones go', async () => {
    const p = await createProvider({ ...PINNACLE, key: uniq('upd') }, false);
    const stale = await sup('patch', `/${p.id}`).send({ rowVersion: p.rowVersion + 5, label: 'X' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');

    const label = await sup('patch', `/${p.id}`).send({
      rowVersion: p.rowVersion,
      label: 'Renamed',
    });
    expect(label.status, JSON.stringify(label.body)).toBe(200);
    const afterLabel = whatsappProviderSchema.parse(label.body);
    expect(afterLabel.label).toBe('Renamed');
    expect(afterLabel.credentials.providerToken).toEqual({ set: true, last4: '7788' });

    const swap = await sup('patch', `/${p.id}`).send({
      rowVersion: afterLabel.rowVersion,
      credentials: { providerToken: 'another-partner-token-4455' },
    });
    const afterSwap = whatsappProviderSchema.parse(swap.body);
    expect(afterSwap.credentials.providerToken.last4).toBe('4455');
    expect(afterSwap.credentials.webhookSecret.set).toBe(true);
    expect(JSON.stringify(swap.body)).not.toContain('another-partner-token');

    const cleared = await sup('patch', `/${p.id}`).send({
      rowVersion: afterSwap.rowVersion,
      clearCredentials: ['webhookSecret'],
    });
    expect(whatsappProviderSchema.parse(cleared.body).credentials.webhookSecret).toEqual({
      set: false,
      last4: null,
    });
  });

  it('a built-in provider takes a new label but not a new address or secret', async () => {
    const meta = whatsappProviderListSchema
      .parse((await sup('get', '')).body)
      .data.find((p) => p.key === 'meta')!;
    const refused = await sup('patch', `/${meta.id}`).send({
      rowVersion: meta.rowVersion,
      baseUrl: 'https://graph.evil.io',
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('WAP_PROVIDER_BUILTIN');
    const secret = await sup('patch', `/${meta.id}`).send({
      rowVersion: meta.rowVersion,
      credentials: { appSecret: 'whatever-secret-1' },
    });
    expect(secret.body.code).toBe('WAP_PROVIDER_BUILTIN');
    const ok = await sup('patch', `/${meta.id}`).send({
      rowVersion: meta.rowVersion,
      notes: 'Our direct route',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.notes).toBe('Our direct route');
    expect(ok.body.baseUrl).toBe('https://graph.facebook.com');
  });
});

describe('status and the default', () => {
  it('activation needs the credential the provider’s mode relies on', async () => {
    const p = await createProvider({ ...PINNACLE, key: uniq('notoken'), credentials: {} }, false);
    const res = await sup('post', `/${p.id}/activate`).send({ rowVersion: p.rowVersion });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WAP_CREDENTIALS_MISSING');
  });

  it('there is at most one default, in the API and in the database', async () => {
    const other = await createProvider({ ...PINNACLE, key: uniq('second') });
    let a = await providerOf(pinnacleId);
    const first = await sup('post', `/${a.id}/default`).send({ rowVersion: a.rowVersion });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.isDefault).toBe(true);
    const o = await providerOf(other.id);
    const second = await sup('post', `/${o.id}/default`).send({ rowVersion: o.rowVersion });
    expect(second.status).toBe(200);
    const list = whatsappProviderListSchema.parse((await sup('get', '')).body);
    expect(list.data.filter((p) => p.isDefault).map((p) => p.key)).toEqual([other.key]);
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM whatsapp_providers WHERE is_default`))
        .rows[0].n,
    ).toBe(1);
    // The partial unique index is the backstop for any writer that skips the API.
    await expect(
      h.owner.query(`UPDATE whatsapp_providers SET is_default = true WHERE key = 'pinnacle'`),
    ).rejects.toThrow();
    a = await providerOf(pinnacleId);
    expect(a.isDefault).toBe(false);
  });

  it('a disabled provider cannot be the default, and the default cannot be disabled or archived', async () => {
    const dis = await createProvider({ ...PINNACLE, key: uniq('off') }, false);
    const noDefault = await sup('post', `/${dis.id}/default`).send({ rowVersion: dis.rowVersion });
    expect(noDefault.status).toBe(409);
    expect(noDefault.body.code).toBe('WAP_PROVIDER_DISABLED');

    const p = await providerOf(pinnacleId);
    await sup('post', `/${p.id}/default`).send({ rowVersion: p.rowVersion });
    const now = await providerOf(pinnacleId);
    for (const action of ['disable', 'archive']) {
      const res = await sup('post', `/${now.id}/${action}`).send({ rowVersion: now.rowVersion });
      expect(res.status, action).toBe(409);
      expect(res.body.code).toBe('WAP_PROVIDER_IS_DEFAULT');
    }
    const cleared = await sup('delete', '/default');
    expect(whatsappProviderListSchema.parse(cleared.body).data.some((x) => x.isDefault)).toBe(
      false,
    );
  });

  it('archiving is refused while a number or a workspace override uses the provider, and works when nothing does', async () => {
    const t = await api.signup('wpar');
    const used = await createProvider({ ...PINNACLE, key: uniq('used') });
    await sup('put', `/workspaces/${await orgUuid(t)}/assignment`).send({ providerId: used.id });
    const fresh = await providerOf(used.id);
    const refused = await sup('post', `/${fresh.id}/archive`).send({
      rowVersion: fresh.rowVersion,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('WAP_PROVIDER_IN_USE');
    await sup('delete', `/workspaces/${await orgUuid(t)}/assignment`);
    const again = await providerOf(used.id);
    const ok = await sup('post', `/${again.id}/archive`).send({ rowVersion: again.rowVersion });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe('archived');
    // An archived provider cannot be assigned.
    const assign = await sup('put', `/workspaces/${await orgUuid(t)}/assignment`).send({
      providerId: used.id,
    });
    expect(assign.status).toBe(409);
    expect(assign.body.code).toBe('WAP_PROVIDER_DISABLED');
  });
});

describe('the live test', () => {
  it('sends the stored credential to the provider and answers without echoing it', async () => {
    rules = [
      { match: /GET https:\/\/api\.bspone\.io\/wa\/v24\.0\/me/, status: 200, body: { id: 'me' } },
    ];
    const res = await sup('post', `/${pinnacleId}/test`).send({ wabaId: '100200300' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = testWhatsappProviderResponseSchema.parse(res.body);
    expect(out.result).toMatchObject({ ok: true, httpStatus: 200, errorCode: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'GET', url: `${PIN}/me` });
    expect(calls[0]!.headers).toMatchObject({ 'x-api-key': PIN_TOKEN, 'x-waba-id': '100200300' });
    // No phone number id was given: that header is left out, never sent as a literal placeholder.
    expect(calls[0]!.headers['x-phone-number-id']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(PIN_TOKEN);
    const stored = await providerOf(pinnacleId);
    expect(stored.lastTest).toMatchObject({ ok: true });
  });

  it('a refusal by the provider is an answer with its words and no secret', async () => {
    rules = [
      {
        match: /GET .*\/me/,
        status: 401,
        body: {
          error: { message: `Invalid token ${PIN_TOKEN}`, code: 190, type: 'OAuthException' },
        },
      },
    ];
    const res = await sup('post', `/${pinnacleId}/test`).send({});
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ ok: false, httpStatus: 401, errorCode: 'HTTP_401' });
    expect(JSON.stringify(res.body)).not.toContain(PIN_TOKEN);
    expect(res.body.result.message).toContain('[redacted]');
    expect(JSON.stringify(await providerOf(pinnacleId))).not.toContain(PIN_TOKEN);
  });

  it('a provider that needs a token of the number says so instead of calling out unauthenticated', async () => {
    const res = await sup('post', `/${tokencoId}/test`).send({});
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ ok: false, errorCode: 'WAP_CREDENTIALS_MISSING' });
    expect(calls).toHaveLength(0);
    const withToken = await sup('post', `/${tokencoId}/test`).send({
      channelToken: 'test-number-token-123',
    });
    expect(withToken.status).toBe(200);
    expect(calls[0]).toMatchObject({ url: 'https://graph.tokenco.io/v22.0/me' });
    expect(calls[0]!.headers.authorization).toBe('Bearer test-number-token-123');
    expect(JSON.stringify(withToken.body)).not.toContain('test-number-token-123');
  });

  it('refuses a test path that could leave the provider’s API', async () => {
    for (const path of ['/../admin', '//evil.test/x', '/me?x=1']) {
      const res = await sup('post', `/${pinnacleId}/test`).send({ path });
      expect([400, 422], path).toContain(res.status);
    }
  });
});

describe('which provider a new number goes through', () => {
  it('with an empty registry the platform setting decides: direct Meta, exactly as before', async () => {
    const t = await api.signup('wr1');
    const ids = nextIds();
    rules = defaults(ids.waba, ids.phone);
    const res = await connect(t, ids);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.connection.provider).toBe('meta');
    const row = await h.owner.query(`SELECT meta_json FROM wa_provider_configs WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(row.rows[0].meta_json).toMatchObject({ provider: 'meta', provider_key: 'meta' });
    expect(calls.some((c) => c.url.startsWith(`${G}/${ids.waba}/subscribed_apps`))).toBe(true);
    expect(calls.some((c) => c.url.includes('api.bspone.io'))).toBe(false);
  });

  it('the registry default routes the number through the provider: its address, its headers, no Graph subscribe', async () => {
    const p = await providerOf(pinnacleId);
    expect((await sup('post', `/${p.id}/default`).send({ rowVersion: p.rowVersion })).status).toBe(
      200,
    );
    const t = await api.signup('wr2');
    const ids = nextIds();
    rules = defaults(ids.waba, ids.phone);
    const res = await connect(t, ids);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.warnings).toEqual([]);
    expect(res.body.connection).toMatchObject({ status: 'connected', inboundWired: true });
    expect(JSON.stringify(res.body)).not.toMatch(new RegExp(`BISU-TOKEN-1|${PIN_TOKEN}`));

    const sub = calls.find(
      (c) => c.method === 'POST' && c.url === `${PIN}/${ids.waba}/subscribed_apps`,
    )!;
    expect(sub.headers).toMatchObject({ 'x-api-key': PIN_TOKEN, 'x-waba-id': ids.waba });
    const override = calls.find((c) => c.method === 'POST' && c.url === `${PIN}/${ids.phone}`)!;
    expect(override.headers).toMatchObject({
      'x-api-key': PIN_TOKEN,
      'x-phone-number-id': ids.phone,
    });
    expect(override.json).toMatchObject({
      webhook_configuration: { override_callback_uri: CALLBACK },
    });
    // The platform's own Meta app still does the Embedded Signup exchange; nothing else goes to Graph for this number.
    expect(
      calls.some(
        (c) => c.method === 'POST' && c.url.startsWith(`${G}/${ids.waba}/subscribed_apps`),
      ),
    ).toBe(false);
    expect(calls.some((c) => /tp-signup/.test(c.url))).toBe(false);
    expect(calls.some((c) => c.url.includes('/register'))).toBe(false);

    const row = await h.owner.query(`SELECT meta_json FROM wa_provider_configs WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(row.rows[0].meta_json).toMatchObject({ provider_key: 'pinnacle', waba_id: ids.waba });
    const events = await outboxEvents(t.orgId);
    expect(
      events.find((e) => e.event_type === 'whatsapp.connection.connected')?.payload,
    ).toMatchObject({ providerKey: 'pinnacle' });
  });

  it('a workspace override wins over the default, and clearing it follows the default again', async () => {
    const p = await providerOf(pinnacleId);
    await sup('post', `/${p.id}/default`).send({ rowVersion: p.rowVersion });
    const t = await api.signup('wr3');
    const wsId = await orgUuid(t);
    const meta = whatsappProviderListSchema
      .parse((await sup('get', '')).body)
      .data.find((x) => x.key === 'meta')!;
    const set = await sup('put', `/workspaces/${wsId}/assignment`).send({
      providerId: meta.id,
      note: 'bring your own Meta',
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({
      workspaceId: wsId,
      override: { key: 'meta' },
      effective: { source: 'override', providerKey: 'meta' },
    });

    const ids = nextIds();
    rules = defaults(ids.waba, ids.phone);
    expect((await connect(t, ids)).status).toBe(201);
    expect(
      calls.some((c) => c.url === `${G}/${ids.waba}/subscribed_apps` && c.method === 'POST'),
    ).toBe(true);
    expect(calls.some((c) => c.url.includes('api.bspone.io'))).toBe(false);

    const list = listAssignmentsResponseSchema.parse(
      (await sup('get', `/assignments?search=${t.slug}`)).body,
    );
    expect(list.registryDefault?.key).toBe('pinnacle');
    expect(list.data[0]).toMatchObject({
      workspaceId: wsId,
      override: { key: 'meta' },
      numberCount: 1,
      numbersOnOtherProvider: 0,
    });

    const cleared = await sup('delete', `/workspaces/${wsId}/assignment`);
    expect(cleared.body).toMatchObject({
      override: null,
      effective: { source: 'default', providerKey: 'pinnacle' },
    });
  });

  it('an override that points at a provider that was disabled is refused at connect, not silently rerouted', async () => {
    const t = await api.signup('wr4');
    const fresh = await createProvider({ ...PINNACLE, key: uniq('gone') });
    await sup('put', `/workspaces/${await orgUuid(t)}/assignment`).send({ providerId: fresh.id });
    const now = await providerOf(fresh.id);
    expect(
      (await sup('post', `/${now.id}/disable`).send({ rowVersion: now.rowVersion })).status,
    ).toBe(200);
    const ids = nextIds();
    rules = defaults(ids.waba, ids.phone);
    const res = await connect(t, ids);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROVIDER_UNAVAILABLE');
    expect(calls.some((c) => c.url.includes('subscribed_apps'))).toBe(false);
  });

  it('a workspace sees its own provider info and nothing of the provider’s address or secrets', async () => {
    const p = await providerOf(pinnacleId);
    await sup('post', `/${p.id}/default`).send({ rowVersion: p.rowVersion });
    const t = await api.signup('wr5');
    const ids = nextIds();
    await seedNumber(t, ids, { providerKey: 'pinnacle', token: null });
    const other = await api.signup('wr5b');
    await seedNumber(other, nextIds(), { providerKey: 'meta' });

    const res = await api.as(t.admin).get('/v2/waba/provider-info');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const info = channelProviderInfoSchema.parse(res.body);
    expect(info.newNumbers).toMatchObject({
      providerKey: 'pinnacle',
      providerLabel: 'Pinnacle BSP',
      credentialMode: 'platform_token',
      capabilities: { mediaUpload: false },
      onboardingMethods: ['embedded_signup'],
    });
    expect(info.numbers).toHaveLength(1);
    expect(info.numbers[0]).toMatchObject({
      providerKey: 'pinnacle',
      capabilities: { mediaUpload: false },
    });
    const text = JSON.stringify(res.body);
    for (const leak of [PIN_TOKEN, PIN_WEBHOOK_SECRET, 'api.bspone.io', 'baseUrl', 'x-api-key'])
      expect(text).not.toContain(leak);

    const none = await request(h.app.getHttpServer()).get('/v2/waba/provider-info');
    expect(none.status).toBe(401);
  });
});

describe('switching a workspace’s numbers', () => {
  async function workspaceWithNumbers() {
    const t = await api.signup('wsw');
    const a = nextIds();
    const b = nextIds();
    const c = nextIds();
    const withToken = await seedNumber(t, a, { token: 'TOKEN-A' });
    const noToken = await seedNumber(t, b, { token: null, authKey: 'partner-key-1' });
    const disconnected = await seedNumber(t, c, { status: 'disconnected' });
    return { t, ids: { a, b, c }, withToken, noToken, disconnected, ws: await orgUuid(t) };
  }

  const switchTo = (ws: string, body: Record<string, unknown>) =>
    sup('post', `/workspaces/${ws}/switch`).send(body);

  it('a dry run changes nothing, calls no provider, and lists what each number needs', async () => {
    const w = await workspaceWithNumbers();
    const before = await numberRow(w.withToken);
    const res = await switchTo(w.ws, { targetProviderId: tokencoId, dryRun: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = switchWorkspaceProviderResponseSchema.parse(res.body);
    expect(out).toMatchObject({ dryRun: true, overrideSet: false, to: { key: 'tokenco' } });
    const by = Object.fromEntries(out.numbers.map((n) => [n.numberId, n]));
    // The target takes the number's own token: one has it, one does not, one is disconnected.
    expect(by[w.withToken]).toMatchObject({
      state: 'ready',
      requirements: [],
      resubscribe: true,
      from: { key: 'meta' },
    });
    expect(by[w.noToken]).toMatchObject({
      state: 'blocked',
      requirements: ['number_token_needed'],
      resubscribe: false,
    });
    expect(by[w.disconnected]).toMatchObject({
      state: 'ready',
      requirements: ['reconnect_needed'],
      resubscribe: false,
    });
    expect(calls).toHaveLength(0);
    expect((await numberRow(w.withToken)).meta_json).toEqual(before.meta_json);
    expect(await outboxEvents(w.t.orgId)).toEqual([]);

    // A platform-token target needs nothing from the numbers.
    const pin = await switchTo(w.ws, { targetProviderId: pinnacleId, dryRun: true });
    expect(pin.body.numbers.map((n: { state: string }) => n.state)).toEqual([
      'ready',
      'ready',
      'ready',
    ]);
    expect(calls).toHaveLength(0);
  });

  it('applies the move: re-subscribes through the new route first, re-points the number, audits it and keeps the inbox linked', async () => {
    const w = await workspaceWithNumbers();
    rules = [...defaults(w.ids.a.waba, w.ids.a.phone), ...defaults(w.ids.b.waba, w.ids.b.phone)];
    const res = await switchTo(w.ws, {
      targetProviderId: pinnacleId,
      reason: 'move to Pinnacle',
      setOverride: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const out = switchWorkspaceProviderResponseSchema.parse(res.body);
    expect(out.overrideSet).toBe(true);
    const by = Object.fromEntries(out.numbers.map((n) => [n.numberId, n]));
    expect(by[w.withToken]).toMatchObject({
      state: 'switched',
      resubscribe: true,
      inboundWired: true,
      from: { key: 'meta' },
    });
    expect(by[w.noToken]).toMatchObject({ state: 'switched' });
    expect(by[w.disconnected]).toMatchObject({
      state: 'repointed',
      requirements: ['reconnect_needed'],
    });
    expect(JSON.stringify(res.body)).not.toContain(PIN_TOKEN);

    // The webhook was moved through the provider's own route, with the provider's headers.
    const sub = calls.find(
      (c) => c.method === 'POST' && c.url === `${PIN}/${w.ids.a.waba}/subscribed_apps`,
    )!;
    expect(sub.headers).toMatchObject({ 'x-api-key': PIN_TOKEN, 'x-waba-id': w.ids.a.waba });
    const override = calls.find((c) => c.method === 'POST' && c.url === `${PIN}/${w.ids.a.phone}`)!;
    expect(override.json).toMatchObject({
      webhook_configuration: { override_callback_uri: CALLBACK },
    });

    for (const uuid of [w.withToken, w.noToken, w.disconnected]) {
      expect((await numberRow(uuid)).meta_json).toMatchObject({
        provider_key: 'pinnacle',
        provider_switched_from: 'meta',
      });
    }
    // The number keeps its own token (rollback needs it).
    const crypto = h.app.get(CryptoService);
    expect(
      JSON.parse(crypto.decrypt((await numberRow(w.withToken)).credentials_json!)),
    ).toMatchObject({ access_token: 'TOKEN-A' });

    // One event per CONNECTED number, under the name the inbox listens to; a disconnected number must not be revived by it.
    const events = (await outboxEvents(w.t.orgId)).filter(
      (e) => e.event_type === 'whatsapp.connection.connected',
    );
    expect(events).toHaveLength(2);
    expect(events[0]!.payload).toMatchObject({
      providerKey: 'pinnacle',
      fromProviderKey: 'meta',
      switched: true,
    });
    expect(JSON.stringify(events)).not.toContain(PIN_TOKEN);
    // Audit: the operator is the actor, with the reason, and no secret.
    const audit = (
      await h.owner.query(
        `SELECT actor_type, delta FROM audit_log WHERE org_id = $1 AND module = 'wa_provider_configs' AND action = 'update'`,
        [w.t.orgId],
      )
    ).rows as Array<{ actor_type: string; delta: Record<string, { old: unknown; new: unknown }> }>;
    expect(audit).toHaveLength(3);
    expect(audit.every((a) => a.actor_type === 'platform_operator')).toBe(true);
    expect(audit[0]!.delta).toMatchObject({
      provider_key: { old: 'meta', new: 'pinnacle' },
      reason: { new: 'move to Pinnacle' },
    });
    const trail = (
      await h.owner.query(
        `SELECT payload FROM security_events WHERE event = 'platform.whatsapp_providers.workspace_switched' AND subject_org_id = $1`,
        [w.t.orgId],
      )
    ).rows;
    expect(trail[0]!.payload).toMatchObject({
      to: 'pinnacle',
      switched: 2,
      repointed: 1,
      failed: 0,
      overrideSet: true,
    });

    // The WABA module now resolves the number through the provider: the inbox adapter and the media pipeline read this connection.
    const db = h.app.get(DatabaseService);
    const waba = h.app.get(WabaConnectService);
    const resolved = await db.txAs({ orgId: w.t.orgId, userId: null }, (tx) =>
      waba.resolveConnection(tx, w.t.orgId, { uuid: w.withToken }),
    );
    expect(resolved?.conn?.registry).toMatchObject({
      providerKey: 'pinnacle',
      credentialMode: 'platform_token',
    });
    calls = [];
    rules.unshift({ match: /\/messages$/, status: 200, body: { messages: [{ id: 'wamid.1' }] } });
    await http.call(authOf(resolved!.conn!), {
      method: 'POST',
      path: `/${w.ids.a.phone}/messages`,
      json: { x: 1 },
    });
    expect(calls[0]).toMatchObject({ url: `${PIN}/${w.ids.a.phone}/messages` });
    expect(calls[0]!.headers).toMatchObject({ 'x-api-key': PIN_TOKEN });
    expect(calls[0]!.headers.authorization).toBeUndefined();

    // Nothing left to move: a second switch is refused.
    const again = await switchTo(w.ws, { targetProviderId: pinnacleId });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('WAP_SWITCH_NOTHING_TO_DO');
  });

  it('a number the new provider cannot take over is left exactly as it was', async () => {
    const w = await workspaceWithNumbers();
    rules = [
      {
        match: new RegExp(`POST ${PIN}/${w.ids.a.waba}/subscribed_apps`),
        status: 500,
        body: { error: { message: 'boom', code: 1 } },
      },
    ];
    const res = await switchTo(w.ws, { targetProviderId: pinnacleId, numberIds: [w.withToken] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.numbers).toHaveLength(1);
    expect(res.body.numbers[0]).toMatchObject({ state: 'failed', numberId: w.withToken });
    expect(res.body.numbers[0].message).toContain('Nothing was changed');
    expect((await numberRow(w.withToken)).meta_json).toMatchObject({ provider_key: 'meta' });
    expect(await outboxEvents(w.t.orgId)).toEqual([]);
  });

  it('a blocked number is not touched, and the rest of the workspace is', async () => {
    const w = await workspaceWithNumbers();
    rules = [
      ...defaults(w.ids.a.waba, w.ids.a.phone),
      { match: /graph\.tokenco\.io/, status: 200, body: { success: true } },
    ];
    const res = await switchTo(w.ws, { targetProviderId: tokencoId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const by = Object.fromEntries(
      (res.body.numbers as Array<{ numberId: string; state: string }>).map((n) => [
        n.numberId,
        n.state,
      ]),
    );
    expect(by[w.noToken]).toBe('blocked');
    expect(by[w.withToken]).toBe('switched');
    expect((await numberRow(w.noToken)).meta_json).toMatchObject({ provider_key: 'meta' });
    // The channel-token provider authenticates with the number's own token.
    const sub = calls.find((c) => c.url.startsWith('https://graph.tokenco.io/v22.0/'))!;
    expect(sub.headers.authorization).toBe('Bearer TOKEN-A');
  });

  it('can be rolled back by switching back, through the provider the number came from', async () => {
    const w = await workspaceWithNumbers();
    rules = [...defaults(w.ids.a.waba, w.ids.a.phone), ...defaults(w.ids.b.waba, w.ids.b.phone)];
    await switchTo(w.ws, { targetProviderId: pinnacleId });
    const meta = whatsappProviderListSchema
      .parse((await sup('get', '')).body)
      .data.find((p) => p.key === 'meta')!;
    calls = [];
    const back = await switchTo(w.ws, { targetProviderId: meta.id, fromProviderId: pinnacleId });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const by = Object.fromEntries(
      (back.body.numbers as Array<{ numberId: string; state: string; from: { key: string } }>).map(
        (n) => [n.numberId, n],
      ),
    );
    expect(by[w.withToken]).toMatchObject({ state: 'switched', from: { key: 'pinnacle' } });
    expect(
      calls.some((c) => c.method === 'POST' && c.url === `${G}/${w.ids.a.waba}/subscribed_apps`),
    ).toBe(true);
    const graphSub = calls.find((c) => c.url === `${G}/${w.ids.a.waba}/subscribed_apps`)!;
    expect(graphSub.headers.authorization).toBe('Bearer TOKEN-A');
    expect((await numberRow(w.withToken)).meta_json).toMatchObject({
      provider_key: 'meta',
      provider: 'meta',
    });
  });

  it('moving to the built-in Interakt route registers the number and stores the partner key for it', async () => {
    const w = await workspaceWithNumbers();
    rules = [
      ...defaults(w.ids.a.waba, w.ids.a.phone),
      { match: /tp-signup/, status: 200, body: {} },
      {
        match: new RegExp(
          `POST https://amped-express\\.interakt\\.ai/api/v25\\.0/${w.ids.a.phone}$`,
        ),
        status: 200,
        body: { success: true },
      },
    ];
    const interakt = whatsappProviderListSchema
      .parse((await sup('get', '')).body)
      .data.find((p) => p.key === 'interakt')!;
    const res = await switchTo(w.ws, { targetProviderId: interakt.id, numberIds: [w.withToken] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.numbers[0]).toMatchObject({ state: 'switched' });
    expect(calls.some((c) => /tp-signup/.test(c.url))).toBe(true);
    const row = await numberRow(w.withToken);
    expect(row.meta_json).toMatchObject({ provider: 'interakt', provider_key: 'interakt' });
    expect(JSON.parse(h.app.get(CryptoService).decrypt(row.credentials_json!))).toMatchObject({
      auth_key: 'partner-key-1',
      access_token: 'TOKEN-A',
    });
  });

  it('refuses a disabled target, an unknown workspace and an unknown provider', async () => {
    const w = await workspaceWithNumbers();
    const off = await createProvider({ ...PINNACLE, key: uniq('off') }, false);
    const disabled = await switchTo(w.ws, { targetProviderId: off.id, dryRun: true });
    expect(disabled.status).toBe(409);
    expect(disabled.body.code).toBe('WAP_PROVIDER_DISABLED');
    expect(
      (await switchTo('00000000-0000-4000-8000-000000000000', { targetProviderId: pinnacleId }))
        .status,
    ).toBe(404);
    expect(
      (await switchTo(w.ws, { targetProviderId: '00000000-0000-4000-8000-000000000000' })).status,
    ).toBe(404);
  });

  it('another workspace’s numbers are out of reach of a number id from this one', async () => {
    const w = await workspaceWithNumbers();
    const other = await workspaceWithNumbers();
    const res = await switchTo(w.ws, {
      targetProviderId: pinnacleId,
      dryRun: true,
      numberIds: [other.withToken],
    });
    // Selected by uuid inside the workspace: the foreign id matches nothing.
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('WAP_SWITCH_NOTHING_TO_DO');
  });

  it('numbers connected before the registry (no provider key) are on their legacy route and can be moved', async () => {
    const t = await api.signup('wsl');
    const ids = nextIds();
    const uuid = await seedNumber(t, ids, {
      providerKey: 'interakt',
      legacy: true,
      authKey: 'partner-key-1',
    });
    const ws = await orgUuid(t);
    const dry = await switchTo(ws, { targetProviderId: pinnacleId, dryRun: true });
    expect(dry.body.numbers[0]).toMatchObject({
      numberId: uuid,
      from: { key: 'interakt' },
      state: 'ready',
    });
  });
});

describe('the webhook, per provider', () => {
  const body = (waba: string, phone: string) =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: waba,
          time: 1,
          changes: [
            { field: 'messages', value: { metadata: { phone_number_id: phone }, messages: [] } },
          ],
        },
      ],
    });
  const post = (payload: string, headers: Record<string, string> = {}, query = '') =>
    request(h.app.getHttpServer())
      .post(`/v2/public/webhooks/whatsapp${query}`)
      .set('content-type', 'application/json')
      .set(headers)
      .send(payload);
  const urlKey = `?k=${inboundUrlKey(Buffer.alloc(32, 7).toString('base64'))}`;

  it('a number on a shared-secret provider needs that provider’s header: the URL secret alone is not enough', async () => {
    const t = await api.signup('whk');
    const ids = nextIds();
    await seedNumber(t, ids, { providerKey: 'pinnacle', token: null });
    const payload = body(ids.waba, ids.phone);
    expect((await post(payload, {}, urlKey)).status).toBe(401);
    expect((await post(payload, { 'x-bsp-secret': 'wrong-secret-0000' }, urlKey)).status).toBe(401);
    expect((await post(payload, { 'x-bsp-secret': PIN_WEBHOOK_SECRET })).status).toBe(200);
  });

  it('a provider that signs the body is verified with its own app secret', async () => {
    const { createHmac } = await import('node:crypto');
    const t = await api.signup('whs');
    const ids = nextIds();
    await seedNumber(t, ids, { providerKey: 'tokenco' });
    const payload = body(ids.waba, ids.phone);
    const sign = (secret: string) =>
      `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    expect(
      (await post(payload, { 'x-hub-signature-256': sign('not-the-secret-1') }, urlKey)).status,
    ).toBe(401);
    expect((await post(payload, {}, urlKey)).status).toBe(401);
    expect(
      (await post(payload, { 'x-hub-signature-256': sign('tokenco-app-secret-1') })).status,
    ).toBe(200);
  });

  it('a number whose provider is gone verifies nothing and is refused', async () => {
    const t = await api.signup('whg');
    const ids = nextIds();
    await seedNumber(t, ids, { providerKey: 'vanished' });
    expect((await post(body(ids.waba, ids.phone), {}, urlKey)).status).toBe(401);
  });

  it('numbers on the built-in routes keep their rule: the URL secret is accepted, nothing is required of them', async () => {
    const t = await api.signup('whb');
    const ids = nextIds();
    await seedNumber(t, ids, { providerKey: 'interakt', authKey: 'partner-key-1' });
    expect((await post(body(ids.waba, ids.phone), {}, urlKey)).status).toBe(200);
    expect((await post(body(ids.waba, ids.phone))).status).toBe(401);
  });

  it('the subscription challenge is answered with the platform token or a provider’s own verify token', async () => {
    const get = (token: string) =>
      request(h.app.getHttpServer())
        .get('/v2/public/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': token, 'hub.challenge': 'abc123' });
    const ok = await get(PIN_VERIFY);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('abc123');
    expect((await get('wrong-token-123')).status).toBe(403);
  });
});

describe('the data model', () => {
  it('keeps the registry platform-only and the assignment readable by its own workspace only', async () => {
    const t = await api.signup('wdm');
    const other = await api.signup('wdn');
    await sup('put', `/workspaces/${await orgUuid(t)}/assignment`).send({ providerId: pinnacleId });
    // Row-level security as the application role: a workspace cannot read the platform table, nor write an assignment.
    const db = h.app.get(DatabaseService);
    const { sql } = await import('drizzle-orm');
    const seen = await db.txAs({ orgId: t.orgId, userId: null }, async (tx) => ({
      providers: (await tx.execute(sql`SELECT count(*)::int AS n FROM whatsapp_providers`))
        .rows[0] as { n: number },
      own: (await tx.execute(sql`SELECT count(*)::int AS n FROM org_whatsapp_provider_assignment`))
        .rows[0] as { n: number },
    }));
    expect(seen.providers.n).toBe(0);
    expect(seen.own.n).toBe(1);
    const foreign = await db.txAs(
      { orgId: other.orgId, userId: null },
      async (tx) =>
        (await tx.execute(sql`SELECT count(*)::int AS n FROM org_whatsapp_provider_assignment`))
          .rows[0] as { n: number },
    );
    expect(foreign.n).toBe(0);
    await expect(
      db.txAs({ orgId: other.orgId, userId: null }, (tx) =>
        tx.execute(
          sql`INSERT INTO org_whatsapp_provider_assignment (org_id, provider_id) VALUES (${other.orgId}, 1)`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      db.txAs({ orgId: t.orgId, userId: null }, (tx) =>
        tx.execute(sql`DELETE FROM org_whatsapp_provider_assignment WHERE org_id = ${t.orgId}`),
      ),
    ).resolves.toBeDefined();
    expect(
      (
        await h.owner.query(
          `SELECT count(*)::int AS n FROM org_whatsapp_provider_assignment WHERE org_id = $1`,
          [t.orgId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
