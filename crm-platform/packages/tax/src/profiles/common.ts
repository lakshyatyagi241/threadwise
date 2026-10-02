import { formatRate, parseRate } from '../money/decimal';
import type {
  ChecklistItem,
  RateRow,
  ResolveContext,
  ResolveResult,
  SupplyType,
  TaxIdSpec,
  TaxProfile,
  TaxType,
} from './types';
import {
  emptyResult,
  explicitRate,
  isBusiness,
  isRegistered,
  rateInForce,
  toLineTax,
  withholdingTaxes,
  zeroTax,
} from './utils';
import type { TaxCategory } from '../totals/types';

/** Compact RateRow constructor. */
export function rate(
  code: string,
  name: string,
  type: TaxType,
  category: TaxCategory,
  ratePercent: string,
  effectiveFrom: string,
  extra: Partial<RateRow> = {},
): RateRow {
  return { code, name, type, category, ratePercent, effectiveFrom, ...extra };
}

export const ZERO_AND_EXEMPT = (
  prefix: string,
  type: TaxType,
  label: string,
  from: string,
): RateRow[] => [
  rate(`${prefix}_ZERO`, `${label} 0% (zero-rated)`, type, 'zero', '0', from),
  rate(`${prefix}_EXEMPT`, `${label} exempt`, type, 'exempt', '0', from),
];

/** The legal-checklist rows nearly every VAT/GST country shares. */
export function commonChecklist(opts: {
  title?: string;
  titleNote?: string;
  buyerIdWhen?: ChecklistItem['when'];
  extra?: ChecklistItem[];
}): ChecklistItem[] {
  const items: ChecklistItem[] = [
    {
      field: 'invoice_number',
      label: 'Unique, sequential invoice number',
      level: 'required',
      when: 'always',
    },
    { field: 'issue_date', label: 'Date of issue', level: 'required', when: 'always' },
    { field: 'seller_name', label: 'Seller legal name', level: 'required', when: 'always' },
    { field: 'seller_address', label: 'Seller address', level: 'required', when: 'always' },
    {
      field: 'seller_tax_id',
      label: 'Seller tax registration number',
      level: 'required',
      when: 'always',
    },
    { field: 'buyer_name', label: 'Buyer name', level: 'required', when: 'always' },
    {
      field: 'line_description',
      label: 'Description of goods or services',
      level: 'required',
      when: 'always',
    },
    {
      field: 'line_quantity',
      label: 'Quantity (goods) or extent (services)',
      level: 'required',
      when: 'always',
    },
    {
      field: 'line_unit_price',
      label: 'Unit price excluding tax',
      level: 'required',
      when: 'always',
    },
    { field: 'line_tax_rate', label: 'Tax rate applied', level: 'required', when: 'always' },
    {
      field: 'tax_summary',
      label: 'Taxable amount and tax amount per rate',
      level: 'required',
      when: 'always',
    },
    { field: 'total_amount', label: 'Total amount payable', level: 'required', when: 'always' },
    { field: 'currency', label: 'Currency', level: 'recommended', when: 'always' },
  ];
  if (opts.title) {
    items.unshift({
      field: 'document_title',
      label: opts.titleNote ?? `Document titled "${opts.title}"`,
      level: 'required',
      when: 'always',
      mustContain: opts.title,
    });
  }
  items.push({
    field: 'buyer_tax_id',
    label: 'Buyer tax registration number',
    level: opts.buyerIdWhen ? 'required' : 'recommended',
    when: opts.buyerIdWhen ?? 'b2b',
  });
  return [...items, ...(opts.extra ?? [])];
}

// ---------------------------------------------------------------------------------------------------------------------------
// The generic single-rate VAT/GST resolver shared by AE, SA, BH, OM, ZA, NG, KE, AU, NZ, SG, JP, MY(sales/service tax)
// ---------------------------------------------------------------------------------------------------------------------------

export interface SimpleResolverConfig {
  country: string;
  /** Short tax label used in reasons ("VAT", "GST", "SST", "consumption tax"). */
  label: string;
  /** Maps the product category to a rate code. */
  codes: Partial<
    Record<'standard' | 'reduced' | 'super_reduced' | 'zero' | 'exempt' | 'special', string>
  >;
  /** Code of the rate used for the "standard" category by supply type, when it differs (Malaysia). */
  codesBySupply?: Partial<Record<SupplyType, Partial<Record<'standard' | 'reduced', string>>>>;
  /** Tax code printed for zero/exempt markers. */
  zeroCode: string;
  /** Goods leaving the country. */
  exportGoods: { category: 'zero' | 'exempt'; note: string };
  /** Services supplied to a business outside the country. */
  exportServicesB2B: { category: 'zero' | 'out_of_scope' | 'exempt'; note: string };
  /** Services supplied to a consumer outside the country: usually still taxed locally. */
  exportServicesB2C: 'charge' | 'zero';
  /** Wording when the seller is not registered. */
  notRegisteredNote: string;
  /** Extra warnings always shown (e-invoicing mandates etc). */
  alwaysWarn?: string[];
  /** Sellers in these schemes charge no tax. */
  noTaxSchemes?: string[];
  /** Registered by default when the caller does not say (true everywhere: the user chose this profile to charge tax). */
}

