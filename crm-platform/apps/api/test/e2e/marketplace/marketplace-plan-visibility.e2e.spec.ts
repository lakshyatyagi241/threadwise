import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  billingPlansResponseSchema,
  billingUsagePanelResponseSchema,
  marketAppDetailSchema,
  marketAppListSchema,
  planAddonOptionsResponseSchema,
  planAdminItemSchema,
  workspacePlanSchema,
  type MarketAppDetail,
} from '@crm/contracts';
import {
  Api,
  bearer,
  code,
  marketApi,
  miniManifest,
  operatorLogin,
  platformApi,
  publishListing,
  startHarness,
  superOperator,
  type Harness,
  type Tenant,
} from './support';
import { OPERATOR_EMAIL } from '../auth-registration-security/harness';

/**
 * A plan makes paid Marketplace add-ons VISIBLE to the workspaces on it; a workspace USES one only once it holds it. Through HTTP against
 * a real Postgres (row-level security forced) and the real AppModule: the operator's plan form, the workspace's marketplace, install,
 * subscribe, checkout, the in-app plan payloads and the operator's workspace screen.
 */
let h: Harness;
let api: Api;
let superToken = '';
let reviewerToken = '';
let supportToken = '';
let S: Tenant; // on the starter plan: sees what starter enables
let P: Tenant; // on the pro plan
let G: Tenant; // on a plan that is not in the catalogue (nothing is locked)
let O: Tenant; // platform-owned
let starter: string; // plan uuids
let pro: string;
const http = () => request(h.app.getHttpServer());
const ops = () => platformApi(h, superToken);
const mp = (t: Tenant) => marketApi(h, t.admin);
const tokens = () => ({ manage: superToken, review: reviewerToken });
const plans = (token = superToken) => ({
  get: (p: string) => http().get(`/v2/platform/plans${p}`).set(bearer(token)),
  post: (p: string, body: unknown) =>
    http()
      .post(`/v2/platform/plans${p}`)
      .set(bearer(token))
      .send(body as object),
  patch: (p: string, body: unknown) =>
    http()
      .patch(`/v2/platform/plans${p}`)
      .set(bearer(token))
      .send(body as object),
  delete: (p: string) => http().delete(`/v2/platform/plans${p}`).set(bearer(token)),
});
const one = async <T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T> =>
  (await h.owner.query(q, params)).rows[0] as T;

const packUuid = async (slug: string) =>
  (
    await one<{ uuid: string }>(
      `SELECT p.uuid FROM plans p JOIN marketplace_apps a ON a.id = p.marketplace_app_id WHERE a.slug = $1`,
      [slug],
    )
  ).uuid;
