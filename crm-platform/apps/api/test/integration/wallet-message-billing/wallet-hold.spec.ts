import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WalletRepository } from '../../../src/modules/wallet-message-billing/wallet.repository';

// The owner connection arranges rows; the restricted application role (the same switch as the BSP helper) is what row-level
// security judges. Read from the process environment: the .env file is not part of this checkout.
const OWNER_URL = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!;
const APP_URL = `${OWNER_URL}${OWNER_URL.includes('?') ? '&' : '?'}options=-c%20role%3Dcrm_app_user`;

/**
 * The per-send hold on a wallet (`wallets.reserved`) against the real schema, as the restricted application role. Twenty holds
 * race for a balance that covers five: exactly five may pass, because the conditional UPDATE queues on the wallet row.
 */
describe('wallet hold: concurrent sends cannot spend the same balance', () => {
  const unit = 'USD';
  let owner: Client;
  let app: Pool;
  let orgId: number;
  const repo = new WalletRepository();

  /** One transaction in the workspace, the way the app's own transactions set the tenant for row-level security. */
  const inOrg = <T>(fn: (tx: never) => Promise<T>): Promise<T> =>
    drizzle(app).transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.org_id', ${String(orgId)}, true)`);
      return fn(tx as never);
    });

  beforeAll(async () => {
    owner = new Client({ connectionString: OWNER_URL });
    await owner.connect();
    app = new Pool({ connectionString: APP_URL, max: 20 });
    const org = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`,
      [`wallet-hold-${Date.now()}`],
    );
    orgId = Number(org.rows[0].id);
    await owner.query(`INSERT INTO wallets (org_id, unit, balance) VALUES ($1, $2, 5.0000)`, [
      orgId,
      unit,
    ]);
  });

  afterAll(async () => {
    await app.end();
    await owner.query('DELETE FROM wallets WHERE org_id = $1', [orgId]);
    await owner.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await owner.end();
  });

  it('lets exactly five of twenty concurrent one-unit holds through a balance of five', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => inOrg((tx) => repo.holdMinor(tx, orgId, unit, 100))),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    const row = await owner.query(
      'SELECT balance::text AS balance, reserved::text AS reserved FROM wallets WHERE org_id = $1 AND unit = $2',
      [orgId, unit],
    );
    expect(row.rows[0]).toEqual({ balance: '5.0000', reserved: '5.0000' });
  });

  it('refuses a hold once the balance is fully held, and frees one when a hold is released', async () => {
    expect(await inOrg((tx) => repo.holdMinor(tx, orgId, unit, 100))).toBe(false);
    await inOrg((tx) => repo.releaseMinor(tx, orgId, unit, 100));
    expect(await inOrg((tx) => repo.holdMinor(tx, orgId, unit, 100))).toBe(true);
    expect(await inOrg((tx) => repo.holdMinor(tx, orgId, unit, 100))).toBe(false);
  });

  it('holds nothing in a unit the workspace has no wallet for', async () => {
    expect(await inOrg((tx) => repo.holdMinor(tx, orgId, 'EUR', 100))).toBe(false);
  });
});
