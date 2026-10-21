import { describe, expect, it } from 'vitest';
import {
  CSV_DETAIL_CELL,
  CSV_DETAIL_HEADER,
  csvCell,
  csvSafe,
  decideSettlement,
  formatMinor,
  aiChargeUsd,
  launchVerdict,
  monthStart,
  planIsActive,
  priceMessage,
  pricingTable,
  shouldAlertLowBalance,
  withinFreeQuota,
  type RateCardRow,
} from '../../../src/modules/wallet-message-billing/wallet-rules';

const card: RateCardRow[] = [
  { countryCode: '', category: '', priceMinor: 100, metaCostMicros: null },
  { countryCode: '', category: 'service', priceMinor: 0, metaCostMicros: null },
  { countryCode: 'IN', category: 'marketing', priceMinor: 100, metaCostMicros: 10_700 },
  { countryCode: 'US', category: 'marketing', priceMinor: 1200, metaCostMicros: 25_000 },
  { countryCode: 'US', category: '', priceMinor: 300, metaCostMicros: null },
];
const on = { perCountryEnabled: true, flatPriceMinor: 100 };

describe('priceMessage (TW-WALLET-004)', () => {
  it('prices a US marketing message at 12.00, a service reply to India at 0 and an unknown utility message at the default', () => {
    expect(priceMessage(card, { ...on, country: 'US', category: 'marketing' }).priceMinor).toBe(
      1200,
    );
    expect(priceMessage(card, { ...on, country: 'IN', category: 'service' }).priceMinor).toBe(0);
    expect(priceMessage(card, { ...on, country: null, category: 'utility' }).priceMinor).toBe(100);
  });

  it('uses the most specific row: country+category, country, category, default', () => {
    expect(priceMessage(card, { ...on, country: 'US', category: 'utility' }).matched).toBe('US|');
    expect(priceMessage(card, { ...on, country: 'IN', category: 'service' }).matched).toBe(
      '|service',
    );
    expect(priceMessage(card, { ...on, country: 'BR', category: 'authentication' }).matched).toBe(
      '|',
    );
  });

  it('lets a row priced 0 win: free is deliberate, not a gap', () => {
    const r = priceMessage(card, { ...on, country: 'GB', category: 'service' });
    expect(r.priceMinor).toBe(0);
  });

  it('returns the flat price when per-country pricing is off, but still looks the cost up', () => {
    const r = priceMessage(card, {
      perCountryEnabled: false,
      flatPriceMinor: 250,
      country: 'US',
      category: 'marketing',
    });
    expect(r.priceMinor).toBe(250);
    expect(r.metaCostMicros).toBe(25_000);
    expect(r.matched).toBe('flat');
  });

  it('keeps cost unknown (null) apart from free (0), and a row without a cost does not hide one further down', () => {
    expect(
      priceMessage(card, { ...on, country: 'GB', category: 'utility' }).metaCostMicros,
    ).toBeNull();
    const lower: RateCardRow[] = [
      { countryCode: 'US', category: 'marketing', priceMinor: 5, metaCostMicros: null },
      { countryCode: '', category: 'marketing', priceMinor: 9, metaCostMicros: 4_000 },
    ];
    expect(priceMessage(lower, { ...on, country: 'US', category: 'marketing' })).toMatchObject({
      priceMinor: 5,
      metaCostMicros: 4_000,
    });
  });

  it('falls back to the flat price when no row matches at all', () => {
    expect(priceMessage([], { ...on, country: 'US', category: 'marketing' }).priceMinor).toBe(100);
  });

  it('normalises the category: anything outside the four matches the any-category rows', () => {
    expect(priceMessage(card, { ...on, country: 'US', category: ' Marketing ' }).priceMinor).toBe(
      1200,
    );
    expect(
      priceMessage(card, { ...on, country: 'US', category: 'industry-vertical' }).priceMinor,
    ).toBe(300);
  });
});

describe('pricingTable (TW-WALLET-024)', () => {
  it('shows each category with Free for a zero price', () => {
    const t = pricingTable(card, { ...on, country: null });
    expect(t.find((x) => x.category === 'service')).toMatchObject({ priceMinor: 0, free: true });
    expect(t.find((x) => x.category === 'marketing')).toMatchObject({
      priceMinor: 100,
      free: false,
    });
  });
});