export function makeSimpleResolver(profileOf: () => TaxProfile, cfg: SimpleResolverConfig) {
  return (ctx: ResolveContext): ResolveResult => {
    const profile = profileOf();
    const res = emptyResult();
    const sellerCountry = (ctx.seller.country ?? cfg.country).toUpperCase();
    const buyerCountry = ctx.buyer.country.toUpperCase();
    res.placeOfSupply = { country: buyerCountry === sellerCountry ? sellerCountry : buyerCountry };
    if (cfg.alwaysWarn) res.warnings.push(...cfg.alwaysWarn);

    if (
      !isRegistered(ctx) ||
      (ctx.seller.scheme && cfg.noTaxSchemes?.includes(ctx.seller.scheme))
    ) {
      res.reasons.push(
        `The seller is not registered for ${cfg.label} (or is under a scheme that charges none), so none is charged.`,
      );
      res.documentNotes.push(cfg.notRegisteredNote);
      res.documentTypeHint = 'invoice';
      res.taxFree = true;
      return res;
    }
    if (!ctx.seller.taxId) {
      res.warnings.push(
        `Add the seller's ${cfg.label} registration number: it is mandatory on a tax invoice.`,
      );
    }

    const explicit = explicitRate(ctx);
    const foreign = buyerCountry !== sellerCountry;
    const business = isBusiness(ctx);

    if (foreign && !explicit) {
      if (ctx.supplyType === 'goods') {
        res.taxes.push(zeroTax(cfg.zeroCode, `${cfg.label} 0% (export)`, cfg.exportGoods.category));
        res.reasons.push(
          `Goods delivered to ${buyerCountry} are an export: ${cfg.exportGoods.category === 'zero' ? 'zero-rated' : 'exempt'}.`,
        );
        res.documentNotes.push(cfg.exportGoods.note);
        res.taxFree = true;
        res.warnings.push('Keep proof of export (shipping documents, customs declaration).');
        return finish(profile, ctx, res);
      }
      if (business || cfg.exportServicesB2C === 'zero') {
        res.taxes.push(
          zeroTax(
            cfg.zeroCode,
            `${cfg.label} 0% (export of services)`,
            cfg.exportServicesB2B.category,
          ),
        );
        res.reasons.push(
          business
            ? `Services to a business in ${buyerCountry}: ${cfg.exportServicesB2B.category === 'zero' ? 'zero-rated' : 'outside the scope of'} ${cfg.label}.`
            : `Services to a consumer in ${buyerCountry} are treated as an export here.`,
        );
        res.documentNotes.push(cfg.exportServicesB2B.note);
        res.taxFree = true;
        res.warnings.push(
          'The conditions for zero-rating services vary (place of supply, who benefits). Confirm with your adviser.',
        );
        return finish(profile, ctx, res);
      }
      res.warnings.push(
        `Services to a consumer abroad are usually still taxed in ${cfg.country}; ${cfg.label} charged. Confirm place-of-supply rules.`,
      );
    }

    // domestic (or foreign consumer service charged locally)
    if (explicit) {
      res.taxes.push({
        code: `${cfg.zeroCode}_CUSTOM`,
        name: `${cfg.label} ${explicit.percent}%`,
        rate: explicit.percent,
        category: 'standard',
      });
      res.reasons.push(
        explicit.source === 'override'
          ? `Rate ${explicit.percent}% entered manually for this line.`
          : `Rate ${explicit.percent}% taken from the product.`,
      );
      return finish(profile, ctx, res);
    }
    const category = ctx.product.category ?? 'standard';
    let code = cfg.codes[category];
    const bySupply = cfg.codesBySupply?.[ctx.supplyType];
    if (bySupply && (category === 'standard' || category === 'reduced'))
      code = bySupply[category] ?? code;
    if (!code) {
      res.warnings.push(`This profile has no "${category}" rate; pick a rate manually.`);
      return finish(profile, ctx, res);
    }
    const row = rateInForce(profile.rates, { code, date: ctx.date });
    if (!row) {
      res.warnings.push(
        `No ${cfg.label} rate "${code}" is in force on ${ctx.date}; pick a rate manually.`,
      );
      return finish(profile, ctx, res);
    }
    if (row.category === 'zero' || row.category === 'exempt') {
      res.taxes.push(zeroTax(row.code, row.name, row.category));
      res.taxFree = true;
      res.reasons.push(
        `${row.name}: the product is ${row.category === 'zero' ? 'zero-rated' : 'exempt'} in ${cfg.country}.`,
      );
    } else {
      res.taxes.push(toLineTax(row, `${cfg.label} ${formatRate(parseRate(row.ratePercent)!)}%`));
      res.reasons.push(
        `${cfg.label} ${row.ratePercent}% (${category}) applies to a domestic ${ctx.supplyType} supply on ${ctx.date}.`,
      );
    }
    return finish(profile, ctx, res);
  };
}

function finish(profile: TaxProfile, ctx: ResolveContext, res: ResolveResult): ResolveResult {
  const w = withholdingTaxes(profile.withholding, ctx, res);
  res.taxes.push(...w);
  return res;
}

export { finish as finishResolve };

export const requirementNote = (spec: TaxIdSpec | null, label: string): string | undefined =>
  spec ? `${label}: e.g. ${spec.example}` : undefined;
