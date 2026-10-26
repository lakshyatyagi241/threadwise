import { describe, expect, it } from 'vitest';
import { matchProviderRefund } from '../../../src/modules/platform-payment-gateways/refund-reconciler.service';

const row = { uuid: 'u1', amount: 25000n, createdAt: new Date('2026-10-22T10:00:00Z') };
const refund = (over: Partial<Parameters<typeof matchProviderRefund>[1][number]> = {}) => ({
  id: 'rfnd_1',
  amountMinor: 25000n,
  status: 'processed',
  createdAt: new Date('2026-10-22T10:00:05Z'),
  reference: null as string | null,
  ...over,
});

describe('matchProviderRefund', () => {
  it('prefers the refund that carries our row uuid, whatever its amount', () => {
    const list = [
      refund({ id: 'rfnd_a' }),
      refund({ id: 'rfnd_b', amountMinor: 1n, reference: 'u1' }),
    ];
    expect(matchProviderRefund(row, list, new Set())?.id).toBe('rfnd_b');
  });

  it('falls back to the same amount, made after the row, for a refund made before references existed', () => {
    expect(matchProviderRefund(row, [refund()], new Set())?.id).toBe('rfnd_1');
    expect(matchProviderRefund(row, [refund({ amountMinor: 5000n })], new Set())).toBeNull();
    expect(
      matchProviderRefund(
        row,
        [refund({ createdAt: new Date('2026-10-22T09:00:00Z') })],
        new Set(),
      ),
    ).toBeNull();
  });

  it("never takes a refund that is another row's, by reference or by amount", () => {
    expect(matchProviderRefund(row, [refund({ reference: 'u2' })], new Set())).toBeNull();
    expect(matchProviderRefund(row, [refund()], new Set(['rfnd_1']))).toBeNull();
  });

  it('finds nothing in an empty list (the provider holds no refund for the payment)', () => {
    expect(matchProviderRefund(row, [], new Set())).toBeNull();
  });
});
