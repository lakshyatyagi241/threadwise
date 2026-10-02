import { formatRate, parseRate } from '../../money/decimal';
import { commonChecklist, rate } from '../common';
import type { LineTaxInput } from '../../totals/types';
import type { ChecklistItem, RateRow, ResolveContext, ResolveResult, TaxProfile } from '../types';
import { validateGstin, ID_SPECS } from '../validators';
import {
  emptyResult,
  explicitRate,
  isBusiness,
  isRegistered,
  numbering,
  rateInForce,
  withholdingTaxes,
  zeroTax,
} from '../utils';

export interface IndiaState {
  code: string;
  name: string;
  /** Common abbreviations accepted as input. */
  abbr: string[];
  /** Union territory without a legislature: charges UTGST instead of SGST. */
  utgst: boolean;
}

/** GST state / UT codes (the first two digits of a GSTIN). */
export const INDIA_STATES: readonly IndiaState[] = [
  { code: '01', name: 'Jammu and Kashmir', abbr: ['JK'], utgst: false },
  { code: '02', name: 'Himachal Pradesh', abbr: ['HP'], utgst: false },
  { code: '03', name: 'Punjab', abbr: ['PB'], utgst: false },
  { code: '04', name: 'Chandigarh', abbr: ['CH'], utgst: true },
  { code: '05', name: 'Uttarakhand', abbr: ['UK', 'UT'], utgst: false },
  { code: '06', name: 'Haryana', abbr: ['HR'], utgst: false },
  { code: '07', name: 'Delhi', abbr: ['DL'], utgst: false },
  { code: '08', name: 'Rajasthan', abbr: ['RJ'], utgst: false },
  { code: '09', name: 'Uttar Pradesh', abbr: ['UP'], utgst: false },
  { code: '10', name: 'Bihar', abbr: ['BR'], utgst: false },
  { code: '11', name: 'Sikkim', abbr: ['SK'], utgst: false },
  { code: '12', name: 'Arunachal Pradesh', abbr: ['AR'], utgst: false },
  { code: '13', name: 'Nagaland', abbr: ['NL'], utgst: false },
  { code: '14', name: 'Manipur', abbr: ['MN'], utgst: false },
  { code: '15', name: 'Mizoram', abbr: ['MZ'], utgst: false },
  { code: '16', name: 'Tripura', abbr: ['TR'], utgst: false },
  { code: '17', name: 'Meghalaya', abbr: ['ML'], utgst: false },
  { code: '18', name: 'Assam', abbr: ['AS'], utgst: false },
  { code: '19', name: 'West Bengal', abbr: ['WB'], utgst: false },
  { code: '20', name: 'Jharkhand', abbr: ['JH'], utgst: false },
  { code: '21', name: 'Odisha', abbr: ['OD', 'OR'], utgst: false },
  { code: '22', name: 'Chhattisgarh', abbr: ['CG', 'CT'], utgst: false },
  { code: '23', name: 'Madhya Pradesh', abbr: ['MP'], utgst: false },
  { code: '24', name: 'Gujarat', abbr: ['GJ'], utgst: false },
  {
    code: '26',
    name: 'Dadra and Nagar Haveli and Daman and Diu',
    abbr: ['DN', 'DD', 'DH'],
    utgst: true,
  },
  { code: '27', name: 'Maharashtra', abbr: ['MH'], utgst: false },
  { code: '28', name: 'Andhra Pradesh (before the 2014 division)', abbr: [], utgst: false },
  { code: '29', name: 'Karnataka', abbr: ['KA'], utgst: false },
  { code: '30', name: 'Goa', abbr: ['GA'], utgst: false },
  { code: '31', name: 'Lakshadweep', abbr: ['LD'], utgst: true },
  { code: '32', name: 'Kerala', abbr: ['KL'], utgst: false },
  { code: '33', name: 'Tamil Nadu', abbr: ['TN'], utgst: false },
  { code: '34', name: 'Puducherry', abbr: ['PY', 'PN'], utgst: false },
  { code: '35', name: 'Andaman and Nicobar Islands', abbr: ['AN'], utgst: true },
  { code: '36', name: 'Telangana', abbr: ['TS', 'TG'], utgst: false },
  { code: '37', name: 'Andhra Pradesh', abbr: ['AP'], utgst: false },
  { code: '38', name: 'Ladakh', abbr: ['LA'], utgst: true },
  { code: '97', name: 'Other Territory', abbr: [], utgst: true },
];

