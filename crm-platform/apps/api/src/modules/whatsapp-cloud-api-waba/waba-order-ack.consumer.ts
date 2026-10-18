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
 * The buyer's acknowledgement of a catalog cart sent on WhatsApp (TW-WABA-042 rule 4, TW-CAT-029): Meta records the order and answers
 * nothing, so once the order is stored the catalog's own `CatalogOrderAckService` sends the order-received message (item count, total,
 * the optional pay link). It runs in a worker on the committed order, so a failure to send never touches the order, and it never
 * throws. The outbox reruns every subscriber of an event when any one of them fails (for hours), so the acknowledgement is claimed once
 * per order, durably, on the order row (`ack_claimed_at`, then `ack_sent_at`): a redelivered event is harmless, a restart or a Redis
 * flush cannot allow a repeat, a claim whose worker died mid-send goes stale after 10 minutes and can be taken again, and the claim
 * is released when nothing was sent so a later rerun can try again. `order_ack_enabled` can still turn the message off.
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

    // One statement claims the order and reads what the message needs; it returns nothing when the order is gone, was already
    // acknowledged, or another worker holds a fresh claim.
    const order = await this.db.txAs({ orgId: event.orgId }, async (tx) => {
      const res = (await tx.execute(
        sql`UPDATE wa_orders o SET ack_claimed_at = now()
             WHERE o.org_id = ${event.orgId} AND o.uuid = ${orderUuid}::uuid
               AND o.ack_sent_at IS NULL
               AND (o.ack_claimed_at IS NULL OR o.ack_claimed_at < now() - interval '10 minutes')
         RETURNING o.id, o.customer_phone, o.customer_name, o.currency_code, o.total_minor,
                   COALESCE((SELECT sum(i.quantity) FROM wa_order_items i WHERE i.org_id = o.org_id AND i.order_id = o.id), 0)::int AS items`,
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

    await this.db.txAs({ orgId: event.orgId }, (tx) =>
      sent
        ? tx.execute(
            sql`UPDATE wa_orders SET ack_sent_at = now() WHERE org_id = ${event.orgId} AND uuid = ${orderUuid}::uuid`,
          )
        : tx.execute(
            sql`UPDATE wa_orders SET ack_claimed_at = NULL
                 WHERE org_id = ${event.orgId} AND uuid = ${orderUuid}::uuid AND ack_sent_at IS NULL`,
          ),
    );
    if (!sent) this.logger.debug({ orderId: orderUuid }, 'order acknowledgement not sent');
  }
}
