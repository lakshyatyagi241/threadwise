import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_KINDS } from './lib/errors';
import { BUCKETS, RANGES } from './lib/format';

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../../..');
const FILE = 'coupons-credits-referral-currency.affiliate.json';

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const load = (lang: string) =>
  flatten(JSON.parse(readFileSync(join(WEB, 'messages', lang, FILE), 'utf8')) as Tree);
const en = load('en');
const ar = load('ar');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

const FILES = [
  ...sources(__dirname),
  ...sources(join(WEB, 'src', 'app', '(app)', '(coupons-credits-referral-currency)', 'account')),
  ...sources(
    join(WEB, 'src', 'app', '(app)', '(coupons-credits-referral-currency)', 'affiliate-history'),
  ),
];
const NS = 'coupons-credits-referral-currency.affiliate';

describe('affiliate messages', () => {
  it('every literal key a component or route asks for exists in English and Arabic', () => {
    const missing: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, 'utf8');
      const decls = [
        ...src.matchAll(
          /const\s+(\w+)\s*=\s*(?:await\s+getTranslations|useTranslations)\(\s*'([^']+)'\s*\)/g,
        ),
      ];
      for (const name of new Set(decls.map((d) => d[1]))) {
        const own = decls.filter((d) => d[1] === name);
        for (const c of src.matchAll(
          new RegExp(`(?<![\\w.])${name}(?:\\.rich)?\\(\\s*'([^']+)'`, 'g'),
        )) {
          const decl = own.filter((d) => d.index! < c.index!).pop();
          if (!decl) continue;
          const key = `${decl[2]}.${c[1]}`;
          for (const [lang, dict] of [
            ['en', en],
            ['ar', ar],
          ] as const)
            if (!(key in dict)) missing.push(`${lang} ${file}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('has the messages the dynamic lookups reach', () => {
    const want: string[] = [];
    for (const r of RANGES) want.push(`history.range.${r}`);
    for (const b of BUCKETS) want.push(`chart.bucket.${b}`);
    for (const k of ERROR_KINDS) want.push(`errors.${k}`);
    for (const k of ['copied', 'copiedClipboard', 'copyFailed']) want.push(`toast.${k}`);
    for (const k of ['paid', 'noPayout']) want.push(`table.status.${k}`);
    want.push('nav.pane');
    for (const dict of [en, ar]) expect(want.filter((k) => !dict[`${NS}.${k}`])).toEqual([]);
  });

  it('Arabic has exactly the English keys, every message non-empty, with the same placeholders', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    const holes = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const [k, v] of Object.entries(en)) {
      expect(ar[k]!.trim(), k).not.toBe('');
      expect(holes(ar[k]!), k).toEqual(holes(v));
    }
  });
});
