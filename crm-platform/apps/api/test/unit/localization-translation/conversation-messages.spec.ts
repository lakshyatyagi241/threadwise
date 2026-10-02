import { describe, expect, it } from 'vitest';
import type {
  ConversationMessageStore,
  StoredMessage,
} from '../../../src/modules/localization-translation/conversation-message-store';
import {
  ConversationTranslationService,
  visibleTranslation,
  type InboundOutcome,
  type OutboundOutcome,
} from '../../../src/modules/localization-translation/conversation-translation.service';
import type { DetectedTranslation } from '../../../src/infra/providers/localization-translation/translation-driver.port';

const message = (over: Partial<StoredMessage> = {}): StoredMessage => ({
  id: 1,
  direction: 'in',
  body: 'Dónde está mi pedido',
  isTranslated: false,
  conversationId: 9,
  customerLanguage: null,
  isTemplate: false,
  isForwarded: false,
  ...over,
});

function build(
  m: StoredMessage | null,
  opts: { enabled?: boolean; result?: DetectedTranslation } = {},
) {
  const saved: { inbound: InboundOutcome[]; outbound: OutboundOutcome[] } = {
    inbound: [],
    outbound: [],
  };
  const store: ConversationMessageStore = {
    load: async () => m,
    saveInbound: async (_o, _m, outcome) => void saved.inbound.push(outcome),
    saveOutbound: async (_o, _m, outcome) => void saved.outbound.push(outcome),
  };
  let configReads = 0;
  const db = {
    txAs: async () => {
      configReads += 1;
      return { rows: [{ default_language: 'en', inbox_translate: opts.enabled ?? true }] };
    },
  };
  const plans = {
    forOrg: async () => ({
      platformOwned: false,
      overrides: {},
      planKnown: true,
      planFeatures: { translation: true },
    }),
  };
  const translation = {
    detectAndTranslate: async () => opts.result ?? { language: null, text: null },
  };
  const svc = new ConversationTranslationService(
    db as never,
    plans as never,
    translation as never,
    store,
  );
  return { svc, saved, reads: () => configReads };
}

/** WD-I18N-036, stored message */
describe('translateInboundMessage', () => {
  it('stores the reading and pins the conversation language', async () => {
    const { svc, saved } = build(message(), {
      result: { language: 'es', text: 'Where is my order?' },
    });
    const out = await svc.translateInboundMessage(5, 1);
    expect(out).toMatchObject({
      detectedLanguage: 'es',
      translatedBody: 'Where is my order?',
      pinLanguage: 'es',
    });
    expect(saved.inbound).toHaveLength(1);
  });

  it('leaves outbound, missing and already translated messages alone', async () => {
    expect(await build(message({ direction: 'out' })).svc.translateInboundMessage(5, 1)).toBeNull();
    expect(await build(null).svc.translateInboundMessage(5, 1)).toBeNull();
    const done = build(message({ isTranslated: true }), { result: { language: 'es', text: 'x' } });
    expect(await done.svc.translateInboundMessage(5, 1)).toBeNull();
    expect(done.saved.inbound).toHaveLength(0);
  });

  it('keeps the pinned language of a conversation that already has one', async () => {
    const { svc } = build(message({ customerLanguage: 'es' }), {
      result: { language: 'fr', text: 'Where?' },
    });
    expect((await svc.translateInboundMessage(5, 1))?.pinLanguage).toBeNull();
  });

  it('stores nothing and does not throw when the store fails', async () => {
    const { svc } = build(message(), { result: { language: 'es', text: 'x' } });
    (svc as unknown as { messages: ConversationMessageStore }).messages = {
      load: async () => message(),
      saveInbound: async () => Promise.reject(new Error('db down')),
      saveOutbound: async () => undefined,
    };
    expect(await svc.translateInboundMessage(5, 1)).toBeNull();
  });
});

/** WD-I18N-037, stored message */
describe('translateOutboundMessage', () => {
  const out = (over: Partial<StoredMessage> = {}) =>
    message({
      direction: 'out',
      body: 'Your order ships tomorrow',
      customerLanguage: 'es',
      ...over,
    });

  it('delivers the customer-language text and stores the agent original', async () => {
    const { svc, saved } = build(out(), {
      result: { language: 'en', text: 'Su pedido se envía mañana' },
    });
    const r = await svc.translateOutboundMessage(5, 1);
    expect(r).toMatchObject({
      body: 'Su pedido se envía mañana',
      original: 'Your order ships tomorrow',
      isTranslated: true,
    });
    expect(saved.outbound).toHaveLength(1);
  });

  it('never translates a template or a forward, and stores nothing', async () => {
    for (const over of [{ isTemplate: true }, { isForwarded: true }]) {
      const { svc, saved } = build(out(over), { result: { language: 'en', text: 'x' } });
      expect((await svc.translateOutboundMessage(5, 1))?.isTranslated).toBe(false);
      expect(saved.outbound).toHaveLength(0);
    }
  });

  it('sends the text as typed when the agent already wrote in the customer language', async () => {
    const { svc, saved } = build(out({ body: 'Su pedido llega mañana' }), {
      result: { language: 'es', text: 'Your order arrives tomorrow' },
    });
    const r = await svc.translateOutboundMessage(5, 1);
    expect(r).toMatchObject({ body: 'Su pedido llega mañana', isTranslated: false });
    expect(saved.outbound).toHaveLength(0);
  });

  it('ignores an inbound message', async () => {
    expect(await build(message()).svc.translateOutboundMessage(5, 1)).toBeNull();
  });
});

/** WD-I18N-038 */
describe('thread display gating', () => {
  const translated = {
    translatedBody: 'Where is my order?',
    detectedLanguage: 'es',
    isTranslated: true,
  };

  it('shows the stored translation while translation is live', () => {
    expect(visibleTranslation(true, translated)).toEqual(translated);
  });

  it('hides it, keeps the detected language, and deletes nothing when it is not live', () => {
    expect(visibleTranslation(false, translated)).toEqual({
      translatedBody: null,
      detectedLanguage: 'es',
      isTranslated: false,
    });
    expect(translated.translatedBody).toBe('Where is my order?');
  });

  it('reads the gate once for the whole thread, and hides every message when the switch is off', async () => {
    const on = build(null, { enabled: true });
    expect(
      (await on.svc.threadView(5, [translated, translated])).every((m) => m.isTranslated),
    ).toBe(true);
    expect(on.reads()).toBe(1);

    const off = build(null, { enabled: false });
    const view = await off.svc.threadView(5, [
      translated,
      { ...translated, detectedLanguage: 'fr' },
    ]);
    expect(view.map((m) => m.isTranslated)).toEqual([false, false]);
    expect(view.map((m) => m.detectedLanguage)).toEqual(['es', 'fr']);
    expect(off.reads()).toBe(1);
  });
});
