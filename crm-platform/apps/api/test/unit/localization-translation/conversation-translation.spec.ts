import { describe, expect, it } from 'vitest';
import { ConversationTranslationService } from '../../../src/modules/localization-translation/conversation-translation.service';
import { translationAllowed } from '../../../src/modules/localization-translation/translation-settings.service';
import type { DetectedTranslation } from '../../../src/infra/providers/localization-translation/translation-driver.port';

interface Setup {
  plan?: boolean;
  enabled?: boolean;
  teamLanguage?: string | null;
  result?: DetectedTranslation | 'throw';
}

function build(s: Setup = {}) {
  const calls: Array<{ text: string; target: string; orgId: number | null }> = [];
  const db = {
    txAs: async () => ({
      rows: [{ default_language: s.teamLanguage === undefined ? 'en' : s.teamLanguage, inbox_translate: s.enabled ?? true }],
    }),
  };
  const plans = {
    forOrg: async () => ({
      platformOwned: false,
      overrides: {},
      planKnown: true,
      planFeatures: { translation: s.plan ?? true },
    }),
  };
  const translation = {
    detectAndTranslate: async (text: string, target: string, ctx: { orgId: number | null }) => {
      calls.push({ text, target, orgId: ctx.orgId });
      if (s.result === 'throw') throw new Error('boom');
      return s.result ?? { language: null, text: null };
    },
  };
  const svc = new ConversationTranslationService(db as never, plans as never, translation as never);
  return { svc, calls };
}

