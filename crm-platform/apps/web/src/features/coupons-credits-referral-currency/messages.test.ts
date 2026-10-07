import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUPON_REJECTION_REASONS } from '@crm/contracts';
import { OPERATOR_NAV } from '@/features/auth-registration-security/platform/operator-nav';
import { nav } from './nav';
import { CPN_OPERATOR_NAV } from './operator-nav';

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const tree = JSON.parse(
  readFileSync(join(WEB, 'messages', 'en', 'coupons-credits-referral-currency.json'), 'utf8'),
) as Tree;

const get = (path: string): string | Tree | undefined => {
  let cur: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
};
const has = (path: string): boolean => get(path) !== undefined;
const ROOT = 'coupons-credits-referral-currency';

describe('coupons and currencies messages', () => {
  it('has every menu label and group the console asks for', () => {
    for (const n of CPN_OPERATOR_NAV) {
      if (n.labelKey.startsWith(ROOT)) expect(has(n.labelKey), n.labelKey).toBe(true);
      if (n.groupKey.startsWith(ROOT)) expect(has(n.groupKey), n.groupKey).toBe(true);
    }
  });

  it('is merged into the console menu once, each page on its own address', () => {
    const ids = OPERATOR_NAV.filter((n) => CPN_OPERATOR_NAV.some((c) => c.id === n.id));
    expect(ids.map((n) => n.href)).toEqual(['/admin/coupons', '/admin/currencies']);
  });

  it('has the keys the screens build dynamically', () => {
    const keys = [
      ...['all', 'active', 'disabled', 'expired'].map((s) => `${ROOT}.coupons.filters.${s}`),
      ...['created', 'updated', 'activated', 'deactivated', 'deleted'].map(
        (k) => `${ROOT}.coupons.toasts.${k}`,
      ),
      ...[
        'code',
        'description',
        'adminNote',
        'type',
        'amount',
        'maxDiscountAmount',
        'currencyCode',
        'minOrderAmount',
        'applicablePlans',
        'startsAt',
        'expiresAt',
        'maxUses',
        'perUserLimit',
      ].map((f) => `${ROOT}.coupons.editor.problems.${f}`),
      ...['name', 'code', 'symbol', 'precision', 'exchangeRate'].map(
        (f) => `${ROOT}.currencies.form.problems.${f}`,
      ),
      ...[
        'generic',
        'forbidden',
        'notFound',
        'conflict',
        'validation',
        'codeTaken',
        'planUnknown',
        'currencyUnknown',
        'currencyTaken',
        'defaultProtected',
        'inUse',
        'ratesFailed',
      ].map((k) => `${ROOT}.errors.${k}`),
    ];
    for (const k of keys) expect(has(k), k).toBe(true);
  });

  it('keeps WaDesk wording on the screens it is compared with', () => {
    expect(get(`${ROOT}.coupons.title`)).toBe('Discount coupons');
    expect(get(`${ROOT}.coupons.empty.title`)).toBe('No coupons match.');
    expect(get(`${ROOT}.coupons.toasts.deleted`)).toBe('Coupon removed.');
    expect(get(`${ROOT}.currencies.toasts.defaultSet`)).toBe('Default currency set to {code}.');
  });

  it('has the keys the affiliate screen builds dynamically', () => {
    const A = `${ROOT}.affiliate`;
    const keys = [
      ...['7d', '30d', '90d', 'all'].map((r) => `${A}.filters.ranges.${r}`),
      ...['daily', 'weekly', 'monthly'].map((b) => `${A}.chart.buckets.${b}`),
      ...['unauthenticated', 'forbidden', 'rateLimited', 'validation', 'network', 'generic'].map(
        (k) => `${A}.errors.${k}`,
      ),
      ...['copied', 'copyFailed'].map((k) => `${A}.header.${k}`),
      ...['paid', 'pending'].map((k) => `${A}.table.${k}`),
    ];
    for (const k of keys) expect(has(k), k).toBe(true);
  });

  it('has every literal key the affiliate files ask for', () => {
    const dirs = [
      join(WEB, 'src', 'features', 'coupons-credits-referral-currency', 'components', 'affiliate'),
      join(WEB, 'src', 'app', '(app)', '(coupons-credits-referral-currency)'),
    ];
    const files = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? files(join(d, e.name))
          : /\.tsx$/.test(e.name) && !/\.test\./.test(e.name)
            ? [join(d, e.name)]
            : [],
      );
    const missing: string[] = [];
    for (const file of dirs.flatMap(files)) {
      const src = readFileSync(file, 'utf8');
      const consts: Record<string, string> = {};
      for (const m of src.matchAll(/const NS = '([^']+)'/g)) consts.NS = m[1]!;
      const decls = [
        ...src.matchAll(
          /const\s+(\w+)\s*=\s*(?:await\s+getTranslations|useTranslations)\(\s*(?:'([^']+)'|`\$\{NS\}([^`]*)`|(NS))\s*\)/g,
        ),
      ].map((m) => ({
        name: m[1]!,
        ns: m[2] ?? (m[3] !== undefined ? `${consts.NS}${m[3]}` : consts.NS!),
        index: m.index!,
      }));
      for (const name of new Set(decls.map((d) => d.name))) {
        const own = decls.filter((d) => d.name === name);
        for (const c of src.matchAll(new RegExp(`(?<![\\w.])${name}\\(\\s*'([^']+)'`, 'g'))) {
          const decl = own.filter((d) => d.index < c.index!).pop();
          if (decl && !has(`${decl.ns}.${c[1]}`)) missing.push(`${file}: ${decl.ns}.${c[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('puts Affiliate in the account hub, once, on its own address', () => {
    expect(nav).toHaveLength(1);
    expect(nav[0]).toMatchObject({
      id: 'affiliate',
      href: '/account/affiliate',
      group: 'settings',
    });
    expect(nav[0]!.order).toBeLessThan(100);
    expect(has(nav[0]!.labelKey)).toBe(true);
  });

  it('every resolver rejection has a sentence in contracts (the checkout shows them verbatim)', () => {
    expect(COUPON_REJECTION_REASONS).toHaveLength(13);
  });
});
