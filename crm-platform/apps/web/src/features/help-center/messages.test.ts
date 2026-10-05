import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_AREAS } from './types';

const WEB = join(__dirname, '..', '..', '..');
type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`),
  );
}
const load = (locale: string) =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, 'help-center.json'), 'utf8')) as Tree;

describe('help center messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(flatten(load('ar')).sort()).toEqual(flatten(load('en')).sort());
  });

  it('names every help area', () => {
    const keys = new Set(flatten(load('en')));
    expect(HELP_AREAS.filter((a) => !keys.has(`help.areas.${a}`))).toEqual([]);
  });

  it('is asked for no key that does not exist (static t("...") calls in the components)', () => {
    const keys = new Set(flatten(load('en')));
    const shell = new Set(
      flatten(JSON.parse(readFileSync(join(WEB, 'messages', 'en', 'shell.json'), 'utf8')) as Tree),
    );
    const dir = join(__dirname);
    const asked = new Set<string>();
    for (const file of readdirSync(dir).filter(
      (f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'),
    )) {
      const source = readFileSync(join(dir, file), 'utf8');
      const scoped = /useTranslations\('help'\)/.test(source);
      for (const m of source.matchAll(/\bt\('([a-zA-Z.]+)'/g)) {
        const key = m[1]!;
        asked.add(
          key.startsWith('help.') || key.startsWith('shell.') || !scoped ? key : `help.${key}`,
        );
      }
    }
    expect([...asked].filter((k) => !keys.has(k) && !shell.has(k))).toEqual([]);
  });
});
