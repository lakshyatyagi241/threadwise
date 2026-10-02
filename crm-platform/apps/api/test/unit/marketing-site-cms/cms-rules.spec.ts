import { describe, expect, it } from 'vitest';
import {
  DB_NOW,
  centsToMoney,
  checkContentValue,
  checkLayout,
  escapeLike,
  legalReadMinutes,
  normaliseSections,
  readMinutes,
  resolvePublishedAt,
  seoDescription,
  slugify,
  stripTags,
  toggledPost,
  uniqueSlug,
  yearlyCents,
} from '../../../src/modules/marketing-site-cms/cms-rules';

const NOW = new Date('2026-06-01T12:00:00Z');
const DAY = 86_400_000;
const keep = (h: string) => h;

describe('slugs', () => {
  it('lowercases, strips accents and joins words with hyphens', () => {
    expect(slugify('Hello, World! Café au lait')).toBe('hello-world-cafe-au-lait');
  });

  it('falls back when nothing usable is left', () => {
    expect(slugify('!!!')).toBe('post');
    expect(slugify('???', 'category')).toBe('category');
  });

  it('adds -2, -3 until free (TW-CMS-030: a duplicate title gets a numeric suffix)', () => {
    expect(uniqueSlug('launch', new Set())).toBe('launch');
    expect(uniqueSlug('launch', new Set(['launch']))).toBe('launch-2');
    expect(uniqueSlug('launch', new Set(['launch', 'launch-2']))).toBe('launch-3');
  });

  it('never exceeds the length limit when suffixing', () => {
    const long = 'a'.repeat(200);
    const base = slugify(long);
    const next = uniqueSlug(base, new Set([base]));
    expect(next.length).toBeLessThanOrEqual(120);
    expect(next.endsWith('-2')).toBe(true);
  });
});

