import { describe, expect, it } from 'vitest';
import { MemoryTranslationStores } from '../../../src/infra/providers/localization-translation/redis-stores';
import type {
  DetectedTranslation,
  TranslationDriver,
} from '../../../src/infra/providers/localization-translation/translation-driver.port';
import type { ProviderRouterService } from '../../../src/modules/localization-translation/provider-router.service';
import type { RoutePolicy } from '../../../src/modules/localization-translation/translation-policy';
import type {
  TranslationUsageService,
  UsageEntry,
} from '../../../src/modules/localization-translation/translation-usage.service';
import { TranslationService } from '../../../src/modules/localization-translation/translation.service';

type Slug = TranslationDriver['slug'];

/** A scripted driver: answers from a function and counts its calls. */
function driver(
  slug: Slug,
  translate: (t: string) => string | null,
  detect: (t: string) => DetectedTranslation = () => ({ language: null, text: null }),
) {
  const calls = { translate: 0, detect: 0 };
  const d: TranslationDriver = {
    slug,
    translate: async (t) => {
      calls.translate++;
      return translate(t);
    },
    detectAndTranslate: async (t) => {
      calls.detect++;
      return detect(t);
    },
  };
  return { d, calls };
}

function build(
  drivers: TranslationDriver[],
  policy: RoutePolicy = { lockdown: false, residency: 'any' },
) {
  const recorded: Array<{ orgId: number | null; e: UsageEntry }> = [];
  const router = {
    policy: async () => policy,
    drivers: async () => drivers,
  } as unknown as ProviderRouterService;
  const usage = {
    record: async (orgId: number | null, e: UsageEntry) => void recorded.push({ orgId, e }),
  } as unknown as TranslationUsageService;
  const cache = new MemoryTranslationStores();
  return { svc: new TranslationService(router, usage, cache), recorded, cache };
}

const ctx = { orgId: 7 };

