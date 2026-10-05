import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { CONTACT_RESOLVER, type ContactResolverPort } from '../crm/contact-resolver.port';
import { OutboxService } from '../../kernel/outbox/outbox.service';
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
    const products = await this.products(tx, orgId, cart);
    const phone = from.replace(/\D+/g, '');
    // The sender is a contact of the workspace (the inbox made one already when the message arrived: this finds it); a plan that is out
    // of contacts leaves the link empty and the order is still captured.
    const link = await this.contacts.findOrCreateByPhone(tx, orgId, {
      phone,
      name: customerName,
      source: 'whatsapp_order',
      tag: 'Store customer',
    });
    const contactId = link.outcome === 'skipped' ? null : link.contactId;
    const items = cart.lines.map((l, i) => {
      const p = products.get(l.retailerId);
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
                  ${JSON.stringify({ catalog_id: cart.catalogId, product_text: cart.note })}::jsonb, ${contactId})
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

  /** Products by Meta retailer id or SKU, in one query. */
  private async products(tx: Tx, orgId: number, cart: CartOrder): Promise<Map<string, ProductRow>> {
    const ids = [...new Set(cart.lines.map((l) => l.retailerId))];
    const res = await tx.execute(
      sql`SELECT id, name, image_url, meta_retailer_id, sku FROM wa_products
           WHERE org_id = ${orgId}
             AND (meta_retailer_id IN (${sql.join(
               ids.map((i) => sql`${i}`),
               sql`, `,
             )})
               OR sku IN (${sql.join(
                 ids.map((i) => sql`${i}`),
                 sql`, `,
               )}))`,
    );
    const map = new Map<string, ProductRow>();
    for (const r of res.rows as unknown as ProductRow[]) {
      if (r.meta_retailer_id && ids.includes(r.meta_retailer_id)) map.set(r.meta_retailer_id, r);
      else if (r.sku && ids.includes(r.sku) && !map.has(r.sku)) map.set(r.sku, r);
    }
    return map;
  }
}
