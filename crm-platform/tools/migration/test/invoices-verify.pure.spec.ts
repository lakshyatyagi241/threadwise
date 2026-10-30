import { describe, expect, it } from 'vitest';
import { invoiceAlarms, md5 } from '../reconcile/invoices';

const A = '3500650000008567084';
const B = '3500650000008567085';
const want = (o: Record<string, string>) => new Map(Object.entries(o).map(([k, v]) => [k, md5(v)]));

describe('wallet_legacy_invoices against the fetched file', () => {
  it('is clean when the table holds exactly the fetched invoices', () => {
    expect(
      invoiceAlarms('c', want({ [A]: 'one', [B]: 'two' }), want({ [A]: 'one', [B]: 'two' })),
    ).toEqual([]);
  });
  it('is clean when nothing was fetched and nothing is stored', () => {
    expect(invoiceAlarms('c', null, new Map())).toEqual([]);
    expect(invoiceAlarms('c', want({}), new Map())).toEqual([]);
  });
  it('alarms on rows with no file, an unknown row, a missing row and changed HTML', () => {
    expect(invoiceAlarms('c', null, want({ [A]: 'one' }))).toEqual([
      expect.stringContaining('INVOICES_EXTRA'),
    ]);
    expect(invoiceAlarms('c', want({ [A]: 'one' }), want({ [A]: 'one', [B]: 'x' }))).toEqual([
      expect.stringContaining('INVOICES_EXTRA'),
    ]);
    expect(invoiceAlarms('c', want({ [A]: 'one', [B]: 'two' }), want({ [A]: 'one' }))).toEqual([
      expect.stringContaining('INVOICES_MISSING'),
    ]);
    expect(invoiceAlarms('c', want({ [A]: 'one' }), want({ [A]: 'CHANGED' }))).toEqual([
      expect.stringContaining('INVOICES_CHANGED'),
    ]);
  });
});
