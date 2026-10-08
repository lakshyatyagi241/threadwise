import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { CatalogSendService } from '../../../../catalog-products';
import type { FlowShopPort } from './shop-port';

type Rows = { rows: Array<Record<string, unknown>> };

/**
 * What the catalog domain can answer for the Commerce shop node (WD-FLR-041), bound to the node's gate by `ShopGateBinder`, which gives WhatsApp Shop to this adapter and the other providers to the store domain.
 *
 * - Stock, for WhatsApp Shop: the product's own flags and counts (`in_stock`, `stock_qty` less what is held), by Meta retailer id.
 * - The native product list, for WhatsApp Shop: the catalog's own send (`CatalogSendService`, the multi-product message), to the one
 *   customer, so the cart and checkout are WhatsApp's; the order then comes back as a catalog cart (WD-WABA-042).
 * - The single-use checkout link and the WooCommerce and Shopify stock: the store domains expose neither, so these still answer
 *   "cannot" and the node takes its own failure path (WaDesk's, too).
 */
@Injectable()
export class CatalogShopAdapter implements FlowShopPort {
  private readonly logger = new Logger(CatalogShopAdapter.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly catalogSend: CatalogSendService,
  ) {}

  async inStock(
    orgId: number,
    input: { provider: string; storeId: string; retailerIds: string[] },
  ): Promise<Set<string> | null> {
    if (input.provider !== 'whatsapp_shop' || input.retailerIds.length === 0) return null;
    const res = (await this.db.txAs({ orgId }, (tx) =>
      tx.execute(
        sql`SELECT meta_retailer_id FROM wa_products
             WHERE org_id = ${orgId} AND status = 'active' AND in_stock
               AND (stock_qty IS NULL OR stock_qty - reserved_qty > 0)
               AND meta_retailer_id IN (${sql.join(
                 input.retailerIds.map((r) => sql`${r}`),
                 sql`, `,
               )})`,
      ),
    )) as unknown as Rows;
    return new Set(res.rows.map((r) => String(r.meta_retailer_id)));
  }

  async sendNative(
    orgId: number,
    input: {
      provider: string;
      products: Array<{ retailerId: string }>;
      header: string;
      body: string;
      footer: string;
      peerKey: string;
    },
  ): Promise<boolean> {
    if (input.provider !== 'whatsapp_shop') return false;
    const ids = input.products.map((p) => p.retailerId);
    const found = (await this.db.txAs({ orgId }, (tx) =>
      tx.execute(
        sql`SELECT uuid, meta_retailer_id FROM wa_products
             WHERE org_id = ${orgId} AND meta_retailer_id IN (${sql.join(
               ids.map((r) => sql`${r}`),
               sql`, `,
             )})`,
      ),
    )) as unknown as Rows;
    const byRetailer = new Map(found.rows.map((r) => [String(r.meta_retailer_id), String(r.uuid)]));
    // The order the flow offered them in, and only the ones the catalog really has.
    const productIds = ids.map((r) => byRetailer.get(r)).filter((u): u is string => Boolean(u));
    if (productIds.length === 0) return false;
    try {
      const sent = await RequestContextStore.run(
        {
          requestId: `flow-shop-${orgId}`,
          orgId,
          actorType: 'system',
          actorId: null,
          userId: null,
        },
        () =>
          this.catalogSend.send({
            mode: productIds.length === 1 ? 'spm' : 'mpm',
            manualNumbers: input.peerKey,
            groupIds: [],
            contactIds: [],
            productIds,
            header: input.header || null,
            body: input.body || null,
            footer: input.footer || null,
          }),
      );
      return sent.sent > 0;
    } catch (err) {
      this.logger.warn({ orgId, err: String(err) }, 'the native product list could not be sent');
      return false;
    }
  }

  checkoutLink(): Promise<string | null> {
    return Promise.resolve(null);
  }
}
