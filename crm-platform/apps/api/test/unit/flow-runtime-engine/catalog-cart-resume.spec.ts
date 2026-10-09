import { describe, expect, it, vi } from 'vitest';
import {
  CatalogCartResume,
  CommerceResume,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/commerce-resume';

function build(opts: { channel?: boolean; live?: unknown }) {
  const db = {
    txAs: vi.fn(async (_c: unknown, fn: (tx: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: opts.channel === false ? [] : [{ id: 4 }] }) }),
    ),
  };
  const runs = { liveByPeer: vi.fn().mockResolvedValue(opts.live ?? null) };
  const engine = { deliverExternal: vi.fn().mockResolvedValue('routed') };
  const resume = new CommerceResume(
    {} as never,
    {} as never,
    db as never,
    runs as never,
    engine as never,
    {} as never,
  );
  return { resume, runs, engine };
}

const waiting = { id: 11, status: 'waiting', wait: { handler: 'CommerceShop' } };

describe('a WhatsApp catalog cart resumes the shop node (TW-FLR-041, TW-WABA-042)', () => {
  it("delivers the order to the customer's waiting shop run on the number's channel", async () => {
    const { resume, runs, engine } = build({ live: waiting });
    expect(await resume.catalogCart(7, 3, '+91 98000 00001')).toBe(true);
    expect(runs.liveByPeer).toHaveBeenCalledWith(expect.anything(), 7, 4, '919800000001');
    expect(engine.deliverExternal).toHaveBeenCalledWith(7, 11, 'CommerceShop', {
      order: { id: '', total: '', currency: '', provider: 'whatsapp_shop' },
    });
  });

  it('does nothing without a channel, a live run, or a run waiting on the shop node', async () => {
    for (const opts of [
      { channel: false, live: waiting },
      { live: null },
      { live: { id: 1, status: 'running', wait: null } },
      { live: { id: 1, status: 'waiting', wait: { handler: 'Question' } } },
    ]) {
      const { resume, engine } = build(opts);
      expect(await resume.catalogCart(7, 3, '919800000001')).toBe(false);
      expect(engine.deliverExternal).not.toHaveBeenCalled();
    }
  });

  it('hears the order event and ignores one with no phone or connection', async () => {
    const registry = { register: vi.fn() };
    const resume = { catalogCart: vi.fn().mockResolvedValue(true) };
    const consumer = new CatalogCartResume(registry as never, resume as never);
    consumer.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(consumer);
    const event = (payload: Record<string, unknown>) => ({
      id: '1',
      orgId: 7,
      aggregateModule: 'wa_orders',
      aggregateId: '1',
      eventType: 'whatsapp.order.received',
      payload,
    });
    await consumer.handle(event({ phone: '919800000001', connectionId: 3 }));
    await consumer.handle(event({ phone: '919800000001' }));
    expect(resume.catalogCart).toHaveBeenCalledTimes(1);
    expect(resume.catalogCart).toHaveBeenCalledWith(7, 3, '919800000001');
  });
});
