import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LeadScoringService } from '../../../src/modules/lead-scoring';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { Api, code, marketApi, platformApi, startHarness, superOperator } from './support';
import type { Harness, Tenant } from './support';

/**
 * AI lead scoring as a Marketplace app that is gated by install (migration 20261228090000_mkt_lead_scoring_app.sql), end to end on a real
 * Postgres with forced row-level security and the real AppModule:
 *   (a) a new workspace is locked (422 PLAN_FEATURE_LOCKED) until the app is bought AND installed, and unlocked after;
 *   (b) a workspace that already used scoring keeps it, untouched, when the migration runs (the owner's critical constraint);
 *   the plan side of the growth pilot, which is built on scoring.
 */
let h: Harness;
let api: Api;
let token = '';
let N: Tenant; // a new workspace: never used scoring
let B: Tenant; // already had the AI lead scoring switch on
let C: Tenant; // only a scoring run in its log
let D: Tenant; // only a growth pilot row
let E: Tenant; // used scoring, but an operator had set its override for the feature to false
let F: Tenant; // used scoring and has other overrides that must survive
let G: Tenant; // switched scoring on and automatic scoring on, but has no app: background work must not run

const MIGRATION = readFileSync(
  resolve(
    __dirname,
    '../../../../../packages/db/migrations/20261228090000_mkt_lead_scoring_app.sql',
  ),
  'utf8',
);

const one = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  (await h.owner.query(query, params)).rows[0] as T;
const n = async (query: string, params: unknown[] = []): Promise<number> =>
  Number((await one<{ n: string }>(query, params)).n);
const on = (t: Tenant) => h.app.get(PlanEntitlementService).featureEnabled(t.orgId, 'lead_scoring');
const overrides = async (t: Tenant) =>
  (
    await one<{ overrides: unknown }>(`SELECT overrides FROM org_plan_state WHERE org_id = $1`, [
      t.orgId,
    ])
  ).overrides;
const settings = (t: Tenant) => api.as(t.admin).get('/v2/lead-scoring/settings');
const mp = (t: Tenant) => marketApi(h, t.admin);

