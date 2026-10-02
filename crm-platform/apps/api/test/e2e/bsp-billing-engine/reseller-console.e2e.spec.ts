import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bspAllocationListSchema,
  bspAllocationSchema,
  bspSettingsResponseSchema,
  bspStatusSchema,
  bspWabaCandidateListSchema,
  attachAllResultSchema,
  revokeResultSchema,
} from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { ResellerCreditService } from '../../../src/modules/bsp-billing-engine/reseller-credit.service';
import { bearer, newTenant, startBspHarness, type BspHarness, type Tenant } from './harness';

/**
 * The operator's reseller console end to end through HTTP (TW-BSP-001, -003..-010): connection settings, the Meta credit-source
 * adapter against a stand-in Graph API, attach one / all / automatically, revoke, and the allocation register, with the audit,
 * outbox and tenant properties every write must have.
 */
let h: BspHarness;

const ops = (method: 'get' | 'post' | 'put', path: string) =>
  h.api.http()[method](`/v2/platform/bsp${path}`).set(bearer(h.superToken));
const support = (method: 'get' | 'post' | 'put', path: string) =>
  h.api.http()[method](`/v2/platform/bsp${path}`).set(bearer(h.supportToken));

const SETTINGS = {
  businessId: '5550001',
  extendedCreditId: '',
  ratesEndpoint: '',
  autoAttach: false,
};
const TOKEN = 'EAAG-system-user-token-0001';

