import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { runClient } from '../load/run';
import { asOwner, customDumps, type TestDb } from './helpers';
import { cl, D, OPENING_ACME } from './credits-fixtures';
import {
  acme,
  base,
  check,
  clone,
  dumps,
  loose,
  one,
  opts,
  orgOf,
  pick,
  rows,
  setupCredits,
  snapshot,
  WALLET_TRG,
  writeOpening,
  type CreditOpts,
} from './credits-helpers';

setupCredits();

describe('runs: idempotent, dry, resumable', () => {
  it('a second run changes nothing', async () => {
    const db = await clone('cr-rerun', base.name);
    const before = await snapshot(db, 'acme');
    const s = await runClient(opts(dumps, db, 'acme'));
    expect(s.steps.credit_wallet).toBeDefined();
    expect(await snapshot(db, 'acme')).toBe(before);
    expect((await check(dumps, db, 'acme')).ok).toBe(true);
    // and with --force (re-read everything) it is still a no-op
    await runClient(opts(dumps, db, 'acme', { force: true }));
    expect(await snapshot(db, 'acme')).toBe(before);
  });

  it('a dry run writes nothing, not even a partition, and still reports what it would do', async () => {
    const db = await clone('cr-dry');
    const lines: string[] = [];
    const s = await runClient(opts(dumps, db, 'acme', { dryRun: true, log: (l) => lines.push(l) }));
    expect(s.dryRun).toBe(true);
    expect(s.steps.credit_wallet!.migrated).toBeGreaterThan(20);
    expect(s.steps.credit_tokens!.migrated).toBe(acme.credit_logs.length - 4);
    expect(s.steps.usage_charges!.migrated).toBe(7);
    expect(lines.join('\n')).toMatch(/credits: \d+ credit_logs row\(s\)/);
    expect(lines.join('\n')).toMatch(/confirmed balance 100\.25 INR/);
    for (const t of [
      'organizations',
      'wallet_transactions',
      'wallets',
      'ai_token_usage',
      'usage_charges',
      'usage_charge_keys',
      'migration.id_map',
      'migration.quarantine',
      'migration.run_log',
    ])
      expect(await one(db, `SELECT count(*)::int AS n FROM ${t}`), t).toBe(0);
    expect(
      await one(
        db,
        `SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('ai_token_usage_202512', 'usage_charges_202605')`,
      ),
    ).toBe(0);
  });

  it.each([
    ['credit_wallet', 'mid', 2],
    ['credit_tokens', 'after', 3],
    ['usage_charges', 'mid', 1],
  ] as const)(
    'killed during %s (%s a batch): the resumed run ends where an uninterrupted one does',
    async (step, when, batch) => {
      const db = await clone(`cr-kill-${step}`);
      const boom = (info: { step: string; batch: number }): void => {
        if (info.step === step && info.batch === batch) throw new Error('simulated crash');
      };
      await expect(
        runClient(
          opts(dumps, db, 'acme', when === 'mid' ? { midBatch: boom } : { afterBatch: boom }),
        ),
      ).rejects.toThrow(/simulated crash/);
      // the interrupted state has no wallet row yet: it is created last
      expect(await one(db, `SELECT count(*)::int AS n FROM wallets`)).toBe(0);
      await runClient(opts(dumps, db, 'acme'));
      expect(await snapshot(db, 'acme')).toBe(await snapshot(base, 'acme'));
      expect((await check(dumps, db, 'acme')).alarms).toEqual([]);
    },
  );

  it('refuses the wallet part without a confirmed balance, before anything is written, and says why', async () => {
    const db = await clone('cr-noopen');
    await expect(runClient(opts(dumps, db, 'initech'))).rejects.toThrow(/CREDITS_OPENING_REQUIRED/);
    expect(await one(db, 'SELECT count(*)::int AS n FROM organizations')).toBe(0);
    expect(await one(db, 'SELECT count(*)::int AS n FROM wallet_transactions')).toBe(0);
    await expect(runClient(opts(dumps, db, 'initech', { dryRun: true }))).rejects.toThrow(
      /CREDITS_OPENING_REQUIRED/,
    );
  });

  it('--no-wallet loads the tokens and the usage charges only; the balance can be added later with --force', async () => {
    const db = await clone('cr-nowallet');
    await runClient(opts(dumps, db, 'initech', { credits: { noWallet: true } }));
    expect(await one(db, 'SELECT count(*)::int AS n FROM wallet_transactions')).toBe(0);
    expect(await one(db, 'SELECT count(*)::int AS n FROM wallets')).toBe(0);
    expect(await one(db, 'SELECT count(*)::int AS n FROM ai_token_usage')).toBe(1);
    expect(await one(db, 'SELECT count(*)::int AS n FROM usage_charges')).toBe(1);
    const r = await check(dumps, db, 'initech');
    expect(r.alarms).toEqual([]);
    expect(r.collections.find((c) => c.collection === 'credit_logs')).toMatchObject({
      read: 1,
      migrated: 0,
      excluded: 1,
    });
    expect(r.excludedByCode['credit_logs: WALLET_NOT_MIGRATED']).toBe(1);
    // the operator now has a confirmed balance
    writeOpening(dumps, 'initech', {
      amount: '10.00',
      currency: 'EUR',
      asOf: '2026-07-01T00:00:00Z',
      confirmedBy: 'Third Operator, invented',
    });
    await runClient(opts(dumps, db, 'initech', { force: true }));
    expect(await rows(db, 'SELECT unit, balance::text FROM wallets')).toEqual([
      { unit: 'EUR', balance: '10.0000' },
    ]);
    expect(await one(db, 'SELECT count(*)::int AS n FROM wallet_transactions')).toBe(2); // opening + 1 spend
    expect((await check(dumps, db, 'initech')).alarms).toEqual([]);
    rmSync(join(dumps.dir, 'initech', 'credit-opening.json'));
  });

  it('stops on two Waboo workspaces in one dump until the operator names the one that belongs to the client', async () => {
    writeOpening(dumps, 'umbrella', {
      amount: '50.00',
      currency: 'USD',
      asOf: '2026-07-01T00:00:00Z',
      confirmedBy: 'Umbrella Operator',
    });
    const db = await clone('cr-umb');
    await expect(runClient(opts(dumps, db, 'umbrella'))).rejects.toThrow(
      /CREDITS_MULTIPLE_WORKSPACES/,
    );
    expect(await one(db, 'SELECT count(*)::int AS n FROM organizations')).toBe(0);
    await runClient(opts(dumps, db, 'umbrella', { credits: { workspaceId: 'ws-umb-A' } }));
    expect(await rows(db, 'SELECT unit, balance::text FROM wallets')).toEqual([
      { unit: 'USD', balance: '50.0000' },
    ]);
    expect(await one(db, 'SELECT count(*)::int AS n FROM wallet_transactions')).toBe(3); // opening + 2 spends of workspace A
    expect(
      await one(
        db,
        `SELECT count(*)::int AS n FROM migration.quarantine WHERE reason_code = 'OTHER_WORKSPACE'`,
      ),
    ).toBe(2); // wallet + tokens
    expect((await check(dumps, db, 'umbrella')).alarms).toEqual([]);
  });

  it('refuses an asOf before the newest migrated row and an opening entry above the posting limit', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cr-open-'));
    try {
      const early = join(tmp, 'early.json');
      writeFileSync(early, JSON.stringify({ ...OPENING_ACME, asOf: '2026-05-01T00:00:00Z' }));
      const db = await clone('cr-asof');
      await expect(
        runClient(opts(dumps, db, 'acme', { credits: { openingPath: early } })),
      ).rejects.toThrow(/CREDITS_OPENING_ASOF/);
      const big = join(tmp, 'big.json');
      writeFileSync(big, JSON.stringify({ ...OPENING_ACME, amount: '9999999.99' }));
      await expect(
        runClient(opts(dumps, db, 'acme', { credits: { openingPath: big } })),
      ).rejects.toThrow(/CREDITS_OPENING_OVER_LIMIT/);
      expect(await one(db, 'SELECT count(*)::int AS n FROM organizations')).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('refuses a ledger that is not empty, a wallet that already holds another balance, and an opening that changed mid-load', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cr-open-'));
    try {
      // 1. a ledger row this migration did not write
      const a = await clone('cr-foreign');
      await runClient(opts(dumps, a, 'acme', { credits: { noWallet: true } }));
      await asOwner(a, (d) =>
        d.execute(
          sql.raw(
            `INSERT INTO wallet_transactions (org_id, kind, type, amount, balance_after, direction, idempotency_key, unit) VALUES (${orgOf('acme')}, 'credit', 'topup', 5, 5, 'in', 'live:1', 'INR')`,
          ),
        ),
      );
      await expect(runClient(opts(dumps, a, 'acme', { force: true }))).rejects.toThrow(
        /WALLET_NOT_EMPTY/,
      );
      // 2. a wallet row with another balance is left alone
      const b = await clone('cr-wexists');
      await runClient(opts(dumps, b, 'acme', { credits: { noWallet: true } }));
      await asOwner(b, (d) =>
        d.execute(
          sql.raw(
            `INSERT INTO wallets (org_id, unit, balance) VALUES (${orgOf('acme')}, 'INR', 5)`,
          ),
        ),
      );
      await expect(runClient(opts(dumps, b, 'acme', { force: true }))).rejects.toThrow(
        /WALLET_EXISTS_DIFFERENT/,
      );
      expect(await rows(b, `SELECT balance::text FROM wallets`)).toEqual([{ balance: '5.0000' }]);
      // 3. the confirmed balance changes between the crash and the resume
      const c = await clone('cr-changed');
      await expect(
        runClient(
          opts(dumps, c, 'acme', {
            midBatch: (i) => {
              if (i.step === 'credit_wallet' && i.batch === 2) throw new Error('simulated crash');
            },
          }),
        ),
      ).rejects.toThrow(/simulated crash/);
      const other = join(tmp, 'other.json');
      writeFileSync(other, JSON.stringify({ ...OPENING_ACME, amount: '101.25' }));
      await expect(
        runClient(opts(dumps, c, 'acme', { credits: { openingPath: other } })),
      ).rejects.toThrow(/CREDITS_OPENING_CHANGED/);
      expect(await one(c, 'SELECT count(*)::int AS n FROM wallets')).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('a field of credit_logs the map does not know is an alarm, not a silent drop', async () => {
    const d = await customDumps({
      surprise: pick({
        credit_logs: [
          cl({ ws: 'ws-s', at: D('2026-03-01T10:00:00.000Z'), extra: { surprise_field: 'x' } }),
        ],
        whatsapp_broadcasting_data: [],
        user: [],
      }),
    });
    try {
      writeOpening(d, 'surprise', {
        amount: '1.00',
        currency: 'INR',
        asOf: '2026-07-01T00:00:00Z',
        confirmedBy: 'Nobody Real',
      });
      const db = await clone('cr-surprise');
      await runClient(opts(d, db, 'surprise'));
      const r = await check(d, db, 'surprise');
      expect(r.ok).toBe(false);
      expect(r.alarms.join('\n')).toMatch(/FIELD_UNMAPPED: credit_logs.surprise_field/);
    } finally {
      d.cleanup();
    }
  });
});

describe('a client with a confirmed balance and no credit rows', () => {
  it('gets its wallet from the file alone; a confirmed 0 creates no wallet', async () => {
    const d = await customDumps({ solo: { contact_list: [] }, zero: { contact_list: [] } });
    try {
      writeOpening(d, 'solo', {
        amount: '42.10',
        currency: 'GBP',
        asOf: '2026-07-01T00:00:00Z',
        confirmedBy: 'Solo Operator',
      });
      writeOpening(d, 'zero', {
        amount: '0.00',
        currency: 'GBP',
        asOf: '2026-07-01T00:00:00Z',
        confirmedBy: 'Zero Operator',
      });
      const db = await clone('cr-solo');
      await runClient(opts(d, db, 'solo'));
      expect(await rows(db, 'SELECT unit, balance::text FROM wallets')).toEqual([
        { unit: 'GBP', balance: '42.1000' },
      ]);
      expect(
        await rows(db, 'SELECT type, amount::text, balance_after::text FROM wallet_transactions'),
      ).toEqual([{ type: 'admin_adjust', amount: '42.1000', balance_after: '42.1000' }]);
      expect((await check(d, db, 'solo')).alarms).toEqual([]);
      await runClient(opts(d, db, 'zero'));
      expect(
        await one(db, `SELECT count(*)::int AS n FROM wallets WHERE org_id = ${orgOf('zero')}`),
      ).toBe(0);
      expect((await check(d, db, 'zero')).alarms).toEqual([]);
    } finally {
      d.cleanup();
    }
  });
});

describe('damage: every tampering with the credits tables is caught', () => {
  const fails = async (db: TestDb, re: RegExp, client = 'acme', credits?: CreditOpts) => {
    const r = await check(dumps, db, client, credits);
    expect(r.ok, 'the report must fail').toBe(false);
    expect(r.alarms.join('\n')).toMatch(re);
  };
  const dmg = async (label: string): Promise<TestDb> => clone(`cr-d-${label}`, base.name);
  const ledger = `org_id = ${orgOf('acme')}`;
  const aSpend = `SELECT id FROM wallet_transactions WHERE ${ledger} AND type = 'spend' ORDER BY id LIMIT 1`;
  const exec = (db: TestDb, text: string) => asOwner(db, (d) => d.execute(sql.raw(text)));

  it('changes an amount', async () => {
    const db = await dmg('amount');
    await loose(
      db,
      'wallet_transactions',
      WALLET_TRG,
      `UPDATE wallet_transactions SET amount = amount - 0.01 WHERE id = (${aSpend})`,
    );
    await fails(
      db,
      /CREDITS_MISMATCH: wallet_transactions waboo:acme:credit_log:[0-9a-f]+: amount expected/,
    );
  });
  it('deletes a ledger row', async () => {
    const db = await dmg('delete');
    await loose(
      db,
      'wallet_transactions',
      WALLET_TRG,
      `DELETE FROM wallet_transactions WHERE id = (${aSpend})`,
    );
    await fails(db, /TARGET_MISSING: wallet_transactions row waboo:acme:credit_log/);
    await fails(db, /WALLET_BALANCE: wallets\.balance/);
  });
  it('flips a direction', async () => {
    const db = await dmg('direction');
    await loose(
      db,
      'wallet_transactions',
      WALLET_TRG,
      `UPDATE wallet_transactions SET direction = 'in', amount = -amount WHERE id = (${aSpend})`,
    );
    await fails(db, /CREDITS_MISMATCH: wallet_transactions .*direction expected=out target=in/);
  });
  it('adds an extra transaction', async () => {
    const db = await dmg('extra');
    await exec(
      db,
      `INSERT INTO wallet_transactions (org_id, kind, type, amount, balance_after, direction, idempotency_key, unit) VALUES (${orgOf('acme')}, 'credit', 'topup', 1, 101.25, 'in', 'manual:1', 'INR')`,
    );
    await fails(db, /CREDITS_EXTRA_ROWS: 1 wallet_transactions row/);
    await fails(db, /EXTRA_ROWS: 1 row\(s\) in wallet_transactions/);
    await fails(db, /WALLET_BALANCE/);
  });
  it('changes a balance_after', async () => {
    const db = await dmg('after');
    await loose(
      db,
      'wallet_transactions',
      WALLET_TRG,
      `UPDATE wallet_transactions SET balance_after = balance_after + 0.01 WHERE id = (${aSpend})`,
    );
    await fails(db, /CREDITS_MISMATCH: wallet_transactions .*balance_after expected/);
    await fails(db, /WALLET_CHAIN: \d+ ledger row/);
  });
  it('unbalances the wallet', async () => {
    const db = await dmg('wallet');
    await exec(db, `UPDATE wallets SET balance = balance + 0.01 WHERE ${ledger}`);
    await fails(db, /WALLET_BALANCE: wallets\.balance 100\.2600 != sum of the ledger 100\.2500/);
    await fails(db, /WALLET_ANCHOR/);
  });
  it('removes, duplicates or loads a wallet', async () => {
    const a = await dmg('nowallet');
    await exec(a, `DELETE FROM wallets WHERE ${ledger}`);
    await fails(a, /WALLET_MISSING/);
    const b = await dmg('2wallets');
    await exec(
      b,
      `INSERT INTO wallets (org_id, unit, balance) VALUES (${orgOf('acme')}, 'USD', 0)`,
    );
    await fails(b, /WALLET_EXTRA: a USD wallet/);
    const c = await dmg('reserved');
    await exec(c, `UPDATE wallets SET reserved = 1 WHERE ${ledger}`);
    await fails(c, /WALLET_RESERVED/);
  });
  it('deletes, edits, adds and duplicates a token row', async () => {
    const first = `(SELECT min(id) FROM ai_token_usage WHERE ${ledger})`;
    const del = await dmg('tdel');
    await exec(del, `DELETE FROM ai_token_usage WHERE ${ledger} AND id = ${first}`);
    await fails(del, /TARGET_MISSING: ai_token_usage row/);
    await fails(del, /TOKEN_PARITY: month/);
    const edit = await dmg('tedit');
    await exec(
      edit,
      `UPDATE ai_token_usage SET total_tokens = total_tokens + 1 WHERE ${ledger} AND id = ${first}`,
    );
    await fails(edit, /CREDITS_MISMATCH: ai_token_usage \d+: total_tokens expected/);
    const add = await dmg('tadd');
    await exec(
      add,
      `INSERT INTO ai_token_usage (org_id, provider, model, prompt_tokens, completion_tokens, total_tokens, created_at) VALUES (${orgOf('acme')}, 'openai', 'x', 1, 1, 2, '2026-05-05T00:00:00Z')`,
    );
    await fails(add, /CREDITS_EXTRA_ROWS: 1 ai_token_usage row/);
    const dup = await dmg('tdup');
    await exec(
      dup,
      `INSERT INTO ai_token_usage (org_id, provider, model, prompt_tokens, completion_tokens, total_tokens, billed_against, created_at) SELECT org_id, provider, model, prompt_tokens, completion_tokens, total_tokens, billed_against, created_at FROM ai_token_usage WHERE ${ledger} ORDER BY id LIMIT 1`,
    );
    await fails(dup, /CREDITS_EXTRA_ROWS: 1 ai_token_usage row/);
    await fails(dup, /TOKEN_PARITY/);
  });
  it('adds, edits, charges and un-keys a usage charge', async () => {
    const auto1 = `${ledger} AND wamid = 'wamid.cr.auto1'`;
    const add = await dmg('uadd');
    await exec(
      add,
      `INSERT INTO usage_charges (org_id, wamid, created_at) VALUES (${orgOf('acme')}, 'wamid.extra', '2026-05-05T00:00:00Z')`,
    );
    await fails(add, /CREDITS_EXTRA_ROWS: 1 usage_charges row/);
    const money = await dmg('umoney');
    await exec(
      money,
      `UPDATE usage_charges SET status = 'charged', credits = 5, revenue_minor = 5 WHERE ${auto1}`,
    );
    await fails(money, /CHARGE_WITH_MONEY: usage_charges \d+ carries money/);
    const edit = await dmg('uedit');
    await exec(edit, `UPDATE usage_charges SET category = 'marketing' WHERE ${auto1}`);
    await fails(edit, /CREDITS_MISMATCH: usage_charges \d+ \(.*\): category expected=utility/);
    const del = await dmg('udel');
    await exec(del, `DELETE FROM usage_charges WHERE ${auto1}`);
    await fails(del, /TARGET_MISSING: usage_charges row/);
    const key = await dmg('ukey');
    await exec(
      key,
      `UPDATE usage_charge_keys SET status = 'refunded' WHERE ${ledger} AND provider_message_id = 'wamid.cr.auto1'`,
    );
    await fails(key, /CREDITS_MISMATCH: usage_charge_keys wamid\.cr\.auto1/);
    const nokey = await dmg('unokey');
    await exec(
      nokey,
      `DELETE FROM usage_charge_keys WHERE ${ledger} AND provider_message_id = 'wamid.cr.auto1'`,
    );
    await fails(nokey, /TARGET_MISSING: usage_charge_keys row for wamid\.cr\.auto1/);
  });
  it('adds an outbox row, a wallet event or a usage month; breaks id_map and the quarantine record', async () => {
    const ob = await dmg('outbox');
    await exec(
      ob,
      `INSERT INTO event_outbox (org_id, aggregate_module, aggregate_id, event_type, payload) SELECT id, 'wallet', 1, 'wallet.topup', '{}' FROM organizations WHERE slug = 'acme'`,
    );
    await fails(ob, /EXTRA_ROWS.*event_outbox/);
    const ev = await dmg('wevent');
    await exec(
      ev,
      `INSERT INTO wallet_events (org_id, event, message) VALUES (${orgOf('acme')}, 'wallet.x', 'm')`,
    );
    await fails(ev, /SIDE_EFFECT: 1 row\(s\) in wallet_events/);
    const um = await dmg('umonth');
    await exec(
      um,
      `INSERT INTO wallet_usage_months (org_id, month, messages) VALUES (${orgOf('acme')}, '2026-05-01', 3)`,
    );
    await fails(um, /SIDE_EFFECT: 1 row\(s\) in wallet_usage_months/);
    const map = await dmg('idmap');
    await exec(
      map,
      `DELETE FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'credit_logs_tokens' AND target_id = (SELECT min(target_id) FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'credit_logs_tokens')`,
    );
    await fails(map, /IDMAP_MISSING: 1 credit_logs_tokens document\(s\) load per the dump but are in no id_map/);
    const q = await dmg('quarantine');
    await exec(
      q,
      `DELETE FROM migration.quarantine WHERE source_client = 'acme' AND collection = 'credit_logs' AND reason_code = 'ROUNDED'`,
    );
    await fails(q, /QUARANTINE_CHANGED/);
  });
  it('is not fooled by another confirmed balance, nor by a ledger row moved into the wrong unit', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cr-open-'));
    try {
      const other = join(tmp, 'other.json');
      writeFileSync(other, JSON.stringify({ ...OPENING_ACME, amount: '999.00' }));
      await fails(base, /CREDITS_OPENING_DIFFERS/, 'acme', { openingPath: other });
      const db = await dmg('unit');
      await loose(
        db,
        'wallet_transactions',
        WALLET_TRG,
        `UPDATE wallet_transactions SET unit = 'USD' WHERE id = (${aSpend})`,
      );
      await fails(db, /CREDITS_MISMATCH: wallet_transactions .*unit expected=INR target=USD/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('after cutover, allow-extra-rows accepts live traffic but still catches a lost migrated row', async () => {
    const db = await dmg('live');
    await exec(
      db,
      `INSERT INTO wallet_transactions (org_id, kind, type, amount, balance_after, direction, idempotency_key, unit) VALUES (${orgOf('acme')}, 'credit', 'topup', 10, 110.25, 'in', 'live:topup:1', 'INR')`,
    );
    await exec(db, `UPDATE wallets SET balance = 110.25 WHERE ${ledger}`);
    await exec(
      db,
      `INSERT INTO usage_charges (org_id, wamid, created_at) VALUES (${orgOf('acme')}, 'wamid.live.1', now())`,
    );
    const ok = await check(dumps, db, 'acme', undefined, true);
    expect(ok.alarms.filter((a) => /^(CREDITS_|WALLET_|TOKEN_|CHARGE_|SIDE_)/.test(a))).toEqual([]);
    await loose(
      db,
      'wallet_transactions',
      WALLET_TRG,
      `DELETE FROM wallet_transactions WHERE id = (${aSpend})`,
    );
    const bad = await check(dumps, db, 'acme', undefined, true);
    expect(bad.alarms.join('\n')).toMatch(/TARGET_MISSING: wallet_transactions/);
  });
});
