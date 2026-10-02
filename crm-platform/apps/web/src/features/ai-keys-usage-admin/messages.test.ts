import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AI_USAGE_WINDOWS } from '@crm/contracts';
import { nav } from './nav';
import type { ErrorKind } from './lib/errors';

/**
 * The domain's strings live in messages/<locale>/ai-keys-usage-admin.json. These checks make sure no component asks for
 * a key that is missing (next-intl would print the key path instead of text) and that the placeholders are well formed.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT_KEY = 'ai-keys-usage-admin';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

const en = flatten(
  JSON.parse(readFileSync(join(WEB, 'messages', 'en', `${ROOT_KEY}.json`), 'utf8')) as Tree,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Literal `t('key')` calls, paired with the namespace of the nearest preceding `useTranslations`/`getTranslations`. */
function usedKeys(source: string): string[] {
  const decls = [
    ...source.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:'([^']+)'|(NS)|`\$\{NS\}\.([\w.]+)`)\s*\)/g,
    ),
  ].map((m) => ({ name: m[1]!, ns: m[2] ?? (m[3] ? '$NS' : `$NS.${m[4]}`), index: m.index ?? 0 }));
  const nsConst = /const NS = '([^']+)'/.exec(source)?.[1];
  const out: string[] = [];
  for (const name of new Set(decls.map((d) => d.name))) {
    const call = new RegExp(`\\b${name}(?:\\.rich|\\.has)?\\(\\s*'([^']+)'`, 'g');
    for (const c of source.matchAll(call)) {
      const at = c.index ?? 0;
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < at);
      if (owner && (nsConst || !owner.ns.startsWith('$NS'))) {
        out.push(`${owner.ns.replace('$NS', nsConst ?? '')}.${c[1]}`);
      }
    }
  }
  return out;
}

describe('ai-keys-usage-admin messages', () => {
  it('keeps every key under the domain root and every message non-empty', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(key.startsWith(`${ROOT_KEY}.`), key).toBe(true);
      expect(text.trim(), key).not.toBe('');
    }
  });

  it('exist for every literal key the code asks for', () => {
    const files = [
      ...sourceFiles(join(WEB, 'src', 'features', ROOT_KEY)),
      ...sourceFiles(join(WEB, 'src', 'app', '(app)', `(${ROOT_KEY})`)),
      ...sourceFiles(join(WEB, 'src', 'app', '(admin)', `(${ROOT_KEY})`)),
    ];
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

  it('exist for the keys built at run time', () => {
    const kinds: ErrorKind[] = [
      'forbidden',
      'conflict',
      'keyRequired',
      'validation',
      'notFound',
      'network',
      'request',
      'unexpected',
    ];
    const dynamic = [
      ...kinds.map((k) => `${ROOT_KEY}.common.errors.${k}`),
      ...AI_USAGE_WINDOWS.map((w) => `${ROOT_KEY}.windows.${w}`),
      `${ROOT_KEY}.keys.groups.llm`,
      `${ROOT_KEY}.keys.groups.voice`,
      ...nav.map((n) => n.labelKey),
      `${ROOT_KEY}.admin.nav.group`,
      `${ROOT_KEY}.admin.nav.keys`,
      `${ROOT_KEY}.admin.nav.dashboard`,
    ];
    expect(dynamic.filter((k) => !(k in en))).toEqual([]);
  });
});
