import { Injectable } from '@nestjs/common';
import { MessageBillingService } from '../../wallet-message-billing';
import type { BilledSend, CampaignBilling, SettledSend } from './tokens';

/** `CampaignBilling` backed by wallet-message-billing (WD-WALLET-009..011). */
@Injectable()
export class WalletCampaignBilling implements CampaignBilling {
  constructor(private readonly billing: MessageBillingService) {}

  /**
   * Intentionally a no-op that allows every send: WaDesk's legacy send-time mode (consume a credit or stop at the plan cap) is not
   * ported. The launch gate (WALLET_GATE) refuses an unfunded launch up front and the wallet charges at delivery.
   */
  consume(_send: BilledSend): Promise<boolean> {
    return Promise.resolve(true);
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
