import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SEGMENT_BUILTIN_FIELDS, SEGMENT_INVALID_REASONS, SEGMENT_OPERATORS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { SHOW_VALUES } from './lib/url';

/**
 * The domain's strings live in messages/<locale>/segments.json. These checks keep English and Arabic in step, make sure
 * no component asks for a key that is missing (next-intl would print the key path instead of text), and that every
 * operator, field and invalid reason the contract has can be said in both languages.
 */
const WEB = resolve(__dirname, '../../..');
const FILE = 'segments.json';
const ROOT_KEY = 'segments';

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
  [
    ...new Set(
      [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`),
    ),
  ].sort();

const en = flatten(load('en'));
const ar = flatten(load('ar'));

describe('segments messages', () => {
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

/** Keys looked up with a value computed at run time; each is checked in the test below. */
const DYNAMIC_PREFIXES = [
  `${ROOT_KEY}.fields.`,
  `${ROOT_KEY}.operators.`,
  `${ROOT_KEY}.summary.op.`,
  `${ROOT_KEY}.invalid.reason.`,
  `${ROOT_KEY}.errors.`,
  `${ROOT_KEY}.problem.`,
  `${ROOT_KEY}.hub.show.`,
  `${ROOT_KEY}.fieldGroups.`,
  `${ROOT_KEY}.visibility.`,
];

describe('message keys used in code', () => {
  const files = [
    ...sourceFiles(join(WEB, 'src', 'features', 'segments')),
    ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(segments)')),
  ];

  it('exist in the English messages', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        // a key built from a template string cannot be read here; those are in the run-time test
        checked++;
        if (!(key in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(missing).toEqual([]);
  });

  it('exist for the keys built at run time', () => {
    const dynamic = [
      'nav.segments',
      ...Object.keys(SEGMENT_BUILTIN_FIELDS).map((f) => `fields.${f}`),
      ...SEGMENT_OPERATORS.map((o) => `operators.${o}`),
      ...SEGMENT_OPERATORS.map((o) => `summary.op.${o}`),
      'operators.equals_date',
      'summary.op.equals_date',
      ...SEGMENT_INVALID_REASONS.map((r) => `invalid.reason.${r}`),
      ...(['journey', 'who', 'activity', 'properties'] as const).map((g) => `fieldGroups.${g}`),
      ...(
        [
          'network',
          'forbidden',
          'signedOut',
          'conflict',
          'validation',
          'notFound',
          'nameTaken',
          'rulesInvalid',
          'shareEmpty',
          'shareInvalid',
          'rateLimited',
          'planLimit',
          'unavailable',
          'unexpected',
        ] as const
      ).map((k) => `errors.${k}`),
      ...(['empty', 'number', 'days', 'date', 'range', 'tooLong', 'tooMany', 'field'] as const).map(
        (k) => `problem.${k}`,
      ),
      ...(['required', 'tooLong'] as const).map((k) => `problem.name.${k}`),
      'problem.description.tooLong',
      ...(['empty', 'incomplete', 'tooMany', 'tooDeep', 'invalid'] as const).map(
        (k) => `problem.rules.${k}`,
      ),
      ...SHOW_VALUES.map((v) => `hub.show.${v}`),
      ...(['private', 'shared', 'specific'] as const).flatMap((v) => [
        `visibility.${v}`,
        `visibility.${v}Hint`,
      ]),
    ];
    const missing = [...new Set(dynamic)].filter((k) => !(`${ROOT_KEY}.${k}` in en));
    expect(missing).toEqual([]);
  });

  it('are all used somewhere (no dead strings)', () => {
    const used = new Set<string>();
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const unused = Object.keys(en).filter((key) => {
      if (used.has(key)) return false;
      if (DYNAMIC_PREFIXES.some((p) => key.startsWith(p))) return false;
      // keys built from a template or a ternary: accept when the last segment appears in the source
      const last = key.split('.').at(-1)!;
      return !new RegExp(`['"\`.]${last}['"\`.\\s)]`).test(text);
    });
    expect(unused).toEqual([]);
  });
});
