import { describe, expect, it } from 'vitest';
import type { CmsEntry } from '@crm/contracts';
import { contentFromEntries, makeFc, sectionsFor, themeVars } from './content';

const entry = (key: string, draft: string | null, published: string | null): CmsEntry => ({
  key,
  type: 'text',
  draft,
  published,
  rowVersion: 1,
});

describe('makeFc', () => {
  it('returns the saved value, else the shipped default, else empty', () => {
    const fc = makeFc({ 'home.hero.eyebrow': 'Saved' });
    expect(fc('home.hero.eyebrow')).toBe('Saved');
    expect(fc('home.hero.headline')).toContain('conversation');
    expect(fc('nope.nothing')).toBe('');
  });
  it('treats an empty saved value as "use the default"', () => {
    expect(makeFc({ 'home.hero.eyebrow': '' })('home.hero.eyebrow')).not.toBe('');
  });
});

describe('contentFromEntries (the editor preview)', () => {
  it('drafts win over published values and an empty draft falls back to the default', () => {
    const c = contentFromEntries(
      [
        entry('home.hero.eyebrow', 'Draft', 'Live'),
        entry('home.hero.headline', '', 'Live headline'),
        entry('home.__hidden', '["faq"]', null),
        entry('home.__order', null, '["cta-final"]'),
      ],
      true,
      'Brand',
    );
    expect(c.values['home.hero.eyebrow']).toBe('Draft');
    expect(c.values['home.hero.headline']).toBeUndefined();
    expect(c.hidden.home).toEqual(['faq']);
    expect(c.order.home).toEqual(['cta-final']);
    expect(sectionsFor('home', c)).not.toContain('faq');
    expect(sectionsFor('home', c)[1]).toBe('cta-final');
  });
});

describe('themeVars', () => {
  it('emits one property per token, keeps valid hex colours and ignores anything else', () => {
    const v = themeVars({ 'theme.wa.deep': '#112233', 'theme.wa.teal': 'red; background:url(x)' });
    expect(v['--site-wa-deep']).toBe('#112233');
    expect(v['--site-wa-teal']).toBe('#128C7E');
    expect(Object.keys(v)).toHaveLength(24);
  });
});
