import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { CONTACT_RESOLVER, type ContactResolverPort } from '../crm/contact-resolver.port';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { resolveVariantRetailerIds, type ResolvedVariantRef } from '../catalog-products';
import { cartOf, type CartOrder } from './waba-order-rules';

interface ProductRow {
  id: number | string;
  name: string;
  image_url: string | null;
  meta_retailer_id: string | null;
  sku: string | null;
}

/**
 * A catalog cart becomes an order (TW-WABA-042): one `wa_orders` row with its lines, written in one transaction, and
 * `whatsapp.order.received` through the outbox so the owners of what follows (resuming a paused commerce flow through
 * `purchased`, the buyer's acknowledgement or payment link) act on a committed order. The checkout domain owns those tables; this
 * writes them directly until it exports an orders service.
 *
 * Reference deduplicated an order only by a message bubble that never existed, so Meta's retries could double an order. Here a
 * message id is one order.
 */
@Injectable()
export class WabaOrdersService {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(CONTACT_RESOLVER) private readonly contacts: ContactResolverPort,
  ) {}

  /** The new order's id, or null when the message holds no usable line or was already captured. */
  async capture(
    tx: Tx,
    orgId: number,
    configId: number,
    raw: Record<string, unknown>,
    from: string,
    customerName: string | null,
  ): Promise<number | null> {
    const cart = cartOf(raw);
    const wamid = String(raw.id ?? '');
    if (!cart) return null;
    if (wamid) {
      const seen = await tx.execute(
        sql`SELECT 1 FROM wa_orders WHERE org_id = ${orgId} AND wa_message_id = ${wamid} LIMIT 1`,
      );
      if (seen.rows.length > 0) return null;
    }
    const variants = await resolveVariantRetailerIds(
      tx,
      orgId,
      cart.lines.map((l) => l.retailerId),
    );
    const products = await this.products(tx, orgId, cart, variants);
    const phone = from.replace(/\D+/g, '');
    // The sender is a contact of the workspace (the inbox made one already when the message arrived: this finds it); a plan that is out
    // of contacts leaves the link empty and the order is still captured.
    const link = await this.contacts.findOrCreateByPhone(tx, orgId, {
      phone,
      name: customerName,
      source: 'whatsapp_order',
      tag: 'Store customer',
      saveProfile: true,
    });
    const contactId = link.outcome === 'skipped' ? null : link.contactId;
    const stockWarnings: Array<{
      retailer_id: string;
      requested: number;
      available: number | null;
      active: boolean;
    }> = [];
    const items = cart.lines.map((l, i) => {
      // A cart line naming a variant's retailer id is that variant of its product: the product's name, the variant's own image,
      // price when Meta sent none, and the variant's title and id on the line (invariant 3).
      const v = variants.get(l.retailerId);
      if (v) {
        const p = products.byId.get(v.productId);
        const left = v.stockQty === null ? null : Math.max(0, v.stockQty - v.reservedQty);
        if (!v.active || (left !== null && l.quantity > left))
          stockWarnings.push({
            retailer_id: l.retailerId,
            requested: l.quantity,
            available: left,
            active: v.active,
          });
        return {
          retailer_id: l.retailerId,
          product_id: v.productId,
          variant_id: v.variantUuid,
          variant_title: v.title,
          name: p?.name ?? l.retailerId,
          image_url: v.imageUrl ?? p?.image_url ?? null,
          quantity: l.quantity,
          price_minor: l.priceMinor > 0 ? l.priceMinor : (v.priceMinor ?? v.productPriceMinor),
          currency: l.currency ?? cart.currency,
        };
      }
      const p = products.byRetailer.get(l.retailerId);
      return {
        retailer_id: p ? l.retailerId : `wsn-unknown-${i + 1}`,
        product_id: p ? Number(p.id) : null,
        name: p?.name ?? l.retailerId,
        image_url: p?.image_url ?? null,
        quantity: l.quantity,
        price_minor: l.priceMinor,
        currency: l.currency ?? cart.currency,
      };
    });
    const order = await tx.execute(
      sql`INSERT INTO wa_orders (org_id, source, customer_phone, customer_name, items_json, total_minor, currency_code,
                                 status, wa_message_id, notes, meta_json, contact_id)
          VALUES (${orgId}, 'waba', ${phone}, ${customerName}, ${JSON.stringify(items)}::jsonb, ${cart.totalMinor},
                  ${cart.currency}, 'new', ${wamid || null}, ${cart.note},
                  ${JSON.stringify({
                    catalog_id: cart.catalogId,
                    product_text: cart.note,
                    ...(stockWarnings.length > 0 ? { stock_warnings: stockWarnings } : {}),
                  })}::jsonb, ${contactId})
          RETURNING id, uuid`,
    );
    const { id, uuid } = order.rows[0] as { id: number | string; uuid: string };
    for (const it of items) {
      await tx.execute(
        sql`INSERT INTO wa_order_items (org_id, order_id, product_id, retailer_id, name, image_url, quantity, price_minor,
                                        currency_code)
            VALUES (${orgId}, ${Number(id)}, ${it.product_id}, ${it.retailer_id}, ${it.name}, ${it.image_url},
                    ${it.quantity}, ${it.price_minor}, ${it.currency})`,
      );
    }
    await this.outbox.emit(tx, {
      aggregateModule: 'wa_orders',
      aggregateId: Number(id),
      eventType: 'whatsapp.order.received',
      payload: {
        orderId: uuid,
        orderNo: Number(id),
        phone,
        connectionId: configId,
        totalMinor: cart.totalMinor,
        currency: cart.currency,
      },
    });
    return Number(id);
  }

  /** Products by Meta retailer id or SKU (and the products that own the variants the cart named), in one query. */
  private async products(
    tx: Tx,
    orgId: number,
    cart: CartOrder,
    variants: ReadonlyMap<string, ResolvedVariantRef>,
  ): Promise<{ byRetailer: Map<string, ProductRow>; byId: Map<number, ProductRow> }> {
    const ids = [...new Set(cart.lines.map((l) => l.retailerId))].filter((i) => !variants.has(i));
    const productIds = [...new Set([...variants.values()].map((v) => v.productId))];
    const byRetailer = new Map<string, ProductRow>();
    const byId = new Map<number, ProductRow>();
    if (ids.length === 0 && productIds.length === 0) return { byRetailer, byId };
    const idList =
      ids.length > 0
        ? sql.join(
            ids.map((i) => sql`${i}`),
            sql`, `,
          )
        : sql`NULL`;
    const pidList =
      productIds.length > 0
        ? sql.join(
            productIds.map((i) => sql`${i}`),
            sql`, `,
          )
        : sql`NULL`;
    const res = await tx.execute(
      sql`SELECT id, name, image_url, meta_retailer_id, sku FROM wa_products
           WHERE org_id = ${orgId}
             AND (meta_retailer_id IN (${idList}) OR sku IN (${idList}) OR id IN (${pidList}))`,
    );
    for (const r of res.rows as unknown as ProductRow[]) {
      byId.set(Number(r.id), r);
      if (r.meta_retailer_id && ids.includes(r.meta_retailer_id))
        byRetailer.set(r.meta_retailer_id, r);
      else if (r.sku && ids.includes(r.sku) && !byRetailer.has(r.sku)) byRetailer.set(r.sku, r);
    }
    return { byRetailer, byId };
  }
}
