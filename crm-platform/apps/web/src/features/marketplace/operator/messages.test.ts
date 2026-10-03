import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONNECTOR_TYPES,
  MARKET_APP_KINDS,
  MARKET_APP_STATUSES,
  MARKET_REQUEST_STATUSES,
  MARKET_SCOPE_RISKS,
  MARKET_VERSION_STATUSES,
} from '@crm/contracts';
import { OPERATOR_NAV } from '../../auth-registration-security/platform/operator-nav';
import { MARKET_OPERATOR_NAV } from '../operator-nav';
import { KIND_FILTERS, STATUS_FILTERS } from './lib/catalogue';
import { MARKET_ERROR_KEYS } from './lib/errors';
import { STARTER_TEMPLATES } from './lib/starters';
import { USAGE_SORTS, type UsageReason } from './lib/usage';

/**
 * next-intl prints the key path when a message is missing, so every key a component asks for must exist, in English and in
 * Arabic, with the same placeholders. The keys the code builds by name are listed here from the code's own enums.
 */
type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../../..');
const ROOT = 'marketplace.operator';
const FILE = 'marketplace.operator.json';
const load = (locale: string) =>
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

const en = flatten(load('en'));
const ar = flatten(load('ar'));

/** `{name}` and `{count, plural, ...}` placeholders, by variable name. */
const placeholders = (message: string) =>
  [...new Set([...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map((m) => m[1]!))].sort();

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

const bothHave = (keys: string[]) => {
  for (const k of keys) {
    expect(en[k], `en ${k}`).toBeTypeOf('string');
    expect(ar[k], `ar ${k}`).toBeTypeOf('string');
  }
};

describe('marketplace operator messages', () => {
  it('only writes under marketplace.operator (the workspace marketplace owns the other keys)', () => {
    for (const locale of ['en', 'ar']) {
      const tree = load(locale);
      expect(Object.keys(tree)).toEqual(['marketplace']);
      expect(Object.keys(tree.marketplace as Tree)).toEqual(['operator']);
    }
  });

  it('every message is non-empty and no key holds a dot (next-intl reads it as nesting)', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe('');
    for (const [k, v] of Object.entries(ar)) expect(v.trim(), k).not.toBe('');
    const dotted: string[] = [];
    const walk = (t: Tree) => {
      for (const [k, v] of Object.entries(t)) {
        if (k.includes('.')) dotted.push(k);
        if (typeof v !== 'string') walk(v);
      }
    };
    walk(load('en'));
    walk(load('ar'));
    expect(dotted).toEqual([]);
  });

  it('Arabic has exactly the keys English has', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('Arabic keeps the same placeholders as English', () => {
    for (const k of Object.keys(en)) expect(placeholders(ar[k]!), k).toEqual(placeholders(en[k]!));
  });

  it('never writes a literal placeholder brace pair that ICU would read as an argument', () => {
    for (const [k, v] of Object.entries(en)) expect(v, k).not.toMatch(/\{\{/);
    for (const [k, v] of Object.entries(ar)) expect(v, k).not.toMatch(/\{\{/);
  });

  it('Arabic is written in Arabic: no message is a copy of its English text', () => {
    // A bare dash is the same in both; any message with letters in it must differ.
    const same = Object.keys(en).filter((k) => en[k] === ar[k] && /[A-Za-z]/.test(en[k]!));
    expect(same, same.join(', ')).toEqual([]);
  });

  it('labels every console menu entry and its group, and each entry is in the console menu', () => {
    expect(MARKET_OPERATOR_NAV.map((n) => n.id)).toEqual([
      'market-catalogue',
      'market-categories',
      'market-requests',
      'market-usage',
    ]);
    for (const item of MARKET_OPERATOR_NAV) {
      for (const locale of [en, ar]) {
        expect(locale[item.labelKey], item.labelKey).toBeTypeOf('string');
        expect(locale[item.groupKey], item.groupKey).toBeTypeOf('string');
      }
      expect(
        OPERATOR_NAV.some((n) => n.id === item.id && n.href === item.href),
        item.id,
      ).toBe(true);
    }
  });

  it('describes every value of every contract enum the screens show by name', () => {
    bothHave([
      ...MARKET_APP_KINDS.map((v) => `${ROOT}.enums.kind.${v}`),
      ...MARKET_APP_STATUSES.map((v) => `${ROOT}.enums.appStatus.${v}`),
      ...MARKET_VERSION_STATUSES.map((v) => `${ROOT}.enums.versionStatus.${v}`),
      ...MARKET_REQUEST_STATUSES.map((v) => `${ROOT}.enums.requestStatus.${v}`),
      ...CONNECTOR_TYPES.map((v) => `${ROOT}.enums.connector.${v}`),
      ...MARKET_SCOPE_RISKS.map((v) => `${ROOT}.enums.risk.${v}`),
      ...MARKET_APP_KINDS.map((v) => `${ROOT}.categories.form.kinds.${v}`),
      ...MARKET_ERROR_KEYS.map((k) => `${ROOT}.errors.${k}`),
    ]);
  });

  it('has the filter values the catalogue builds by name', () => {
    expect(KIND_FILTERS).toEqual(['all', ...MARKET_APP_KINDS]);
    expect(STATUS_FILTERS).toEqual(['all', ...MARKET_APP_STATUSES]);
    bothHave([`${ROOT}.list.filters.allKinds`, `${ROOT}.list.filters.allStatuses`]);
  });

  it('has the keys the code builds from its own result codes', () => {
    const reasons: UsageReason[] = ['installErrors', 'needsReauth', 'failed24h', 'failed7d'];
    bothHave(
      [
        // lib/json-docs DocProblemCode
        ...[
          'empty',
          'syntax',
          'syntaxAt',
          'recipeNotAllowed',
          'recipeMissing',
          'recipeKeyMismatch',
          'recipeCategoryMismatch',
          'recipeConnectorMismatch',
          'idChanged',
          'kindChanged',
          'versionNotHigher',
          'versionTaken',
          'categoryUnknown',
          'categoryRefused',
          'recipeRequired',
          'slugTaken',
        ].map((c) => `editor.problems.${c}`),
        'editor.valid.manifest',
        'editor.valid.recipe',
        ...STARTER_TEMPLATES.map((t) => `editor.templates.${t}`),
        // lib/listing-form FieldCode
        ...[
          'required',
          'tooShort',
          'tooLong',
          'https',
          'tooMany',
          'number',
          'unknownFeature',
          'slug',
          'icon',
        ].map((c) => `fields.problems.${c}`),
        // components/app-actions
        ...['hide', 'unhide', 'unkill', 'delete'].flatMap((a) => [
          `actions.confirm.${a}.title`,
          `actions.confirm.${a}.body`,
          `actions.confirm.${a}.action`,
        ]),
        ...['hide', 'unhide', 'unkill', 'kill', 'delete'].map((a) => `actions.done.${a}`),
        // components/versions-panel
        ...['created', 'submitted', 'reviewed', 'published'].map((d) => `versions.dates.${d}`),
        ...['submit', 'approve', 'reject', 'publish', 'created', 'updated'].map(
          (d) => `versions.done.${d}`,
        ),
        // components/usage-page
        ...USAGE_SORTS.map((s) => `usage.sort.${s}`),
        ...reasons.map((r) => `usage.reasons.${r}`),
      ].map((k) => `${ROOT}.${k}`),
    );
  });

  it('every literal t("...") key a component asks for exists in both languages', () => {
    const missing: string[] = [];
    for (const file of sources(join(__dirname, 'components'))) {
      const src = readFileSync(file, 'utf8');
      const ns = /const NS = '([^']+)'/.exec(src)?.[1] ?? '';
      // A name can be bound more than once in a file (one `t` per component), so a key counts when ANY binding of the name has it.
      const bindings = new Map<string, string[]>();
      for (const m of src.matchAll(/const (\w+) = useTranslations\(([^)]*)\)/g)) {
        const arg = m[2]!.trim();
        const lit = /^'([^']+)'$/.exec(arg)?.[1];
        const tpl = /^`\$\{NS\}(?:\.([\w.]+))?`$/.exec(arg);
        const base = lit ?? (arg === 'NS' ? ns : tpl ? (tpl[1] ? `${ns}.${tpl[1]}` : ns) : null);
        if (base) bindings.set(m[1]!, [...(bindings.get(m[1]!) ?? []), base]);
        else missing.push(`${file.split('features')[1]}: cannot read useTranslations(${arg})`);
      }
      for (const [name, bases] of bindings) {
        for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g'))) {
          const ok = bases.some(
            (b) => en[`${b}.${m[1]}`] !== undefined && ar[`${b}.${m[1]}`] !== undefined,
          );
          if (!ok)
            missing.push(
              `${file.split('features')[1]}: ${name}('${m[1]}') in ${bases.join(' | ')}`,
            );
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('every namespace a component opens exists', () => {
    const prefixes = new Set(Object.keys(en).map((k) => k.split('.').slice(0, -1).join('.')));
    const all = new Set<string>();
    for (const p of prefixes) {
      const parts = p.split('.');
      for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('.'));
    }
    const missing: string[] = [];
    for (const file of sources(join(__dirname, 'components'))) {
      const src = readFileSync(file, 'utf8');
      const ns = /const NS = '([^']+)'/.exec(src)?.[1] ?? '';
      for (const m of src.matchAll(/useTranslations\(([^)]*)\)/g)) {
        const arg = m[1]!.trim();
        const lit = /^'([^']+)'$/.exec(arg)?.[1];
        const tpl = /^`\$\{NS\}(?:\.([\w.]+))?`$/.exec(arg);
        const base = lit ?? (arg === 'NS' ? ns : tpl ? (tpl[1] ? `${ns}.${tpl[1]}` : ns) : null);
        if (base && !all.has(base)) missing.push(`${file.split('features')[1]}: ${base}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
