import type { PlanCard } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  PLANS_PATH,
  SUPPORT_PATH,
  ctaFor,
  formatMoney,
  messagesView,
  priceView,
} from './plan-format';

const base: PlanCard = {
  id: '3f0a6f0e-5d1c-4a52-9a41-0f6a4b0c1d11',
  slug: 'growth',
  name: 'Growth',
  subtitle: null,
  kind: 'paid',
  price: {
    amount: '49.00',
    offerAmount: null,
    currency: 'USD',
    period: { unit: 'months', count: 1 },
  },
  lifetime: false,
  monthlyMessages: 10000,
  chips: [],
  highlighted: false,
  current: false,
  action: 'upgrade',
  ctaLabel: 'Get started',
};

describe('formatMoney', () => {
  it('formats in the plan currency and the UI locale', () => {
    expect(formatMoney('49.00', 'USD', 'en')).toBe('$49.00');
    expect(formatMoney('19.5', 'EUR', 'en')).toContain('19.50');
  });

  it('never throws on a currency the runtime does not know', () => {
    expect(formatMoney('12.00', 'ZZZ', 'en')).toContain('12.00');
  });
});

describe('priceView', () => {
  it('free and custom plans have no price line', () => {
    expect(priceView({ ...base, kind: 'free' }, 'en')).toEqual({ kind: 'free' });
    expect(priceView({ ...base, kind: 'custom_quote' }, 'en')).toEqual({ kind: 'custom' });
  });

  it('a paid plan shows the list price with its period', () => {
    expect(priceView(base, 'en')).toEqual({
      kind: 'paid',
      main: '$49.00',
      strike: null,
      period: { unit: 'months', count: 1 },
      lifetime: false,
    });
  });

  it('an offer becomes the price and the list price is struck through', () => {
    const view = priceView({ ...base, price: { ...base.price, offerAmount: '39.00' } }, 'en');
    expect(view).toMatchObject({ kind: 'paid', main: '$39.00', strike: '$49.00' });
  });

  it('keeps the billing period parts for the translation to word', () => {
    const view = priceView(
      { ...base, price: { ...base.price, period: { unit: 'years', count: 2 } } },
      'en',
    );
    expect(view).toMatchObject({ period: { unit: 'years', count: 2 } });
  });
});

describe('messagesView', () => {
  it('0 means unlimited, anything else is a monthly cap', () => {
    expect(messagesView({ monthlyMessages: 0 })).toEqual({ kind: 'unlimited' });
    expect(messagesView({ monthlyMessages: 1000 })).toEqual({ kind: 'limited', count: 1000 });
  });
});

describe('ctaFor', () => {
  it('maps every action the API can report', () => {
    expect(ctaFor('current')).toEqual({ kind: 'current' });
    expect(ctaFor('continue_free')).toEqual({ kind: 'continue-free' });
    expect(ctaFor('contact_sales')).toEqual({
      kind: 'link',
      href: SUPPORT_PATH,
      label: 'talkToSales',
    });
    expect(ctaFor('upgrade')).toEqual({ kind: 'link', href: PLANS_PATH, label: 'upgrade' });
    expect(ctaFor('choose')).toEqual({ kind: 'link', href: PLANS_PATH, label: 'choose' });
    expect(ctaFor('downgrade_unavailable')).toEqual({
      kind: 'disabled',
      label: 'downgradeUnavailable',
    });
  });

  it('paid plans go to the placeholder route, never to a fake checkout', () => {
    expect(PLANS_PATH).toBe('/account/plans');
    expect(SUPPORT_PATH).toBe('/support');
  });
});
