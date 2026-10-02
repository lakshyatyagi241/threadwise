import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPERATOR_NAV } from '../../auth-registration-security/platform/operator-nav';
import { ERROR_KINDS } from './lib/errors';
import { currencySettings } from './settings';

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../../..');
const FILE = 'coupons-credits-referral-currency.currencies.json';
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
const ROOT = 'coupons-credits-referral-currency.currencies';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe('currencies messages', () => {
  it('Arabic has exactly the keys English has, and every message is non-empty', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of [...Object.entries(en), ...Object.entries(ar)])
      expect(v.trim(), k).not.toBe('');
  });

  it('keeps every {placeholder} of the English text in the Arabic text', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [k, v] of Object.entries(en)) expect(names(ar[k]!), k).toEqual(names(v));
  });

  it('has the Reference copy the admin screen promises', () => {
    expect(en[`${ROOT}.admin.title`]).toBe('Platform currencies');
    expect(en[`${ROOT}.admin.eyebrow`]).toBe('Admin · System · Localization');
    expect(en[`${ROOT}.admin.fetchRates`]).toBe('Fetch live rates');
    expect(en[`${ROOT}.admin.ratesUpdated`]).toBe('Updated {count} currencies from {provider}.');
    expect(en[`${ROOT}.admin.default.saved`]).toBe('Default currency set to {code}.');
    expect(en[`${ROOT}.admin.form.added`]).toBe('Currency added.');
    expect(en[`${ROOT}.admin.activated`]).toBe('Activated.');
    expect(en[`${ROOT}.admin.deactivated`]).toBe('Deactivated.');
    expect(en[`${ROOT}.admin.removed`]).toBe('Currency removed.');
    expect(en[`${ROOT}.admin.empty.none`]).toBe('No currencies yet.');
    expect(en[`${ROOT}.admin.empty.search`]).toBe('No matches for "{q}".');
    expect(en[`${ROOT}.workspace.hint`]).toBe(
      'Used on plan checkout, invoices, and wallet display',
    );
    expect(en[`${ROOT}.workspace.ownerOnly`]).toBe('Only the workspace owner can edit these.');
  });

  it('labels every error kind and the dynamic keys the screens build', () => {
    const wanted = [
      ...ERROR_KINDS.map((k) => `${ROOT}.admin.errors.${k}`),
      `${ROOT}.admin.errors.inUseUnknown`,
      ...['invalid', 'forbidden', 'validation', 'network', 'generic'].map(
        (k) => `${ROOT}.workspace.errors.${k}`,
      ),
      ...['on', 'off', 'toggleOn', 'toggleOff'].map((k) => `${ROOT}.admin.${k}`),
    ];
    for (const k of wanted) expect(en[k], k).toBeTypeOf('string');
  });

  it('labels the nav entry (in the Localization group) and the Settings tile', () => {
    const item = OPERATOR_NAV.find((i) => i.id === 'currencies');
    expect(item?.href).toBe('/admin/currencies');
    expect(en[item!.labelKey]).toBeTypeOf('string');
    expect(item!.groupKey).toBe('localization-translation.nav.group');
    for (const tile of currencySettings) {
      for (const k of [tile.labelKey, tile.descriptionKey, tile.keywordsKey]) {
        expect(en[k!], k).toBeTypeOf('string');
        expect(ar[k!], k).toBeTypeOf('string');
      }
    }
  });

  it('every literal t("...") key a component asks for exists in English and Arabic', () => {
    const missing: string[] = [];
    let scanned = 0;
    for (const file of sources(join(__dirname, 'components'))) {
      const src = readFileSync(file, 'utf8');
      const ns = /const NS = '([^']+)'/.exec(src)?.[1] ?? '';
      // The same name (`t`) is bound again in each component, to its own namespace: a binding holds until the next one.
      const found = [...src.matchAll(/const (\w+) = useTranslations\(([^)]*)\)/g)].map((m) => {
        const arg = m[2]!.trim();
        const lit = /^'([^']+)'$/.exec(arg)?.[1];
        const tpl = /^`\$\{NS\}(?:\.([\w.]+))?`$/.exec(arg);
        const base = lit ?? (arg === 'NS' ? ns : tpl ? (tpl[1] ? `${ns}.${tpl[1]}` : ns) : null);
        return { name: m[1]!, base, at: m.index ?? 0 };
      });
      found.forEach((b, i) => {
        if (!b.base || b.base === 'settings') return;
        const next = found.slice(i + 1).find((o) => o.name === b.name)?.at ?? src.length;
        const body = src.slice(b.at, next);
        for (const m of body.matchAll(new RegExp(`\\b${b.name}\\(\\s*'([^']+)'`, 'g'))) {
          const key = `${b.base}.${m[1]}`;
          scanned += 1;
          if (!en[key] || !ar[key]) missing.push(`${file.split('features')[1]}: ${key}`);
        }
      });
    }
    expect(scanned).toBeGreaterThan(60);
    expect(missing).toEqual([]);
  });
});
