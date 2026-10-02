import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bspBillingModeResponseSchema,
  bspDashboardSchema,
  setBillingModeResponseSchema,
} from '@crm/contracts';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { BillingModeService, ResellerCostService } from '../../../src/modules/bsp-billing-engine';
import { bearer, newTenant, startBspHarness, type BspHarness, type Tenant } from './harness';

/**
 * The customer's billing choice, the contract the settle engine reads, and the reseller P&L, end to end (TW-BSP-011, -012, -014,
 * -015, -016). One app, one database; every block works in organizations of its own.
 */
let h: BspHarness;
let a: Tenant;
let b: Tenant;
let uniq = 0;
const nextWaba = () => `M${Date.now()}${uniq++}`;
const TOKEN = 'EAAG-system-user-token-0002';

const ops = (method: 'get' | 'post' | 'put', path: string) =>
  h.api.http()[method](`/v2/platform/bsp${path}`).set(bearer(h.superToken));
const mode = (token: string) => h.api.as(token);

const count = async (sql: string, params: unknown[]) =>
  Number((await h.owner.query(sql, params)).rows[0].n);

async function connectMeta(over: Record<string, unknown> = {}) {
  const res = await ops('put', '/settings').send({
    businessId: '5550002',
    extendedCreditId: '4242',
    ratesEndpoint: '',
    autoAttach: false,
    systemUserToken: TOKEN,
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function disconnectMeta() {
  await h.owner.query(
    `DELETE FROM platform_settings WHERE key IN ('bsp.reseller', 'bsp.system_user_token')`,
  );
  h.app.get(PlatformSettingsService).invalidate();
}

async function waba(orgId: number, wabaId: string, status = 'connected') {
  await h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, meta_json, phone_number) VALUES ($1, 'waba', $2, $3::jsonb, '+15550101')`,
    [orgId, status, JSON.stringify({ waba_id: wabaId })],
  );
}

async function flag(orgId: number): Promise<boolean | null> {
  const r = await h.owner.query(
    `SELECT bill_to_platform_credit AS f FROM workspace_settings WHERE org_id = $1`,
    [orgId],
  );
  return r.rows.length ? r.rows[0].f : null;
}

async function clean(orgId: number) {
  await h.owner.query(`DELETE FROM wa_provider_configs WHERE org_id = $1`, [orgId]);
  await h.owner.query(`DELETE FROM bsp_credit_allocations WHERE org_id = $1`, [orgId]);
  await h.owner.query(`DELETE FROM workspace_settings WHERE org_id = $1`, [orgId]);
}

beforeAll(async () => {
  h = await startBspHarness();
  a = await newTenant(h, 'bspmode');
  b = await newTenant(h, 'bspmodeb');
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('the customer chooses who bills them (TW-BSP-011)', () => {
  beforeEach(async () => {
    await clean(a.orgId);
    await disconnectMeta();
    h.graph.reset();
  });

  it('a workspace starts on direct billing, reseller billing not yet available, with its connected numbers listed', async () => {
    await waba(a.orgId, 'W-one');
    await waba(a.orgId, 'W-pending', 'pending');
    const res = await mode(a.admin).get('/v2/bsp/billing-mode');
    expect(res.status).toBe(200);
    const body = bspBillingModeResponseSchema.parse(res.body);
    expect(body.mode).toBe('meta_direct');
    expect(body.resellerAvailable).toBe(false);
    expect(body.accounts.map((x) => x.wabaId)).toEqual(['W-one']);
    expect(body.accounts[0]).toMatchObject({ allocationStatus: null, currency: null });
  });

  it('#2 choosing reseller before the credit line is set up is refused and the flag is unchanged', async () => {
    const res = await mode(a.admin).put('/v2/bsp/billing-mode').send({ mode: 'reseller' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BSP_RESELLER_UNAVAILABLE');
    expect(await flag(a.orgId)).toBeNull();
  });

  it('#5 a value that is not one of the two modes is rejected', async () => {
    expect((await mode(a.admin).put('/v2/bsp/billing-mode').send({ mode: 'foo' })).status).toBe(
      422,
    );
    expect((await mode(a.admin).put('/v2/bsp/billing-mode').send({})).status).toBe(422);
  });

  it('#1 reseller flips the workspace, attaches each connected number in the workspace currency, and reports how each went', async () => {
    await connectMeta();
    await h.owner.query(`INSERT INTO workspace_settings (org_id, currency) VALUES ($1, 'INR')`, [
      a.orgId,
    ]);
    const w1 = nextWaba();
    const w2 = nextWaba();
    await waba(a.orgId, w1);
    await waba(a.orgId, w2);
    h.graph.respond = (req) =>
      req.query.get('waba_id') === w2
        ? { status: 400, body: { error: { message: 'Already has a payment method' } } }
        : { status: 200, body: { allocation_config_id: `alloc-${req.query.get('waba_id')}` } };

    const res = await mode(a.admin).put('/v2/bsp/billing-mode').send({ mode: 'reseller' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = setBillingModeResponseSchema.parse(res.body);
    expect(body.mode).toBe('reseller');
    expect(body.attach).toEqual({ attached: 1, failed: 1, skipped: 0, remaining: 0 });
    // the flag changed although one attach failed (an explicit choice is not blocked by Meta), and the customer can see which failed
    expect(await flag(a.orgId)).toBe(true);
    const byWaba = Object.fromEntries(body.accounts.map((x) => [x.wabaId, x]));
    expect(byWaba[w1]).toMatchObject({ allocationStatus: 'attached', currency: 'INR' });
    expect(byWaba[w2]).toMatchObject({
      allocationStatus: 'failed',
      lastError: 'Already has a payment method',
    });
    expect(
      h.graph
        .calls('POST', '/whatsapp_credit_sharing_and_attach')
        .map((c) => c.query.get('waba_currency')),
    ).toEqual(['INR', 'INR']);
    // audit row and outbox event in the same transaction as the flag
    const audit = await h.owner.query(
      `SELECT actor_type, delta FROM audit_log WHERE org_id = $1 AND module = 'bsp' AND action = 'update' AND record_id = $1`,
      [a.orgId],
    );
    expect(audit.rows[0].actor_type).toBe('user');
    expect(audit.rows[0].delta.billingMode).toEqual({ old: 'meta_direct', new: 'reseller' });
    expect((await h.api.events(a.orgId, 'bsp.billing_mode.changed')).map((e) => e.mode)).toEqual([
      'reseller',
    ]);
  });

  it('#3 choosing it again is safe: attached numbers are not re-sent to Meta, a failed one is retried, no second audit row', async () => {
    await connectMeta();
    const w1 = nextWaba();
    const w2 = nextWaba();
    await waba(a.orgId, w1);
    await waba(a.orgId, w2);
    h.graph.respond = (req) =>
      req.query.get('waba_id') === w2
        ? { status: 400, body: { error: { message: 'busy' } } }
        : { status: 200, body: { allocation_config_id: `alloc-${req.query.get('waba_id')}` } };
    await mode(a.admin).put('/v2/bsp/billing-mode').send({ mode: 'reseller' });
    const modeAudits = () =>
      count(
        `SELECT count(*)::int AS n FROM audit_log WHERE org_id = $1 AND module = 'bsp' AND action = 'update' AND record_id = $1`,
        [a.orgId],
      );
    const auditsBefore = await modeAudits();
    h.graph.reset();
    const again = await mode(a.admin).put('/v2/bsp/billing-mode').send({ mode: 'reseller' });
    expect(again.body.attach).toEqual({ attached: 1, failed: 0, skipped: 1, remaining: 0 });
    expect(h.graph.calls('POST', '/whatsapp_credit_sharing_and_attach')).toHaveLength(1);
    expect(
      await count(`SELECT count(*)::int AS n FROM bsp_credit_allocations WHERE org_id = $1`, [
        a.orgId,
      ]),
    ).toBe(2);
    // the mode did not change, so neither the audit trail nor the outbox gets another entry
    expect(await modeAudits()).toBe(auditsBefore);
  });

  it('#3 switching back to direct billing only flips the flag: no Meta call, allocations unchanged', async () => {
    await connectMeta();
    const w = nextWaba();
    await waba(a.orgId, w);
    await mode(a.admin).put('/v2/bsp/billing-mode').send({ mode: 'reseller' });
    h.graph.reset();
    const res = await mode(a.admin).put('/v2/bsp/billing-mode').send({ mode: 'meta_direct' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('meta_direct');
    expect(res.body.attach).toBeUndefined();
    expect(await flag(a.orgId)).toBe(false);
    expect(h.graph.seen).toHaveLength(0);
    expect(res.body.accounts[0]).toMatchObject({ wabaId: w, allocationStatus: 'attached' });
  });

  it('#4 only a member who may manage billing can choose; a viewer reads; an operator token is not a workspace user', async () => {
    const nobody = await h.api.member(a, 'bspnone', []);
    const viewer = await h.api.member(a, 'bspview', [['bsp.billing.read']]);
    const manager = await h.api.member(a, 'bspmanage', [
      ['bsp.billing.read'],
      ['bsp.billing.manage'],
    ]);
    expect((await mode(nobody.token).get('/v2/bsp/billing-mode')).status).toBe(403);
    expect((await mode(viewer.token).get('/v2/bsp/billing-mode')).status).toBe(200);
    const denied = await mode(viewer.token)
      .put('/v2/bsp/billing-mode')
      .send({ mode: 'meta_direct' });
    expect(denied.status).toBe(403);
    expect(
      (await mode(manager.token).put('/v2/bsp/billing-mode').send({ mode: 'meta_direct' })).status,
    ).toBe(200);
    expect([401, 403]).toContain((await mode(h.superToken).get('/v2/bsp/billing-mode')).status);
  });

  it('one workspace never sees or changes another: the flag is per organization', async () => {
    await clean(b.orgId);
    await connectMeta();
    await mode(a.admin).put('/v2/bsp/billing-mode').send({ mode: 'reseller' });
    const other = await mode(b.admin).get('/v2/bsp/billing-mode');
    expect(other.body.mode).toBe('meta_direct');
    expect(await flag(b.orgId)).toBeNull();
  });
});

describe('the billing gate the settle engine reads (TW-BSP-012 rule 1)', () => {
  let db: DatabaseService;
  let modes: BillingModeService;
  const payPerMessage = (orgId: number) =>
    db.txAs({ orgId, userId: null }, (tx) => modes.isPayPerMessage(tx, orgId));

  beforeAll(() => {
    db = h.app.get(DatabaseService);
    modes = h.app.get(BillingModeService);
  });
  beforeEach(async () => {
    await clean(a.orgId);
    await h.owner.query(`DELETE FROM platform_settings WHERE key = 'billing.pay_per_message'`);
    h.app.get(PlatformSettingsService).invalidate();
  });

  it('a reseller workspace is wallet billed whatever the platform switch says', async () => {
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES ($1, true)`,
      [a.orgId],
    );
    expect(await payPerMessage(a.orgId)).toBe(true);
    await h.owner.query(`SELECT 1`);
    expect(
      await db.txAs({ orgId: a.orgId, userId: null }, (tx) => modes.billingKind(tx, a.orgId)),
    ).toBe('wallet');
  });

  it('a direct workspace is plan billed, and follows the platform pay-per-message switch', async () => {
    expect(await payPerMessage(a.orgId)).toBe(false);
    expect(
      await db.txAs({ orgId: a.orgId, userId: null }, (tx) => modes.billingKind(tx, a.orgId)),
    ).toBe('plan');
    await h.app.get(PlatformSettingsService).set('billing.pay_per_message', true, null);
    expect(await payPerMessage(a.orgId)).toBe(true);
  });

  it('the isolation holds: a tenant context only ever reads its own flag', async () => {
    await h.owner.query(
      `INSERT INTO workspace_settings (org_id, bill_to_platform_credit) VALUES ($1, true)`,
      [a.orgId],
    );
    await clean(b.orgId);
    expect(await payPerMessage(b.orgId)).toBe(false);
  });
});

