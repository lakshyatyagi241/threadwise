import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ASSIGNMENT_FIELDS,
  ASSIGNMENT_ORIGINS,
  ASSIGNMENT_REASONS,
  ASSIGNMENT_RUN_OUTCOMES,
  ASSIGNMENT_SUBJECTS,
  CONTACT_ASSIGNMENT_STRATEGIES,
  DEAL_STATUSES_FOR_ASSIGNMENT,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';

/**
 * The domain's strings live in messages/<locale>/record-assignment.json. These checks keep all 21 languages in step (same keys, same
 * placeholders, no English left over), and make sure no component asks for a key that is missing (next-intl would print the key path
 * instead of text), including the keys that are built at run time.
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'record-assignment';

type Tree = { [key: string]: string | Tree };
const load = (locale: string): Tree =>
  JSON.parse(readFileSync(join(WEB, 'messages', locale, `${ROOT}.json`), 'utf8')) as Tree;

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** `{name}` and `{count, plural, ...}` placeholders by variable name, and rich-text tags. */
const placeholders = (message: string) =>
  [
    ...new Set(
      [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]|<(\w+)>/g)].map((m) => m[1] ?? `<${m[2]}>`),
    ),
  ].sort();

const en = flatten(load('en'));
const LOCALES = (
  JSON.parse(readFileSync(join(WEB, 'scripts', '.locales.json'), 'utf8')) as { LOCALES: string[] }
).LOCALES;

describe('record-assignment messages', () => {
  it('covers all 21 locales', () => {
    expect(LOCALES).toHaveLength(21);
  });

  it('keeps every key under the domain root', () => {
    for (const key of Object.keys(en)) expect(key.startsWith(`${ROOT}.`), key).toBe(true);
  });

  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    describe(locale, () => {
      const tr = flatten(load(locale));

      it('has exactly the keys English has', () => {
        expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
      });

      it('uses the same placeholders and tags as English, and is never empty', () => {
        for (const [key, text] of Object.entries(en)) {
          expect(tr[key]?.trim(), key).toBeTruthy();
          expect(placeholders(tr[key]!), `placeholders of ${key}`).toEqual(placeholders(text));
        }
      });

      it('is translated: most messages differ from the English source', () => {
        const same = Object.keys(en).filter((k) => tr[k] === en[k]);
        // names, "API" and bare placeholders such as {Contacts} legitimately stay as they are
        expect(same.length / Object.keys(en).length).toBeLessThan(0.08);
      });
    });
  }
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

/** Literal `t('key')` and `rich('key')` of the screen's translator. */
function usedKeys(source: string): string[] {
  return [...source.matchAll(/\b(?:t|rich)\(\s*'([^'$]+)'/g)].map((m) => m[1]!);
}

describe('message keys used in code', () => {
  const files = sourceFiles(join(WEB, 'src', 'features', 'record-assignment'));

  it('exist in the English messages', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      for (const key of usedKeys(readFileSync(file, 'utf8'))) {
        checked++;
        if (!(`${ROOT}.${key}` in en)) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('exist for the keys built at run time', () => {
    const dynamic = [
      ...ASSIGNMENT_SUBJECTS.flatMap((s) => [
        `tabs.${s}`,
        `list.title.${s}`,
        `list.empty.${s}`,
        `test.search.${s}`,
        `strategy.hint.least_busy.${s}`,
      ]),
      ...CONTACT_ASSIGNMENT_STRATEGIES.map((s) => `strategy.${s}`),
      'strategy.hint.round_robin',
      'strategy.hint.fixed',
      ...ASSIGNMENT_ORIGINS.map((o) => `origin.${o}`),
      ...DEAL_STATUSES_FOR_ASSIGNMENT.map((s) => `fields.dealStatus.${s}`),
      ...Object.keys(ASSIGNMENT_FIELDS.company)
        .filter((f) => f !== 'origin')
        .map((f) => `fields.company.${f}`),
      ...Object.keys(ASSIGNMENT_FIELDS.deal)
        .filter((f) => f !== 'origin')
        .map((f) => `fields.deal.${f}`),
      ...['company', 'deal'].map((s) => `editor.group.${s}`),
      ...ASSIGNMENT_REASONS.map((r) => `log.reason.${r}`),
      ...ASSIGNMENT_RUN_OUTCOMES.map((o) => `log.outcome.${o}`),
      ...['created', 'updated'].map((x) => `log.trigger.${x}`),
      ...[
        'would_assign',
        'disabled',
        'has_owner',
        'no_rule',
        'nobody_available',
        'plan',
        'not_found',
      ].map((o) => `test.outcome.${o}`),
      ...['winner', 'matched', 'not_matched', 'nobody', 'broken'].map((s) => `test.trace.${s}`),
      ...['when', 'record', 'outcome', 'reason', 'rule', 'assignedTo', 'method', 'arrived'].map(
        (c) => `log.col.${c}`,
      ),
    ];
    const missing = dynamic.filter((k) => !(`${ROOT}.${k}` in en));
    expect(missing).toEqual([]);
  });
});
