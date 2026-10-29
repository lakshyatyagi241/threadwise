import { minorOfScaled, mulScaled, plainDecimal, scaled } from '../credits/decimal';
import { str, type Doc } from '../util';

/**
 * Per-workspace pricing: the workspace's OWN `credits_mapping_new` (Waboo copies the platform card into every workspace database
 * when it is created and a reseller edits the copy for a sub-account) -> `workspace_message_margins`.
 *
 * What Waboo charged for one message is `round2(price + margin)`, both absolute amounts (Broadcast/Credits.py). The application
 * prices a message as Meta cost x (1 + margin bps) in `margin` mode, so the migrated value is the integer margin that makes the
 * application charge EXACTLY that many hundredths against the Meta cost the application holds. Nothing is approximated silently:
 * a key whose charge cannot be reproduced is reported and not written (its price then falls to the plan / platform layer).
 */

const CATEGORIES = ['authentication', 'marketing', 'service', 'utility'] as const;
export const MARGIN_BPS_MIN = -10_000;
export const MARGIN_BPS_MAX = 100_000;
const MAX_CHARGE_MINOR = 100_000_000n;

/** Same formula as `priceFromMargin` in packages/contracts (a test pins the two against each other). */
export function priceFromMargin(metaCostMicros: number, marginBps: number): number {
  if (metaCostMicros <= 0 || marginBps <= MARGIN_BPS_MIN) return 0;
  const minor = Math.round((metaCostMicros * (10_000 + marginBps)) / 100_000_000);
  return Math.max(1, minor);
}

export interface MetaCostRow {
  country: string;
  category: string;
  micros: number | null;
}

/** First row of: country+category, country, category, default, that carries a cost (the application's own lookup order). */
export function metaCostOf(
  rows: readonly MetaCostRow[],
  country: string,
  category: string,
): number | null {
  for (const [cc, kk] of [
    [country, category],
    [country, ''],
    ['', category],
    ['', ''],
  ] as Array<[string, string]>) {
    const hit = rows.find((r) => r.country === cc && r.category === kk && r.micros !== null);
    if (hit) return hit.micros;
  }
  return null;
}

/** The integer margin whose charge is exactly `targetMinor` hundredths for this Meta cost, or null when none exists. */
export function marginBpsFor(metaCostMicros: number, targetMinor: number): number | null {
  if (targetMinor === 0) return MARGIN_BPS_MIN; // free
  if (metaCostMicros <= 0) return null;
  const ideal = Math.round((targetMinor * 100_000_000) / metaCostMicros - 10_000);
  let best: number | null = null;
  for (let d = -3; d <= 3; d++) {
    const bps = ideal + d;
    if (bps <= MARGIN_BPS_MIN || bps > MARGIN_BPS_MAX) continue;
    if (priceFromMargin(metaCostMicros, bps) !== targetMinor) continue;
    if (best === null || Math.abs(bps - ideal) < Math.abs(best - ideal)) best = bps;
  }
  return best;
}

export interface WorkspaceMarginRow {
  country: string;
  category: string;
  marginBps: number;
  /** what Waboo charged, hundredths of the platform currency */
  chargeMinor: number;
  metaCostMicros: number | null;
  /** the document and category it came from */
  from: string;
  /** the exact Waboo figures, as text, for the audit trail */
  price: string;
  margin: string;
}
export interface WorkspaceMarginIssue {
  doc: string;
  code:
    | 'NO_COUNTRY_CODE'
    | 'DUPLICATE_COUNTRY'
    | 'NO_WHATSAPP'
    | 'BAD_PRICE'
    | 'PRICE_OVER_LIMIT'
    | 'NO_META_COST'
    | 'NOT_REPRESENTABLE'
    | 'MODEL_DOC_SKIPPED'
    | 'CONFIG_DOC_SKIPPED';
  reason: string;
}
export interface WorkspaceMarginPlan {
  rows: WorkspaceMarginRow[];
  issues: WorkspaceMarginIssue[];
  docs: number;
}

const isObj = (v: unknown): v is Doc =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

/** price and margin of one category: {price, margin}; a bare number is the price with margin 0. A missing margin is 0 (Waboo's own default). */
function parts(v: unknown): { price: string | null; margin: string } {
  if (isObj(v)) {
    const price = plainDecimal(v.price);
    const margin = v.margin === undefined || v.margin === null ? '0' : plainDecimal(v.margin);
    return { price, margin: margin ?? 'bad' };
  }
  return { price: plainDecimal(v), margin: '0' };
}

