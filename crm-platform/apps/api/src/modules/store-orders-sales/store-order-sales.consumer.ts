import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { StoreOrderSalesService } from './store-order-sales.service';

/**
 * Every event that says "this store order exists or changed":
 *  - `store.order_placed` (storefront checkout, the AI ordering flow) and `whatsapp.order.received` (a catalog cart): a new order;
 *  - `store.order_paid` (the payment webhook) and `store.order_status_changed` (the Orders screen: paid, shipped, cancelled, ...): a
 *    new state. Its payload is `{ orderId: <uuid>, orderNo, from, to }`; the consumer re-reads the order, so only the id matters.
 */
export const STORE_ORDER_EVENTS = [
  'store.order_placed',
  'whatsapp.order.received',
  'store.order_paid',
  'store.order_status_changed',
] as const;

/**
 * Brings the CRM side of a store order (contact, sales order, timeline, invoice, payment) up to date. Idempotent by construction
 * (`StoreOrderSalesService.syncOrder` reads the order under a lock and every step checks what is already done), so the drain's
 * at-least-once delivery is harmless. A failure throws, and the drain retries it with backoff. Runs in the worker.
 */
@Injectable()
export class StoreOrderSalesConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'store-order-sales';
  readonly eventTypes = STORE_ORDER_EVENTS;
  private readonly logger = new Logger(StoreOrderSalesConsumer.name);

  constructor(
    private readonly sales: StoreOrderSalesService,
    private readonly registry: OutboxSubscriberRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const uuid = typeof event.payload.orderId === 'string' ? event.payload.orderId : null;
    const no = Number(event.payload.orderNo);
    const ref = uuid ? { uuid } : Number.isInteger(no) && no > 0 ? { id: no } : null;
    if (!ref) {
      this.logger.warn(
        { eventType: event.eventType, eventId: event.id },
        'order event without an order id: ignored',
      );
      return;
    }
    const res = await this.sales.syncOrder(event.orgId, ref);
    if (res.order === 'not_found') {
      this.logger.warn(
        { eventType: event.eventType, ref },
        'order event for an order that no longer exists: ignored',
      );
    }
  }
}
