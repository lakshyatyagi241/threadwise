import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { runSeedAppointments } from '../../../src/modules/marketplace/cli/seed-appointments.runner';
import {
  parseArgs,
  type SeedAppointmentsOptions,
} from '../../../src/modules/marketplace/cli/seed-appointments.args';
import {
  Api,
  platformApi,
  startHarness,
  superOperator,
  type Harness,
  type Tenant,
} from './support';

/**
 * The `seed:appointments` local-development command, end to end on a freshly migrated Postgres (real AppModule, row-level security
 * forced): the same services the operator console calls, run by the seeded super admin. The guards (production, non-local database,
 * flags) are unit tested in test/unit/marketplace/seed-appointments-args.spec.ts.
 */
let h: Harness;
let api: Api;
let A: Tenant; // already uses booking (has a booking type)
let B: Tenant; // never used booking
let C: Tenant; // never used booking; comped by name with --workspace
let token = ''; // the operator console session (super admin, two-factor enrolled)

const run = (...argv: string[]) => {
  const parsed = parseArgs(argv);
  if (parsed.kind !== 'options') throw new Error(JSON.stringify(parsed));
  return runSeedAppointments(h.app, parsed.options satisfies SeedAppointmentsOptions);
};
const one = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  (await h.owner.query(query, params)).rows[0] as T;
const n = async (query: string, params: unknown[] = []): Promise<number> =>
  Number((await one<{ n: string }>(query, params)).n);
const has = (t: Tenant) =>
  h.app.get(PlanEntitlementService).featureEnabled(t.orgId, 'appointment_booking');
const listing = () =>
  one<{
    status: string;
    price_amount: string | null;
    price_currency: string | null;
    row_version: number;
  }>(
    `SELECT status, price_amount::text, price_currency, row_version FROM marketplace_apps WHERE slug = 'appointments'`,
  );
