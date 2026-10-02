import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PlatformWalletService } from './platform-wallet.service';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Hourly: does every wallet balance still equal the sum of its ledger? WaDesk kept two balance mirrors that drifted and had no
 * way to notice (WD-WALLET-002 rule 5, open question 18). A mismatch is an error row in the workspace's wallet log and an error
 * line in the process log. Worker process only.
 */
@Injectable()
export class WalletReconcileJob {
  private readonly logger = new Logger(WalletReconcileJob.name);
  private running = false;

  constructor(private readonly wallets: PlatformWalletService) {}

  @Interval(HOUR_MS)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.wallets.reconcile();
      if (result.mismatches.length > 0) {
        this.logger.error(
          { mismatches: result.mismatches.length, checked: result.workspacesChecked },
          '[WALLET] ledger and balance disagree',
        );
      } else {
        this.logger.log({ checked: result.workspacesChecked }, '[WALLET] reconciliation clean');
      }
    } catch (err) {
      this.logger.error({ err }, '[WALLET] reconciliation failed');
    } finally {
      this.running = false;
    }
  }
}
