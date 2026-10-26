import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations, type Tx } from '@crm/db';
import {
  offerOf,
  offersForAddon,
  offersOfPlanSlug,
  resyncIncludedPlans,
  writeAddonOffers,
  writePlanOffers,
} from '../../../src/modules/plans-subscriptions-trials/plan-addon-offers';

/**
 * Plan x plain add-on offers (docs/specs/addons-plan-offers.md) on real Postgres with every migration: the table's trigger and checks, the writes the
 * plan editor and the pack editor make (and the plan features they imply), the default for a plan with no row, and the resync after a pack's
 * features change.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

describe('plan_addon_offers', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let tx: Tx;
  const plans: Record<string, { id: number; uuid: string }> = {};
  const packs: Record<string, { id: number; uuid: string }> = {};

  async function plan(slug: string, features: Record<string, boolean> = {}): Promise<void> {
    const r = await owner.query(
      `INSERT INTO plans (slug, kind, name, amount, features) VALUES ($1, 'plan', $1, 49, $2) RETURNING id, uuid`,
      [slug, JSON.stringify(features)],
    );
    plans[slug] = { id: Number(r.rows[0].id), uuid: String(r.rows[0].uuid) };
  }

  async function pack(
    slug: string,
    features: Record<string, boolean>,
    limits: Record<string, number> = {},
    marketplaceAppId: number | null = null,
    addonKind: 'feature' | 'capacity' | null = null,
  ): Promise<void> {
    const r = await owner.query(
      `INSERT INTO plans (slug, kind, name, amount, features, limits, marketplace_app_id, addon_kind)
       VALUES ($1, 'addon', $1, 9, $2, $3, $4, $5) RETURNING id, uuid`,
      [slug, JSON.stringify(features), JSON.stringify(limits), marketplaceAppId, addonKind],
    );
    packs[slug] = { id: Number(r.rows[0].id), uuid: String(r.rows[0].uuid) };
  }

  const featuresOf = async (slug: string): Promise<Record<string, unknown>> =>
    (await owner.query(`SELECT features FROM plans WHERE slug = $1`, [slug])).rows[0].features;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    tx = drizzle(owner) as unknown as Tx;

    await plan('basic', { inbox_routing: false, inbox_assignment_sticky: false, analytics: true });
    await plan('growth');
    await plan('free');
    await pack('smart', { inbox_routing: true, inbox_assignment_sticky: true });
    await pack('seat', {}, { users: 1 }, null, 'capacity');
    // a pack whose features were cleared: a feature add-on still to be filled in, which cannot be included
    await pack('empty', {}, {}, null, 'feature');
    const cat = await owner.query('SELECT id FROM marketplace_categories LIMIT 1');
    const app = await owner.query(
      `INSERT INTO marketplace_apps (slug, kind, category_id, name, tagline, status, pricing_model, price_amount, price_currency, first_party, grants_plan_features)
       VALUES ('crm-booking', 'mini_app', $1, 'crm-booking', 't', 'draft', 'paid_monthly', 9, 'USD', true, ARRAY['appointment_booking', 'mkt_crm-booking']) RETURNING id`,
      [cat.rows[0].id],
    );
    await pack('mkt_booking', { mkt_booking: true }, {}, Number(app.rows[0].id));
  }, 180_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  beforeEach(async () => {
    await owner.query('DELETE FROM plan_addon_offers');
  });

  it('a plan with no row offers every add-on as paid at its own price', async () => {
    const offers = await offersOfPlanSlug(tx, 'basic');
    expect(offerOf(offers, packs.smart!.id)).toEqual({ mode: 'paid', amount: null });
    const all = await offersForAddon(tx, packs.smart!.id);
    expect(all.map((o) => [o.planSlug, o.mode, o.stored])).toEqual(
      expect.arrayContaining([
        ['basic', 'paid', false],
        ['growth', 'paid', false],
      ]),
    );
  });

  it('included turns the add-on features on in the plan; paid / hidden turn them off', async () => {
    const on = await writePlanOffers(tx, plans.growth!.id, [
      { addonId: packs.smart!.uuid, mode: 'included', amount: null },
    ]);
    expect(on.features).toEqual({ inbox_routing: true, inbox_assignment_sticky: true });
    expect(on.changed).toEqual([packs.smart!.uuid]);

    const off = await writePlanOffers(tx, plans.growth!.id, [
      { addonId: packs.smart!.uuid, mode: 'hidden', amount: null },
    ]);
    expect(off.features).toEqual({ inbox_routing: false, inbox_assignment_sticky: false });
    expect(offerOf(await offersOfPlanSlug(tx, 'growth'), packs.smart!.id).mode).toBe('hidden');
  });

  it('paid at the add-on price stores no row; a plan price is stored', async () => {
    await writePlanOffers(tx, plans.basic!.id, [
      { addonId: packs.smart!.uuid, mode: 'paid', amount: '199.00' },
    ]);
    expect(offerOf(await offersOfPlanSlug(tx, 'basic'), packs.smart!.id)).toEqual({
      mode: 'paid',
      amount: '199.00',
    });
    const back = await writePlanOffers(tx, plans.basic!.id, [
      { addonId: packs.smart!.uuid, mode: 'paid', amount: null },
    ]);
    expect(back.changed).toEqual([packs.smart!.uuid]);
    const rows = await owner.query('SELECT count(*)::int AS n FROM plan_addon_offers');
    expect(rows.rows[0].n).toBe(0);
  });

  it('refuses including a capacity add-on or one with no feature yet, and an unknown add-on; both can still be hidden', async () => {
    await expect(
      writePlanOffers(tx, plans.basic!.id, [
        { addonId: packs.seat!.uuid, mode: 'included', amount: null },
      ]),
    ).rejects.toThrow(/validation/i);
    await expect(
      writePlanOffers(tx, plans.basic!.id, [
        { addonId: packs.empty!.uuid, mode: 'included', amount: null },
      ]),
    ).rejects.toThrow(/validation/i);
    await expect(
      writePlanOffers(tx, plans.basic!.id, [
        { addonId: '00000000-0000-4000-8000-000000000000', mode: 'hidden', amount: null },
      ]),
    ).rejects.toThrow(/validation/i);
    await writePlanOffers(tx, plans.free!.id, [
      { addonId: packs.seat!.uuid, mode: 'hidden', amount: null },
      { addonId: packs.empty!.uuid, mode: 'hidden', amount: null },
    ]);
    expect(offerOf(await offersOfPlanSlug(tx, 'free'), packs.seat!.id).mode).toBe('hidden');
  });

  const visibleOn = async (plan: string, pack: string) =>
    (
      await owner.query(
        `SELECT 1 FROM plan_visible_addons WHERE plan_id = $1 AND addon_plan_id = $2`,
        [plans[plan]!.id, packs[pack]!.id],
      )
    ).rows.length > 0;

  it('a mini app: Paid makes it visible, Included also writes a row and its features, Hidden removes both (features only on a change)', async () => {
    await owner.query(`DELETE FROM plan_visible_addons`);
    // the plan already carries the app's feature on its own: Paid and Hidden never switch it off
    await owner.query(
      `UPDATE plans SET features = features || '{"appointment_booking": true}'::jsonb WHERE slug = 'growth'`,
    );
    const paid = await writePlanOffers(tx, plans.growth!.id, [
      { addonId: packs.mkt_booking!.uuid, mode: 'paid', amount: null },
    ]);
    expect(paid.features).toEqual({});
    expect(await visibleOn('growth', 'mkt_booking')).toBe(true);
    expect((await offersOfPlanSlug(tx, 'growth')).has(packs.mkt_booking!.id)).toBe(false);

    const inc = await writePlanOffers(tx, plans.basic!.id, [
      { addonId: packs.mkt_booking!.uuid, mode: 'included', amount: null },
    ]);
    // its own mkt_ key is never put on a plan
    expect(inc.features).toEqual({ appointment_booking: true });
    expect(await visibleOn('basic', 'mkt_booking')).toBe(true);
    expect(offerOf(await offersOfPlanSlug(tx, 'basic'), packs.mkt_booking!.id).mode).toBe(
      'included',
    );
    // saving Included again changes nothing
    expect(
      (
        await writePlanOffers(tx, plans.basic!.id, [
          { addonId: packs.mkt_booking!.uuid, mode: 'included', amount: null },
        ])
      ).changed,
    ).toEqual([]);

    const hid = await writePlanOffers(tx, plans.basic!.id, [
      { addonId: packs.mkt_booking!.uuid, mode: 'hidden', amount: null },
    ]);
    expect(hid.features).toEqual({ appointment_booking: false });
    expect(await visibleOn('basic', 'mkt_booking')).toBe(false);
    expect((await offersOfPlanSlug(tx, 'basic')).has(packs.mkt_booking!.id)).toBe(false);
    // Hidden on a plan that never had it included leaves the plan's own feature alone
    const hidGrowth = await writePlanOffers(tx, plans.growth!.id, [
      { addonId: packs.mkt_booking!.uuid, mode: 'hidden', amount: null },
    ]);
    expect(hidGrowth.features).toEqual({});
    expect(await visibleOn('growth', 'mkt_booking')).toBe(false);
    await expect(
      writePlanOffers(tx, plans.growth!.id, [
        { addonId: packs.mkt_booking!.uuid, mode: 'paid', amount: '5.00' },
      ]),
    ).rejects.toThrow(/validation/i);
  });

  it('the table refuses a price on a non-paid offer and an app pack, whoever writes', async () => {
    await expect(
      owner.query(
        `INSERT INTO plan_addon_offers (plan_id, addon_id, mode, amount) VALUES ($1, $2, 'hidden', 5)`,
        [plans.basic!.id, packs.smart!.id],
      ),
    ).rejects.toThrow(/chk_plan_addon_offers_amount/);
    await expect(
      owner.query(
        `INSERT INTO plan_addon_offers (plan_id, addon_id, mode, amount) VALUES ($1, $2, 'paid', 5)`,
        [plans.basic!.id, packs.mkt_booking!.id],
      ),
    ).rejects.toThrow(/no plan price/);
    await expect(
      owner.query(
        `INSERT INTO plan_addon_offers (plan_id, addon_id, mode) VALUES ($1, $2, 'paid')`,
        [plans.basic!.id, plans.growth!.id],
      ),
    ).rejects.toThrow(/must be an add-on/);
    await expect(
      owner.query(
        `INSERT INTO plan_addon_offers (plan_id, addon_id, mode) VALUES ($1, $2, 'paid')`,
        [packs.smart!.id, plans.basic!.id],
      ),
    ).rejects.toThrow(/must be a plan/);
  });

  it('the pack editor writes several plans and each plan follows in its features', async () => {
    const changed = await writeAddonOffers(tx, packs.smart!, [
      { planId: plans.growth!.uuid, mode: 'included', amount: null },
      { planId: plans.basic!.uuid, mode: 'paid', amount: '199.00' },
      { planId: plans.free!.uuid, mode: 'hidden', amount: null },
    ]);
    expect(changed.sort()).toEqual(['basic', 'free', 'growth']);
    expect(await featuresOf('growth')).toMatchObject({
      inbox_routing: true,
      inbox_assignment_sticky: true,
    });
    expect(await featuresOf('basic')).toMatchObject({ inbox_routing: false, analytics: true });
    const all = await offersForAddon(tx, packs.smart!.id);
    expect(all.find((o) => o.planSlug === 'basic')).toMatchObject({
      mode: 'paid',
      amount: '199.00',
      stored: true,
    });
  });

  it('plans that include a pack follow a change of its features', async () => {
    await writeAddonOffers(tx, packs.smart!, [
      { planId: plans.growth!.uuid, mode: 'included', amount: null },
    ]);
    await resyncIncludedPlans(
      tx,
      packs.smart!.id,
      ['inbox_assignment_sticky', 'inbox_routing'],
      ['inbox_routing', 'inbox_sla'],
    );
    expect(await featuresOf('growth')).toMatchObject({
      inbox_routing: true,
      inbox_sla: true,
      inbox_assignment_sticky: false,
    });
    // a plan that chose Paid does not get a newly granted feature (even one whose default is on)
    await writeAddonOffers(tx, packs.smart!, [
      { planId: plans.basic!.uuid, mode: 'paid', amount: '199.00' },
    ]);
    await resyncIncludedPlans(
      tx,
      packs.smart!.id,
      ['inbox_routing', 'inbox_sla'],
      ['inbox_routing', 'inbox_sla', 'team_hierarchy'],
    );
    expect(await featuresOf('basic')).toMatchObject({ team_hierarchy: false });
    expect(await featuresOf('growth')).toMatchObject({ team_hierarchy: true });
    // A pack left with no feature is a capacity add-on: it can no longer be included.
    await resyncIncludedPlans(
      tx,
      packs.smart!.id,
      ['inbox_routing', 'inbox_sla', 'team_hierarchy'],
      [],
    );
    expect(offerOf(await offersOfPlanSlug(tx, 'growth'), packs.smart!.id).mode).toBe('paid');
  });

  it('the migration backfill marks Included where a plan already grants every feature of a feature add-on', async () => {
    await plan('scale', { inbox_routing: true, inbox_assignment_sticky: true });
    await plan('partial', { inbox_routing: true });
    const file = readFileSync(resolve(MIGRATIONS, '20270331090100_plan_addon_offers.sql'), 'utf8');
    const backfill = file.slice(file.indexOf('INSERT INTO plan_addon_offers'));
    await owner.query(backfill);
    const scale = await offersOfPlanSlug(tx, 'scale');
    expect(offerOf(scale, packs.smart!.id).mode).toBe('included');
    // limits-only packs are never backfilled, and a partly covered plan stays paid
    expect(scale.has(packs.seat!.id)).toBe(false);
    expect(offerOf(await offersOfPlanSlug(tx, 'partial'), packs.smart!.id).mode).toBe('paid');
  });

  it('the migration backfills the add-on kind: capacity only when it adds limits and no feature, the seeded feature packs stay feature', async () => {
    await owner.query(
      `UPDATE plans SET addon_kind = NULL WHERE kind = 'addon' AND marketplace_app_id IS NULL`,
    );
    const file = readFileSync(
      resolve(MIGRATIONS, '20270401090000_addon_kind_and_app_offers.sql'),
      'utf8',
    );
    const from = file.indexOf('UPDATE plans p SET addon_kind');
    await owner.query(file.slice(from, file.indexOf('CREATE OR REPLACE FUNCTION')));
    const kinds = Object.fromEntries(
      (
        await owner.query(
          `SELECT slug, addon_kind FROM plans WHERE kind = 'addon' AND marketplace_app_id IS NULL`,
        )
      ).rows.map((r) => [r.slug, r.addon_kind]),
    );
    expect(kinds).toMatchObject({
      smart: 'feature',
      seat: 'capacity',
      empty: 'feature',
      smart_routing: 'feature',
    });
  });
});
