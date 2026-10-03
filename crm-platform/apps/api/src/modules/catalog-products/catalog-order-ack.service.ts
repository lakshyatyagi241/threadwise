import { Inject, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  BAILEYS_CATALOG_BRIDGE,
  CATALOG_PROVIDER,
  type BaileysCatalogBridge,
  type CatalogProvider,
} from '../../infra/providers/catalog-products/catalog-provider.port';
import { SENDER_DIRECTORY, type SenderDirectory } from './_shims/tokens';
import { asMeta, buildOrderAck, orderAckEnabled } from './catalog-automation';
import { CatalogBindings } from './catalog-bindings';
import { digitsOf } from './catalog-rules';
import { CatalogsRepository } from './catalogs.repository';

export interface CatalogOrderForAck {
  orgId: number;
  /** The order's number shown to the customer (`#<orderNumber>`). */
  orderNumber: string;
  customerPhone: string | null;
  customerName: string | null;
  /** Sum of the line quantities. */
  itemCount: number;
  currencyCode: string | null;
  totalMinor: number;
}

/**
 * Order acknowledgement (WD-CAT-029). When a customer sends a catalog cart, Meta records it and answers nothing; this sends the
 * order-received message (item count, total, an optional pay link) so the buyer is not left in silence.
 *
 * ON by default (only an explicit `order_ack_enabled = false` turns it off). It goes out through the catalog's Meta binding,
 * else through a connected device on the bridge. It never throws.
 *
 * NOT WIRED / PARTIAL: the inbound webhook that captures the order and calls `acknowledge` belongs to the checkout-orders and
 * webhook domains. The optional approved-template path (`order_ack_template_id`) needs the message-templates domain; until it
 * lands the built-in text is sent even when a template id is stored (the id is preserved).
 */
@Injectable()
export class CatalogOrderAckService {
  private readonly logger = new Logger(CatalogOrderAckService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly catalogs: CatalogsRepository,
    private readonly bindings: CatalogBindings,
    @Inject(CATALOG_PROVIDER) private readonly provider: CatalogProvider,
    @Inject(BAILEYS_CATALOG_BRIDGE) private readonly bridge: BaileysCatalogBridge,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
  ) {}

  /** True when a message went out. */
  async acknowledge(order: CatalogOrderForAck): Promise<boolean> {
    const to = digitsOf(order.customerPhone);
    if (to === '') return false;
    try {
      const plan = await this.db.txAs({ orgId: order.orgId, userId: null }, async (tx) => ({
        catalog: await this.catalogs.first(tx, order.orgId),
        fallback: await this.senders.baileysDevice(tx, order.orgId, undefined),
      }));
      if (!orderAckEnabled(plan.catalog?.metaJson)) return false;

      const text = buildOrderAck({
        customerName: order.customerName,
        orderNumber: order.orderNumber,
        itemCount: order.itemCount,
        currencyCode: order.currencyCode,
        totalMinor: order.totalMinor,
        payUrlBase:
          typeof asMeta(plan.catalog?.metaJson).order_ack_pay_url === 'string'
            ? (asMeta(plan.catalog?.metaJson).order_ack_pay_url as string) || null
            : null,
        orderRef: order.orderNumber,
      });

      if (plan.catalog && plan.catalog.catalogId) {
        await this.provider.sendText(this.bindings.of(plan.catalog), to, text);
        return true;
      }
      if (plan.fallback?.phone) {
        await this.bridge.sendText({ senderPhone: plan.fallback.phone, to, text });
        return true;
      }
      return false;
    } catch (err) {
      this.logger.warn(
        { orgId: order.orgId, err: err instanceof Error ? err.message : 'failed' },
        'order acknowledgement failed',
      );
      return false;
    }
  }
}