export function planWorkspaceMargins(
  docs: Doc[],
  costs: readonly MetaCostRow[],
  factorText: string,
): WorkspaceMarginPlan {
  const f = plainDecimal(factorText);
  if (f === null || f.startsWith('-') || scaled(f) === 0n)
    throw new Error('the factor must be a positive decimal such as 1 or 0.012');
  const factor = scaled(f);
  const plan: WorkspaceMarginPlan = { rows: [], issues: [], docs: docs.length };
  const seen = new Set<string>();
  const issue = (doc: string, code: WorkspaceMarginIssue['code'], reason: string): void => {
    plan.issues.push({ doc, code, reason });
  };
  for (const d of docs) {
    const name = str(d.name) ?? '(no name)';
    if (Array.isArray(d.models)) {
      issue(name, 'MODEL_DOC_SKIPPED', 'AI model price list (never read)');
      continue;
    }
    if (d.conversion_rate !== undefined || d.country_currency !== undefined) {
      issue(name, 'CONFIG_DOC_SKIPPED', 'currency / conversion config');
      continue;
    }
    const isOther = name.toLowerCase() === 'other';
    const code = (str(d.code) ?? '').toUpperCase();
    if (!isOther && !/^[A-Z]{2}$/.test(code)) {
      issue(name, 'NO_COUNTRY_CODE', 'no two-letter ISO code');
      continue;
    }
    const country = isOther ? '' : code;
    if (seen.has(country)) {
      issue(name, 'DUPLICATE_COUNTRY', 'a second document for the same country: the first wins');
      continue;
    }
    seen.add(country);
    const wa = isObj(d.whatsapp) ? d.whatsapp : null;
    if (!wa) {
      issue(name, 'NO_WHATSAPP', 'no whatsapp prices');
      continue;
    }
    for (const cat of CATEGORIES) {
      const at = `${name}/${cat}`;
      const p = parts(wa[cat]);
      if (
        p.price === null ||
        p.margin === 'bad' ||
        p.price.startsWith('-') ||
        p.margin.startsWith('-')
      ) {
        issue(at, 'BAD_PRICE', 'price or margin is missing, not a number or negative');
        continue;
      }
      const total = minorOfScaled(mulScaled(scaled(p.price) + scaled(p.margin), factor));
      if (total > MAX_CHARGE_MINOR) {
        issue(at, 'PRICE_OVER_LIMIT', 'above the 1,000,000.00 limit');
        continue;
      }
      const micros = metaCostOf(costs, country, cat);
      if (micros === null) {
        issue(
          at,
          'NO_META_COST',
          'the application holds no Meta cost for this country and category: the margin cannot be derived',
        );
        continue;
      }
      const bps = marginBpsFor(micros, Number(total));
      if (bps === null) {
        issue(
          at,
          'NOT_REPRESENTABLE',
          `no margin makes ${Number(total) / 100} out of a Meta cost of ${micros} micros`,
        );
        continue;
      }
      plan.rows.push({
        country,
        category: cat,
        marginBps: bps,
        chargeMinor: Number(total),
        metaCostMicros: micros,
        from: name,
        price: p.price,
        margin: p.margin,
      });
    }
  }
  return plan;
}

export interface DbMarginRow {
  country: string;
  category: string;
  marginBps: number;
}
export interface MarginVerdict {
  missing: string[];
  extra: string[];
  wrongMargin: string[];
  /** rows whose stored margin does not reproduce the Waboo charge against the Meta cost the application holds NOW */
  wrongCharge: string[];
  ok: boolean;
}
const keyOf = (r: { country: string; category: string }): string =>
  `${r.country || '(default)'}|${r.category}`;

/** The read-back check: every planned row is in the table with the planned margin and charges exactly what Waboo charged; nothing else is there. */
export function verifyWorkspaceMargins(
  plan: WorkspaceMarginPlan,
  stored: readonly DbMarginRow[],
  costs: readonly MetaCostRow[],
): MarginVerdict {
  const have = new Map(stored.map((r) => [keyOf(r), r.marginBps]));
  const want = new Map(plan.rows.map((r) => [keyOf(r), r]));
  const v: MarginVerdict = { missing: [], extra: [], wrongMargin: [], wrongCharge: [], ok: false };
  for (const [k, r] of want) {
    const got = have.get(k);
    if (got === undefined) {
      v.missing.push(k);
      continue;
    }
    if (got !== r.marginBps) v.wrongMargin.push(`${k}: ${got} vs ${r.marginBps}`);
    const micros = metaCostOf(costs, r.country, r.category);
    if (micros === null || priceFromMargin(micros, got) !== r.chargeMinor)
      v.wrongCharge.push(`${k}: waboo ${r.chargeMinor / 100}`);
  }
  for (const k of have.keys()) if (!want.has(k)) v.extra.push(k);
  v.ok = !v.missing.length && !v.extra.length && !v.wrongMargin.length && !v.wrongCharge.length;
  return v;
}
