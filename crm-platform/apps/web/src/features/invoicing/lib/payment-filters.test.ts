import { describe, expect, it } from 'vitest';
import { PAYMENT_METHODS } from '@crm/contracts';
import {
  agingQuery,
  DEFAULT_PAYMENT_FILTERS,
  hasActivePaymentFilter,
  METHOD_ORDER,
  orderedWindow,
  outstandingQuery,
  parsePaymentFilters,
  paymentFiltersToSearch,
  paymentQuery,
  toggleMethod,
} from './payment-filters';

const parse = (s: string) => parsePaymentFilters(new URLSearchParams(s));
const ID = '8b04e0f6-9e58-4597-a485-5e1b82a01760';

describe('payment filters in the address', () => {
  it('a plain address is the default', () => {
    expect(parse('')).toEqual(DEFAULT_PAYMENT_FILTERS);
    expect(paymentFiltersToSearch(DEFAULT_PAYMENT_FILTERS)).toBe('');
  });
  it('round-trips every field', () => {
    const f = parse(
      `view=outstanding&q=acme&kind=refund&method=bank,upi&currency=usd&from=2026-01-01&to=2026-02-01&contact=${ID}&invoice=${ID}&overdue=1&days=90`,
    );
    expect(f).toMatchObject({
      view: 'outstanding',
      q: 'acme',
      kind: 'refund',
      methods: ['bank', 'upi'],
      currency: 'USD',
      contact: ID,
      invoice: ID,
      onlyOverdue: true,
      days: 90,
    });
    expect(parse(paymentFiltersToSearch(f).slice(1))).toEqual(f);
  });
  it('drops unknown and malformed values', () => {
    const f = parse(
      'view=x&kind=y&method=bank,nope,bank&currency=EURO&from=2026-13-40&contact=abc&days=5',
    );
    expect(f).toEqual({ ...DEFAULT_PAYMENT_FILTERS, methods: ['bank'] });
  });
  it('keeps method commas readable', () => {
    expect(paymentFiltersToSearch({ ...DEFAULT_PAYMENT_FILTERS, methods: ['cash', 'card'] })).toBe(
      '?method=cash,card',
    );
  });
});

describe('queries', () => {
  it('ledger', () => {
    expect(
      paymentQuery({
        ...DEFAULT_PAYMENT_FILTERS,
        q: ' r1 ',
        methods: ['bank', 'card'],
        contact: ID,
      }),
    ).toMatchObject({
      q: 'r1',
      method: 'bank,card',
      contactId: ID,
      kind: undefined,
    });
  });
  it('outstanding and aging', () => {
    expect(
      outstandingQuery({ ...DEFAULT_PAYMENT_FILTERS, onlyOverdue: true, currency: 'INR' }),
    ).toEqual({
      q: undefined,
      currency: 'INR',
      onlyOverdue: true,
    });
    expect(agingQuery({ ...DEFAULT_PAYMENT_FILTERS, contact: ID })).toEqual({
      currency: undefined,
      contactId: ID,
    });
  });
});

describe('helpers', () => {
  it('orders every method once', () => {
    expect([...METHOD_ORDER].sort()).toEqual([...PAYMENT_METHODS].sort());
  });
  it('flags narrowing only', () => {
    expect(hasActivePaymentFilter({ ...DEFAULT_PAYMENT_FILTERS, view: 'aging', days: 7 })).toBe(
      false,
    );
    expect(hasActivePaymentFilter({ ...DEFAULT_PAYMENT_FILTERS, kind: 'refund' })).toBe(true);
  });
  it('orders a backwards window', () => {
    expect(orderedWindow('2026-02-01', '2026-01-01')).toEqual({
      from: '2026-01-01',
      to: '2026-02-01',
    });
    expect(orderedWindow('', '2026-01-01')).toEqual({ from: '', to: '2026-01-01' });
  });
  it('toggles methods in canonical order', () => {
    expect(toggleMethod(['card'], 'cash')).toEqual(['cash', 'card']);
    expect(toggleMethod(['upi', 'bank'], 'card')).toEqual(['bank', 'card', 'upi']);
    expect(toggleMethod(['cash', 'card'], 'cash')).toEqual(['card']);
  });
});
