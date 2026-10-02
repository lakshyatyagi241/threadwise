import { applyCashRounding } from '../money/cash';
import { currencyExponent } from '../money/currency';
import { formatRate, parseRate, RATE_DENOM } from '../money/decimal';
import { allocate, DEFAULT_ROUNDING_MODE, divRound, type RoundingMode } from '../money/rounding';
import { settle } from './settle';
import {
  TaxMathError,
  type DiscountInput,
  type DocumentInput,
  type DocumentResult,
  type LineInput,
  type LineKind,
  type LineResult,
  type LineTaxInput,
  type LineTaxResult,
  type RoundingLevel,
  type TaxCategory,
  type TaxSummaryRow,
  type WithholdingSummaryRow,
} from './types';

/**
 * THE totals function. One pure implementation for proposals, estimates, invoices, credit notes and the live preview in the web
 * form, so what the buyer is shown is what is saved to the minor unit.
 *
 * Everything is `bigint`. Intermediate amounts are carried at "high precision" (minor units x 10^10) so multiplying by a
 * quantity with 4 decimals or a rate with 4 decimals of a percent is EXACT; rounding to a whole minor unit happens only where the
 * `rounding.level` says (see types.ts). Steps, in order:
 *
 *   1. line gross      = qty x unit price
 *   2. line discount   = percent of gross | amount (capped at gross)
 *   3. line net        = gross - discount
 *   4. subtotal        = sum of item-line nets
 *   5. document discount = percent of subtotal | amount (capped); spread over the discountable lines by net with the
 *                          largest-remainder method, so the shares add back to the discount exactly
 *   6. taxable         = net - share
 *   7. taxes per line  exclusive: tax = taxable x rate (compound taxes are charged on taxable + the taxes before them)
 *                      inclusive: net = taxable / (1 + combined rate), tax = taxable - net, split across the line's taxes by
 *                                 largest remainder, so net + taxes == taxable always
 *                      withholding (negative taxes) are charged on the ex-tax amount and reduce the amount payable only
 *   8. total           = taxable (+ exclusive taxes); cash rounding adds its own adjustment line
 *   9. payable         = total - withholding; amount due = payable - payments - credits
 */

const HP = 10n ** 10n; // high-precision scale: minor units x 10^10
const INCL_DEN = 10n ** 12n;
const QTY_ONE = 10_000n;
const MAX_MINOR = 1_000_000_000_000_000n;

interface ParsedTax {
  code: string;
  name: string;
  ppm: bigint; // signed; negative = withholding
  category: TaxCategory;
  compound: boolean;
  withholding: boolean;
}

function parseTax(t: LineTaxInput, path: string): ParsedTax {
  const ppm = parseRate(t.rate);
  if (ppm === null) throw new TaxMathError(path, 'a tax rate is a percent with at most 4 decimals');
  const withholding = t.category === 'withholding' || ppm < 0n;
  if (!withholding && ppm > 100n * 10_000n * 10n)
    throw new TaxMathError(path, 'a tax rate cannot exceed 1000%');
  let signed = ppm;
  if (withholding && ppm > 0n) signed = -ppm;
  return {
    code: t.code,
    name: t.name,
    ppm: signed,
    category: withholding ? 'withholding' : (t.category ?? 'standard'),
    compound: t.compound === true,
    withholding,
  };
}

function parseDiscount(
  d: DiscountInput | undefined,
  path: string,
): { kind: 'none' } | { kind: 'percent'; ppm: bigint } | { kind: 'amount'; hp: bigint } {
  if (!d || d.kind === 'none') return { kind: 'none' };
  if (d.kind === 'percent') {
    const ppm = parseRate(d.percent);
    if (ppm === null || ppm < 0n || ppm > 1_000_000n) {
      throw new TaxMathError(
        path,
        'a percent discount is between 0 and 100 with at most 4 decimals',
      );
    }
    return { kind: 'percent', ppm };
  }
  if (d.minor < 0n) throw new TaxMathError(path, 'a discount amount cannot be negative');
  return { kind: 'amount', hp: d.minor * HP };
}

interface Ctx {
  level: RoundingLevel;
  mode: RoundingMode;
  /** Rounds an hp amount to a whole minor unit (still at hp scale) when the level is per_line; identity for on_total. */
  step: (x: bigint) => bigint;
  /** Rounds an hp amount to minor units for display / totals. */
  minor: (x: bigint) => bigint;
  mulRate: (x: bigint, ppm: bigint) => bigint;
}

function makeCtx(level: RoundingLevel, mode: RoundingMode): Ctx {
  return {
    level,
    mode,
    step: level === 'per_line' ? (x) => divRound(x, HP, mode) * HP : (x) => x,
    minor: (x) => divRound(x, HP, mode),
    mulRate: (x, ppm) => divRound(x * ppm, RATE_DENOM, mode),
  };
}

