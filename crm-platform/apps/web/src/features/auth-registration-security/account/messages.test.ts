import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PLAN_FEATURE_KEYS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { OWN_TABS } from './hub/hub-tabs';

/**
 * The account zone's strings live in messages/<locale>/auth-registration-security.account.json.
 * These checks keep English and Arabic in step and make sure no component asks
 * for a key that is missing (next-intl would print the key path instead of text).
 */
const WEB = resolve(__dirname, '../../../..');
const FILE = 'auth-registration-security.account.json';
const NAMESPACE = 'auth-registration-security.account';

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
  [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!).sort();

const subtree = (tree: Tree) => (tree['auth-registration-security'] as Tree)['account'] as Tree;
const en = flatten(subtree(load('en')));
const ar = flatten(subtree(load('ar')));

describe('account messages', () => {
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

  it('keeps every key under the account sub-tree', () => {
    const root = load('en') as Tree;
    expect(Object.keys(root)).toEqual(['auth-registration-security']);
    expect(Object.keys(root['auth-registration-security'] as Tree)).toEqual(['account']);
  });

  it('no key segment contains a dot (next-intl treats a dot as nesting)', () => {
    for (const key of Object.keys(en)) {
      expect(key.split('.').every(Boolean)).toBe(true);
    }
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('translation keys used by the components', () => {
  const roots = [
    join(WEB, 'src/features/auth-registration-security/account'),
    join(WEB, 'src/features/auth-registration-security/shared'),
    join(WEB, 'src/app/(app)/(auth-registration-security)'),
    join(WEB, 'src/app/(gate)'),
  ];
  const used = new Map<string, string>();
  for (const file of roots.flatMap(sources)) {
    const src = readFileSync(file, 'utf8');
    const bindings = new Map<string, string>();
    for (const m of src.matchAll(
      /const\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*'([^']*)'\s*\)/g,
    )) {
      bindings.set(m[1]!, m[2]!);
    }
    for (const [name, ns] of bindings) {
      if (!ns.startsWith(NAMESPACE)) continue;
      for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g'))) {
        used.set(`${ns}.${m[1]}`, file);
      }
    }
  }

  it("finds the components' keys at all", () => {
    expect(used.size).toBeGreaterThan(100);
  });

  it('every key a component asks for exists in English and Arabic', () => {
    const missing: string[] = [];
    for (const [key, file] of used) {
      const short = key.slice(NAMESPACE.length + 1);
      if (typeof en[short] !== 'string') missing.push(`en ${short} (${file.split('/src/')[1]})`);
      if (typeof ar[short] !== 'string') missing.push(`ar ${short} (${file.split('/src/')[1]})`);
    }
    expect(missing).toEqual([]);
  });

  // Keys built from a variable, so the scan above cannot see them.
  const dynamic: Array<[string, string[]]> = [
    ['delete.blocked', ['sole_member', 'sole_admin']],
    ['hub.groups', ['account', 'security']],
    ['hub.tabs', ['profile', 'plan', 'security', 'delete']],
    [
      'avatar.errors',
      [
        'type',
        'source-too-large',
        'too-large',
        'decode',
        'encode',
        'forbidden',
        'expired',
        'rejected',
      ],
    ],
    [
      'onboarding.workspace.industries',
      [
        'ecommerce',
        'saas',
        'agency',
        'education',
        'healthcare',
        'finance',
        'travel',
        'hospitality',
        'other',
      ],
    ],
    ['profile.themes', ['paper', 'bright', 'dark']],
    ['password.rules', ['min_length', 'upper_lower', 'number', 'symbol', 'common']],
    ['password.requirement', ['mixedCase', 'number', 'symbol']],
    ['onboarding.stepper', ['account', 'workspace', 'plan']],
    ['plans.card.period', ['days', 'weeks', 'months', 'years']],
    // Every feature the catalogue can grant needs a chip label, so a new registry key cannot ship unlabeled.
    ['plans.card.chips', [...PLAN_FEATURE_KEYS]],
  ];
  it.each(dynamic.flatMap(([base, names]) => names.map((n) => [base, n] as const)))(
    'dynamic key %s.%s exists',
    (base, name) => {
      const prefix = `${base}.${name}`;
      expect(
        Object.keys(en).some((k) => k === prefix || k.startsWith(`${prefix}.`)),
        prefix,
      ).toBe(true);
      expect(
        Object.keys(ar).some((k) => k === prefix || k.startsWith(`${prefix}.`)),
        prefix,
      ).toBe(true);
    },
  );
  it.each(
    OWN_TABS.flatMap((tab) => [tab.labelKey, tab.titleKey, tab.descriptionKey]).filter(Boolean),
  )('hub pane key %s exists in English and Arabic', (key) => {
    const short = (key as string).slice(NAMESPACE.length + 1);
    expect(en[short], `en ${short}`).toBeTypeOf('string');
    expect(ar[short], `ar ${short}`).toBeTypeOf('string');
  });
  it.each(['profile', 'security', 'delete'])('hub page copy for %s exists', (tab) => {
    expect(en[`hub.pages.${tab}.title`]).toBeTypeOf('string');
    expect(en[`hub.pages.${tab}.description`]).toBeTypeOf('string');
  });
});
