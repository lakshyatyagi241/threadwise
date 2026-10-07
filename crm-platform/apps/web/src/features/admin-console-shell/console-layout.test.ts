import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasConsoleIcon } from './console-icons';
import { CONSOLE_KEYWORDS } from './console-keywords';
import { CONSOLE_LAYOUT, MAX_HUBS, MAX_TABS, MODULES_SECTION, NOT_IN_MENU } from './console-layout';
import { CONSOLE_NAV_ITEMS, buildConsoleNav, isGroup, leaves } from './console-nav';

const layoutIds = CONSOLE_LAYOUT.flatMap((h) => h.tabs);
const itemIds = CONSOLE_NAV_ITEMS.map((i) => i.id);

describe('the real console menu', () => {
  it('names only pages that exist, so a typo cannot hide one', () => {
    const unknown = layoutIds.filter((id) => !itemIds.includes(id));
    expect(unknown).toEqual([]);
  });

  it('lists no page twice, so a page is never in two tab bars', () => {
    const twice = layoutIds.filter((id, i) => layoutIds.indexOf(id) !== i);
    expect(twice).toEqual([]);
  });

  it('places every page the console has: add a new page to console-layout.ts', () => {
    const unplaced = itemIds.filter((id) => !layoutIds.includes(id));
    expect(unplaced).toEqual([]);
  });

  it('builds only the designed hubs, never a leftover heading', () => {
    const groups = buildConsoleNav(CONSOLE_NAV_ITEMS).filter(isGroup);
    expect(groups.map((g) => g.id)).toEqual(CONSOLE_LAYOUT.map((h) => h.id));
  });

  it('keeps every page reachable at its own address, once', () => {
    const rail = leaves(buildConsoleNav(CONSOLE_NAV_ITEMS)).filter((l) => l.id !== 'overview');
    expect(rail.map((l) => l.href).sort()).toEqual(CONSOLE_NAV_ITEMS.map((i) => i.href).sort());
  });

  it('has no hub with a single page: that is a link, not a hub', () => {
    const lonely = CONSOLE_LAYOUT.filter((h) => h.tabs.length < 2).map((h) => h.id);
    expect(lonely).toEqual([]);
  });

  it('keeps the rail short enough to scan', () => {
    expect(CONSOLE_LAYOUT.length).toBeLessThanOrEqual(MAX_HUBS);
  });

  it('keeps every tab bar short enough to scan (Settings is an index of tiles, not a bar)', () => {
    const long = CONSOLE_LAYOUT.filter((h) => h.kind === 'tabs' && h.tabs.length > MAX_TABS).map(
      (h) => h.id,
    );
    expect(long).toEqual([]);
  });

  it('has unique hub ids, and the hub modules append to', () => {
    const ids = CONSOLE_LAYOUT.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(MODULES_SECTION);
  });

  it('draws an icon for every hub', () => {
    const missing = CONSOLE_LAYOUT.filter((h) => !hasConsoleIcon(h.icon)).map((h) => h.id);
    expect(missing).toEqual([]);
  });

  it('opens an index hub (Settings) on its landing page', () => {
    for (const hub of CONSOLE_LAYOUT.filter((h) => h.kind === 'index')) {
      const first = CONSOLE_NAV_ITEMS.find((i) => i.id === hub.tabs[0]);
      expect(first?.href, hub.id).toBe('/admin/settings');
    }
  });
});

/** The address of every built admin page, from the app folder: `(group)` folders are not part of an address. */
function adminRoutes(): string[] {
  const root = resolve(__dirname, '../../app');
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'page.tsx') {
        const parts = dir
          .slice(root.length + 1)
          .split(sep)
          .filter((p) => p && !/^\(.*\)$/.test(p));
        if (parts[0] === 'admin') found.push(parts.slice(1).join('/'));
      }
    }
  };
  walk(root);
  return found;
}

const generic = (path: string) => path.replace(/\[[^\]]+\]/g, '[x]');

describe('every built admin page can be reached', () => {
  const routes = adminRoutes();
  const menuPaths = new Set(
    CONSOLE_NAV_ITEMS.map((i) => generic(i.href.replace(/^\/admin\/?/, ''))),
  );
  const leftOut = new Set(Object.keys(NOT_IN_MENU).map(generic));

  it('finds the admin pages, so this check cannot pass by scanning nothing', () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  it('puts every page in a hub, or names it in NOT_IN_MENU with the reason', () => {
    const lost = routes
      .map(generic)
      .filter((r) => r !== '' && !menuPaths.has(r) && !leftOut.has(r));
    expect(lost).toEqual([]);
  });

  it('keeps NOT_IN_MENU honest: every entry is a page that exists', () => {
    const built = new Set(routes.map(generic));
    const stale = [...leftOut].filter((r) => !built.has(r));
    expect(stale).toEqual([]);
  });

  it('never lists a page in a hub and also leaves it out', () => {
    const both = [...leftOut].filter((r) => menuPaths.has(r));
    expect(both).toEqual([]);
  });

  it('gives every NOT_IN_MENU entry a reason', () => {
    for (const [route, reason] of Object.entries(NOT_IN_MENU)) {
      expect(reason.trim(), route).not.toBe('');
    }
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
const names = (locale: string, part: 'sections' | 'hubNotes' | 'labels') =>
  ((nav(locale).nav as Tree)[part] ?? {}) as Record<string, string>;

const hubIds = CONSOLE_LAYOUT.map((h) => h.id).sort();

describe.each(['en', 'ar'])('menu names (%s)', (locale) => {
  it('has a name for every hub and no stray ones', () => {
    const sections = names(locale, 'sections');
    expect(Object.keys(sections).sort()).toEqual(hubIds);
    for (const value of Object.values(sections)) expect(value.trim()).not.toBe('');
  });

  it('has a one-line note for every hub, for the Home page', () => {
    const notes = names(locale, 'hubNotes');
    expect(Object.keys(notes).sort()).toEqual(hubIds);
    for (const value of Object.values(notes)) expect(value.trim()).not.toBe('');
  });

  it('has the same page-name overrides in both languages, none empty', () => {
    const labels = names(locale, 'labels');
    expect(Object.keys(labels).sort()).toEqual(Object.keys(names('en', 'labels')).sort());
    for (const value of Object.values(labels)) expect(value.trim()).not.toBe('');
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
