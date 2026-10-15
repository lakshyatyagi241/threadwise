import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { connect } from '../load/db';
import { planPricing, pricingSeed, PricingError, type SeedOptions } from '../pricing/seed';
import { runClient } from '../load/run';
import { asOwner, cloneDb, customDumps, runOpts, type Dumps, type TestDb } from './helpers';
import { O } from './fixtures';

type J = Record<string, unknown>;

/** INVENTED credits_mapping_new documents: the shape of the masked profile (name, code, dial_code, whatsapp{4 categories}, email, sms). */
const cat = (price: number | string, margin = 0.1): J => ({ price, margin });
const country = (
  n: number,
  name: string,
  code: string | undefined,
  wa: Record<string, unknown>,
  extra: J = {},
): J => ({
  _id: O(n),
  name,
  ...(code ? { code } : {}),
  dial_code: '91',
  short_name: name.slice(0, 3),
  whatsapp: wa,
  email: { price: 0.01, margin: 0.002 },
  sms: { price: 0.02, margin: 0.003 },
  ...extra,
});
const wa = (a: unknown, m: unknown, s: unknown, u: unknown): J => ({
  authentication: a,
  marketing: m,
  service: s,
  utility: u,
});

const docsA = (): J[] => [
  country(9001, 'India', 'IN', wa(cat(0.115), cat(0.7846), cat(0), cat(0.115))),
  country(9002, 'Germany', 'de', wa(cat(0.1), cat(0.1131), cat(0), cat(0.0678))),
  country(9003, 'Germany again', 'DE', wa(cat(9), cat(9), cat(9), cat(9))), // DUPLICATE_COUNTRY
  country(9004, 'Narnia', undefined, wa(cat(1), cat(1), cat(1), cat(1))), // NO_COUNTRY_CODE
  country(9005, 'other', undefined, wa(cat(1), cat(2.5), cat(0), cat(1)), { dial_code: undefined }),
  country(9006, 'Brazil', 'BR', wa(cat('abc'), cat(-1), 5, cat(0.2))), // BAD_PRICE x2, a bare number is a price
  { _id: O(9007), name: 'cfg', conversion_rate: 88, country_currency: 'inr' }, // CONFIG_DOC_SKIPPED
  {
    _id: O(9008),
    name: 'models',
    models: [
      {
        name: 'm1',
        provider: 'openai',
        openRouterKey: 'sk-or-v1-NEVERPRINTTHIS',
        normalKey: 'sk-NEVERPRINTTHIS',
        input_token_price: 1,
      },
    ],
  }, // MODEL_DOC_SKIPPED
];
const docsB = (): J[] => {
  const d = docsA();
  d[0] = country(9001, 'India', 'IN', wa(cat(0.115), cat(0.8), cat(0), cat(0.115))); // marketing differs
  return d.filter((x) => x.name !== 'Narnia');
};

let dumps: Dumps;
let db: TestDb;
const dbs: TestDb[] = [];
beforeAll(async () => {
  dumps = await customDumps({
    pa: { credits_mapping_new: docsA() },
    pb: { credits_mapping_new: docsB() },
  });
  db = await cloneDb('pr-base');
  dbs.push(db);
}, 900_000);
afterAll(async () => {
  for (const d of dbs) await d.drop();
  dumps.cleanup();
});

const rates = async (t: TestDb): Promise<string> =>
  JSON.stringify(
    await asOwner(
      t,
      async (d) =>
        (
          await d.execute(
            sql`SELECT country_code, category, credits, meta_cost_minor, currency, is_active, created_at::text FROM message_rates ORDER BY 1, 2`,
          )
        ).rows,
    ),
  );
const count = async (t: TestDb, table: string): Promise<number> =>
  asOwner(t, async (d) =>
    Number(
      (
        (await d.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))).rows[0] as {
          n: number;
        }
      ).n,
    ),
  );

const seed = (o: Partial<SeedOptions> = {}, lines: string[] = []) =>
  pricingSeed({
    source: dumps.source,
    dumpsDir: dumps.dir,
    client: 'pa',
    apply: false,
    skipConflicts: false,
    ownerUrl: db.ownerUrl,
    log: (l) => lines.push(l),
    ...o,
  });