/** Accepts "27", "MH" or "Maharashtra" (any case) and returns the state, or undefined. */
export function indiaState(input: string | undefined): IndiaState | undefined {
  if (!input) return undefined;
  const s = input.trim().toUpperCase();
  return INDIA_STATES.find(
    (x) =>
      x.code === s ||
      x.abbr.includes(s) ||
      x.name.toUpperCase() === s ||
      (s.length === 1 && x.code === `0${s}`),
  );
}

const FROM = '2017-07-01';
const NEW_SLABS = '2025-09-22';
const OLD_END = '2025-09-21';

const gst = (
  code: string,
  pct: string,
  from: string,
  category: RateRow['category'],
  extra: Partial<RateRow> = {},
) => rate(code, `GST ${pct}%`, 'gst', category, pct, from, extra);

/** Combined GST slabs. The CGST/SGST/IGST split is decided per supply by `resolve`. */
const RATES: RateRow[] = [
  gst('GST_18', '18', FROM, 'standard', {
    isDefault: true,
    note: 'General rate; the only standard slab after the 22 Sep 2025 reform.',
  }),
  gst('GST_5', '5', FROM, 'reduced', { note: 'Merit slab: essentials, many services.' }),
  gst('GST_12', '12', FROM, 'special', {
    effectiveTo: OLD_END,
    note: 'Abolished on 22 Sep 2025 (items moved to 5% or 18%).',
  }),
  gst('GST_28', '28', FROM, 'special', {
    effectiveTo: OLD_END,
    note: 'Abolished on 22 Sep 2025 (items moved to 18% or 40%).',
  }),
  gst('GST_40', '40', NEW_SLABS, 'special', { note: 'Demerit / luxury goods (from 22 Sep 2025).' }),
  gst('GST_3', '3', FROM, 'special', { note: 'Gold, silver, jewellery (special rate).' }),
  gst('GST_0_25', '0.25', FROM, 'special', {
    note: 'Rough diamonds and precious stones (special rate).',
  }),
  rate('GST_0', 'GST 0% (nil rated)', 'gst', 'zero', '0', FROM, {
    note: 'Taxable at a rate of nil (fresh produce, many foods).',
  }),
  rate('GST_EXEMPT', 'GST exempt', 'gst', 'exempt', '0', FROM, {
    note: 'Exempt supplies: issue a Bill of Supply.',
  }),
];

