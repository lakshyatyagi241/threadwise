import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PAYGW_REGIONS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { OPERATOR_NAV } from '../auth-registration-security/platform/operator-nav';

/** next-intl prints the key path when a message is missing, so every key a component asks for must exist. */
type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const root = JSON.parse(
  readFileSync(join(WEB, 'messages/en/platform-payment-gateways.json'), 'utf8'),
) as Tree;
const ROOT = 'platform-payment-gateways';

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const en = flatten(root);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

describe('platform payment gateways messages', () => {
  it('every message is non-empty', () => {
    for (const [k, v] of Object.entries(en)) expect(v.trim(), k).not.toBe('');
  });

  it('labels every region, status and nav entry the screens look up by name', () => {
    const wanted = [
      ...PAYGW_REGIONS.map((r) => `${ROOT}.admin.regions.${r}`),
      ...(['pending', 'awaiting_approval', 'paid', 'failed', 'cancelled', 'refunded'] as const).map(
        (s) => `${ROOT}.orders.status.${s}`,
      ),
      ...(['success', 'failed', 'cancelled', 'pending', 'notfound'] as const).map(
        (s) => `${ROOT}.orders.outcome.${s}`,
      ),
      ...(['monthly', 'yearly'] as const).flatMap((p) => [
        `${ROOT}.checkout.periods.${p}`,
        `${ROOT}.checkout.billed.${p}`,
      ]),
      ...[
        'gatewayUnavailable',
        'currencyUnsupported',
        'providerError',
        'notPurchasable',
        'downgrade',
        'amountTooLow',
        'forbidden',
        'notFound',
        'widgetBlocked',
        'couponRejected',
        'generic',
      ].map((k) => `${ROOT}.checkout.errors.${k}`),
      ...[
        'label',
        'placeholder',
        'apply',
        'checking',
        'applied',
        'enterCode',
        'networkError',
        'throttled',
        'discountRow',
      ].map((k) => `${ROOT}.checkout.coupon.${k}`),
      `${ROOT}.admin.card.mode.sandbox`,
      `${ROOT}.admin.card.mode.live`,
    ];
    for (const k of wanted) expect(en[k], k).toBeTypeOf('string');
    for (const item of OPERATOR_NAV.filter((i) => i.labelKey.startsWith(ROOT))) {
      expect(en[item.labelKey], item.labelKey).toBeTypeOf('string');
      expect(en[item.groupKey], item.groupKey).toBeTypeOf('string');
    }
  });

  it('every literal t("...") key a component asks for exists', () => {
    const missing: string[] = [];
    for (const file of sources(join(__dirname, 'components'))) {
      const src = readFileSync(file, 'utf8');
      const ns = /const NS = '([^']+)'/.exec(src)?.[1] ?? '';
      const bindings = new Map<string, string>();
      for (const m of src.matchAll(/const (\w+) = useTranslations\(([^)]*)\)/g)) {
        const arg = m[2]!.trim();
        const lit = /^'([^']+)'$/.exec(arg)?.[1];
        const tpl = /^`\$\{NS\}(?:\.([\w.]+))?`$/.exec(arg);
        const base = lit ?? (arg === 'NS' ? ns : tpl ? (tpl[1] ? `${ns}.${tpl[1]}` : ns) : null);
        if (base) bindings.set(m[1]!, base);
      }
      for (const [name, base] of bindings) {
        for (const m of src.matchAll(new RegExp(`\\b${name}\\(\\s*'([^']+)'`, 'g'))) {
          if (!en[`${base}.${m[1]}`]) missing.push(`${file.split('features')[1]}: ${base}.${m[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
