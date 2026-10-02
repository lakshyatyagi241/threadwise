import { describe, expect, it } from 'vitest';
import type { PaygwGatewayItem, PlaceOrderResponse } from '@crm/contracts';
import { buildUpdate, draftFrom, isDirty } from './gateway-draft';
import { currencyChoices, filterGateways, tabCounts } from './gateway-filter';
import { formatMoney } from './money';
import { nextStep, parseOutcome } from './next-action';
import { cancelledUrl } from './razorpay';

const gw = (over: Partial<PaygwGatewayItem>): PaygwGatewayItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'stripe',
  name: 'Stripe',
  description: '',
  regions: ['popular'],
  isActive: false,
  mode: 'sandbox',
  sortOrder: 1,
  supportedCurrencies: ['USD'],
  fields: [],
  keysSaved: false,
  driverAvailable: true,
  webhookUrl: '',
  rowVersion: 3,
  updatedAt: '2026-10-05T00:00:00.000Z',
  ...over,
});
const razorpay = gw({
  slug: 'razorpay',
  name: 'Razorpay',
  regions: ['popular', 'india'],
  supportedCurrencies: ['INR'],
});
const coinbase = gw({
  slug: 'coinbase',
  name: 'Coinbase Commerce',
  regions: ['crypto'],
  supportedCurrencies: ['BTC', 'USD'],
});
const all = [gw({}), razorpay, coinbase];

describe('gateway filter (TW-PAYGW-002)', () => {
  it('tab and search combine: India + "raz" leaves only Razorpay, clearing the search shows the tab again', () => {
    expect(filterGateways(all, 'india', 'raz').map((g) => g.slug)).toEqual(['razorpay']);
    expect(filterGateways(all, 'india', '').map((g) => g.slug)).toEqual(['razorpay']);
    expect(filterGateways(all, 'all', 'COIN').map((g) => g.slug)).toEqual(['coinbase']);
    expect(filterGateways(all, 'all', ' ')).toHaveLength(3);
  });
  it('counts per tab, a gateway counted once in each tab it belongs to', () => {
    const c = tabCounts(all);
    expect(c.all).toBe(3);
    expect(c.popular).toBe(2);
    expect(c.india).toBe(1);
    expect(c.crypto).toBe(1);
    expect(c.africa).toBe(0);
  });
  it('offers every currency any gateway lists, once, sorted', () => {
    expect(currencyChoices(all)).toEqual(['BTC', 'INR', 'USD']);
  });
});

describe('gateway draft (TW-PAYGW-003)', () => {
  const g = gw({});
  it('a fresh draft is clean; typing a secret, changing mode, currencies or removing a key makes it dirty', () => {
    expect(isDirty(g, draftFrom(g))).toBe(false);
    expect(isDirty(g, { ...draftFrom(g), values: { secret_key: 'sk' } })).toBe(true);
    expect(isDirty(g, { ...draftFrom(g), values: { secret_key: '  ' } })).toBe(false);
    expect(isDirty(g, { ...draftFrom(g), mode: 'live' })).toBe(true);
    expect(isDirty(g, { ...draftFrom(g), currencies: ['USD', 'EUR'] })).toBe(true);
    expect(isDirty(g, { ...draftFrom(g), cleared: ['secret_key'] })).toBe(true);
  });
  it('the PATCH leaves blank inputs out (a stored secret survives) and carries the row version', () => {
    const body = buildUpdate(g, {
      ...draftFrom(g),
      mode: 'live',
      values: { secret_key: ' sk ', publishable_key: '' },
      cleared: ['webhook_secret'],
    });
    expect(body).toEqual({
      mode: 'live',
      sortOrder: 1,
      supportedCurrencies: ['USD'],
      credentials: { secret_key: ' sk ' },
      clearCredentials: ['webhook_secret'],
      rowVersion: 3,
    });
  });
  it('a bad sort order keeps the current one; a key both typed and cleared counts as typed', () => {
    const body = buildUpdate(g, {
      ...draftFrom(g),
      sortOrder: 'abc',
      values: { secret_key: 'x' },
      cleared: ['secret_key'],
    });
    expect(body.sortOrder).toBe(1);
    expect(body.clearCredentials).toEqual([]);
  });
});

describe('what the browser does next (TW-PAYGW-011)', () => {
  const base = { orderNumber: 'WSN-1', orderId: '00000000-0000-4000-8000-000000000009' };
  it('redirect navigates, paid is done, a Razorpay action becomes widget options', () => {
    expect(
      nextStep({
        ...base,
        next: { type: 'redirect', url: 'https://pay.test/x' },
      } as PlaceOrderResponse),
    ).toEqual({ kind: 'navigate', url: 'https://pay.test/x' });
    expect(nextStep({ ...base, next: { type: 'paid' } } as PlaceOrderResponse)).toEqual({
      kind: 'done',
    });
    const step = nextStep({
      ...base,
      next: {
        type: 'client_action',
        provider: 'razorpay',
        params: {
          keyId: 'rzp',
          orderId: 'order_1',
          amountMinor: 482797,
          currency: 'INR',
          name: 'Growth',
          description: 'WSN-1',
          prefillName: 'Ada',
          prefillEmail: 'a@b.c',
          callbackUrl: 'https://api.test/v2/payments/return/razorpay?o=tok',
        },
      },
    } as PlaceOrderResponse);
    expect(step).toEqual({
      kind: 'razorpay',
      returnUrl: 'https://api.test/v2/payments/return/razorpay?o=tok',
      options: {
        key: 'rzp',
        order_id: 'order_1',
        amount: 482797,
        currency: 'INR',
        name: 'Growth',
        description: 'WSN-1',
        prefill: { name: 'Ada', email: 'a@b.c' },
      },
    });
  });
  it('a dismissed modal returns with cancelled=1, appended correctly', () => {
    expect(cancelledUrl('https://api.test/r?o=t')).toBe('https://api.test/r?o=t&cancelled=1');
    expect(cancelledUrl('https://api.test/r')).toBe('https://api.test/r?cancelled=1');
  });
  it('parses only the outcomes the API redirects with', () => {
    expect(parseOutcome('success')).toBe('success');
    expect(parseOutcome('pending')).toBe('pending');
    expect(parseOutcome('<script>')).toBeNull();
    expect(parseOutcome(null)).toBeNull();
  });
});

describe('money display', () => {
  it('formats in the currency, and survives an unknown code', () => {
    expect(formatMoney('46.02', 'USD', 'en-US')).toBe('$46.02');
    expect(formatMoney('5500', 'JPY', 'en-US')).toBe('¥5,500');
    expect(formatMoney('1', 'NOPE!', 'en-US')).toBe('1 NOPE!');
  });
});