describe('decideSettlement (TW-WALLET-009, -010)', () => {
  const base = { payPerMessage: true, planActive: true, monthlyLimit: 0, usedBefore: 0 };

  it('charges the full price when the balance covers it', () => {
    expect(decideSettlement({ ...base, priceMinor: 1200, balanceMinor: 10_000 })).toEqual({
      outcome: 'charge',
      chargedMinor: 1200,
      shortfallMinor: 0,
    });
  });

  it('charges what is there when the balance is short, and records the shortfall', () => {
    expect(decideSettlement({ ...base, priceMinor: 1200, balanceMinor: 300 })).toEqual({
      outcome: 'charge',
      chargedMinor: 300,
      shortfallMinor: 900,
    });
  });

  it('records a message free with the whole price as shortfall when the wallet is empty', () => {
    expect(decideSettlement({ ...base, priceMinor: 1200, balanceMinor: 0 })).toEqual({
      outcome: 'free',
      reason: 'wallet_empty',
      shortfallMinor: 1200,
    });
  });

  it('records a price of 0 as free without a shortfall', () => {
    expect(decideSettlement({ ...base, priceMinor: 0, balanceMinor: 500 })).toEqual({
      outcome: 'free',
      reason: 'rate_is_zero',
      shortfallMinor: 0,
    });
  });

  it('in plan mode the first N messages of the month are free and the next one charges', () => {
    const plan = { payPerMessage: false, planActive: true, monthlyLimit: 1000 };
    expect(
      decideSettlement({ ...plan, usedBefore: 999, priceMinor: 100, balanceMinor: 500 }),
    ).toMatchObject({
      outcome: 'free',
      reason: 'within_plan_free_quota',
    });
    expect(
      decideSettlement({ ...plan, usedBefore: 1000, priceMinor: 100, balanceMinor: 500 }),
    ).toMatchObject({
      outcome: 'charge',
      chargedMinor: 100,
    });
  });

  it('an expired plan has no free allowance: the wallet pays', () => {
    expect(
      decideSettlement({
        payPerMessage: false,
        planActive: false,
        monthlyLimit: 1000,
        usedBefore: 0,
        priceMinor: 100,
        balanceMinor: 500,
      }),
    ).toMatchObject({ outcome: 'charge' });
  });

  it('an unlimited plan never touches the wallet', () => {
    expect(
      decideSettlement({
        payPerMessage: false,
        planActive: true,
        monthlyLimit: 0,
        usedBefore: 5_000_000,
        priceMinor: 100,
        balanceMinor: 500,
      }),
    ).toMatchObject({ outcome: 'free', reason: 'within_plan_free_quota' });
  });

  it('pay-per-message ignores the plan allowance entirely', () => {
    expect(
      decideSettlement({
        payPerMessage: true,
        planActive: true,
        monthlyLimit: 1000,
        usedBefore: 0,
        priceMinor: 100,
        balanceMinor: 500,
      }),
    ).toMatchObject({ outcome: 'charge' });
  });

  it('never charges a negative or fractional price', () => {
    expect(decideSettlement({ ...base, priceMinor: -5, balanceMinor: 500 })).toMatchObject({
      outcome: 'free',
      reason: 'rate_is_zero',
    });
    expect(decideSettlement({ ...base, priceMinor: 100.9, balanceMinor: 500 })).toMatchObject({
      chargedMinor: 100,
    });
  });
});

describe('withinFreeQuota and planIsActive', () => {
  it('counts the message being settled: 999 used of 1000 still fits, 1000 does not', () => {
    expect(withinFreeQuota({ planActive: true, monthlyLimit: 1000, usedBefore: 999 })).toBe(true);
    expect(withinFreeQuota({ planActive: true, monthlyLimit: 1000, usedBefore: 1000 })).toBe(false);
  });

  it('a plan is active until its end; a trial until its end; no end never expires', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    expect(
      planIsActive({ planEndsAt: new Date('2026-10-04T00:00:00Z'), trialEndsAt: null }, now),
    ).toBe(false);
    expect(
      planIsActive({ planEndsAt: null, trialEndsAt: new Date('2026-10-06T00:00:00Z') }, now),
    ).toBe(true);
    expect(planIsActive({ planEndsAt: null, trialEndsAt: null }, now)).toBe(true);
  });

  it('keys the month by UTC', () => {
    expect(monthStart(new Date('2026-10-31T23:59:59Z'))).toBe('2026-10-01');
    expect(monthStart(new Date('2026-11-01T00:00:00Z'))).toBe('2026-11-01');
  });
});

