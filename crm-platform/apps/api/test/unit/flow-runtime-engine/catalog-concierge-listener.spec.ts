import { describe, expect, it, vi } from 'vitest';
import {
  InboundMessageHooks,
  type InboundMessageListener,
  type InboundStoredEvent,
} from '../../../src/modules/chat-conversations';
import { CatalogConciergeListener } from '../../../src/modules/flow-runtime-engine/runtime/nodes/commerce/catalog-concierge.listener';

const event = (
  o: { kind?: string; body?: string | null; channelKind?: string } = {},
): InboundStoredEvent =>
  ({
    orgId: 7,
    channelKind: o.channelKind ?? 'whatsapp_cloud',
    peerKey: '919800000001',
    message: {
      kind: o.kind ?? 'text',
      body: o.body === undefined ? 'red shoes under 2000?' : o.body,
      meta: {},
    },
  }) as unknown as InboundStoredEvent;

function build(answers = true) {
  const concierge = { handleInbound: vi.fn().mockResolvedValue(answers) };
  const hooks = new InboundMessageHooks();
  const listener = new CatalogConciergeListener(hooks, concierge as never);
  return { concierge, hooks, listener };
}

describe('the catalog concierge on the inbound message (TW-CAT-028)', () => {
  it('registers itself and answers a product question on a Cloud API number, taking the message', async () => {
    const { concierge, hooks, listener } = build();
    listener.onModuleInit();
    expect(await hooks.run(event())).toEqual({ consumed: true });
    expect(concierge.handleInbound).toHaveBeenCalledWith(
      7,
      '919800000001',
      'red shoes under 2000?',
    );
  });

  it('leaves a message a flow already took, a non-text message and another channel alone', async () => {
    const { concierge, listener } = build();
    expect(await listener.onStored(event(), { consumed: true })).toEqual({ consumed: false });
    expect(await listener.onStored(event({ kind: 'media' }), { consumed: false })).toEqual({
      consumed: false,
    });
    expect(
      await listener.onStored(event({ channelKind: 'whatsapp_qr' }), { consumed: false }),
    ).toEqual({ consumed: false });
    expect(await listener.onStored(event({ body: '  ' }), { consumed: false })).toEqual({
      consumed: false,
    });
    expect(concierge.handleInbound).not.toHaveBeenCalled();
  });

  it('runs after the listeners that go first, whatever the order they registered in, and sees what they took', async () => {
    const { concierge, hooks, listener } = build();
    hooks.register(listener); // the concierge registers first on purpose
    const flows: InboundMessageListener = {
      name: 'flows',
      onStored: async () => ({ consumed: true }),
    };
    hooks.register(flows);
    expect(await hooks.run(event())).toEqual({ consumed: true });
    expect(concierge.handleInbound).not.toHaveBeenCalled();
  });
});
