import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { CatalogOrderAckService } from '../catalog-products';

/** How long a claimed acknowledgement stays claimed: far longer than the outbox keeps retrying an event. */
const CLAIM_TTL_SECONDS = 14 * 24 * 3600;

/**
 * The buyer's acknowledgement of a catalog cart sent on WhatsApp (TW-WABA-042 rule 4, TW-CAT-029): Meta records the order and answers
 * nothing, so once the order is stored the catalog's own `CatalogOrderAckService` sends the order-received message (item count, total,
 * the optional pay link). It runs in a worker on the committed order, so a failure to send never touches the order, and it never
 * throws. The outbox reruns every subscriber of an event when any one of them fails (for hours), so the acknowledgement is claimed once
 * per order with an atomic `SET NX` before it goes out (so a redelivered event is harmless), and the claim is released when nothing was sent so a later rerun can try again.
 * `order_ack_enabled` can still turn the message off.
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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
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
    const claim = `order-ack:${event.orgId}:${orderUuid}`;
    if ((await this.redis.set(claim, event.id, 'EX', CLAIM_TTL_SECONDS, 'NX')) === null) return;
    const sent = await this.ack.acknowledge({
      orgId: event.orgId,
      orderNumber: String(order.id),
      customerPhone: (order.customer_phone as string | null) ?? null,
      customerName: (order.customer_name as string | null) ?? null,
      itemCount: Number(order.items),
      currencyCode: (order.currency_code as string | null) ?? null,
      totalMinor: Number(order.total_minor),
    });
    if (!sent) {
      await this.redis.del(claim);
      this.logger.debug({ orderId: orderUuid }, 'order acknowledgement not sent');
    }
  }
}
