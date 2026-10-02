import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLAN_FEATURE_GROUPS,
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_GROUPS,
  PLAN_LIMIT_KEYS,
  PLAN_RULE_CODES,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { OPERATOR_NAV } from '../operator-nav';

type Tree = { [key: string]: string | Tree };

const load = (locale: string): Tree => {
  const root = JSON.parse(
    readFileSync(
      join(process.cwd(), 'messages', locale, 'auth-registration-security.platform.json'),
      'utf8',
    ),
  ) as Tree;
  return (root['auth-registration-security'] as Tree)['platform'] as Tree;
};

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v === 'string') out[`${prefix}${k}`] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

const NS = 'plans';
const en = flatten(load('en'));
const ar = flatten(load('ar'));

/** The keys the plan screens build at run time from the catalogue registry, so a new registry key cannot ship unlabeled. */
const dynamic: string[] = [
  ...PLAN_LIMIT_KEYS.map((k) => `${NS}.editor.limitKeys.${k}`),
  ...PLAN_LIMIT_GROUPS.map((g) => `${NS}.editor.limitGroups.${g}`),
  ...PLAN_FEATURE_KEYS.map((k) => `${NS}.editor.featureKeys.${k}`),
  ...PLAN_FEATURE_GROUPS.map((g) => `${NS}.editor.featureGroups.${g}`),
  ...(['days', 'weeks', 'months', 'years'] as const).flatMap((u) => [
    `${NS}.editor.units.${u}`,
    `${NS}.period.${u}`,
  ]),
  ...[...PLAN_RULE_CODES, 'required', 'tooLong', 'money', 'range', 'whole', 'server'].map(
    (c) => `${NS}.editor.problems.${c}`,
  ),
  ...['inUse', 'defaultProtected', 'notFound', 'forbidden', 'generic'].map(
    (k) => `${NS}.errors.${k}`,
  ),
  ...['free', 'paid', 'custom_quote'].map((k) => `registration.fields.defaultPlanId.kinds.${k}`),
  'registration.fields.defaultPlanId.auto',
  'registration.fields.defaultPlanId.unavailable',
  'registration.fields.defaultPlanId.loadFailed',
  'nav.plans',
  'nav.groups.plans',
];

describe('plan catalogue messages (operator console)', () => {
  it.each(dynamic)('has %s in English and Arabic', (key) => {
    expect(en[key], `en ${key}`).toBeTypeOf('string');
    expect(ar[key], `ar ${key}`).toBeTypeOf('string');
  });

  it('labels every nav item the console menu lists', () => {
    // Other domains merge their own entries into the menu and test their own labels.
    const own = OPERATOR_NAV.filter((i) => i.labelKey.startsWith('auth-registration-security.'));
    for (const item of own) {
    // other domains label their own entries in their own message files
    // entries merged in by other domains carry their own namespace and their own messages test
    for (const item of OPERATOR_NAV.filter((i) =>
      i.labelKey.startsWith('auth-registration-security.platform.'),
    // other domains add their own entries, labelled in their own message files
    for (const item of OPERATOR_NAV.filter((i) =>
      i.labelKey.startsWith('auth-registration-security.'),
    )) {
      const key = item.labelKey.replace('auth-registration-security.platform.', '');
      expect(en[key], key).toBeTypeOf('string');
    }
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('keys the plan components ask for by literal name', () => {
  const used = new Set<string>();
  for (const file of sources(__dirname)) {
    const src = readFileSync(file, 'utf8');
    const bindings = new Map<string, string>();
    // The file's own `const NS = '...'`, then `useTranslations(NS)`, `useTranslations(`${NS}.errors`)` or a literal.
    const NS = /const NS = '([^']+)'/.exec(src)?.[1] ?? '';
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useTranslations\(([^)]*)\)/g)) {
      const arg = m[2]!.trim();
      const sub = /^`\$\{NS\}\.(\w+)`$/.exec(arg);
      if (arg === 'NS') bindings.set(m[1]!, NS);
      else if (sub) bindings.set(m[1]!, `${NS}.${sub[1]}`);
      else if (/^'([^']+)'$/.test(arg)) bindings.set(m[1]!, arg.slice(1, -1));
    }
    for (const [name, ns] of bindings) {
      for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g'))) {
        used.add(`${ns}.${m[1]}`);
      }
    }
  }

  it('finds them', () => expect(used.size).toBeGreaterThan(40));

  it('every one exists in English and Arabic', () => {
    const prefix = 'auth-registration-security.platform.';
    const missing = [...used]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
      .filter((k) => typeof en[k] !== 'string' || typeof ar[k] !== 'string');
    expect(missing).toEqual([]);
  });
});