describe('the Meta cost stamped on a charge (TW-BSP-016)', () => {
  it('#1 #4 reads the active rate rows when asked, so an edit applies at once', async () => {
    const db = h.app.get(DatabaseService);
    const cost = h.app.get(ResellerCostService);
    await h.owner.query(`DELETE FROM message_rates WHERE country_code = 'QQ'`);
    await h.owner.query(
      `INSERT INTO message_rates (country_code, category, credits, meta_cost_minor, currency) VALUES ('QQ', 'marketing', 100, 72, 'USD')`,
    );
    const lookup = () =>
      db.txAs({ orgId: a.orgId, userId: null }, (tx) => cost.lookup(tx, 'qq', 'Marketing'));
    expect(await lookup()).toEqual({ credits: 100, costMinor: '72' });
    await h.owner.query(`UPDATE message_rates SET meta_cost_minor = 80 WHERE country_code = 'QQ'`);
    expect((await lookup()).costMinor).toBe('80');
    // an inactive row is ignored
    await h.owner.query(`UPDATE message_rates SET is_active = false WHERE country_code = 'QQ'`);
    expect((await lookup()).costMinor).not.toBe('80');
  });
});

describe('the reseller P&L (TW-BSP-014, -015)', () => {
  const dash = (qs = '') => ops('get', `/dashboard${qs}`);
  const charge = (
    orgId: number,
    status: 'charged' | 'free' | 'refunded',
    revenue: number,
    cost: number | null,
    at: string,
  ) =>
    h.owner.query(
      `INSERT INTO usage_charges (org_id, wamid, status, revenue_minor, cost_minor, created_at) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      [orgId, `wamid-${Date.now()}-${uniq++}`, status, revenue, cost, at],
    );

  beforeAll(async () => {
    await h.owner.query(`DELETE FROM usage_charges`);
    await h.owner.query(`DELETE FROM wallets`);
  });
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM usage_charges`);
    await h.owner.query(`DELETE FROM wallets`);
    await h.owner.query(`DELETE FROM platform_settings WHERE key = 'bsp.reseller'`);
    h.app.get(PlatformSettingsService).invalidate();
  });

  it('#1 sums charged rows of the month: revenue 100.00, Meta cost 72.00, margin 28.00', async () => {
    await charge(a.orgId, 'charged', 6000, 4200, '2031-01-05T10:00:00Z');
    await charge(a.orgId, 'charged', 4000, 3000, '2031-01-20T10:00:00Z');
    const res = await dash('?month=2031-01');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = bspDashboardSchema.parse(res.body);
    expect(body).toMatchObject({
      month: '2031-01',
      currency: 'USD',
      from: '2031-01-01T00:00:00.000Z',
      to: '2031-02-01T00:00:00.000Z',
    });
    expect(body.totals).toMatchObject({
      billedMessages: 2,
      freeMessages: 0,
      revenue: '100.00',
      metaCost: '72.00',
      margin: '28.00',
      unpricedMessages: 0,
    });
  });

  it('#2 free and refunded messages never reach revenue, cost or the billed count', async () => {
    await charge(a.orgId, 'charged', 10000, 7200, '2031-02-05T10:00:00Z');
    await charge(a.orgId, 'refunded', 5000, 3000, '2031-02-06T10:00:00Z');
    await charge(a.orgId, 'free', 0, 100, '2031-02-07T10:00:00Z');
    const body = bspDashboardSchema.parse((await dash('?month=2031-02')).body);
    expect(body.totals).toMatchObject({
      billedMessages: 1,
      freeMessages: 1,
      revenue: '100.00',
      metaCost: '72.00',
      margin: '28.00',
    });
  });

  it('#3 billed messages without a Meta cost are counted as unpriced and margin counts them as pure revenue', async () => {
    for (let i = 0; i < 3; i += 1)
      await charge(b.orgId, 'charged', 100, null, `2031-03-0${i + 1}T10:00:00Z`);
    const body = bspDashboardSchema.parse((await dash('?month=2031-03')).body);
    expect(body.totals).toMatchObject({
      billedMessages: 3,
      unpricedMessages: 3,
      revenue: '3.00',
      metaCost: '0.00',
      margin: '3.00',
    });
    expect(body.workspaces[0]).toMatchObject({
      billedMessages: 3,
      revenue: '3.00',
      margin: '3.00',
    });
  });

  it('#4 a month with no billed messages shows zeros and no workspaces', async () => {
    const body = bspDashboardSchema.parse((await dash('?month=2035-06')).body);
    expect(body.totals).toMatchObject({
      billedMessages: 0,
      freeMessages: 0,
      revenue: '0.00',
      metaCost: '0.00',
      margin: '0.00',
      unpricedMessages: 0,
      walletFloat: '0.00',
    });
    expect(body.workspaces).toEqual([]);
    expect(body.hasMoreWorkspaces).toBe(false);
  });

  it('defaults to the current month and leaves out other months', async () => {
    await charge(a.orgId, 'charged', 2500, 1000, new Date().toISOString());
    await charge(a.orgId, 'charged', 9999, 1, '2031-05-01T00:00:00Z');
    const body = bspDashboardSchema.parse((await dash()).body);
    const now = new Date();
    expect(body.month).toBe(
      `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`,
    );
    expect(body.totals).toMatchObject({ billedMessages: 1, revenue: '25.00' });
    expect((await dash('?month=2031-13')).status).toBe(422);
  });

  it('the window is half open: the first instant of the next month belongs to the next month', async () => {
    await charge(a.orgId, 'charged', 100, 10, '2031-06-30T23:59:59Z');
    await charge(a.orgId, 'charged', 700, 70, '2031-07-01T00:00:00Z');
    expect(bspDashboardSchema.parse((await dash('?month=2031-06')).body).totals.revenue).toBe(
      '1.00',
    );
    expect(bspDashboardSchema.parse((await dash('?month=2031-07')).body).totals.revenue).toBe(
      '7.00',
    );
  });

  it('#1 #2 per workspace: top spender first, with the workspace wallet balance; only workspaces with billed messages', async () => {
    await charge(a.orgId, 'charged', 500, 300, '2031-08-02T10:00:00Z');
    await charge(b.orgId, 'charged', 900, 400, '2031-08-02T10:00:00Z');
    const third = await newTenant(h, 'bspmodec');
    await charge(third.orgId, 'refunded', 99999, 1, '2031-08-02T10:00:00Z');
    await h.owner.query(
      `INSERT INTO wallets (org_id, unit, balance) VALUES ($1, 'USD', 12.5), ($2, 'USD', 7.5), ($1, 'credits', 99)`,
      [a.orgId, b.orgId],
    );
    const body = bspDashboardSchema.parse((await dash('?month=2031-08')).body);
    expect(body.workspaces.map((w) => w.revenue)).toEqual(['9.00', '5.00']);
    expect(body.workspaces[0]).toMatchObject({
      metaCost: '4.00',
      margin: '5.00',
      walletBalance: '7.50',
    });
    expect(body.workspaces[1]).toMatchObject({
      metaCost: '3.00',
      margin: '2.00',
      walletBalance: '12.50',
    });
    expect(body.workspaces.map((w) => w.workspaceName).join(' ')).not.toContain(third.slug);
    // the float is the money held in the base currency across every workspace; the credits wallet is another unit
    expect(body.totals.walletFloat).toBe('20.00');
  });

  it('#3 more workspaces than the limit: only the top ones, and the response says there are more', async () => {
    await charge(a.orgId, 'charged', 500, 300, '2031-09-02T10:00:00Z');
    await charge(b.orgId, 'charged', 900, 400, '2031-09-02T10:00:00Z');
    const body = bspDashboardSchema.parse((await dash('?month=2031-09&limit=1')).body);
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]!.revenue).toBe('9.00');
    expect(body.hasMoreWorkspaces).toBe(true);
    // the totals still cover everyone
    expect(body.totals.revenue).toBe('14.00');
  });

  it('a base currency with no minor unit is shown without decimals (Reference always divided by 100)', async () => {
    await h.owner.query(`DELETE FROM currencies WHERE code = 'JPY'`);
    await h.owner.query(
      `INSERT INTO currencies (name, code, symbol, precision) VALUES ('Yen', 'JPY', 'Y', 0)`,
    );
    try {
      await connectMeta({ baseCurrency: 'JPY' });
      await charge(a.orgId, 'charged', 10000, 7200, '2031-10-02T10:00:00Z');
      const body = bspDashboardSchema.parse((await dash('?month=2031-10')).body);
      expect(body.currency).toBe('JPY');
      expect(body.totals).toMatchObject({ revenue: '10000', metaCost: '7200', margin: '2800' });
    } finally {
      await h.owner.query(`DELETE FROM currencies WHERE code = 'JPY'`);
    }
  });

  it('the figures are the same for every operator and no internal id leaves the system', async () => {
    await charge(a.orgId, 'charged', 100, 10, '2031-11-02T10:00:00Z');
    const asSupport = await h.api
      .http()
      .get('/v2/platform/bsp/dashboard?month=2031-11')
      .set(bearer(h.supportToken));
    const asSuper = await dash('?month=2031-11');
    expect(asSupport.status).toBe(200);
    expect(asSupport.body).toEqual(asSuper.body);
    expect(JSON.stringify(asSuper.body)).not.toMatch(/org_id|"id":\s*\d/);
  });

  it('a workspace user cannot read the platform P&L', async () => {
    const res = await h.api.http().get('/v2/platform/bsp/dashboard').set(bearer(a.admin));
    expect([401, 403]).toContain(res.status);
  });
});