const counts = async () => ({
  addons: await n(
    `SELECT count(*) AS n FROM plans WHERE kind = 'addon' AND marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'appointments')`,
  ),
  subs: await n(
    `SELECT count(*) AS n FROM marketplace_subscriptions WHERE app_id = (SELECT id FROM marketplace_apps WHERE slug = 'appointments')`,
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
  A = await api.signup('seedA');
  B = await api.signup('seedB');
  C = await api.signup('seedC');
  await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = ANY($1::bigint[])`, [
    [A.orgId, B.orgId, C.orgId],
  ]);
  await h.owner.query(
    `INSERT INTO booking_types (org_id, name, slug) VALUES ($1, 'Consultation', 'consultation')`,
    [A.orgId],
  );
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('seed:appointments on a fresh database', () => {
  it('starts as the migration leaves it: a draft with no price, booking locked for everyone', async () => {
    expect(await listing()).toMatchObject({ status: 'draft', price_amount: null });
    expect(await has(A)).toBe(false);
    expect(await has(B)).toBe(false);
  });

  it('--dry-run reports the plan and writes nothing', async () => {
    const before = await counts();
    const out = await run('--dry-run');
    expect(out.actions.join('\n')).toMatch(/set the price to 499.00 INR/);
    expect(out.actions.join('\n')).toMatch(/publish the listing/);
    expect(out.operator).toMatchObject({ email: 'ops@platform.test', role: 'super_admin' });
    expect(await counts()).toEqual(before);
    expect(await listing()).toMatchObject({ status: 'draft', price_amount: null });
  });

  it('prices, creates the add-on, comps the workspace already using booking, and publishes', async () => {
    const out = await run();
    expect(out.before).toMatchObject({ status: 'draft', price: 'not set', pack: 'none' });
    expect(out.after).toMatchObject({ status: 'published', price: '499.00 INR per month' });
    expect(out.after.pack).toMatch(/^mkt_/);

    expect(await listing()).toMatchObject({
      status: 'published',
      price_amount: '499.00',
      price_currency: 'INR',
    });
    // the add-on pack that sells it: one month, the price, carrying the granted feature
    const pack = await one<{
      amount: string;
      currency: string;
      billing_unit: string;
      billing_duration: number;
      features: Record<string, boolean>;
      is_active: boolean;
    }>(
      `SELECT amount::text, currency, billing_unit, billing_duration, features, is_active FROM plans WHERE kind = 'addon' AND marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'appointments')`,
    );
    expect(pack).toMatchObject({
      amount: '499.00',
      currency: 'INR',
      billing_unit: 'months',
      billing_duration: 1,
      is_active: true,
    });
    expect(pack.features).toMatchObject({ mkt_appointments: true, appointment_booking: true });

    // A already used booking: comped by the operator action. B and C did not: nothing for them.
    expect(await has(A)).toBe(true);
    expect(await has(B)).toBe(false);
    expect(await has(C)).toBe(false);
    const sub = await one<{ source: string; status: string; current_period_end: string | null }>(
      `SELECT source, status, current_period_end FROM marketplace_subscriptions WHERE org_id = $1`,
      [A.orgId],
    );
    expect(sub).toMatchObject({ source: 'comp', status: 'active', current_period_end: null });
    expect(
      await n(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [B.orgId]),
    ).toBe(0);

    // audited like the console: price, grandfather, version approved, published; attributed to the operator
    for (const event of [
      'platform.market.pricing_set',
      'platform.market.subscriptions_grandfathered',
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
  });

  it('enables the add-on on every active plan when the visibility table exists, and says so when it does not', async () => {
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
         WHERE v.plan_id = p.id AND ap.marketplace_app_id = (SELECT id FROM marketplace_apps WHERE slug = 'appointments'))`);
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
    const dry = await run('--dry-run');
    expect(dry.actions).toEqual([]);
  });

  it('does not overwrite a price an operator set, unless --force', async () => {
    token ||= await superOperator(h);
    const current = await listing();
    const set = await platformApi(h, token).put('/apps/appointments/pricing', {
      rowVersion: current.row_version,
      model: 'paid_monthly',
      amount: '750',
      currency: 'USD',
      grantsPlanFeatures: ['appointment_booking'],
      grandfatherExisting: true,
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);

    const kept = await run('--price', '499', '--currency', 'INR');
    expect(kept.actions).toEqual([]);
    expect(kept.notes.join('\n')).toMatch(/price: an operator already set 750.00 USD; kept/);
    expect(await listing()).toMatchObject({ price_amount: '750.00', price_currency: 'USD' });

    const forced = await run('--price', '499', '--currency', 'INR', '--force');
    expect(forced.actions.join('\n')).toMatch(/replace the price 750.00 USD with 499.00 INR/);
    expect(await listing()).toMatchObject({ price_amount: '499.00', price_currency: 'INR' });
    expect(
      await n(
        `SELECT count(*) AS n FROM plans WHERE kind = 'addon' AND amount = 499 AND currency = 'INR'`,
      ),
    ).toBe(1);
  });

  it('does not touch a listing an operator hid', async () => {
    token ||= await superOperator(h);
    expect((await platformApi(h, token).post('/apps/appointments/hide')).status).toBe(200);
    const out = await run();
    expect(out.actions).toEqual([]);
    expect(out.notes.join('\n')).toMatch(/listing is hidden/);
    expect((await listing()).status).toBe('hidden');
    const forced = await run('--force');
    expect(forced.actions.join('\n')).toMatch(/show the hidden listing again/);
    expect((await listing()).status).toBe('published');
  });

  it('--workspace comps just that workspace, once', async () => {
    expect(await has(C)).toBe(false);
    const dry = await run('--workspace', C.slug, '--dry-run');
    expect(dry.actions.join('\n')).toMatch(new RegExp(`comp workspace "${C.slug}"`));
    expect(await has(C)).toBe(false);

    const real = await run('--workspace', C.slug);
    expect(real.actions.join('\n')).toMatch(new RegExp(`comp workspace "${C.slug}"`));
    expect(await has(C)).toBe(true);
    expect(await has(B)).toBe(false);

    const again = await run('--workspace', C.slug);
    expect(again.actions).toEqual([]);
    expect(again.notes.join('\n')).toMatch(/already has a subscription/);
    expect(
      await n(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [C.orgId]),
    ).toBe(1);
    await expect(run('--workspace', 'no-such-workspace')).rejects.toThrow(/no workspace/);
  });
});
