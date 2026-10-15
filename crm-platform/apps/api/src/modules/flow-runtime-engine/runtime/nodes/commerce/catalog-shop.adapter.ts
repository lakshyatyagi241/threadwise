import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { CatalogSendService, resolveVariantRetailerIds } from '../../../../catalog-products';
import type { FlowShopPort } from './shop-port';

type Rows = { rows: Array<Record<string, unknown>> };

/**
 * What the catalog domain can answer for the Commerce shop node (TW-FLR-041), bound to the node's gate by `ShopGateBinder`, which gives WhatsApp Shop to this adapter and the other providers to the store domain.
 *
 * - Stock, for WhatsApp Shop: the product's own flags and counts (`in_stock`, `stock_qty` less what is held), by Meta retailer id.
 * - The native product list, for WhatsApp Shop: the catalog's own send (`CatalogSendService`, the multi-product message), to the one
 *   customer, so the cart and checkout are WhatsApp's; the order then comes back as a catalog cart (TW-WABA-042).
 * - The single-use checkout link and the WooCommerce and Shopify stock: the store domains expose neither, so these still answer
 *   "cannot" and the node takes its own failure path (Reference's, too).
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
    // A retailer id is a product's, or a variant's (a product with variants is offered through its variants): a variant is in stock
    // when it is active and has something not held; the product's own row is the aggregate, true while any variant is sellable.
    const out = await this.db.txAs({ orgId }, async (tx) => {
      const res = (await tx.execute(
        sql`SELECT meta_retailer_id FROM wa_products
             WHERE org_id = ${orgId} AND status = 'active' AND in_stock
               AND (stock_qty IS NULL OR stock_qty - reserved_qty > 0)
               AND meta_retailer_id IN (${sql.join(
                 input.retailerIds.map((r) => sql`${r}`),
                 sql`, `,
               )})`,
      )) as unknown as Rows;
      const found = new Set(res.rows.map((r) => String(r.meta_retailer_id)));
      const variants = await resolveVariantRetailerIds(tx, orgId, input.retailerIds);
      for (const [rid, v] of variants) {
        if (v.active && (v.stockQty === null || v.stockQty - v.reservedQty > 0)) found.add(rid);
        else found.delete(rid);
      }
      return found;
    });
    return out;
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
    const { byRetailer, byVariant } = await this.db.txAs({ orgId }, async (tx) => {
      const found = (await tx.execute(
        sql`SELECT uuid, meta_retailer_id FROM wa_products
             WHERE org_id = ${orgId} AND meta_retailer_id IN (${sql.join(
               ids.map((r) => sql`${r}`),
               sql`, `,
             )})`,
      )) as unknown as Rows;
      const variants = await resolveVariantRetailerIds(tx, orgId, ids);
      const owners = variants.size
        ? ((await tx.execute(
            sql`SELECT id, uuid FROM wa_products WHERE org_id = ${orgId} AND id IN (${sql.join(
              [...new Set([...variants.values()].map((v) => v.productId))].map((i) => sql`${i}`),
              sql`, `,
            )})`,
          )) as unknown as Rows)
        : { rows: [] };
      const uuidOf = new Map(owners.rows.map((r) => [Number(r.id), String(r.uuid)]));
      return {
        byRetailer: new Map(found.rows.map((r) => [String(r.meta_retailer_id), String(r.uuid)])),
        // A variant's retailer id offers its product (the send picks the variant to show).
        byVariant: new Map(
          [...variants].map(([rid, v]) => [rid, uuidOf.get(v.productId)] as const),
        ),
      };
    });
    // The order the flow offered them in, and only the ones the catalog really has (a product once, however many of its variants).
    const productIds = [
      ...new Set(
        ids
          .map((r) => byRetailer.get(r) ?? byVariant.get(r))
          .filter((u): u is string => Boolean(u)),
      ),
    ];
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