describe('text helpers', () => {
  it('strips tags, scripts and entities', () => {
    expect(stripTags('<p>Hi&nbsp;<b>there</b> &amp; you</p><script>alert(1)</script>')).toBe(
      'Hi there & you',
    );
  });

  it('reading time is ceil(words / 200), at least one minute', () => {
    expect(readMinutes(null)).toBe(1);
    expect(readMinutes('<p>one two</p>')).toBe(1);
    expect(readMinutes(`<p>${'word '.repeat(201)}</p>`)).toBe(2);
    expect(readMinutes(`<p>${'word '.repeat(400)}</p>`)).toBe(2);
  });

  it('legal read time is max(1, floor(sections * 1.5))', () => {
    expect([0, 1, 2, 3, 15].map(legalReadMinutes)).toEqual([1, 1, 3, 4, 22]);
  });

  it('escapes LIKE wildcards so a search is literal', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('meta description: explicit, else excerpt, else the first 155 characters of the body', () => {
    const body = `<p>${'x'.repeat(300)}</p>`;
    expect(seoDescription({ metaDescription: ' Mine ', excerpt: 'E', body })).toBe('Mine');
    expect(seoDescription({ metaDescription: null, excerpt: 'The excerpt', body })).toBe(
      'The excerpt',
    );
    expect(seoDescription({ metaDescription: '', excerpt: '', body })).toHaveLength(155);
  });
});

describe('blog scheduling', () => {
  it('an explicit date wins; published stamps the database clock once; a draft keeps what it had', () => {
    const future = new Date(NOW.getTime() + 2 * DAY);
    const old = new Date('2025-01-01T00:00:00Z');
    expect(resolvePublishedAt('published', future, old)).toEqual(future);
    expect(resolvePublishedAt('published', null, null)).toBe(DB_NOW);
    expect(resolvePublishedAt('published', null, old)).toEqual(old);
    expect(resolvePublishedAt('draft', null, null)).toBeNull();
    expect(resolvePublishedAt('draft', null, old)).toEqual(old);
    expect(resolvePublishedAt('draft', future, null)).toEqual(future);
  });

  it('toggling: publish stamps only an empty date, unpublish keeps the date', () => {
    const old = new Date('2025-01-01T00:00:00Z');
    expect(toggledPost('draft', null)).toEqual({ status: 'published', publishedAt: DB_NOW });
    expect(toggledPost('draft', old)).toEqual({ status: 'published', publishedAt: old });
    expect(toggledPost('published', old)).toEqual({ status: 'draft', publishedAt: old });
    expect(toggledPost('published', null)).toEqual({ status: 'draft', publishedAt: null });
  });
});

describe('legal sections (TW-CMS-034 rule 1)', () => {
  it('drops empty rows, auto-numbers blank numbers by final position and keeps order', () => {
    const out = normaliseSections(
      [
        { n: ' A ', title: ' First ', body: '<p>one</p>' },
        { n: '', title: '', body: '<p> </p>' },
        { n: '', title: 'Second', body: '' },
        { n: '', title: '', body: '<p>text only</p>' },
      ],
      keep,
    );
    expect(out).toEqual([
      { n: 'A', title: 'First', body: '<p>one</p>' },
      { n: '02', title: 'Second', body: '' },
      { n: '03', title: '', body: '<p>text only</p>' },
    ]);
  });

  it('sanitises every body through the supplied cleaner', () => {
    const out = normaliseSections(
      [{ n: '1', title: 'T', body: '<script>x</script><p>ok</p>' }],
      (h) => h.replace(/<script>.*?<\/script>/g, ''),
    );
    expect(out[0]!.body).toBe('<p>ok</p>');
  });
});

describe('pricing arithmetic (money never goes through a float)', () => {
  it('yearly price is twelve months at the discount, in cents', () => {
    expect(yearlyCents(2900, 20)).toBe(27_840);
    expect(centsToMoney(yearlyCents(2900, 20))).toBe('278.40');
    expect(centsToMoney(yearlyCents(1999, 15))).toBe('203.90');
    expect(centsToMoney(yearlyCents(1000, 0))).toBe('120.00');
  });

  it('formats cents with two decimals', () => {
    expect([0, 5, 100, 12_345].map(centsToMoney)).toEqual(['0.00', '0.05', '1.00', '123.45']);
  });
});

describe('content values (TW-CMS-019, 020)', () => {
  it('rejects unknown keys and the layout keys on the draft endpoint', () => {
    expect(checkContentValue('home.hero.nope', 'x', keep)).toMatchObject({ ok: false });
    expect(checkContentValue('bad key!', 'x', keep)).toMatchObject({ ok: false });
    expect(checkContentValue('home.__hidden', '["faq"]', keep)).toMatchObject({ ok: false });
  });

  it('empty means "use the default" for every type', () => {
    expect(checkContentValue('home.hero.headline', '   ', keep)).toEqual({ ok: true, value: '' });
    expect(checkContentValue('theme.brand.deep', '', keep)).toEqual({ ok: true, value: '' });
  });

  it('colours must be #RGB or #RRGGBB', () => {
    expect(checkContentValue('theme.brand.deep', '#12', keep)).toEqual({
      ok: false,
      message: 'Invalid colour',
    });
    expect(checkContentValue('theme.brand.deep', 'red', keep)).toMatchObject({ ok: false });
    expect(checkContentValue('theme.brand.deep', ' #1A2b3C ', keep)).toEqual({
      ok: true,
      value: '#1A2b3C',
    });
    expect(checkContentValue('theme.brand.deep', '#abc', keep)).toEqual({
      ok: true,
      value: '#abc',
    });
  });

  it('links accept paths, anchors, https, mailto and tel, and nothing executable', () => {
    for (const ok of [
      '/pricing',
      '#faq',
      'https://example.com/x',
      'mailto:a@b.co',
      'tel:+15551234',
    ]) {
      expect(checkContentValue('nav.link2_url', ok, keep)).toMatchObject({ ok: true });
    }
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:1',
      '//evil.example',
      'data:text/html,x',
      'ftp://x',
      'a b',
    ]) {
      expect(checkContentValue('nav.link2_url', bad, keep)).toMatchObject({ ok: false });
    }
  });

  it('rich text goes through the sanitiser; plain text loses control characters', () => {
    const r = checkContentValue('home.hero.headline', '<b>Hi</b><script>x</script>', (h) =>
      h.replace(/<script>.*<\/script>/, ''),
    );
    expect(r).toEqual({ ok: true, value: '<b>Hi</b>' });
    const t = checkContentValue('home.hero.eyebrow', 'one\u0000two\nthree', keep);
    expect(t).toEqual({ ok: true, value: 'one two three' });
  });

  it('caps length', () => {
    expect(checkContentValue('home.hero.eyebrow', 'x'.repeat(501), keep)).toMatchObject({
      ok: false,
    });
  });
});

describe('layout (TW-CMS-022, 023)', () => {
  it('hiding a pinned section is refused', () => {
    expect(checkLayout('home', ['hero'], undefined)).toEqual({
      ok: false,
      message: 'This section cannot be hidden',
    });
  });

  it('hiding refuses a slug that is not on that page', () => {
    expect(checkLayout('home', ['pillars'], undefined)).toEqual({
      ok: false,
      message: 'Unknown section',
    });
  });

  it('an unknown page is refused', () => {
    expect(checkLayout('blog', [], [])).toEqual({ ok: false, message: 'Unknown page' });
  });

  it('hidden is deduplicated', () => {
    expect(checkLayout('home', ['faq', 'faq'], undefined)).toEqual({ ok: true, hidden: ['faq'] });
  });

  it('reordering silently drops pinned, foreign and repeated slugs, keeping the submitted order', () => {
    expect(checkLayout('home', undefined, ['hero', 'faq', 'pillars', 'highlights', 'faq'])).toEqual(
      {
        ok: true,
        order: ['faq', 'highlights'],
      },
    );
  });
});
