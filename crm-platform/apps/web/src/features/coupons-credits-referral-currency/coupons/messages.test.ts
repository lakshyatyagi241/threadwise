import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATOR_NAV } from '../../auth-registration-security/platform/operator-nav';
import { ERROR_KINDS } from './lib/errors';
import { FORM_FIELDS } from './lib/form';

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../../..');
const ROOT = 'coupons-credits-referral-currency.coupons';

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const load = (locale: string) =>
  flatten(
    JSON.parse(
      readFileSync(
        join(WEB, 'messages', locale, 'coupons-credits-referral-currency.coupons.json'),
        'utf8',
      ),
    ) as Tree,
  );
const en = load('en');
const ar = load('ar');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe('coupons messages', () => {
  it('every message is non-empty and Arabic has exactly the English keys', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe('');
    for (const [k, v] of Object.entries(ar)) expect(v.trim(), k).not.toBe('');
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('keeps ICU placeholders identical between English and Arabic', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en)) expect(names(ar[k]!), k).toEqual(names(en[k]!));
  });

  it('labels every field, problem kind, error kind, filter pill and flash message looked up by name', () => {
    const wanted = [
      ...[...FORM_FIELDS, 'isActive', 'firstPurchaseOnly', 'stackableWithOther'].map(
        (f) => `${ROOT}.form.fields.${f}.label`,
      ),
      ...[
        'required',
        'money',
        'count',
        'tooLong',
        'date',
        'window',
        'taken',
        'unknownPlan',
        'invalid',
      ].map((k) => `${ROOT}.form.problems.${k}`),
      ...ERROR_KINDS.map((k) => `${ROOT}.errors.${k}`),
      ...['all', 'active', 'disabled', 'expired'].map((k) => `${ROOT}.list.filters.${k}`),
      ...['created', 'updated', 'activated', 'deactivated', 'removed'].map(
        (k) => `${ROOT}.list.flash.${k}`,
      ),
    ];
    for (const k of wanted) {
      expect(en[k], k).toBeTypeOf('string');
      expect(ar[k], `ar ${k}`).toBeTypeOf('string');
    }
  });

  it('uses Reference wording for the flash messages and the delete confirmation', () => {
    expect(en[`${ROOT}.list.flash.created`]).toBe('Coupon created.');
    expect(en[`${ROOT}.list.flash.updated`]).toBe('Coupon updated.');
    expect(en[`${ROOT}.list.flash.activated`]).toBe('Activated.');
    expect(en[`${ROOT}.list.flash.deactivated`]).toBe('Deactivated.');
    expect(en[`${ROOT}.list.flash.removed`]).toBe('Coupon removed.');
    expect(en[`${ROOT}.list.delete.message`]).toBe(
      'Delete coupon {code}? Workspaces that already redeemed it keep their discount.',
    );
  });

  it('has the nav entry (label and group) in English and Arabic', () => {
    const item = OPERATOR_NAV.find((i) => i.id === 'coupons');
    expect(item?.href).toBe('/admin/coupons');
    expect(
      en[item!.labelKey.replace('coupons-credits-referral-currency.', '')] ?? en[item!.labelKey],
    ).toBeTypeOf('string');
    expect(ar[item!.labelKey]).toBeTypeOf('string');
  });

  it('every literal t("...") key a component asks for exists in English and Arabic', () => {
    const missing: string[] = [];
    for (const file of sources(join(__dirname, 'components'))) {
      const src = readFileSync(file, 'utf8');
      // Several components in one file reuse the name `t`: a call belongs to the nearest binding before it.
      const bindings = [
        ...src.matchAll(/const (\w+) = useTranslations\(`\$\{NS\}\.?([\w.]*)`\)/g),
      ].map((m) => ({ name: m[1]!, base: m[2] ? `${ROOT}.${m[2]}` : ROOT, at: m.index! }));
      for (const call of src.matchAll(/\b(\w+)\(\s*'([^']+)'/g)) {
        const owner = bindings.filter((b) => b.name === call[1] && b.at < call.index!).pop();
        if (!owner) continue;
        const key = `${owner.base}.${call[2]}`;
        if (!en[key]) missing.push(`en ${file.split('features')[1]}: ${key}`);
        if (!ar[key]) missing.push(`ar ${file.split('features')[1]}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
