import { HttpStatus } from '@nestjs/common';
import { getTaxProfile, resolveTaxForLine, type ResolveResult } from '@crm/tax';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';
import type { TaxItem, TaxSpec } from './invoice-content';

/**
 * "Auto" tax (country-aware invoices): instead of a tax rate picked per line, the TAX ENGINE decides the taxes of each line from the
 * seller's country and state, the buyer's country, state and tax id, the supply and the date (`resolveTaxForLine` in @crm/tax):
 * India CGST + SGST inside a state and IGST across states, UTGST in union territories, EU reverse charge, UK, US and Canadian
 * rules. Each line gets the taxes the engine returned as a SNAPSHOT (like a tax rate would give), and its reasons are kept on the
 * invoice ("Why this tax?"). Presets are DEFAULTS the business must verify; this never calls a live service.
 */

export interface AutoTaxContext {
  /** The seller's country (the profile code: "IN", "GB", "DE", "US", "CA" ... or "CUSTOM"). */
  sellerCountry: string | null;
  sellerState: string | null;
  sellerTaxId: string | null;
  buyerCountry: string | null;
  /** ISO 3166-2 "IN-MH" or a bare country code. */
  placeOfSupply: string | null;
  buyerTaxId: string | null;
  supplyType: 'goods' | 'services' | 'digital';
  /** ISO date of the supply. */
  date: string;
}

export interface AutoTaxLineInput {
  hsnSac: string | null;
  /** An explicit slab picked for the line (a tax rate's percent): wins over the profile's standard rate. */
  ratePercent: string | null;
}

export interface AutoTaxExplanation {
  reasons: string[];
  warnings: string[];
  documentNotes: string[];
  taxFree: boolean;
  reverseCharge: boolean;
  /** Set when the engine says tax cannot be charged on a tax invoice ("bill_of_supply"). */
  documentTypeHint: string | null;
}

const lowerType = (code: string): string => code.toLowerCase();

export function resolveAutoTax(
  ctx: AutoTaxContext,
  lines: AutoTaxLineInput[],
): { specs: Array<TaxSpec | null>; explanation: AutoTaxExplanation } {
  const code = (ctx.sellerCountry ?? '').toUpperCase();
  if (!code || !getTaxProfile(code)) {
    throw new AppError(
      ERROR_CODES.INV_AMOUNT_INVALID,
      'Automatic tax needs the seller country in the invoicing profile (a country with a tax preset, or CUSTOM)',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'taxMode', message: 'set the seller country in the invoicing profile first' }],
    );
  }
  const buyerCountry = (ctx.buyerCountry ?? ctx.placeOfSupply?.slice(0, 2) ?? code).toUpperCase();
  const region =
    ctx.placeOfSupply && ctx.placeOfSupply.includes('-')
      ? ctx.placeOfSupply.split('-')[1]
      : undefined;

  const explanation: AutoTaxExplanation = {
    reasons: [],
    warnings: [],
    documentNotes: [],
    taxFree: true,
    reverseCharge: false,
    documentTypeHint: null,
  };
  const push = (into: string[], items: string[]) => {
    for (const s of items) if (!into.includes(s)) into.push(s);
  };

  const specs = lines.map((l): TaxSpec | null => {
    const res: ResolveResult = resolveTaxForLine({
      sellerProfile: code,
      seller: {
        ...(ctx.sellerState ? { region: ctx.sellerState } : {}),
        ...(ctx.sellerTaxId ? { taxId: ctx.sellerTaxId } : {}),
      },
      buyer: {
        country: buyerCountry,
        ...(region ? { region } : {}),
        type: ctx.buyerTaxId ? 'business' : 'consumer',
        ...(ctx.buyerTaxId ? { taxId: ctx.buyerTaxId } : {}),
      },
      product: {
        category: 'standard',
        ...(l.hsnSac ? { code: l.hsnSac } : {}),
        ...(l.ratePercent ? { ratePercent: l.ratePercent } : {}),
      },
      supplyType: ctx.supplyType,
      date: ctx.date,
    });
    push(explanation.reasons, res.reasons);
    push(explanation.warnings, res.warnings);
    push(explanation.documentNotes, res.documentNotes);
    if (res.reverseCharge) explanation.reverseCharge = true;
    if (!res.taxFree) explanation.taxFree = false;
    if (res.documentTypeHint && res.documentTypeHint !== 'tax_invoice')
      explanation.documentTypeHint = res.documentTypeHint;

    const taxes = res.taxes.filter((t) => t.category !== 'withholding' && Number(t.rate) >= 0);
    if (taxes.length === 0) return null;
    const items: TaxItem[] = taxes.map((t) => ({
      code: t.code,
      name: t.name,
      ratePercent: String(t.rate),
      ...(t.compound ? { compound: true } : {}),
    }));
    // The line's printed name is the combination ("CGST 9% + SGST 9%"); its type the first tax's.
    return {
      rateId: null,
      name: items.map((i) => i.name).join(' + '),
      type: lowerType(items[0]!.code),
      inclusive: false,
      items,
    };
  });
  if (specs.every((s) => s === null) && lines.length > 0 && !explanation.reverseCharge)
    explanation.taxFree = true;
  return { specs, explanation };
}
