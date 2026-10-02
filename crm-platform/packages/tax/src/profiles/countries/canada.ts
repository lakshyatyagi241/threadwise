import { commonChecklist, rate } from '../common';
import type { RateRow, ResolveContext, ResolveResult, TaxProfile } from '../types';
import type { LineTaxInput } from '../../totals/types';
import { ID_SPECS } from '../validators';
import {
  emptyResult,
  explicitRate,
  FY_JAN,
  isRegistered,
  numbering,
  rateInForce,
  zeroTax,
} from '../utils';

export const CA_PROVINCES: readonly { code: string; name: string }[] = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
];

const RATES: RateRow[] = [
  rate('GST', 'GST 5%', 'gst', 'standard', '5', '2008-01-01', {
    isDefault: true,
    note: 'Federal tax; applies everywhere except where HST replaces it.',
  }),
  rate('HST_ON', 'HST 13% (Ontario)', 'hst', 'standard', '13', '2010-07-01', { region: 'ON' }),
  rate('HST_NB', 'HST 15% (New Brunswick)', 'hst', 'standard', '15', '2016-07-01', {
    region: 'NB',
  }),
  rate('HST_NL', 'HST 15% (Newfoundland and Labrador)', 'hst', 'standard', '15', '2016-07-01', {
    region: 'NL',
  }),
  rate('HST_NS', 'HST 15% (Nova Scotia)', 'hst', 'standard', '15', '2010-07-01', {
    region: 'NS',
    effectiveTo: '2025-03-31',
  }),
  rate('HST_NS', 'HST 14% (Nova Scotia)', 'hst', 'standard', '14', '2025-04-01', { region: 'NS' }),
  rate('HST_PE', 'HST 15% (Prince Edward Island)', 'hst', 'standard', '15', '2016-10-01', {
    region: 'PE',
  }),
  rate('PST_BC', 'PST 7% (British Columbia)', 'pst', 'standard', '7', '2013-04-01', {
    region: 'BC',
    note: 'Charged only by sellers registered for BC PST.',
  }),
  rate('PST_SK', 'PST 6% (Saskatchewan)', 'pst', 'standard', '6', '2017-03-23', {
    region: 'SK',
    note: 'Charged only by sellers registered for SK PST.',
  }),
  rate('PST_MB', 'RST 7% (Manitoba)', 'pst', 'standard', '7', '2019-07-01', {
    region: 'MB',
    note: 'Retail sales tax; charged only by registered sellers.',
  }),
  rate('QST', 'QST 9.975% (Quebec)', 'qst', 'standard', '9.975', '2013-01-01', {
    region: 'QC',
    note: 'Charged on the price excluding GST; sellers must register for QST.',
  }),
  rate('GST_ZERO', 'GST 0% (zero-rated)', 'gst', 'zero', '0', '2008-01-01', {
    note: 'Basic groceries, exports, prescription drugs.',
  }),
  rate('GST_EXEMPT', 'GST exempt', 'gst', 'exempt', '0', '2008-01-01', {
    note: 'Residential rent, most health and education services.',
  }),
];

const HST_REGIONS = ['ON', 'NB', 'NL', 'NS', 'PE'] as const;
const PST_CODES: Record<string, string> = { BC: 'PST_BC', SK: 'PST_SK', MB: 'PST_MB', QC: 'QST' };

const provinceOf = (v?: string) => {
  if (!v) return undefined;
  const s = v.trim().toUpperCase();
  return CA_PROVINCES.find((p) => p.code === s || p.name.toUpperCase() === s);
};

