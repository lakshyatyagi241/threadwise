import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareCatalog, flatten, inspectCatalog, usedKeys, type Tree } from './catalog-tools';

describe('flatten and compareCatalog', () => {
  const en: Tree = { a: { one: 'One', two: 'Two' }, b: 'B' };

  it('lists missing, extra and identical keys, and the coverage', () => {
    const ar: Tree = { a: { one: 'واحد', two: 'Two', old: 'x' } };
    const r = compareCatalog(en, ar);
    expect(r.missing).toEqual(['b']);
    expect(r.extra).toEqual(['a.old']);
    expect(r.untranslated).toEqual(['a.two']);
    expect(r.coverage).toBeCloseTo(1 / 3);
  });

  it('flattens to dotted keys', () =>
    expect(flatten(en)).toEqual({ 'a.one': 'One', 'a.two': 'Two', b: 'B' }));
});

describe('usedKeys', () => {
  it('resolves the namespace constant, ternaries, templates and second translators', () => {
    const src = `
      const NS = 'dom.page';
      const t = useTranslations(NS);
      const te = useTranslations('dom.errors');
      t('title');
      t(on ? 'flash.a' : 'flash.b', { name: 'literal' });
      t(\`steps.\${n}.title\`);
      t.rich('long', { b: (c) => c });
      te('boom');
    `;
    const u = usedKeys(src);
    expect([...u.keys].sort()).toEqual([
      'dom.errors.boom',
      'dom.page.flash.a',
      'dom.page.flash.b',
      'dom.page.long',
      'dom.page.title',
    ]);
    expect([...u.prefixes]).toEqual(['dom.page.steps.']);
  });
});

describe('inspectCatalog', () => {
  const en: Tree = { dom: { a: 'A', b: 'B', nav: { x: 'X' }, steps: { 1: 'one' } } };

  it('reports a key the code asks for that English lacks, and English keys nobody asks for', () => {
    const src = [
      `const t = useTranslations('dom'); t('a'); t('typo'); t(\`steps.\${n}\`);`,
      `{ labelKey: 'dom.nav.x' }`,
    ];
    const r = inspectCatalog(en, src, 'dom');
    expect(r.missing).toEqual(['dom.typo']);
    expect(r.obsolete).toEqual(['dom.b']);
  });
});

/** The real files: this domain's screens ask only for keys English has, and English has no dead copy. */
describe('localization-translation catalog', () => {
  const root = resolve(__dirname, '../../..');
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  const en = JSON.parse(read('messages/en/localization-translation.json')) as Tree;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (
        /\.(ts|tsx)$/.test(e.name) &&
        !/\.test\./.test(e.name) &&
        e.name !== 'catalog-tools.ts'
      )
        files.push(p);
    }
  };
  walk('src/features/localization-translation');
  const sources = [
    ...files.map(read),
    read('src/features/auth-registration-security/platform/operator-nav.ts'),
  ];

  it('has every key the screens ask for', () => {
    expect(inspectCatalog(en, sources, 'localization-translation').missing).toEqual([]);
  });

  it('has no key nobody asks for', () => {
    expect(
      inspectCatalog(en, sources, 'localization-translation', ['localization-translation.errors.'])
        .obsolete,
    ).toEqual([]);
  });

  it('keeps the Arabic catalog in step with English (same keys, same placeholders)', () => {
    const ar = JSON.parse(read('messages/ar/localization-translation.json')) as Tree;
    const r = compareCatalog(en, ar);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    const a = flatten(en);
    const b = flatten(ar);
    const tokens = (s: string) => [...s.matchAll(/\{\w+\}|<\/?\w+>/g)].map((m) => m[0]).sort();
    for (const k of Object.keys(a)) expect(tokens(b[k]!), k).toEqual(tokens(a[k]!));
  });
});
