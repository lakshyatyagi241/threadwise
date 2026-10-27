import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WalletRepository } from '../../../src/modules/wallet-message-billing/wallet.repository';
import { startRlsPg, type RlsPg } from '../../support/rls-pg';

const UNIT = 'USD';
const TTL = 600;

/**
 * Money moves in one transaction or not at all (audit D-11). A debit is several writes (the wallet balance, the ledger row, a hold on
 * what is still to be charged); if anything fails after some of them, none may remain. Run as the restricted application role against
 * the real schema, the way a request runs, so a write that escaped the caller's transaction (a second connection, a bare handle) would
 * show here as a row that survived the rollback.
 */
describe('wallet: a failed debit leaves nothing behind', () => {
  let h: RlsPg;
  let orgId: number;
  const repo = new WalletRepository();
  const inOrg = <T>(fn: (tx: never) => Promise<T>): Promise<T> => h.inOrg(orgId, fn);

  const state = async () => {
    const w = (
      await h.pg.owner.query(
        'SELECT balance::text AS balance, reserved::text AS reserved FROM wallets WHERE org_id = $1 AND unit = $2',
        [orgId, UNIT],
      )
    ).rows[0] as { balance: string; reserved: string };
    const count = async (table: string) =>
      Number(
        (
          await h.pg.owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = $1`, [
            orgId,
          ])
        ).rows[0].n,
      );
    return {
      balance: w.balance,
      reserved: w.reserved,
      ledger: await count('wallet_transactions'),
      holds: await count('wallet_holds'),
    };
  };

  const entry = (key: string, balanceAfterMinor: number) => ({
    orgId,
    userId: null,
    unit: UNIT,
    type: 'spend',
    direction: 'out' as const,
    amountMinor: 300,
    balanceAfterMinor,
    source: 'test',
    subjectType: null,
    subjectId: null,
    description: 'rollback proof',
    note: null,
    meta: null,
    idempotencyKey: key,
    actorType: 'system',
    actorLabel: null,
    operatorId: null,
    requestId: null,
  });

  /** The three writes of a debit of 3.00: balance, ledger entry, hold. */
  const debit = async (tx: never, key: string): Promise<void> => {
    const wallet = await repo.lockWallet(tx, orgId, UNIT);
    await repo.setBalance(tx, orgId, wallet.id, wallet.balanceMinor - 300, 'keep');
    await repo.insertTransaction(tx, entry(key, wallet.balanceMinor - 300));
    await repo.holdMinor(tx, orgId, UNIT, 100, TTL);
  };

  beforeAll(async () => {
    h = await startRlsPg();
    orgId = await h.newOrg(`wallet-rollback-${Date.now()}`);
    await h.pg.owner.query(`INSERT INTO wallets (org_id, unit, balance) VALUES ($1, $2, 5.0000)`, [
      orgId,
      UNIT,
    ]);
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('a debit that succeeds changes the balance, the ledger and the holds together (the control)', async () => {
    expect(await state()).toEqual({ balance: '5.0000', reserved: '0.0000', ledger: 0, holds: 0 });
    await inOrg((tx) => debit(tx, 'control-1'));
    expect(await state()).toEqual({ balance: '2.0000', reserved: '1.0000', ledger: 1, holds: 1 });
    // put the wallet back for the next tests
    await h.pg.owner.query(`DELETE FROM wallet_holds WHERE org_id = $1`, [orgId]);
    await h.pg.owner.query(`DELETE FROM wallet_transactions WHERE org_id = $1`, [orgId]);
    await h.pg.owner.query(`UPDATE wallets SET balance = 5, reserved = 0 WHERE org_id = $1`, [
      orgId,
    ]);
  });

  it('an error raised after all three writes undoes all three', async () => {
    const before = await state();
    await expect(
      inOrg(async (tx) => {
        await debit(tx, 'rb-throw');
        throw new Error('the caller fails after the debit');
      }),
    ).rejects.toThrow('the caller fails after the debit');
    expect(await state()).toEqual(before);
  });

  it('a database error in the middle (after two writes) undoes the writes already made', async () => {
    const before = await state();
    await expect(
      inOrg(async (tx) => {
        const wallet = await repo.lockWallet(tx, orgId, UNIT);
        await repo.setBalance(tx, orgId, wallet.id, wallet.balanceMinor - 300, 'keep');
        await repo.holdMinor(tx, orgId, UNIT, 100, TTL);
        await (tx as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
          sql`SELECT 1/0`,
        );
      }),
    ).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it('the idempotency key of a rolled-back debit is free again: the retry posts once and a repeat does nothing', async () => {
    await expect(
      inOrg(async (tx) => {
        await debit(tx, 'rb-retry');
        throw new Error('first attempt fails');
      }),
    ).rejects.toThrow('first attempt fails');
    expect(
      await inOrg((tx) => repo.findByKey(tx, orgId, 'rb-retry')),
      'the rolled-back attempt must not have burned the key',
    ).toBeNull();

    await inOrg((tx) => debit(tx, 'rb-retry'));
    expect(await state()).toMatchObject({ balance: '2.0000', ledger: 1 });

    // a repeat of the same key inserts no second ledger row (the caller sees null and does not move the balance again)
    expect(await inOrg((tx) => repo.insertTransaction(tx, entry('rb-retry', 200)))).toBeNull();
    expect((await state()).ledger).toBe(1);
  });
});