async function saveSettings(over: Record<string, unknown> = {}) {
  const res = await ops('put', '/settings').send({ ...SETTINGS, systemUserToken: TOKEN, ...over });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function resetPlatform() {
  await h.owner.query(
    `DELETE FROM platform_settings WHERE key IN ('bsp.reseller', 'bsp.system_user_token')`,
  );
  h.app.get(PlatformSettingsService).invalidate();
  h.graph.reset();
}

/** A connected Cloud API number for an organization (the WABA connection module is not built; the table is). */
async function waba(
  orgId: number,
  wabaId: string,
  opts: { status?: string; phone?: string; label?: string } = {},
) {
  await h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, meta_json, phone_number, display_label)
     VALUES ($1, 'waba', $2, $3::jsonb, $4, $5)`,
    [
      orgId,
      opts.status ?? 'connected',
      JSON.stringify({ waba_id: wabaId, phone_number_id: `pn-${wabaId}` }),
      opts.phone ?? '+15550100',
      opts.label ?? null,
    ],
  );
}

async function reseller(orgId: number, on = true) {
  await h.owner.query(
    `INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES ($1, $2)
     ON CONFLICT (org_id) DO UPDATE SET bill_to_platform_credit = EXCLUDED.bill_to_platform_credit`,
    [orgId, on],
  );
}

interface AllocationDb {
  id: number;
  uuid: string;
  status: string;
  currency: string;
  last_error: string | null;
  allocation_config_id: string | null;
  credit_source: string | null;
  created_by_operator_id: number | null;
}

async function row(orgId: number, wabaId: string) {
  const r = await h.owner.query(
    `SELECT * FROM bsp_credit_allocations WHERE org_id = $1 AND waba_id = $2`,
    [orgId, wabaId],
  );
  return r.rows[0] as AllocationDb | undefined;
}

const count = async (sql: string, params: unknown[]) =>
  Number((await h.owner.query(sql, params)).rows[0].n);

let a: Tenant;
let b: Tenant;
let uniq = 0;
const nextWaba = () => `W${Date.now()}${uniq++}`;

beforeAll(async () => {
  h = await startBspHarness();
  a = await newTenant(h, 'bspa');
  b = await newTenant(h, 'bspb');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

beforeEach(resetPlatform);

describe('who may open the console (TW-BSP-001 #2 #3, -003 #5)', () => {
  it('a signed-in workspace user is refused, an unauthenticated visitor is 401', async () => {
    for (const path of ['/status', '/settings', '/allocations', '/dashboard', '/waba-candidates']) {
      const tenant = await h.api.http().get(`/v2/platform/bsp${path}`).set(bearer(a.admin));
      expect([401, 403], path).toContain(tenant.status);
      const anon = await h.api.http().get(`/v2/platform/bsp${path}`);
      expect(anon.status, path).toBe(401);
    }
  });

  it('the support operator reads but cannot change anything', async () => {
    expect((await support('get', '/settings')).status).toBe(200);
    expect((await support('get', '/dashboard')).status).toBe(200);
    const w = await support('put', '/settings').send({ ...SETTINGS });
    expect(w.status).toBe(403);
    expect(w.body.code).toBe('AUTH_OPERATOR_ROLE_REQUIRED');
    expect((await support('post', '/allocations/attach-all')).status).toBe(403);
  });
});

describe('the health probe (TW-BSP-001)', () => {
  it('#1 #4 answers ok with the allocation count and the default Graph version', async () => {
    const before = await count(`SELECT count(*)::int AS n FROM bsp_credit_allocations`, []);
    const res = await ops('get', '/status');
    expect(res.status).toBe(200);
    const body = bspStatusSchema.parse(res.body);
    expect(body).toMatchObject({
      ok: true,
      module: 'bsp',
      configured: false,
      graphVersion: 'v26.0',
    });
    expect(body.allocations).toBe(before);
  });
});

describe('connection settings (TW-BSP-003, -004)', () => {
  it('#1 nothing saved: not connected, no token, the defaults', async () => {
    const res = await ops('get', '/settings');
    const s = bspSettingsResponseSchema.parse(res.body);
    expect(s).toMatchObject({
      configured: false,
      tokenSet: false,
      businessId: '',
      graphVersion: 'v26.0',
      autoAttach: false,
      autoAttachCurrency: '',
    });
    expect(s.creditCurrencies).toEqual(['AUD', 'EUR', 'GBP', 'IDR', 'INR', 'USD']);
  });

  it('#2 business id and token saved: connected, and the token appears in no response', async () => {
    const saved = await saveSettings();
    expect(saved).toMatchObject({ configured: true, tokenSet: true, businessId: '5550001' });
    const get = await ops('get', '/settings');
    expect(JSON.stringify(get.body)).not.toContain(TOKEN);
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
  });

  it('#5 the stored token is ciphertext, not plaintext', async () => {
    await saveSettings();
    const r = await h.owner.query(
      `SELECT value, is_secret FROM platform_settings WHERE key = 'bsp.system_user_token'`,
    );
    expect(r.rows[0].is_secret).toBe(true);
    expect(JSON.stringify(r.rows[0].value)).not.toContain(TOKEN);
  });

  it('#1 saving with the token blank keeps the stored token and applies the other changes', async () => {
    await saveSettings();
    const res = await ops('put', '/settings').send({ ...SETTINGS, businessId: '777' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tokenSet: true, configured: true, businessId: '777' });
    // and the kept token still works against Meta
    await waba(a.orgId, nextWaba());
    const w = (
      await h.owner.query(
        `SELECT meta_json->>'waba_id' AS w FROM wa_provider_configs WHERE org_id = $1`,
        [a.orgId],
      )
    ).rows[0].w;
    const att = await ops('post', '/allocations').send({
      workspaceId: await uuidOf(a.orgId),
      wabaId: w,
      currency: 'USD',
    });
    expect(att.status, JSON.stringify(att.body)).toBe(201);
    expect(h.graph.seen.every((s) => s.auth === `Bearer ${TOKEN}`)).toBe(true);
    await h.owner.query(`DELETE FROM wa_provider_configs WHERE org_id = $1`, [a.orgId]);
    await h.owner.query(`DELETE FROM bsp_credit_allocations WHERE org_id = $1`, [a.orgId]);
  });

  it('blank fields clear the stored values (TW-BSP-004 rule 1)', async () => {
    await saveSettings({ extendedCreditId: '999' });
    const res = await ops('put', '/settings').send({
      ...SETTINGS,
      businessId: '',
      extendedCreditId: '',
    });
    expect(res.body).toMatchObject({
      businessId: '',
      extendedCreditId: '',
      configured: false,
      tokenSet: true,
    });
  });

  it('there is a way to remove the token (Reference had none)', async () => {
    await saveSettings();
    const res = await ops('put', '/settings').send({ ...SETTINGS, clearToken: true });
    expect(res.body).toMatchObject({ tokenSet: false, configured: false });
    expect(
      await count(
        `SELECT count(*)::int AS n FROM platform_settings WHERE key = 'bsp.system_user_token'`,
        [],
      ),
    ).toBe(0);
  });

  it('#2 a rates endpoint that is not a URL is refused and nothing is written; http is refused too', async () => {
    await saveSettings();
    for (const bad of ['not a url', 'http://rates.test/r']) {
      const res = await ops('put', '/settings').send({
        ...SETTINGS,
        businessId: 'changed',
        ratesEndpoint: bad,
      });
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e: { path: string }) => e.path)).toContain('ratesEndpoint');
    }
    expect((await ops('get', '/settings')).body.businessId).toBe('5550001');
  });

  it('#3 a blank Graph version stores the default; a malformed one is refused by the server', async () => {
    const ok = await ops('put', '/settings').send({ ...SETTINGS, graphVersion: '' });
    expect(ok.body.graphVersion).toBe('v26.0');
    const set = await ops('put', '/settings').send({ ...SETTINGS, graphVersion: 'v25.0' });
    expect(set.body.graphVersion).toBe('v25.0');
    const bad = await ops('put', '/settings').send({ ...SETTINGS, graphVersion: 'latest' });
    expect(bad.status).toBe(422);
  });

  it('#4 the auto-attach currency "usd1" is stored as USD; one Meta refuses is rejected up front', async () => {
    const ok = await ops('put', '/settings').send({ ...SETTINGS, autoAttachCurrency: 'usd1' });
    expect(ok.body.autoAttachCurrency).toBe('USD');
    const bad = await ops('put', '/settings').send({ ...SETTINGS, autoAttachCurrency: 'THB' });
    expect(bad.status).toBe(422);
  });

  it('#6 unticking auto-attach stores false', async () => {
    await ops('put', '/settings').send({ ...SETTINGS, autoAttach: true });
    const res = await ops('put', '/settings').send({ ...SETTINGS, autoAttach: false });
    expect(res.body.autoAttach).toBe(false);
  });

  it('writes a security event naming the operator, without the token', async () => {
    const before = await count(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.bsp.settings_saved'`,
      [],
    );
    await saveSettings();
    const r = await h.owner.query(
      `SELECT actor_type, actor_id, payload FROM security_events WHERE event = 'platform.bsp.settings_saved' ORDER BY id DESC LIMIT 1`,
    );
    expect(
      await count(
        `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.bsp.settings_saved'`,
        [],
      ),
    ).toBe(before + 1);
    expect(r.rows[0].actor_type).toBe('platform_operator');
    expect(Number(r.rows[0].actor_id)).toBeGreaterThan(0);
    expect(JSON.stringify(r.rows[0].payload)).not.toContain(TOKEN);
    expect(r.rows[0].payload.systemUser).toBe('replaced');
  });
});

