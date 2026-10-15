import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseOpening, resolveCredits } from '../credits/config';
import { counter, minorText, plainDecimal, scaled, scaledText, toMinor } from '../credits/decimal';
import { walletVerdict, windowOf } from '../credits/rules';
import { resolve } from '../registry';
import { STEPS } from '../transform';
import { acme, base, check, dumps, one, orgOf, rows, setupCredits } from './credits-helpers';

setupCredits();

describe('decimal helpers: money is text, never a float', () => {
  it('reads a double as its shortest exact decimal text', () => {
    expect(plainDecimal(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(plainDecimal(1e-7)).toBe('0.0000001');
    expect(plainDecimal(1.5e21)).toBe('1500000000000000000000');
    expect(plainDecimal(-0)).toBe('0');
    expect(plainDecimal(' 3.50 ')).toBe('3.5');
    expect(plainDecimal('1e3')).toBe('1000');
    expect(plainDecimal('-0.0')).toBe('0');
    for (const bad of [
      Number.NaN,
      Infinity,
      -Infinity,
      'abc',
      '',
      '1,5',
      null,
      undefined,
      {},
      true,
    ])
      expect(plainDecimal(bad), String(bad)).toBeNull();
  });
  it('rounds half away from zero on the decimal text, in hundredths', () => {
    expect(minorText(toMinor('0.005'))).toBe('0.01');
    expect(minorText(toMinor('0.0049'))).toBe('0.00');
    expect(minorText(toMinor('2.675'))).toBe('2.68');
    expect(minorText(toMinor('-2.675'))).toBe('-2.68');
    expect(minorText(toMinor('1234567.891'))).toBe('1234567.89');
    expect(minorText(toMinor('5'))).toBe('5.00');
    expect(toMinor('99999999999999999999.999')).toBe(10000000000000000000000n);
    expect(scaledText(scaled('0.0000001'))).toBe('0.0000001');
  });
  it('accepts only whole non-negative counters', () => {
    expect(counter(120)).toBe(120);
    expect(counter(120.0)).toBe(120);
    expect(counter('250')).toBe(250);
    expect(counter(1.5)).toBeNull();
    expect(counter(-1)).toBeNull();
    expect(counter('many')).toBeNull();
    expect(counter(Number.NaN)).toBeNull();
  });
});

describe('the confirmed opening balance file', () => {
  const good = {
    amount: '12.50',
    currency: 'INR',
    asOf: '2026-07-01T00:00:00Z',
    confirmedBy: 'Someone, billing screen',
  };
  it('parses a good file and refuses a careless one', () => {
    expect(parseOpening(JSON.stringify(good))).toMatchObject({ minor: 1250n, currency: 'INR' });
    const bad = (o: Record<string, unknown>) => () =>
      parseOpening(JSON.stringify({ ...good, ...o }));
    expect(bad({ amount: 12.5 })).toThrow(/STRING/); // a JSON number is a float
    expect(bad({ amount: '12.505' })).toThrow(/two fraction digits/);
    expect(bad({ amount: '-1' })).toThrow(/non-negative/);
    expect(bad({ currency: 'inr' })).toThrow(/ISO 4217/);
    expect(bad({ currency: 'RUPEES' })).toThrow(/ISO 4217/);
    expect(bad({ asOf: '2026-07-01' })).toThrow(/zone/);
    expect(bad({ asOf: '2026-07-01T00:00:00' })).toThrow(/zone/);
    expect(bad({ asOf: 'tomorrow' })).toThrow(/zone/);
    expect(bad({ confirmedBy: 'x' })).toThrow(/who confirmed/);
    expect(bad({ newBalance: '1' })).toThrow(/unknown key/);
    expect(() => parseOpening('not json')).toThrow(/valid JSON/);
    expect(() => parseOpening('[]')).toThrow(/object/);
  });
  it('requires the file for the wallet part when the dump has credit rows, and says so', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cr-cfg-'));
    try {
      expect(() => resolveCredits(undefined, dir, 'nobody', 5)).toThrow(/CREDITS_OPENING_REQUIRED/);
      expect(() => resolveCredits(undefined, dir, 'nobody', 5)).toThrow(
        /credit_logs.new_balance is not the balance/,
      );
      expect(resolveCredits(undefined, dir, 'nobody', 0)).toMatchObject({
        wallet: true,
        opening: null,
      });
      expect(resolveCredits({ noWallet: true }, dir, 'nobody', 5)).toMatchObject({ wallet: false });
      expect(() =>
        resolveCredits({ openingPath: join(dir, 'missing.json') }, dir, 'nobody', 0),
      ).toThrow(/does not exist/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('registry and step order', () => {
  it('credit_logs is migrated by the credits steps; credits_mapping_new is an operator command, not a client step', () => {
    expect(resolve('credit_logs')).toMatchObject({
      disposition: 'MIGRATE',
      handler: 'credit_wallet',
    });
    expect(resolve('credit_logs').targets).toEqual([
      'wallet_transactions',
      'wallets',
      'ai_token_usage',
    ]);
    expect(resolve('credits_mapping_new')).toMatchObject({ disposition: 'EXCLUDE', targets: [] });
    expect(resolve('credits_mapping_new').reason).toMatch(/pricing-seed/);
    expect(resolve('credits_mapping_new').reason).toMatch(/GLOBAL/);
    expect(resolve('credits_mapping').disposition).toBe('EXCLUDE');
    expect(resolve('credits_expenses').disposition).toBe('EXCLUDE');
    expect(resolve('credits_expenses').reason).toMatch(/direction is unknown/);
    expect(resolve('whatsapp_broadcasting_data').reason).toMatch(/usage_charges/);
    const order = STEPS.map((s) => s.handler);
    for (const h of ['credit_wallet', 'credit_tokens', 'usage_charges'] as const) {
      expect(order.indexOf(h), h).toBeGreaterThan(order.indexOf('recipients'));
      expect(order.indexOf(h), h).toBeLessThan(order.indexOf('inbox'));
    }
    expect(order.indexOf('credit_wallet')).toBeGreaterThan(order.indexOf('users'));
  });
  it('no INSERT trigger exists on a table the credits steps write, and the ledger refuses edits', async () => {
    const t = await rows(
      base,
      `SELECT c.relname AS tbl, t.tgname, (t.tgtype & 4) <> 0 AS on_insert
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('wallet_transactions', 'wallets', 'ai_token_usage', 'usage_charges', 'usage_charge_keys')`,
    );
    expect(t.filter((x) => x.on_insert)).toEqual([]);
    expect(t.some((x) => x.tgname === 'trg_wallet_transactions_immutable')).toBe(true);
  });
});

describe('rules of one credit row', () => {
  const s = { wallet: true, opening: null, workspaceId: null };
  const w = windowOf('2026-10-08T00:00:00Z');
  const v = (amount: unknown, at: unknown = new Date('2026-05-01T10:00:00Z')) =>
    walletVerdict({ credits_deducted: amount, created_time: at }, s, w);
  it('decides every row on its own text', () => {
    expect(v(0.2)).toMatchObject({ kind: 'load', minor: 20n, residual: 0n });
    expect(v(0.005)).toMatchObject({ kind: 'load', minor: 1n });
    expect(v(0.004)).toMatchObject({ kind: 'exclude', code: 'BELOW_LEDGER_PRECISION' });
    expect(v(0)).toMatchObject({ kind: 'exclude', code: 'ZERO_AMOUNT' });
    expect(v(-1)).toMatchObject({ kind: 'quarantine', code: 'NEGATIVE_DEDUCTION' });
    expect(v(Number.NaN)).toMatchObject({ kind: 'quarantine', code: 'NOT_A_NUMBER' });
    expect(v('abc')).toMatchObject({ kind: 'quarantine', code: 'NOT_A_NUMBER' });
    expect(v(undefined)).toMatchObject({ kind: 'quarantine', code: 'NOT_A_NUMBER' });
    expect(v(1e12)).toMatchObject({ kind: 'quarantine', code: 'AMOUNT_OVER_LIMIT' });
    expect(v(10_000_000)).toMatchObject({ kind: 'load' });
    expect(v(10_000_000.01)).toMatchObject({ kind: 'quarantine', code: 'AMOUNT_OVER_LIMIT' });
    expect(v(1, null)).toMatchObject({ kind: 'quarantine', code: 'NO_DATE' });
    expect(v(1, new Date('1900-01-01T00:00:00Z'))).toMatchObject({
      kind: 'quarantine',
      code: 'BAD_DATE',
    });
    expect(v(1, 1_777_700_000_000)).toMatchObject({ kind: 'load' }); // epoch ms
    expect(v(1, '2026-05-02T08:00:00Z')).toMatchObject({ kind: 'load' }); // ISO text
    expect(
      walletVerdict(
        { credits_deducted: 1, created_time: new Date('2026-05-01T00:00:00Z') },
        { ...s, wallet: false },
        w,
      ),
    ).toMatchObject({
      kind: 'exclude',
      code: 'WALLET_NOT_MIGRATED',
    });
  });
});

describe('a client with credit rows: wallet, ledger, tokens and usage charges', () => {
  it('reconciles clean, for both clients, with the independent oracle', async () => {
    for (const c of ['acme', 'globex']) {
      const r = await check(dumps, base, c);
      expect(r.alarms, c).toEqual([]);
      expect(r.ok, c).toBe(true);
      expect(r.unaccounted).toBe(0);
    }
  });

  it('puts the confirmed balance in the wallet and makes it the sum of the ledger, row by row', async () => {
    const w = await rows(
      base,
      `SELECT unit, balance::text, reserved::text FROM wallets WHERE org_id = ${orgOf('acme')}`,
    );
    expect(w).toEqual([{ unit: 'INR', balance: '100.2500', reserved: '0.0000' }]);
    expect(
      await rows(
        base,
        `SELECT sum(amount)::text AS s FROM wallet_transactions WHERE org_id = ${orgOf('acme')}`,
      ),
    ).toEqual([{ s: '100.2500' }]);
    // the opening entry is an operator's admin_adjust of (confirmed balance + migrated spends)
    const spends = (
      await rows(
        base,
        `SELECT (-sum(amount))::text AS s FROM wallet_transactions WHERE org_id = ${orgOf('acme')} AND type = 'spend'`,
      )
    )[0]!.s;
    const open = (
      await rows(
        base,
        `SELECT amount::text, balance_after::text, type, direction, actor_type, actor_label, source, unit, note, idempotency_key FROM wallet_transactions WHERE org_id = ${orgOf('acme')} AND type = 'admin_adjust'`,
      )
    )[0]!;
    expect(open).toMatchObject({
      type: 'admin_adjust',
      direction: 'in',
      actor_type: 'platform_operator',
      actor_label: 'waboo-migration',
      source: 'waboo_migration',
      unit: 'INR',
      idempotency_key: 'waboo:acme:opening',
    });
    expect(open.note).toMatch(/Test Operator/);
    expect(Number(open.amount)).toBeCloseTo(100.25 + Number(spends), 4);
    expect(open.balance_after).toBe(open.amount);
    // globex: another organization, another currency, another balance
    expect(
      await rows(base, `SELECT unit, balance::text FROM wallets WHERE org_id = ${orgOf('globex')}`),
    ).toEqual([{ unit: 'USD', balance: '7.0000' }]);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE org_id = ${orgOf('globex')}`,
      ),
    ).toBe(1 + 3); // opening + 3 spends
  });

  it('rounds half away from zero on the text, keeps the exact text, and accounts for the residual', async () => {
    const get = async (needle: string) =>
      await rows(
        base,
        `SELECT amount::text, balance_after::text, meta->'legacy'->'waboo'->>'credits_deducted' AS exact, user_id FROM wallet_transactions
          WHERE org_id = ${orgOf('acme')} AND meta->'legacy'->'waboo'->>'credits_deducted' = '${needle}'`,
      );
    expect((await get('0.005'))[0]).toMatchObject({ amount: '-0.0100', exact: '0.005' });
    expect((await get('2.675'))[0]).toMatchObject({ amount: '-2.6800' });
    expect((await get('0.30000000000000004'))[0]).toMatchObject({ amount: '-0.3000' });
    expect((await get('3.5')).map((x) => x.amount)).toEqual(['-3.5000', '-3.5000']); // the double 3.5 and the string "3.5"
    expect((await get('0.004')).length).toBe(0); // below the precision: not a ledger row
    expect((await get('0.0000001')).length).toBe(0);
    const soft = await rows(
      base,
      `SELECT reason_code, count(*)::int AS n FROM migration.quarantine WHERE source_client = 'acme' AND collection = 'credit_logs' GROUP BY 1`,
    );
    const by = Object.fromEntries(soft.map((x) => [x.reason_code, x.n]));
    expect(by).toMatchObject({
      NEGATIVE_DEDUCTION: 1,
      NOT_A_NUMBER: 3,
      NO_DATE: 2,
      BAD_DATE: 1,
      AMOUNT_OVER_LIMIT: 1,
      DUPLICATE_KEY: 1,
      USER_UNRESOLVED: 1,
      UNKNOWN_CREDIT_TYPE: 1,
    });
    expect(by.ROUNDED).toBeGreaterThanOrEqual(3);
    const rep = await check(dumps, base, 'acme');
    expect(rep.warnings.join('\n')).toMatch(
      /CREDITS ROUNDING: \d+ credit row\(s\) had more than two fraction digits/,
    );
    expect(rep.warnings.join('\n')).toMatch(/under 0\.01 were not posted/);
  });

  it('orders the ledger by time, then by _id, and chains balance_after in SQL', async () => {
    const r = await rows(
      base,
      `SELECT idempotency_key, created_at, amount::text, balance_after::text FROM wallet_transactions WHERE org_id = ${orgOf('acme')}
       ORDER BY created_at, coalesce(meta->'legacy'->'waboo'->>'id', '') COLLATE "C"`,
    );
    for (let i = 1; i < r.length; i++)
      expect(
        (Number(r[i - 1]!.balance_after) + Number(r[i]!.amount)).toFixed(4),
        r[i]!.idempotency_key,
      ).toBe(Number(r[i]!.balance_after).toFixed(4));
    expect(r[0]!.idempotency_key).toBe('waboo:acme:opening');
    // the two rows of the same instant: the smaller _id first
    const same = r.filter(
      (x) =>
        x.created_at.toISOString?.() === '2026-05-01T10:17:00.000Z' ||
        String(x.created_at).includes('10:17:00'),
    );
    expect(same.map((x) => x.amount)).toEqual(['-0.1200', '-0.1100']);
    expect(Math.min(...r.map((x) => Number(x.balance_after)))).toBeGreaterThanOrEqual(0);
    expect(Number(r[r.length - 1]!.balance_after)).toBeCloseTo(100.25, 4);
  });

  it('writes the user of a migrated user, an unresolved one as NULL, and no other column the loader does not own', async () => {
    const withUser = await rows(
      base,
      `SELECT w.user_id, u.email::text FROM wallet_transactions w LEFT JOIN users u ON u.org_id = w.org_id AND u.id = w.user_id WHERE w.org_id = ${orgOf('acme')} AND w.user_id IS NOT NULL`,
    );
    expect(withUser).toEqual([{ user_id: withUser[0]!.user_id, email: 'agent.cr@example.test' }]);
    const bad = await rows(
      base,
      `SELECT count(*)::int AS n FROM wallet_transactions WHERE org_id = ${orgOf('acme')} AND (subject_type IS NOT NULL OR subject_id IS NOT NULL OR operator_id IS NOT NULL OR request_id IS NOT NULL OR row_version <> 1 OR kind <> 'credit')`,
    );
    expect(bad[0]!.n).toBe(0);
  });

  it('loads every token row once (ids through migration.id_map), with the counters as the rules say', async () => {
    const n = acme.credit_logs.length;
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM ai_token_usage WHERE org_id = ${orgOf('acme')}`,
      ),
    ).toBe(n - 4); // 1 duplicate, 2 without a date, 1 out of range
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'credit_logs_tokens' AND target_table = 'ai_token_usage'`,
      ),
    ).toBe(n - 4);
    const q = async (cond: string) =>
      await rows(
        base,
        `SELECT provider, model, prompt_tokens AS p, completion_tokens AS c, total_tokens AS t, billed_against FROM ai_token_usage WHERE org_id = ${orgOf('acme')} AND ${cond}`,
      );
    expect(
      (await q(`prompt_tokens = 50 AND completion_tokens = 80 AND total_tokens = 130`)).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await q(`prompt_tokens = 100 AND completion_tokens = 100 AND total_tokens = 250`)).length,
    ).toBe(1); // "250" kept
    expect(await q(`provider = 'unknown'`)).toEqual([
      { provider: 'unknown', model: null, p: 50, c: 80, t: 130, billed_against: 'admin' },
    ]);
    expect(
      (await q(`provider = 'openai' AND model = 'openai/gpt-4o-mini'`)).length,
    ).toBeGreaterThan(30);
    const soft = await rows(
      base,
      `SELECT reason_code, count(*)::int AS n FROM migration.quarantine WHERE source_client = 'acme' AND collection = 'credit_logs_tokens' GROUP BY 1`,
    );
    const by = Object.fromEntries(soft.map((x) => [x.reason_code, x.n]));
    expect(by).toMatchObject({
      BAD_TOKEN_COUNT: 1,
      TOKEN_TOTAL_MISMATCH: 1,
      PROVIDER_GUESS: 1,
      NO_DATE: 2,
      BAD_DATE: 1,
      DUPLICATE_KEY: 1,
    });
    // every month of the history has its partition and nothing fell into the default partition
    expect(await one(base, `SELECT count(*)::int AS n FROM ONLY ai_token_usage_default`)).toBe(0);
    expect(await one(base, `SELECT count(*)::int AS n FROM ONLY usage_charges_default`)).toBe(0);
    const parts = await rows(
      base,
      `SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'ai_token_usage' ORDER BY 1`,
    );
    expect(parts.map((x) => x.relname)).toEqual(
      expect.arrayContaining([
        'ai_token_usage_202512',
        'ai_token_usage_202605',
        'ai_token_usage_202606',
      ]),
    );
  });

  it('writes the non-broadcast billing rows as inert usage charges keyed by wamid, with their claimed keys', async () => {
    const u = await rows(
      base,
      `SELECT wamid, category, source, credits, revenue_minor, status, billing_mode, wallet_tx_id, currency, meta FROM usage_charges WHERE org_id = ${orgOf('acme')} ORDER BY wamid`,
    );
    expect(u.map((x) => x.wamid)).toEqual([
      'wamid.cr.auto1',
      'wamid.cr.auto2',
      'wamid.cr.bnobid',
      'wamid.cr.inbox1',
      'wamid.cr.reverted',
      'wamid.cr.test1',
      'wamid.cr.weird',
    ]);
    for (const x of u)
      expect(x).toMatchObject({
        credits: 0,
        revenue_minor: 0,
        status: 'free',
        billing_mode: 'plan',
        wallet_tx_id: null,
        currency: null,
      });
    const auto2 = u.find((x) => x.wamid === 'wamid.cr.auto2')!;
    expect(auto2).toMatchObject({ category: 'marketing', source: 'automation' });
    expect(JSON.parse(auto2.meta).legacy.waboo).toMatchObject({
      amount: '1',
      reseller_amount: '0.05',
      reseller_margin: '1',
      cost: null,
      revert: false,
    });
    const rev = JSON.parse(u.find((x) => x.wamid === 'wamid.cr.reverted')!.meta).legacy.waboo;
    expect(rev).toMatchObject({
      revert: true,
      refund_run_id: 'run-1',
      reverted_at: '2026-05-03T00:00:00.000Z',
      amount: '0.35',
    });
    expect(u.find((x) => x.wamid === 'wamid.cr.weird')).toMatchObject({ category: null });
    expect(
      JSON.parse(u.find((x) => x.wamid === 'wamid.cr.weird')!.meta).legacy.waboo.amount,
    ).toBeNull();
    const keys = await rows(
      base,
      `SELECT k.provider_message_id, k.status, k.charge_id = c.id AS linked FROM usage_charge_keys k JOIN usage_charges c ON c.org_id = k.org_id AND c.id = k.charge_id AND c.created_at = k.charge_created_at WHERE k.org_id = ${orgOf('acme')}`,
    );
    expect(keys.length).toBe(7);
    expect(keys.every((k) => k.status === 'free' && k.linked)).toBe(true);
    // the other organization may hold the same wamid
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM usage_charges WHERE org_id = ${orgOf('globex')} AND wamid = 'wamid.cr.auto1'`,
      ),
    ).toBe(1);
    const q = await rows(
      base,
      `SELECT collection, reason_code, count(*)::int AS n FROM migration.quarantine WHERE source_client = 'acme' AND collection IN ('whatsapp_broadcasting_data_usage', 'whatsapp_broadcasting_data') AND source_key NOT LIKE '%#%' GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    expect(q).toEqual([
      { collection: 'whatsapp_broadcasting_data', reason_code: 'CAMPAIGN_MISSING', n: 1 },
      { collection: 'whatsapp_broadcasting_data_usage', reason_code: 'BAD_DATE', n: 1 },
      { collection: 'whatsapp_broadcasting_data_usage', reason_code: 'NO_DATE', n: 1 },
      { collection: 'whatsapp_broadcasting_data_usage', reason_code: 'NO_MESSAGE_ID', n: 1 },
    ]);
    // a real broadcast recipient is the broadcast step's: it is not a charge
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM usage_charges WHERE wamid = 'wamid.cr.bcast1'`,
      ),
    ).toBe(0);
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM wp_campaign_contacts WHERE org_id = ${orgOf('acme')}`,
      ),
    ).toBe(0);
  });

  it('writes no outbox event, notification, wallet event, usage month or global row, and touches no global table', async () => {
    for (const t of ['event_outbox', 'notifications', 'wallet_events', 'wallet_usage_months'])
      expect(await one(base, `SELECT count(*)::int AS n FROM ${t}`), t).toBe(0);
    const g = await rows(
      base,
      `SELECT (SELECT count(*)::int FROM message_rates) AS r, (SELECT count(*)::int FROM plan_message_margins) AS m, (SELECT count(*)::int FROM wallet_platform_log) AS l`,
    );
    expect(g[0]).toEqual({ r: 16, m: 1, l: 0 });
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE org_id NOT IN (${orgOf('acme')}, ${orgOf('globex')})`,
      ),
    ).toBe(0);
  });

  it('keeps migration.id_map exact, both ways', async () => {
    const m = Object.fromEntries(
      (
        await rows(
          base,
          `SELECT source_collection, count(*)::int AS n FROM migration.id_map WHERE source_client = 'acme' AND source_collection IN ('credit_logs', 'credit_logs_tokens', 'whatsapp_broadcasting_data_usage') GROUP BY 1`,
        )
      ).map((x) => [x.source_collection, x.n]),
    );
    expect(m.credit_logs).toBe(
      await one(
        base,
        `SELECT count(*)::int AS n FROM wallet_transactions WHERE org_id = ${orgOf('acme')} AND type = 'spend'`,
      ),
    );
    expect(m.credit_logs_tokens).toBe(acme.credit_logs.length - 4);
    expect(m.whatsapp_broadcasting_data_usage).toBe(14); // two keys per document: the ObjectId and the string id
    expect(
      await one(
        base,
        `SELECT count(DISTINCT target_id)::int AS n FROM migration.id_map WHERE source_client = 'acme' AND source_collection = 'whatsapp_broadcasting_data_usage'`,
      ),
    ).toBe(7);
    // every mapped target exists
    expect(
      await one(
        base,
        `SELECT count(*)::int AS n FROM migration.id_map m WHERE m.source_client = 'acme' AND m.target_table = 'ai_token_usage' AND NOT EXISTS (SELECT 1 FROM ai_token_usage t WHERE t.org_id = m.target_org_id AND t.id = m.target_id)`,
      ),
    ).toBe(0);
  });
});

describe('the verifier is independent of the loader', () => {
  it('reconcile/oracle-credits.ts imports nothing from transform/, credits/ or load/', () => {
    const text = readFileSync(join(__dirname, '..', 'reconcile', 'oracle-credits.ts'), 'utf8');
    const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./oracle']);
  });
  it('the loader does not use credit_logs.new_balance as a balance anywhere', () => {
    for (const f of ['credits/plan.ts', 'credits/rules.ts', 'load/credits.ts']) {
      const text = readFileSync(join(__dirname, '..', f), 'utf8');
      expect(text, f).not.toMatch(/new_balance/);
    }
  });
});
