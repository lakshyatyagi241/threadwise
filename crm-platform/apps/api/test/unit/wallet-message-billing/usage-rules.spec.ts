import { describe, expect, it } from 'vitest';
import { aiCostUsd } from '../../../src/modules/wallet-message-billing/ai-cost';
import { MIN_CHARGE_MINOR } from '../../../src/modules/wallet-message-billing/wallet-rules';
import {
  USAGE_DEFAULTS,
  billedMinutes,
  chargeUsdOf,
  freeUnitsOf,
  mergeUsageRates,
  priceUsage,
  usageStatementLabel,
} from '../../../src/modules/wallet-message-billing/usage-rules';

describe('mergeUsageRates', () => {
  it('uses the defaults for nothing stored and for garbage, never zeroing a price', () => {
    expect(mergeUsageRates(undefined)).toEqual(USAGE_DEFAULTS);
    expect(mergeUsageRates('x')).toEqual(USAGE_DEFAULTS);
    expect(
      mergeUsageRates({ prices: { sms: { priceMinor: -5, enabled: 'yes' } }, markupBps: 1.5 }),
    ).toEqual(USAGE_DEFAULTS);
  });

  it('lays a stored price over the default of that kind only', () => {
    const r = mergeUsageRates({
      prices: { email: { enabled: false, priceMinor: 25 } },
      costPlus: { ai: { enabled: false } },
      markupBps: 2500,
    });
    expect(r.prices.email).toEqual({ enabled: false, priceMinor: 25 });
    expect(r.prices.sms).toEqual(USAGE_DEFAULTS.prices.sms);
    expect(r.costPlus.ai.enabled).toBe(false);
    expect(r.costPlus.translation.enabled).toBe(true);
    expect(r.markupBps).toBe(2500);
  });
});

describe('the agreed prices', () => {
  const rates = mergeUsageRates(undefined);

  it('charges 0.15 for an email and 0.50 for an SMS segment, whatever happens to the message afterwards', () => {
    expect(priceUsage(rates, { kind: 'email', units: 1 })).toMatchObject({
      basis: 'unit',
      platformMinor: 15,
    });
    expect(priceUsage(rates, { kind: 'sms', units: 1 })).toMatchObject({
      basis: 'unit',
      platformMinor: 50,
    });
  });

  it('adds 20% to what the AI vendor charged: 1 paisa costs 1.2 paisa', () => {
    const p = priceUsage(rates, { kind: 'ai', units: 1, vendorCostUsd: 0.01 });
    expect(p).toMatchObject({ basis: 'cost_plus', markupBps: 2000 });
    expect((p as { chargeUsd: number }).chargeUsd).toBeCloseTo(0.012, 10);
  });

  it('charges a website chatbot message per unit', () => {
    expect(priceUsage(rates, { kind: 'webbot_message', units: 1 })).toMatchObject({
      basis: 'unit',
      platformMinor: USAGE_DEFAULTS.prices.webbot_message.priceMinor,
    });
  });
});

describe('freeUnitsOf (the free website chatbot messages of a plan)', () => {
  const plan = { planActive: true };

  it('covers messages until the monthly allowance is used up', () => {
    expect(freeUnitsOf({ ...plan, units: 1, usedBefore: 0, limit: 10_000 })).toBe(1);
    expect(freeUnitsOf({ ...plan, units: 1, usedBefore: 9_999, limit: 10_000 })).toBe(1);
    expect(freeUnitsOf({ ...plan, units: 1, usedBefore: 10_000, limit: 10_000 })).toBe(0);
    expect(freeUnitsOf({ ...plan, units: 1, usedBefore: 50_000, limit: 20_000 })).toBe(0);
  });

  it('splits a batch that crosses the end of the allowance', () => {
    expect(freeUnitsOf({ ...plan, units: 5, usedBefore: 18, limit: 20 })).toBe(2);
  });

  it('gives nothing free without a number: 0, an unlimited stand-in or an ended plan', () => {
    expect(freeUnitsOf({ ...plan, units: 1, usedBefore: 0, limit: 0 })).toBe(0);
    expect(freeUnitsOf({ ...plan, units: 1, usedBefore: 0, limit: 1_000_000 })).toBe(0);
    expect(
      freeUnitsOf({ ...plan, planActive: false, units: 1, usedBefore: 0, limit: 10_000 }),
    ).toBe(0);
    expect(freeUnitsOf({ ...plan, units: 0, usedBefore: 0, limit: 10_000 })).toBe(0);
  });
});

