import { HttpStatus } from '@nestjs/common';
import {
  calculateDocument,
  formatRate,
  parseRate,
  TaxMathError,
  type DiscountInput,
  type LineInput,
  type LineTaxInput,
} from '@crm/tax';
import {
  ERROR_CODES,
  TAX_TYPES,
  currencyExponent,
  formatPercent,
  minorToMajor,
  parseMajor,
  parsePercentBp,
  parseQty,
  type WireDiscount,
} from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { InvoiceLineRow, LineInsert, SummaryInsert } from './invoices.repository';

/**
 * Turns the lines of an invoice into priced rows. This is the ONE place an invoice is priced: every path that writes lines (a
 * hand-made draft, an edit, a copy, a quote converted to an invoice, an order, a credit note, a recurring run) builds `LineSpec`s and
 * calls `priceInvoice`, which calls `calculateDocument` of @crm/tax (docs/tax-engine.md): per-line rounding, half up, one or
 * several taxes per line (CGST + SGST), inclusive or exclusive, the document discount spread by largest remainder, shipping as an
 * undiscounted and untaxed line. Proposals and estimates price through the same engine, so a quote and the invoice made from it
 * agree to the minor unit.
 */

/** One tax charged on a line: a country's CGST, a simple VAT rate, a Canadian PST. */
export interface TaxItem {
  /** Groups the tax summary: "CGST", "SGST", or the rate's own name for a simple rate. */
  code: string;
  /** Printed: "CGST 9%". */
  name: string;
  /** Percent, up to 4 decimals ("9.975"). */
  ratePercent: string;
  compound?: boolean;
}

/** A tax as a line carries it: a SNAPSHOT of a tax rate (or of a decision of the tax engine), never a live reference to be re-read. */
export interface TaxSpec {
  rateId: number | null;
  /** The name of the rate: "GST 18%". */
  name: string | null;
  type: string | null;
  inclusive: boolean;
  items: TaxItem[];
}

export interface LineSpec {
  description: string;
  sku: string | null;
  hsnSac: string | null;
  /** Decimal string, up to 4 decimals. */
  qty: string;
  /** Major units of the invoice currency. */
  unitPrice: string;
  discount: WireDiscount | null;
  tax: TaxSpec | null;
}

export interface PricedTotals {
  currency: string;
  subtotalMinor: bigint;
  discountMinor: bigint;
  shippingMinor: bigint;
  taxMinor: bigint;
  taxAddedMinor: bigint;
  totalMinor: bigint;
  /** The document discount as the row stores it: percent in basis points, an amount in minor units. */
  discountKind: 'none' | 'percent' | 'amount';
  discountValue: bigint;
  /** Every tax line is inclusive (and there is at least one). */
  taxInclusive: boolean;
}

export interface PricedInvoice {
  totals: PricedTotals;
  lines: LineInsert[];
  summary: SummaryInsert[];
}

const MAX_MINOR = 1_000_000_000_000_000n;
export const INVOICE_LINES_MAX = 100;

const amountInvalid = (issues: Array<{ path: string; message: string }>): AppError =>
  new AppError(
    ERROR_CODES.INV_AMOUNT_INVALID,
    'An amount, quantity or rate cannot be used',
    HttpStatus.UNPROCESSABLE_ENTITY,
    issues,
  );

/** "9.0000" -> "9", "9.9750" -> "9.975", "10" -> "10" (only a fractional part loses trailing zeros). */
export const trimPercent = (p: string): string => (p.includes('.') ? p.replace(/0+$/, '').replace(/\.$/, '') : p);

/** The sum of a line's tax percentages (additive taxes), exact: "9" + "9" = "18", "5" + "9.975" = "14.975". */
export function totalPercent(items: readonly TaxItem[]): string {
  let ppm = 0n;
  for (const t of items) ppm += parseRate(t.ratePercent) ?? 0n;
  return formatRate(ppm);
}

/** The tax of a simple rate: one item named after the rate. */
export function simpleTax(
  rateId: number | null,
  name: string,
  type: string | null,
  ratePercent: string,
  inclusive: boolean,
): TaxSpec {
  return { rateId, name, type, inclusive, items: [{ code: name, name, ratePercent }] };
}