const WITHHOLDING: RateRow[] = [
  rate(
    'TDS_194C_1',
    'TDS 194C 1% (contractors: individual/HUF)',
    'tds',
    'withholding',
    '1',
    '2010-01-01',
    {
      note: 'Section 194C payment to an individual or HUF contractor.',
    },
  ),
  rate('TDS_194C_2', 'TDS 194C 2% (contractors: others)', 'tds', 'withholding', '2', '2010-01-01', {
    note: 'Section 194C payment to a company, firm or other contractor.',
  }),
  rate(
    'TDS_194J_10',
    'TDS 194J 10% (professional fees)',
    'tds',
    'withholding',
    '10',
    '2020-10-01',
    {
      note: 'Section 194J professional services, royalty, director fees.',
    },
  ),
  rate('TDS_194J_2', 'TDS 194J 2% (technical services)', 'tds', 'withholding', '2', '2020-10-01', {
    note: 'Section 194J(1)(ba) fees for technical services, call-centre, sale of film rights.',
  }),
  rate('TDS_194H_5', 'TDS 194H 5% (commission)', 'tds', 'withholding', '5', '2020-10-01', {
    effectiveTo: '2025-03-31',
    note: 'Commission or brokerage. Reduced to 2% from 1 Apr 2025.',
  }),
  rate('TDS_194H_2', 'TDS 194H 2% (commission)', 'tds', 'withholding', '2', '2025-04-01', {
    note: 'Commission or brokerage (verify with the Finance Act in force).',
  }),
  rate(
    'TDS_194I_10',
    'TDS 194I 10% (rent: land/building)',
    'tds',
    'withholding',
    '10',
    '2010-01-01',
  ),
  rate(
    'TDS_194I_2',
    'TDS 194I 2% (rent: plant/machinery)',
    'tds',
    'withholding',
    '2',
    '2010-01-01',
  ),
  rate(
    'TDS_194Q_0_1',
    'TDS 194Q 0.1% (purchase of goods)',
    'tds',
    'withholding',
    '0.1',
    '2021-07-01',
    {
      note: 'Buyer deducts on purchases above INR 50 lakh in a year.',
    },
  ),
  rate(
    'TCS_206C1H_0_1',
    'TCS 206C(1H) 0.1% (sale of goods)',
    'tcs',
    'withholding',
    '0.1',
    '2020-10-01',
    {
      effectiveTo: '2025-03-31',
      note: 'Seller collected tax on sales above INR 50 lakh. Omitted from 1 Apr 2025.',
    },
  ),
];

/** Rate code for a category, by date (12% and 28% disappeared on 22 Sep 2025). */
const CATEGORY_CODE: Record<string, string> = {
  standard: 'GST_18',
  reduced: 'GST_5',
  zero: 'GST_0',
  exempt: 'GST_EXEMPT',
  special: 'GST_40',
};

function half(pct: string): string {
  const ppm = parseRate(pct)!;
  return formatRate(ppm / 2n); // up to 4 decimals of a percent: 0.25 -> 0.125, 3 -> 1.5, 40 -> 20
}

function splitIntra(res: ResolveResult, pct: string, utgst: boolean): void {
  const h = half(pct);
  res.taxes.push({ code: 'CGST', name: `CGST ${h}%`, rate: h, category: 'standard' });
  res.taxes.push(
    utgst
      ? { code: 'UTGST', name: `UTGST ${h}%`, rate: h, category: 'standard' }
      : { code: 'SGST', name: `SGST ${h}%`, rate: h, category: 'standard' },
  );
}

