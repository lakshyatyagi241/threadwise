import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { runSeedForms } from '../../../src/modules/marketplace/cli/seed-forms.runner';
import { parseArgs } from '../../../src/modules/marketplace/cli/seed-forms.args';
import {
  Api,
  platformApi,
  startHarness,
  superOperator,
  type Harness,
  type Tenant,
} from './support';

/**
 * The `seed:forms` local-development command, end to end on a freshly migrated Postgres (real AppModule, row-level security forced): the
 * same services the operator console calls, run by the seeded super admin. Guards and flag parsing are unit tested in
 * test/unit/marketplace/seed-appointments-args.spec.ts; the Appointments flavour of the same runner is in seed-appointments.e2e.spec.ts.
 */
let h: Harness;
let api: Api;
let A: Tenant; // comped with --workspace
let B: Tenant; // never named: stays locked until --all-workspaces
let C: Tenant;
let token = '';

const run = (...argv: string[]) => {
  const parsed = parseArgs(argv);
  if (parsed.kind !== 'options') throw new Error(JSON.stringify(parsed));
  return runSeedForms(h.app, parsed.options);
};
const one = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  (await h.owner.query(query, params)).rows[0] as T;
const n = async (query: string, params: unknown[] = []): Promise<number> =>
  Number((await one<{ n: string }>(query, params)).n);
const has = (t: Tenant) =>
  h.app.get(PlanEntitlementService).featureEnabled(t.orgId, 'form_builder');
const listing = () =>
  one<{
    status: string;
    price_amount: string | null;
    price_currency: string | null;
    row_version: number;
  }>(
    `SELECT status, price_amount::text, price_currency, row_version FROM marketplace_apps WHERE slug = 'forms'`,
  );
