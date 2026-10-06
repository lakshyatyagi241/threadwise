import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { whatsappProviderSchema } from '@crm/contracts';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  WabaHttp,
  type FetchLike,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-http';
import { QUEUES } from '../../../src/infra/queue/queues';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';
import { Api, bearer, type Tenant } from '../contacts-attributes-tags/support';

/**
 * Pinnacle's partner onboarding end to end: the operator saves a provider with the `pinnacle` program, a workspace connects a number
 * through it, and the platform opens the client's account at the partner (the client's own key becomes the number's channel token),
 * hands over the embedded details, subscribes the WABA at Meta with the client's Meta token, and queues the delayed credit-line share.
 * Real API, Postgres with row-level security and Redis; only Meta Graph and the partner are faked, at the HTTP edge.
 */
Object.assign(process.env, {
  META_APP_ID: 'app-1',
  META_APP_SECRET: 'app-secret-1',
  META_EMBEDDED_CONFIG_ID: 'cfg-env',
  META_SYSTEM_USER_ID: 'sys-user-1',
  META_SYSTEM_USER_TOKEN: 'sys-token-1',
  WABA_WEBHOOK_PUBLIC_URL: 'https://hooks.test',
  WABA_DEFAULT_PROVIDER: 'meta',
  WABA_PROVIDER_ALLOW_PRIVATE_HOSTS: 'true',
});

let h: Harness;
let api: Api;
let http: WabaHttp;
let superToken = '';

const G = 'https://graph.facebook.com/v25.0';
const PART = 'https://partners.pinnacle-test.io';
const PARTNER_KEY = 'partner-key-7788';
const CLIENT_KEY = 'client-key-4455';
const SOLUTION = '1829345157783527';
const CONFIG = '707200291383635';

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
const nextIds = () => {
  counter += 1;
  return {
    waba: `1002${String(Date.now()).slice(-6)}${counter}`,
    phone: `5550${String(Date.now()).slice(-6)}${counter}`,
  };
};

const defaults = (waba: string, phone: string): Rule[] => [
  {
    match: /oauth\/access_token/,
    status: 200,
    body: { access_token: 'BISU-1', expires_in: 5184000 },
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
  {
    match: new RegExp(`GET .*/${waba}\\?fields=message_template_namespace`),
    status: 200,
    body: { message_template_namespace: 'ns_acme_1' },
  },
  { match: /POST .*\/assigned_users/, status: 200, body: { success: true } },
  { match: new RegExp(`POST ${G}/${waba}/subscribed_apps`), status: 200, body: { success: true } },
  {
    match: /GET .*\/subscribed_apps/,
    status: 200,
    body: {
      data: [
        {
          whatsapp_business_api_data: {
            id: 'app-1',
            override_callback_uri: 'https://hooks.test/v2/public/webhooks/whatsapp',
          },
        },
      ],
    },
  },
  {
    match: new RegExp(`POST ${PART}/create-user-account`),
    status: 200,
    body: { code: 200, data: { apikey: CLIENT_KEY, username: 'acme_user', password: 'pw-1' } },
  },
  {
    match: new RegExp(`POST ${PART}/client-embedded-detail-receiver`),
    status: 200,
    body: { code: 200 },
  },
  {
    match: new RegExp(`GET ${PART}/v3/${phone}`),
    status: 200,
    body: { id: phone, verified_name: 'Acme Store', display_phone_number: '+91 91122 90122' },
  },
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
      { status: 404 },
    );
  }
  return new Response(JSON.stringify(rule.body), { status: rule.status });
};

const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
const sup = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
  request(h.app.getHttpServer())
    [method](`/v2/platform/whatsapp-providers${path}`)
    .set(bearer(superToken));

const PROVIDER = {
  key: 'pinnacle_partner',
  label: 'Pinnacle',
  baseUrl: PART,
  apiVersion: 'v3',
  authScheme: 'custom_headers',
  headerTemplates: { apikey: '{{channelToken}}' },
  billingMode: 'provider_credit_line',
  capabilities: { mediaUpload: false },
  onboarding: 'embedded_signup',
  onboardingConfigId: CONFIG,
  partnerProgram: 'pinnacle',
  partnerSolutionId: SOLUTION,
  credentials: { providerToken: PARTNER_KEY, appSecret: 'meta-app-secret-xyz' },
};