function resolveIndia(ctx: ResolveContext): ResolveResult {
  const res = emptyResult();
  const profile = INDIA_PROFILE;

  if (ctx.seller.scheme === 'composition') {
    res.reasons.push(
      'The seller is under the GST composition scheme: no tax may be collected from the buyer.',
    );
    res.documentNotes.push('Composition taxable person, not eligible to collect tax on supplies');
    res.documentTypeHint = 'bill_of_supply';
    res.taxFree = true;
    res.warnings.push(
      'Issue a "Bill of Supply" (not a Tax Invoice). Inter-state supply of goods is not allowed under composition.',
    );
    return res;
  }
  if (!isRegistered(ctx)) {
    res.reasons.push('The seller is not registered under GST, so GST cannot be charged.');
    res.documentNotes.push('Supplier is not registered under GST');
    res.documentTypeHint = 'bill_of_supply';
    res.taxFree = true;
    return res;
  }
  if (!ctx.seller.taxId)
    res.warnings.push('Add the seller GSTIN: it is mandatory on a tax invoice.');

  const sellerState = indiaState(ctx.seller.region) ?? indiaState(ctx.seller.taxId?.slice(0, 2));
  const business = isBusiness(ctx);
  const buyerGstin = ctx.buyer.taxId ? validateGstin(ctx.buyer.taxId) : undefined;
  if (
    business &&
    ctx.buyer.country.toUpperCase() === 'IN' &&
    ctx.buyer.taxId &&
    buyerGstin &&
    !buyerGstin.valid
  ) {
    res.warnings.push(`The buyer GSTIN looks invalid: ${buyerGstin.reason}`);
  }

  // ---- export -------------------------------------------------------------------------------------------------------
  if (ctx.buyer.country.toUpperCase() !== 'IN') {
    res.placeOfSupply = { country: ctx.buyer.country.toUpperCase() };
    res.taxes.push(zeroTax('IGST', 'IGST 0% (export)', 'zero'));
    res.reasons.push(
      `The buyer is in ${ctx.buyer.country.toUpperCase()}: an export is a zero-rated supply (IGST 0%).`,
    );
    res.documentNotes.push(
      'Supply meant for export under Letter of Undertaking (LUT) without payment of integrated tax',
    );
    res.warnings.push(
      'Exports are zero-rated only with a valid LUT/bond; otherwise charge IGST and claim a refund. Services need payment in foreign exchange.',
    );
    res.taxFree = true;
    res.taxes.push(...withholdingTaxes(profile.withholding, ctx, res));
    return res;
  }

  // ---- rate -----------------------------------------------------------------------------------------------------------
  const explicit = explicitRate(ctx);
  let pct: string;
  let exemptKind: 'exempt' | 'zero' | null = null;
  if (explicit) {
    pct = explicit.percent;
    res.reasons.push(
      explicit.source === 'override'
        ? `GST rate ${pct}% entered manually for this line.`
        : `GST rate ${pct}% taken from the product's HSN/SAC setup${ctx.product.code ? ` (${ctx.product.code})` : ''}.`,
    );
    const known = RATES.some(
      (r) =>
        r.category !== 'exempt' &&
        r.ratePercent === pct &&
        r.effectiveFrom <= ctx.date &&
        (!r.effectiveTo || r.effectiveTo >= ctx.date),
    );
    if (!known) {
      res.warnings.push(
        `${pct}% is not a standard GST slab on ${ctx.date}: check the product's rate.`,
      );
    }
  } else {
    const category = ctx.product.category ?? 'standard';
    const code = CATEGORY_CODE[category] ?? 'GST_18';
    const row = rateInForce(RATES, { code, date: ctx.date });
    if (!row) {
      res.warnings.push(
        'No GST rate is in force for that category on the supply date; pick a rate manually.',
      );
      return res;
    }
    if (row.category === 'exempt') exemptKind = 'exempt';
    else if (row.category === 'zero') exemptKind = 'zero';
    pct = row.ratePercent;
    if (!ctx.product.category) {
      res.warnings.push(
        `No GST rate set on the product: ${pct}% (the standard slab) is assumed. Set the product's HSN/SAC and GST rate.`,
      );
    }
    res.reasons.push(`Product category "${category}" maps to GST ${pct}% on ${ctx.date}.`);
  }

  if (exemptKind === 'exempt') {
    res.taxes.push(zeroTax('GST_EXEMPT', 'GST exempt', 'exempt'));
    res.documentTypeHint = 'bill_of_supply';
    res.documentNotes.push('Exempt supply: issue a Bill of Supply; no tax charged');
    res.taxFree = true;
    res.taxes.push(...withholdingTaxes(profile.withholding, ctx, res));
    return res;
  }

  // ---- place of supply ------------------------------------------------------------------------------------------------
  let pos = indiaState(ctx.buyer.region);
  if (ctx.supplyType !== 'goods' && business && buyerGstin?.valid) {
    pos = indiaState(buyerGstin.details!['stateCode']) ?? pos;
    res.reasons.push(
      'Services to a GST-registered business: the place of supply is the state of the recipient (from the buyer GSTIN).',
    );
  } else if (ctx.supplyType === 'goods') {
    res.reasons.push(
      'Goods: the place of supply is where delivery ends (the buyer / ship-to state).',
    );
  } else {
    res.reasons.push(
      'Services to an unregistered buyer: the place of supply is the buyer address, else the supplier location.',
    );
  }
  if (!pos) {
    pos = sellerState;
    res.warnings.push(
      'The buyer state is missing: place of supply assumed to be the seller state (intra-state). Add the buyer state.',
    );
  }
  if (!sellerState) {
    res.warnings.push(
      'The seller state is missing: add it in the tax settings so CGST+SGST vs IGST can be decided.',
    );
  }
  res.placeOfSupply = pos ? { country: 'IN', region: pos.code } : { country: 'IN' };

  const inter =
    ctx.buyer.isSez === true || Boolean(sellerState && pos && sellerState.code !== pos.code);
  if (pct === '0' || exemptKind === 'zero') {
    res.taxes.push(zeroTax(inter ? 'IGST' : 'CGST', inter ? 'IGST 0%' : 'GST 0%', 'zero'));
    res.taxFree = true;
    res.reasons.push('The rate is nil: no GST is charged, but the supply is reported.');
  } else if (inter) {
    res.taxes.push({ code: 'IGST', name: `IGST ${pct}%`, rate: pct, category: 'standard' });
    res.reasons.push(
      ctx.buyer.isSez
        ? 'The buyer is in a Special Economic Zone: IGST applies as for an inter-state supply.'
        : `Seller state (${sellerState?.name}) differs from place of supply (${pos?.name}): inter-state supply, so IGST ${pct}%.`,
    );
    if (ctx.buyer.isSez) res.documentNotes.push('Supply to SEZ unit/developer');
  } else {
    splitIntra(res, pct, pos?.utgst === true);
    res.reasons.push(
      `Seller and place of supply are both ${pos?.name ?? 'the same state'}: intra-state, so CGST + ${pos?.utgst ? 'UTGST' : 'SGST'} ${half(pct)}% each (${pct}% in all).`,
    );
  }
  if (ctx.product.reverseCharge) {
    res.reverseCharge = true;
    res.documentNotes.push('Tax payable on reverse charge basis: Yes');
    res.reasons.push(
      'Reverse charge mechanism applies to this supply: the recipient pays the tax to the government.',
    );
  } else {
    res.documentNotes.push('Tax payable on reverse charge basis: No');
  }
  res.taxes.push(...withholdingTaxes(profile.withholding, ctx, res));
  return res;
}

