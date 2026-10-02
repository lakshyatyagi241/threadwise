import { commonChecklist, rate, ZERO_AND_EXEMPT } from '../common';
import type { ResolveContext, ResolveResult, TaxProfile } from '../types';
import { ID_SPECS, validateUkVat } from '../validators';
import {
  emptyResult,
  explicitRate,
  isBusiness,
  isRegistered,
  numbering,
  rateInForce,
  toLineTax,
  withholdingTaxes,
  zeroTax,
} from '../utils';

const RATES = [
  rate('VAT_STD', 'VAT 17.5%', 'vat', 'standard', '17.5', '2010-01-01', {
    effectiveTo: '2011-01-03',
  }),
  rate('VAT_STD', 'VAT 20%', 'vat', 'standard', '20', '2011-01-04', { isDefault: true }),
  rate('VAT_RED', 'VAT 5% (reduced)', 'vat', 'reduced', '5', '1997-09-01', {
    note: 'Domestic fuel and power, child car seats, energy-saving installations.',
  }),
  ...ZERO_AND_EXEMPT('VAT', 'vat', 'VAT', '1973-04-01'),
];

const WITHHOLDING = [
  rate('CIS_20', 'CIS deduction 20%', 'withholding', 'withholding', '20', '2007-04-06', {
    note: 'Construction Industry Scheme, registered subcontractor: applied to the LABOUR part only (not materials).',
  }),
  rate('CIS_30', 'CIS deduction 30%', 'withholding', 'withholding', '30', '2007-04-06', {
    note: 'CIS, subcontractor not registered.',
  }),
];

const CODE: Record<string, string> = {
  standard: 'VAT_STD',
  reduced: 'VAT_RED',
  super_reduced: 'VAT_RED',
  zero: 'VAT_ZERO',
  exempt: 'VAT_EXEMPT',
};

function resolveUk(ctx: ResolveContext): ResolveResult {
  const res = emptyResult();
  const buyerCountry = ctx.buyer.country.toUpperCase();
  res.placeOfSupply = { country: buyerCountry === 'GB' ? 'GB' : buyerCountry };

  if (!isRegistered(ctx) || ctx.seller.scheme === 'small_supplier') {
    res.reasons.push(
      'The seller is not VAT-registered (below the registration threshold or not registered): no VAT may be charged.',
    );
    res.documentNotes.push('Supplier is not VAT registered');
    res.documentTypeHint = 'invoice';
    res.taxFree = true;
    return res;
  }
  if (!ctx.seller.taxId)
    res.warnings.push('Add the seller VAT registration number: it is mandatory on a VAT invoice.');
  if (ctx.seller.scheme === 'flat_rate') {
    res.warnings.push(
      'Flat Rate Scheme: charge customers the normal VAT rates on the invoice; the flat percentage applies only to what you pay HMRC. Do not show the flat rate on invoices.',
    );
  }
  const business = isBusiness(ctx);
  if (ctx.buyer.taxId) {
    const v = validateUkVat(ctx.buyer.taxId);
    if (!v.valid && buyerCountry === 'GB')
      res.warnings.push(`The buyer VAT number looks invalid: ${v.reason}`);
  }
  const explicit = explicitRate(ctx);

  if (buyerCountry !== 'GB' && !explicit) {
    if (ctx.supplyType === 'goods') {
      res.taxes.push(zeroTax('VAT', 'VAT 0% (export)', 'zero'));
      res.reasons.push(
        `Goods exported to ${buyerCountry} are zero-rated, provided you hold proof of export.`,
      );
      res.documentNotes.push('Zero-rated export of goods');
      res.warnings.push(
        'Keep proof of export within the HMRC time limit (3 months). Goods to Northern Ireland (XI) have separate rules.',
      );
      res.taxFree = true;
      res.taxes.push(...withholdingTaxes(WITHHOLDING, ctx, res));
      return res;
    }
    if (business) {
      res.taxes.push(zeroTax('VAT', 'Outside the scope of UK VAT', 'out_of_scope'));
      res.reasons.push(
        `B2B services to a business in ${buyerCountry}: the place of supply is the customer's country, so the supply is outside the scope of UK VAT and the customer accounts for any VAT (reverse charge).`,
      );
      res.documentNotes.push(
        'Outside the scope of UK VAT: reverse charge, the customer is to account for VAT',
      );
      res.reverseCharge = true;
      res.taxFree = true;
      res.taxes.push(...withholdingTaxes(WITHHOLDING, ctx, res));
      return res;
    }
    res.warnings.push(
      'B2C services to a customer abroad are generally still subject to UK VAT (with exceptions): UK VAT charged. Check the place-of-supply rules.',
    );
  }

  if (ctx.product.reverseCharge && business && buyerCountry === 'GB') {
    res.taxes.push(zeroTax('VAT', 'VAT 0% (domestic reverse charge)', 'reverse_charge'));
    res.reasons.push(
      'Domestic reverse charge (construction/CIS, mobile phones, wholesale gas/electricity, emissions allowances ...): the customer accounts for the VAT.',
    );
    res.documentNotes.push('Reverse charge: Customer to pay the VAT to HMRC');
    res.reverseCharge = true;
    res.taxFree = true;
    res.taxes.push(...withholdingTaxes(WITHHOLDING, ctx, res));
    return res;
  }

  if (explicit) {
    res.taxes.push({
      code: 'VAT_CUSTOM',
      name: `VAT ${explicit.percent}%`,
      rate: explicit.percent,
      category: 'standard',
    });
    res.reasons.push(
      explicit.source === 'override'
        ? `Rate ${explicit.percent}% entered manually.`
        : `Rate ${explicit.percent}% taken from the product.`,
    );
  } else {
    const category = ctx.product.category ?? 'standard';
    const row = rateInForce(RATES, { code: CODE[category] ?? 'VAT_STD', date: ctx.date });
    if (!row) {
      res.warnings.push('No VAT rate is in force on that date; pick a rate manually.');
      return res;
    }
    if (row.category === 'zero' || row.category === 'exempt') {
      res.taxes.push(zeroTax(row.code, row.name, row.category));
      res.taxFree = true;
      res.reasons.push(`${row.name}: ${row.category === 'zero' ? 'zero-rated' : 'exempt'} supply.`);
    } else {
      res.taxes.push(toLineTax(row, `VAT ${row.ratePercent}%`));
      res.reasons.push(
        `UK VAT ${row.ratePercent}% (${category}) applies to a domestic supply on ${ctx.date}.`,
      );
    }
  }
  res.taxes.push(...withholdingTaxes(WITHHOLDING, ctx, res));
  return res;
}

