import { describe, expect, it } from 'vitest';
import { splitExact } from '../../../src/modules/wallet-message-billing/wallet-query.service';
import type { LedgerRow } from '../../../src/modules/wallet-message-billing/wallet.repository';

const row = (amountMinor: number, amountExact: string): LedgerRow =>
  ({ amountMinor, amountExact }) as LedgerRow;

describe('splitExact', () => {
  it('puts a charge under a cent in money out at its exact figure', () => {
    expect(splitExact(row(-95, '-0.958'))).toEqual({
      moneyInMinor: 0,
      moneyInExact: '0.00',
      moneyOutMinor: 95,
      moneyOutExact: '0.958',
    });
  });
  it('puts a credit in money in', () => {
    expect(splitExact(row(20000, '200.00'))).toEqual({
      moneyInMinor: 20000,
      moneyInExact: '200.00',
      moneyOutMinor: 0,
      moneyOutExact: '0.00',
    });
  });
  it('keeps a zero movement in neither column', () => {
    const r = splitExact(row(0, '0.00'));
    expect(r.moneyInExact).toBe('0.00');
    expect(r.moneyOutExact).toBe('0.00');
  });
});