const CHECKLIST: ChecklistItem[] = commonChecklist({
  title: 'TAX INVOICE',
  extra: [
    {
      field: 'document_title',
      label: 'Exempt or composition supplies carry the title "BILL OF SUPPLY"',
      level: 'required',
      when: 'composition',
      mustContain: 'BILL OF SUPPLY',
    },
    {
      field: 'buyer_address',
      label: 'Buyer name, address and state',
      level: 'required',
      when: 'b2b',
    },
    {
      field: 'buyer_tax_id',
      label: 'Buyer GSTIN (registered buyers)',
      level: 'required',
      when: 'b2b',
    },
    {
      field: 'line_hsn_sac',
      label: 'HSN/SAC code per line (4 digits up to INR 5 crore turnover, 6 digits above)',
      level: 'required',
      when: 'b2b',
      note: 'For B2C it is required above the turnover threshold.',
    },
    {
      field: 'place_of_supply',
      label: 'Place of supply with state name and code',
      level: 'required',
      when: 'inter_state',
    },
    {
      field: 'taxable_value',
      label: 'Taxable value after discount, and CGST/SGST or IGST rate and amount',
      level: 'required',
      when: 'always',
    },
    {
      field: 'reverse_charge_wording',
      label: 'Whether tax is payable on reverse charge basis',
      level: 'required',
      when: 'always',
      mustContain: 'reverse charge',
    },
    {
      field: 'authorised_signature',
      label: 'Signature or digital signature of the supplier',
      level: 'required',
      when: 'always',
    },
    {
      field: 'e_invoice_irn',
      label: 'e-invoice IRN and QR code (businesses above the e-invoicing turnover limit)',
      level: 'recommended',
      when: 'b2b',
    },
    {
      field: 'export_wording',
      label: 'Export: LUT/bond reference or "with payment of IGST"',
      level: 'required',
      when: 'export',
    },
  ],
});

