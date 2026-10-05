import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV } from '@/features/_registry/nav.generated';
import { PLANNED_NAV } from '@/features/_registry/planned';
import { PLANNED_SETTINGS } from '@/features/_registry/settings-planned';
import { SETTINGS } from '@/features/_registry/settings.generated';
import { SETTINGS_SECTIONS } from '@/features/_registry/settings-types';
import { deepMerge } from '@/i18n/messages';
import { hasSettingsIcon } from './settings-icons';

const WEB = join(__dirname, '..', '..', '..');
type Tree = { [key: string]: string | Tree };
const messages = (locale: string): Tree => {
  const dir = join(WEB, 'messages', locale);
  let out: Tree = {};
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    out = deepMerge(out, JSON.parse(readFileSync(join(dir, f), 'utf8')) as Tree);
  }
  return out;
};
const lookup = (tree: Tree, path: string): string | Tree | undefined => {
  let cur: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
};

/** Every page route of the app, as path segments with route groups removed ("(app)" does not appear in an address). */
function routes(): string[][] {
  const out: string[][] = [];
  const walk = (dir: string, segs: string[]) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        walk(join(dir, e.name), /^\(.*\)$/.test(e.name) ? segs : [...segs, e.name]);
      } else if (e.name === 'page.tsx') out.push(segs);
    }
  };
  walk(join(WEB, 'src', 'app'), []);
  return out;
}
function isRoute(href: string, all: string[][]): boolean {
  const parts = href.split('/').filter(Boolean);
  return all.some((route) => {
    for (let i = 0; i < route.length; i++) {
      const r = route[i]!;
      if (r.startsWith('[...') || r.startsWith('[[...')) return parts.length > i;
      if (parts[i] === undefined) return false;
      if (!(r.startsWith('[') && r.endsWith(']')) && r !== parts[i]) return false;
    }
    return route.length === parts.length;
  });
}

const real = SETTINGS;
const all = [...SETTINGS, ...PLANNED_SETTINGS];

describe('the Settings registry', () => {
  it('has unique ids across built and planned tiles', () => {
    const ids = all.map((t) => t.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('uses a known section, an absolute address and a drawn icon on every tile', () => {
    for (const t of all) {
      expect(SETTINGS_SECTIONS as readonly string[], t.id).toContain(t.section);
      expect(t.href.startsWith('/'), t.id).toBe(true);
      expect(hasSettingsIcon(t.icon), `${t.id} icon ${t.icon}`).toBe(true);
    }
  });

  it('points every built tile at a real workspace page, never the platform console', () => {
    const pages = routes();
    for (const t of real) {
      expect(isRoute(t.href, pages), `${t.id} -> ${t.href}`).toBe(true);
      expect(t.href.startsWith('/admin'), t.id).toBe(false);
    }
  });

  it('keeps a planned tile planned only while its page does not exist', () => {
    const pages = routes();
    for (const t of PLANNED_SETTINGS)
      expect(isRoute(t.href, pages), `${t.id} now exists: declare it`).toBe(false);
  });

  it('gives no section the address of a screen under /settings (the screen would shadow the section page)', () => {
    const shadowed = routes().filter(
      (r) =>
        r[0] === 'settings' &&
        r.length > 1 &&
        (SETTINGS_SECTIONS as readonly string[]).includes(r[1]!),
    );
    expect(shadowed).toEqual([]);
  });

  it('has a section for every id and tiles in most of them', () => {
    const used = new Set(all.map((t) => t.section));
    for (const s of SETTINGS_SECTIONS) expect(used.has(s), s).toBe(true);
  });

  it('has a label, a help line and keywords in English and Arabic for every tile', () => {
    for (const locale of ['en', 'ar']) {
      const tree = messages(locale);
      for (const t of all) {
        for (const key of [t.labelKey, t.descriptionKey, t.keywordsKey]) {
          expect(typeof lookup(tree, key!), `${locale} ${t.id} ${key}`).toBe('string');
        }
      }
      for (const s of SETTINGS_SECTIONS) {
        expect(typeof lookup(tree, `settings.sections.${s}.title`), `${locale} ${s}`).toBe(
          'string',
        );
        expect(typeof lookup(tree, `settings.sections.${s}.description`), `${locale} ${s}`).toBe(
          'string',
        );
      }
    }
  });

  it('declares each tile in its own domain, never a menu entry too (a screen moved, it did not copy)', () => {
    const settingHrefs = new Set(real.map((t) => t.href));
    for (const item of [...NAV, ...PLANNED_NAV]) {
      expect(settingHrefs.has(item.href), `${item.id} is both a menu entry and a tile`).toBe(false);
    }
  });
});
