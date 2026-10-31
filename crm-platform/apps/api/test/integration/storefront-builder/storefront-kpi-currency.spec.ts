import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDbClientPair, runMigrations, type DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { SqlOrdersGateway } from '../../../src/modules/storefront-builder/_shims/sql-orders-gateway';

/**
 * The storefront dashboard adds order totals in the shop's own currency only. A workspace with an INR shop and a USD shop must show
 * the INR figures for the INR shop, never the sum of both. Runs against a real Postgres as the restricted application role.
 */
const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');

describe('storefront dashboard figures are in the shop currency', () => {
  let container: StartedPostgreSqlContainer | undefined;
  let owner: Client;
  let clients: DbClientPair;
  let db: DatabaseService;
  let orders: SqlOrdersGateway;
  let org: number;

  beforeAll(async () => {
    const existing = process.env.STORAGE_TEST_DATABASE_URL;
    let appUrl: string;
    if (existing) {
      owner = new Client({ connectionString: existing });
      const u = new URL(existing);
      appUrl = `postgres://crm_app_user:test@${u.host}${u.pathname}`;
    } else {
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
      appUrl = `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`;
    }
    if (existing) await owner.connect();
    clients = createDbClientPair({ url: appUrl, poolMax: 12 });
    db = new DatabaseService(clients);
    orders = new SqlOrdersGateway({} as never, {} as never);
    org = Number(
      (
        await owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, $1) RETURNING id`, [
          `kpi-currency-${Date.now().toString(36)}`,
        ])
      ).rows[0].id,
    );
    // An INR shop sells 1,000 INR; a USD shop sells 100 USD. Minor units: paise and cents.
    await owner.query(
      `INSERT INTO wa_orders (org_id, source, items_json, total_minor, currency_code) VALUES
         ($1, 'storefront', '[{"name":"Tea","qty":2}]', 100000, 'INR'),
         ($1, 'storefront', '[{"name":"Mug","qty":1}]', 10000, 'USD')`,
      [org],
    );
  }, 600_000);

  afterAll(async () => {
    await clients?.close();
    await owner?.end();
    await container?.stop();
  });

  it('the window total for an INR shop is its INR orders only', async () => {
    const win = await db.txAs({ orgId: org, userId: null }, (tx) =>
      orders.window(tx, org, 30, 'INR'),
    );
    expect(win).toEqual({ revenueMinor: 100000, orders: 1 });
  });

  it('the daily sales for a USD shop are its USD orders only', async () => {
    const byDay = await db.txAs({ orgId: org, userId: null }, (tx) =>
      orders.salesByDay(tx, org, 30, 'USD'),
    );
    expect(byDay.reduce((a, d) => a + d.revenueMinor, 0)).toBe(10000);
    expect(byDay.reduce((a, d) => a + d.orders, 0)).toBe(1);
  });
});
