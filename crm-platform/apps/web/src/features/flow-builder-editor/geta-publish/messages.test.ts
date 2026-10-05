import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The Geta publishing strings: English and Arabic carry the same keys, and every static key a component asks for exists. */
type Tree = { [k: string]: string | Tree };
const load = (loc: string): Tree =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', loc, 'flow-builder-editor.geta.json'), 'utf8'),
  );
const leaves = (t: Tree, prefix = ''): string[] =>
  Object.entries(t).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`),
  );

const SRC = join(process.cwd(), 'src/features/flow-builder-editor/geta-publish');
const sources = readdirSync(SRC).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));

describe('flb.geta messages', () => {
  const en = leaves(load('en'));
  const ar = leaves(load('ar'));

  it('Arabic has exactly the keys English has', () => {
    expect([...ar].sort()).toEqual([...en].sort());
  });

  it('no text is empty', () => {
    for (const loc of ['en', 'ar']) {
      for (const k of leaves(load(loc))) {
        const v = k.split('.').reduce<unknown>((n, p) => (n as Tree)[p], load(loc));
        expect(String(v).trim(), `${loc} ${k}`).not.toBe('');
      }
    }
  });

  it('every static key a component asks for exists (under its useTranslations namespace)', () => {
    const keys = new Set(en);
    let found = 0;
    for (const file of sources) {
      const src = readFileSync(join(SRC, file), 'utf8');
      const ns = [...src.matchAll(/const (\w+) = useTranslations\('([\w.]+)'\)/g)];
      for (const m of ns) {
        for (const call of src.matchAll(new RegExp(`\\b${m[1]}\\(\\s*'([\\w.]+)'`, 'g'))) {
          found++;
          expect(keys.has(`${m[2]}.${call[1]}`), `${file}: ${m[2]}.${call[1]}`).toBe(true);
        }
      }
    }
    expect(found).toBeGreaterThan(40);
  });

  it('the settings tile has words in both languages', () => {
    for (const loc of ['en', 'ar']) {
      const s = JSON.parse(
        readFileSync(join(process.cwd(), 'messages', loc, 'settings.json'), 'utf8'),
      ) as { settings: { tiles: Record<string, Record<string, string>> } };
      const tile = s.settings.tiles['geta-publishing']!;
      expect(Object.keys(tile).sort()).toEqual(['description', 'keywords', 'label']);
    }
  });

  it('keeps the source folder free of stray files (a guard for the walk above)', () => {
    expect(statSync(SRC).isDirectory()).toBe(true);
    expect(sources).toContain('settings-screen.tsx');
  });
});
