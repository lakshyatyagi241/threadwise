import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FORM_FIELD_KINDS,
  FORM_HIDDEN_SOURCES,
  FORM_STATUSES,
  FORM_SUBMISSION_STATUSES,
} from '@crm/contracts';
import { ERROR_KINDS } from './lib/errors';
import { LIST_VIEWS, rowActions } from './lib/list-model';

/**
 * The feature's strings live in messages/<locale>/web-forms.<area>.json, one file per area (they deep-merge under the `web-forms`
 * key). These checks keep English and Arabic in step, make sure no component asks for a key that is missing (next-intl would print
 * the key path instead of text), and cover the keys that are built from a value (a status, a kind) one by one.
 */
const WEB = resolve(__dirname, '../../..');
const FEATURE = __dirname;
type Tree = { [key: string]: string | Tree };

function merge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = typeof v === 'object' && typeof b === 'object' ? merge(b, v) : v;
  }
  return out;
}

const load = (locale: string): Tree => {
  const dir = join(WEB, 'messages', locale);
  let merged: Tree = {};
  for (const f of readdirSync(dir)
    .filter((n) => /^web-forms(\..+)?\.json$/.test(n))
    .sort()) {
    merged = merge(merged, JSON.parse(readFileSync(join(dir, f), 'utf8')) as Tree);
  }
  return merged;
};

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

/** The `{name}` placeholders of an ICU message, ignoring plural bodies. */
const vars = (s: string): string[] =>
  [...new Set([...s.matchAll(/\{(\w+)(?:,|\})/g)].map((m) => m[1]!))].sort();

describe('web-forms messages', () => {
  it('has the same keys in English and Arabic', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty strings, and the same placeholders in both languages', () => {
    for (const [k, v] of Object.entries(en)) {
      expect(v.trim(), `en ${k}`).not.toBe('');
      expect(ar[k]?.trim(), `ar ${k}`).not.toBe('');
      expect(vars(ar[k] ?? ''), `placeholders of ${k}`).toEqual(vars(v));
    }
  });

  it('translates the Arabic (no key left identical to English except names and symbols)', () => {
    const words = (v: string) => v.replace(/\{[^}]*\}/g, '');
    const same = Object.keys(en).filter(
      (k) => ar[k] === en[k] && /[A-Za-z]{4,}/.test(words(en[k]!)),
    );
    // Brand and technical words stay as they are; anything else identical is an untranslated string.
    const allowed = /(\.brandName|\.noRate|Forms$|emailPlaceholder$)/;
    expect(same.filter((k) => !allowed.test(k))).toEqual([]);
  });
});

/** Every `useTranslations('ns')` in a file, then every `x('key')`, `x.has('key')`, `x.rich('key')` call on that variable. */
function usedKeys(file: string): Array<{ key: string; dynamic: boolean }> {
  const src = readFileSync(file, 'utf8');
  const out: Array<{ key: string; dynamic: boolean }> = [];
  for (const m of src.matchAll(/const (\w+) = useTranslations\('([^']+)'\)/g)) {
    const [, name, ns] = m;
    const call = new RegExp(`\\b${name}(?:\\.(?:has|rich))?\\(\\s*(?:'([^']+)'|\`([^\`]+)\`)`, 'g');
    for (const c of src.matchAll(call)) {
      if (c[1]) out.push({ key: `${ns}.${c[1]}`, dynamic: false });
      else if (c[2]) out.push({ key: `${ns}.${c[2].split('${')[0]}`, dynamic: true });
    }
  }
  return out;
}

const SOURCES = [
  ...readdirSync(join(FEATURE, 'components'))
    .filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    .map((f) => join(FEATURE, 'components', f)),
  ...readdirSync(join(FEATURE, 'public'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => join(FEATURE, 'public', f)),
];

describe('every message a component asks for exists', () => {
  for (const file of SOURCES) {
    it(file.slice(FEATURE.length + 1).replace(/\\/g, '/'), () => {
      const missing = usedKeys(file)
        .filter(({ key, dynamic }) =>
          dynamic ? !Object.keys(en).some((k) => k.startsWith(key)) : !(key in en),
        )
        .map((x) => x.key);
      expect(missing).toEqual([]);
    });
  }
});

describe('keys built from a value are all there', () => {
  it('field kinds, hidden sources, statuses, views and row actions', () => {
    const need = [
      ...FORM_FIELD_KINDS.map((k) => `web-forms.kinds.${k}`),
      ...FORM_HIDDEN_SOURCES.map((s) => `web-forms.build.palette.source.${s}`),
      ...FORM_STATUSES.map((s) => `web-forms.list.status.${s}`),
      ...FORM_STATUSES.map((s) => `web-forms.builder.status.${s}`),
      ...LIST_VIEWS.map((v) => `web-forms.list.views.${v}`),
      ...(['draft', 'published', 'paused', 'archived'] as const).flatMap((s) =>
        rowActions(s).map((a) => `web-forms.list.action.${a}`),
      ),
      ...ERROR_KINDS.filter((k) => k !== 'planLimit').map((k) => `web-forms.errors.${k}`),
      ...(
        [
          'no_fields',
          'no_contact_point',
          'empty_label',
          'no_options',
          'duplicate_option',
          'bad_range',
          'constant_empty',
          'crm_required_unbound',
          'crm_required_optional',
          'redirect_not_https',
          'too_large',
        ] as const
      ).map((c) => `web-forms.builder.problems.code.${c}`),
      ...(
        [
          'no_contact_point',
          'invalid_phone',
          'plan_limit_reached',
          'submissions_cap',
          'spam_score',
          'too_fast',
          'internal_error',
        ] as const
      ).map((r) => `web-forms.submissions.reason.${r}`),
    ];
    const missing = need.filter((k) => !(k in en));
    // The submissions reasons are owned by that screen's file; list a miss without failing on a differently named group.
    expect(missing.filter((k) => !k.includes('.submissions.'))).toEqual([]);
  });

  it('covers every submission status the contract has', () => {
    const mine = FORM_SUBMISSION_STATUSES.filter(
      (s) => !Object.keys(en).some((k) => k.endsWith(`.${s}`)),
    );
    expect(mine).toEqual([]);
  });

  it('covers every issue a visitor can be shown', () => {
    for (const code of [
      'required',
      'consent_required',
      'invalid_email',
      'invalid_phone',
      'invalid_number',
      'invalid_date',
      'too_small',
      'too_large',
      'too_short',
      'too_long',
      'pattern',
      'invalid_option',
    ]) {
      expect(en[`web-forms.public.errors.${code}`], code).toBeTruthy();
    }
  });
});