describe('priceUsage', () => {
  const rates = mergeUsageRates(undefined);

  it('multiplies a unit price by the units', () => {
    expect(priceUsage(rates, { kind: 'sms', units: 3 })).toMatchObject({
      basis: 'unit',
      platformMinor: 150,
      unitMinor: 50,
      units: 3,
    });
  });

  it('is free, with a reason, when the kind is off, the price is 0 or there are no units', () => {
    expect(priceUsage(rates, { kind: 'chat_message', units: 1 })).toEqual({
      basis: 'none',
      reason: 'price_is_zero',
    });
    expect(priceUsage(rates, { kind: 'whatsapp_call', units: 0 })).toEqual({
      basis: 'none',
      reason: 'no_units',
    });
    const off = mergeUsageRates({
      prices: { voice_call: { enabled: false } },
      costPlus: { ai: { enabled: false } },
    });
    expect(priceUsage(off, { kind: 'voice_call', units: 2 })).toEqual({
      basis: 'none',
      reason: 'switched_off',
    });
    expect(priceUsage(off, { kind: 'ai', units: 1, vendorCostUsd: 1 })).toEqual({
      basis: 'none',
      reason: 'switched_off',
    });
  });

  it('never makes SMS or email free: a switched-off or zero rate is charged the minimum', () => {
    const zeroed = mergeUsageRates({
      prices: { sms: { enabled: false, priceMinor: 0 }, email: { enabled: false, priceMinor: 0 } },
    });
    expect(priceUsage(zeroed, { kind: 'sms', units: 2 })).toMatchObject({
      basis: 'unit',
      unitMinor: MIN_CHARGE_MINOR,
      platformMinor: 2 * MIN_CHARGE_MINOR,
    });
    expect(priceUsage(zeroed, { kind: 'email', units: 1 })).toMatchObject({
      basis: 'unit',
      unitMinor: MIN_CHARGE_MINOR,
    });
  });

  it('prices AI and translation at the vendor cost plus the markup, and an unknown cost as free', () => {
    const p = priceUsage(rates, { kind: 'ai', units: 1, vendorCostUsd: 2 });
    expect(p).toMatchObject({ basis: 'cost_plus', costUsd: 2, markupBps: 2000 });
    expect((p as { chargeUsd: number }).chargeUsd).toBeCloseTo(2.4, 10);
    expect(priceUsage(rates, { kind: 'translation', units: 1, vendorCostUsd: null })).toEqual({
      basis: 'none',
      reason: 'no_cost',
    });
  });

  it('truncates fractional units to whole ones', () => {
    expect(priceUsage(rates, { kind: 'email', units: 2.9 })).toMatchObject({ platformMinor: 30 });
  });
});

describe('helpers', () => {
  it('adds the markup only to a real cost', () => {
    expect(chargeUsdOf(1, 2000)).toBeCloseTo(1.2, 10);
    expect(chargeUsdOf(1, 1500)).toBeCloseTo(1.15, 10);
    expect(chargeUsdOf(0, 2000)).toBe(0);
    expect(chargeUsdOf(-3, 2000)).toBe(0);
  });

  it('bills every started minute and nothing for an unanswered call', () => {
    expect(billedMinutes(0)).toBe(0);
    expect(billedMinutes(null)).toBe(0);
    expect(billedMinutes(1)).toBe(1);
    expect(billedMinutes(60)).toBe(1);
    expect(billedMinutes(61)).toBe(2);
    expect(billedMinutes(125)).toBe(3);
  });

  it('labels a usage with its own words, else its kind, and the country when there is one', () => {
    expect(usageStatementLabel('sms', null, null)).toBe('SMS');
    expect(usageStatementLabel('sms', null, 'IN')).toBe('SMS · IN');
    expect(usageStatementLabel('ai', 'AI lead scoring', null)).toBe('AI lead scoring');
    expect(usageStatementLabel('whatsapp_call', 'WhatsApp call · IN', 'IN')).toBe(
      'WhatsApp call · IN',
    );
  });
});

describe('aiCostUsd', () => {
  it('trusts the vendor figure over every estimate', () => {
    expect(
      aiCostUsd({
        provider: 'openrouter',
        model: 'gpt-4o',
        promptTokens: 1e6,
        completionTokens: 1e6,
        reportedCostUsd: 0.42,
      }),
    ).toBe(0.42);
  });

  it('prices a known model from its own rates, input and output apart', () => {
    // openai/gpt-6-luna-pro: 0.1 in, 0.5 out per million
    expect(
      aiCostUsd({
        provider: 'openrouter',
        model: 'openai/gpt-6-luna-pro',
        promptTokens: 1_000_000,
        completionTokens: 2_000_000,
      }),
    ).toBeCloseTo(0.1 + 1.0, 10);
  });

  it('prices a model by its family, a model nobody priced at the dearest rate, and only an unnamed model by the provider blend', () => {
    expect(
      aiCostUsd({
        provider: 'openai',
        model: 'gpt-4o-mini-2024',
        promptTokens: 1_000_000,
        completionTokens: 0,
      }),
    ).toBeCloseTo(0.4, 10);
    // a name the table does not know is never the cheap way in: it costs what the dearest known model costs
    expect(
      aiCostUsd({
        provider: 'anthropic',
        model: 'unheard-of',
        promptTokens: 500_000,
        completionTokens: 500_000,
      }),
    ).toBeCloseTo(0.5 * 15 + 0.5 * 75, 10);
    // the dear OpenAI models are not priced as the cheap family their name contains
    const per = (model: string) =>
      aiCostUsd({ provider: 'openai', model, promptTokens: 1_000_000, completionTokens: 0 });
    expect(per('gpt-4.5-preview')).toBeCloseTo(75, 10);
    expect(per('o3-pro')).toBeCloseTo(150, 10);
    expect(per('o1')).toBeCloseTo(15, 10);
    expect(per('o3-mini')).toBeCloseTo(1.1, 10);
    expect(per('gpt-4-turbo')).toBeCloseTo(10, 10);
    expect(per('gpt-4o')).toBeCloseTo(2.5, 10);
    // only a call that names no model falls to the provider's blended rate
    expect(
      aiCostUsd({
        provider: 'anthropic',
        model: null,
        promptTokens: 500_000,
        completionTokens: 500_000,
      }),
    ).toBeCloseTo(6, 10);
    expect(
      aiCostUsd({ provider: 'nobody', model: null, promptTokens: 250_000, completionTokens: 0 }),
    ).toBeCloseTo(1, 10);
  });

  it('charges nothing for no tokens and ignores bad numbers', () => {
    expect(
      aiCostUsd({ provider: 'openai', model: 'gpt-4o', promptTokens: 0, completionTokens: 0 }),
    ).toBe(0);
    expect(
      aiCostUsd({
        provider: 'openai',
        model: 'gpt-4o',
        promptTokens: Number.NaN,
        completionTokens: -4,
      }),
    ).toBe(0);
  });
});