function applyDiscountHp(base: bigint, d: ReturnType<typeof parseDiscount>, c: Ctx): bigint {
  if (base <= 0n) return 0n;
  if (d.kind === 'percent') return c.step(c.mulRate(base, d.ppm));
  if (d.kind === 'amount') return d.hp < base ? d.hp : base;
  return 0n;
}

interface HpTaxRow {
  tax: ParsedTax;
  baseHp: bigint;
  amountHp: bigint; // signed
}

function lineTaxes(
  taxableHp: bigint,
  taxes: ParsedTax[],
  inclusive: boolean,
  c: Ctx,
): { rows: HpTaxRow[]; netHp: bigint } {
  const positive = taxes.filter((t) => !t.withholding);
  const withheld = taxes.filter((t) => t.withholding);
  const rows: HpTaxRow[] = [];
  let netHp = taxableHp;

  if (!inclusive) {
    let prior = 0n;
    for (const t of positive) {
      const base = t.compound ? taxableHp + prior : taxableHp;
      const amount = c.step(c.mulRate(base, t.ppm));
      prior += amount;
      rows.push({ tax: t, baseHp: base, amountHp: amount });
    }
  } else {
    // weight_k = what tax k adds to a price of 1 (in 1/10^12), honouring compounding.
    let prior = 0n;
    const weights: bigint[] = [];
    for (const t of positive) {
      const base = t.compound ? INCL_DEN + prior : INCL_DEN;
      const w = divRound(base * t.ppm, RATE_DENOM, 'half_even');
      weights.push(w);
      prior += w;
    }
    const multiplier = INCL_DEN + prior;
    if (prior !== 0n) {
      netHp = c.step(divRound(taxableHp * INCL_DEN, multiplier, c.mode));
    }
    const taxTotal = taxableHp - netHp;
    const amounts =
      c.level === 'per_line'
        ? allocate(taxTotal / HP, weights).map((x) => x * HP)
        : allocate(taxTotal, weights);
    let priorAmount = 0n;
    positive.forEach((t, i) => {
      const base = t.compound ? netHp + priorAmount : netHp;
      priorAmount += amounts[i]!;
      rows.push({ tax: t, baseHp: base, amountHp: amounts[i]! });
    });
  }
  for (const t of withheld) {
    const amount = -c.step(c.mulRate(netHp, -t.ppm));
    rows.push({ tax: t, baseHp: netHp, amountHp: amount });
  }
  return { rows, netHp };
}

interface Work {
  input: LineInput;
  kind: LineKind;
  taxes: ParsedTax[];
  inclusive: boolean;
  grossHp: bigint;
  lineDiscHp: bigint;
  netHp: bigint;
  shareHp: bigint;
  taxableHp: bigint;
  rows: HpTaxRow[];
}

function validateLine(l: LineInput, i: number): void {
  const p = `lines.${i}`;
  const qty = l.qtyScaled ?? QTY_ONE;
  if (qty < 0n) throw new TaxMathError(`${p}.qty`, 'a quantity cannot be negative');
  if (l.unitPriceMinor < 0n && l.kind !== 'adjustment') {
    throw new TaxMathError(`${p}.unitPrice`, 'only an adjustment line can have a negative amount');
  }
  const abs =
    (qty < 0n ? -qty : qty) * (l.unitPriceMinor < 0n ? -l.unitPriceMinor : l.unitPriceMinor);
  if (abs / QTY_ONE >= MAX_MINOR) throw new TaxMathError(`${p}.unitPrice`, 'amount is too large');
}