/** The line's own fields, rebuilt from what is stored (a retained line is repriced from its snapshot, not from a live tax rate). */
export function specsFromRows(rows: InvoiceLineRow[], currency: string): LineSpec[] {
  return rows.map((l) => {
    const percent = formatRate(parseRate(l.taxRatePercent) ?? 0n);
    let tax: TaxSpec | null = null;
    if (percent !== '0' || l.taxName) {
      const items: TaxItem[] = l.taxComponents?.length
        ? l.taxComponents.map((c) => ({ code: c.type, name: c.name ?? c.type, ratePercent: c.ratePercent }))
        : [{ code: l.taxName ?? 'Tax', name: l.taxName ?? 'Tax', ratePercent: percent }];
      tax = { rateId: l.taxRateId, name: l.taxName, type: l.taxType, inclusive: l.taxInclusive, items };
    }
    return {
      description: l.description,
      sku: l.sku,
      hsnSac: l.hsnSac,
      qty: l.qty,
      unitPrice: minorToMajor(l.unitPriceMinor, currency),
      discount:
        l.discountKind === 'percent'
          ? { kind: 'percent', value: formatPercent(l.discountValue) }
          : l.discountKind === 'amount'
            ? { kind: 'amount', value: minorToMajor(l.discountValue, currency) }
            : null,
      tax,
    };
  });
}

function toDiscount(
  d: WireDiscount | null,
  currency: string,
  path: string,
  issues: Array<{ path: string; message: string }>,
): { engine: DiscountInput; kind: 'none' | 'percent' | 'amount'; value: bigint } {
  const none = { engine: { kind: 'none' } as DiscountInput, kind: 'none' as const, value: 0n };
  if (!d) return none;
  if (d.kind === 'percent') {
    const bp = parsePercentBp(d.value);
    if (bp === null || bp > 10_000) {
      issues.push({ path, message: 'a percent discount is between 0 and 100 with at most 2 decimals' });
      return none;
    }
    return bp === 0 ? none : { engine: { kind: 'percent', percent: d.value }, kind: 'percent', value: BigInt(bp) };
  }
  const minor = parseMajor(d.value, currency);
  if (minor === null) {
    issues.push({ path, message: `an amount has at most ${currencyExponent(currency)} decimals in ${currency}` });
    return none;
  }
  return minor === 0n ? none : { engine: { kind: 'amount', minor }, kind: 'amount', value: minor };
}

