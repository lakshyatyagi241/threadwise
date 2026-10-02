import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TYPES } from '@crm/contracts';

/**
 * The domain's strings live in messages/<locale>/notifications-activity-audit.json. These checks keep English and Arabic in
 * step and make sure no component asks for a key that is missing (next-intl would print the key path instead of text).
 */
const WEB = resolve(__dirname, '../../..');
const FILE = 'notifications-activity-audit.json';
const ROOT_KEY = 'notifications';

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

const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();

const en = flatten(load('en'));
const ar = flatten(load('ar'));

describe('notifications messages', () => {
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

  it('words every notification type the API can write, in both languages', () => {
    for (const type of NOTIFICATION_TYPES) {
      for (const part of ['title', 'body', 'bodyNoActor']) {
        expect(en[`${ROOT_KEY}.types.${type}.${part}`], `en ${type}.${part}`).toBeTypeOf('string');
        expect(ar[`${ROOT_KEY}.types.${type}.${part}`], `ar ${type}.${part}`).toBeTypeOf('string');
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

describe('message keys used in code', () => {
  it('exist in the English messages', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(join(WEB, 'src', 'features', 'notifications-activity-audit'))) {
      const source = readFileSync(file, 'utf8');
      if (!/useTranslations\('notifications'\)/.test(source)) continue;
      for (const m of source.matchAll(/\bt(?:\.has)?\(\s*'([^']+)'/g)) {
        const key = `${ROOT_KEY}.${m[1]}`;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
