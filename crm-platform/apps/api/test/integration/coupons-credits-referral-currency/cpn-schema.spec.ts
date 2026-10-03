import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@crm/db';

/**
 * The CPN tables against a real Postgres as the restricted application role (a superuser would bypass every policy): the platform
 * tables are invisible or read-only to a workspace, redemptions are isolated per workspace, and the integrity rules hold even for
 * a writer that skips the service. Constraint checks use the owner connection (owners skip RLS, never CHECK).
 */
describe('CPN schema, RLS and integrity rules', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let app: Client;
  let orgA: number;
  let orgB: number;
  let orderA: number;
  let couponId: number;

  async function inTx<T>(setup: string[], fn: () => Promise<T>): Promise<T> {
    await app.query('BEGIN');
    try {
      for (const s of setup) await app.query(s);
      return await fn();
    } finally {
      await app.query('ROLLBACK');
    }
  }
  const asOrg = <T>(id: number, fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.org_id', '${id}', true)`], fn);
  const privileged = <T>(fn: () => Promise<T>) =>
    inTx([`SELECT set_config('app.privileged', 'on', true)`], fn);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });
    const org = async (slug: string) =>
      Number(
        (
          await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
            slug,
          ])
        ).rows[0].id,
      );
    orgA = await org('cpn-org-a');
    orgB = await org('cpn-org-b');
    couponId = Number(
      (await owner.query(`INSERT INTO coupons (code, amount) VALUES ('RLS10', 10) RETURNING id`))
        .rows[0].id,
    );
    const o = (org_id: number, n: string) =>
      owner.query(
        `INSERT INTO orders (org_id, order_number, currency, amount, kind, plan_slug, status, coupon_id, coupon_code)
         VALUES ($1, $2, 'USD', 10, 'plan', 'p', 'paid', $3, 'RLS10') RETURNING id`,
        [org_id, n, couponId],
      );
    orderA = Number((await o(orgA, 'CPN-A')).rows[0].id);
    const orderB = Number((await o(orgB, 'CPN-B')).rows[0].id);
    await owner.query(
      `INSERT INTO coupon_redemptions (org_id, order_id, coupon_id, coupon_code) VALUES ($1, $2, $3, 'RLS10')`,
      [orgA, orderA, couponId],
    );
    await owner.query(
      `INSERT INTO coupon_redemptions (org_id, order_id, coupon_id, coupon_code) VALUES ($1, $2, $3, 'RLS10')`,
      [orgB, orderB, couponId],
    );

    app = new Client({
      host: container.getHost(),
      port: container.getPort(),
      database: 'crm',
      user: 'crm_app_user',
      password: 'test',
    });
    await app.connect();
  }, 180_000);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await container?.stop();
  });

  it('a workspace cannot see or write coupons (platform data behind the privileged flag)', async () => {
    await asOrg(orgA, async () => {
      expect((await app.query(`SELECT * FROM coupons`)).rowCount).toBe(0);
      await expect(
        app.query(`INSERT INTO coupons (code, amount) VALUES ('HACK', 100)`),
      ).rejects.toThrow(/row-level security/);
    });
    await privileged(async () => {
      expect((await app.query(`SELECT * FROM coupons`)).rowCount).toBe(1);
    });
  });

  it('a workspace reads credit packages and currencies but cannot change them', async () => {
    await asOrg(orgA, async () => {
      expect((await app.query(`SELECT * FROM credit_packages`)).rowCount).toBe(3);
      expect((await app.query(`SELECT * FROM currencies`)).rowCount).toBe(30);
    });
    await asOrg(orgA, async () => {
      const r = await app.query(`UPDATE credit_packages SET credits = 1`);
      expect(r.rowCount).toBe(0);
    });
    await asOrg(orgA, async () => {
      await expect(
        app.query(`INSERT INTO currencies (code, name) VALUES ('ZZZ', 'z')`),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('redemptions are isolated per workspace, in both directions', async () => {
    await asOrg(orgA, async () => {
      const r = await app.query(`SELECT org_id FROM coupon_redemptions`);
      expect(r.rows.map((x) => Number(x.org_id))).toEqual([orgA]);
      await expect(
        app.query(
          `INSERT INTO coupon_redemptions (org_id, order_id, coupon_code) VALUES ($1, 999, 'X')`,
          [orgB],
        ),
      ).rejects.toThrow(/row-level security|violates/);
    });
  });

  it('one order can be redeemed once: a second row for it is refused', async () => {
    await expect(
      owner.query(
        `INSERT INTO coupon_redemptions (org_id, order_id, coupon_code) VALUES ($1, $2, 'RLS10')`,
        [orgA, orderA],
      ),
    ).rejects.toThrow(/uq_coupon_redemptions_order/);
  });

  it("a redemption cannot name another workspace's order (composite key)", async () => {
    await expect(
      owner.query(
        `INSERT INTO coupon_redemptions (org_id, order_id, coupon_code) VALUES ($1, 424242, 'X')`,
        [orgA],
      ),
    ).rejects.toThrow(/fk_coupon_redemptions_order/);
  });

  it('deleting a coupon keeps the redemption history with its code snapshot', async () => {
    const c = Number(
      (await owner.query(`INSERT INTO coupons (code, amount) VALUES ('GONE1', 5) RETURNING id`))
        .rows[0].id,
    );
    const ord = Number(
      (
        await owner.query(
          `INSERT INTO orders (org_id, order_number, currency, amount, kind, plan_slug, status, coupon_id, coupon_code)
           VALUES ($1, 'CPN-GONE', 'USD', 5, 'plan', 'p', 'paid', $2, 'GONE1') RETURNING id`,
          [orgA, c],
        )
      ).rows[0].id,
    );
    await owner.query(
      `INSERT INTO coupon_redemptions (org_id, order_id, coupon_id, coupon_code) VALUES ($1, $2, $3, 'GONE1')`,
      [orgA, ord, c],
    );
    await owner.query(`DELETE FROM coupons WHERE id = $1`, [c]);
    const r = await owner.query(
      `SELECT coupon_id, coupon_code FROM coupon_redemptions WHERE order_id = $1`,
      [ord],
    );
    expect(r.rows[0]).toEqual({ coupon_id: null, coupon_code: 'GONE1' });
  });

  describe('integrity rules hold for a writer that skips the service', () => {
    const bad = (sql: string, name: RegExp, args: unknown[] = []) =>
      expect(owner.query(sql, args)).rejects.toThrow(name);

    it('coupon codes are upper-case and unique', async () => {
      await bad(`INSERT INTO coupons (code, amount) VALUES ('lower', 1)`, /chk_coupons_code/);
      await bad(`INSERT INTO coupons (code, amount) VALUES ('RLS10', 1)`, /uq_coupons_code/);
    });
    it('coupon type, amount, caps and window', async () => {
      await bad(
        `INSERT INTO coupons (code, amount, type) VALUES ('T1', 1, 'bogus')`,
        /chk_coupons_type/,
      );
      await bad(`INSERT INTO coupons (code, amount) VALUES ('T2', -1)`, /chk_coupons_amount/);
      await bad(
        `INSERT INTO coupons (code, amount, max_uses) VALUES ('T3', 1, 0)`,
        /chk_coupons_caps/,
      );
      await bad(
        `INSERT INTO coupons (code, amount, per_user_limit) VALUES ('T4', 1, 0)`,
        /chk_coupons_caps/,
      );
      await bad(
        `INSERT INTO coupons (code, amount, starts_at, expires_at) VALUES ('T5', 1, '2030-02-01', '2030-01-01')`,
        /chk_coupons_window/,
      );
      await bad(
        `INSERT INTO coupons (code, amount, applicable_package_ids) VALUES ('T6', 1, '{"a":1}')`,
        /chk_coupons_plans/,
      );
    });
    it('credit packages: slug shape, credits, price, sort order, currency shape', async () => {
      const ins = (over: string) =>
        `INSERT INTO credit_packages (name, slug, price_minor, currency_code, credits, sort_order) VALUES ${over}`;
      await bad(ins(`('n', 'bad slug', 1, 'INR', 1, 0)`), /chk_credit_packages_slug/);
      await bad(ins(`('n', 'ok1', -1, 'INR', 1, 0)`), /chk_credit_packages_price/);
      await bad(ins(`('n', 'ok2', 1, 'INR', 0, 0)`), /chk_credit_packages_credits/);
      await bad(ins(`('n', 'ok3', 1, 'INR', 1, 10000)`), /chk_credit_packages_sort/);
      await bad(ins(`('n', 'ok4', 1, 'inr', 1, 0)`), /chk_credit_packages_currency/);
      await bad(ins(`('n', 'starter', 1, 'INR', 1, 0)`), /uq_credit_packages_slug/);
    });
    it('currencies: three upper-case letters, decimals 0-6, a positive rate, unique code', async () => {
      await bad(`INSERT INTO currencies (code, name) VALUES ('usd1', 'x')`, /chk_currencies_code/);
      await bad(
        `INSERT INTO currencies (code, name, "precision") VALUES ('ZZA', 'x', 7)`,
        /chk_currencies_precision/,
      );
      await bad(
        `INSERT INTO currencies (code, name, exchange_rate) VALUES ('ZZB', 'x', 0)`,
        /chk_currencies_rate/,
      );
      await bad(`INSERT INTO currencies (code, name) VALUES ('USD', 'x')`, /uq_currencies_code/);
    });
  });

  it('starts with the 30 starter currencies (USD = 1, JPY 0 decimals) and the 3 starter packages, only once', async () => {
    const usd = (
      await owner.query(`SELECT exchange_rate::text AS r FROM currencies WHERE code = 'USD'`)
    ).rows[0];
    expect(Number(usd.r)).toBe(1);
    const jpy = (await owner.query(`SELECT "precision" FROM currencies WHERE code = 'JPY'`))
      .rows[0];
    expect(jpy.precision).toBe(0);
    const inr = (await owner.query(`SELECT symbol FROM currencies WHERE code = 'INR'`)).rows[0];
    expect(inr.symbol).toBe('₹');
    const rows = await owner.query(
      `SELECT slug, price_minor::int AS p, credits::int AS c, is_featured FROM credit_packages ORDER BY sort_order`,
    );
    expect(rows.rows).toEqual([
      { slug: 'starter', p: 10000, c: 5000, is_featured: false },
      { slug: 'growth', p: 50000, c: 27500, is_featured: true },
      { slug: 'scale', p: 100000, c: 60000, is_featured: false },
    ]);
  });
});
