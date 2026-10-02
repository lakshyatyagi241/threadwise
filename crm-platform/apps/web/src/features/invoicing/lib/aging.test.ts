import { describe, expect, it } from 'vitest';
import { bucketHref, bucketRange, bucketRows, minorBig, shareLabel, shareTenths, BUCKETS } from './aging';

describe('minorBig', () => {
  it('is exact for the currency exponent', () => {
    expect(minorBig('1250.00', 'USD')).toBe(125000n);
    expect(minorBig('0.5', 'USD')).toBe(50n);
    expect(minorBig('1500', 'JPY')).toBe(1500n);
    expect(minorBig('1.234', 'KWD')).toBe(1234n);
    expect(minorBig('-25.00', 'USD')).toBe(-2500n);
    expect(minorBig(null, 'USD')).toBe(0n);
  });
});

describe('shares', () => {
  it('uses integer tenths of a percent, rounded half up', () => {
    expect(shareTenths(1n, 3n)).toBe(333);
    expect(shareTenths(2n, 3n)).toBe(667);
    expect(shareTenths(1n, 1n)).toBe(1000);
    expect(shareTenths(0n, 5n)).toBe(0);
    expect(shareTenths(5n, 0n)).toBe(0);
  });
  it('is exact beyond the float range', () => {
    expect(shareTenths(10n ** 18n, 4n * 10n ** 18n)).toBe(250);
  });
  it('labels', () => {
    expect(shareLabel(500)).toBe('50%');
    expect(shareLabel(417)).toBe('41.7%');
    expect(shareLabel(0)).toBe('0%');
  });
});

describe('bucketRows', () => {
  it('keeps the display order and fills what the server left out', () => {
    const rows = bucketRows(
      [
        { bucket: 'd31_60', amount: '100.00', invoices: 1 },
        { bucket: 'current', amount: '300.00', invoices: 2 },
      ],
      'USD',
    );
    expect(rows.map((r) => r.bucket)).toEqual([...BUCKETS]);
    expect(rows[0]).toMatchObject({ amount: 30000n, invoices: 2, tenths: 750 });
    expect(rows[2]).toMatchObject({ amount: 10000n, tenths: 250 });
    expect(rows[1]).toMatchObject({ amount: 0n, invoices: 0, tenths: 0 });
  });
});

describe('bucket ranges (due dates, as of the report day)', () => {
  const asOf = '2026-10-15';
  it('current is due today or later', () => expect(bucketRange('current', asOf)).toEqual({ dueFrom: '2026-10-15' }));
  it('1-30 days late', () => expect(bucketRange('d1_30', asOf)).toEqual({ dueFrom: '2026-09-15', dueTo: '2026-10-14' }));
  it('31-60 days late', () => expect(bucketRange('d31_60', asOf)).toEqual({ dueFrom: '2026-08-16', dueTo: '2026-09-14' }));
  it('61-90 days late', () => expect(bucketRange('d61_90', asOf)).toEqual({ dueFrom: '2026-07-17', dueTo: '2026-08-15' }));
  it('over 90 days has only an upper end', () => expect(bucketRange('d90_plus', asOf)).toEqual({ dueTo: '2026-07-16' }));
  it('builds the invoice list link', () => {
    expect(bucketHref('d1_30', asOf, { currency: 'USD' })).toBe(
      '/invoices?status=issued,partially_paid,overdue&dueFrom=2026-09-15&dueTo=2026-10-14&currency=USD',
    );
  });
});
