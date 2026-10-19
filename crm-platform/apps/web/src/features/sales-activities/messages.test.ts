import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ACTIVITY_ICONS,
  CUSTOM_ACTIVITY_BEHAVIOURS,
  DEFAULT_ACTIVITY_KEYS,
  PHONE_COUNTS_AS,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';

/**
 * The domain's strings live in messages/<locale>/sales-activities.json. These checks keep all 21 languages in step (same keys, same
 * placeholders, no English left over), and make sure no component asks for a key that is missing (next-intl would print the key path
 * instead of text), including the keys that are built at run time (the localised names of the seeded activities and items).
 */
const WEB = resolve(__dirname, '../../..');
const ROOT = 'sales-activities';

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

describe('sales-activities messages', () => {
  it('covers all 21 locales', () => {
    expect(LOCALES).toHaveLength(21);
  });

  for (const locale of LOCALES.filter((l) => l !== 'en')) {
    describe(locale, () => {
      const tr = flatten(load(locale));
      it('has exactly the keys English has', () => {
        expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
      });
      it('uses the same placeholders as English, and is never empty', () => {
        for (const [key, text] of Object.entries(en)) {
          expect(tr[key]?.trim(), key).toBeTruthy();
          expect(placeholders(tr[key]!), `placeholders of ${key}`).toEqual(placeholders(text));
        }
      });
      it('is translated: most messages differ from the English source', () => {
        const same = Object.keys(en).filter((k) => tr[k] === en[k]);
        expect(same.length / Object.keys(en).length).toBeLessThan(0.1);
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

/** `t('key')` and `tv('key')` calls, with the namespace each file binds (`useTranslations('sales-activities.drawer')`). */
describe('message keys used in code', () => {
  it('exist in the English messages', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of sourceFiles(
      join(WEB, 'src', 'features', 'sales-activities', 'components'),
    )) {
      const src = readFileSync(file, 'utf8');
      // A file may bind more than one namespace; check each call against the namespaces that file binds.
      const spaces = [...src.matchAll(/useTranslations\('(sales-activities[^']*)'\)/g)].map(
        (m) => m[1]!,
      );
      for (const m of src.matchAll(/\b(?:t|tv|tRaw)\(\s*'([^'$]+)'/g)) {
        checked++;
        const key = m[1]!;
        const found = spaces.some((ns) => `${ns}.${key}` in en);
        if (!found) missing.push(`${file.replace(WEB, '')}: ${key}`);
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(missing).toEqual([]);
  });

  it('exist for the keys built at run time', () => {
    const dynamic = [
      ...DEFAULT_ACTIVITY_KEYS.map((k) => `defaults.activity.${k}`),
      ...[
        'follow_up',
        'call_reminder',
        'interested',
        'left_message',
        'no_response',
        'not_interested',
        'not_reachable',
      ].map((k) => `defaults.option.task.${k}`),
      ...['interested', 'not_interested', 'needs_follow_up', 'rescheduled', 'no_show'].map(
        (k) => `defaults.option.meeting.${k}`,
      ),
      ...PHONE_COUNTS_AS.map((k) => `defaults.option.phone.${k}`),
      ...PHONE_COUNTS_AS.map((k) => `drawer.countsAs.${k}`),
      ...CUSTOM_ACTIVITY_BEHAVIOURS.flatMap((b) => [
        `create.behaves.${b}`,
        `create.behavesAsHint.${b}`,
      ]),
      ...ACTIVITY_ICONS.map((i) => `create.icons.${i}`),
    ];
    expect(dynamic.filter((k) => !(`${ROOT}.${k}` in en))).toEqual([]);
  });
});
