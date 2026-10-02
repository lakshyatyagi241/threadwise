import { describe, expect, it } from 'vitest';
import type {
  KeywordRule,
  KeywordRuleStore,
  RuleScan,
  TranslatedRule,
} from '../../../src/modules/localization-translation/keyword-rule-store';
import {
  DEFAULT_TARGETS,
  matchesTranslation,
  parseTargetList,
  replyLanguage,
  targetsFor,
  withCanonical,
} from '../../../src/modules/localization-translation/keyword-translation';
import { KeywordTranslationService } from '../../../src/modules/localization-translation/keyword-translation.service';

describe('target languages (TW-I18N-032)', () => {
  it('ships Reference default list of 111 unique codes', () => {
    expect(DEFAULT_TARGETS).toHaveLength(111);
    expect(new Set(DEFAULT_TARGETS).size).toBe(111);
    expect(DEFAULT_TARGETS).toContain('zh-tw'); // some providers reject it; the target then just fails
  });

  it('uses the workspace list when it has one, unique and in order', () => {
    expect(targetsFor('["es","hi","es"]')).toEqual(['es', 'hi']);
    expect(targetsFor('es, HI')).toEqual(['es', 'hi']);
  });

  it('falls back to the default list for nothing usable', () => {
    for (const raw of [null, undefined, '', '[]', '{"a":1}', ' , ']) {
      expect(targetsFor(raw)).toEqual([...DEFAULT_TARGETS]);
    }
    expect(parseTargetList('[]')).toBeNull();
  });

  it('keeps the canonical form first and an empty text out', () => {
    expect(withCanonical(' hello ', 'en', { es: 'hola' })).toEqual({ en: 'hello', es: 'hola' });
    expect(withCanonical('   ', 'en', {})).toEqual({});
  });
});

describe('matchesTranslation (TW-I18N-034 stage 1.5a)', () => {
  const rule = (
    method: string,
    map: Record<string, string> | null = { en: 'price', hi: 'कीमत', es: 'precio' },
  ) => ({
    matchingMethod: method,
    keywordTranslations: map,
  });

  it('matches a stored translation case-insensitively and returns its language', () => {
    expect(matchesTranslation(rule('exact'), '  कीमत ')).toBe('hi');
    expect(matchesTranslation(rule('exact'), 'PRECIO')).toBe('es');
  });

  it('matches a substring only for a contains rule', () => {
    expect(matchesTranslation(rule('exact'), 'cual es el precio')).toBeNull();
    expect(matchesTranslation(rule('contains'), 'cual es el precio?')).toBe('es');
  });

  it('returns the first language in map order when several match', () => {
    expect(matchesTranslation(rule('exact', { en: 'ok', es: 'ok' }), 'ok')).toBe('en');
  });

  it('finds nothing without a map or with blank values', () => {
    expect(matchesTranslation(rule('exact', null), 'price')).toBeNull();
    expect(matchesTranslation(rule('contains', { en: '  ' }), 'price')).toBeNull();
  });
});

describe('replyLanguage', () => {
  it('trusts the language that matched, even for Latin script', () => {
    expect(replyLanguage('es', 'hola', 'en')).toBe('es');
  });

  it('otherwise detects the script and falls back to the workspace language', () => {
    expect(replyLanguage(null, 'नमस्ते', 'en')).toBe('hi');
    expect(replyLanguage(null, 'hello', 'fr')).toBe('fr');
    expect(replyLanguage(null, 'hello', null)).toBe('en');
  });
});

// --- the service ---------------------------------------------------------------------------------------------------

type Rule = KeywordRule;
const rule = (over: Partial<Rule> = {}): Rule => ({
  id: 'r1',
  orgId: 7,
  keyword: 'hello',
  canonicalLanguage: null,
  keywordTranslations: null,
  matchingMethod: 'exact',
  contents: [{ id: 'c1', contentType: 'text', content: 'Welcome!', contentTranslations: null }],
  ...over,
});

function build(
  opts: {
    rules?: Rule[];
    ws?: Partial<Record<number, { d: string | null; l: string | null }>>;
    fail?: string[];
    det?: { language: string | null; text: string | null };
  } = {},
) {
  const rules = opts.rules ?? [];
  const saved = new Map<string, TranslatedRule>();
  const scans: RuleScan[] = [];
  const store: KeywordRuleStore = {
    workspaces: async () => [...new Set(rules.map((r) => r.orgId))],
    workspaceLanguages: async (orgId) => ({
      defaultLanguage: opts.ws?.[orgId]?.d ?? null,
      autoTranslateLanguages: opts.ws?.[orgId]?.l ?? null,
    }),
    scan: async (s) => {
      scans.push(s);
      return rules
        .filter(
          (r) => r.orgId === s.orgId && (s.includeTranslated || r.keywordTranslations === null),
        )
        .filter((r) => !s.after || r.id > s.after)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, s.limit);
    },
    save: async (r, t) => void saved.set(r.id, t),
  };
  const calls: Array<{ text: string; from: string; to: string; orgId: number | null }> = [];
  const translation = {
    fanOut: async (
      text: string,
      from: string,
      targets: readonly string[],
      ctx: { orgId: number | null },
    ) => {
      const out: Record<string, string> = {};
      for (const t of targets) {
        calls.push({ text, from, to: t, orgId: ctx.orgId });
        if (!opts.fail?.includes(t) && t !== from) out[t] = `${text}~${t}`;
      }
      return out;
    },
    translate: async (text: string, from: string, to: string) => {
      calls.push({ text, from, to, orgId: null });
      return opts.fail?.includes(to) ? null : `${text}~${to}`;
    },
    detectAndTranslate: async () => opts.det ?? { language: null, text: null },
  };
  const svc = new KeywordTranslationService(translation as never, store);
  return { svc, saved, scans, calls };
}

