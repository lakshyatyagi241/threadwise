import { Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import { MessageBillingService, WalletGateService } from '../../wallet-message-billing';
import type { BilledSend, CampaignBilling, SettledSend } from './tokens';

/** `CampaignBilling` backed by wallet-message-billing (TW-WALLET-009..011). */
@Injectable()
export class WalletCampaignBilling implements CampaignBilling {
  constructor(
    private readonly billing: MessageBillingService,
    private readonly gate: WalletGateService,
  ) {}

  /**
   * The per-recipient wallet check: false when the wallet cannot pay for this message, so the run stops instead of sending a
   * campaign (or several started on one balance) for free. The launch gate (WALLET_GATE) alone cannot see the balance drain.
   */
  async consume(send: BilledSend): Promise<boolean> {
    try {
      await this.gate.assertCanSend({
        orgId: send.orgId,
        source: 'campaign',
        to: send.to,
        category: 'marketing',
      });
      return true;
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.WALLET_EMPTY) return false;
      throw err;
    }
  }

  async settleDelivered(send: SettledSend): Promise<void> {
    await this.billing.settleDelivered({
      orgId: send.orgId,
      provider: send.provider,
      providerMessageId: send.providerMessageId,
      recipient: send.to,
      category: send.category ?? null,
      source: 'campaign',
    });
  }

  async settleFailed(orgId: number, providerMessageId: string): Promise<void> {
    await this.billing.settleFailed(orgId, providerMessageId);
  }
}