async function uuidOf(orgId: number): Promise<string> {
  return (await h.owner.query(`SELECT uuid FROM organizations WHERE id = $1`, [orgId])).rows[0]
    .uuid;
}

describe('the WABA picker (TW-BSP-003 #3 #4)', () => {
  it('lists connected numbers of every workspace with name and phone, and leaves out rows without a WABA id or not connected', async () => {
    const wa = nextWaba();
    const wb = nextWaba();
    await waba(a.orgId, wa, { phone: '+15550111', label: 'Main' });
    await waba(b.orgId, wb, { phone: '+15550222' });
    await h.owner.query(
      `INSERT INTO wa_provider_configs (org_id, provider, status, meta_json) VALUES ($1, 'waba', 'connected', '{}'::jsonb)`,
      [a.orgId],
    );
    await waba(a.orgId, nextWaba(), { status: 'pending' });
    await waba(a.orgId, nextWaba(), { status: 'disconnected' });

    const res = await ops('get', '/waba-candidates');
    const list = bspWabaCandidateListSchema.parse(res.body).data;
    const mine = list.filter((x) => [wa, wb].includes(x.wabaId));
    expect(mine.map((x) => x.wabaId).sort()).toEqual([wa, wb].sort());
    const ra = mine.find((x) => x.wabaId === wa)!;
    expect(ra).toMatchObject({ phone: '+15550111', displayLabel: 'Main', allocationStatus: null });
    expect(ra.workspaceName).toContain('Org bspa');
    // pending, disconnected and id-less rows never appear
    expect(list.filter((x) => x.workspaceId === ra.workspaceId)).toHaveLength(1);
    await h.owner.query(`DELETE FROM wa_provider_configs WHERE org_id = ANY($1)`, [
      [a.orgId, b.orgId],
    ]);
  });
});