/** Throws `TaxMathError` (with the offending `path`) for an unrepresentable or invalid input. */
export function calculateDocument(input: DocumentInput): DocumentResult {
  const level: RoundingLevel = input.rounding?.level ?? 'per_line';
  const mode: RoundingMode = input.rounding?.mode ?? DEFAULT_ROUNDING_MODE;
  const c = makeCtx(level, mode);
  const docInclusive = input.pricesIncludeTax === true;
  const docDiscount = parseDiscount(input.discount, 'discount');

  const work: Work[] = input.lines.map((l, i) => {
    validateLine(l, i);
    const taxes = (l.taxes ?? []).map((t, k) => parseTax(t, `lines.${i}.taxes.${k}`));
    const kind: LineKind = l.kind ?? 'item';
    const qty = l.qtyScaled ?? QTY_ONE;
    // qty has 4 decimals, so qty x price (minor) x 10^6 is exact at hp scale.
    const grossHp = c.step(qty * l.unitPriceMinor * (HP / QTY_ONE));
    const disc = parseDiscount(l.discount, `lines.${i}.discount`);
    const lineDiscHp = applyDiscountHp(grossHp, disc, c);
    return {
      input: l,
      kind,
      taxes,
      inclusive: l.taxInclusive ?? docInclusive,
      grossHp,
      lineDiscHp,
      netHp: grossHp - lineDiscHp,
      shareHp: 0n,
      taxableHp: 0n,
      rows: [],
    };
  });

  const discountable = (w: Work) => w.input.discountable ?? w.kind === 'item';
  const itemNetHp = work.filter((w) => w.kind === 'item').reduce((a, w) => a + w.netHp, 0n);
  const discPool = work
    .filter(discountable)
    .reduce((a, w) => a + (w.netHp > 0n ? w.netHp : 0n), 0n);
  const docDiscHp = applyDiscountHp(discPool, docDiscount, c);
  const weights = work.map((w) => (discountable(w) && w.netHp > 0n ? w.netHp : 0n));
  const shares =
    c.level === 'per_line'
      ? allocate(
          docDiscHp / HP,
          weights.map((x) => x / HP),
        ).map((x) => x * HP)
      : allocate(docDiscHp, weights);
  work.forEach((w, i) => {
    w.shareHp = shares[i]!;
    w.taxableHp = w.netHp - w.shareHp;
    const r = lineTaxes(w.taxableHp, w.taxes, w.inclusive, c);
    w.rows = r.rows;
  });

  // ---- per-line results -------------------------------------------------------------------------------------------------
  const lines: LineResult[] = work.map((w, index) => {
    const taxRes: LineTaxResult[] = w.rows.map((r) => ({
      code: r.tax.code,
      name: r.tax.name,
      ratePercent: formatRate(r.tax.ppm < 0n ? -r.tax.ppm : r.tax.ppm),
      category: r.tax.category,
      compound: r.tax.compound,
      baseMinor: c.minor(r.baseHp),
      amountMinor: c.minor(r.amountHp),
    }));
    const posHp = w.rows.filter((r) => !r.tax.withholding).reduce((a, r) => a + r.amountHp, 0n);
    const whHp = -w.rows.filter((r) => r.tax.withholding).reduce((a, r) => a + r.amountHp, 0n);
    return {
      index,
      ...(w.input.id !== undefined ? { id: w.input.id } : {}),
      kind: w.kind,
      grossMinor: c.minor(w.grossHp),
      discountMinor: c.minor(w.lineDiscHp),
      netMinor: c.minor(w.netHp),
      sharedDiscountMinor: c.minor(w.shareHp),
      taxableMinor: c.minor(w.taxableHp),
      inclusive: w.inclusive,
      taxes: taxRes,
      taxMinor: c.minor(posHp),
      withholdingMinor: c.minor(whHp),
      totalMinor: c.minor(w.taxableHp + (w.inclusive ? 0n : posHp)),
    };
  });

  // ---- tax summary (grouped) --------------------------------------------------------------------------------------------
  interface Acc {
    row: Omit<TaxSummaryRow, 'baseMinor' | 'taxMinor'>;
    baseHp: bigint;
    taxHp: bigint;
  }
  const groups = new Map<string, Acc>();
  const wgroups = new Map<
    string,
    {
      row: Omit<WithholdingSummaryRow, 'baseMinor' | 'amountMinor'>;
      baseHp: bigint;
      amountHp: bigint;
    }
  >();
  for (const w of work) {
    for (const r of w.rows) {
      const rate = formatRate(r.tax.ppm < 0n ? -r.tax.ppm : r.tax.ppm);
      if (r.tax.withholding) {
        const key = `${r.tax.code}|${rate}`;
        const g = wgroups.get(key) ?? {
          row: { key, code: r.tax.code, name: r.tax.name, ratePercent: rate },
          baseHp: 0n,
          amountHp: 0n,
        };
        g.baseHp += r.baseHp;
        g.amountHp += -r.amountHp;
        wgroups.set(key, g);
      } else {
        const key = `${r.tax.code}|${rate}|${r.tax.category}|${w.inclusive ? 'incl' : 'excl'}`;
        const g = groups.get(key) ?? {
          row: {
            key,
            code: r.tax.code,
            name: r.tax.name,
            ratePercent: rate,
            category: r.tax.category,
            inclusive: w.inclusive,
          },
          baseHp: 0n,
          taxHp: 0n,
        };
        g.baseHp += r.baseHp;
        g.taxHp += r.amountHp;
        groups.set(key, g);
      }
    }
  }
  const byRate = (
    a: { code: string; ratePercent: string },
    b: { code: string; ratePercent: string },
  ) => a.code.localeCompare(b.code) || Number(b.ratePercent) - Number(a.ratePercent);
  const taxSummary: TaxSummaryRow[] = [...groups.values()]
    .map((g) => ({ ...g.row, baseMinor: c.minor(g.baseHp), taxMinor: c.minor(g.taxHp) }))
    .sort(byRate);
  const withholdingSummary: WithholdingSummaryRow[] = [...wgroups.values()]
    .map((g) => ({ ...g.row, baseMinor: c.minor(g.baseHp), amountMinor: c.minor(g.amountHp) }))
    .sort(byRate);

  // ---- document figures -------------------------------------------------------------------------------------------------
  const sumNet = (kind: LineKind) =>
    work.filter((w) => w.kind === kind).reduce((a, w) => a + w.netHp, 0n);
  const subtotalMinor = c.minor(itemNetHp);
  const discountMinor = c.minor(docDiscHp);
  const shippingMinor = c.minor(sumNet('shipping'));
  const adjustmentMinor = c.minor(sumNet('adjustment'));
  const taxableMinor = subtotalMinor - discountMinor + shippingMinor + adjustmentMinor;
  const taxMinor = taxSummary.reduce((a, r) => a + r.taxMinor, 0n);
  const taxAddedMinor = taxSummary.filter((r) => !r.inclusive).reduce((a, r) => a + r.taxMinor, 0n);
  const withholdingMinor = withholdingSummary.reduce((a, r) => a + r.amountMinor, 0n);
  const totalBeforeRoundingMinor = taxableMinor + taxAddedMinor;
  const cash = input.cashRounding
    ? applyCashRounding(totalBeforeRoundingMinor, input.cashRounding)
    : null;
  const roundingMinor = cash?.adjustmentMinor ?? 0n;
  const totalMinor = totalBeforeRoundingMinor + roundingMinor;
  if (totalMinor >= MAX_MINOR || totalMinor <= -MAX_MINOR)
    throw new TaxMathError('lines', 'amount is too large');
  const payableMinor = totalMinor - withholdingMinor;
  const s = settle({ payableMinor, payments: input.payments, credits: input.credits });

  return {
    currency: input.currency.toUpperCase(),
    exponent: currencyExponent(input.currency),
    roundingLevel: level,
    roundingMode: mode,
    pricesIncludeTax: docInclusive,
    lines,
    subtotalMinor,
    discountMinor,
    shippingMinor,
    adjustmentMinor,
    taxableMinor,
    taxMinor,
    taxAddedMinor,
    taxSummary,
    withholdingMinor,
    withholdingSummary,
    totalBeforeRoundingMinor,
    roundingMinor,
    totalMinor,
    payableMinor,
    paidMinor: s.paidMinor,
    creditedMinor: s.creditedMinor,
    amountDueMinor: s.amountDueMinor,
    overpaidMinor: s.overpaidMinor,
    paymentStatus: s.status,
  };
}

