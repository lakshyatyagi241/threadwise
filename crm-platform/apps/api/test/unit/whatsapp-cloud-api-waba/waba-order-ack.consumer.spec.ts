import { describe, expect, it, vi } from 'vitest';
import { WabaOrderAckConsumer } from '../../../src/modules/whatsapp-cloud-api-waba/waba-order-ack.consumer';

const event = (payload: Record<string, unknown>) => ({
  id: 'e1',
  orgId: 7,
  aggregateModule: 'wa_orders',
  aggregateId: '1',
  eventType: 'whatsapp.order.received',
  payload,
});

function build(row: Record<string, unknown> | null) {
  const ack = { acknowledge: vi.fn().mockResolvedValue(true) };
  const registry = { register: vi.fn() };
  const db = {
    txAs: vi.fn(async (_c: unknown, fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: row ? [row] : [] }) }),
    ),
  };
  const consumer = new WabaOrderAckConsumer(registry as never, db as never, ack as never);
  return { consumer, ack, registry };
}

describe('the catalog order acknowledgement (TW-WABA-042, TW-CAT-029)', () => {
  it('registers for the order event and acknowledges the order with its count and total', async () => {
    const { consumer, ack, registry } = build({
      id: 12,
      customer_phone: '919800000001',
      customer_name: 'Asha',
      currency_code: 'INR',
      total_minor: '2698',
      items: 3,
    });
    consumer.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(consumer);
    await consumer.handle(event({ orderId: 'b0c1e2d3-0000-4000-8000-000000000001' }));
    expect(ack.acknowledge).toHaveBeenCalledWith({
      orgId: 7,
      orderNumber: '12',
      customerPhone: '919800000001',
      customerName: 'Asha',
      itemCount: 3,
      currencyCode: 'INR',
      totalMinor: 2698,
    });
  });

  it('does nothing for an event with no order id or an order that is gone', async () => {
    const a = build(null);
    await a.consumer.handle(event({}));
    await a.consumer.handle(event({ orderId: 'b0c1e2d3-0000-4000-8000-000000000002' }));
    expect(a.ack.acknowledge).not.toHaveBeenCalled();
  });
});