/** The operator's "show this app on this plan" (the plan decides which paid apps a workspace on it can see), done directly with the privileged write the console performs. */
const showOn = async (planSlug: string, appSlug: string) => {
  await h.owner.query(
    `BEGIN;
     SELECT set_config('app.privileged', 'on', true);
     INSERT INTO plan_visible_addons (plan_id, addon_plan_id)
       SELECT p.id, ap.id FROM plans p, plans ap, marketplace_apps a
       WHERE p.slug = '${planSlug}' AND p.kind = 'plan' AND a.slug = '${appSlug}' AND ap.marketplace_app_id = a.id
       ON CONFLICT DO NOTHING;
     COMMIT;`,
  );
};

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  token = await superOperator(h);
  await h.owner.query(
    `INSERT INTO plans (slug, kind, name, amount, currency, sort_order, is_free) VALUES ('freebie', 'plan', 'Freebie', 0, 'USD', 1, true)`,
  );
  [N, B, C, D, E, F, G] = await Promise.all(
    ['lscN', 'lscB', 'lscC', 'lscD', 'lscE', 'lscF', 'lscG'].map((l) => api.signup(l)),
  );
  await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = ANY($1::bigint[])`, [
    [N, B, C, D, E, F, G].map((t) => t.orgId),
  ]);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('the seeded listing', () => {
  it('is a draft first-party mini app, paid with no price, granting the new plan feature, marked to comp existing users', async () => {
    const row = await one<{
      kind: string;
      status: string;
      first_party: boolean;
      pricing_model: string;
      price_amount: string | null;
      grants_plan_features: string[];
      grandfather_existing: boolean;
      purchasable: boolean;
    }>(`SELECT * FROM marketplace_apps WHERE slug = 'lead-scoring'`);
    expect(row).toMatchObject({
      kind: 'mini_app',
      status: 'draft',
      first_party: true,
      pricing_model: 'paid_monthly',
      price_amount: null,
      grants_plan_features: ['lead_scoring'],
      grandfather_existing: true,
    });
    // no plan includes it, explicitly
    expect(
      await n(
        `SELECT count(*) AS n FROM plans WHERE kind = 'plan' AND NOT (features ? 'lead_scoring')`,
      ),
    ).toBe(
      1, // the 'freebie' plan this spec added afterwards; every plan that existed at migration time got the flag
    );
    expect(
      await n(
        `SELECT count(*) AS n FROM plans WHERE kind = 'plan' AND features->>'lead_scoring' = 'true'`,
      ),
    ).toBe(0);
  });

  it('puts the app and the plan feature on every scoring permission key, so the Roles editor says "install the app"', async () => {
    const keys = (
      await h.owner.query(
        `SELECT key, plan_feature, app_slug FROM permission_defs WHERE key LIKE 'lsc.%' ORDER BY key`,
      )
    ).rows as Array<{ key: string; plan_feature: string | null; app_slug: string | null }>;
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const k of keys)
      expect(k, k.key).toMatchObject({ plan_feature: 'lead_scoring', app_slug: 'lead-scoring' });
    const roles = await api.as(N.admin).get('/v2/permissions?includeLocked=1');
    expect(roles.status).toBe(200);
    const read = (
      roles.body.data as Array<{ key: string; lock?: { kind: string; key?: string } }>
    ).find((p) => p.key === 'lsc.runs.read')!;
    expect(read.lock).toEqual({ kind: 'plan_feature', key: 'lead_scoring' });
  });
});

describe('(a) a new workspace is locked until it has bought and installed the app', () => {
  it('is refused on every scoring route with 422 PLAN_FEATURE_LOCKED, reads included', async () => {
    expect(await on(N)).toBe(false);
    for (const res of [
      await settings(N),
      await api.as(N.admin).get('/v2/lead-scoring/runs'),
      await api.as(N.admin).get('/v2/lead-scoring/suggestions'),
      await api.as(N.admin).patch('/v2/lead-scoring/settings').send({ enabled: true }),
      await api.as(N.admin).post('/v2/lead-scoring/backfill').send({ limit: 10 }),
    ]) {
      expect(res.status, JSON.stringify(res.body)).toBe(422);
      expect(code(res)).toBe('PLAN_FEATURE_LOCKED');
      expect(JSON.stringify(res.body)).toContain('feature_disabled');
    }
    const ent = await api.as(N.admin).get('/v2/billing/entitlements');
    expect(ent.body.features).not.toContain('lead_scoring');
  });

  it('the growth pilot, built on scoring, is not available to it either', async () => {
    const res = await api.as(N.admin).get('/v2/growth/settings');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.available).toBe(false);
  });

  it('the listing is invisible until the operator prices and publishes it', async () => {
    expect((await mp(N).get('/apps/lead-scoring')).status).toBe(404);
  });

  it('after the operator prices and publishes it, a subscription is required to install', async () => {
    const ops = platformApi(h, token);
    const app = await ops.get('/apps/lead-scoring');
    expect(app.status, JSON.stringify(app.body)).toBe(200);
    const priced = await ops.put('/apps/lead-scoring/pricing', {
      rowVersion: app.body.rowVersion,
      model: 'paid_monthly',
      amount: '999',
      currency: 'INR',
      grantsPlanFeatures: ['lead_scoring'],
      grandfatherExisting: true,
    });
    expect(priced.status, JSON.stringify(priced.body)).toBe(200);
    const versionId = (app.body.versions as Array<{ id: string }>)[0]!.id;
    expect((await ops.post(`/apps/lead-scoring/versions/${versionId}/approve`, {})).status).toBe(
      200,
    );
    const published = await ops.post('/apps/lead-scoring/publish', {});
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    // a paid app is shown only to workspaces on a plan that makes it visible
    expect((await mp(N).get('/apps/lead-scoring')).status).toBe(404);
    await showOn('freebie', 'lead-scoring');

    const detail = await mp(N).get('/apps/lead-scoring');
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(detail.body.pricing.access).toBe('subscription_required');
    const refused = await mp(N).post('/apps/lead-scoring/install', {
      acceptedScopes: ['contacts.read', 'contacts.write'],
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await on(N)).toBe(false);
  });

  it('a subscription alone is not enough: still locked, now told to install the app', async () => {
    const org = await one<{ uuid: string }>(`SELECT uuid FROM organizations WHERE id = $1`, [
      N.orgId,
    ]);
    const comp = await platformApi(h, token).post('/apps/lead-scoring/subscriptions/comp', {
      workspaceId: org.uuid,
      months: null,
      note: 'Bought for the test',
    });
    expect(comp.status, JSON.stringify(comp.body)).toBe(200);
    expect(await on(N)).toBe(false);
    const res = await settings(N);
    expect(res.status).toBe(422);
    expect(code(res)).toBe('PLAN_FEATURE_LOCKED');
    expect(JSON.stringify(res.body)).toContain('app_not_installed');
    expect(JSON.stringify(res.body)).toContain('/marketplace/app/lead-scoring');
  });

  it('installed: unlocked everywhere, and locked again when the app is uninstalled', async () => {
    const install = await mp(N).post('/apps/lead-scoring/install', {
      acceptedScopes: ['contacts.read', 'contacts.write'],
    });
    expect(install.status, JSON.stringify(install.body)).toBe(201);
    expect(await on(N)).toBe(true);
    const ok = await settings(N);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await api.as(N.admin).get('/v2/billing/entitlements')).body.features).toContain(
      'lead_scoring',
    );
    expect(
      (
        (await api.as(N.admin).get('/v2/permissions?includeLocked=1')).body.data as Array<{
          key: string;
          lock?: unknown;
        }>
      ).find((p) => p.key === 'lsc.runs.read')!.lock,
    ).toBeUndefined();

    const inst = await one<{ uuid: string }>(
      `SELECT uuid FROM workspace_app_installations WHERE org_id = $1`,
      [N.orgId],
    );
    const gone = await mp(N).post(`/installations/${inst.uuid}/uninstall`, { dataChoice: 'keep' });
    expect(gone.status, JSON.stringify(gone.body)).toBe(204);
    expect(await on(N)).toBe(false);
    expect((await settings(N)).status).toBe(422);
  });
});

describe('background work does nothing for a workspace that has not got the app', () => {
  it('automatic scoring is not queued, a queued job is skipped without a call, and a manual score is refused', async () => {
    // the platform switch is on and the workspace opted in, with automatic scoring: only the plan side is missing
    const platformOn = await api
      .http()
      .patch('/v2/platform/lead-scoring')
      .set('authorization', `Bearer ${token}`)
      .send({ platformEnabled: true, model: 'openai/gpt-6-luna-pro', scoresPerHour: 0 });
    expect(platformOn.status, JSON.stringify(platformOn.body)).toBe(200);
    await h.owner.query(
      `INSERT INTO lead_scoring_settings (org_id, enabled, auto_score) VALUES ($1, true, true)`,
      [G.orgId],
    );
    expect(await on(G)).toBe(false);

    const service = h.app.get(LeadScoringService);
    const enqueue = vi.spyOn(service, 'enqueue').mockResolvedValue(undefined);
    await service.enqueueIfAuto(G.orgId, 1, 'created');
    expect(enqueue).not.toHaveBeenCalled();

    expect(await service.score(G.orgId, 1, 'created')).toEqual({
      status: 'skipped',
      reason: 'feature_off',
    });
    await expect(service.score(G.orgId, 1, 'manual')).rejects.toMatchObject({
      code: 'PLAN_FEATURE_LOCKED',
    });
    expect(
      await n(`SELECT count(*) AS n FROM lead_scoring_runs WHERE org_id = $1`, [G.orgId]),
    ).toBe(0);

    // the same workspace with the feature is queued as usual
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"lead_scoring":true}}'::jsonb WHERE org_id = $1`,
      [G.orgId],
    );
    await service.enqueueIfAuto(G.orgId, 1, 'created');
    expect(enqueue).toHaveBeenCalledTimes(1);
    enqueue.mockRestore();
  });
});

