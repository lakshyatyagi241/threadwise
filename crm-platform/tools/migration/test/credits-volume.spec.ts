import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClient } from '../load/run';
import { reconcile } from '../reconcile';
import { cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import { bulkCredits } from './credits-fixtures';
import { one, rows } from './credits-helpers';

const N = 20_000;
const BILLING = 6_000;

let dumps: Dumps;
let db: TestDb;
beforeAll(async () => {
  const b = bulkCredits(N, BILLING);
  dumps = await customDumps({
    bulk: {
      contact_list: [],
      credit_logs: b.credit_logs,
      whatsapp_broadcasting_data: b.whatsapp_broadcasting_data,
    },
  });
  writeFileSync(
    join(dumps.dir, 'bulk', 'credit-opening.json'),
    JSON.stringify({
      amount: '1000.00',
      currency: 'INR',
      asOf: '2026-12-31T00:00:00Z',
      confirmedBy: 'Volume Operator, invented',
    }),
  );
  db = await cloneDb('cr-vol');
}, 900_000);
afterAll(async () => {
  await db.drop();
  dumps.cleanup();
});

describe('volume: 20,000 credit rows and 6,000 billing rows', () => {
  it('loads, reconciles clean and re-runs as a no-op, with timings', async () => {
    const t0 = Date.now();
    const s = await runClient(runOpts(dumps, db, 'bulk', { batchSize: 1000, allowNoOwner: true }));
    const load = (Date.now() - t0) / 1000;
    const t1 = Date.now();
    const r = await reconcile({
      source: dumps.source,
      dumpsDir: dumps.dir,
      client: 'bulk',
      targetUrl: db.workerUrl,
      sampleSize: 1000,
    });
    const rec = (Date.now() - t1) / 1000;
    const t2 = Date.now();
    await runClient(runOpts(dumps, db, 'bulk', { batchSize: 1000, allowNoOwner: true }));
    const again = (Date.now() - t2) / 1000;
    console.log(
      `credits volume: ${N} credit rows + ${BILLING} billing rows: load ${load.toFixed(1)} s, reconcile ${rec.toFixed(1)} s, second run ${again.toFixed(1)} s; ` +
        `wallet ${s.steps.credit_wallet!.migrated}, tokens ${s.steps.credit_tokens!.migrated}, usage ${s.steps.usage_charges!.migrated}`,
    );
    expect(r.alarms).toEqual([]);
    expect(r.ok).toBe(true);
    expect(s.steps.credit_tokens!.migrated).toBe(N);
    expect(s.steps.usage_charges!.migrated).toBe(BILLING);
    // a quarter of the rows are 0.003 (below the precision), the rest are ledger rows
    expect(s.steps.credit_wallet!.migrated).toBe(N - N / 4);
    expect(s.steps.credit_wallet!.excluded).toBe(N / 4);
    expect(await one(db, 'SELECT count(*)::int AS n FROM wallet_transactions')).toBe(N - N / 4 + 1);
    expect(await rows(db, 'SELECT unit, balance::text FROM wallets')).toEqual([
      { unit: 'INR', balance: '1000.0000' },
    ]);
    expect(
      await one(db, `SELECT count(*)::int AS n FROM wallet_transactions WHERE balance_after < 0`),
    ).toBe(0);
    expect(load).toBeLessThan(900);
    expect(rec).toBeLessThan(600);
    expect(again).toBeLessThan(60);
  });
});
