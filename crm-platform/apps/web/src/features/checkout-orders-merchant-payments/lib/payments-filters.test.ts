import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  cleanGatewayCode,
  filtersToQuery,
  filtersToSearch,
  hasActiveFilters,
  isDay,
  methodChoice,
  parseFilters,
  rangeIsInverted,
} from './payments-filters';
import {
  CONFIG_NAME_MAX,
  buildWaPayBody,
  emptyWaPayForm,
  formFromConfig,
  isExistingName,
  validateWaPay,
} from './payments-whatsapp';
import { waPayConfig } from './gateway-test-fixtures';

const params = (s: string) => new URLSearchParams(s);

describe('parseFilters', () => {
  it('reads every filter from the address', () => {
    expect(
      parseFilters(params('status=paid&method=razorpay&from=2026-10-01&to=2026-10-05&q=asha')),
    ).toEqual({
      status: 'paid',
      method: 'razorpay',
      from: '2026-10-01',
      to: '2026-10-05',
      q: 'asha',
    });
  });

  it('an empty address is no filter', () => {
    expect(parseFilters(params(''))).toEqual(EMPTY_FILTERS);
  });

  it('drops values the server would refuse', () => {
    const f = parseFilters(params('status=bogus&method=a b&from=2026-02-30&to=yesterday'));
    expect(f).toEqual(EMPTY_FILTERS);
  });

  it('lower-cases the method and keeps the two presets', () => {
    expect(parseFilters(params('method=COD')).method).toBe('cod');
    expect(parseFilters(params('method=Prepaid')).method).toBe('prepaid');
  });

  it('caps the search text', () => {
    expect(parseFilters(params(`q=${'x'.repeat(300)}`)).q).toHaveLength(120);
  });
});

describe('isDay', () => {
  it('accepts a real day only', () => {
    expect(isDay('2026-10-05')).toBe(true);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('26-10-05')).toBe(false);
  });
});

describe('filtersToSearch', () => {
  it('leaves empty filters out', () => {
    expect(filtersToSearch(EMPTY_FILTERS)).toBe('');
  });

  it('writes the set filters and round-trips through parseFilters', () => {
    const f = { status: 'awaiting', method: 'cod', from: '2026-10-01', to: '', q: 'a b' } as const;
    const search = filtersToSearch(f);
    expect(parseFilters(params(search))).toEqual(f);
  });

  it('keeps parameters that are not filters, like the shop', () => {
    const search = filtersToSearch(
      { ...EMPTY_FILTERS, status: 'paid' },
      'shop=abc&status=unpaid&q=old',
    );
    const p = params(search);
    expect(p.get('shop')).toBe('abc');
    expect(p.get('status')).toBe('paid');
    expect(p.has('q')).toBe(false);
  });
});

describe('filtersToQuery', () => {
  it('sends only what is set', () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toEqual({});
    expect(filtersToQuery({ ...EMPTY_FILTERS, status: 'paid', q: '  asha ' })).toEqual({
      status: 'paid',
      q: 'asha',
    });
  });

  it('does not send an inverted range', () => {
    const f = { ...EMPTY_FILTERS, from: '2026-10-09', to: '2026-10-01' };
    expect(rangeIsInverted(f)).toBe(true);
    expect(filtersToQuery(f)).toEqual({});
  });

  it('sends an open ended range and a same-day range', () => {
    expect(filtersToQuery({ ...EMPTY_FILTERS, from: '2026-10-01' })).toEqual({
      from: '2026-10-01',
    });
    const day = { ...EMPTY_FILTERS, from: '2026-10-01', to: '2026-10-01' };
    expect(rangeIsInverted(day)).toBe(false);
    expect(filtersToQuery(day)).toEqual({ from: '2026-10-01', to: '2026-10-01' });
  });
});

describe('small helpers', () => {
  it('hasActiveFilters ignores blank search text', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, q: '   ' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, method: 'cod' })).toBe(true);
  });

  it('methodChoice maps a free gateway slug to the gateway option', () => {
    expect(methodChoice('')).toBe('');
    expect(methodChoice('cod')).toBe('cod');
    expect(methodChoice('prepaid')).toBe('prepaid');
    expect(methodChoice('stripe')).toBe('gateway');
  });

  it('cleanGatewayCode keeps only code characters', () => {
    expect(cleanGatewayCode(' Raz or/pay! ')).toBe('razorpay');
    expect(cleanGatewayCode('pay_u-2')).toBe('pay_u-2');
  });
});

describe('WhatsApp Pay form', () => {
  it('starts active, razorpay, no auto-charge', () => {
    expect(emptyWaPayForm()).toEqual({
      configName: '',
      paymentType: 'razorpay',
      isActive: true,
      autoCharge: false,
    });
  });

  it('the name is 1 to 60 characters after trimming', () => {
    const base = emptyWaPayForm();
    expect(validateWaPay({ ...base, configName: '   ' })).toBe('name');
    expect(validateWaPay({ ...base, configName: 'a' })).toBeNull();
    expect(validateWaPay({ ...base, configName: 'a'.repeat(CONFIG_NAME_MAX) })).toBeNull();
    expect(validateWaPay({ ...base, configName: 'a'.repeat(CONFIG_NAME_MAX + 1) })).toBe('name');
  });

  it('builds the PUT body with a trimmed name', () => {
    expect(
      buildWaPayBody({
        configName: '  my-pay ',
        paymentType: 'payu',
        isActive: false,
        autoCharge: true,
      }),
    ).toEqual({ configName: 'my-pay', paymentType: 'payu', isActive: false, autoCharge: true });
  });

  it('editing starts from the saved row; an unknown type falls back', () => {
    expect(formFromConfig(waPayConfig({ paymentType: 'zaakpay', autoCharge: true }))).toEqual({
      configName: 'my-razorpay-pay',
      paymentType: 'zaakpay',
      isActive: true,
      autoCharge: true,
    });
    expect(formFromConfig(waPayConfig({ paymentType: 'mystery' })).paymentType).toBe('razorpay');
  });

  it('spots a name that is already saved', () => {
    const list = [waPayConfig()];
    expect(isExistingName(list, ' MY-razorpay-pay ')).toBe(true);
    expect(isExistingName(list, 'other')).toBe(false);
    expect(isExistingName(list, '')).toBe(false);
  });
});
