import { sql } from 'drizzle-orm';
import { CPN_CREDIT_PACKAGES, CPN_CURRENCIES, CPN_DEMO_COUPONS, type Tx } from '@crm/db';

export interface SeededDefaults {
  currencies: number;
  coupons: number;
  creditPackages: number;
}

/**
 * Writes the platform defaults (TW-CPN-025): the 30 starter currencies, the two demo coupons (only when there are no coupons at all,
 * as Reference's installer) and the three credit-package bundles. Idempotent and non-destructive: a row that already exists is left
 * exactly as an operator edited it, so running setup twice cannot reset a rate or re-activate a currency.
 */
export async function seedPlatformDefaults(tx: Tx): Promise<SeededDefaults> {
  let currencies = 0;
  for (const c of CPN_CURRENCIES) {
    const res = await tx.execute(sql`
      INSERT INTO currencies (name, code, symbol, "precision", exchange_rate, is_active)
      VALUES (${c.name}, ${c.code}, ${c.symbol}, ${c.precision}, ${c.rate}, true)
      ON CONFLICT (code) DO NOTHING RETURNING id`);
    currencies += res.rows.length;
  }
  let coupons = 0;
  const existing = await tx.execute(sql`SELECT 1 FROM coupons LIMIT 1`);
  if (existing.rows.length === 0) {
    for (const c of CPN_DEMO_COUPONS) {
      const res = await tx.execute(sql`
        INSERT INTO coupons (code, description, type, amount, is_active)
        VALUES (${c.code}, ${c.description}, ${c.type}, ${c.amount}, true)
        ON CONFLICT (code) DO NOTHING RETURNING id`);
      coupons += res.rows.length;
    }
  }
  let creditPackages = 0;
  for (const p of CPN_CREDIT_PACKAGES) {
    const res = await tx.execute(sql`
      INSERT INTO credit_packages (name, slug, price_minor, currency_code, credits, badge, is_active, is_featured, sort_order)
      VALUES (${p.name}, ${p.slug}, ${p.priceMinor}, ${p.currencyCode}, ${p.credits}, ${p.badge}, true, ${p.isFeatured}, ${p.sortOrder})
      ON CONFLICT (slug) DO NOTHING RETURNING id`);
    creditPackages += res.rows.length;
  }
  return { currencies, coupons, creditPackages };
}
