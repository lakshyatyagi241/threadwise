import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(__dirname, '..', '..', '..');
type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}
const load = (locale: string) =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, 'settings.json'), 'utf8')) as Tree;
const SRC = join(WEB, 'src', 'features', 'settings-hub');
const source = (name: string) => readFileSync(join(SRC, name), 'utf8');

describe('settings messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(flatten(load('ar')).sort()).toEqual(flatten(load('en')).sort());
  });

  it('has every key the Settings pages ask for', () => {
    const keys = new Set(flatten(load('en')));
    const used = [
      'title',
      'breadcrumb',
      'backToSettings',
      'sectionsLabel',
      'searchLabel',
      'searchPlaceholder',
      'searchHint',
      'clearSearch',
      'results.title',
      'results.status',
      'noResults.title',
      'noResults.message',
      'emptySection.title',
      'emptySection.message',
      'inSection',
      'soon',
      'upgrade',
      'comingSoon',
    ];
    expect(used.filter((k) => !keys.has(`settings.${k}`))).toEqual([]);
  });

  it('is asked for no key that does not exist (static t("...") calls in the hub)', () => {
    const keys = new Set(flatten(load('en')));
    const asked = new Set<string>();
    for (const file of [
      'settings-frame.tsx',
      'settings-back.tsx',
      'section-panel.tsx',
      'settings-search-box.tsx',
      'search-results.tsx',
      'tile-card.tsx',
    ]) {
      const scoped = /useTranslations\('settings'\)/.test(source(file));
      for (const m of source(file).matchAll(/\bt\('([a-zA-Z.]+)'/g)) {
        asked.add(m[1]!.startsWith('settings.') || !scoped ? m[1]! : `settings.${m[1]}`);
      }
    }
    expect([...asked].filter((k) => !keys.has(k))).toEqual([]);
  });

  it('keeps the shell keys the user menu needs', () => {
    for (const locale of ['en', 'ar']) {
      const shell = JSON.parse(
        readFileSync(join(WEB, 'messages', locale, 'shell.json'), 'utf8'),
      ) as Tree;
      const keys = new Set(flatten(shell));
      for (const k of ['shell.help', 'shell.settings', 'shell.soon', 'shell.comingSoon']) {
        expect(keys.has(k), `${locale} ${k}`).toBe(true);
      }
    }
  });

  it('keeps Arabic search words next to English product names (people type either)', () => {
    const ar = load('ar') as { settings: { tiles: Record<string, { keywords: string }> } };
    expect(ar.settings.tiles['chat-widget']!.keywords).toMatch(/web chat/);
    expect(ar.settings.tiles['whatsapp']!.keywords).toMatch(/whatsapp/);
  });
});
