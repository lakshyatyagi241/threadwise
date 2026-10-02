import { formatRate, parseRate } from '../money/decimal';
import type { LineTaxInput, TaxCategory } from '../totals/types';
import type {
  FiscalYearConfig,
  NumberingRules,
  RateRow,
  ResolveContext,
  ResolveResult,
  SupplyType,
} from './types';

/** `YYYY-MM-DD` shape check (calendar-valid). */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dim = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][mo - 1]!;
  return d <= dim;
}

/** The row of `rows` in force on `date` (latest `effectiveFrom` wins). Filters: category, region, supply kind. */
export function rateInForce(
  rows: readonly RateRow[],
  q: {
    category?: TaxCategory | string;
    date: string;
    region?: string;
    supply?: SupplyType;
    code?: string;
  },
): RateRow | undefined {
  const candidates = rows.filter((r) => {
    if (q.code && r.code !== q.code) return false;
    if (q.category && r.category !== q.category) return false;
    if (q.region !== undefined && r.region !== undefined && r.region !== q.region) return false;
    if (q.region === undefined && r.region !== undefined) return false;
    if (q.supply && r.appliesTo && !r.appliesTo.includes(q.supply)) return false;
    if (r.effectiveFrom > q.date) return false;
    if (r.effectiveTo && r.effectiveTo < q.date) return false;
    return true;
  });
  return candidates.sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : 0,
  )[0];
}

export function toLineTax(row: RateRow, nameOverride?: string): LineTaxInput {
  return {
    code: row.code,
    name: nameOverride ?? row.name,
    rate: row.ratePercent,
    category: row.category,
  };
}

/** A zero-rated / exempt marker so the tax summary shows the base under its own heading. */
export function zeroTax(code: string, name: string, category: TaxCategory): LineTaxInput {
  return { code, name, rate: '0', category };
}

export function emptyResult(partial: Partial<ResolveResult> = {}): ResolveResult {
  return {
    taxes: [],
    reasons: [],
    warnings: [],
    documentNotes: [],
    reverseCharge: false,
    taxFree: false,
    ...partial,
  };
}

/** The explicit product/override rate, validated; null when none given; throws a plain Error for a malformed one. */
export function explicitRate(
  ctx: ResolveContext,
): { percent: string; source: 'override' | 'product' } | null {
  const raw = ctx.overrideRatePercent ?? ctx.product.ratePercent;
  if (raw === undefined || raw === null || raw === '') return null;
  const ppm = parseRate(raw);
  if (ppm === null || ppm < 0n)
    throw new RangeError(`"${String(raw)}" is not a valid tax rate percent`);
  return {
    percent: formatRate(ppm),
    source: ctx.overrideRatePercent !== undefined ? 'override' : 'product',
  };
}

/** Registered unless the caller says otherwise: whoever picks a tax profile intends to charge tax (a missing id only warns). */
export const isRegistered = (ctx: ResolveContext): boolean => ctx.seller.registered ?? true;

export const isBusiness = (ctx: ResolveContext): boolean =>
  ctx.buyer.type === 'business' || (ctx.buyer.type === undefined && Boolean(ctx.buyer.taxId));

export function withholdingTaxes(
  rows: readonly RateRow[] | undefined,
  ctx: ResolveContext,
  result: ResolveResult,
): LineTaxInput[] {
  const out: LineTaxInput[] = [];
  for (const code of ctx.withholdingCodes ?? []) {
    const row = rateInForce(rows ?? [], { code, date: ctx.date });
    if (!row) {
      result.warnings.push(`Withholding "${code}" is not available on ${ctx.date}; skipped.`);
      continue;
    }
    out.push({ code: row.code, name: row.name, rate: row.ratePercent, category: 'withholding' });
    result.reasons.push(
      `${row.name} withheld at ${row.ratePercent}% (selected). It reduces the amount payable, not the invoice total.`,
    );
  }
  return out;
}

// --- fiscal year & numbering defaults ----------------------------------------------------------------------------------------

export const FY_JAN: FiscalYearConfig = { startMonth: 1, startDay: 1, labelFormat: 'YYYY' };

export function numbering(partial: Partial<NumberingRules> & { rule: string }): NumberingRules {
  return {
    pattern: '{PREFIX}-{YYYY}-{SEQ}',
    defaultPrefix: 'INV',
    seqPad: 4,
    reset: 'yearly',
    gapsAllowed: false,
    ...partial,
  };
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);
