import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedPlatformDefaults } from '../../../src/modules/coupons-credits-referral-currency';
import { PlatformStore } from '../../../src/modules/auth';
import { startBspHarness, type BspHarness } from './support';

/** The installer's defaults (TW-CPN-025) against the real database. */
let h: BspHarness;
let saved: { currencies: unknown[]; coupons: unknown[]; packages: unknown[] };
const seed = () => h.app.get(PlatformStore).tx((tx) => seedPlatformDefaults(tx));
const count = async (table: string) =>
  Number((await h.owner.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n);

beforeAll(async () => {
  h = await startBspHarness();
  saved = {
    currencies: (await h.owner.query(`SELECT * FROM currencies`)).rows,
    coupons: (await h.owner.query(`SELECT * FROM coupons`)).rows,
    packages: (await h.owner.query(`SELECT * FROM credit_packages`)).rows,
  };
  // DELETE, not TRUNCATE ... CASCADE: orders reference coupons, and a cascade would empty them.
  for (const t of ['currencies', 'coupons', 'credit_packages'])
    await h.owner.query(`DELETE FROM ${t}`);
}, 120_000);

afterAll(async () => {
  for (const t of ['currencies', 'coupons', 'credit_packages'])
    await h.owner.query(`DELETE FROM ${t}`);
  for (const r of saved.currencies as Array<Record<string, unknown>>) {
    await h.owner.query(
      `INSERT INTO currencies (name, code, symbol, "precision", exchange_rate, is_active) VALUES ($1,$2,$3,$4,$5,$6)`,
      [r.name, r.code, r.symbol, r.precision, r.exchange_rate, r.is_active],
    );
  }
  for (const r of saved.coupons as Array<Record<string, unknown>>) {
    await h.owner.query(
      `INSERT INTO coupons (code, type, amount, description, is_active) VALUES ($1,$2,$3,$4,$5)`,
      [r.code, r.type, r.amount, r.description, r.is_active],
    );
  }
  for (const r of saved.packages as Array<Record<string, unknown>>) {
    await h.owner.query(
      `INSERT INTO credit_packages (name, slug, price_minor, currency_code, credits, badge, is_active, is_featured, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        r.name,
        r.slug,
        r.price_minor,
        r.currency_code,
        r.credits,
        r.badge,
        r.is_active,
        r.is_featured,
        r.sort_order,
      ],
    );
  }
  await h.stop();
});

describe('TW-CPN-025 platform defaults at install', () => {
  it('creates 30 active currencies with USD at exactly 1 and the whole-unit currencies at precision 0', async () => {
    expect(await seed()).toEqual({ currencies: 30, coupons: 2, creditPackages: 3 });
    expect(await count('currencies')).toBe(30);
    const rows = (
      await h.owner.query(
        `SELECT code, symbol, "precision", exchange_rate::text AS rate, is_active FROM currencies`,
      )
    ).rows;
    const by = (c: string) => rows.find((r) => r.code === c);
    expect(rows.every((r) => r.is_active)).toBe(true);
    expect(by('USD')).toMatchObject({ rate: '1.000000', symbol: '$', precision: 2 });
    expect(by('JPY')).toMatchObject({ precision: 0, rate: '149.000000' });
    expect(['IDR', 'VND', 'KRW', 'CLP', 'COP'].every((c) => by(c)!.precision === 0)).toBe(true);
    expect(by('INR')).toMatchObject({ symbol: '₹', rate: '83.250000' });
    expect(by('AED')).toMatchObject({ symbol: 'د.إ', rate: '3.673000' });
  });

  it("running it again creates no duplicates and does not undo an operator's edits", async () => {
    await h.owner.query(
      `UPDATE currencies SET exchange_rate = 90, is_active = false WHERE code = 'INR'`,
    );
    await h.owner.query(`UPDATE coupons SET is_active = false WHERE code = 'SAVE20'`);
    expect(await seed()).toEqual({ currencies: 0, coupons: 0, creditPackages: 0 });
    expect(await count('currencies')).toBe(30);
    const inr = (
      await h.owner.query(
        `SELECT exchange_rate::text AS rate, is_active FROM currencies WHERE code = 'INR'`,
      )
    ).rows[0];
    expect(inr).toEqual({ rate: '90.000000', is_active: false });
    expect(
      (await h.owner.query(`SELECT is_active FROM coupons WHERE code = 'SAVE20'`)).rows[0]
        .is_active,
    ).toBe(false);
  });

  it('adds the demo coupons only when there are no coupons, and the three bundles by slug', async () => {
    expect(
      (
        await h.owner.query(
          `SELECT code, type, amount::text AS amount, description, is_active, max_uses FROM coupons ORDER BY code`,
        )
      ).rows,
    ).toEqual([
      {
        code: 'SAVE20',
        type: 'percent',
        amount: '20.0000',
        description: '20% off any plan',
        is_active: false,
        max_uses: null,
      },
      {
        code: 'WELCOME10',
        type: 'percent',
        amount: '10.0000',
        description: '10% off your first plan purchase',
        is_active: true,
        max_uses: null,
      },
    ]);
    await h.owner.query(`DELETE FROM coupons WHERE code = 'WELCOME10'`);
    await seed();
    expect(await count('coupons')).toBe(1); // a table with a coupon in it is not "empty", so nothing is added
    const pk = (
      await h.owner.query(
        `SELECT slug, name, price_minor, credits, badge, is_featured, sort_order, currency_code FROM credit_packages ORDER BY sort_order`,
      )
    ).rows;
    expect(
      pk.map((p) => [
        p.slug,
        Number(p.price_minor),
        Number(p.credits),
        p.badge,
        p.is_featured,
        p.sort_order,
        p.currency_code,
      ]),
    ).toEqual([
      ['starter', 10_000, 5_000, null, false, 10, 'INR'],
      ['growth', 50_000, 27_500, 'Most popular', true, 20, 'INR'],
      ['scale', 100_000, 60_000, 'Best value', false, 30, 'INR'],
    ]);
  });
});
