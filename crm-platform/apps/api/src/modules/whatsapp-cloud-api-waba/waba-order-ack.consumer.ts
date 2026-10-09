import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { CatalogOrderAckService } from '../catalog-products';

/**
 * The buyer's acknowledgement of a catalog cart sent on WhatsApp (WD-WABA-042 rule 4, WD-CAT-029): Meta records the order and answers
 * nothing, so once the order is stored the catalog's own `CatalogOrderAckService` sends the order-received message (item count, total,
 * the optional pay link). It runs in a worker on the committed order, so a failure to send never touches the order, and it never
 * throws: a repeat of the event can at worst send the acknowledgement twice, which the catalog setting `order_ack_enabled` can turn off.
 */
@Injectable()
export class WabaOrderAckConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'waba-order-ack';
  readonly eventTypes = ['whatsapp.order.received'] as const;
  private readonly logger = new Logger(WabaOrderAckConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly ack: CatalogOrderAckService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const orderUuid = typeof event.payload.orderId === 'string' ? event.payload.orderId : null;
    if (!orderUuid) return;
    const order = await this.db.txAs({ orgId: event.orgId }, async (tx) => {
      const res = (await tx.execute(
        sql`SELECT o.id, o.customer_phone, o.customer_name, o.currency_code, o.total_minor,
                   COALESCE((SELECT sum(i.quantity) FROM wa_order_items i WHERE i.org_id = o.org_id AND i.order_id = o.id), 0)::int AS items
              FROM wa_orders o WHERE o.org_id = ${event.orgId} AND o.uuid = ${orderUuid}::uuid`,
      )) as unknown as { rows: Array<Record<string, unknown>> };
      return res.rows[0] ?? null;
    });
    if (!order) return;
    const sent = await this.ack.acknowledge({
      orgId: event.orgId,
      orderNumber: String(order.id),
      customerPhone: (order.customer_phone as string | null) ?? null,
      customerName: (order.customer_name as string | null) ?? null,
      itemCount: Number(order.items),
      currencyCode: (order.currency_code as string | null) ?? null,
      totalMinor: Number(order.total_minor),
    });
    if (!sent) this.logger.debug({ orderId: orderUuid }, 'order acknowledgement not sent');
  }
}
