import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials';
import { LEAD_SCORING_CONFIG } from '../../../src/modules/marketplace/cli/seed-app.config';
import { parseArgs } from '../../../src/modules/marketplace/cli/seed-app.args';
import { runSeedLeadScoring } from '../../../src/modules/marketplace/cli/seed-lead-scoring.runner';
import { Api, startHarness, type Harness, type Tenant } from './support';

/**
 * The `seed:lead-scoring` local-development command on a freshly migrated Postgres: the operator's steps (price, comp the workspaces that already
 * use scoring, publish, show the add-on on the plans, install) through the same services the console calls. The shared guards and the other
 * apps' flows are covered by seed-appointments, seed-forms and seed-email.
 */
let h: Harness;
let A: Tenant; // already uses scoring (the switch is on) but was created after the migration, so it has no override yet
let B: Tenant; // never used it

const run = (...argv: string[]) => {
  const parsed = parseArgs(argv, LEAD_SCORING_CONFIG);
  if (parsed.kind !== 'options') throw new Error(JSON.stringify(parsed));
  return runSeedLeadScoring(h.app, parsed.options);
};
const one = async <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
  (await h.owner.query(query, params)).rows[0] as T;
const n = async (query: string, params: unknown[] = []) =>
  Number((await one<{ n: string }>(query, params)).n);
const has = (t: Tenant) =>
  h.app.get(PlanEntitlementService).featureEnabled(t.orgId, 'lead_scoring');

beforeAll(async () => {
  h = await startHarness();
  const api = new Api(h);
  await h.owner.query(
    `INSERT INTO plans (slug, kind, name, amount, currency, sort_order, is_free) VALUES ('freebie', 'plan', 'Freebie', 0, 'USD', 1, true)`,
  );
  A = await api.signup('seedLsA');
  B = await api.signup('seedLsB');
  await h.owner.query(`UPDATE organizations SET plan = 'freebie' WHERE id = ANY($1::bigint[])`, [
    [A.orgId, B.orgId],
  ]);
  await h.owner.query(`INSERT INTO lead_scoring_settings (org_id, enabled) VALUES ($1, true)`, [
    A.orgId,
  ]);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('seed:lead-scoring', () => {
  it('starts as the migration leaves it: a draft with no price, scoring locked', async () => {
    expect(
      await one(`SELECT status, price_amount FROM marketplace_apps WHERE slug = 'lead-scoring'`),
    ).toMatchObject({ status: 'draft', price_amount: null });
    expect(await has(A)).toBe(false);
    expect(await has(B)).toBe(false);
  });

  it('--dry-run reports the plan, including the comp of workspaces that already use scoring, and writes nothing', async () => {
    const out = await run('--dry-run');
    expect(out.actions.join('\n')).toMatch(/set the price to 999.00 INR/);
    expect(out.actions.join('\n')).toMatch(/comp every workspace already using AI lead scoring/);
    expect(out.actions.join('\n')).toMatch(/publish the listing/);
    expect(await n(`SELECT count(*) AS n FROM marketplace_subscriptions`)).toBe(0);
  });

  it('prices, comps the workspace that already uses scoring (and nobody else), publishes, and installs it where it was comped', async () => {
    const out = await run();
    expect(out.after).toMatchObject({ status: 'published', price: '999.00 INR per month' });
    expect(await has(A)).toBe(true);
    expect(await has(B)).toBe(false);
    expect(
      await n(
        `SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1 AND source = 'comp'`,
        [A.orgId],
      ),
    ).toBe(1);
    expect(
      await n(
        `SELECT count(*) AS n FROM workspace_app_installations WHERE org_id = $1 AND status = 'active'`,
        [A.orgId],
      ),
    ).toBe(1);
    expect(
      await n(`SELECT count(*) AS n FROM marketplace_subscriptions WHERE org_id = $1`, [B.orgId]),
    ).toBe(0);
  });

  it('a second run changes nothing', async () => {
    const out = await run();
    expect(out.actions).toEqual([]);
    expect(out.before).toEqual(out.after);
  });
});
