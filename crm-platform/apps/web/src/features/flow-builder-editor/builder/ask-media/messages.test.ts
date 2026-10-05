import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every `flb.builder.askMedia.*` key the new components ask for exists in the English file, and Arabic has the same keys. */
type Tree = { [k: string]: string | Tree };
const load = (loc: string): Tree =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages', loc, 'flow-builder-editor.json'), 'utf8'),
  );
const leaves = (t: Tree, prefix = ''): string[] =>
  Object.entries(t).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`),
  );
const has = (t: Tree, path: string): boolean =>
  path
    .split('.')
    .reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Tree)[k] : undefined), t) !==
  undefined;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory()
      ? walk(p)
      : /\.(tsx|ts)$/.test(f) && !/\.test\./.test(f)
        ? [p]
        : [];
  });

describe('askMedia messages', () => {
  const en = (load('en').flb as Tree).builder as Tree;
  const ar = (load('ar').flb as Tree).builder as Tree;
  const root = join(process.cwd(), 'src/features/flow-builder-editor/builder');
  // A key counts when it exists under at least one of the namespaces its file opens (two hooks may share the name `t`).
  const used: Array<{ file: string; key: string; prefixes: string[] }> = [];
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const ns = [
      ...src.matchAll(/const (\w+) = useTranslations\('flb\.builder\.askMedia(?:\.([\w.]+))?'\)/g),
    ];
    const prefixesOf = (name: string) =>
      ns.filter((m) => m[1] === name).map((m) => (m[2] ? `askMedia.${m[2]}.` : 'askMedia.'));
    for (const name of new Set(ns.map((m) => m[1]!))) {
      for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([\\w.]+)'`, 'g')))
        used.push({ file, key: m[1]!, prefixes: prefixesOf(name) });
    }
  }
  it('finds the keys', () => expect(used.length).toBeGreaterThan(20));
  it('every static key exists in English and Arabic', () => {
    for (const u of used) {
      expect(
        u.prefixes.some((p) => has(en, `${p}${u.key}`)),
        `en ${u.key} (${u.file})`,
      ).toBe(true);
      expect(
        u.prefixes.some((p) => has(ar, `${p}${u.key}`)),
        `ar ${u.key} (${u.file})`,
      ).toBe(true);
    }
  });
  it('the dynamic groups exist: extension groups, toolbar marks, sample files, sample locations', () => {
    for (const k of [
      'extensions.group.images',
      'extensions.group.audio',
      'extensions.group.video',
      'extensions.group.documents',
      'toolbar.bold',
      'toolbar.italic',
      'toolbar.strike',
      'toolbar.mono',
      'test.file.photo',
      'test.file.png',
      'test.file.pdf',
      'test.file.voice',
      'test.file.exe',
      'test.location.pin',
      'test.location.bare',
    ])
      expect(has(en, `askMedia.${k}`), k).toBe(true);
  });
  it('Arabic has exactly the English keys', () => {
    const a = leaves((en as Tree).askMedia as Tree).sort();
    const b = leaves((ar as Tree).askMedia as Tree).sort();
    expect(b).toEqual(a);
  });
});
