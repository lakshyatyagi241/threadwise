import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  API_LIBRARY_LOG_SOURCES,
  API_LIBRARY_VARIABLE_SOURCES,
  API_LIBRARY_ERROR_KINDS,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';

/**
 * The domain's strings live in messages/en/api-library.json. next-intl prints the key path when a key is missing, so these checks
 * make sure no component asks for a key that is not there, no string is dead, and everything built at run time exists.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'api-library';

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
  JSON.parse(readFileSync(join(WEB, 'messages', 'en', 'api-library.json'), 'utf8')) as Tree,
);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

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
      const owner = [...decls].reverse().find((d) => d.name === name && d.index < (c.index ?? 0));
      if (owner) out.push(`${owner.ns}.${c[1]}`);
    }
  }
  return out;
}

const DYNAMIC = [
  `${ROOT}.common.source.`,
  `${ROOT}.common.errorKind.`,
  `${ROOT}.errors.`,
  `${ROOT}.test.hint.`,
  `${ROOT}.form.variables.source.`,
  `${ROOT}.nav.`,
  `${ROOT}.list.col.`,
  `${ROOT}.logs.col.`,
];

const files = [
  ...sourceFiles(join(WEB, 'src', 'features', 'api-library')),
  ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(api-library)')),
];

describe('api-library messages', () => {
  it('every message is non-empty and sits under the domain root', () => {
    for (const [key, text] of Object.entries(en)) {
      expect(text.trim(), key).not.toBe('');
      expect(key.startsWith(`${ROOT}.`), key).toBe(true);
    }
  });

  it('every key the code asks for exists', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files)
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    expect(checked).toBeGreaterThan(150);
    expect(missing).toEqual([]);
  });

  it('every key built at run time exists', () => {
    const dynamic = [
      ...API_LIBRARY_LOG_SOURCES.map((s) => `common.source.${s}`),
      ...API_LIBRARY_ERROR_KINDS.map((k) => `common.errorKind.${k}`),
      ...API_LIBRARY_ERROR_KINDS.map((k) => `test.hint.${k}`),
      ...API_LIBRARY_VARIABLE_SOURCES.map((s) => `form.variables.source.${s}`),
      ...(
        [
          'network',
          'forbidden',
          'notFound',
          'conflict',
          'nameTaken',
          'inUse',
          'limit',
          'validation',
          'rateLimited',
          'unexpected',
        ] as const
      ).map((k) => `errors.${k}`),
      'nav.apiLibrary',
    ];
    expect(dynamic.filter((k) => !(`${ROOT}.${k}` in en))).toEqual([]);
  });

  it('has no dead strings', () => {
    const used = new Set<string>();
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    const unused = Object.keys(en).filter(
      (k) => !used.has(k) && !DYNAMIC.some((p) => k.startsWith(p)),
    );
    expect(unused).toEqual([]);
  });
});
