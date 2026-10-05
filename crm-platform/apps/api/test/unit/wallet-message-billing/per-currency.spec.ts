import { describe, expect, it } from 'vitest';
import {
  convertMinor,
  priceInCurrency,
  priceMessage,
  priceMessageWithMargin,
  type MarginLayers,
  type RateCardRow,
} from '../../../src/modules/wallet-message-billing/wallet-rules';

/** Rates are units per USD, as the currencies table keeps them. */
const USD = 1;
const INR = 83;

const noMargins: MarginLayers = { workspace: [], plan: [], platform: [] };
const platformMargin = (marginBps: number): MarginLayers => ({
  workspace: [],
  plan: [],
  platform: [{ countryCode: '', category: '', marginBps }],
});

// A grid with a typed US marketing price of $12.00 and no Meta cost anywhere (nothing synced yet).
const grid: RateCardRow[] = [
  { countryCode: 'US', category: 'marketing', priceMinor: 1200, metaCostMicros: null },
  { countryCode: '', category: '', priceMinor: 100, metaCostMicros: null },
];

const base = {
  perCountryEnabled: true,
  flatPriceMinor: 100,
};

describe('convertMinor', () => {
  it('moves hundredths between currencies at the rates on file', () => {
    // $12.00 -> 12 x 83 = 996.00 rupees
    expect(convertMinor(1200, USD, INR)).toBe(99_600);
    expect(convertMinor(99_600, INR, USD)).toBe(1200);
  });

  it('leaves a price alone when the currency does not change or a rate is missing', () => {
    expect(convertMinor(500, INR, INR)).toBe(500);
    expect(convertMinor(500, 0, INR)).toBe(500);
    expect(convertMinor(500, USD, Number.NaN)).toBe(500);
  });

  it('keeps free free, and never turns a real price into free', () => {
    expect(convertMinor(0, USD, INR)).toBe(0);
    // a typed 0.01 in a currency worth more than the dollar would round to 0.00; it stays 0.01
    expect(convertMinor(1, INR, USD)).toBe(1);
  });
});

describe('the Meta cost behind a country with no cost on the grid', () => {
  it('uses the card cost as a fallback, but a grid cost still wins', () => {
    const noCost = priceMessage(grid, {
      ...base,
      country: 'US',
      category: 'marketing',
      fallbackCostMicros: 25_000,
    });
    expect(noCost.metaCostMicros).toBe(25_000);
    const withCost: RateCardRow[] = [
      { countryCode: 'US', category: 'marketing', priceMinor: 1200, metaCostMicros: 30_000 },
    ];
    const own = priceMessage(withCost, {
      ...base,
      country: 'US',
      category: 'marketing',
      fallbackCostMicros: 25_000,
    });
    expect(own.metaCostMicros).toBe(30_000);
  });

  it('is unknown (null) with no row and no card cost: not free', () => {
    expect(
      priceMessage(grid, { ...base, country: 'US', category: 'marketing' }).metaCostMicros,
    ).toBeNull();
  });

  it('lets margin pricing use the card cost in the platform currency', () => {
    const priced = priceMessageWithMargin(grid, platformMargin(2500), {
      ...base,
      country: 'US',
      category: 'marketing',
      pricingMode: 'margin',
      fallbackCostMicros: 25_000, // $0.025
    });
    // 0.025 x 1.25 = 0.03125 -> 3 cents
    expect(priced).toMatchObject({ basis: 'margin', priceMinor: 3, metaCostMicros: 25_000 });
  });
});

describe('priceInCurrency: a workspace billed in rupees', () => {
  const inr = {
    ...base,
    country: 'IN',
    category: 'marketing',
    fromRate: USD,
    toRate: INR,
  };

  it('applies the margin to Meta’s own INR cost, not to dollars converted', () => {
    // Meta's INR card: India marketing 0.8631 rupees. +25% = 1.0789 -> 108 paise.
    const priced = priceInCurrency(grid, platformMargin(2500), {
      ...inr,
      pricingMode: 'margin',
      costMicros: 863_100,
    });
    expect(priced).toMatchObject({ basis: 'margin', priceMinor: 108, metaCostMicros: 863_100 });
    expect(priced.margin).toMatchObject({ marginBps: 2500, source: 'platform' });
  });

  it('converts a typed price at the rate on file when no margin applies', () => {
    const us = priceInCurrency(grid, noMargins, {
      ...inr,
      country: 'US',
      pricingMode: 'fixed',
      costMicros: 2_075_000,
    });
    // typed $12.00 -> 996.00 rupees; the cost shown is still Meta's INR figure
    expect(us).toMatchObject({
      basis: 'fixed',
      priceMinor: 99_600,
      metaCostMicros: 2_075_000,
      margin: null,
    });
  });

  it('falls back to the converted typed price in margin mode when Meta’s cost or a margin is missing', () => {
    const noCard = priceInCurrency(grid, platformMargin(2500), {
      ...inr,
      country: 'US',
      pricingMode: 'margin',
      costMicros: null,
    });
    expect(noCard).toMatchObject({ basis: 'fixed', priceMinor: 99_600 });
    const noMargin = priceInCurrency(grid, noMargins, {
      ...inr,
      country: 'US',
      pricingMode: 'margin',
      costMicros: 2_075_000,
    });
    expect(noMargin).toMatchObject({ basis: 'fixed', priceMinor: 99_600 });
  });

  it('keeps a deliberately free message free', () => {
    const free: RateCardRow[] = [
      { countryCode: '', category: 'service', priceMinor: 0, metaCostMicros: null },
    ];
    const priced = priceInCurrency(free, noMargins, {
      ...inr,
      category: 'service',
      pricingMode: 'fixed',
      costMicros: 115_000,
    });
    expect(priced.priceMinor).toBe(0);
  });

  it('never prices a margin message below one paisa', () => {
    const priced = priceInCurrency(grid, platformMargin(100), {
      ...inr,
      pricingMode: 'margin',
      costMicros: 1,
    });
    expect(priced.priceMinor).toBe(1);
  });
});

describe('the same message in two currencies', () => {
  it('is priced from each currency’s own card', () => {
    const margins = platformMargin(2500);
    const opts = { ...base, country: 'IN', category: 'marketing', pricingMode: 'margin' as const };
    const usd = priceMessageWithMargin(grid, margins, { ...opts, fallbackCostMicros: 11_800 });
    const inr = priceInCurrency(grid, margins, {
      ...opts,
      costMicros: 863_100,
      fromRate: USD,
      toRate: INR,
    });
    expect(usd.priceMinor).toBe(1); // $0.0118 + 25% = 1.475 cents -> 1
    expect(inr.priceMinor).toBe(108); // 0.8631 + 25% = 108 paise
    expect(usd.metaCostMicros).toBe(11_800);
    expect(inr.metaCostMicros).toBe(863_100);
  });
});
