import { describe, expect, it } from 'vitest';
import { bpsToPercent, percentToBps, priceFromMargin } from '@crm/contracts';
import {
  priceMessageWithMargin,
  resolveMargin,
  type MarginLayers,
  type RateCardRow,
} from '../../../src/modules/wallet-message-billing/wallet-rules';

describe('margin arithmetic', () => {
  it('reads a percentage into basis points and back, refusing what is not one', () => {
    expect(percentToBps('25')).toBe(2500);
    expect(percentToBps('12.5')).toBe(1250);
    expect(percentToBps('0')).toBe(0);
    expect(percentToBps('-100')).toBe(-10_000);
    expect(percentToBps('-100.01')).toBeNull();
    expect(percentToBps('1000')).toBe(100_000);
    expect(percentToBps('1000.01')).toBeNull();
    expect(percentToBps('1.234')).toBeNull();
    expect(percentToBps('abc')).toBeNull();
    expect(percentToBps('')).toBeNull();
    expect(bpsToPercent(2550)).toBe('25.50');
    expect(bpsToPercent(-500)).toBe('-5.00');
  });

  it('prices Meta cost x (1 + margin) to the nearest hundredth', () => {
    expect(priceFromMargin(100_000, 2000)).toBe(12); // 0.10 + 20% = 0.12
    expect(priceFromMargin(25_000, 0)).toBe(3); // 0.025 -> 0.03
    expect(priceFromMargin(784_600, 3000)).toBe(102); // 0.7846 x 1.3 = 1.02
  });

  it('is free at a cost of 0 or a margin of -100%, and never rounds a paid message down to nothing', () => {
    expect(priceFromMargin(0, 5000)).toBe(0);
    expect(priceFromMargin(100_000, -10_000)).toBe(0);
    expect(priceFromMargin(4_000, 2000)).toBe(1); // 0.0048 is charged as 0.01
  });

  it('a negative margin sells below cost on purpose', () => {
    expect(priceFromMargin(100_000, -2000)).toBe(8);
  });
});

const rows: RateCardRow[] = [
  { countryCode: '', category: '', priceMinor: 100, metaCostMicros: null },
  { countryCode: 'IN', category: 'marketing', priceMinor: 100, metaCostMicros: 107_000 },
  { countryCode: 'US', category: 'marketing', priceMinor: 1200, metaCostMicros: 250_000 },
];
const none: MarginLayers = { workspace: [], plan: [], platform: [] };
const opts = { perCountryEnabled: true, flatPriceMinor: 100 };

describe('resolveMargin: workspace beats plan beats platform, then the most specific row', () => {
  const layers: MarginLayers = {
    workspace: [{ countryCode: 'US', category: 'marketing', marginBps: 9000 }],
    plan: [
      { countryCode: '', category: 'marketing', marginBps: 3000 },
      { countryCode: 'IN', category: 'marketing', marginBps: 4000 },
    ],
    platform: [{ countryCode: '', category: '', marginBps: 2000 }],
  };

  it('uses the workspace override where it exists', () => {
    expect(resolveMargin(layers, 'US', 'marketing')).toEqual({
      marginBps: 9000,
      source: 'workspace',
      matched: 'US|marketing',
    });
  });

  it('falls to the plan, the most specific plan row first', () => {
    expect(resolveMargin(layers, 'IN', 'marketing')).toMatchObject({
      marginBps: 4000,
      source: 'plan',
      matched: 'IN|marketing',
    });
    expect(resolveMargin(layers, 'BR', 'marketing')).toMatchObject({
      marginBps: 3000,
      source: 'plan',
      matched: '|marketing',
    });
  });

  it('falls to the platform default when the plan says nothing', () => {
    expect(resolveMargin(layers, 'BR', 'utility')).toEqual({
      marginBps: 2000,
      source: 'platform',
      matched: '|',
    });
  });

  it('answers null when no layer has a row', () => {
    expect(resolveMargin(none, 'US', 'marketing')).toBeNull();
  });

  it('consults a layer whole before the next: a workspace blanket margin beats a more specific plan row', () => {
    const l: MarginLayers = {
      workspace: [{ countryCode: '', category: '', marginBps: 500 }],
      plan: [{ countryCode: 'US', category: 'marketing', marginBps: 4000 }],
      platform: [],
    };
    expect(resolveMargin(l, 'US', 'marketing')).toMatchObject({
      source: 'workspace',
      marginBps: 500,
    });
  });
});

describe('priceMessageWithMargin', () => {
  const layers: MarginLayers = {
    ...none,
    platform: [{ countryCode: '', category: '', marginBps: 2000 }],
  };

  it('prices by margin in margin mode: US marketing cost 0.25 + 20% = 0.30', () => {
    const p = priceMessageWithMargin(rows, layers, {
      ...opts,
      country: 'US',
      category: 'marketing',
      pricingMode: 'margin',
    });
    expect(p).toMatchObject({
      priceMinor: 30,
      basis: 'margin',
      margin: { marginBps: 2000, source: 'platform' },
    });
  });

  it('keeps the typed price in fixed mode', () => {
    const p = priceMessageWithMargin(rows, layers, {
      ...opts,
      country: 'US',
      category: 'marketing',
      pricingMode: 'fixed',
    });
    expect(p).toMatchObject({ priceMinor: 1200, basis: 'fixed', margin: null });
  });

  it('falls back to the typed price where Meta cost is unknown', () => {
    const p = priceMessageWithMargin(rows, layers, {
      ...opts,
      country: 'BR',
      category: 'utility',
      pricingMode: 'margin',
    });
    expect(p).toMatchObject({ priceMinor: 100, basis: 'fixed' });
  });

  it('falls back to the typed price when no margin is set anywhere', () => {
    const p = priceMessageWithMargin(rows, none, {
      ...opts,
      country: 'US',
      category: 'marketing',
      pricingMode: 'margin',
    });
    expect(p).toMatchObject({ priceMinor: 1200, basis: 'fixed' });
  });

  it('a workspace override at -100% makes that country free for that workspace', () => {
    const l: MarginLayers = {
      ...layers,
      workspace: [{ countryCode: 'IN', category: 'marketing', marginBps: -10_000 }],
    };
    expect(
      priceMessageWithMargin(rows, l, {
        ...opts,
        country: 'IN',
        category: 'marketing',
        pricingMode: 'margin',
      }).priceMinor,
    ).toBe(0);
    expect(
      priceMessageWithMargin(rows, l, {
        ...opts,
        country: 'US',
        category: 'marketing',
        pricingMode: 'margin',
      }).priceMinor,
    ).toBe(30);
  });
});