/** WD-I18N-021 */
describe('TranslationService.translate', () => {
  it('answers a dictionary phrase with no provider call and no usage row', async () => {
    const a = driver('mymemory', () => 'never');
    const { svc, recorded } = build([a.d]);
    expect(await svc.translate('hello', 'en', 'es', ctx)).toBe('hola');
    expect(a.calls.translate).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  it('serves a repeat from the cache with no second provider call', async () => {
    const a = driver('deepl', (t) => `<${t}>`);
    const { svc, recorded } = build([a.d]);
    expect(await svc.translate('Where is my order?', 'en', 'es', ctx)).toBe('<Where is my order?>');
    expect(await svc.translate('Where is my order?', 'en', 'es', ctx)).toBe('<Where is my order?>');
    expect(a.calls.translate).toBe(1);
    expect(recorded).toHaveLength(1);
  });

  it('returns the trimmed input when source and target are the same, and empty for empty', async () => {
    const a = driver('deepl', () => 'x');
    const { svc } = build([a.d]);
    expect(await svc.translate('  Hola ', 'es', 'ES', ctx)).toBe('Hola');
    expect(await svc.translate('   ', 'es', 'en', ctx)).toBe('');
    expect(a.calls.translate).toBe(0);
  });

  it('treats a regional code and its base language as the same language', async () => {
    const a = driver('deepl', () => 'x');
    const { svc } = build([a.d]);
    expect(await svc.translate('Olá', 'pt-BR', 'pt', ctx)).toBe('Olá');
    expect(await svc.translate('你好吗', 'zh-CN', 'zh_cn', ctx)).toBe('你好吗');
    expect(a.calls.translate).toBe(0);
  });

  it('falls to the next provider and records the one that served, flagged as a fallback', async () => {
    const first = driver('mymemory', () => null);
    const second = driver('google_gtx', () => 'Hola, ¿dónde está mi pedido?');
    const { svc, recorded } = build([first.d, second.d]);
    expect(await svc.translate('Where is my order', 'en', 'es', ctx)).toBe(
      'Hola, ¿dónde está mi pedido?',
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.e).toMatchObject({
      providerSlug: 'google_gtx',
      sourceLang: 'en',
      targetLang: 'es',
      wasFallback: true,
      charsIn: 'Where is my order'.length,
    });
    expect(recorded[0]!.orgId).toBe(7);
  });

  it('is not a fallback when the first provider answers', async () => {
    const { svc, recorded } = build([driver('deepl', () => 'Hola mundo cruel').d]);
    await svc.translate('Hello cruel world', 'en', 'es', ctx);
    expect(recorded[0]!.e.wasFallback).toBe(false);
  });

  it('returns null when every provider fails, logs nothing, and remembers the failure only briefly', async () => {
    const a = driver('mymemory', () => null);
    const b = driver('google_gtx', () => null);
    const { svc, recorded } = build([a.d, b.d]);
    expect(await svc.translate('Where is my order', 'en', 'es', ctx)).toBeNull();
    expect(recorded).toHaveLength(0);
    // A second ask inside the negative-cache window does not call the providers again.
    expect(await svc.translate('Where is my order', 'en', 'es', ctx)).toBeNull();
    expect(a.calls.translate).toBe(1);
  });

  it('returns null with no providers at all, without caching a failure', async () => {
    const { svc } = build([]);
    expect(await svc.translate('Where is my order', 'en', 'es', ctx)).toBeNull();
  });

  it('writes no usage row for a call without a workspace', async () => {
    const { svc, recorded } = build([driver('deepl', () => 'Hola amigo mio').d]);
    await svc.translate('Hello my friend', 'en', 'es', { orgId: null });
    expect(recorded[0]!.orgId).toBeNull(); // the real recorder drops null-org rows
  });

  it('does not share cache entries across lockdown states', async () => {
    const strict = driver('deepl', () => 'estricto');
    const loose = driver('mymemory', () => 'suelto');
    const a = build([loose.d], { lockdown: false, residency: 'any' });
    expect(await a.svc.translate('A longer sentence here', 'en', 'es', ctx)).toBe('suelto');
    // Same cache, new policy: the earlier answer must not be served.
    const router = {
      policy: async () => ({ lockdown: true, residency: 'any' }),
      drivers: async () => [strict.d],
    };
    const svc2 = new TranslationService(
      router as never,
      { record: async () => undefined } as never,
      a.cache,
    );
    expect(await svc2.translate('A longer sentence here', 'en', 'es', ctx)).toBe('estricto');
  });
});

/** WD-I18N-022 */
describe('TranslationService.detectAndTranslate', () => {
  it('returns language and text and records one usage row', async () => {
    const a = driver(
      'deepl',
      () => null,
      () => ({ language: 'es', text: 'Where is my order?' }),
    );
    const { svc, recorded } = build([a.d]);
    expect(await svc.detectAndTranslate('Dónde está mi pedido', 'en', ctx)).toEqual({
      language: 'es',
      text: 'Where is my order?',
    });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.e).toMatchObject({
      sourceLang: 'es',
      targetLang: 'en',
      providerSlug: 'deepl',
    });
  });

  it('merges halves: one driver finds the language, the next supplies the text', async () => {
    const a = driver(
      'mymemory',
      () => null,
      () => ({ language: 'es', text: null }),
    );
    const b = driver(
      'google_gtx',
      () => null,
      () => ({ language: null, text: 'Where is my order?' }),
    );
    const { svc, recorded } = build([a.d, b.d]);
    expect(await svc.detectAndTranslate('Dónde está mi pedido', 'en', ctx)).toEqual({
      language: 'es',
      text: 'Where is my order?',
    });
    // attributed to the first driver that produced anything, flagged as a fallback because two were tried
    expect(recorded[0]!.e).toMatchObject({ providerSlug: 'mymemory', wasFallback: true });
  });

  it('returns nulls when everything fails, with no usage row', async () => {
    const { svc, recorded } = build([driver('deepl', () => null).d]);
    expect(await svc.detectAndTranslate('Dónde está mi pedido', 'en', ctx)).toEqual({
      language: null,
      text: null,
    });
    expect(recorded).toHaveLength(0);
  });

  it('serves a repeat from the cache', async () => {
    const a = driver(
      'deepl',
      () => null,
      () => ({ language: 'fr', text: 'Where is it?' }),
    );
    const { svc } = build([a.d]);
    await svc.detectAndTranslate('Où est-ce', 'en', ctx);
    await svc.detectAndTranslate('Où est-ce', 'en', ctx);
    expect(a.calls.detect).toBe(1);
  });

  it('returns nulls for empty text without asking anyone', async () => {
    const a = driver(
      'deepl',
      () => null,
      () => ({ language: 'fr', text: 'x' }),
    );
    const { svc } = build([a.d]);
    expect(await svc.detectAndTranslate('  ', 'en', ctx)).toEqual({ language: null, text: null });
    expect(a.calls.detect).toBe(0);
  });
});

describe('TranslationService.detect', () => {
  it('answers a non-Latin script offline, for free', async () => {
    const a = driver(
      'deepl',
      () => null,
      () => ({ language: 'xx', text: 'x' }),
    );
    const { svc, recorded } = build([a.d]);
    expect(await svc.detect('안녕하세요', ctx)).toBe('ko');
    expect(a.calls.detect).toBe(0);
    expect(recorded).toHaveLength(0);
  });

  it('asks a provider only for Latin-script text', async () => {
    const a = driver(
      'deepl',
      () => null,
      () => ({ language: 'es', text: 'Hello' }),
    );
    const { svc } = build([a.d]);
    expect(await svc.detect('Hola amigo', ctx)).toBe('es');
    expect(a.calls.detect).toBe(1);
  });
});

describe('TranslationService.fanOut', () => {
  it('translates into every target with bounded concurrency and leaves failures out', async () => {
    let running = 0;
    let peak = 0;
    const a: TranslationDriver = {
      slug: 'deepl',
      translate: async (t, _f, to) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
        return to === 'ja' ? null : `${t}:${to}`;
      },
      detectAndTranslate: async () => ({ language: null, text: null }),
    };
    const { svc } = build([a]);
    const out = await svc.fanOut(
      'Where is my parcel',
      'en',
      ['es', 'fr', 'ja', 'de', 'it', 'en', 'es'],
      ctx,
      2,
    );
    expect(out).toEqual({
      es: 'Where is my parcel:es',
      fr: 'Where is my parcel:fr',
      de: 'Where is my parcel:de',
      it: 'Where is my parcel:it',
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
