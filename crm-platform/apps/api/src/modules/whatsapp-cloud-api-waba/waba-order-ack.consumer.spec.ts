import { describe, expect, it, vi } from 'vitest';
import { WabaOrderAckConsumer } from './waba-order-ack.consumer';

/**
 * ASYNC-022/025: the outbox reruns EVERY subscriber of an event when any one of them fails, and the retry budget is hours long, so
 * an order acknowledgement that is not claimed would reach the customer again on every rerun. The ack is claimed once per order.
 */
const event = (over: Record<string, unknown> = {}) => ({
  id: '9',
  orgId: 1,
  aggregateModule: 'wa_orders',
  aggregateId: '5',
  eventType: 'whatsapp.order.received',
  payload: { orderId: '6f1c5b8e-0000-4000-8000-000000000001' },
  ...over,
});

function build(opts: { acknowledge?: () => Promise<boolean>; order?: object | null } = {}) {
  const store = new Map<string, string>();
  const redis = {
    set: vi.fn(async (key: string, value: string, ..._args: unknown[]) => {
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  const order =
    opts.order === undefined
      ? {
          id: 5,
          customer_phone: '+911234567890',
          customer_name: 'Asha',
          currency_code: 'INR',
          total_minor: 1000,
          items: 2,
        }
      : opts.order;
  const db = {
    txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: order ? [order] : [] }) }),
  };
  const ack = { acknowledge: vi.fn(opts.acknowledge ?? (async () => true)) };
  const registry = { register: vi.fn() };
  const svc = new WabaOrderAckConsumer(
    registry as never,
    db as never,
    ack as never,
    redis as never,
  );
  return { svc, ack, redis };
}

describe('WabaOrderAckConsumer', () => {
  it('sends the acknowledgement once, however many times the event is redelivered', async () => {
    const { svc, ack } = build();
    await svc.handle(event());
    await svc.handle(event());
    await svc.handle(event({ id: '10' }));
    expect(ack.acknowledge).toHaveBeenCalledTimes(1);
  });

  it('releases the claim when nothing was sent, so a later redelivery can try again', async () => {
    let n = 0;
    const { svc, ack } = build({ acknowledge: async () => (n++ > 0 ? true : false) });
    await svc.handle(event());
    await svc.handle(event());
    expect(ack.acknowledge).toHaveBeenCalledTimes(2);
  });

  it('claims nothing for an order that no longer exists', async () => {
    const { svc, ack, redis } = build({ order: null });
    await svc.handle(event());
    expect(ack.acknowledge).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('keeps the claim per workspace and order', async () => {
    const { svc, ack } = build();
    await svc.handle(event());
    await svc.handle(event({ orgId: 2 }));
    expect(ack.acknowledge).toHaveBeenCalledTimes(2);
  });
});
