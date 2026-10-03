import { Injectable, Logger } from '@nestjs/common';
import { CodService } from './cod.service';
import { ConciergeService } from './concierge.service';
import { StockService } from './stock.service';

/**
 * The entry point the team inbox calls for every customer message (TW-ECOM-034). The handlers run in Reference's order, each guarded
 * and none stopping the others (one message can be taken by several): Shopify COD reply, Shopify stock opt-in, WooCommerce COD
 * reply, WooCommerce stock opt-in, WooCommerce concierge. Returns the names of the handlers that took the message.
 *
 * The catalog concierge, which Reference runs after these, belongs to the catalog domain and is called by the inbox separately.
 */
@Injectable()
export class EcomInboundService {
  private readonly logger = new Logger(EcomInboundService.name);

  constructor(
    private readonly cod: CodService,
    private readonly stock: StockService,
    private readonly concierge: ConciergeService,
  ) {}

  async handleInbound(orgId: number, phone: string, text: string): Promise<string[]> {
    const steps: Array<[string, () => Promise<boolean>]> = [
      ['shopify-cod', () => this.cod.handleReply(orgId, 'shopify', phone, text)],
      ['shopify-stock', () => this.stock.optIn(orgId, 'shopify', phone, text)],
      ['woocommerce-cod', () => this.cod.handleReply(orgId, 'woocommerce', phone, text)],
      ['woocommerce-stock', () => this.stock.optIn(orgId, 'woocommerce', phone, text)],
      ['woocommerce-concierge', () => this.concierge.handleInbound(orgId, phone, text)],
    ];
    const handled: string[] = [];
    for (const [name, run] of steps) {
      try {
        if (await run()) handled.push(name);
      } catch (err) {
        this.logger.warn(
          { orgId, handler: name, err },
          '[INBOUND] ecom handler failed (swallowed)',
        );
      }
    }
    return handled;
  }
}
