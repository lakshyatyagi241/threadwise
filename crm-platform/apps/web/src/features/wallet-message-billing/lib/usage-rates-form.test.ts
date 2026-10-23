import { describe, expect, it } from 'vitest';
import type { WalletUsageSettings } from '@crm/contracts';
import {
  bpsToPercent,
  checkUsageRates,
  percentToBps,
  toUsageDraft,
  usageRatesDirty,
} from './usage-rates-form';

const settings: WalletUsageSettings = {
  currency: 'USD',
  prices: [
    { kind: 'sms', enabled: true, priceMinor: 50, unit: 'segment' },
    { kind: 'email', enabled: true, priceMinor: 10, unit: 'email' },
    { kind: 'whatsapp_call', enabled: true, priceMinor: 100, unit: 'minute' },
    { kind: 'voice_call', enabled: false, priceMinor: 100, unit: 'minute' },
    { kind: 'enrichment', enabled: true, priceMinor: 20, unit: 'lookup' },
    { kind: 'chat_message', enabled: true, priceMinor: 0, unit: 'message' },
  ],
  costPlus: [
    { kind: 'ai', enabled: true },
    { kind: 'translation', enabled: false },
  ],
  markupBps: 1000,
  updatedAt: null,
};

describe('usage price form', () => {
  it('shows the saved prices as typed amounts and the markup as a percentage', () => {
    const d = toUsageDraft(settings);
    expect(d.prices.sms).toEqual({ enabled: true, price: '0.50' });
    expect(d.prices.voice_call.enabled).toBe(false);
    expect(d.prices.chat_message.price).toBe('0.00');
    expect(d.costPlus).toEqual({ ai: true, translation: false });
    expect(d.markupPercent).toBe('10');
  });

  it('converts a percentage to basis points and back, refusing anything else', () => {
    expect(percentToBps('10')).toBe(1000);
    expect(percentToBps('12.5')).toBe(1250);
    expect(percentToBps(' 0 ')).toBe(0);
    expect(percentToBps('12.555')).toBeNull();
    expect(percentToBps('-1')).toBeNull();
    expect(percentToBps('ten')).toBeNull();
    expect(bpsToPercent(1250)).toBe('12.5');
    expect(bpsToPercent(1000)).toBe('10');
  });

  it('is clean and not dirty until something is changed', () => {
    const d = toUsageDraft(settings);
    expect(usageRatesDirty(d, settings)).toBe(false);
    const check = checkUsageRates(d);
    expect(check.problems).toEqual({ prices: {} });
    expect(check.input?.prices).toHaveLength(6);
    expect(check.input?.markupBps).toBe(1000);
    // "0.5" and "0.50" are the same price: typing it differently is not a change
    expect(
      usageRatesDirty(
        { ...d, prices: { ...d.prices, sms: { enabled: true, price: '0.5' } } },
        settings,
      ),
    ).toBe(false);
    expect(
      usageRatesDirty(
        { ...d, prices: { ...d.prices, sms: { enabled: true, price: '0.75' } } },
        settings,
      ),
    ).toBe(true);
    expect(usageRatesDirty({ ...d, costPlus: { ...d.costPlus, ai: false } }, settings)).toBe(true);
  });

  it('names each bad field and sends nothing', () => {
    const d = toUsageDraft(settings);
    const bad = checkUsageRates({
      ...d,
      prices: {
        ...d.prices,
        sms: { enabled: true, price: 'abc' },
        email: { enabled: true, price: '99999999' },
      },
      markupPercent: '5%',
    });
    expect(bad.input).toBeNull();
    expect(bad.problems.prices.sms).toBe('invalid');
    expect(bad.problems.prices.email).toBe('tooHigh');
    expect(bad.problems.markup).toBe('invalid');
  });
});
