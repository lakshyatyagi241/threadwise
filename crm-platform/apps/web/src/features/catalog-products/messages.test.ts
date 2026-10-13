import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATALOG_PROVIDERS, PRODUCT_CURRENCIES } from '@crm/contracts';
import { ERROR_KINDS } from './lib/errors';
import { PROBLEM_KEYS, STATUS_OPTIONS } from './lib/product-form';
import { OPTION_NAME_SUGGESTIONS, PRESET_KEYS, VARIANT_PROBLEM_KEYS } from './lib/variants-model';
import { SYNC_STATUSES } from './lib/format';
import { RECIPIENT_MODES } from './lib/send-model';
import { REVIEW_TABS } from './lib/pages';
import { CATALOG_TABS } from './lib/tabs';

/**
 * The domain's strings live in messages/<locale>/catalog-products.json. These checks keep English and Arabic in step and make
 * sure no component asks for a key that is missing (next-intl would print the key path instead of text).
 */
const WEB = resolve(__dirname, '../../..');
const FILE = 'catalog-products.json';
const ROOT_KEY = 'catalogProducts';

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

/** `{name}` and `{count, plural, ...}` placeholders, by variable name; rich-text tags too. */
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();
const tags = (message: string) =>
  [...new Set([...message.matchAll(/<(\w+)>/g)].map((m) => m[1]!))].sort();

const en = flatten(load('en'));
const ar = flatten(load('ar'));

describe('catalog-products messages', () => {
  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('every message is non-empty and uses the same placeholders and tags in both languages', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe('');
      expect(ar[key]?.trim(), key).not.toBe('');
      expect(placeholders(ar[key]!), `placeholders of ${key}`).toEqual(placeholders(text));
      expect(tags(ar[key]!), `tags of ${key}`).toEqual(tags(text));
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
    ...sourceFiles(join(WEB, 'src', 'features', 'catalog-products')),
    ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(catalog-products)')),
    ...sourceFiles(join(WEB, 'src', 'app', '(admin)', '(catalog-products)')),
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
    expect(checked).toBeGreaterThan(150);
    expect(missing).toEqual([]);
  });

  it('exist for the keys built at run time', () => {
    const R = `${ROOT_KEY}.`;
    const dynamic = [
      ...ERROR_KINDS.map((s) => `errors.${s}`),
      ...CATALOG_TABS.map((t) => `shell.tab.${t.id}`),
      ...SYNC_STATUSES.map((s) => `status.${s}`),
      ...CATALOG_PROVIDERS.map((p) => `connect.providers.${p}`),
      ...(['required', 'tooShort', 'tooLong'] as const).map((p) => `connect.problem.${p}`),
      ...(['badUrl', 'tooLong', 'range'] as const).map((p) => `automation.problem.${p}`),
      ...(['idle', 'busy', 'queued', 'skipped', 'failed'] as const).map(
        (s) => `setup.table.sync.${s}`,
      ),
      ...(['noImage', 'noPrice', 'syncError'] as const).map((s) => `health.${s}`),
      ...RECIPIENT_MODES.flatMap((m) => [
        `send.recipients.modes.${m}.title`,
        `send.recipients.modes.${m}.hint`,
      ]),
      ...(['spm', 'mpm', 'link'] as const).flatMap((m) => [
        `send.format.${m}.title`,
        `send.format.${m}.hint`,
        `send.rail.formats.${m}`,
      ]),
      ...(['sendProduct', 'sendCarousel', 'sendLink'] as const).map((s) => `send.message.${s}`),
      ...(['nameRequired', 'nameTooLong', 'descriptionTooLong', 'noProducts'] as const).map(
        (s) => `collections.form.problem.${s}`,
      ),
      ...PROBLEM_KEYS.map((s) => `form.problem.${s}`),
      ...STATUS_OPTIONS.map((s) => `form.status.${s}`),
      ...VARIANT_PROBLEM_KEYS.map((s) => `form.variants.problem.${s}`),
      ...PRESET_KEYS.map((s) => `form.variants.preset.${s}`),
      ...OPTION_NAME_SUGGESTIONS.map((s) => `form.variants.suggest.${s}`),
      ...(['tooLong', 'dup', 'tooMany'] as const).map((s) => `form.variants.refused.${s}`),
      ...REVIEW_TABS.flatMap((s) => [`reviews.tab.${s}`, `reviews.empty.${s}`]),
      'reviews.approved',
      'reviews.rejected',
    ].map((k) => `${R}${k}`);
    const missing = dynamic.filter((k) => !(k in en));
    expect(missing).toEqual([]);
    // every currency the form offers is labelled in code, not in messages
    expect(PRODUCT_CURRENCIES.length).toBe(21);
  });

  it('are all used somewhere (no dead strings)', () => {
    const used = new Set<string>();
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(en).filter((key) => {
      if (used.has(key)) return false;
      // keys built from a template or a ternary: accept when the last segment appears in the source
      const last = key.split('.').at(-1)!;
      return !new RegExp(`['"\`.]${last}['"\`.\\s)]`).test(text);
    });
    expect(unused).toEqual([]);
  });
});
