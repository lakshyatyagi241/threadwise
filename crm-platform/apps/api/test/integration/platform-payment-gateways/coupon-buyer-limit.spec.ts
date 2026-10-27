import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CouponService } from '../../../src/modules/platform-payment-gateways/coupon.service';

const OWNER_URL = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!;

/**
 * Issue #1069: a first-purchase or per-buyer coupon limit counted orders inside one workspace, so a buyer who had paid in one workspace
 * could use the coupon again in a new one. The buyer is now counted by email across every workspace.
 */
describe('coupon buyer limits count the buyer across workspaces (#1069)', () => {
  let owner: Client;
  let pool: Pool;
  let orgA: number;
  let orgB: number;
  let code: string;
  let couponId: number;
  const buyer = `Buyer${Date.now()}@Example.test`;

  beforeAll(async () => {
    owner = new Client({ connectionString: OWNER_URL });
    await owner.connect();
    pool = new Pool({ connectionString: OWNER_URL, max: 2 });
    const mk = async (slug: string) =>
      Number(
        (await owner.query(`INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`, [`${slug}-${Date.now()}`])).rows[0].id,
      );
    orgA = await mk('cpnA');
    orgB = await mk('cpnB');
    code = `FIRST${Date.now()}`;
    couponId = Number(
      (await owner.query(`INSERT INTO coupons (code, type, amount, first_purchase_only) VALUES ($1, 'percent', 10, true) RETURNING id`, [code])).rows[0].id,
    );
    await owner.query(
      `INSERT INTO orders (org_id, order_number, currency, amount, kind, plan_slug, status, customer_email)
       VALUES ($1, $2, 'USD', 100, 'plan', 'plana', 'paid', $3)`,
      [orgA, `ORD-${Date.now()}`, buyer],
    );
  });

  afterAll(async () => {
    await pool.end();
    await owner.query('DELETE FROM orders WHERE org_id = ANY($1::bigint[])', [[orgA, orgB]]);
    await owner.query('DELETE FROM coupons WHERE id = $1', [couponId]);
    await owner.query('DELETE FROM organizations WHERE id = ANY($1::bigint[])', [[orgA, orgB]]);
    await owner.end();
  });

  const resolve = (email: string) => {
    const store = { tx: <T>(fn: (tx: never) => Promise<T>) => drizzle(pool).transaction((tx) => fn(tx as never)) };
    return new CouponService(store as never).resolve({
      code,
      planSlug: 'plana',
      subtotalMinor: 10000n,
      currency: 'USD',
      orgId: orgB,
      userId: null,
      buyerEmail: email,
    });
  };

  it('refuses a first-purchase coupon to a buyer who paid in another workspace (email case-insensitive)', async () => {
    const r = await resolve(buyer.toLowerCase());
    expect(r.ok).toBe(false);
  });

  it('accepts the same coupon for a buyer with no paid order anywhere', async () => {
    const r = await resolve(`fresh${Date.now()}@example.test`);
    expect(r.ok).toBe(true);
  });
});
