import { Injectable } from '@nestjs/common';
import { WalletGateService } from '../../wallet-message-billing';
import type { WalletGate, WalletGateOptions } from './tokens';

/** The bulk-send launch gate, backed by the wallet domain's own check (WD-WALLET-013). Broadcasts and campaigns share it. */
@Injectable()
export class BillingWalletGate implements WalletGate {
  constructor(private readonly gate: WalletGateService) {}

  precheck(orgId: number, count: number, opts: WalletGateOptions = {}): Promise<void> {
    return this.gate.assertCanLaunch({
      orgId,
      source: opts.source ?? 'broadcast',
      recipients: count,
      ...(opts.phones ? { phones: opts.phones } : {}),
      ...(opts.category !== undefined ? { category: opts.category } : {}),
    });
  }
}
