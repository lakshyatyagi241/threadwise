import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAYMENT_PROVIDERS } from '@crm/contracts';
import { ERROR_KINDS } from './lib/errors';
import { MAIN_ENTRIES, SETTINGS_ENTRIES } from './lib/sidebar';
import { nav } from '../nav';

/**
 * The admin screens' strings live in messages/<locale>/storefront-builder.json (the public shop has its own file).
 * These checks keep English and Arabic in step and make sure no component asks for a key that is missing (next-intl would
 * print the key path instead of text).
 */
const WEB = resolve(__dirname, '../../../..');
const FILE = 'storefront-builder.json';
const ROOT_KEY = 'storefront-builder';

type Tree = { [key: string]: string | Tree };
const load = (locale: string): Tree =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, FILE), 'utf8')) as Tree;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** `{name}` and `{count, plural, ...}` placeholders, by variable name. */
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();

const en = flatten(load('en'));
const ar = flatten(load('ar'));

describe('storefront-builder admin messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('every message is non-empty and uses the same placeholders in both languages', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe('');
      expect(ar[key]?.trim(), key).not.toBe('');
      expect(placeholders(ar[key]!), `placeholders of ${key}`).toEqual(placeholders(text));
    }
  });

  it('Arabic plurals spell out the categories the language needs', () => {
    for (const [key, text] of Object.entries(ar)) {
      if (!text.includes('plural,')) continue;
      for (const cat of ['one', 'two', 'few', 'many', 'other']) {
        expect(text, `${key} lacks ${cat}`).toContain(`${cat} {`);
      }
    }
  });

  it('keeps every key under the domain root', () => {
    for (const key of Object.keys(en)) expect(key.startsWith(`${ROOT_KEY}.`), key).toBe(true);
  });

  it('the menu entry points at an existing label', () => {
    expect(nav.map((n) => n.id)).toEqual(['store']);
    for (const item of nav) expect(item.labelKey in en, item.labelKey).toBe(true);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Literal `t('key')`, `t.rich('key')`, `t.has('key')`, paired with the namespace of the nearest preceding declaration. */
function usedKeys(source: string): string[] {
  const decls = [
    ...source.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']+)'\s*\)/g,
    ),
  ].map((m) => ({ name: m[1]!, ns: m[2]!, index: m.index ?? 0 }));
  const out: string[] = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich|\\.has)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const at = c.index ?? 0;
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < at);
      if (owner) out.push(`${owner.ns}.${c[1]}`);
    }
  }
  return out;
}

describe('message keys used in code', () => {
  const files = [
    ...sourceFiles(join(WEB, 'src', 'features', 'storefront-builder', 'admin')),
    ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(storefront-builder)')),
  ];

  it('exist in the English messages', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  const A = 'admin';
  const dynamicKeys = () =>
    [
      ...ERROR_KINDS.flatMap((s) => [`${A}.errors.${s}.title`, `${A}.errors.${s}.message`]),
      ...[...MAIN_ENTRIES, ...SETTINGS_ENTRIES].map((e) => `${A}.sidebar.items.${e.key}`),
      ...['none', ...PAYMENT_PROVIDERS].map((p) => `${A}.settings.payment.providers.${p}`),
      ...(
        [
          'required',
          'tooLong',
          'slugPattern',
          'domainInvalid',
          'urlInvalid',
          'colorInvalid',
          'amountInvalid',
          'amountTooBig',
          'delayRange',
          'themeInvalid',
          'currencyInvalid',
          'providerInvalid',
        ] as const
      ).map((p) => `${A}.settings.problems.${p}`),
      ...(['nameRequired', 'nameTooLong', 'domainInvalid', 'domainTooLong'] as const).map(
        (p) => `${A}.wizard.form.problems.${p}`,
      ),
      ...(['details', 'url', 'device'] as const).map((p) => `${A}.wizard.form.steps.${p}`),
      ...(['created', 'updated'] as const).map((p) => `${A}.wizard.form.${p}`),
    ].map((k) => `${ROOT_KEY}.${k}`);

  it('exist for the keys built at run time', () => {
    expect(dynamicKeys().filter((k) => !(k in en))).toEqual([]);
  });

  it('are all used somewhere (no dead strings)', () => {
    const used = new Set<string>();
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    for (const key of dynamicKeys()) used.add(key);
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(en).filter((key) => {
      if (used.has(key)) return false;
      if (key === `${ROOT_KEY}.nav.store`) return false; // read by the menu through nav.ts
      // keys built from a template or a ternary: accept when the last segment appears in the source
      const last = key.split('.').at(-1)!;
      return !new RegExp(`['"\`.]${last}['"\`.\\s)]`).test(text);
    });
    expect(unused).toEqual([]);
  });
});
