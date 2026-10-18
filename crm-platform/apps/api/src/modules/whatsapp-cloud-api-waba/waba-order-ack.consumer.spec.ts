import { describe, expect, it, vi } from 'vitest';
import { WabaOrderAckConsumer } from './waba-order-ack.consumer';

/**
 * ASYNC-022/025: the outbox reruns EVERY subscriber of an event when any one of them fails, and the retry budget is hours long, so an
 * order acknowledgement that is not claimed would reach the customer again on every rerun. The claim is a durable column on the order
 * (it survives a restart and a Redis flush); the SQL itself is proven against a real Postgres in
 * test/integration/waba-order-ack-claim.spec.ts. This spec covers the consumer's sequence: claim, send, then mark sent or release.
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

const row = {
  id: 5,
  customer_phone: '+911234567890',
  customer_name: 'Asha',
  currency_code: 'INR',
  total_minor: 1000,
  items: 2,
};

/** `claims` is what each claim attempt returns: a row when the claim was won, nothing when it was not. */
function build(opts: { claims: Array<object | null>; acknowledge?: () => Promise<boolean> }) {
  const claims = [...opts.claims];
  const statements: string[] = [];
  const db = {
    txAs: async (_c: unknown, fn: (tx: unknown) => unknown) =>
      fn({
        execute: async (q: { queryChunks?: unknown[] }) => {
          const text = JSON.stringify(q.queryChunks ?? q);
          statements.push(
            text.includes('ack_sent_at = now()')
              ? 'mark-sent'
              : text.includes('ack_claimed_at = NULL')
                ? 'release'
                : 'claim',
          );
          if (statements[statements.length - 1] !== 'claim') return { rows: [] };
          const next = claims.shift();
          return { rows: next ? [next] : [] };
        },
      }),
  };
  const ack = { acknowledge: vi.fn(opts.acknowledge ?? (async () => true)) };
  const svc = new WabaOrderAckConsumer({ register: vi.fn() } as never, db as never, ack as never);
  return { svc, ack, statements };
}

describe('WabaOrderAckConsumer', () => {
  it('claims, sends, then marks the order as sent', async () => {
    const { svc, ack, statements } = build({ claims: [row] });
    await svc.handle(event());
    expect(ack.acknowledge).toHaveBeenCalledTimes(1);
    expect(statements).toEqual(['claim', 'mark-sent']);
  });

  it('sends nothing when the claim is not won (already sent, or another worker holds it)', async () => {
    const { svc, ack, statements } = build({ claims: [null] });
    await svc.handle(event());
    expect(ack.acknowledge).not.toHaveBeenCalled();
    expect(statements).toEqual(['claim']);
  });

  it('releases the claim when nothing was sent, so a later redelivery can try again', async () => {
    const { svc, statements } = build({ claims: [row], acknowledge: async () => false });
    await svc.handle(event());
    expect(statements).toEqual(['claim', 'release']);
  });

  it('does nothing for an event without an order id', async () => {
    const { svc, ack, statements } = build({ claims: [row] });
    await svc.handle(event({ payload: {} }));
    expect(ack.acknowledge).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
  });
});
