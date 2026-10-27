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

/** Every message down the `cause` chain, joined: the database's own text is the innermost one. */
const messageChain = (e: unknown): string => {
  let out = '';
  let cur: unknown = e;
  while (cur instanceof Error || (typeof cur === 'object' && cur !== null && 'message' in cur)) {
    out += ` ${(cur as { message: string }).message}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
};

/**
 * A delivered send's charge and its hold settlement, in the order the billing services run them. The balance may not fall below
 * `reserved` at any statement (chk_wallet_invariant), so the hold must leave `reserved` before the charge lowers the balance.
 */
describe('wallet charge and hold settlement: the balance check holds at every statement', () => {
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

  /** The ledger post's balance update, as the ledger writes it. */
  const chargeOneUnit = (tx: never) =>
    (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`UPDATE wallets SET balance = balance - 1 WHERE org_id = ${orgId} AND unit = ${unit}`,
    );

  beforeAll(async () => {
    owner = new Client({ connectionString: OWNER_URL });
    await owner.connect();
    app = new Pool({ connectionString: APP_URL, max: 5 });
    const org = await owner.query(
      `INSERT INTO organizations (slug, name, plan) VALUES ($1, $1, 'starter') RETURNING id`,
      [`wallet-settle-${Date.now()}`],
    );
    orgId = Number(org.rows[0].id);
    await owner.query(`INSERT INTO wallets (org_id, unit, balance) VALUES ($1, $2, 5.0000)`, [
      orgId,
      unit,
    ]);
    // Five one-unit holds against a balance of five: the wallet is fully held, as in the report.
    for (let i = 0; i < 5; i++) {
      await inOrg((tx) => repo.holdMinor(tx, orgId, unit, ONE, TTL));
    }
    expect(await wallet()).toEqual({ balance: '5.0000', reserved: '5.0000' });
  });

  afterAll(async () => {
    await app.end();
    await owner.query('DELETE FROM wallet_holds WHERE org_id = $1', [orgId]);
    await owner.query('DELETE FROM wallets WHERE org_id = $1', [orgId]);
    await owner.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await owner.end();
  });

  it('refuses the charge when it lowers the balance before its hold leaves reserved', async () => {
    // The driver wraps the database error: the constraint name is in the cause chain, not the top message.
    const err = await inOrg((tx) => chargeOneUnit(tx)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(messageChain(err)).toMatch(/chk_wallet_invariant/);
    // The rejected transaction rolled back: nothing was charged and every hold is still open.
    expect(await wallet()).toEqual({ balance: '5.0000', reserved: '5.0000' });
    expect(await holdStatuses()).toEqual([{ status: 'held', n: 5 }]);
  });

  it('lets the same charge through once the hold is settled first', async () => {
    await inOrg(async (tx) => {
      await repo.settleHold(tx, orgId, unit);
      await chargeOneUnit(tx as never);
      await repo.capReserved(tx, orgId, unit);
    });
    expect(await wallet()).toEqual({ balance: '4.0000', reserved: '4.0000' });
    expect(await holdStatuses()).toEqual([
      { status: 'consumed', n: 1 },
      { status: 'held', n: 4 },
    ]);
  });
});
