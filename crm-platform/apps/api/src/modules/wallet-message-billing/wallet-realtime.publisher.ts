import { Injectable, Logger } from '@nestjs/common';
import { REALTIME_EVENT } from '@crm/contracts';
import { RealtimeEmitter } from '../../realtime';

const MIN_GAP_MS = 1500;

/**
 * Tells every open screen of a workspace that its wallet balance moved (TW-WALLET-023), so the balance chip updates without a
 * reload. Called by the worker AFTER the settlement or posting committed, never inside a transaction. A burst of message charges
 * is collapsed to one push per workspace per 1.5 s (the latest figure wins), so a 5,000-message blast does not become 5,000
 * socket events. Best effort and never throws: a client that missed one catches up on its next poll.
 */
@Injectable()
export class WalletRealtimePublisher {
  private readonly logger = new Logger(WalletRealtimePublisher.name);
  private readonly last = new Map<number, number>();

  constructor(private readonly emitter: RealtimeEmitter) {}

  async balanceChanged(
    orgId: number,
    balanceMinor: number,
    reason: 'charge' | 'refund' | 'topup' | 'adjustment',
  ): Promise<void> {
    const now = Date.now();
    // Charges coalesce; everything else is rare and always goes out.
    if (reason === 'charge' && now - (this.last.get(orgId) ?? 0) < MIN_GAP_MS) return;
    this.last.set(orgId, now);
    if (this.last.size > 5000) this.last.clear();
    try {
      await this.emitter.emit(orgId, [{ kind: 'org' }], REALTIME_EVENT.walletUpdated, {
        balanceMinor,
        reason,
      });
    } catch (err) {
      this.logger.warn({ err, orgId }, '[WALLET] could not publish the balance');
    }
  }
}