function resolveCa(ctx: ResolveContext): ResolveResult {
  const res = emptyResult();
  const buyerCountry = ctx.buyer.country.toUpperCase();
  const sellerProv = provinceOf(ctx.seller.region);
  const buyerProv =
    provinceOf(ctx.buyer.region) ?? (buyerCountry === 'CA' ? sellerProv : undefined);

  if (!isRegistered(ctx) || ctx.seller.scheme === 'small_supplier') {
    res.reasons.push(
      'The seller is a small supplier (under CAD 30,000 in four quarters) or not registered: GST/HST is not charged.',
    );
    res.documentNotes.push('Small supplier: GST/HST not charged');
    res.documentTypeHint = 'invoice';
    res.taxFree = true;
    return res;
  }
  if (!ctx.seller.taxId)
    res.warnings.push(
      'Add the seller GST/HST number (business number + RT0001): it is mandatory on invoices above CAD 30.',
    );
  res.placeOfSupply = {
    country: buyerCountry,
    ...(buyerProv && buyerCountry === 'CA' ? { region: buyerProv.code } : {}),
  };

  if (buyerCountry !== 'CA') {
    res.taxes.push(zeroTax('GST', 'GST 0% (export)', 'zero'));
    res.reasons.push(`Supplies exported to ${buyerCountry} are zero-rated for GST/HST.`);
    res.taxFree = true;
    return res;
  }
  if (ctx.buyer.taxExempt) {
    res.taxes.push(zeroTax('GST', 'GST/HST exempt buyer', 'exempt'));
    res.reasons.push(
      'The buyer is exempt (status Indian / diplomat / exempt organisation): no tax charged.',
    );
    res.taxFree = true;
    return res;
  }
  const explicit = explicitRate(ctx);
  if (explicit) {
    res.taxes.push({
      code: 'GST',
      name: `Tax ${explicit.percent}%`,
      rate: explicit.percent,
      category: 'standard',
    });
    res.reasons.push(
      explicit.source === 'override'
        ? `Rate ${explicit.percent}% entered manually.`
        : `Rate ${explicit.percent}% taken from the product.`,
    );
    return res;
  }
  const cat = ctx.product.category ?? 'standard';
  if (cat === 'zero' || cat === 'exempt') {
    res.taxes.push(
      zeroTax(
        cat === 'zero' ? 'GST_ZERO' : 'GST_EXEMPT',
        cat === 'zero' ? 'GST 0% (zero-rated)' : 'GST exempt',
        cat,
      ),
    );
    res.reasons.push(`The product is ${cat === 'zero' ? 'zero-rated' : 'exempt'}.`);
    res.taxFree = true;
    return res;
  }
  if (!buyerProv) {
    res.warnings.push('The buyer province is missing: add it so HST/PST can be applied.');
  }
  const taxes: LineTaxInput[] = [];
  const prov = buyerProv?.code;
  if (prov && (HST_REGIONS as readonly string[]).includes(prov)) {
    const code = `HST_${prov}`;
    const row = rateInForce(RATES, { code, date: ctx.date, region: prov });
    if (row) {
      taxes.push({
        code,
        name: `HST ${row.ratePercent}% (${buyerProv!.name})`,
        rate: row.ratePercent,
        category: 'standard',
      });
      res.reasons.push(
        `Place of supply is ${buyerProv!.name}, a participating province: HST ${row.ratePercent}% replaces GST.`,
      );
    }
  } else {
    const gst = rateInForce(RATES, { code: 'GST', date: ctx.date });
    if (gst)
      taxes.push({ code: 'GST', name: 'GST 5%', rate: gst.ratePercent, category: 'standard' });
    res.reasons.push(
      prov
        ? `Place of supply is ${buyerProv!.name}: federal GST 5%.`
        : 'No province given: federal GST 5% only.',
    );
    const pstCode = prov ? PST_CODES[prov] : undefined;
    if (prov && pstCode) {
      const registered =
        (ctx.seller.registeredRegions ?? []).map((r) => r.toUpperCase()).includes(prov) ||
        sellerProv?.code === prov;
      const row = rateInForce(RATES, { code: pstCode, date: ctx.date, region: prov });
      if (row && registered) {
        taxes.push({
          code: pstCode,
          name: `${pstCode === 'QST' ? 'QST' : prov === 'MB' ? 'RST' : 'PST'} ${row.ratePercent}% (${buyerProv!.name})`,
          rate: row.ratePercent,
          category: 'standard',
        });
        res.reasons.push(
          `The seller is registered in ${buyerProv!.name}: ${pstCode === 'QST' ? 'QST' : 'provincial sales tax'} ${row.ratePercent}% is added (calculated on the price, not on the GST).`,
        );
      } else if (row) {
        res.warnings.push(
          `${buyerProv!.name} charges ${row.ratePercent}% provincial sales tax but the seller is not registered there, so it is not added. Add ${prov} to the registered regions once registered.`,
        );
      }
    }
  }
  res.taxes.push(...taxes);
  return res;
}

export const CANADA_PROFILE: TaxProfile = {
  code: 'CA',
  name: 'Canada (GST/HST/PST/QST)',
  currency: 'CAD',
  locale: 'en-CA',
  taxLabel: 'GST/HST',
  support: 'full',
  pricesIncludeTaxDefault: false,
  rounding: {
    level: 'per_line',
    mode: 'half_up',
    dictatedByLaw: false,
    note: 'Tax is calculated on the invoice and rounded to the cent. Cash totals round to 5 cents (cash rounding is available as an option).',
  },
  rates: RATES,
  sellerTaxId: {
    spec: ID_SPECS.caGst,
    requirement: 'required_if_registered',
    note: 'Business number + RT0001 (Luhn-checked).',
  },
  buyerTaxId: {
    spec: ID_SPECS.caGst,
    requirement: 'optional',
    note: 'Required on invoices above CAD 30,000 for the buyer to claim input tax credits.',
  },
  otherIds: [ID_SPECS.caQst],
  documentTitles: { invoice: 'Invoice', credit_note: 'Credit note' },
  checklist: commonChecklist({
    extra: [
      {
        field: 'seller_tax_id',
        label: 'GST/HST registration number (and QST/PST numbers where charged)',
        level: 'required',
        when: 'always',
      },
      {
        field: 'buyer_address',
        label: 'Buyer name and address (supplies above CAD 100)',
        level: 'required',
        when: 'above_threshold',
        thresholdMajor: '100',
      },
    ],
  }),
  fiscalYear: FY_JAN,
  numbering: numbering({
    rule: 'Unique invoice numbers; no statutory sequence rule.',
    gapsAllowed: true,
  }),
  regions: CA_PROVINCES,
  notes: [
    'GST 5% applies across Canada; HST replaces GST in ON (13%), NB, NL, PE (15%) and NS (14% since 1 Apr 2025). PST in BC (7%), SK (6%) and MB (7%) and QST in Quebec (9.975%) are separate and charged only by sellers registered in that province.',
    'The tax follows the place of supply (generally where the buyer receives the supply), not where the seller is. Zero-rated: exports, basic groceries, prescription drugs. Small-supplier threshold CAD 30,000.',
    'QST is 9.975%: store it as a percent string; the tax_rates table must hold more precision than whole basis points (see docs).',
    'Cash rounds to 5 cents (penny withdrawn in 2013).',
  ],
  sources: [
    {
      name: 'Canada Revenue Agency: GST/HST rates',
      url: 'https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-make-adjustments/calculate.html',
      asOf: '2026-09-01',
    },
    { name: 'Revenu Quebec: QST', url: 'https://www.revenuquebec.ca/', asOf: '2026-09-01' },
  ],
  resolve: resolveCa,
};
