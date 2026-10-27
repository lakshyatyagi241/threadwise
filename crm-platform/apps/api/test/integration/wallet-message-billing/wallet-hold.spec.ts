import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WalletRepository } from '../../../src/modules/wallet-message-billing/wallet.repository';

// The owner connection arranges rows; the restricted application role (the same switch as the BSP helper) is what row-level
// security judges. Read from the process environment: the .env file is not part of this checkout.
const OWNER_URL = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL!;
const APP_URL = `${OWNER_URL}${OWNER_URL.includes('?') ? '&' : '?'}options=-c%20role%3Dcrm_app_user`;

const TTL = 600;
const ONE = 100; // one unit, in minor units

/**
 * The per-send hold on a wallet against the real schema, as the restricted application role: holds race for a balance, lapsed holds
 * give their amount back, and a settled hold leaves `reserved` with its charge.
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

  const wallet = async () =>
    (
      await owner.query(
        'SELECT balance::text AS balance, reserved::text AS reserved FROM wallets WHERE org_id = $1 AND unit = $2',
        [orgId, unit],
      )
    ).rows[0] as { balance: string; reserved: string };

  const holdStatuses = async () =>
    (
      await owner.query(
        'SELECT status, count(*)::int AS n FROM wallet_holds WHERE org_id = $1 GROUP BY status ORDER BY status',
        [orgId],
      )
    ).rows as Array<{ status: string; n: number }>;

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
      Array.from({ length: 20 }, () => inOrg((tx) => repo.holdMinor(tx, orgId, unit, ONE, TTL))),
    );
    expect(results.filter((id) => id !== null)).toHaveLength(5);
    expect(await wallet()).toEqual({ balance: '5.0000', reserved: '5.0000' });
    expect(await holdStatuses()).toEqual([{ status: 'held', n: 5 }]);
  });

  it('refuses a hold once the balance is fully held', async () => {
    expect(await inOrg((tx) => repo.holdMinor(tx, orgId, unit, ONE, TTL))).toBeNull();
  });

  it('settles the oldest hold when its delivery is charged, so the charged unit is no longer held', async () => {
    await inOrg(async (tx) => {
      await repo.settleHold(tx, orgId, unit);
      await repo.capReserved(tx, orgId, unit);
    });
    // The ledger post in the same transaction takes the charge off the balance.
    await owner.query(`UPDATE wallets SET balance = balance - 1 WHERE org_id = $1 AND unit = $2`, [
      orgId,
      unit,
    ]);
    expect(await wallet()).toEqual({ balance: '4.0000', reserved: '4.0000' });
    expect(await holdStatuses()).toEqual([
      { status: 'consumed', n: 1 },
      { status: 'held', n: 4 },
    ]);
    // Four units are still held against a balance of four: nothing is free for the next send.
    expect(await inOrg((tx) => repo.holdMinor(tx, orgId, unit, ONE, TTL))).toBeNull();
  });

  it('gives back a lapsed hold before judging the next send, so a lost delivery cannot lock the balance', async () => {
    // A top-up of one unit: balance 5, four still held, one unit free.
    await owner.query(`UPDATE wallets SET balance = balance + 1 WHERE org_id = $1 AND unit = $2`, [
      orgId,
      unit,
    ]);
    // A hold that is already past its expiry takes the free unit.
    expect(await inOrg((tx) => repo.holdMinor(tx, orgId, unit, ONE, -1))).not.toBeNull();
    expect(await wallet()).toEqual({ balance: '5.0000', reserved: '5.0000' });
    // The lapsed hold is swept first: its unit is free again, so this send is allowed.
    expect(await inOrg((tx) => repo.holdMinor(tx, orgId, unit, ONE, TTL))).not.toBeNull();
    expect(await wallet()).toEqual({ balance: '5.0000', reserved: '5.0000' });
    expect(await holdStatuses()).toEqual([
      { status: 'consumed', n: 1 },
      { status: 'expired', n: 1 },
      { status: 'held', n: 5 },
    ]);
  });

  it('holds nothing in a unit the workspace has no wallet for', async () => {
    expect(await inOrg((tx) => repo.holdMinor(tx, orgId, 'EUR', ONE, TTL))).toBeNull();
  });
});
