import { describe, expect, it } from 'vitest';
import {
  CMS_KEYS,
  CMS_PAGES,
  CMS_REGISTRY,
  CMS_SITE_SECTIONS,
  THEME_PRESETS,
  THEME_TOKENS,
  isSafeLink,
  removableSlugs,
  resolveSections,
  scopePrefixes,
} from '@crm/contracts';
import { checkContentValue } from '../../../src/modules/marketing-site-cms/cms-rules';

const KEY_GRAMMAR = /^[a-z0-9]+([._-][a-z0-9]+)*$/i;

describe('registry integrity', () => {
  it('every page starts with exactly one pinned hero and has unique section slugs', () => {
    for (const page of CMS_PAGES) {
      const slugs = CMS_REGISTRY[page].sections.map((s) => s.slug);
      expect(new Set(slugs).size, page).toBe(slugs.length);
      expect(CMS_REGISTRY[page].sections[0]).toMatchObject({ slug: 'hero', removable: false });
      expect(CMS_REGISTRY[page].sections.filter((s) => !s.removable)).toHaveLength(1);
    }
  });

  it('every content key fits the key grammar (letters, digits, . _ -) and 191 characters', () => {
    for (const key of CMS_KEYS.keys()) {
      expect(key, key).toMatch(KEY_GRAMMAR);
      expect(key.length).toBeLessThanOrEqual(191);
    }
  });

  it('keys are unique: the flat table has one entry per declared field and token', () => {
    const fields =
      CMS_PAGES.flatMap((p) => CMS_REGISTRY[p].sections.flatMap((s) => s.fields)).length +
      CMS_SITE_SECTIONS.flatMap((s) => s.fields).length +
      THEME_TOKENS.length;
    expect(CMS_KEYS.size).toBe(fields);
  });

  it('every shipped default passes its own validation (so a Reset can never produce an invalid page)', () => {
    for (const [key, info] of CMS_KEYS) {
      if (info.default === '') continue;
      expect(
        checkContentValue(key, info.default, (h) => h),
        key,
      ).toMatchObject({ ok: true });
    }
  });

  it('ships no invented claims in default copy', () => {
    const text = [...CMS_KEYS.values()]
      .map((k) => k.default)
      .join(' ')
      .toLowerCase();
    for (const claim of [
      'soc 2',
      'million',
      'trusted by',
      '99.9',
      'g2',
      'capterra',
      'testimonial',
    ]) {
      expect(text, claim).not.toContain(claim);
    }
  });

  it('every preset only touches known brand or accent tokens', () => {
    const tokens = new Map(THEME_TOKENS.map((t) => [t.key, t]));
    for (const preset of THEME_PRESETS) {
      for (const [key, value] of Object.entries(preset.tokens)) {
        expect(['brand', 'accent'], `${preset.id}:${key}`).toContain(tokens.get(key)?.group);
        expect(value).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
    expect(THEME_PRESETS.map((p) => p.id)).toEqual([
      'emerald',
      'ocean',
      'forest',
      'royal',
      'sunset',
      'slate',
    ]);
  });
});

describe('resolveSections (TW-CMS-009)', () => {
  const def = CMS_REGISTRY.home.sections.map((s) => s.slug);

  it('no saved layout yields the default order', () => {
    expect(resolveSections('home')).toEqual(def);
  });

  it('a saved order comes first and everything else follows in default order', () => {
    const out = resolveSections('home', [], ['faq', 'pricing-strip']);
    expect(out.slice(0, 3)).toEqual(['hero', 'faq', 'pricing-strip']);
    expect(out.slice(3)).toEqual(def.filter((s) => !['hero', 'faq', 'pricing-strip'].includes(s)));
  });

  it('hidden sections disappear but the pinned hero is always rendered', () => {
    const out = resolveSections('home', ['highlights', 'hero'], []);
    expect(out).not.toContain('highlights');
    expect(out[0]).toBe('hero');
  });

  it('a section absent from the saved order still renders (a new section can never vanish)', () => {
    const out = resolveSections('home', [], ['faq']);
    expect(out).toEqual(expect.arrayContaining(def));
    expect(out).toHaveLength(def.length);
  });

  it('ignores saved slugs that no longer exist or are pinned', () => {
    expect(
      resolveSections('home', [], ['gone', 'hero', 'faq']).filter((s) => s === 'hero'),
    ).toHaveLength(1);
    expect(resolveSections('home', [], ['gone'])).toEqual(def);
  });

  it('removable slugs exclude the hero', () => {
    for (const page of CMS_PAGES) expect(removableSlugs(page)).not.toContain('hero');
  });
});

describe('scopes', () => {
  it('a page scope is its own prefix, site is nav and footer, all has none', () => {
    expect(scopePrefixes('home')).toEqual(['home.']);
    expect(scopePrefixes('site')).toEqual(['nav.', 'footer.']);
    expect(scopePrefixes('theme')).toEqual(['theme.']);
    expect(scopePrefixes('all')).toBeNull();
  });
});

describe('isSafeLink', () => {
  it('blocks control characters and oversized values', () => {
    expect(isSafeLink('/a\nb')).toBe(false);
    expect(isSafeLink(`/${'a'.repeat(600)}`)).toBe(false);
    expect(isSafeLink('')).toBe(false);
  });
});