let providerId = '';

async function orgUuid(t: Tenant): Promise<string> {
  return (await h.owner.query(`SELECT uuid FROM organizations WHERE id = $1`, [t.orgId])).rows[0]
    .uuid as string;
}

const connect = (t: Tenant, ids: { waba: string; phone: string }) =>
  api
    .as(t.admin)
    .post('/v2/waba/numbers/connect/embedded')
    .set('idempotency-key', `k${Math.random()}`)
    .send({ code: 'CODE-1', wabaId: ids.waba, phoneNumberId: ids.phone });

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  http = h.app.get(WabaHttp);
  http.fetchImpl = fake;

  const first = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  superToken = first.body.tokens.accessToken as string;
  const setup = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/mfa/setup')
    .set(bearer(superToken));
  const enabled = await request(h.app.getHttpServer())
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(superToken))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
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
});

describe('saving a provider with the pinnacle program', () => {
  it('stores the program and solution id, defaults the credential mode to channel_token, and never returns the secrets', async () => {
    const res = await sup('post', '').send(PROVIDER);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const p = whatsappProviderSchema.parse(res.body);
    expect(p.partnerProgram).toBe('pinnacle');
    expect(p.partnerSolutionId).toBe(SOLUTION);
    expect(p.credentialMode).toBe('channel_token');
    expect(p.credentials.providerToken).toEqual({ set: true, last4: PARTNER_KEY.slice(-4) });
    expect(JSON.stringify(res.body)).not.toContain(PARTNER_KEY);
    const on = await sup('post', `/${p.id}/activate`).send({ rowVersion: p.rowVersion });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    providerId = p.id;
  });

  it('refuses a program without its solution id, a bad solution id, and platform_token mode', async () => {
    const noSolution = await sup('post', '').send({
      ...PROVIDER,
      key: 'p_a',
      partnerSolutionId: undefined,
    });
    expect(noSolution.status).toBe(422);
    const badSolution = await sup('post', '').send({
      ...PROVIDER,
      key: 'p_b',
      partnerSolutionId: 'abc',
    });
    expect(badSolution.status).toBe(422);
    const wrongMode = await sup('post', '').send({
      ...PROVIDER,
      key: 'p_c',
      credentialMode: 'platform_token',
    });
    expect(wrongMode.status).toBe(422);
  });

  it('removing the program removes the solution id with it', async () => {
    const before = whatsappProviderSchema.parse((await sup('get', `/${providerId}`)).body);
    const res = await sup('patch', `/${providerId}`).send({
      rowVersion: before.rowVersion,
      partnerProgram: null,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.partnerProgram).toBeNull();
    expect(res.body.partnerSolutionId).toBeNull();
    // put it back for the connect tests
    const back = await sup('patch', `/${providerId}`).send({
      rowVersion: res.body.rowVersion,
      partnerProgram: 'pinnacle',
      partnerSolutionId: SOLUTION,
    });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body.partnerSolutionId).toBe(SOLUTION);
  });
});

