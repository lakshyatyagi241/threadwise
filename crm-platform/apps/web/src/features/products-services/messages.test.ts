import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** English and Arabic keep the same keys and placeholders, and every key a component asks for exists. */
const WEB = resolve(__dirname, '../../..');
type Tree = { [key: string]: string | Tree };

const flat = (t: Tree, prefix = ''): Record<string, string> =>
  Object.entries(t).reduce<Record<string, string>>((out, [k, v]) => {
    if (typeof v === 'string') out[`${prefix}${k}`] = v;
    else Object.assign(out, flat(v, `${prefix}${k}.`));
    return out;
  }, {});

const load = (locale: string) =>
  flat(
    JSON.parse(
      readFileSync(join(WEB, 'messages', locale, 'products-services.json'), 'utf8'),
    ) as Tree,
  );
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('Products and services messages', () => {
  const en = load('en');
  const ar = load('ar');
  it('Arabic has every English key and no other', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });
  it('the placeholders match, and nothing is empty', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(placeholders(ar[k]!), k).toEqual(placeholders(v));
      expect(v.trim(), k).not.toBe('');
      expect(ar[k]!.trim(), k).not.toBe('');
    }
  });
  it('every key a component asks for exists', () => {
    const dir = join(WEB, 'src', 'features', 'products-services', 'components');
    const asked = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx') && !n.includes('test'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      const roots = [
        ...src.matchAll(/const (\w+) = useTranslations\('products-services([^']*)'\)/g),
      ];
      for (const [, name, sub] of roots) {
        const prefix = `products-services${sub}.`;
        for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g')))
          asked.add(`${prefix}${m[1]}`);
      }
    }
    expect(asked.size).toBeGreaterThan(20);
    expect([...asked].filter((k) => !(k in en))).toEqual([]);
  });
});