describe('launchVerdict (TW-WALLET-013)', () => {
  const f = {
    platformOwned: false,
    payPerMessage: true,
    planActive: true,
    monthlyLimit: 0,
    usedThisMonth: 0,
    recipients: 100,
    balanceMinor: 0,
    estimateMinor: 10_000,
    coveragePercent: 100,
  };

  it('refuses a pay-per-message workspace with an empty wallet', () => {
    expect(launchVerdict(f)).toEqual({ ok: false, reason: 'empty' });
  });

  it('per message: a free price passes an empty wallet, a paid one does not', () => {
    const one = { ...f, recipients: 1, freeAllowed: true };
    expect(launchVerdict({ ...one, estimateMinor: 0 })).toEqual({ ok: true });
    expect(launchVerdict({ ...one, estimateMinor: 100 })).toEqual({ ok: false, reason: 'empty' });
    expect(launchVerdict({ ...one, balanceMinor: 50, estimateMinor: 100 })).toEqual({
      ok: false,
      reason: 'insufficient',
    });
    // A launch (not per message) with a free estimate still needs a balance.
    expect(launchVerdict({ ...f, estimateMinor: 0 })).toEqual({ ok: false, reason: 'empty' });
  });

  it('lets a classic workspace inside its free quota launch with an empty wallet', () => {
    expect(
      launchVerdict({ ...f, payPerMessage: false, monthlyLimit: 1000, usedThisMonth: 10 }),
    ).toEqual({ ok: true });
  });

  it('refuses when the balance does not cover the estimate (Reference let a 1.00 wallet launch 50,000 messages)', () => {
    expect(
      launchVerdict({ ...f, balanceMinor: 100, recipients: 5000, estimateMinor: 500_000 }),
    ).toEqual({
      ok: false,
      reason: 'insufficient',
    });
  });

  it('restores the Reference rule with coverage 0: only an empty wallet blocks', () => {
    expect(
      launchVerdict({ ...f, balanceMinor: 100, estimateMinor: 500_000, coveragePercent: 0 }),
    ).toEqual({ ok: true });
  });

  it('a partial coverage setting scales the requirement', () => {
    expect(
      launchVerdict({ ...f, balanceMinor: 5_000, estimateMinor: 10_000, coveragePercent: 50 }),
    ).toEqual({ ok: true });
    expect(
      launchVerdict({ ...f, balanceMinor: 4_999, estimateMinor: 10_000, coveragePercent: 50 }),
    ).toMatchObject({ ok: false });
  });

  it('never blocks the platform own workspaces', () => {
    expect(launchVerdict({ ...f, platformOwned: true })).toEqual({ ok: true });
  });

  it('a plan that has ended does not get the free pass', () => {
    expect(
      launchVerdict({ ...f, payPerMessage: false, planActive: false, monthlyLimit: 1000 }),
    ).toMatchObject({ ok: false });
  });
});

describe('shouldAlertLowBalance (TW-WALLET-015)', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

  it('fires at or under the threshold and not above it', () => {
    expect(shouldAlertLowBalance(15, 20, null, now)).toBe(true);
    expect(shouldAlertLowBalance(20, 20, null, now)).toBe(true);
    expect(shouldAlertLowBalance(480, 500, null, now)).toBe(true);
    expect(shouldAlertLowBalance(21, 20, null, now)).toBe(false);
  });

  it('is silent for six hours after an alert, then fires again', () => {
    expect(shouldAlertLowBalance(5, 20, hoursAgo(5.9), now)).toBe(false);
    expect(shouldAlertLowBalance(5, 20, hoursAgo(6), now)).toBe(true);
  });

  it('a threshold of 0 turns the alert off', () => {
    expect(shouldAlertLowBalance(0, 0, null, now)).toBe(false);
  });
});

describe('statement text (TW-WALLET-021, -022)', () => {
  it('neutralises a cell a spreadsheet would run as a formula', () => {
    expect(csvSafe('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(csvSafe('+1 ok')).toBe(`'+1 ok`);
    expect(csvSafe('-2')).toBe(`'-2`);
    expect(csvSafe('@SUM(A1)')).toBe(`'@SUM(A1)`);
    expect(csvSafe('Top-up')).toBe('Top-up');
  });

  it('quotes cells that contain a comma, a quote or a line break', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
  });

  it('formats hundredths without a float', () => {
    expect(formatMinor(1250)).toBe('12.50');
    expect(formatMinor(-5)).toBe('-0.05');
    expect(formatMinor(0)).toBe('0.00');
  });

  it('writes an optional column as its header and its cell, blank when the row has no context', () => {
    const context = {
      channel: 'Campaign',
      campaignName: 'Diwali sale',
      recipient: '=+14155550100',
      template: 'offer_v2',
      country: 'IN',
      category: 'marketing',
      engine: 'WhatsApp Cloud',
    };
    expect(CSV_DETAIL_HEADER.channel).toBe('Channel');
    expect(CSV_DETAIL_CELL.channel(context)).toBe('Campaign · Diwali sale');
    expect(CSV_DETAIL_CELL.channel({ ...context, campaignName: null })).toBe('Campaign');
    expect(CSV_DETAIL_CELL.recipient(context)).toBe(`'=+14155550100`);
    expect(CSV_DETAIL_CELL.template(context)).toBe('offer_v2');
    expect(CSV_DETAIL_CELL.country(context)).toBe('IN');
    expect(CSV_DETAIL_CELL.category(context)).toBe('marketing');
    expect(CSV_DETAIL_CELL.engine(context)).toBe('WhatsApp Cloud');
    expect(CSV_DETAIL_CELL.engine({ ...context, engine: '=cmd' })).toBe("'=cmd");
    for (const column of [
      'channel',
      'recipient',
      'template',
      'country',
      'category',
      'engine',
    ] as const) {
      expect(CSV_DETAIL_CELL[column](null)).toBe('');
    }
  });
});

describe('aiChargeUsd', () => {
  it('adds 10% to what the vendor charged us, and nothing to a free call', () => {
    expect(aiChargeUsd(1)).toBeCloseTo(1.1, 10);
    expect(aiChargeUsd(0.002)).toBeCloseTo(0.0022, 10);
    expect(aiChargeUsd(0)).toBe(0);
  });
});
