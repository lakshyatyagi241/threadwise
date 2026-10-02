import { describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT } from '@crm/contracts';
import { WalletRealtimePublisher } from '../../../src/modules/wallet-message-billing/wallet-realtime.publisher';
import type { RealtimeEmitter } from '../../../src/realtime';

function make() {
  const emit = vi.fn(async () => ({ rooms: [] }));
  return { emit, pub: new WalletRealtimePublisher({ emit } as unknown as RealtimeEmitter) };
}

describe('WalletRealtimePublisher (TW-WALLET-023)', () => {
  it('pushes the new balance to the workspace room', async () => {
    const { emit, pub } = make();
    await pub.balanceChanged(7, 1234, 'topup');
    expect(emit).toHaveBeenCalledWith(7, [{ kind: 'org' }], REALTIME_EVENT.walletUpdated, {
      balanceMinor: 1234,
      reason: 'topup',
    });
  });

  it('collapses a burst of charges to one push per workspace, but never drops a top-up, refund or adjustment', async () => {
    const { emit, pub } = make();
    for (let i = 0; i < 50; i++) await pub.balanceChanged(1, 1000 - i, 'charge');
    expect(emit).toHaveBeenCalledTimes(1);
    await pub.balanceChanged(1, 5000, 'topup');
    await pub.balanceChanged(1, 4900, 'refund');
    await pub.balanceChanged(1, 4800, 'adjustment');
    expect(emit).toHaveBeenCalledTimes(4);
    await pub.balanceChanged(2, 10, 'charge');
    expect(emit).toHaveBeenCalledTimes(5);
  });

  it('never throws when the transport fails', async () => {
    const emit = vi.fn(async () => {
      throw new Error('redis down');
    });
    const pub = new WalletRealtimePublisher({ emit } as unknown as RealtimeEmitter);
    await expect(pub.balanceChanged(1, 1, 'refund')).resolves.toBeUndefined();
  });
});
