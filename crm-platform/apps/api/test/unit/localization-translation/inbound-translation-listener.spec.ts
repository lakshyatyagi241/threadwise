import { describe, expect, it, vi } from 'vitest';
import { InboundTranslationListener } from '../../../src/modules/chat-conversations/inbound-translation.listener';
import type { InboundStoredEvent } from '../../../src/modules/chat-conversations/inbound-hooks';

const event = (kind: string, body: string | null): InboundStoredEvent =>
  ({
    orgId: 5,
    conversationUuid: 'c-1',
    messageUuid: 'm-1',
    message: { kind, body },
  }) as unknown as InboundStoredEvent;

function build(outcome: unknown) {
  const translation = { translateInboundByUuid: vi.fn(async () => outcome) };
  const realtime = { threadChanged: vi.fn(async () => undefined) };
  const hooks = { register: vi.fn() };
  const l = new InboundTranslationListener(hooks as never, translation as never, realtime as never);
  return { l, translation, realtime, hooks };
}

/** WD-I18N-036 wiring: the inbox ingest hook calls the I18N service. */
describe('InboundTranslationListener', () => {
  it('registers itself on the inbound hooks', () => {
    const { l, hooks } = build(null);
    l.onModuleInit();
    expect(hooks.register).toHaveBeenCalledWith(l);
  });

  it('translates a stored text message and tells the open thread', async () => {
    const { l, translation, realtime } = build({ isTranslated: true });
    await l.onStored(event('text', 'Hola'));
    expect(translation.translateInboundByUuid).toHaveBeenCalledWith(5, 'm-1');
    expect(realtime.threadChanged).toHaveBeenCalledWith(5, 'c-1', 'translation');
  });

  it('leaves non-text and empty messages alone, and stays quiet when nothing was stored', async () => {
    const a = build({ isTranslated: true });
    await a.l.onStored(event('media', 'caption'));
    await a.l.onStored(event('text', '  '));
    expect(a.translation.translateInboundByUuid).not.toHaveBeenCalled();
    const b = build(null);
    await b.l.onStored(event('text', 'Hi'));
    expect(b.realtime.threadChanged).not.toHaveBeenCalled();
  });
});