/** WD-I18N-036 */
describe('translateInbound', () => {
  it('stores the team-language reading, the detected language and pins the conversation', async () => {
    const { svc, calls } = build({ result: { language: 'es', text: 'Where is my order?' } });
    expect(await svc.translateInbound({ orgId: 5, body: 'Dónde está mi pedido', pinnedLanguage: null })).toEqual({
      detectedLanguage: 'es',
      translatedBody: 'Where is my order?',
      isTranslated: true,
      pinLanguage: 'es',
    });
    expect(calls[0]).toEqual({ text: 'Dónde está mi pedido', target: 'en', orgId: 5 }); // workspace passed explicitly
  });

  it('stores only the detected language when the customer already writes the team language', async () => {
    const { svc } = build({ result: { language: 'en', text: 'Where is my order?' } });
    expect(await svc.translateInbound({ orgId: 5, body: 'Where is my order?', pinnedLanguage: null })).toEqual({
      detectedLanguage: 'en',
      translatedBody: null,
      isTranslated: false,
      pinLanguage: 'en',
    });
  });

  it('never moves a language that is already pinned', async () => {
    const { svc } = build({ result: { language: 'fr', text: 'Where is my order?' } });
    const out = await svc.translateInbound({ orgId: 5, body: 'Où est ma commande', pinnedLanguage: 'es' });
    expect(out).toMatchObject({ detectedLanguage: 'fr', isTranslated: true, pinLanguage: null });
  });

  it('does nothing when the plan lacks translation or the workspace switched it off', async () => {
    for (const s of [{ plan: false }, { enabled: false }]) {
      const { svc, calls } = build({ ...s, result: { language: 'es', text: 'x' } });
      expect(await svc.translateInbound({ orgId: 5, body: 'Hola amigo', pinnedLanguage: null })).toBeNull();
      expect(calls).toHaveLength(0);
    }
  });

  it('skips empty bodies and already translated messages', async () => {
    const { svc, calls } = build({ result: { language: 'es', text: 'x' } });
    expect(await svc.translateInbound({ orgId: 5, body: '   ', pinnedLanguage: null })).toBeNull();
    expect(await svc.translateInbound({ orgId: 5, body: 'Hola', pinnedLanguage: null, alreadyTranslated: true })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('stores nothing and does not throw when every provider fails', async () => {
    const { svc } = build({ result: { language: null, text: null } });
    expect(await svc.translateInbound({ orgId: 5, body: 'Hola amigo', pinnedLanguage: null })).toEqual({
      detectedLanguage: null,
      translatedBody: null,
      isTranslated: false,
      pinLanguage: null,
    });
    const boom = build({ result: 'throw' });
    expect(await boom.svc.translateInbound({ orgId: 5, body: 'Hola amigo', pinnedLanguage: null })).toBeNull();
  });

  it('uses the workspace team language as the target', async () => {
    const { svc, calls } = build({ teamLanguage: 'ES', result: { language: 'en', text: 'Hola' } });
    await svc.translateInbound({ orgId: 5, body: 'Hello', pinnedLanguage: null });
    expect(calls[0]!.target).toBe('es');
  });
});

/** WD-I18N-037 */
describe('translateOutbound', () => {
  const typed = 'Your order ships tomorrow';

  it('delivers the customer-language text and keeps the agent original', async () => {
    const { svc } = build({ result: { language: 'en', text: 'Su pedido se envía mañana' } });
    expect(await svc.translateOutbound({ orgId: 5, body: typed, customerLanguage: 'es' })).toEqual({
      body: 'Su pedido se envía mañana',
      original: typed,
      language: 'es',
      isTranslated: true,
    });
  });

  it('sends as typed when the text is already in the customer language', async () => {
    const { svc } = build({ result: { language: 'es', text: 'same' } });
    expect(await svc.translateOutbound({ orgId: 5, body: 'Su pedido', customerLanguage: 'es' })).toEqual({
      body: 'Su pedido',
      original: null,
      language: null,
      isTranslated: false,
    });
  });

  it('never translates templates, forwards, translated messages, or without a pinned language', async () => {
    const { svc, calls } = build({ result: { language: 'en', text: 'x' } });
    for (const extra of [{ isTemplate: true }, { isForwarded: true }, { alreadyTranslated: true }]) {
      const out = await svc.translateOutbound({ orgId: 5, body: typed, customerLanguage: 'es', ...extra });
      expect(out.isTranslated).toBe(false);
      expect(out.body).toBe(typed);
    }
    expect((await svc.translateOutbound({ orgId: 5, body: typed, customerLanguage: null })).body).toBe(typed);
    expect(calls).toHaveLength(0);
  });

  it('sends as typed when translation is off, or the customer speaks the team language', async () => {
    const off = build({ enabled: false, result: { language: 'en', text: 'x' } });
    expect((await off.svc.translateOutbound({ orgId: 5, body: typed, customerLanguage: 'es' })).isTranslated).toBe(false);
    const same = build({ result: { language: 'en', text: 'x' } });
    expect((await same.svc.translateOutbound({ orgId: 5, body: typed, customerLanguage: 'en' })).isTranslated).toBe(false);
    expect(same.calls).toHaveLength(0);
  });

  it('sends the original when providers fail or throw', async () => {
    for (const result of [{ language: null, text: null }, 'throw'] as const) {
      const { svc } = build({ result });
      expect(await svc.translateOutbound({ orgId: 5, body: typed, customerLanguage: 'es' })).toEqual({
        body: typed,
        original: null,
        language: null,
        isTranslated: false,
      });
    }
  });
});

/** WD-I18N-039 */
describe('languageHint', () => {
  it('names the customer language for the AI prompt', async () => {
    const { svc } = build();
    expect(await svc.languageHint(5, 'hi')).toContain('Hindi');
  });

  it('gives nothing when disabled, unpinned, or the same as the team language', async () => {
    expect(await build({ enabled: false }).svc.languageHint(5, 'hi')).toBeNull();
    expect(await build().svc.languageHint(5, null)).toBeNull();
    expect(await build().svc.languageHint(5, 'en')).toBeNull();
  });
});

describe('translationAllowed (plan gate shim)', () => {
  const base = { platformOwned: false, overrides: {}, planKnown: true, planFeatures: {} } as never;
  const e = (over: Record<string, unknown>) => ({ ...(base as object), ...over }) as never;

  it('follows the plan flag and defaults to off', () => {
    expect(translationAllowed(e({ planFeatures: { translation: true } }))).toBe(true);
    expect(translationAllowed(e({ planFeatures: { translation: false } }))).toBe(false);
    expect(translationAllowed(e({ planFeatures: {} }))).toBe(false);
  });

  it('lets an organization override beat the plan, and a platform-owned one through', () => {
    expect(translationAllowed(e({ overrides: { features: { translation: true } } }))).toBe(true);
    expect(translationAllowed(e({ planFeatures: { translation: true }, overrides: { features: { translation: false } } }))).toBe(false);
    expect(translationAllowed(e({ platformOwned: true }))).toBe(true);
  });

  it('locks nothing for an unknown plan, and nothing for a missing organization', () => {
    expect(translationAllowed(e({ planKnown: false }))).toBe(true);
    expect(translationAllowed(null)).toBe(false);
  });
});