export const UK_PROFILE: TaxProfile = {
  code: 'GB',
  name: 'United Kingdom (VAT)',
  currency: 'GBP',
  locale: 'en-GB',
  taxLabel: 'VAT',
  support: 'full',
  pricesIncludeTaxDefault: false,
  rounding: {
    level: 'per_line',
    mode: 'half_up',
    dictatedByLaw: false,
    note: 'HMRC allows rounding per line or on the invoice total per rate; be consistent. VAT is rounded down to the penny only for the flat-rate scheme payment, not on invoices.',
  },
  rates: RATES,
  withholding: WITHHOLDING,
  sellerTaxId: {
    spec: ID_SPECS.ukVat,
    requirement: 'required_if_registered',
    note: 'GB + 9 digits (mod-97 checked).',
  },
  buyerTaxId: {
    spec: ID_SPECS.ukVat,
    requirement: 'b2b_only',
    note: 'Needed for reverse-charge and EU/overseas B2B notes.',
  },
  documentTitles: {
    tax_invoice: 'VAT Invoice',
    credit_note: 'VAT Credit Note',
    simplified: 'Less detailed VAT invoice',
  },
  checklist: commonChecklist({
    title: 'VAT Invoice',
    extra: [
      {
        field: 'supply_date',
        label: 'Time of supply (tax point) if different from the invoice date',
        level: 'required',
        when: 'always',
      },
      {
        field: 'buyer_address',
        label: "Customer's name or trading name and address",
        level: 'required',
        when: 'always',
      },
      {
        field: 'reverse_charge_wording',
        label: 'Reverse-charge wording: "Reverse charge: Customer to pay the VAT to HMRC"',
        level: 'required',
        when: 'reverse_charge',
        mustContain: 'Reverse charge',
      },
      {
        field: 'unit_price_total',
        label: 'Total amount excluding VAT, and total VAT in sterling',
        level: 'required',
        when: 'always',
      },
    ],
  }),
  fiscalYear: {
    startMonth: 4,
    startDay: 6,
    labelFormat: 'YYYY-YY',
    note: 'UK personal tax year 6 April to 5 April (sole traders). Limited companies choose their own accounting year-end; change this to 1 January if you number invoices by calendar year.',
  },
  numbering: numbering({
    pattern: '{PREFIX}-{YYYY}-{SEQ}',
    reset: 'yearly',
    rule: 'Sequential and unique; any gap must be explainable (HMRC may ask).',
  }),
  notes: [
    'VAT 20% standard (since 4 Jan 2011), 5% reduced, 0% zero-rated, and exempt supplies. Registration threshold GBP 90,000 (from 1 Apr 2024).',
    'B2B services to overseas businesses are outside the scope of UK VAT (the customer reverse-charges). Domestic reverse charge applies to construction services under CIS and a few goods: tick "reverse charge" on the product.',
    'Flat Rate Scheme: you still charge standard VAT on invoices. The flat percentage only affects the return. A less detailed invoice is allowed for retail sales up to GBP 250.',
    'Making Tax Digital for VAT: the return must be filed through compatible software. Northern Ireland (XI prefix) follows EU rules for goods.',
    'CIS deductions (20%/30%) are shown as withholding on the labour part of a subcontractor invoice.',
  ],
  sources: [
    { name: 'HMRC: VAT rates', url: 'https://www.gov.uk/vat-rates', asOf: '2026-09-01' },
    {
      name: 'HMRC: VAT invoices',
      url: 'https://www.gov.uk/vat-record-keeping/vat-invoices',
      asOf: '2026-09-01',
    },
  ],
  resolve: resolveUk,
};
