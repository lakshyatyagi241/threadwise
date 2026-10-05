import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import type { WebhookPayment } from '../../../infra/providers/platform-payment-gateways';

/** What a settler is told about a verified payment notification. The signature was checked with the right gateway's secret already. */
export interface GatewayPaymentContext {
  tx: Tx;
  orgId: number;
  /** The gateway row that verified the notification. `storefrontId` 0 is the workspace gateway (it may settle any shop's payment). */
  gateway: { id: number; uuid: string; slug: string; storefrontId: number };
  payment: WebhookPayment;
  /** `payment.orderNumber` as the provider echoed it. */
  reference: string;
}

/** `applied`, `duplicate` (already settled) or `rejected:<reason>`; only for the response and the log. */
export interface GatewayPaymentOutcome {
  outcome: string;
}

/**
 * Who settles a payment, chosen by the reference prefix our own order number carries (`WAORD-` store orders, `INV-` invoice attempts).
 * The shared gateway has ONE webhook address per row; this is how a verified notification reaches the domain that issued the
 * reference without the gateway module importing store or invoicing code. A domain registers itself in `onModuleInit`.
 */
export interface GatewayPaymentSettler {
  readonly prefix: string;
  settle(ctx: GatewayPaymentContext): Promise<GatewayPaymentOutcome>;
}

@Injectable()
export class GatewayPaymentRegistry {
  private readonly settlers = new Map<string, GatewayPaymentSettler>();

  register(settler: GatewayPaymentSettler): void {
    this.settlers.set(settler.prefix, settler);
  }

  forReference(reference: string): GatewayPaymentSettler | undefined {
    for (const [prefix, settler] of this.settlers) {
      if (reference.startsWith(prefix)) return settler;
    }
    return undefined;
  }
}
