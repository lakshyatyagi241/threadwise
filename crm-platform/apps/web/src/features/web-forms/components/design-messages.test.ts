import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [key: string]: string | Tree };

const root = join(process.cwd(), 'messages');
const load = (locale: string): Tree =>
  JSON.parse(readFileSync(join(root, locale, 'web-forms.design.json'), 'utf8')) as Tree;

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

const values = (t: Tree): string[] =>
  Object.values(t).flatMap((v) => (typeof v === 'string' ? [v] : values(v)));

const en = load('en');
const ar = load('ar');
const design = (en['web-forms'] as Tree).design as Tree;
const COMPONENTS = ['design-tab.tsx', 'design-color-field.tsx', 'preview-frame.tsx'];

describe('Design tab messages', () => {
  it('English and Arabic have the same keys', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });

  it('has no empty string', () => {
    for (const v of [...values(en), ...values(ar)]) expect(v.trim().length).toBeGreaterThan(0);
  });

  it('every key the components ask for exists in English', () => {
    const have = new Set(keys(design));
    const used = new Set<string>();
    for (const file of COMPONENTS) {
      const src = readFileSync(
        join(process.cwd(), 'src/features/web-forms/components', file),
        'utf8',
      );
      for (const m of src.matchAll(/\bt(?:\.rich)?\(\s*'([^']+)'/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(40);
    expect([...used].filter((k) => !have.has(k))).toEqual([]);
  });
});