const price = async (slug: string, amount = '9') => {
  const rv = (
    await one<{ row_version: number }>(`SELECT row_version FROM marketplace_apps WHERE slug = $1`, [
      slug,
    ])
  ).row_version;
  const res = await ops().put(`/apps/${slug}/pricing`, {
    rowVersion: rv,
    model: 'paid_monthly',
    amount,
    currency: 'USD',
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const listSlugs = async (t: Tenant, q = '') => {
  const res = await mp(t).get(`/apps?limit=100${q}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return marketAppListSchema.parse(res.body).data.map((a) => a.slug);
};
const detail = async (t: Tenant, slug: string): Promise<MarketAppDetail> => {
  const res = await mp(t).get(`/apps/${slug}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return marketAppDetailSchema.parse(res.body);
};
const install = (t: Tenant, slug: string) =>
  mp(t).post(`/apps/${slug}/install`, { acceptedScopes: ['contacts.read'] });
const setVisible = async (planId: string, visibleAddons: string[]) => {
  const res = await plans().patch(`/${planId}`, { visibleAddons });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return planAdminItemSchema.parse(res.body);
};
const orgUuid = async (t: Tenant) =>
  (await one<{ uuid: string }>(`SELECT uuid FROM organizations WHERE id = $1`, [t.orgId])).uuid;
const wsPlan = async (t: Tenant) => {
  const res = await http()
    .get(`/v2/platform/workspace-plans/${await orgUuid(t)}`)
    .set(bearer(superToken));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return workspacePlanSchema.parse(res.body);
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  superToken = await superOperator(h);
  supportToken = await operatorLogin(h, 'support@platform.test');
  const role = await http()
    .post('/v2/platform/roles')
    .set(bearer(superToken))
    .send({ name: 'Market reviewer', permissions: ['platform.market.review'] });
  expect(role.status, JSON.stringify(role.body)).toBe(201);
  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role)
     SELECT 'reviewer@platform.test', 'Reviewer', password_hash, 'auditor' FROM platform_operators WHERE email = $1`,
    [OPERATOR_EMAIL],
  );
  const staff = await http().get('/v2/platform/staff').set(bearer(superToken));
  const rvStaff = (staff.body.data as Array<{ id: string; email: string }>).find(
    (s) => s.email === 'reviewer@platform.test',
  )!;
  expect(
    (
      await http()
        .put(`/v2/platform/staff/${rvStaff.id}/roles`)
        .set(bearer(superToken))
        .send({ roleIds: [role.body.id] })
    ).status,
  ).toBe(200);
  reviewerToken = await operatorLogin(h, 'reviewer@platform.test');

  S = await api.signup('visS');
  P = await api.signup('visP');
  G = await api.signup('visG');
  O = await api.signup('visO');

  const mk = async (body: Record<string, unknown>) => {
    const res = await plans().post('', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as { id: string; slug: string };
  };
  starter = (
    await mk({
      name: 'Starter',
      slug: 'vis_starter',
      isFree: true,
      features: { marketplace: true },
    })
  ).id;
  pro = (await mk({ name: 'Pro', slug: 'vis_pro', amount: '49', features: { marketplace: true } }))
    .id;
  await h.owner.query(`UPDATE organizations SET plan = 'vis_starter' WHERE id = $1`, [S.orgId]);
  await h.owner.query(`UPDATE organizations SET plan = 'vis_pro' WHERE id = $1`, [P.orgId]);
  await h.owner.query(`UPDATE organizations SET plan = 'vis_ghost' WHERE id = $1`, [G.orgId]);
  await h.owner.query(`UPDATE organizations SET plan = 'vis_starter' WHERE id = $1`, [O.orgId]);
  await h.owner.query(
    `INSERT INTO org_plan_state (org_id, platform_owned) VALUES ($1, true) ON CONFLICT (org_id) DO UPDATE SET platform_owned = true`,
    [O.orgId],
  );
  await h.owner.query(
    `INSERT INTO org_plan_state (org_id, plan_ends_at) VALUES ($1, now() + interval '60 days') ON CONFLICT (org_id) DO UPDATE SET plan_ends_at = now() + interval '60 days'`,
    [P.orgId],
  );

  await publishListing(h, tokens(), {
    manifest: miniManifest({ id: 'vis-free', name: 'Vis Free', scopes: ['contacts.read'] }),
  });
  for (const [id, name] of [
    ['vis-alpha', 'Vis Alpha'],
    ['vis-beta', 'Vis Beta'],
  ] as const) {
    await publishListing(h, tokens(), {
      manifest: miniManifest({ id, name, scopes: ['contacts.read'] }),
    });
    await price(id);
  }
}, 600_000);

afterAll(async () => {
  await h?.stop();
});

describe('an app no plan enables does not exist for the workspace', () => {
  it('browse and search omit it; free apps stay', async () => {
    for (const t of [S, P]) {
      const all = await listSlugs(t);
      expect(all).toContain('vis-free');
      expect(all).not.toContain('vis-alpha');
      expect(all).not.toContain('vis-beta');
      expect(await listSlugs(t, '&q=Vis%20Alpha')).toEqual([]);
    }
  });

  it('its page, install and subscribe answer not found; checkout refuses it', async () => {
    for (const ref of ['vis-alpha']) {
      const page = await mp(S).get(`/apps/${ref}`);
      expect(page.status).toBe(404);
      expect(code(page)).toBe('MKT_APP_NOT_FOUND');
      const inst = await install(S, ref);
      expect(inst.status).toBe(404);
      expect(code(inst)).toBe('MKT_APP_NOT_FOUND');
      const sub = await mp(S).post(`/apps/${ref}/subscribe`, {});
      expect(sub.status).toBe(404);
    }
    const q = await http()
      .get(
        `/v2/billing/checkout/plans/${(await one<{ slug: string }>(`SELECT slug FROM plans WHERE marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'vis-alpha')`)).slug}/quote`,
      )
      .set(bearer(S.admin));
    expect(q.status).toBe(422);
    expect(code(q)).toBe('PAYGW_PLAN_NOT_PURCHASABLE');
  });

  it('a workspace with no plan row, and a platform-owned one, see everything (nothing is locked)', async () => {
    for (const t of [G, O]) {
      expect(await listSlugs(t)).toEqual(expect.arrayContaining(['vis-alpha', 'vis-beta']));
      // nothing is locked for them, so the app is theirs to use as well as to see
      expect((await detail(t, 'vis-alpha')).pricing.access).toBe('entitled');
    }
  });
});

describe('the operator enables an add-on on a plan', () => {
  it('lists the selectable packs for the plan form', async () => {
    const res = await plans().get('/addon-options');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const opts = planAddonOptionsResponseSchema.parse(res.body).data;
    expect(opts.map((o) => o.app.slug).sort()).toEqual(['vis-alpha', 'vis-beta']);
    expect(opts[0]).toMatchObject({
      amount: '9.00',
      currency: 'USD',
      billingUnit: 'months',
      billingDuration: 1,
      isActive: true,
      app: { status: 'published' },
    });
    // every operator role may read the form's data; a workspace token may not
    expect((await plans(supportToken).get('/addon-options')).status).toBe(200);
    expect(
      (await http().get('/v2/platform/plans/addon-options').set(bearer(S.admin))).status,
    ).toBeGreaterThanOrEqual(401);
  });

  it('only a super admin writes; support is refused', async () => {
    const alpha = await packUuid('vis-alpha');
    const res = await plans(supportToken).patch(`/${starter}`, { visibleAddons: [alpha] });
    expect(res.status).toBe(403);
  });

  it('refuses ids that are not a Marketplace add-on pack, naming them, and saves nothing', async () => {
    const before = planAdminItemSchema.parse((await plans().get(`/${starter}`)).body);
    const bad = await plans().patch(`/${starter}`, { name: 'Renamed', visibleAddons: [pro] });
    expect(bad.status).toBe(422);
    expect((bad.body.errors as Array<{ path: string; message: string }>)[0]).toEqual({
      path: 'visibleAddons',
      message: `unknown_addon:${pro}`,
    });
    const stray = await plans().patch(`/${starter}`, {
      visibleAddons: ['3f2c1a9e-5b1d-4c7a-8e21-0a1b2c3d4e5f'],
    });
    expect(stray.status).toBe(422);
    expect((await plans().patch(`/${starter}`, { visibleAddons: ['mkt_nope'] })).status).toBe(422);
    const after = planAdminItemSchema.parse((await plans().get(`/${starter}`)).body);
    // atomic: the rename that came with the bad list did not happen
    expect(after.name).toBe(before.name);
    expect(after.visibleAddons).toEqual([]);
  });

  it('visible, not purchased: shown with its price, can subscribe, cannot install or use', async () => {
    const alpha = await packUuid('vis-alpha');
    const saved = await setVisible(starter, [alpha]);
    expect(saved.visibleAddons).toEqual([alpha]);
    expect(
      (await plans().get('')).body.data.find((p: { id: string }) => p.id === starter).visibleAddons,
    ).toEqual([alpha]);

    expect(await listSlugs(S)).toContain('vis-alpha');
    expect(await listSlugs(S)).not.toContain('vis-beta');
    expect(await listSlugs(P)).not.toContain('vis-alpha'); // pro was not given it
    const d = await detail(S, 'vis-alpha');
    expect(d.pricing).toMatchObject({
      access: 'subscription_required',
      availability: 'visible',
      amount: '9.00',
      currency: 'USD',
    });
    expect(d.pricing.checkoutPath).toMatch(/^\/billing\/checkout\/mkt_/);
    const blocked = await install(S, 'vis-alpha');
    expect(blocked.status).toBe(422);
    expect(code(blocked)).toBe('MKT_SUBSCRIPTION_REQUIRED');
    const sub = await mp(S).post('/apps/vis-alpha/subscribe', {});
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(sub.body.outcome).toBe('checkout');
    // the add-on's feature key was never granted by a plan showing it
    expect(
      await one(`SELECT 1 FROM workspace_addons WHERE org_id = $1`, [S.orgId]),
    ).toBeUndefined();
  });

  it('writes an audit event with the change, and the plan row version moves', async () => {
    const alpha = await packUuid('vis-alpha');
    const beta = await packUuid('vis-beta');
    const before = await one<{ row_version: number }>(
      `SELECT row_version FROM plans WHERE uuid = $1`,
      [starter],
    );
    await setVisible(starter, [alpha, beta]);
    const ev = await one<{
      payload: { changes: Record<string, { from: string[]; to: string[] }> };
    }>(
      `SELECT payload FROM security_events WHERE event = 'platform.plan.updated' ORDER BY id DESC LIMIT 1`,
    );
    expect(ev.payload.changes.visibleAddons!.from).toEqual([alpha]);
    expect(ev.payload.changes.visibleAddons!.to.sort()).toEqual([alpha, beta].sort());
    const after = await one<{ row_version: number }>(
      `SELECT row_version FROM plans WHERE uuid = $1`,
      [starter],
    );
    expect(after.row_version).toBeGreaterThan(before.row_version);
    await setVisible(starter, [alpha]);
  });
});

describe('purchased: usable, and a downgrade never takes it away', () => {
  it('a purchase (here an operator comp, the same add-on purchase row) makes it entitled and installable', async () => {
    const comp = await ops().post('/apps/vis-alpha/subscriptions/comp', {
      workspaceId: await orgUuid(S),
      months: 3,
      note: 'visibility test',
    });
    expect(comp.status, JSON.stringify(comp.body)).toBe(200);
    const d = await detail(S, 'vis-alpha');
    expect(d.pricing).toMatchObject({ access: 'entitled', availability: 'purchased' });
    const ok = await install(S, 'vis-alpha');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('the plan stops showing it: the workspace keeps seeing it, keeps it installed and active', async () => {
    await setVisible(starter, []);
    expect(await listSlugs(S)).toContain('vis-alpha');
    expect(await listSlugs(S, '&installed=true')).toContain('vis-alpha');
    const d = await detail(S, 'vis-alpha');
    expect(d.pricing).toMatchObject({ access: 'entitled', availability: 'purchased' });
    const inst = await one<{ status: string }>(
      `SELECT i.status FROM workspace_app_installations i JOIN marketplace_apps a ON a.id = i.app_id WHERE i.org_id = $1 AND a.slug = 'vis-alpha'`,
      [S.orgId],
    );
    expect(inst.status).toBe('active');
    // someone else on the same plan sees nothing of it
    expect(await listSlugs(P)).not.toContain('vis-alpha');
    // the operator's view says it is owned but no longer shown by the plan
    const ws = await wsPlan(S);
    expect(ws.addons.owned).toEqual([
      expect.objectContaining({
        app: expect.objectContaining({ slug: 'vis-alpha' }),
        visibleOnPlan: false,
      }),
    ]);
    expect(ws.addons.visible).toEqual([]);
  });
});

describe('the in-app plan payloads and the operator screen', () => {
  it('billing plans and usage list the add-ons available on the current plan, owned or not', async () => {
    const alpha = await packUuid('vis-alpha');
    const beta = await packUuid('vis-beta');
    await setVisible(starter, [alpha, beta]);
    const plansRes = await http().get('/v2/billing/plans').set(bearer(S.admin));
    expect(plansRes.status, JSON.stringify(plansRes.body)).toBe(200);
    const bp = billingPlansResponseSchema.parse(plansRes.body);
    expect(bp.visibleAddons.map((a) => [a.app.slug, a.owned])).toEqual([
      ['vis-alpha', true],
      ['vis-beta', false],
    ]);
    expect(bp.visibleAddons[1]).toMatchObject({
      packSlug: expect.stringMatching(/^mkt_/),
      price: { amount: '9.00', currency: 'USD', period: { unit: 'months', count: 1 } },
    });
    // the compare table: each plan lists what it shows
    expect(bp.data.find((p) => p.slug === 'vis_starter')!.visibleAddons).toHaveLength(2);
    expect(bp.data.find((p) => p.slug === 'vis_pro')!.visibleAddons).toEqual([]);
    const usage = await http().get('/v2/billing/usage').set(bearer(S.admin));
    expect(billingUsagePanelResponseSchema.parse(usage.body).visibleAddons).toHaveLength(2);
    // another workspace sees its own plan's set, not this one's
    const other = billingPlansResponseSchema.parse(
      (await http().get('/v2/billing/plans').set(bearer(P.admin))).body,
    );
    expect(other.visibleAddons).toEqual([]);
  });

  it('the operator sees what a workspace owns against what its plan shows', async () => {
    const ws = await wsPlan(S);
    expect(ws.addons.visible.map((a) => [a.app.slug, a.owned])).toEqual([
      ['vis-alpha', true],
      ['vis-beta', false],
    ]);
    expect(ws.addons.owned.map((a) => [a.app.slug, a.visibleOnPlan])).toEqual([
      ['vis-alpha', true],
    ]);
    const list = await http().get('/v2/platform/workspace-plans?limit=50').set(bearer(superToken));
    expect(list.status).toBe(200);
    expect(list.body.data.every((w: { addons?: unknown }) => w.addons !== undefined)).toBe(true);
  });
});

describe('a plan save carries the rest of the plan with it', () => {
  it('keeps the stored feature and limit keys the registry does not know', async () => {
    await h.owner.query(
      `UPDATE plans SET features = features || '{"module_flag": true}'::jsonb, limits = limits || '{"module_cap": 7}'::jsonb WHERE uuid = $1`,
      [pro],
    );
    const res = await plans().patch(`/${pro}`, {
      name: 'Pro plus',
      features: { analytics: true },
      limits: { contacts: 5000 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await one<{ features: Record<string, unknown>; limits: Record<string, unknown> }>(
      `SELECT features, limits FROM plans WHERE uuid = $1`,
      [pro],
    );
    expect(row.features).toMatchObject({ module_flag: true, analytics: true });
    expect(row.limits).toMatchObject({ module_cap: 7, contacts: 5000 });
  });

  it('create persists visibleAddons atomically; a bad id creates no plan; delete removes the rows', async () => {
    const beta = await packUuid('vis-beta');
    const made = await plans().post('', {
      name: 'Copy of Pro',
      amount: '49',
      visibleAddons: [beta],
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(planAdminItemSchema.parse(made.body).visibleAddons).toEqual([beta]);
    const n = async () =>
      Number((await one<{ n: string }>(`SELECT count(*) AS n FROM plans WHERE kind = 'plan'`)).n);
    const count = await n();
    const bad = await plans().post('', { name: 'Broken', amount: '9', visibleAddons: [pro] });
    expect(bad.status).toBe(422);
    expect(await n()).toBe(count);
    expect(await one(`SELECT 1 FROM plans WHERE name = 'Broken'`)).toBeUndefined();
    const del = await plans().delete(`/${made.body.id}`);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(
      Number(
        (
          await one<{ n: string }>(
            `SELECT count(*) AS n FROM plan_visible_addons WHERE plan_id NOT IN (SELECT id FROM plans)`,
          )
        ).n,
      ),
    ).toBe(0);
  });
});
