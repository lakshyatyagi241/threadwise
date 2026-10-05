import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasConsoleIcon } from './console-icons';
import { CONSOLE_KEYWORDS } from './console-keywords';
import { CONSOLE_LAYOUT, MODULES_SECTION } from './console-layout';
import { CONSOLE_NAV_ITEMS, buildConsoleNav, isGroup, leaves } from './console-nav';

const layoutIds = CONSOLE_LAYOUT.flatMap((s) => s.blocks.flatMap((b) => b.items));
const itemIds = CONSOLE_NAV_ITEMS.map((i) => i.id);

describe('the real console menu', () => {
  it('names only pages that exist, so a typo cannot hide one', () => {
    const unknown = layoutIds.filter((id) => !itemIds.includes(id));
    expect(unknown).toEqual([]);
  });

  it('lists no page twice', () => {
    const twice = layoutIds.filter((id, i) => layoutIds.indexOf(id) !== i);
    expect(twice).toEqual([]);
  });

  it('places every page the console has: add a new page to console-layout.ts', () => {
    const unplaced = itemIds.filter((id) => !layoutIds.includes(id));
    expect(unplaced).toEqual([]);
  });

  it('builds only the designed sections, never a leftover heading', () => {
    const groups = buildConsoleNav(CONSOLE_NAV_ITEMS).filter(isGroup);
    expect(groups.map((g) => g.id)).toEqual(CONSOLE_LAYOUT.map((s) => s.id));
  });

  it('keeps every page reachable at its own address, once', () => {
    const rail = leaves(buildConsoleNav(CONSOLE_NAV_ITEMS)).filter((l) => l.id !== 'overview');
    expect(rail.map((l) => l.href).sort()).toEqual(CONSOLE_NAV_ITEMS.map((i) => i.href).sort());
  });

  it('has no section with a single page: that is a link, not a group', () => {
    const lonely = buildConsoleNav(CONSOLE_NAV_ITEMS)
      .filter(isGroup)
      .filter((g) => g.children.length < 2)
      .map((g) => g.id);
    expect(lonely).toEqual([]);
  });

  it('keeps the menu short enough to scan', () => {
    expect(CONSOLE_LAYOUT.length).toBeLessThanOrEqual(10);
  });

  it('has unique section ids, and the section modules append to', () => {
    const ids = CONSOLE_LAYOUT.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(MODULES_SECTION);
  });

  it('draws an icon for every section', () => {
    const missing = CONSOLE_LAYOUT.filter((s) => !hasConsoleIcon(s.icon)).map((s) => s.id);
    expect(missing).toEqual([]);
  });
});

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const nav = (locale: string) =>
  (
    JSON.parse(
      readFileSync(join(WEB, 'messages', locale, 'admin-console-shell.json'), 'utf8'),
    ) as Tree
  )['admin-console-shell'] as Tree;
const names = (locale: string, part: 'sections' | 'captions') =>
  ((nav(locale).nav as Tree)[part] ?? {}) as Record<string, string>;

const sectionIds = CONSOLE_LAYOUT.map((s) => s.id).sort();
const captionIds = [
  ...new Set(
    CONSOLE_LAYOUT.flatMap((s) => s.blocks.flatMap((b) => (b.caption ? [b.caption] : []))),
  ),
].sort();

describe.each(['en', 'ar'])('menu headings (%s)', (locale) => {
  it('has a name for every section and no stray ones', () => {
    const sections = names(locale, 'sections');
    expect(Object.keys(sections).sort()).toEqual(sectionIds);
    for (const value of Object.values(sections)) expect(value.trim()).not.toBe('');
  });

  it('has a heading for every block and no stray ones', () => {
    const captions = names(locale, 'captions');
    expect(Object.keys(captions).sort()).toEqual(captionIds);
    for (const value of Object.values(captions)) expect(value.trim()).not.toBe('');
  });
});

describe('search keywords', () => {
  it('has words for every console page, so the search can find it by what it does: add them to console-keywords.ts', () => {
    const missing = itemIds.filter((id) => !CONSOLE_KEYWORDS[id]);
    expect(missing).toEqual([]);
  });

  it('names only pages that exist', () => {
    const known = new Set([...itemIds, 'overview', 'account']);
    const stray = Object.keys(CONSOLE_KEYWORDS).filter((id) => !known.has(id));
    expect(stray).toEqual([]);
  });
});

describe('search messages', () => {
  const search = (locale: string) =>
    Object.keys((nav(locale).search ?? {}) as Tree)
      .sort()
      .join(',');

  it('has the same strings in English and Arabic, and none empty', () => {
    expect(search('ar')).toBe(search('en'));
    expect(search('en')).not.toBe('');
    for (const locale of ['en', 'ar'])
      for (const value of Object.values(nav(locale).search as Tree)) {
        expect(String(value).trim()).not.toBe('');
      }
  });
});
