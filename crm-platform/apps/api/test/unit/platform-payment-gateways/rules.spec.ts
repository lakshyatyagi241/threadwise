import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addCalendar,
  nextPlanEnd,
} from '../../../src/modules/platform-payment-gateways/fulfilment-rules';
import {
  acceptsCurrency,
  availableCurrencies,
  mergeCredentials,
  missingRequired,
  webhookSecretMissing,
} from '../../../src/modules/platform-payment-gateways/gateway-rules';
import {
  billingPeriodFor,
  breakdown,
  convertMinor,
  divRound,
  newOrderNumber,
  taxMinor,
  yearlyMinor,
} from '../../../src/modules/platform-payment-gateways/order-pricing';
import { trimMoney } from '../../../src/modules/platform-payment-gateways/orders.mapper';

describe('credential merge (TW-PAYGW-003)', () => {
  const stored = { secret_key: 'sk_old', publishable_key: 'pk_old' };

  it('a blank field keeps the stored secret', () => {
    const r = mergeCredentials(
      'stripe',
      stored,
      { secret_key: '', publishable_key: '  ' },
      undefined,
    );
    expect(r.merged).toEqual(stored);
    expect(r.keysSet).toEqual([]);
  });
  it('overwrites only the keys that were sent, and reports the KEYS, never values', () => {
    const r = mergeCredentials('stripe', stored, { webhook_secret: 'whsec_new' }, undefined);
    expect(r.merged).toEqual({ ...stored, webhook_secret: 'whsec_new' });
    expect(r.keysSet).toEqual(['webhook_secret']);
  });
  it('ignores keys the gateway does not declare (no injection)', () => {
    const r = mergeCredentials(
      'stripe',
      stored,
      { evil_key: 'x', secret_key: 'sk_new' },
      undefined,
    );
    expect(r.merged).toEqual({ ...stored, secret_key: 'sk_new' });
    expect(r.keysSet).toEqual(['secret_key']);
  });
  it('removes a credential only when it is named explicitly', () => {
    const r = mergeCredentials('stripe', stored, {}, ['publishable_key', 'evil_key']);
    expect(r.merged).toEqual({ secret_key: 'sk_old' });
    expect(r.keysCleared).toEqual(['publishable_key']);
  });
});

describe('activation guard and webhook rule', () => {
  it('lists the required fields still empty', () => {
    expect(missingRequired('stripe', {})).toEqual(['secret_key']);
    expect(missingRequired('razorpay', { key_id: 'a' })).toEqual(['key_secret']);
    expect(missingRequired('stripe', { secret_key: 'sk' })).toEqual([]);
    expect(missingRequired('bank_transfer', { beneficiary_name: 'x' })).toEqual([
      'bank_name',
      'account_number',
      'ifsc_or_swift',
    ]);
    expect(missingRequired('phonepe', {})).toEqual([]); // every PhonePe field is optional
  });
  it('a gateway with signing fields none of which is set fails closed', () => {
    expect(webhookSecretMissing('stripe', { secret_key: 'x' })).toBe(true);
    expect(webhookSecretMissing('stripe', { webhook_secret: 'whsec' })).toBe(false);
    expect(webhookSecretMissing('paypal', {})).toBe(true);
    expect(webhookSecretMissing('mollie', {})).toBe(false); // no signing field at all
  });
});

describe('currency availability (TW-PAYGW-006)', () => {
  it('empty or null whitelist accepts everything; otherwise case-insensitive', () => {
    expect(acceptsCurrency(null, 'EUR')).toBe(true);
    expect(acceptsCurrency([], 'EUR')).toBe(true);
    expect(acceptsCurrency(['INR'], 'inr')).toBe(true);
    expect(acceptsCurrency(['INR'], 'EUR')).toBe(false);
  });
  it('is the enabled currencies narrowed to the union of the active whitelists', () => {
    expect(availableCurrencies(['USD', 'INR', 'EUR'], [['INR'], ['USD']])).toEqual(['INR', 'USD']);
  });
  it('falls back to every enabled currency for an unrestricted gateway, no gateway, or an empty intersection', () => {
    expect(availableCurrencies(['USD', 'INR'], [['INR'], []])).toEqual(['INR', 'USD']);
    expect(availableCurrencies(['USD', 'INR'], [])).toEqual(['INR', 'USD']);
    expect(availableCurrencies(['USD', 'INR'], [['JPY']])).toEqual(['INR', 'USD']);
  });
});