describe('attach one (TW-BSP-005, -006)', () => {
  let orgUuid: string;
  beforeAll(async () => {
    orgUuid = await uuidOf(a.orgId);
  });
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM wa_provider_configs WHERE org_id = ANY($1)`, [
      [a.orgId, b.orgId],
    ]);
    await h.owner.query(`DELETE FROM bsp_credit_allocations WHERE org_id = ANY($1)`, [
      [a.orgId, b.orgId],
    ]);
  });

  const attach = (wabaId: string, currency = 'USD', workspaceId = orgUuid) =>
    ops('post', '/allocations').send({ workspaceId, wabaId, currency });

  it('#1 attaches: row attached with Meta allocation id, attached_at, audit, security event and outbox event', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const w = nextWaba();
    await waba(a.orgId, w);
    const res = await attach(w);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const al = bspAllocationSchema.parse(res.body);
    expect(al).toMatchObject({
      status: 'attached',
      wabaId: w,
      currency: 'USD',
      allocationConfigId: `alloc-${w}`,
      lastError: null,
      workspaceBillingMode: 'meta_direct',
    });
    expect(al.attachedAt).not.toBeNull();
    // Meta was called once, on the configured credit line, with the WABA and currency as query parameters
    const calls = h.graph.calls('POST', '/whatsapp_credit_sharing_and_attach');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/v26.0/4242/whatsapp_credit_sharing_and_attach');
    expect(calls[0]!.query.get('waba_id')).toBe(w);
    expect(calls[0]!.query.get('waba_currency')).toBe('USD');
    // and the properties every write has
    const r = await row(a.orgId, w);
    expect(r!.created_by_operator_id).not.toBeNull();
    expect(r!.credit_source).toBe('meta');
    expect(
      await count(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'bsp' AND record_id = $2`,
        [a.orgId, r!.id],
      ),
    ).toBe(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM security_events WHERE subject_org_id = $1 AND event = 'platform.bsp.credit_attached'`,
        [a.orgId],
      ),
    ).toBeGreaterThanOrEqual(1);
    const ev = await h.api.events(a.orgId, 'bsp.credit_allocation.attached');
    expect(ev.map((e) => e.wabaId)).toContain(w);
  });

  it('TW-BSP-005 #1: with no credit line typed, the first one of the business is looked up once, cached and used', async () => {
    await saveSettings();
    const w1 = nextWaba();
    const w2 = nextWaba();
    await waba(a.orgId, w1);
    await waba(a.orgId, w2);
    expect((await attach(w1)).status).toBe(201);
    expect(h.graph.calls('GET', '/extendedcredits')).toHaveLength(1);
    expect(h.graph.calls('POST', '/whatsapp_credit_sharing_and_attach')[0]!.path).toContain(
      '/credit-line-1/',
    );
    expect((await ops('get', '/settings')).body.extendedCreditId).toBe('credit-line-1');
    expect((await attach(w2)).status).toBe(201);
    expect(h.graph.calls('GET', '/extendedcredits')).toHaveLength(1);
  });

  it('TW-BSP-005 #3: no credit line at Meta is a failed row with the Reference wording', async () => {
    await saveSettings();
    h.graph.respond = () => ({ status: 200, body: { data: [] } });
    const w = nextWaba();
    await waba(a.orgId, w);
    const res = await attach(w);
    expect(res.body).toMatchObject({
      status: 'failed',
      lastError: 'No Meta extended credit line found for this business.',
      allocationConfigId: null,
    });
    expect(h.graph.calls('POST', '/whatsapp_credit_sharing_and_attach')).toHaveLength(0);
  });

  it('#2 an already attached pair does not call Meta again and creates no second row', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const w = nextWaba();
    await waba(a.orgId, w);
    const first = await attach(w);
    h.graph.reset();
    const second = await attach(w);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(h.graph.seen).toHaveLength(0);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM bsp_credit_allocations WHERE org_id = $1 AND waba_id = $2`,
        [a.orgId, w],
      ),
    ).toBe(1);
  });

  it('#3 a currency Meta does not accept makes no Meta call and stores a failed row with the allowed list', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const w = nextWaba();
    await waba(a.orgId, w);
    const res = await attach(w, 'THB');
    expect(res.body.status).toBe('failed');
    expect(res.body.currency).toBe('THB');
    expect(res.body.lastError).toContain('AUD, EUR, GBP, IDR, INR, USD');
    expect(h.graph.seen).toHaveLength(0);
    expect((await row(a.orgId, w))!.status).toBe('failed');
  });

  it('#4 #5 a Meta refusal is a failed row with Meta wording; a later success reuses the same row and clears the error', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const w = nextWaba();
    await waba(a.orgId, w);
    h.graph.respond = () => ({
      status: 400,
      body: { error: { message: 'WABA belongs to another partner' } },
    });
    const bad = await attach(w);
    expect(bad.body).toMatchObject({
      status: 'failed',
      lastError: 'WABA belongs to another partner',
      attachedAt: null,
    });
    const failedId = bad.body.id;

    h.graph.restore();
    const good = await attach(w);
    expect(good.body).toMatchObject({ status: 'attached', lastError: null });
    expect(good.body.id).toBe(failedId);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM bsp_credit_allocations WHERE org_id = $1 AND waba_id = $2`,
        [a.orgId, w],
      ),
    ).toBe(1);
  });

  it('#6 with the connection not set up, a failed row records the not-configured message', async () => {
    const w = nextWaba();
    await waba(a.orgId, w);
    const res = await attach(w);
    expect(res.body.status).toBe('failed');
    expect(res.body.lastError).toMatch(/not set up/);
    expect(h.graph.seen).toHaveLength(0);
  });

  it('a Meta that is unreachable is a failed row, never a 500', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const previous = h.source.transport;
    h.source.transport = { baseUrl: 'http://127.0.0.1:1' };
    try {
      const w = nextWaba();
      await waba(a.orgId, w);
      const res = await attach(w);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'failed', lastError: 'Could not reach Meta.' });
    } finally {
      h.source.transport = previous;
    }
  });

  it('refuses a WABA that is not a connected number of that workspace, and a workspace that does not exist (Reference accepted both)', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const w = nextWaba();
    await waba(b.orgId, w); // belongs to B
    const wrongOwner = await attach(w);
    expect(wrongOwner.status).toBe(422);
    expect(wrongOwner.body.code).toBe('BSP_WABA_NOT_FOUND');
    const pending = nextWaba();
    await waba(a.orgId, pending, { status: 'pending' });
    expect((await attach(pending)).status).toBe(422);
    const ghost = await attach(w, 'USD', '00000000-0000-4000-8000-000000000000');
    expect(ghost.status).toBe(404);
    expect(
      await count(`SELECT count(*)::int AS n FROM bsp_credit_allocations WHERE org_id = ANY($1)`, [
        [a.orgId, b.orgId],
      ]),
    ).toBe(0);
    expect(h.graph.seen).toHaveLength(0);
  });

  it('validates the body', async () => {
    const res = await ops('post', '/allocations').send({
      workspaceId: 'x',
      wabaId: '',
      currency: '',
    });
    expect(res.status).toBe(422);
  });
});

describe('attach all connected (TW-BSP-007)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM wa_provider_configs WHERE org_id = ANY($1)`, [
      [a.orgId, b.orgId],
    ]);
    await h.owner.query(`DELETE FROM bsp_credit_allocations WHERE org_id = ANY($1)`, [
      [a.orgId, b.orgId],
    ]);
    await reseller(a.orgId, true);
    await reseller(b.orgId, false);
  });

  it('#2 with the connection not set up it is refused and no allocation row changes', async () => {
    await waba(a.orgId, nextWaba());
    const res = await ops('post', '/allocations/attach-all');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BSP_NOT_CONFIGURED');
    expect(
      await count(`SELECT count(*)::int AS n FROM bsp_credit_allocations WHERE org_id = $1`, [
        a.orgId,
      ]),
    ).toBe(0);
  });

  it('#1 #4 attaches the numbers not yet attached, skips the attached one, never touches a disconnected one', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const done = nextWaba();
    const todo1 = nextWaba();
    const todo2 = nextWaba();
    const off = nextWaba();
    await waba(a.orgId, done);
    await waba(a.orgId, todo1);
    await waba(a.orgId, todo2);
    await waba(a.orgId, off, { status: 'disconnected' });
    await h.owner.query(
      `INSERT INTO bsp_credit_allocations (org_id, waba_id, status, allocation_config_id, credit_source) VALUES ($1, $2, 'attached', 'pre', 'meta')`,
      [a.orgId, done],
    );
    h.graph.respond = (req) =>
      req.query.get('waba_id') === todo2
        ? { status: 400, body: { error: { message: 'nope' } } }
        : { status: 200, body: { allocation_config_id: `alloc-${req.query.get('waba_id')}` } };

    const res = await ops('post', '/allocations/attach-all');
    expect(res.status).toBe(200);
    expect(attachAllResultSchema.parse(res.body)).toEqual({
      attached: 1,
      failed: 1,
      skipped: 1,
      remaining: 0,
    });
    expect(h.graph.calls('POST', '/whatsapp_credit_sharing_and_attach')).toHaveLength(2);
    expect((await row(a.orgId, todo1))!.status).toBe('attached');
    expect((await row(a.orgId, todo2))!.status).toBe('failed');
    expect(await row(a.orgId, off)).toBeUndefined();
    expect((await row(a.orgId, done))!.allocation_config_id).toBe('pre');
  });

  it('#3 a failed row is retried by running it again, and becomes attached', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const w = nextWaba();
    await waba(a.orgId, w);
    h.graph.respond = () => ({ status: 400, body: { error: { message: 'busy' } } });
    expect((await ops('post', '/allocations/attach-all')).body).toMatchObject({
      attached: 0,
      failed: 1,
    });
    h.graph.restore();
    expect((await ops('post', '/allocations/attach-all')).body).toMatchObject({
      attached: 1,
      failed: 0,
    });
    expect((await row(a.orgId, w))!.status).toBe('attached');
    expect(
      await count(
        `SELECT count(*)::int AS n FROM bsp_credit_allocations WHERE org_id = $1 AND waba_id = $2`,
        [a.orgId, w],
      ),
    ).toBe(1);
  });

  it('a workspace on direct billing is not attached (Reference attached everyone: fixed)', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const w = nextWaba();
    await waba(b.orgId, w);
    const res = await ops('post', '/allocations/attach-all');
    expect(res.body).toMatchObject({ attached: 0, failed: 0 });
    expect(await row(b.orgId, w)).toBeUndefined();
    expect(h.graph.seen).toHaveLength(0);
  });

  it('works in bounded batches: more numbers than one batch reports how many remain, and running again finishes them', async () => {
    await saveSettings({ extendedCreditId: '4242' });
    const ids = Array.from({ length: 23 }, nextWaba);
    for (const w of ids) await waba(a.orgId, w);
    const first = attachAllResultSchema.parse((await ops('post', '/allocations/attach-all')).body);
    expect(first).toMatchObject({ attached: 20, failed: 0, remaining: 3 });
    const second = attachAllResultSchema.parse((await ops('post', '/allocations/attach-all')).body);
    expect(second).toMatchObject({ attached: 3, failed: 0, remaining: 0, skipped: 20 });
  });
});

