import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recipeSchema, validateMarketManifest } from '@crm/contracts';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { runSeedEmail } from '../../../src/modules/marketplace/cli/seed-email.runner';
import { parseArgs } from '../../../src/modules/marketplace/cli/seed-email.args';
import {
  Api,
  platformApi,
  startHarness,
  superOperator,
  type Harness,
  type Tenant,
} from './support';

/**
 * The `seed:email` local-development command, end to end on a freshly migrated Postgres (real AppModule, row-level security forced): the
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
  return runSeedEmail(h.app, parsed.options);
};
const one = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  (await h.owner.query(query, params)).rows[0] as T;
const n = async (query: string, params: unknown[] = []): Promise<number> =>
  Number((await one<{ n: string }>(query, params)).n);
const has = (t: Tenant) =>
  h.app.get(PlanEntitlementService).featureEnabled(t.orgId, 'email_channel');
const listing = () =>
  one<{
    status: string;
    price_amount: string | null;
    price_currency: string | null;
    row_version: number;
  }>(
    `SELECT status, price_amount::text, price_currency, row_version FROM marketplace_apps WHERE slug = 'email'`,
  );
const counts = async () => ({
  addons: await n(
    `SELECT count(*) AS n FROM plans WHERE kind = 'addon' AND marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'email')`,
  ),
  subs: await n(
    `SELECT count(*) AS n FROM marketplace_subscriptions WHERE app_id = (SELECT id FROM marketplace_apps WHERE slug = 'email')`,
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
  A = await api.signup('emailA');
  B = await api.signup('emailB');
  C = await api.signup('emailC');
  await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = ANY($1::bigint[])`, [
    [A.orgId, B.orgId, C.orgId],
  ]);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('seed:email on a fresh database', () => {
  it('starts as the migration leaves it: a draft with no price, Email locked for everyone', async () => {
    expect(await listing()).toMatchObject({ status: 'draft', price_amount: null });
    expect(await has(A)).toBe(false);
    expect(await has(B)).toBe(false);
  });

  it('the migration seeded the draft listing, its version, the scopes and the plan defaults', async () => {
    const app = await one<{
      kind: string;
      connector_type: string | null;
      category: string;
      first_party: boolean;
      pricing_model: string;
      purchasable: boolean;
      grants_plan_features: string[];
      grandfather_existing: boolean;
      name: string;
    }>(
      `SELECT a.kind, a.connector_type, c.kind || '/' || c.slug AS category, a.first_party, a.pricing_model, a.purchasable, a.grants_plan_features, a.grandfather_existing, a.name
         FROM marketplace_apps a JOIN marketplace_categories c ON c.id = a.category_id WHERE a.slug = 'email'`,
    );
    expect(app).toMatchObject({
      kind: 'integration',
      connector_type: 'client',
      category: 'integration/messaging-and-email',
      first_party: true,
      pricing_model: 'paid_monthly',
      purchasable: true,
      grants_plan_features: ['email_channel'],
      grandfather_existing: false,
      name: 'Email (Gmail)',
    });
    const v = (
      await h.owner.query(
        `SELECT version, status, scopes, manifest, recipe FROM marketplace_app_versions WHERE app_id = (SELECT id FROM marketplace_apps WHERE slug = 'email')`,
      )
    ).rows;
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ version: '1.0.0', status: 'draft' });
    expect(v[0].scopes).toEqual(['email.read', 'email.write']);
    expect(v[0].manifest).toMatchObject({
      kind: 'integration',
      category: 'messaging-and-email',
      connector: { type: 'client' },
      surfaces: [],
    });
    expect(v[0].recipe).toMatchObject({ connector: { type: 'client' } });
    // the stored documents are valid for the new kind
    expect(validateMarketManifest(v[0].manifest).ok).toBe(true);
    expect(recipeSchema.safeParse(v[0].recipe).success).toBe(true);

    // A fresh database has no plan rows, so the migration's two UPDATEs run here against a plan row of this test.
    await h.owner.query(
      `INSERT INTO plans (slug, name, is_free, features, limits) VALUES ('email_seed_test', 'Test', true, '{"analytics": true}'::jsonb, '{"users": 3}'::jsonb)`,
    );
    const sqlText = readFileSync(
      resolve(__dirname, '../../../../../packages/db/migrations/20261118100100_mkt_email_app.sql'),
      'utf8',
    );
    for (const stmt of sqlText.match(/UPDATE plans[\s\S]*?;/g) ?? []) await h.owner.query(stmt);
    const plan = await one<{ features: Record<string, unknown>; limits: Record<string, unknown> }>(
      `SELECT features, limits FROM plans WHERE slug = 'email_seed_test'`,
    );
    expect(plan.features).toMatchObject({ analytics: true, email_channel: false });
    expect(plan.limits).toMatchObject({ users: 3, email_mailboxes: 3 });
    await h.owner.query(`DELETE FROM plans WHERE slug = 'email_seed_test'`);
  });

  it('the integration migration is idempotent: re-running it changes nothing, and converts a mini app listing in place', async () => {
    const sqlText = readFileSync(
      resolve(
        __dirname,
        '../../../../../packages/db/migrations/20261119120000_mkt_email_integration.sql',
      ),
      'utf8',
    );
    const snapshot = () =>
      one<{ a: string; v: string; n: string }>(
        `SELECT (SELECT row_to_json(a)::text FROM (SELECT kind, category_id, connector_type, tagline, listing, status, row_version FROM marketplace_apps WHERE slug = 'email') a) AS a,
                (SELECT string_agg(manifest::text || coalesce(recipe::text, ''), '|' ORDER BY id) FROM marketplace_app_versions WHERE app_id = (SELECT id FROM marketplace_apps WHERE slug = 'email')) AS v,
                (SELECT count(*) FROM marketplace_apps WHERE slug = 'email') AS n`,
      );
    const before = await snapshot();
    await h.owner.query(sqlText);
    expect(await snapshot()).toEqual(before);

    // put the listing back the way 20261118100100 left it, then run the migration again: it is converted in place
    await h.owner.query(`
      UPDATE marketplace_apps SET kind = 'mini_app', connector_type = NULL,
        category_id = (SELECT id FROM marketplace_categories WHERE kind = 'mini_app' AND slug = 'inbox-and-chat'),
        listing = '{"longDescription":"Connect one or more Gmail or Google Workspace mailboxes with a sign-in popup. Old text."}'::jsonb
      WHERE slug = 'email'`);
    await h.owner.query(`
      UPDATE marketplace_app_versions SET recipe = NULL,
        manifest = jsonb_set(jsonb_set(manifest, '{kind}', '"mini_app"'), '{surfaces}', '[{"type":"settings_page","key":"email","label":"Email"}]')
                   - 'connector'
      WHERE app_id = (SELECT id FROM marketplace_apps WHERE slug = 'email')`);
    await h.owner.query(sqlText);
    const after = await snapshot();
    expect(Number(after.n)).toBe(1);
    expect(after.a).toContain('"kind":"integration"');
    expect(after.a).toContain('"connector_type":"client"');
    expect(after.a).toContain('from Settings > Integrations');
    expect(after.v).toContain('"kind": "integration"');
    // the operator's own price and status survive
    expect(await listing()).toMatchObject({ status: 'draft', price_amount: null });
  });

  it('--dry-run reports the plan and writes nothing', async () => {
    const before = await counts();
    const out = await run('--dry-run');
    expect(out.actions.join('\n')).toMatch(/set the price to 499.00 INR/);
    expect(out.actions.join('\n')).toMatch(/publish the listing/);
    expect(out.notes.join('\n')).toMatch(/nobody is comped/);
    expect(out.operator).toMatchObject({ email: 'ops@platform.test', role: 'super_admin' });
    expect(await counts()).toEqual(before);
    expect(await listing()).toMatchObject({ status: 'draft', price_amount: null });
  });

  it('prices at 499 INR, creates the add-on, publishes, and comps nobody', async () => {
    const out = await run();
    expect(out.before).toMatchObject({ status: 'draft', price: 'not set', pack: 'none' });
    expect(out.after).toMatchObject({ status: 'published', price: '499.00 INR per month' });
    expect(out.after.pack).toMatch(/^mkt_/);

    expect(await listing()).toMatchObject({
      status: 'published',
      price_amount: '499.00',
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
      `SELECT amount::text, currency, billing_unit, billing_duration, features, is_active FROM plans WHERE kind = 'addon' AND marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'email')`,
    );
    expect(pack).toMatchObject({
      amount: '499.00',
      currency: 'INR',
      billing_unit: 'months',
      billing_duration: 1,
      is_active: true,
    });
    expect(pack.features).toMatchObject({ mkt_email: true, email_channel: true });

    // no workspace used Email before: nobody is comped, nothing is unlocked
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
         WHERE v.plan_id = p.id AND ap.marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'email'))`);
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
    const set = await platformApi(h, token).put('/apps/email/pricing', {
      rowVersion: current.row_version,
      model: 'paid_monthly',
      amount: '1200',
      currency: 'USD',
      grantsPlanFeatures: ['email_channel'],
      grandfatherExisting: false,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const kept = await run();
    expect(kept.actions).toEqual([]);
    expect(kept.notes.join('\n')).toMatch(/price: an operator already set 1200.00 USD; kept/);
    expect(await listing()).toMatchObject({ price_amount: '1200.00', price_currency: 'USD' });

    const forced = await run('--force');
    expect(forced.actions.join('\n')).toMatch(/replace the price 1200.00 USD with 499.00 INR/);
    expect(await listing()).toMatchObject({ price_amount: '499.00', price_currency: 'INR' });
    expect(
      await n(
        `SELECT count(*) AS n FROM plans WHERE kind = 'addon' AND amount = 499 AND currency = 'INR'`,
      ),
    ).toBe(1);
  });

  it('--workspace comps just that workspace, so its entitlements include email_channel, and only once', async () => {
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