/** TW-I18N-032 */
describe('translateForKeyword', () => {
  it('stores the keyword map and a map per text variant, canonical language first', async () => {
    const { svc, saved } = build();
    const r = await svc.translateForKeyword(rule(), ['es', 'hi']);
    expect(r.keywordTranslations).toEqual({ en: 'hello', es: 'hello~es', hi: 'hello~hi' });
    expect(r.contentTranslations).toEqual({
      c1: { en: 'Welcome!', es: 'Welcome!~es', hi: 'Welcome!~hi' },
    });
    expect(r.canonicalLanguage).toBe('en');
    expect(saved.get('r1')).toEqual(r);
  });

  it('leaves a failed language out and still saves', async () => {
    const { svc } = build({ fail: ['hi'] });
    const r = await svc.translateForKeyword(rule(), ['es', 'hi']);
    expect(Object.keys(r.keywordTranslations)).toEqual(['en', 'es']);
  });

  it('does not translate media, empty or non-text variants', async () => {
    const { svc } = build();
    const r = await svc.translateForKeyword(
      rule({
        contents: [
          { id: 'img', contentType: 'image', content: 'caption', contentTranslations: null },
          { id: 'blank', contentType: 'text', content: '   ', contentTranslations: null },
          { id: 'txt', contentType: 'text', content: 'Hi', contentTranslations: null },
        ],
      }),
      ['es'],
    );
    expect(Object.keys(r.contentTranslations)).toEqual(['txt']);
  });

  it('uses only the workspace list, and its default language as the source when the rule has none', async () => {
    const { svc, calls } = build({ ws: { 7: { d: 'fr', l: '["es"]' } } });
    const r = await svc.translateForKeyword(rule());
    expect(r.canonicalLanguage).toBe('fr');
    expect(r.keywordTranslations).toEqual({ fr: 'hello', es: 'hello~es' });
    expect(new Set(calls.map((c) => c.to))).toEqual(new Set(['es']));
    expect(calls.every((c) => c.orgId === 7)).toBe(true); // the workspace travels with every call
  });

  it('prefers the rule canonical language, and falls back to the default list and English', async () => {
    const { svc, calls } = build();
    const r = await svc.translateForKeyword(rule({ canonicalLanguage: 'es' }));
    expect(r.canonicalLanguage).toBe('es');
    expect(new Set(calls.map((c) => c.to)).size).toBe(111);
    expect((await build().svc.translateForKeyword(rule(), [])).canonicalLanguage).toBe('en');
  });

  it('translates a multi-phrase keyword as one text', async () => {
    const { svc } = build();
    const r = await svc.translateForKeyword(rule({ keyword: 'hi, hello' }), ['es']);
    expect(r.keywordTranslations.es).toBe('hi, hello~es');
  });
});