describe('auto-attach (TW-BSP-008)', () => {
  let credit: ResellerCreditService;
  beforeAll(() => {
    credit = h.app.get(ResellerCreditService);
  });
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM wa_provider_configs WHERE org_id = ANY($1)`, [
      [a.orgId, b.orgId],
    ]);
    await h.owner.query(`DELETE FROM bsp_credit_allocations WHERE org_id = ANY($1)`, [
      [a.orgId, b.orgId],
    ]);
    await reseller(a.orgId, true);
    await reseller(b.orgId, false);
  });

  it('#2 with auto-attach off nothing is created', async () => {
    await saveSettings({ extendedCreditId: '4242', autoAttach: false });
    await waba(a.orgId, nextWaba());
    expect(await credit.autoAttachPending()).toBeNull();
    expect(
      await count(`SELECT count(*)::int AS n FROM bsp_credit_allocations WHERE org_id = $1`, [
        a.orgId,
      ]),
    ).toBe(0);
  });

  it('#1 with it on, a newly connected number of a reseller workspace gets an allocation, in the admin currency', async () => {
    await saveSettings({ extendedCreditId: '4242', autoAttach: true, autoAttachCurrency: 'EUR' });
    const w = nextWaba();
    await waba(a.orgId, w);
    const res = await credit.autoAttachPending();
    expect(res).toMatchObject({ attached: 1, failed: 0 });
    const r = await row(a.orgId, w);
    expect(r).toMatchObject({ status: 'attached', currency: 'EUR' });
    // the worker has no request: the actor is the system
    const audit = await h.owner.query(
      `SELECT actor_type FROM audit_log WHERE org_id = $1 AND module = 'bsp' AND record_id = $2`,
      [a.orgId, r!.id],
    );
    expect(audit.rows[0].actor_type).toBe('system');
  });

  it('#5 a number that is only pending is left alone; a workspace on direct billing is left alone', async () => {
    await saveSettings({ extendedCreditId: '4242', autoAttach: true });
    await waba(a.orgId, nextWaba(), { status: 'pending' });
    await waba(b.orgId, nextWaba());
    expect(await credit.autoAttachPending()).toBeNull();
    expect(h.graph.seen).toHaveLength(0);
  });

  it('#3 a number that was already tried (failed) is not retried: the sweep never hits Meta twice for it', async () => {
    await saveSettings({ extendedCreditId: '4242', autoAttach: true });
    const w = nextWaba();
    await waba(a.orgId, w);
    h.graph.respond = () => ({ status: 400, body: { error: { message: 'no' } } });
    expect(await credit.autoAttachPending()).toMatchObject({ attached: 0, failed: 1 });
    h.graph.reset();
    expect(await credit.autoAttachPending()).toBeNull();
    expect(h.graph.seen).toHaveLength(0);
    expect((await row(a.orgId, w))!.status).toBe('failed');
  });

  it('#4 a Meta that is down does not throw: the sweep records a failed row', async () => {
    await saveSettings({ extendedCreditId: '4242', autoAttach: true });
    const previous = h.source.transport;
    h.source.transport = { baseUrl: 'http://127.0.0.1:1' };
    try {
      const w = nextWaba();
      await waba(a.orgId, w);
      await expect(credit.autoAttachPending()).resolves.toMatchObject({ failed: 1 });
      expect((await row(a.orgId, w))!.last_error).toBe('Could not reach Meta.');
    } finally {
      h.source.transport = previous;
    }
  });

  it('does nothing until the connection is set up', async () => {
    await ops('put', '/settings').send({ ...SETTINGS, autoAttach: true });
    await waba(a.orgId, nextWaba());
    expect(await credit.autoAttachPending()).toBeNull();
  });
});

describe('revoke (TW-BSP-009)', () => {
  const attachedRow = async (orgId: number, over = '') => {
    const w = nextWaba();
    await h.owner.query(
      `INSERT INTO bsp_credit_allocations (org_id, waba_id, status, allocation_config_id, credit_source, currency, attached_at)
       VALUES ($1, $2, 'attached', $3, 'meta', 'USD', now())`,
      [orgId, w, over || `alloc-${w}`],
    );
    return w;
  };
  const uuidOfRow = async (orgId: number, w: string) => (await row(orgId, w))!.uuid as string;

  beforeEach(async () => {
    await saveSettings({ extendedCreditId: '4242' });
    await reseller(a.orgId, true);
  });

  it('#1 an attached allocation is revoked at Meta, the row becomes revoked with a date, and the response flags a reseller workspace', async () => {
    const w = await attachedRow(a.orgId);
    const res = await ops('post', `/allocations/${await uuidOfRow(a.orgId, w)}/revoke`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = revokeResultSchema.parse(res.body);
    expect(body.allocation).toMatchObject({ status: 'revoked', lastError: null });
    expect(body.allocation.revokedAt).not.toBeNull();
    expect(body.workspaceStillReseller).toBe(true);
    expect(h.graph.calls('DELETE', `/alloc-${w}`)).toHaveLength(1);
    expect(
      await count(
        `SELECT count(*)::int AS n FROM security_events WHERE subject_org_id = $1 AND event = 'platform.bsp.credit_revoked'`,
        [a.orgId],
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await h.api.events(a.orgId, 'bsp.credit_allocation.revoked')).map((e) => e.wabaId),
    ).toContain(w);
  });

  it('#2 a Meta error leaves the row attached with the message in last_error and answers 502', async () => {
    const w = await attachedRow(a.orgId);
    h.graph.respond = () => ({ status: 400, body: { error: { message: 'Allocation locked' } } });
    const res = await ops('post', `/allocations/${await uuidOfRow(a.orgId, w)}/revoke`).send({});
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('BSP_META_REJECTED');
    expect(res.body.detail ?? res.body.message ?? JSON.stringify(res.body)).toContain(
      'Allocation locked',
    );
    expect(await row(a.orgId, w)).toMatchObject({
      status: 'attached',
      last_error: 'Allocation locked',
    });
  });

  it('#3 an unknown id is 404', async () => {
    const res = await ops('post', '/allocations/00000000-0000-4000-8000-000000000001/revoke').send(
      {},
    );
    expect(res.status).toBe(404);
  });

  it('only an attached allocation can be revoked: a revoked or failed one is 409 and Meta is not called (Reference re-called it)', async () => {
    const w = await attachedRow(a.orgId);
    const id = await uuidOfRow(a.orgId, w);
    expect((await ops('post', `/allocations/${id}/revoke`).send({})).status).toBe(200);
    h.graph.reset();
    const again = await ops('post', `/allocations/${id}/revoke`).send({});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('BSP_ALLOCATION_NOT_ATTACHED');
    expect(h.graph.seen).toHaveLength(0);
  });

  it('an out-of-date rowVersion is 409 ROW_VERSION_CONFLICT and Meta is not called', async () => {
    const w = await attachedRow(a.orgId);
    const res = await ops('post', `/allocations/${await uuidOfRow(a.orgId, w)}/revoke`).send({
      rowVersion: 99,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ROW_VERSION_CONFLICT');
    expect(h.graph.seen).toHaveLength(0);
  });

  it('an allocation with no Meta id cannot be revoked: the error says so (TW-BSP-021 #2)', async () => {
    const w = nextWaba();
    await h.owner.query(
      `INSERT INTO bsp_credit_allocations (org_id, waba_id, status, credit_source) VALUES ($1, $2, 'attached', 'meta')`,
      [a.orgId, w],
    );
    const res = await ops('post', `/allocations/${await uuidOfRow(a.orgId, w)}/revoke`).send({});
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).toContain('No allocation id to revoke.');
    expect(h.graph.seen).toHaveLength(0);
  });

  it('a revoked row is reused when the pair is attached again', async () => {
    const w = await attachedRow(a.orgId);
    await waba(a.orgId, w);
    const id = await uuidOfRow(a.orgId, w);
    await ops('post', `/allocations/${id}/revoke`).send({});
    const again = await ops('post', '/allocations').send({
      workspaceId: await uuidOf(a.orgId),
      wabaId: w,
      currency: 'USD',
    });
    expect(again.body).toMatchObject({ id, status: 'attached', revokedAt: null });
    await h.owner.query(`DELETE FROM wa_provider_configs WHERE org_id = $1`, [a.orgId]);
  });
});

describe('the allocation register (TW-BSP-010)', () => {
  beforeAll(async () => {
    await h.owner.query(`DELETE FROM bsp_credit_allocations`);
  });
  afterAll(async () => {
    await h.owner.query(`DELETE FROM bsp_credit_allocations WHERE org_id = ANY($1)`, [
      [a.orgId, b.orgId],
    ]);
  });

  it('#1 60 rows: 50 newest first with a cursor, then the other 10, nothing repeated or lost', async () => {
    for (let i = 0; i < 60; i += 1) {
      await h.owner.query(
        `INSERT INTO bsp_credit_allocations (org_id, waba_id, status, created_at) VALUES ($1, $2, 'attached', now() - ($3 || ' seconds')::interval)`,
        [i % 2 === 0 ? a.orgId : b.orgId, `reg-${String(i).padStart(2, '0')}`, String(600 - i)],
      );
    }
    const p1 = bspAllocationListSchema.parse((await ops('get', '/allocations')).body);
    expect(p1.data).toHaveLength(50);
    expect(p1.page).toMatchObject({ hasMore: true, limit: 50 });
    expect(p1.data[0]!.wabaId).toBe('reg-59');
    expect(p1.data[49]!.wabaId).toBe('reg-10');
    const p2 = bspAllocationListSchema.parse(
      (await ops('get', `/allocations?cursor=${encodeURIComponent(p1.page.nextCursor!)}`)).body,
    );
    expect(p2.data.map((x) => x.wabaId)).toEqual(
      Array.from({ length: 10 }, (_, i) => `reg-${String(9 - i).padStart(2, '0')}`),
    );
    expect(p2.page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('shows the workspace name, the failed pill reason and the status filter', async () => {
    await h.owner.query(
      `INSERT INTO bsp_credit_allocations (org_id, waba_id, status, last_error) VALUES ($1, 'reg-failed', 'failed', 'Meta said no')`,
      [a.orgId],
    );
    const res = bspAllocationListSchema.parse(
      (await ops('get', '/allocations?status=failed&limit=5')).body,
    );
    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toMatchObject({
      wabaId: 'reg-failed',
      status: 'failed',
      lastError: 'Meta said no',
    });
    expect(res.data[0]!.workspaceName).toContain('Org bspa');
    expect(res.data[0]!.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(res)).not.toMatch(/"org_?id"/i);
  });

  it('the register is the operator pool only; limits and cursors are validated', async () => {
    expect((await ops('get', '/allocations?limit=500')).status).toBe(422);
    expect((await ops('get', '/allocations?cursor=garbage')).status).toBeGreaterThanOrEqual(400);
  });
});