const counts = async () => ({
  addons: await n(
    `SELECT count(*) AS n FROM plans WHERE kind = 'addon' AND marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'forms')`,
  ),
  subs: await n(
    `SELECT count(*) AS n FROM marketplace_subscriptions WHERE app_id = (SELECT id FROM marketplace_apps WHERE slug = 'forms')`,
  ),
  held: await n(`SELECT count(*) AS n FROM workspace_addons`),
  events: await n(`SELECT count(*) AS n FROM security_events WHERE event LIKE 'platform.%'`),
  rowVersion: (await listing()).row_version,
});

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  await h.owner.query(
    `INSERT INTO plans (slug, kind, name, amount, currency, sort_order, is_free) VALUES ('freebie', 'plan', 'Freebie', 0, 'USD', 1, true)`,
  );
  A = await api.signup('formsA');
  B = await api.signup('formsB');
  C = await api.signup('formsC');
  await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = ANY($1::bigint[])`, [
    [A.orgId, B.orgId, C.orgId],
  ]);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('seed:forms on a fresh database', () => {
  it('starts as the migration leaves it: a draft with no price, Forms locked for everyone', async () => {
    expect(await listing()).toMatchObject({ status: 'draft', price_amount: null });
    expect(await has(A)).toBe(false);
    expect(await has(B)).toBe(false);
  });

  it('--dry-run reports the plan and writes nothing', async () => {
    const before = await counts();
    const out = await run('--dry-run');
    expect(out.actions.join('\n')).toMatch(/set the price to 799.00 INR/);
    expect(out.actions.join('\n')).toMatch(/publish the listing/);
    expect(out.notes.join('\n')).toMatch(/nobody is comped/);
    expect(out.operator).toMatchObject({ email: 'ops@platform.test', role: 'super_admin' });
    expect(await counts()).toEqual(before);
    expect(await listing()).toMatchObject({ status: 'draft', price_amount: null });
  });

  it('prices at 799 INR, creates the add-on, publishes, and comps nobody', async () => {
    const out = await run();
    expect(out.before).toMatchObject({ status: 'draft', price: 'not set', pack: 'none' });
    expect(out.after).toMatchObject({ status: 'published', price: '799.00 INR per month' });
    expect(out.after.pack).toMatch(/^mkt_/);

    expect(await listing()).toMatchObject({
      status: 'published',
      price_amount: '799.00',
      price_currency: 'INR',
    });
    const pack = await one<{
      amount: string;
      currency: string;
      billing_unit: string;
      billing_duration: number;
      features: Record<string, boolean>;
      is_active: boolean;
    }>(
      `SELECT amount::text, currency, billing_unit, billing_duration, features, is_active FROM plans WHERE kind = 'addon' AND marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'forms')`,
    );
    expect(pack).toMatchObject({
      amount: '799.00',
      currency: 'INR',
      billing_unit: 'months',
      billing_duration: 1,
      is_active: true,
    });
    expect(pack.features).toMatchObject({ mkt_forms: true, form_builder: true });

    // no workspace used Forms before: nobody is comped, nothing is unlocked
    expect(await n(`SELECT count(*) AS n FROM marketplace_subscriptions`)).toBe(0);
    expect(await has(A)).toBe(false);

    for (const event of [
      'platform.market.pricing_set',
      'platform.market.version_approved',
      'platform.market.app_published',
    ])
      expect(
        await n(
          `SELECT count(*) AS n FROM security_events WHERE event = $1 AND actor_type = 'platform_operator'`,
          [event],
        ),
        event,
      ).toBeGreaterThanOrEqual(1);
    expect(
      await n(
        `SELECT count(*) AS n FROM security_events WHERE event = 'platform.market.subscriptions_grandfathered'`,
      ),
    ).toBe(0);
  });

  it('shows the add-on on every active plan when the visibility table exists, and says so when it does not', async () => {
    const exists = (
      await h.owner.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'plan_visible_addons'`,
      )
    ).rows.length;
    if (!exists) {
      const out = await run('--dry-run');
      expect(out.notes.join('\n')).toMatch(/no plan_visible_addons table/);
      return;
    }
    const missing = await n(`
      SELECT count(*) AS n FROM plans p WHERE p.kind = 'plan' AND p.is_active AND NOT EXISTS (
        SELECT 1 FROM plan_visible_addons v JOIN plans ap ON ap.id = v.addon_plan_id
         WHERE v.plan_id = p.id AND ap.marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'forms'))`);
    expect(missing).toBe(0);
    expect(
      await n(`SELECT count(*) AS n FROM plans WHERE kind = 'plan' AND is_active`),
    ).toBeGreaterThan(0);
  });

  it('a second run changes nothing', async () => {
    const before = await counts();
    const out = await run();
    expect(out.actions).toEqual([]);
    expect(out.before).toEqual(out.after);
    expect(await counts()).toEqual(before);
    expect((await run('--dry-run')).actions).toEqual([]);
  });

  it('keeps a price an operator set, and replaces it only with --force', async () => {
    token ||= await superOperator(h);
    const current = await listing();
    const set = await platformApi(h, token).put('/apps/forms/pricing', {
      rowVersion: current.row_version,
      model: 'paid_monthly',
      amount: '1200',
      currency: 'USD',
      grantsPlanFeatures: ['form_builder'],
      grandfatherExisting: false,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const kept = await run();
    expect(kept.actions).toEqual([]);
    expect(kept.notes.join('\n')).toMatch(/price: an operator already set 1200.00 USD; kept/);
    expect(await listing()).toMatchObject({ price_amount: '1200.00', price_currency: 'USD' });

    const forced = await run('--force');
    expect(forced.actions.join('\n')).toMatch(/replace the price 1200.00 USD with 799.00 INR/);
    expect(await listing()).toMatchObject({ price_amount: '799.00', price_currency: 'INR' });
    expect(
      await n(
        `SELECT count(*) AS n FROM plans WHERE kind = 'addon' AND amount = 799 AND currency = 'INR'`,
      ),
    ).toBe(1);
  });

  it('--workspace comps just that workspace, so its entitlements include form_builder, and only once', async () => {
    expect(await has(A)).toBe(false);
    const dry = await run('--workspace', A.slug, '--dry-run');
    expect(dry.actions.join('\n')).toMatch(new RegExp(`comp workspace "${A.slug}"`));
    expect(await has(A)).toBe(false);

    const real = await run('--workspace', A.slug);
    expect(real.actions.join('\n')).toMatch(new RegExp(`comp workspace "${A.slug}"`));
    expect(await has(A)).toBe(true);
    expect(await has(B)).toBe(false);
    expect(await has(C)).toBe(false);
    expect(
      await one<{ source: string; status: string; current_period_end: string | null }>(
        `SELECT source, status, current_period_end FROM marketplace_subscriptions WHERE org_id = $1`,
        [A.orgId],
      ),
    ).toMatchObject({ source: 'comp', status: 'active', current_period_end: null });

    const again = await run('--workspace', A.slug);
    expect(again.actions).toEqual([]);
    expect(again.notes.join('\n')).toMatch(/already has a subscription/);
    expect(
      await n(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [A.orgId]),
    ).toBe(1);
    await expect(run('--workspace', 'no-such-workspace')).rejects.toThrow(/no workspace/);
  });

  it('--all-workspaces needs --yes, then comps every workspace that has no subscription yet', async () => {
    // refused at parse time without --yes (a real run), nothing is written
    expect(parseArgs(['--all-workspaces']).kind).toBe('error');
    expect(await has(B)).toBe(false);

    const dry = await run('--all-workspaces', '--dry-run');
    expect(dry.actions.join('\n')).toMatch(/comp \d+ workspace\(s\)/);
    expect(await has(B)).toBe(false);

    const real = await run('--all-workspaces', '--yes');
    expect(real.actions.join('\n')).toContain(`"${B.slug}"`);
    expect(real.notes.join('\n')).toMatch(/1 workspace\(s\) already have a subscription/);
    expect(await has(A)).toBe(true);
    expect(await has(B)).toBe(true);
    expect(await has(C)).toBe(true);
    expect(
      await n(
        `SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = ANY($1::bigint[])`,
        [[A.orgId, B.orgId, C.orgId]],
      ),
    ).toBe(3);

    const again = await run('--all-workspaces', '--yes');
    expect(again.actions).toEqual([]);
  });
});
