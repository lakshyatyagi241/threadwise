import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, type Tx } from '@crm/db';
import { addonRenewalImpact } from '../../../src/modules/plans-subscriptions-trials/plan-addon-impact';

/**
 * The operator's "who pays for this add-on on THIS plan" count (plan editor, Add-ons tab). Real Postgres with every migration, so the
 * joins run against the real schema. It must count the same subscriptions the renewal-stop job ends (`AddonRedundancyService`):
 * kind 'addon', status active or past_due, a plain pack (no Marketplace app), one count per workspace, only workspaces on the plan.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

describe('addonRenewalImpact', () => {
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let tx: Tx;
  const orgs: Record<string, number> = {};
  const packs: Record<string, { id: number; uuid: string }> = {};

  async function org(slug: string, plan: string): Promise<void> {
    const r = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, $2) RETURNING id`,
      [slug, plan],
    );
    orgs[slug] = Number(r.rows[0].id);
  }

  async function pack(key: string, marketplaceAppId: number | null = null): Promise<void> {
    const r = await owner.query(
      `INSERT INTO plans (slug, kind, name, amount, marketplace_app_id) VALUES ($1, 'addon', $1, 9, $2) RETURNING id, uuid`,
      [key, marketplaceAppId],
    );
    packs[key] = { id: Number(r.rows[0].id), uuid: String(r.rows[0].uuid) };
  }

  /** The workspace holds the pack, with a subscription in the given status (null = bought once, no subscription). */
  async function holds(orgKey: string, packKey: string, status: string | null): Promise<void> {
    const wa = await owner.query(
      `INSERT INTO workspace_addons (org_id, package_id, status) VALUES ($1, $2, 'active') RETURNING id`,
      [orgs[orgKey], packs[packKey]!.id],
    );
    if (status === null) return;
    await owner.query(
      `INSERT INTO subscriptions (org_id, plan_id, kind, workspace_addon_id, gateway, gateway_subscription_id, billing_cycle, status, amount, currency)
       VALUES ($1, 'x', 'addon', $2, 'razorpay', $3, 'monthly', $4, 9, 'USD')`,
      [orgs[orgKey], wa.rows[0].id, `sub_${orgKey}_${packKey}_${status}`, status],
    );
  }

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

    await org('pro1', 'pro');
    await org('pro2', 'pro');
    await org('pro3', 'pro');
    await org('pro4', 'pro');
    await org('other', 'growth');
    await pack('smart');
    await pack('teams');
    const cat = await owner.query('SELECT id FROM marketplace_categories LIMIT 1');
    const app = await owner.query(
      `INSERT INTO marketplace_apps (slug, kind, category_id, name, tagline, status, pricing_model, price_amount, price_currency)
       VALUES ('crm-booking', 'mini_app', $1, 'crm-booking', 't', 'draft', 'paid_monthly', 9, 'USD') RETURNING id`,
      [cat.rows[0].id],
    );
    await pack('mkt_booking', Number(app.rows[0].id));

    await holds('pro1', 'smart', 'active');
    await holds('pro2', 'smart', 'past_due'); // still retrying: the job ends it too
    await holds('pro3', 'smart', 'canceled'); // already stopped: not renewing
    await holds('pro4', 'smart', null); // one-time purchase: no subscription
    await holds('other', 'smart', 'active'); // a different plan
    await holds('pro1', 'teams', 'active');
    await holds('pro1', 'mkt_booking', 'active'); // a Marketplace app's pack is the Marketplace's, never counted here
    await holds('pro1', 'teams', 'active'); // stacked second purchase: one workspace, counted once
  }, 300_000);

  afterAll(async () => {
    await owner?.end();
    await container?.stop();
  });

  it('counts the workspaces on the plan that still renew each pack, once per workspace', async () => {
    const out = await addonRenewalImpact(tx, 'pro');
    const byPack = new Map(out.data.map((r) => [r.packId, r.renewing]));
    expect(byPack.get(packs.smart!.uuid)).toBe(2); // pro1 active + pro2 past_due
    expect(byPack.get(packs.teams!.uuid)).toBe(1); // pro1 twice = one workspace
    expect(out.data).toHaveLength(2);
  });

  it('is scoped to the plan: another plan sees only its own workspaces', async () => {
    const out = await addonRenewalImpact(tx, 'growth');
    expect(out.data).toEqual([{ packId: packs.smart!.uuid, renewing: 1 }]);
  });

  it('a plan nobody renews anything on is an empty list, and a Marketplace pack is never counted', async () => {
    expect((await addonRenewalImpact(tx, 'nobody')).data).toEqual([]);
  });
});