describe('order arithmetic (TW-PAYGW-011)', () => {
  it('reproduces the inventory example: 49.00, coupon 10, tax 18% = 7.02, total 46.02', () => {
    const b = breakdown(4900n, 'USD', 1000n, '18');
    expect(b).toMatchObject({
      subtotal: '49.00',
      discount: '10.00',
      tax: '7.02',
      total: '46.02',
      totalMinor: 4602n,
    });
  });
  it('rounds tax half up and never lets a discount go below zero', () => {
    expect(taxMinor(1005n, '18')).toBe(181n); // 180.9
    expect(taxMinor(1n, '50')).toBe(1n); // 0.5 -> 1
    expect(breakdown(500n, 'USD', 900n, '18').total).toBe('0.00');
  });
  it('honours the currency exponent: JPY has no decimals, KWD has three', () => {
    expect(breakdown(5000n, 'JPY', 0n, '10')).toMatchObject({
      tax: '500',
      total: '5500',
      totalMinor: 5500n,
    });
    expect(breakdown(1500n, 'KWD', 0n, '5').total).toBe('1.575');
  });
  it('yearly = 12 months less the yearly discount', () => {
    expect(yearlyMinor(4900n, 20)).toBe(47040n); // 49 x 12 x 0.8 = 470.40
    expect(yearlyMinor(4900n, 0)).toBe(58800n);
  });
  it('converts with exchange rates, exactly, and refuses an unknown rate', () => {
    const rates = new Map([
      ['USD', '1.000000'],
      ['INR', '83.500000'],
    ]);
    expect(convertMinor(1000n, 'USD', 'INR', rates)).toBe(83500n);
    expect(convertMinor(83500n, 'INR', 'USD', rates)).toBe(1000n);
    expect(convertMinor(1000n, 'USD', 'USD', new Map())).toBe(1000n);
    expect(convertMinor(1000n, 'USD', 'EUR', rates)).toBeNull();
    expect(
      convertMinor(
        1000n,
        'USD',
        'JPY',
        new Map([
          ['USD', '1'],
          ['JPY', '150'],
        ]),
      ),
    ).toBe(1500n);
  });
  it('divRound rounds half up', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(4n, 3n)).toBe(1n);
  });
});

describe('billing period (TW-PAYGW-011 rule 3)', () => {
  const monthly = {
    kind: 'plan',
    billingUnit: 'months',
    isFree: false,
    isLifetime: false,
    isCustomQuote: false,
  } as const;
  it('add-ons, free, lifetime and custom plans are always monthly', () => {
    expect(billingPeriodFor({ ...monthly, kind: 'addon' }, 'yearly', true)).toBe('monthly');
    expect(billingPeriodFor({ ...monthly, isLifetime: true }, 'yearly', true)).toBe('monthly');
  });
  it('a natively yearly plan is yearly whatever was asked', () => {
    expect(billingPeriodFor({ ...monthly, billingUnit: 'years' }, 'monthly', false)).toBe('yearly');
  });
  it('yearly needs both the request and the platform toggle', () => {
    expect(billingPeriodFor(monthly, 'yearly', true)).toBe('yearly');
    expect(billingPeriodFor(monthly, 'yearly', false)).toBe('monthly');
    expect(billingPeriodFor(monthly, undefined, true)).toBe('monthly');
  });
});

describe('plan window (TW-PAYGW-028 rule 5)', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  const month = {
    billingUnit: 'months',
    billingDuration: 1,
    isFree: false,
    isLifetime: false,
    isCustomQuote: false,
  } as const;
  it('stacks on the later of now and the current end: paying early loses no days', () => {
    const end = nextPlanEnd(now, new Date('2026-10-15T00:00:00Z'), month, 'monthly');
    expect(end?.toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });
  it('starts from now when the plan already ended or never had a window', () => {
    expect(
      nextPlanEnd(now, new Date('2026-09-01T00:00:00Z'), month, 'monthly')?.toISOString(),
    ).toBe('2026-11-05T00:00:00.000Z');
    expect(nextPlanEnd(now, null, month, 'monthly')?.toISOString()).toBe(
      '2026-11-05T00:00:00.000Z',
    );
  });
  it('yearly on a one-month plan is one year; free, lifetime and custom plans never expire', () => {
    expect(nextPlanEnd(now, null, month, 'yearly')?.toISOString()).toBe('2027-10-05T00:00:00.000Z');
    expect(nextPlanEnd(now, null, { ...month, isLifetime: true }, 'monthly')).toBeNull();
    expect(nextPlanEnd(now, null, { ...month, isFree: true }, 'monthly')).toBeNull();
  });
  it('clamps the day at month end', () => {
    expect(addCalendar(new Date('2026-01-31T00:00:00Z'), 'months', 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addCalendar(new Date('2028-01-31T00:00:00Z'), 'months', 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(addCalendar(now, 'weeks', 2).toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });
});

describe('small helpers', () => {
  it('order numbers look like WSN-yymmdd-XXXXXX', () => {
    expect(newOrderNumber(new Date('2026-10-05T10:00:00Z'), () => 'ABC123')).toBe(
      'WSN-261005-ABC123',
    );
  });
  it('numeric(12,4) text is trimmed to the currency exponent', () => {
    expect(trimMoney('46.0200', 'USD')).toBe('46.02');
    expect(trimMoney('5500.0000', 'JPY')).toBe('5500');
    expect(trimMoney('1.5750', 'KWD')).toBe('1.575');
  });
});

describe('the privileged door', () => {
  it('only paygw.store.ts calls .privileged( in the module', () => {
    const dir = join(__dirname, '../../../src/modules/platform-payment-gateways');
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && f !== 'paygw.store.ts')
      .filter((f) => /\.privileged\(/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