export function priceInvoice(opts: {
  currency: string;
  specs: LineSpec[];
  discount: WireDiscount | null;
  shipping: string | null;
  reverseCharge: boolean;
}): PricedInvoice {
  const currency = opts.currency.toUpperCase();
  const exp = currencyExponent(currency);
  const issues: Array<{ path: string; message: string }> = [];
  if (opts.specs.length === 0) issues.push({ path: 'lines', message: 'an invoice needs at least one line' });
  if (opts.specs.length > INVOICE_LINES_MAX)
    issues.push({ path: 'lines', message: `an invoice has at most ${INVOICE_LINES_MAX} lines` });

  const docDiscount = toDiscount(opts.discount, currency, 'discount', issues);
  const shipping = parseMajor(opts.shipping ?? '0', currency);
  if (shipping === null) issues.push({ path: 'shipping', message: `an amount has at most ${exp} decimals in ${currency}` });

  const lineInputs: LineInput[] = [];
  const lineDiscounts: Array<ReturnType<typeof toDiscount>> = [];
  opts.specs.forEach((l, i) => {
    const qty = parseQty(l.qty);
    if (qty === null || qty === 0n) issues.push({ path: `lines.${i}.qty`, message: 'a quantity is above 0 with at most 4 decimals' });
    const unit = parseMajor(l.unitPrice, currency);
    if (unit === null) issues.push({ path: `lines.${i}.unitPrice`, message: `a price has at most ${exp} decimals in ${currency}` });
    const disc = toDiscount(l.discount, currency, `lines.${i}.discount`, issues);
    lineDiscounts.push(disc);
    // Reverse charge: the buyer accounts for the tax, so none is charged on the document.
    const taxes: LineTaxInput[] =
      opts.reverseCharge || !l.tax
        ? []
        : l.tax.items.map((t) => ({
            code: t.code,
            name: t.name,
            rate: t.ratePercent,
            ...(t.compound ? { compound: true } : {}),
          }));
    lineInputs.push({
      kind: 'item',
      qtyScaled: qty ?? 0n,
      unitPriceMinor: unit ?? 0n,
      discount: disc.engine,
      taxInclusive: l.tax?.inclusive ?? false,
      taxes,
    });
  });
  if (issues.length > 0) throw amountInvalid(issues);

  const engineLines = [...lineInputs];
  if ((shipping ?? 0n) > 0n) engineLines.push({ kind: 'shipping', unitPriceMinor: shipping! });
  let r;
  try {
    r = calculateDocument({ currency, discount: docDiscount.engine, lines: engineLines });
  } catch (err) {
    if (err instanceof TaxMathError) throw amountInvalid([{ path: err.path, message: err.message }]);
    throw err;
  }
  if (r.totalMinor >= MAX_MINOR || r.subtotalMinor >= MAX_MINOR) throw amountInvalid([{ path: 'lines', message: 'amount is too large' }]);

  const typeOfCode = new Map<string, string | null>();
  opts.specs.forEach((s) => s.tax?.items.forEach((t) => typeOfCode.set(t.code, s.tax!.type)));

  const lines: LineInsert[] = opts.specs.map((spec, i) => {
    const x = r.lines[i]!;
    const tax = opts.reverseCharge ? null : spec.tax;
    const taxed = !!tax && x.taxes.length > 0;
    return {
      position: i,
      description: spec.description,
      sku: spec.sku,
      hsnSac: spec.hsnSac,
      qty: spec.qty,
      unitPriceMinor: lineInputs[i]!.unitPriceMinor,
      grossMinor: x.grossMinor,
      discountKind: lineDiscounts[i]!.kind,
      discountValue: lineDiscounts[i]!.value,
      discountMinor: x.discountMinor,
      docDiscountShareMinor: x.sharedDiscountMinor,
      taxRateId: taxed ? tax!.rateId : null,
      taxName: taxed ? (tax!.name ?? 'Tax') : null,
      taxType: taxed ? tax!.type : null,
      taxRatePercent: taxed ? totalPercent(tax!.items) : '0',
      taxInclusive: taxed ? tax!.inclusive : false,
      taxMinor: x.taxMinor,
      totalMinor: x.totalMinor,
      // A compound rate (CGST + SGST) keeps its parts, each with the amount the engine charged for it.
      taxComponents:
        taxed && tax!.items.length > 1
          ? x.taxes.map((t) => ({ type: t.code, name: t.name, ratePercent: t.ratePercent, amountMinor: t.amountMinor.toString() }))
          : null,
      currency,
    };
  });

  const summary: SummaryInsert[] = r.taxSummary.map((g) => {
    const lower = g.code.toLowerCase();
    return {
      name: g.name,
      taxType: (TAX_TYPES as readonly string[]).includes(lower) ? lower : (typeOfCode.get(g.code) ?? null),
      ratePercent: g.ratePercent,
      inclusive: g.inclusive,
      baseMinor: g.baseMinor,
      taxMinor: g.taxMinor,
      taxComponents: null,
    };
  });

  const taxedLines = lines.filter((l) => l.taxMinor > 0n || l.taxRatePercent !== '0');
  return {
    totals: {
      currency,
      subtotalMinor: r.subtotalMinor,
      discountMinor: r.discountMinor,
      shippingMinor: r.shippingMinor,
      taxMinor: r.taxMinor,
      taxAddedMinor: r.taxAddedMinor,
      totalMinor: r.totalMinor,
      discountKind: docDiscount.kind,
      discountValue: docDiscount.value,
      taxInclusive: taxedLines.length > 0 && taxedLines.every((l) => l.taxInclusive),
    },
    lines,
    summary,
  };
}