/** Same as `calculateDocument` but returns the problem instead of throwing, for forms and APIs that answer 422 with a path. */
export function tryCalculateDocument(
  input: DocumentInput,
): { ok: true; value: DocumentResult } | { ok: false; issue: { path: string; message: string } } {
  try {
    return { ok: true, value: calculateDocument(input) };
  } catch (err) {
    if (err instanceof TaxMathError)
      return { ok: false, issue: { path: err.path, message: err.message } };
    throw err;
  }
}

/** Converts a tax-inclusive price into net + tax using the same rules as `calculateDocument` (one unit, no discount). */
export function netFromGross(
  grossMinor: bigint,
  taxes: readonly LineTaxInput[],
  opts: { level?: RoundingLevel; mode?: RoundingMode } = {},
): { netMinor: bigint; taxMinor: bigint } {
  const r = calculateDocument({
    currency: 'USD',
    pricesIncludeTax: true,
    rounding: opts,
    lines: [{ unitPriceMinor: grossMinor, taxes, kind: 'adjustment' }],
  });
  const line = r.lines[0]!;
  return { netMinor: line.taxableMinor - line.taxMinor, taxMinor: line.taxMinor };
}

/** Converts a tax-exclusive price into the gross price a buyer pays (net + taxes). */
export function grossFromNet(
  netMinor: bigint,
  taxes: readonly LineTaxInput[],
  opts: { level?: RoundingLevel; mode?: RoundingMode } = {},
): { grossMinor: bigint; taxMinor: bigint } {
  const r = calculateDocument({
    currency: 'USD',
    pricesIncludeTax: false,
    rounding: opts,
    lines: [{ unitPriceMinor: netMinor, taxes, kind: 'adjustment' }],
  });
  const line = r.lines[0]!;
  return { grossMinor: line.totalMinor, taxMinor: line.taxMinor };
}
