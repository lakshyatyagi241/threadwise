import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEAL_SOURCES } from './api/schemas';
import { LOST_REASON_KEYS } from './lib/lost-reasons';

/**
 * The domain's strings live in messages/<locale>/deals-pipelines.json. These checks keep English and Arabic in step
 * and make sure no component asks for a key that is missing (next-intl would print the key path instead of text).
 */
const WEB = resolve(__dirname, '../../..');
const FILE = 'deals-pipelines.json';
const ROOT_KEY = 'deals-pipelines';

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

describe('deals messages', () => {
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
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Literal `t('key')` calls paired with the namespace of the nearest preceding `useTranslations('ns')`. */
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
    ...sourceFiles(join(WEB, 'src', 'features', 'deals-pipelines')),
    ...sourceFiles(join(WEB, 'src', 'app', '(app)', '(deals-pipelines)')),
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
    const dynamic = [
      ...DEAL_SOURCES.map((s) => `sources.${s}`),
      ...LOST_REASON_KEYS.map((s) => `lost.reasons.${s}`),
      ...(['open', 'won', 'lost'] as const).flatMap((s) => [
        `status.${s}`,
        `settings.kinds.${s}`,
        `toolbar.${s}`,
      ]),
      ...(['today', 'd', 'w', 'mo', 'y'] as const).map((s) => `card.age.${s}`),
      ...(['overdue', 'today', 'upcoming'] as const).map((s) => `card.due.${s}`),
      ...(['note', 'call', 'message', 'task', 'stage_change'] as const).map(
        (s) => `activity.kinds.${s}`,
      ),
      ...(['note', 'task', 'call'] as const).map((s) => `activity.types.${s}`),
      ...(['board', 'list'] as const).map((s) => `toolbar.views.${s}`),
      ...(['title', 'contact', 'stage', 'amount', 'owner', 'close', 'status'] as const).map(
        (s) => `list.columns.${s}`,
      ),
      ...(['nameRequired', 'nameTooLong', 'probability', 'color', 'twoWon', 'twoLost'] as const).map(
        (s) => `settings.problems.${s}`,
      ),
      ...(
        [
          'network',
          'forbidden',
          'signedOut',
          'conflict',
          'validation',
          'unavailable',
          'rateLimited',
          'notFound',
          'planDisabled',
          'unexpected',
        ] as const
      ).map((s) => `errors.${s}`),
    ];
    const missing = dynamic.filter((k) => !(`${ROOT_KEY}.${k}` in en));
    expect(missing).toEqual([]);
  });

  it('are all used somewhere (no dead strings)', () => {
    const used = new Set<string>();
    for (const file of files) for (const key of usedKeys(readFileSync(file, 'utf8'))) used.add(key);
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const dynamicPrefixes = [
      'sources.',
      'lost.reasons.',
      'status.',
      'settings.kinds.',
      'settings.problems.',
      'card.age.',
      'card.due.',
      'activity.kinds.',
      'activity.types.',
      'toolbar.views.',
      'list.columns.',
      'errors.',
    ];
    const unused = Object.keys(en).filter((key) => {
      if (used.has(key)) return false;
      if (dynamicPrefixes.some((p) => key.startsWith(`${ROOT_KEY}.${p}`))) return false;
      const last = key.split('.').at(-1)!;
      return !new RegExp(`['"\`.]${last}['"\`.\\s)]`).test(text);
    });
    expect(unused).toEqual([]);
  });
});