describe('connecting a number through the partner', () => {
  async function tenantOnPartner(label: string): Promise<Tenant> {
    const t = await api.signup(label);
    const res = await sup('put', `/workspaces/${await orgUuid(t)}/assignment`).send({ providerId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return t;
  }

  it('opens the client account, hands over the details, subscribes at Meta, and stores the client key', async () => {
    const t = await tenantOnPartner('pin1');
    const ids = nextIds();
    rules = defaults(ids.waba, ids.phone);

    const res = await connect(t, ids);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.warnings ?? []).toEqual([]);
    expect(res.body.connection.providerKey ?? res.body.connection.provider).toBeDefined();

    const create = calls.find((c) => c.url === `${PART}/create-user-account`)!;
    expect(create.headers.apikey).toBe(PARTNER_KEY);
    expect(create.json).toMatchObject({
      template_namespace: 'ns_acme_1',
      waba_id: ids.waba,
      waba_number: ['+919112290122'],
    });

    const embedded = calls.find((c) => c.url === `${PART}/client-embedded-detail-receiver`)!;
    expect(embedded.headers.apikey).toBe(PARTNER_KEY);
    expect(embedded.json).toMatchObject({
      waba_id: ids.waba,
      phone_numberid: ids.phone,
      config_id: CONFIG,
      access_token: 'BISU-1',
      solution_id: SOLUTION,
      business_id: 'B1',
      mmlite: 1,
    });
    // account first, then the details
    expect(calls.indexOf(create)).toBeLessThan(calls.indexOf(embedded));

    // the webhook subscription is Meta's, with the client's Meta token (not the partner)
    const sub = calls.find(
      (c) => c.method === 'POST' && c.url === `${G}/${ids.waba}/subscribed_apps`,
    )!;
    expect(sub.headers.authorization).toBe('Bearer BISU-1');
    expect(calls.some((c) => c.method === 'POST' && c.url.startsWith(`${PART}/${ids.waba}`))).toBe(
      false,
    );

    const row = (
      await h.owner.query(
        `SELECT credentials_json, meta_json FROM wa_provider_configs WHERE meta_json ->> 'waba_id' = $1`,
        [ids.waba],
      )
    ).rows[0] as { credentials_json: string; meta_json: Record<string, unknown> };
    const creds = JSON.parse(h.app.get(CryptoService).decrypt(row.credentials_json)) as Record<
      string,
      string
    >;
    expect(creds).toMatchObject({
      access_token: 'BISU-1',
      channel_token: CLIENT_KEY,
      partner_username: 'acme_user',
    });
    expect(row.meta_json).toMatchObject({
      provider_key: 'pinnacle_partner',
      partner_program: 'pinnacle',
      credit_line_assigned: false,
    });
    expect(JSON.stringify(res.body)).not.toContain(CLIENT_KEY);
    expect(JSON.stringify(res.body)).not.toContain('pw-1');

    // the credit line is queued, delayed, once for this number
    const queue = h.app.get<Queue>(getQueueToken(QUEUES.PINNACLE_CREDIT_LINE));
    const jobs = await queue.getJobs(['delayed']);
    const job = jobs.find((j) => j.data.wabaId === ids.waba)!;
    expect(job.data).toMatchObject({
      providerKey: 'pinnacle_partner',
      businessId: 'B1',
      orgId: t.orgId,
    });
    expect(job.opts.delay).toBe(200_000);
  });

  it('later calls for the number carry the client key, not the Meta token', async () => {
    const t = await tenantOnPartner('pin2');
    const ids = nextIds();
    rules = defaults(ids.waba, ids.phone);
    const made = await connect(t, ids);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    calls = [];
    const res = await api.as(t.admin).get(`/v2/waba/numbers/${made.body.connection.id}/health`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const read = calls.find(
      (c) => c.method === 'GET' && c.url.startsWith(`${PART}/v3/${ids.phone}`),
    )!;
    expect(read.headers.apikey).toBe(CLIENT_KEY);
    expect(JSON.stringify(read.headers)).not.toContain('BISU-1');
  });

  it("stores nothing and shows the partner's own reason when it refuses the account", async () => {
    const t = await tenantOnPartner('pin3');
    const ids = nextIds();
    rules = [
      {
        match: new RegExp(`POST ${PART}/create-user-account`),
        status: 200,
        body: { code: 409, message: 'WABA already onboarded' },
      },
      ...defaults(ids.waba, ids.phone),
    ];
    const res = await connect(t, ids);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe('WAP_PARTNER_REFUSED');
    expect(res.body.detail ?? res.body.message).toContain('WABA already onboarded');
    const rowsLeft = await h.owner.query(
      `SELECT 1 FROM wa_provider_configs WHERE meta_json ->> 'waba_id' = $1`,
      [ids.waba],
    );
    expect(rowsLeft.rowCount).toBe(0);
    expect(calls.some((c) => c.url === `${PART}/client-embedded-detail-receiver`)).toBe(false);
    expect(calls.some((c) => c.url === `${G}/${ids.waba}/subscribed_apps`)).toBe(false);
  });
});