describe('pricing-seed: credits_mapping_new -> the GLOBAL message_rates, by an operator, never by a client run', () => {
  it('reads each document the way the profile says, with exact decimal arithmetic', () => {
    const p = planPricing(docsA(), '1');
    const at = (c: string, k: string) =>
      p.rows.find((r) => r.country === c && r.category === k)?.credits;
    expect(at('IN', 'marketing')).toBe(78); // 0.7846 -> 0.78
    expect(at('IN', 'utility')).toBe(12); // 0.115 -> 0.12 (half away from zero, on the text)
    expect(at('IN', 'service')).toBe(0); // free, kept as a real row
    expect(at('DE', 'utility')).toBe(7);
    expect(at('', 'marketing')).toBe(250); // the document called "other" is the default row
    expect(at('BR', 'service')).toBe(500); // a bare number is a price
    expect(p.rows.filter((r) => r.country === 'BR').map((r) => r.category)).toEqual([
      'service',
      'utility',
    ]);
    expect(p.skipped.map((s) => s.code).sort()).toEqual([
      'BAD_PRICE',
      'BAD_PRICE',
      'CONFIG_DOC_SKIPPED',
      'DUPLICATE_COUNTRY',
      'MODEL_DOC_SKIPPED',
      'NO_COUNTRY_CODE',
    ]);
    expect(p.notPresent).toMatchObject({ modelDocs: 1 });
    expect(p.notPresent.emailSms).toBe(4);
    expect(p.notPresent.marginsNotApplied).toBeGreaterThan(10);
    expect(p.config).toEqual([{ currency: 'inr', rate: '88' }]);
    // a factor converts the unit: 1 Waboo unit = 0.012 platform units
    expect(
      planPricing(docsA(), '0.012').rows.find(
        (r) => r.country === 'IN' && r.category === 'marketing',
      )!.credits,
    ).toBe(1);
    expect(() => planPricing(docsA(), '0')).toThrow(/positive/);
    expect(() => planPricing(docsA(), 'x')).toThrow(/positive/);
  });

  it('is a DRY RUN by default: it prints what it would write and writes nothing', async () => {
    const before = await rates(db);
    const lines: string[] = [];
    const r = await seed({}, lines);
    expect(r.dryRun).toBe(true);
    expect(r.applied).toBe(0);
    expect(await rates(db)).toBe(before);
    expect(await count(db, 'wallet_platform_log')).toBe(0);
    const out = lines.join('\n');
    expect(out).toMatch(/DRY RUN \(nothing is written\)/);
    expect(out).toMatch(/ASSUMED 1/);
    expect(out).toMatch(/CONFLICT/);
    expect(out).toMatch(/NOT PRESENT \(no table, never written\): email \/ SMS prices 4 doc\(s\)/);
    expect(out).not.toMatch(/NEVERPRINTTHIS|sk-or-v1/); // provider keys are never read, never printed
    expect(r.new.length + r.same.length + r.conflicts.length).toBe(r.plan.rows.length);
    // the starter card holds IN marketing 100 / utility 100 / authentication 100 / ('' , service) 0 ...
    expect(r.conflicts.map((c) => `${c.country}|${c.category}`).sort()).toEqual([
      'IN|authentication',
      'IN|marketing',
      'IN|utility',
    ]);
    expect(r.same.map((c) => `${c.country}|${c.category}`).sort()).toEqual([
      '|authentication',
      '|service',
      '|utility',
    ]);
  });

  it('works without any database too (the table is then simply not compared)', async () => {
    const r = await seed({ ownerUrl: undefined });
    expect(r.new.length).toBe(r.plan.rows.length);
  });

  it('refuses to apply without the owner connection, without an explicit factor, with conflicts, or without the typed phrase', async () => {
    const before = await rates(db);
    await expect(
      seed({ apply: true, ownerUrl: undefined, factor: '1', confirm: async (p) => p }),
    ).rejects.toThrow(/owner connection/);
    await expect(seed({ apply: true, confirm: async (p) => p })).rejects.toThrow(
      /explicit --factor/,
    );
    await expect(seed({ apply: true, factor: '1', confirm: async (p) => p })).rejects.toThrow(
      /already hold a different price/,
    );
    await expect(
      seed({ apply: true, factor: '1', skipConflicts: true, confirm: async () => 'yes' }),
    ).rejects.toThrow(/confirmation does not match/);
    await expect(seed({ apply: true, factor: '1', skipConflicts: true })).rejects.toThrow(
      /confirmation does not match/,
    );
    await expect(
      seed({
        apply: true,
        factor: '1',
        skipConflicts: true,
        compareWith: 'pb',
        confirm: async (p) => p,
      }),
    ).rejects.toThrow(/dry run only/);
    expect(await rates(db)).toBe(before);
    expect(await count(db, 'wallet_platform_log')).toBe(0);
    await expect(
      seed({ apply: true, factor: '1', confirm: async (p) => p }),
    ).rejects.toBeInstanceOf(PricingError);
  });

  it('writes only the keys that are not there, never overwrites, and leaves a trail', async () => {
    const before = JSON.parse(await rates(db)) as Array<Record<string, unknown>>;
    let asked = '';
    const lines: string[] = [];
    const r = await seed(
      { apply: true, factor: '1', skipConflicts: true, confirm: async (p) => ((asked = p), p) },
      lines,
    );
    expect(asked).toBe(`SEED ${r.new.length} message_rates pa`);
    expect(r.applied).toBe(r.new.length);
    const after = JSON.parse(await rates(db)) as Array<Record<string, unknown>>;
    expect(after.length).toBe(before.length + r.new.length);
    // every row that was there is exactly as it was (credits, cost, currency, timestamps)
    for (const b of before) expect(after).toContainEqual(b);
    expect(after.find((x) => x.country_code === 'IN' && x.category === 'marketing')!.credits).toBe(
      100,
    ); // the Waboo 78 did NOT overwrite
    expect(after.find((x) => x.country_code === 'DE' && x.category === 'marketing')).toMatchObject({
      credits: 11,
      meta_cost_minor: null,
      currency: null,
      is_active: true,
    });
    const log = await asOwner(
      db,
      async (d) =>
        (
          await d.execute(
            sql`SELECT event, severity, actor_type, actor_label, message, payload FROM wallet_platform_log`,
          )
        ).rows as Array<Record<string, any>>,
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      event: 'rates.import',
      actor_type: 'platform_operator',
      actor_label: 'waboo-migration',
    });
    expect(log[0]!.payload).toMatchObject({
      client: 'pa',
      rows: r.new.length,
      skippedConflicts: 3,
      factor: '1',
    });
    expect(log[0]!.payload.collectionSha256).toMatch(/^[0-9a-f]{64}$/);
    const prov = await asOwner(
      db,
      async (d) =>
        (
          await d.execute(
            sql`SELECT collection, step, counts FROM migration.run_log WHERE collection = '_pricing'`,
          )
        ).rows as Array<Record<string, any>>,
    );
    expect(prov).toHaveLength(1);
    expect(prov[0]!.counts.written).toBe(r.new.length);
    expect(lines.join('\n')).toMatch(/written: \d+ row\(s\) to message_rates/);
    // a second apply has nothing left to write and asks for nothing
    const again = await seed({ apply: true, factor: '1', skipConflicts: true });
    expect(again.applied).toBe(0);
    expect(again.new).toHaveLength(0);
    expect(await count(db, 'wallet_platform_log')).toBe(1);
  });

  it('compares two clients: the same rate card is one platform rate card; a different one is shown, key by key', async () => {
    const same = await seed({ client: 'pa', compareWith: 'pa' });
    expect(same.compare).toEqual({ onlyHere: [], onlyThere: [], differ: [] });
    const lines: string[] = [];
    const diff = await seed({ client: 'pa', compareWith: 'pb' }, lines);
    expect(diff.compare!.differ).toEqual(['IN|marketing']);
    expect(lines.join('\n')).toMatch(/compared with pb: 1 price\(s\) differ/);
  });

  it('a client run can never write a global table: the worker login is refused by the database', async () => {
    const worker = connect(db.workerUrl, 'probe');
    try {
      await expect(
        worker.db.execute(
          sql`INSERT INTO message_rates (country_code, category, credits) VALUES ('ZZ', 'marketing', 1)`,
        ),
      ).rejects.toThrow();
      await expect(
        worker.db.execute(sql`UPDATE message_rates SET credits = 1 WHERE country_code = 'IN'`),
      ).resolves.toBeDefined(); // RLS hides the rows: nothing is updated
    } finally {
      await worker.close();
    }
    expect(
      JSON.parse(await rates(db)).find(
        (x: Record<string, unknown>) => x.country_code === 'IN' && x.category === 'marketing',
      ).credits,
    ).toBe(100);
  });

  it('a full client run leaves message_rates, plan_message_margins and the platform log exactly as they were', async () => {
    const fresh = await cloneDb('pr-run');
    dbs.push(fresh);
    const d = await customDumps({
      pc: {
        contact_list: [],
        credit_logs: [
          {
            _id: O(9100),
            workspace_id: 'w',
            credits_deducted: 1.5,
            created_time: { $date: '2026-03-01T00:00:00.000Z' },
            tokens_used: 3,
            input_tokens: 1,
            output_tokens: 2,
            type: 'openai_api',
            model: 'openai/gpt-4o-mini',
            user_id: null,
            new_balance: 1,
            action: 'a',
            module: 'm',
            description: 'd',
            cost: 0.1,
            cached_input_tokens: 0,
          },
        ],
        credits_mapping_new: docsA(),
      },
    });
    try {
      const g = async () =>
        JSON.stringify(
          await asOwner(
            fresh,
            async (x) =>
              (
                await x.execute(
                  sql`SELECT (SELECT md5(string_agg(m::text, ',' ORDER BY m.id)) FROM message_rates m) AS r, (SELECT md5(string_agg(m::text, ',' ORDER BY m.id)) FROM plan_message_margins m) AS p, (SELECT count(*) FROM wallet_platform_log) AS l`,
                )
              ).rows,
          ),
        );
      const before = await g();
      writeFileSync(
        join(d.dir, 'pc', 'credit-opening.json'),
        JSON.stringify({
          amount: '5.00',
          currency: 'INR',
          asOf: '2026-07-01T00:00:00Z',
          confirmedBy: 'Probe Operator',
        }),
      );
      await runClient(runOpts(d, fresh, 'pc', { allowNoOwner: true }));
      expect(await g()).toBe(before);
      expect(await count(fresh, 'wallet_transactions')).toBe(2);
    } finally {
      d.cleanup();
    }
  });
});
