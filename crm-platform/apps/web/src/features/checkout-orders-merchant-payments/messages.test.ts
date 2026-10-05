import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORE_ORDER_SOURCES, STORE_ORDER_STATUSES, STORE_PAYMENT_STATUSES } from '@crm/contracts';
import { ERROR_KINDS } from './lib/errors';
import { nav } from './nav';
import { settings } from './settings';

/**
 * The merchant screens' strings live in messages/<locale>/checkout-orders-merchant-payments*.json (one file per screen, merged by the
 * loader under one root key). These checks keep English and Arabic in step and make sure no component asks for a key that is missing
 * (next-intl would print the key path instead of text).
 */
const WEB = resolve(__dirname, '../../..');
const PREFIX = 'checkout-orders-merchant-payments';
const ROOT_KEY = PREFIX;

type Tree = { [key: string]: string | Tree };

function loadAll(locale: string): Record<string, string> {
  const dir = join(WEB, 'messages', locale);
  const out: Record<string, string> = {};
  for (const file of readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.json'))
    .sort()) {
    Object.assign(out, flatten(JSON.parse(readFileSync(join(dir, file), 'utf8')) as Tree));
  }
  return out;
}

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

const en = loadAll('en');
const ar = loadAll('ar');

describe('checkout-orders-merchant-payments messages', () => {
  it('has one file per language for every screen file', () => {
    const files = (l: string) =>
      readdirSync(join(WEB, 'messages', l)).filter((f) => f.startsWith(PREFIX));
    expect(files('ar').sort()).toEqual(files('en').sort());
  });

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

  it('has a status, payment and source label for every value the contract names', () => {
    const missing = [
      ...STORE_ORDER_STATUSES.map((s) => `${ROOT_KEY}.status.${s}`),
      ...STORE_PAYMENT_STATUSES.map((s) => `${ROOT_KEY}.paymentStatus.${s}`),
      ...STORE_ORDER_SOURCES.map((s) => `${ROOT_KEY}.source.${s}`),
      ...ERROR_KINDS.flatMap((k) => [
        `${ROOT_KEY}.errors.${k}.title`,
        `${ROOT_KEY}.errors.${k}.message`,
      ]),
    ].filter((k) => !(k in en) || !(k in ar));
    expect(missing).toEqual([]);
  });

  it('the menu entries and the Settings tile point at existing labels', () => {
    expect(nav.map((n) => n.id)).toEqual(['store-orders', 'store-coupons']);
    for (const item of nav) expect(item.labelKey in en, item.labelKey).toBe(true);
    for (const tile of settings) {
      for (const key of [tile.labelKey, tile.descriptionKey, tile.keywordsKey]) {
        expect(key! in en && key! in ar, key).toBe(true);
      }
    }
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
  const files = sourceFiles(join(WEB, 'src', 'features', PREFIX));

  it('exist in the English and Arabic messages', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        if (!(key in en) || !(key in ar)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('are all used somewhere (no dead strings)', () => {
    const used = new Set<string>();
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(en).filter((key) => {
      if (used.has(key)) return false;
      // read by the menu / the Settings tile / built from a status value at run time
      if (key.startsWith(`${ROOT_KEY}.nav.`) || key.startsWith(`${ROOT_KEY}.settingsTile.`))
        return false;
      if (/^checkout-orders-merchant-payments\.(status|paymentStatus|source|errors|coupons\.states)\./.test(key))
        return false;
      // keys built from a template or a ternary: accept when the last segment appears in the source
      const last = key.split('.').at(-1)!;
      return !new RegExp(`['"\`.]${last}['"\`.\\s)]`).test(text);
    });
    expect(unused).toEqual([]);
  });
});