describe('(b) a workspace that already uses scoring keeps it, untouched, when the migration runs', () => {
  it('before the migration is re-run they are locked like a new workspace (this is the loss the migration prevents)', async () => {
    // The harness migrated an empty database, so there was nothing to grandfather then. Put usage in place, as production has it.
    await h.owner.query(`INSERT INTO lead_scoring_settings (org_id, enabled) VALUES ($1, true)`, [
      B.orgId,
    ]);
    await h.owner.query(
      `INSERT INTO lead_scoring_runs (org_id, status, trigger, contact_name) VALUES ($1, 'skipped', 'manual', 'Old run')`,
      [C.orgId],
    );
    await h.owner.query(`INSERT INTO growth_settings (org_id) VALUES ($1)`, [D.orgId]);
    await h.owner.query(`INSERT INTO lead_scoring_settings (org_id, enabled) VALUES ($1, true)`, [
      E.orgId,
    ]);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"features":{"lead_scoring":false}}'::jsonb WHERE org_id = $1`,
      [E.orgId],
    );
    await h.owner.query(`INSERT INTO lead_scoring_settings (org_id, enabled) VALUES ($1, true)`, [
      F.orgId,
    ]);
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = '{"limits":{"contacts":50},"features":{"inbox_sla":true}}'::jsonb WHERE org_id = $1`,
      [F.orgId],
    );
    for (const t of [B, C, D, F]) expect(await on(t)).toBe(false);
    expect((await settings(B)).status).toBe(422);
  });

  it('gives each of them an override and nothing else, and respects an override an operator already set', async () => {
    const before = await overrides(N);
    await h.owner.query(MIGRATION);

    for (const [name, t] of [
      ['B', B],
      ['C', C],
      ['D', D],
      ['F', F],
    ] as const) {
      expect(await on(t), name).toBe(true);
      expect((await overrides(t)) as { features: Record<string, boolean> }, name).toMatchObject({
        features: { lead_scoring: true },
      });
    }
    // other overrides survive
    expect(await overrides(F)).toEqual({
      limits: { contacts: 50 },
      features: { inbox_sla: true, lead_scoring: true },
    });
    // an operator's explicit "no" is not overwritten
    expect(await on(E)).toBe(false);
    expect(await overrides(E)).toEqual({ features: { lead_scoring: false } });
    // a workspace that never used scoring is not touched
    expect(await on(N)).toBe(false);
    expect(await overrides(N)).toEqual(before);
  });

  it('they use it exactly as before: no purchase, no installation, no change to their data', async () => {
    const res = await settings(B);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect((await api.as(C.admin).get('/v2/lead-scoring/runs')).status).toBe(200);
    expect((await api.as(D.admin).get('/v2/growth/settings')).status).toBe(200);
    expect(
      await n(
        `SELECT count(*) AS n FROM workspace_app_installations WHERE org_id = ANY($1::bigint[])`,
        [[B.orgId, C.orgId, D.orgId, F.orgId]],
      ),
    ).toBe(0);
    expect(
      await n(
        `SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = ANY($1::bigint[])`,
        [[B.orgId, C.orgId, D.orgId, F.orgId]],
      ),
    ).toBe(0);
    // their Roles editor shows the scoring keys open, not locked
    const roles = await api.as(B.admin).get('/v2/permissions?includeLocked=1');
    const read = (roles.body.data as Array<{ key: string; lock?: unknown }>).find(
      (p) => p.key === 'lsc.runs.read',
    )!;
    expect(read.lock).toBeUndefined();
  });

  it('running the migration again changes nothing (no row is touched)', async () => {
    const versions = async () =>
      (
        await h.owner.query(
          `SELECT org_id, row_version FROM org_plan_state WHERE org_id = ANY($1::bigint[]) ORDER BY org_id`,
          [[N, B, C, D, E, F].map((t) => t.orgId)],
        )
      ).rows;
    const before = await versions();
    const listings = await n(`SELECT count(*) AS n FROM marketplace_apps`);
    await h.owner.query(MIGRATION);
    await h.owner.query(MIGRATION);
    expect(await versions()).toEqual(before);
    expect(await n(`SELECT count(*) AS n FROM marketplace_apps`)).toBe(listings);
  });

  it("the operator's comp then finds them (dry run first), so the grandfathering has a lasting record", async () => {
    const ops = platformApi(h, token);
    const dry = await ops.post('/apps/lead-scoring/subscriptions/grandfather', {
      months: null,
      note: 'Existing AI lead scoring users keep it',
      dryRun: true,
    });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.dryRun).toBe(true);
    // B, C, D, F and G by their override; E by what it has used; N has a subscription already and used nothing
    expect(dry.body.matched).toBe(6);
    expect(dry.body.comped).toBe(0);
    expect(
      await n(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [B.orgId]),
    ).toBe(0);

    const real = await ops.post('/apps/lead-scoring/subscriptions/grandfather', {
      months: null,
      note: 'Existing AI lead scoring users keep it',
      dryRun: false,
    });
    expect(real.status, JSON.stringify(real.body)).toBe(200);
    expect(real.body.comped).toBe(6);
    expect(
      await n(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [B.orgId]),
    ).toBe(1);
    // still on, still without an installation: the override keeps them whole
    expect(await on(B)).toBe(true);
    expect((await settings(B)).status).toBe(200);
    // a second run finds nobody
    const again = await ops.post('/apps/lead-scoring/subscriptions/grandfather', {
      months: null,
      note: 'again',
      dryRun: false,
    });
    expect(again.body.matched).toBe(0);
  });
});