/** TW-I18N-033 */
describe('backfill', () => {
  const three = () => [rule({ id: 'a' }), rule({ id: 'b' }), rule({ id: 'c' })];

  it('translates every untranslated rule and reports the count', async () => {
    const { svc, saved } = build({ rules: three(), ws: { 7: { d: null, l: '["es"]' } } });
    expect(await svc.backfill()).toMatchObject({ total: 3, translated: 3, failed: 0 });
    expect([...saved.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('skips translated rules unless forced', async () => {
    const done = rule({ id: 'a', keywordTranslations: { en: 'hello' } });
    const { svc } = build({
      rules: [done, rule({ id: 'b' })],
      ws: { 7: { d: null, l: '["es"]' } },
    });
    expect((await svc.backfill()).total).toBe(1);
    const forced = build({ rules: [done, rule({ id: 'b' })], ws: { 7: { d: null, l: '["es"]' } } });
    expect((await forced.svc.backfill({ force: true })).total).toBe(2);
  });

  it('limits itself to one workspace', async () => {
    const { svc, saved } = build({
      rules: [rule({ id: 'a', orgId: 7 }), rule({ id: 'b', orgId: 8 })],
      ws: { 7: { d: null, l: '["es"]' }, 8: { d: null, l: '["es"]' } },
    });
    expect((await svc.backfill({ orgId: 8 })).total).toBe(1);
    expect([...saved.keys()]).toEqual(['b']);
  });

  it('says there is nothing to do when every rule is translated', async () => {
    const { svc } = build({ rules: [rule({ keywordTranslations: { en: 'hello' } })] });
    expect(await svc.backfill()).toEqual({ total: 0, translated: 0, failed: 0, failures: [] });
  });

  it('counts a rule that throws and carries on with the rest', async () => {
    const { svc, saved } = build({ rules: three(), ws: { 7: { d: null, l: '["es"]' } } });
    const real = svc.translateForKeyword.bind(svc);
    svc.translateForKeyword = async (r, t) =>
      r.id === 'b' ? Promise.reject(new Error('boom')) : real(r, t);
    const seen: string[] = [];
    const out = await svc.backfill({ onRule: (r, e) => seen.push(`${r.id}:${e ? 'x' : 'ok'}`) });
    expect(out).toMatchObject({
      total: 3,
      translated: 2,
      failed: 1,
      failures: [{ id: 'b', message: 'boom' }],
    });
    expect(seen).toEqual(['a:ok', 'b:x', 'c:ok']);
    expect([...saved.keys()]).toEqual(['a', 'c']);
  });

  it('pages through more than one page of rules', async () => {
    const many = Array.from({ length: 120 }, (_, i) =>
      rule({ id: `r${String(i).padStart(3, '0')}` }),
    );
    const { svc, scans } = build({ rules: many, ws: { 7: { d: null, l: '["es"]' } } });
    expect((await svc.backfill()).translated).toBe(120);
    expect(scans.length).toBeGreaterThan(2);
  });
});

/** TW-I18N-034 */
describe('resolveInbound', () => {
  const hindi = rule({ id: 'h', keywordTranslations: { en: 'hello', hi: 'नमस्ते' } });

  it('matches a stored translation with no provider call and reports the language', async () => {
    const { svc } = build({ det: { language: 'xx', text: 'should not be used' } });
    const hit = await svc.resolveInbound({
      orgId: 7,
      message: 'नमस्ते',
      candidates: [hindi],
      matchCanonical: async () => Promise.reject(new Error('not needed')),
    });
    expect(hit).toEqual({ rule: hindi, language: 'hi' });
  });

  it('falls back to the English translation and the matcher own match', async () => {
    const price = rule({ id: 'p', keyword: 'price' });
    const { svc } = build({ det: { language: 'es', text: 'Price' } });
    const asked: string[] = [];
    const hit = await svc.resolveInbound({
      orgId: 7,
      message: 'precio',
      candidates: [],
      matchCanonical: async (english) => (asked.push(english), price),
    });
    expect(hit).toEqual({ rule: price, language: 'es' });
    expect(asked).toEqual(['price']);
  });

  it('does not retry the match for an English message or a failed translation', async () => {
    for (const det of [
      { language: 'en', text: 'price' },
      { language: 'es', text: null },
      { language: null, text: null },
    ]) {
      const { svc } = build({ det });
      const hit = await svc.resolveInbound({
        orgId: 7,
        message: 'precio',
        candidates: [],
        matchCanonical: async () => Promise.reject(new Error('must not run')),
      });
      expect(hit).toBeNull();
    }
  });

  it('is no hit, not an error, when the provider throws or the message is empty', async () => {
    const { svc } = build();
    (svc as unknown as { translation: unknown }).translation = {
      detectAndTranslate: async () => Promise.reject(new Error('outage')),
    };
    expect(
      await svc.resolveInbound({
        orgId: 7,
        message: 'precio',
        candidates: [],
        matchCanonical: async () => null,
      }),
    ).toBeNull();
    expect(
      await build().svc.resolveInbound({
        orgId: 7,
        message: '  ',
        candidates: [],
        matchCanonical: async () => null,
      }),
    ).toBeNull();
  });
});

describe('pickContent', () => {
  const variant = { content: 'Welcome!', contentTranslations: { hi: 'स्वागत है!' } };

  it('returns the stored translation, the original for the canonical language, and the original with no language', async () => {
    const { svc, calls } = build();
    expect(await svc.pickContent(variant, 'hi', 'en', 7)).toBe('स्वागत है!');
    expect(await svc.pickContent(variant, 'EN', 'en', 7)).toBe('Welcome!');
    expect(await svc.pickContent(variant, null, 'en', 7)).toBe('Welcome!');
    expect(await svc.pickContent({ content: '', contentTranslations: null }, 'es', 'en', 7)).toBe(
      '',
    );
    expect(calls).toHaveLength(0); // no provider call for any of those
  });

  it('translates live when nothing is stored, and sends the original when that fails', async () => {
    const { svc, calls } = build({ fail: ['de'] });
    expect(await svc.pickContent(variant, 'es', null, 7)).toBe('Welcome!~es');
    expect(calls[0]).toMatchObject({ from: 'en', to: 'es' }); // canonical defaults to English
    expect(await svc.pickContent(variant, 'de', 'en', 7)).toBe('Welcome!');
  });
});