export const INDIA_PROFILE: TaxProfile = {
  code: 'IN',
  name: 'India (GST)',
  currency: 'INR',
  locale: 'en-IN',
  taxLabel: 'GST',
  support: 'full',
  pricesIncludeTaxDefault: false,
  rounding: {
    level: 'per_line',
    mode: 'half_up',
    dictatedByLaw: false,
    note: 'GST invoices show tax per line; round each line to the paisa. Total rounded to the nearest rupee only as a separate "round off" line.',
  },
  rates: RATES,
  withholding: WITHHOLDING,
  sellerTaxId: {
    spec: ID_SPECS.gstin,
    requirement: 'required_if_registered',
    note: 'Mandatory on tax invoices; a composition dealer also has one.',
  },
  buyerTaxId: {
    spec: ID_SPECS.gstin,
    requirement: 'b2b_only',
    note: 'Needed for the buyer to claim input tax credit.',
  },
  otherIds: [ID_SPECS.pan],
  documentTitles: {
    tax_invoice: 'TAX INVOICE',
    bill_of_supply: 'BILL OF SUPPLY',
    credit_note: 'CREDIT NOTE',
    debit_note: 'DEBIT NOTE',
  },
  checklist: CHECKLIST,
  fiscalYear: {
    startMonth: 4,
    startDay: 1,
    labelFormat: 'YYYY-YY',
    note: 'Indian financial year 1 April to 31 March.',
  },
  numbering: numbering({
    pattern: '{PREFIX}/{FY}/{SEQ}',
    defaultPrefix: 'INV',
    seqPad: 4,
    reset: 'fiscal_year',
    maxLength: 16,
    allowed: '^[A-Za-z0-9/-]+$',
    rule: 'Consecutive serial number, unique per financial year, maximum 16 characters, letters, digits, "-" and "/" only (Rule 46 CGST Rules).',
  }),
  regions: INDIA_STATES.map((s) => ({ code: s.code, name: s.name })),
  notes: [
    'GST slabs were simplified on 22 Sep 2025 to 5% and 18% (plus 40% for demerit goods); the 12% and 28% slabs are kept with an end date so older invoices stay reproducible.',
    'Intra-state supply: CGST + SGST (UTGST in union territories without a legislature) at half the rate each; inter-state, SEZ and deemed exports: IGST.',
    'Composition scheme dealers cannot charge GST or claim input credit: issue a Bill of Supply with the composition wording.',
    'HSN/SAC: 4 digits up to INR 5 crore aggregate turnover, 6 digits above. The engine does not ship an HSN-to-rate table: store the GST rate on the product.',
    'e-invoicing (IRN + QR) is mandatory above the turnover threshold set by the GST Council (INR 5 crore at last check). e-way bill is needed for goods consignments above INR 50,000.',
    'TDS/TCS rows are the common sections only; the deductor files and deposits them. They reduce the amount payable, not the invoice total.',
  ],
  sources: [
    {
      name: 'CBIC GST rates and notifications',
      url: 'https://cbic-gst.gov.in/gst-goods-services-rates.html',
      asOf: '2026-09-01',
    },
    {
      name: 'CGST Rules 2017, Rule 46 (tax invoice)',
      url: 'https://cbic-gst.gov.in/',
      asOf: '2026-09-01',
    },
    {
      name: 'Income Tax Act, Chapter XVII-B (TDS)',
      url: 'https://incometaxindia.gov.in/',
      asOf: '2026-09-01',
    },
  ],
  resolve: resolveIndia,
};

/** CGST / SGST / IGST components of a combined slab, for presets and the UI. */
export function indiaSplit(pct: string): { intra: LineTaxInput[]; inter: LineTaxInput[] } {
  const h = half(pct);
  return {
    intra: [
      { code: 'CGST', name: `CGST ${h}%`, rate: h, category: 'standard' },
      { code: 'SGST', name: `SGST ${h}%`, rate: h, category: 'standard' },
    ],
    inter: [{ code: 'IGST', name: `IGST ${pct}%`, rate: pct, category: 'standard' }],
  };
}
