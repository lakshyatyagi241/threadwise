import { commonChecklist, makeSimpleResolver, rate, ZERO_AND_EXEMPT } from '../common';
import type {
  ChecklistItem,
  NumberingRules,
  RateRow,
  Requirement,
  ResolveContext,
  ResolveResult,
  Source,
  TaxIdSpec,
  TaxProfile,
} from '../types';
import { ID_SPECS } from '../validators';
import { emptyResult, FY_JAN, numbering } from '../utils';

/**
 * Single-rate VAT / GST / SST / consumption-tax profiles and the "no automatic tax" ones. Rates are defaults to verify.
 */

interface Def {
  code: string;
  name: string;
  currency: string;
  locale: string;
  taxLabel: string;
  support?: TaxProfile['support'];
  pricesIncludeTaxDefault?: boolean;
  rounding?: Partial<TaxProfile['rounding']>;
  rates: RateRow[];
  withholding?: RateRow[];
  seller: { spec: TaxIdSpec | null; requirement: Requirement; note?: string };
  buyer: { spec: TaxIdSpec | null; requirement: Requirement; note?: string };
  titles: Record<string, string>;
  checklist: ChecklistItem[];
  fiscalYear?: TaxProfile['fiscalYear'];
  numbering?: NumberingRules;
  notes: string[];
  sources: Source[];
}

function build(
  d: Def,
  resolve: (self: TaxProfile) => (ctx: ResolveContext) => ResolveResult,
): TaxProfile {
  const profile: TaxProfile = {
    code: d.code,
    name: d.name,
    currency: d.currency,
    locale: d.locale,
    taxLabel: d.taxLabel,
    support: d.support ?? 'full',
    pricesIncludeTaxDefault: d.pricesIncludeTaxDefault ?? false,
    rounding: {
      level: 'per_line',
      mode: 'half_up',
      dictatedByLaw: false,
      note: 'Each line is rounded to the minor unit; no statutory rounding rule, so the engine default is used.',
      ...d.rounding,
    },
    rates: d.rates,
    ...(d.withholding ? { withholding: d.withholding } : {}),
    sellerTaxId: d.seller,
    buyerTaxId: d.buyer,
    documentTitles: d.titles,
    checklist: d.checklist,
    fiscalYear: d.fiscalYear ?? FY_JAN,
    numbering:
      d.numbering ??
      numbering({
        rule: 'Sequential, unique numbers; gaps must be explainable (voided numbers kept).',
        pattern: '{PREFIX}-{YYYY}-{SEQ}',
      }),
    notes: d.notes,
    sources: d.sources,
    resolve: (ctx) => resolve(profile)(ctx),
  };
  return profile;
}

const simple = (
  d: Def,
  cfg: Omit<Parameters<typeof makeSimpleResolver>[1], 'country' | 'label'> & { label?: string },
) => {
  const label = cfg.label ?? d.taxLabel;
  return build(d, (self) => makeSimpleResolver(() => self, { ...cfg, country: d.code, label }));
};

const STD_CODES = {
  standard: 'VAT_STD',
  reduced: 'VAT_RED',
  zero: 'VAT_ZERO',
  exempt: 'VAT_EXEMPT',
} as const;
const NOT_REG = (what: string) => `Supplier is not registered for ${what}; no tax charged`;

// --- Gulf -----------------------------------------------------------------------------------------------------------------

export const UAE_PROFILE: TaxProfile = simple(
  {
    code: 'AE',
    name: 'United Arab Emirates (VAT)',
    currency: 'AED',
    locale: 'en-AE',
    taxLabel: 'VAT',
    rates: [
      rate('VAT_STD', 'VAT 5%', 'vat', 'standard', '5', '2018-01-01', { isDefault: true }),
      ...ZERO_AND_EXEMPT('VAT', 'vat', 'VAT', '2018-01-01'),
    ],
    seller: {
      spec: ID_SPECS.uaeTrn,
      requirement: 'required_if_registered',
      note: 'Tax Registration Number (TRN), 15 digits.',
    },
    buyer: {
      spec: ID_SPECS.uaeTrn,
      requirement: 'b2b_only',
      note: 'Required for a full tax invoice to a VAT-registered buyer.',
    },
    titles: { tax_invoice: 'Tax Invoice', credit_note: 'Tax Credit Note' },
    checklist: commonChecklist({
      title: 'Tax Invoice',
      extra: [
        {
          field: 'buyer_address',
          label: 'Buyer name, address and TRN (full tax invoice)',
          level: 'required',
          when: 'b2b',
        },
        {
          field: 'supply_date',
          label: 'Date of supply if different from the invoice date',
          level: 'required',
          when: 'always',
        },
        {
          field: 'aed_equivalent',
          label: 'Amounts in AED (with the exchange rate when invoicing in another currency)',
          level: 'required',
          when: 'always',
        },
      ],
    }),
    notes: [
      'VAT 5% since 1 Jan 2018. Zero-rated: exports outside the GCC, international transport, certain education/health, first sale of residential property. Exempt: some financial services, residential rent, bare land, local passenger transport.',
      'A simplified tax invoice (fewer fields) is allowed for B2C supplies and for B2B supplies up to AED 10,000.',
      'Registration is mandatory above AED 375,000 annual taxable supplies (voluntary from AED 187,500). Corporate tax (9%) does not appear on invoices.',
      'Designated Zones can be treated as outside the UAE for goods; the engine does not model them: pick zero-rated by hand.',
    ],
    sources: [
      {
        name: 'UAE Federal Tax Authority: VAT guide',
        url: 'https://tax.gov.ae/en/taxes/vat.aspx',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: STD_CODES,
    zeroCode: 'VAT',
    exportGoods: { category: 'zero', note: 'Zero-rated export of goods' },
    exportServicesB2B: { category: 'zero', note: 'Zero-rated export of services' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('VAT'),
    alwaysWarn: [
      'Exports to GCC implementing states follow the GCC rules (place of supply = destination); confirm with the FTA.',
    ],
  },
);

export const SAUDI_PROFILE: TaxProfile = simple(
  {
    code: 'SA',
    name: 'Saudi Arabia (VAT)',
    currency: 'SAR',
    locale: 'en-SA',
    taxLabel: 'VAT',
    rates: [
      rate('VAT_STD', 'VAT 5%', 'vat', 'standard', '5', '2018-01-01', {
        effectiveTo: '2020-06-30',
      }),
      rate('VAT_STD', 'VAT 15%', 'vat', 'standard', '15', '2020-07-01', { isDefault: true }),
      ...ZERO_AND_EXEMPT('VAT', 'vat', 'VAT', '2018-01-01'),
    ],
    seller: {
      spec: ID_SPECS.saudiVat,
      requirement: 'required_if_registered',
      note: '15-digit VAT number starting and ending with 3.',
    },
    buyer: { spec: ID_SPECS.saudiVat, requirement: 'b2b_only' },
    titles: {
      tax_invoice: 'Tax Invoice',
      simplified: 'Simplified Tax Invoice',
      credit_note: 'Credit Note',
      debit_note: 'Debit Note',
    },
    checklist: commonChecklist({
      title: 'Tax Invoice',
      extra: [
        { field: 'qr_code', label: 'ZATCA QR code (e-invoice)', level: 'required', when: 'always' },
        {
          field: 'arabic_text',
          label: 'Arabic language (English may be added)',
          level: 'required',
          when: 'always',
        },
        {
          field: 'buyer_address',
          label: 'Buyer name, address and VAT number (B2B)',
          level: 'required',
          when: 'b2b',
        },
      ],
    }),
    notes: [
      'VAT 15% since 1 Jul 2020 (5% from 1 Jan 2018 to 30 Jun 2020).',
      'ZATCA e-invoicing (FATOORA) is mandatory in phases: invoices must be generated, cleared (B2B) or reported (B2C) through ZATCA-compliant software. This engine computes the amounts only; it does not produce the XML/QR.',
      'Invoices must be in Arabic (a second language may be added).',
    ],
    sources: [
      {
        name: 'ZATCA: VAT',
        url: 'https://zatca.gov.sa/en/RulesRegulations/Taxes/Pages/default.aspx',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: STD_CODES,
    zeroCode: 'VAT',
    exportGoods: { category: 'zero', note: 'Zero-rated export of goods' },
    exportServicesB2B: { category: 'zero', note: 'Zero-rated export of services' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('VAT'),
  },
);

export const BAHRAIN_PROFILE: TaxProfile = simple(
  {
    code: 'BH',
    name: 'Bahrain (VAT)',
    currency: 'BHD',
    locale: 'en-BH',
    taxLabel: 'VAT',
    rates: [
      rate('VAT_STD', 'VAT 5%', 'vat', 'standard', '5', '2019-01-01', {
        effectiveTo: '2021-12-31',
      }),
      rate('VAT_STD', 'VAT 10%', 'vat', 'standard', '10', '2022-01-01', { isDefault: true }),
      ...ZERO_AND_EXEMPT('VAT', 'vat', 'VAT', '2019-01-01'),
    ],
    seller: { spec: ID_SPECS.bahrainVat, requirement: 'required_if_registered' },
    buyer: { spec: ID_SPECS.bahrainVat, requirement: 'b2b_only' },
    titles: { tax_invoice: 'Tax Invoice', credit_note: 'Tax Credit Note' },
    checklist: commonChecklist({ title: 'Tax Invoice' }),
    notes: [
      'VAT 10% since 1 Jan 2022 (5% from 1 Jan 2019). BHD has 3 decimals (fils).',
      'The VAT account number format here is a loose 15-digit check: confirm it on the NBR portal.',
    ],
    sources: [
      {
        name: 'Bahrain National Bureau for Revenue',
        url: 'https://www.nbr.gov.bh/',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: STD_CODES,
    zeroCode: 'VAT',
    exportGoods: { category: 'zero', note: 'Zero-rated export of goods' },
    exportServicesB2B: { category: 'zero', note: 'Zero-rated export of services' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('VAT'),
  },
);

export const OMAN_PROFILE: TaxProfile = simple(
  {
    code: 'OM',
    name: 'Oman (VAT)',
    currency: 'OMR',
    locale: 'en-OM',
    taxLabel: 'VAT',
    rates: [
      rate('VAT_STD', 'VAT 5%', 'vat', 'standard', '5', '2021-04-16', { isDefault: true }),
      ...ZERO_AND_EXEMPT('VAT', 'vat', 'VAT', '2021-04-16'),
    ],
    seller: { spec: ID_SPECS.omanVat, requirement: 'required_if_registered' },
    buyer: { spec: ID_SPECS.omanVat, requirement: 'b2b_only' },
    titles: { tax_invoice: 'Tax Invoice', credit_note: 'Tax Credit Note' },
    checklist: commonChecklist({ title: 'Tax Invoice' }),
    notes: [
      'VAT 5% since 16 Apr 2021. OMR has 3 decimals (baisa). Registration threshold OMR 38,500.',
    ],
    sources: [
      { name: 'Oman Tax Authority', url: 'https://tms.taxation.gov.om/', asOf: '2026-09-01' },
    ],
  },
  {
    codes: STD_CODES,
    zeroCode: 'VAT',
    exportGoods: { category: 'zero', note: 'Zero-rated export of goods' },
    exportServicesB2B: { category: 'zero', note: 'Zero-rated export of services' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('VAT'),
  },
);

function noTaxProfile(
  code: string,
  name: string,
  currency: string,
  locale: string,
  notes: string[],
  source: Source,
): TaxProfile {
  return build(
    {
      code,
      name,
      currency,
      locale,
      taxLabel: 'Tax',
      support: 'note_only',
      rates: [],
      seller: { spec: null, requirement: 'not_applicable' },
      buyer: { spec: null, requirement: 'not_applicable' },
      titles: { invoice: 'Invoice' },
      checklist: commonChecklist({}).filter(
        (i) => !['seller_tax_id', 'line_tax_rate', 'tax_summary', 'buyer_tax_id'].includes(i.field),
      ),
      notes,
      sources: [source],
    },
    () => (ctx) => {
      const res = emptyResult({ taxFree: true });
      res.placeOfSupply = { country: code };
      res.reasons.push(
        `${name} has no general VAT/GST in this preset: no tax is added automatically.`,
      );
      if (ctx.overrideRatePercent !== undefined || ctx.product.ratePercent !== undefined) {
        res.warnings.push(
          'A rate was given but this country has no tax preset; add it manually on the document if you are sure.',
        );
      }
      return res;
    },
  );
}

export const QATAR_PROFILE = noTaxProfile(
  'QA',
  'Qatar (no VAT)',
  'QAR',
  'en-QA',
  [
    'Qatar has announced a GCC VAT but had not implemented it at the date of this preset. No tax is added automatically.',
    'If VAT is introduced, add it with the "custom" rates or update this profile.',
  ],
  { name: 'General Tax Authority, Qatar', url: 'https://www.gta.gov.qa/', asOf: '2026-09-01' },
);

export const KUWAIT_PROFILE = noTaxProfile(
  'KW',
  'Kuwait (no VAT)',
  'KWD',
  'en-KW',
  [
    'Kuwait had not implemented VAT at the date of this preset. No tax is added automatically. KWD has 3 decimals (fils).',
    'If VAT is introduced, add it with the "custom" rates or update this profile.',
  ],
  { name: 'Kuwait Ministry of Finance', url: 'https://www.mof.gov.kw/', asOf: '2026-09-01' },
);

// --- Asia-Pacific ---------------------------------------------------------------------------------------------------------

export const AUSTRALIA_PROFILE: TaxProfile = simple(
  {
    code: 'AU',
    name: 'Australia (GST)',
    currency: 'AUD',
    locale: 'en-AU',
    taxLabel: 'GST',
    rates: [
      rate('GST_STD', 'GST 10%', 'gst', 'standard', '10', '2000-07-01', { isDefault: true }),
      rate('GST_ZERO', 'GST-free', 'gst', 'zero', '0', '2000-07-01', {
        note: 'Basic food, health, education, exports.',
      }),
      rate('GST_EXEMPT', 'Input taxed', 'gst', 'exempt', '0', '2000-07-01', {
        note: 'Financial supplies, residential rent.',
      }),
    ],
    seller: {
      spec: ID_SPECS.abn,
      requirement: 'required_if_registered',
      note: 'ABN (11 digits). Required on a tax invoice.',
    },
    buyer: {
      spec: ID_SPECS.abn,
      requirement: 'b2b_only',
      note: 'Buyer identity or ABN is required on invoices of AUD 1,000 or more.',
    },
    titles: { tax_invoice: 'Tax invoice', credit_note: 'Adjustment note' },
    checklist: commonChecklist({
      title: 'Tax invoice',
      extra: [
        {
          field: 'gst_amount',
          label: 'GST amount, or a statement "Total price includes GST"',
          level: 'required',
          when: 'always',
        },
        {
          field: 'buyer_address',
          label: 'Buyer name and address or ABN',
          level: 'required',
          when: 'above_threshold',
          thresholdMajor: '1000',
        },
      ],
    }),
    rounding: {
      note: 'GST is rounded to the nearest cent per invoice; per-line rounding is accepted.',
    },
    notes: [
      'GST 10% since 1 Jul 2000. The words "Tax invoice" must be stated prominently. Sales of AUD 82.50 (incl. GST) or less need no tax invoice unless requested.',
      'Registration is required at AUD 75,000 annual turnover (AUD 150,000 for non-profits).',
      'AUD cash rounds to 5 cents (cash rounding is available as an option).',
    ],
    sources: [
      {
        name: 'Australian Taxation Office: tax invoices',
        url: 'https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: { standard: 'GST_STD', zero: 'GST_ZERO', exempt: 'GST_EXEMPT' },
    zeroCode: 'GST',
    exportGoods: { category: 'zero', note: 'GST-free export' },
    exportServicesB2B: { category: 'zero', note: 'GST-free supply (export of services)' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('GST'),
  },
);

export const NEW_ZEALAND_PROFILE: TaxProfile = simple(
  {
    code: 'NZ',
    name: 'New Zealand (GST)',
    currency: 'NZD',
    locale: 'en-NZ',
    taxLabel: 'GST',
    rates: [
      rate('GST_STD', 'GST 15%', 'gst', 'standard', '15', '2010-10-01', { isDefault: true }),
      rate('GST_ZERO', 'GST 0% (zero-rated)', 'gst', 'zero', '0', '1986-10-01', {
        note: 'Exports, going-concern sales, land transactions between registered persons.',
      }),
      rate('GST_EXEMPT', 'GST exempt', 'gst', 'exempt', '0', '1986-10-01', {
        note: 'Financial services, residential rent.',
      }),
    ],
    seller: {
      spec: ID_SPECS.nzIrd,
      requirement: 'required_if_registered',
      note: 'GST number = IRD number (8 or 9 digits).',
    },
    buyer: { spec: ID_SPECS.nzIrd, requirement: 'b2b_only' },
    titles: { tax_invoice: 'Tax Invoice', credit_note: 'Credit Note', debit_note: 'Debit Note' },
    checklist: commonChecklist({
      title: 'Tax Invoice',
      extra: [
        {
          field: 'buyer_address',
          label: 'Buyer name and address (supplies above NZD 1,000)',
          level: 'required',
          when: 'above_threshold',
          thresholdMajor: '1000',
        },
      ],
    }),
    fiscalYear: {
      startMonth: 4,
      startDay: 1,
      labelFormat: 'YYYY-YY',
      note: 'NZ tax year 1 April to 31 March.',
    },
    notes: [
      'GST 15% since 1 Oct 2010. "Tax invoice" must be stated; requirements grow in tiers (up to NZD 200, up to NZD 1,000, above). Registration threshold NZD 60,000.',
      'Cash rounds to 10 cents.',
    ],
    sources: [
      {
        name: 'Inland Revenue: tax invoices',
        url: 'https://www.ird.govt.nz/gst/tax-invoices-credit-and-debit-notes',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: { standard: 'GST_STD', zero: 'GST_ZERO', exempt: 'GST_EXEMPT' },
    zeroCode: 'GST',
    exportGoods: { category: 'zero', note: 'Zero-rated supply (export of goods)' },
    exportServicesB2B: {
      category: 'zero',
      note: 'Zero-rated supply (services supplied to a non-resident)',
    },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('GST'),
  },
);

export const SINGAPORE_PROFILE: TaxProfile = simple(
  {
    code: 'SG',
    name: 'Singapore (GST)',
    currency: 'SGD',
    locale: 'en-SG',
    taxLabel: 'GST',
    rates: [
      rate('GST_STD', 'GST 7%', 'gst', 'standard', '7', '2007-07-01', {
        effectiveTo: '2022-12-31',
      }),
      rate('GST_STD', 'GST 8%', 'gst', 'standard', '8', '2023-01-01', {
        effectiveTo: '2023-12-31',
      }),
      rate('GST_STD', 'GST 9%', 'gst', 'standard', '9', '2024-01-01', { isDefault: true }),
      rate('GST_ZERO', 'GST 0% (zero-rated)', 'gst', 'zero', '0', '1994-04-01', {
        note: 'Exports and international services.',
      }),
      rate('GST_EXEMPT', 'GST exempt', 'gst', 'exempt', '0', '1994-04-01', {
        note: 'Financial services, residential property.',
      }),
    ],
    seller: {
      spec: ID_SPECS.sgGst,
      requirement: 'required_if_registered',
      note: 'GST registration number (UEN or M2/M9 number).',
    },
    buyer: { spec: ID_SPECS.sgGst, requirement: 'b2b_only' },
    titles: { tax_invoice: 'Tax Invoice', credit_note: 'Credit Note' },
    checklist: commonChecklist({
      title: 'Tax Invoice',
      extra: [
        {
          field: 'buyer_address',
          label:
            'Buyer name and address (full tax invoice; simplified invoice allowed up to SGD 1,000)',
          level: 'required',
          when: 'b2b',
        },
      ],
    }),
    notes: [
      'GST 9% since 1 Jan 2024 (8% during 2023, 7% before). Registration is compulsory above SGD 1 million taxable turnover.',
      'Overseas vendor registration (OVR) applies to B2C digital services; not modelled.',
      'Singapore InvoiceNow (Peppol) is mandatory for GST-registered businesses in phases; this engine does not produce the e-invoice.',
    ],
    sources: [
      {
        name: 'IRAS: GST',
        url: 'https://www.iras.gov.sg/taxes/goods-services-tax-(gst)',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: { standard: 'GST_STD', zero: 'GST_ZERO', exempt: 'GST_EXEMPT' },
    zeroCode: 'GST',
    exportGoods: { category: 'zero', note: 'Zero-rated supply (export of goods)' },
    exportServicesB2B: { category: 'zero', note: 'Zero-rated supply (international service)' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('GST'),
  },
);

export const MALAYSIA_PROFILE: TaxProfile = simple(
  {
    code: 'MY',
    name: 'Malaysia (SST)',
    currency: 'MYR',
    locale: 'ms-MY',
    taxLabel: 'SST',
    rates: [
      rate('SST_SALES', 'Sales tax 10%', 'sst', 'standard', '10', '2018-09-01', {
        appliesTo: ['goods'],
        isDefault: true,
      }),
      rate('SST_SALES_5', 'Sales tax 5%', 'sst', 'reduced', '5', '2018-09-01', {
        appliesTo: ['goods'],
      }),
      rate('SST_SVC', 'Service tax 6%', 'sst', 'standard', '6', '2018-09-01', {
        effectiveTo: '2024-02-29',
        appliesTo: ['services', 'digital'],
      }),
      rate('SST_SVC', 'Service tax 8%', 'sst', 'standard', '8', '2024-03-01', {
        appliesTo: ['services', 'digital'],
        isDefault: true,
      }),
      rate('SST_SVC_6', 'Service tax 6%', 'sst', 'reduced', '6', '2024-03-01', {
        appliesTo: ['services', 'digital'],
        note: 'Food and beverage, telecommunications, parking, logistics.',
      }),
      rate('SST_ZERO', 'SST 0% (exempt goods/services)', 'sst', 'zero', '0', '2018-09-01'),
      rate('SST_EXEMPT', 'SST exempt', 'sst', 'exempt', '0', '2018-09-01'),
    ],
    seller: { spec: ID_SPECS.mySst, requirement: 'required_if_registered' },
    buyer: { spec: null, requirement: 'optional' },
    titles: { tax_invoice: 'Tax Invoice', credit_note: 'Credit Note' },
    checklist: commonChecklist({
      title: 'Tax Invoice',
      extra: [
        {
          field: 'e_invoice_uuid',
          label: 'MyInvois e-invoice validation (UUID / QR) where the e-invoicing phase applies',
          level: 'recommended',
          when: 'always',
        },
      ],
    }),
    notes: [
      'SST has two parts: SALES tax on goods (10% or 5%) charged by manufacturers, and SERVICE tax on prescribed services (8% from 1 Mar 2024, 6% before; some services stay at 6%). The engine picks sales vs service tax from the supply type.',
      'Registration threshold: MYR 500,000 of taxable turnover in 12 months (MYR 1.5 million for some food and beverage).',
      'MyInvois e-invoicing is being phased in by turnover from 2024; this engine does not produce it.',
      'Scope of service tax widened on 1 Jul 2025 (rental, leasing, construction, financial, health, education, beauty): rate rows are unchanged.',
    ],
    sources: [
      {
        name: 'Royal Malaysian Customs: SST',
        url: 'https://mysst.customs.gov.my/',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    label: 'SST',
    codes: {
      standard: 'SST_SALES',
      reduced: 'SST_SALES_5',
      zero: 'SST_ZERO',
      exempt: 'SST_EXEMPT',
    },
    codesBySupply: {
      services: { standard: 'SST_SVC', reduced: 'SST_SVC_6' },
      digital: { standard: 'SST_SVC', reduced: 'SST_SVC_6' },
    },
    zeroCode: 'SST',
    exportGoods: { category: 'zero', note: 'Exported goods: exempt from sales tax' },
    exportServicesB2B: { category: 'exempt', note: 'Exported service: not subject to service tax' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('SST'),
  },
);

export const JAPAN_PROFILE: TaxProfile = simple(
  {
    code: 'JP',
    name: 'Japan (consumption tax)',
    currency: 'JPY',
    locale: 'ja-JP',
    taxLabel: 'Consumption tax',
    rates: [
      rate('CT_STD', 'Consumption tax 8%', 'consumption_tax', 'standard', '8', '2014-04-01', {
        effectiveTo: '2019-09-30',
      }),
      rate('CT_STD', 'Consumption tax 10%', 'consumption_tax', 'standard', '10', '2019-10-01', {
        isDefault: true,
      }),
      rate('CT_RED', 'Reduced rate 8%', 'consumption_tax', 'reduced', '8', '2019-10-01', {
        note: 'Food and non-alcoholic drinks (not dining in), newspapers by subscription.',
      }),
      rate(
        'CT_ZERO',
        'Consumption tax 0% (export exempt)',
        'consumption_tax',
        'zero',
        '0',
        '1989-04-01',
      ),
      rate('CT_EXEMPT', 'Non-taxable', 'consumption_tax', 'exempt', '0', '1989-04-01'),
    ],
    seller: {
      spec: ID_SPECS.jpInvoice,
      requirement: 'required_if_registered',
      note: 'Qualified Invoice Issuer number: T + 13 digits.',
    },
    buyer: { spec: null, requirement: 'optional' },
    titles: { invoice: 'Invoice (qualified invoice)', credit_note: 'Credit note' },
    rounding: {
      level: 'on_total',
      mode: 'half_up',
      dictatedByLaw: true,
      note: 'Qualified invoices round the tax ONCE per tax rate per invoice (rounding up, down or off is allowed, the choice must be consistent).',
    },
    fiscalYear: {
      startMonth: 4,
      startDay: 1,
      labelFormat: 'YYYY',
      note: 'Most companies use 1 April; sole proprietors use the calendar year.',
    },
    checklist: [
      { field: 'seller_name', label: 'Issuer name', level: 'required', when: 'always' },
      {
        field: 'seller_tax_id',
        label: 'Registration number (T + 13 digits)',
        level: 'required',
        when: 'always',
      },
      { field: 'issue_date', label: 'Transaction date', level: 'required', when: 'always' },
      {
        field: 'line_description',
        label: 'Description, with a mark on reduced-rate items',
        level: 'required',
        when: 'always',
      },
      {
        field: 'tax_summary',
        label: 'Total of taxable amount and tax amount per rate (8% / 10%)',
        level: 'required',
        when: 'always',
      },
      {
        field: 'line_tax_rate',
        label: 'Applicable rate per rate group',
        level: 'required',
        when: 'always',
      },
      { field: 'buyer_name', label: 'Recipient name', level: 'required', when: 'always' },
      { field: 'invoice_number', label: 'Invoice number', level: 'recommended', when: 'always' },
    ],
    notes: [
      'Consumption tax 10% standard, 8% reduced (since 1 Oct 2019). The Qualified Invoice System (since 1 Oct 2023) needs the issuer registration number and the taxable amount and tax per rate.',
      'Rounding is dictated by law: one rounding per rate per invoice, so the default level for Japan is "on_total".',
      'JPY has no minor unit.',
    ],
    sources: [
      {
        name: 'National Tax Agency: consumption tax',
        url: 'https://www.nta.go.jp/english/taxes/consumption_tax/',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: { standard: 'CT_STD', reduced: 'CT_RED', zero: 'CT_ZERO', exempt: 'CT_EXEMPT' },
    zeroCode: 'CT',
    exportGoods: { category: 'zero', note: 'Export exempt from consumption tax' },
    exportServicesB2B: {
      category: 'zero',
      note: 'Export of services: exempt from consumption tax',
    },
    exportServicesB2C: 'charge',
    notRegisteredNote: 'Issuer is not a qualified invoice issuer',
  },
);

// --- Africa ---------------------------------------------------------------------------------------------------------------

export const SOUTH_AFRICA_PROFILE: TaxProfile = simple(
  {
    code: 'ZA',
    name: 'South Africa (VAT)',
    currency: 'ZAR',
    locale: 'en-ZA',
    taxLabel: 'VAT',
    rates: [
      rate('VAT_STD', 'VAT 14%', 'vat', 'standard', '14', '1993-04-07', {
        effectiveTo: '2018-03-31',
      }),
      rate('VAT_STD', 'VAT 15%', 'vat', 'standard', '15', '2018-04-01', { isDefault: true }),
      ...ZERO_AND_EXEMPT('VAT', 'vat', 'VAT', '1993-04-07'),
    ],
    seller: { spec: ID_SPECS.zaVat, requirement: 'required_if_registered' },
    buyer: {
      spec: ID_SPECS.zaVat,
      requirement: 'b2b_only',
      note: 'Buyer VAT number and address required when the invoice exceeds ZAR 5,000.',
    },
    titles: { tax_invoice: 'Tax Invoice', credit_note: 'Credit Note', debit_note: 'Debit Note' },
    checklist: commonChecklist({
      title: 'Tax Invoice',
      extra: [
        {
          field: 'buyer_address',
          label: 'Buyer name, address and VAT number (above ZAR 5,000)',
          level: 'required',
          when: 'above_threshold',
          thresholdMajor: '5000',
        },
      ],
    }),
    fiscalYear: {
      startMonth: 3,
      startDay: 1,
      labelFormat: 'YYYY-YYYY',
      note: 'South African tax year 1 March to end February (individuals).',
    },
    notes: [
      'VAT 15% since 1 Apr 2018. Zero-rated: exports, basic foodstuffs (brown bread, maize meal, milk ...), fuel levy items. Exempt: financial services, residential rent, public transport.',
      'Registration is compulsory above ZAR 1 million taxable turnover in 12 months. The words "Tax Invoice", "VAT Invoice" or "Invoice" must appear.',
    ],
    sources: [
      {
        name: 'SARS: VAT',
        url: 'https://www.sars.gov.za/types-of-tax/value-added-tax/',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: STD_CODES,
    zeroCode: 'VAT',
    exportGoods: { category: 'zero', note: 'Zero-rated export of goods' },
    exportServicesB2B: { category: 'zero', note: 'Zero-rated supply (services to a non-resident)' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('VAT'),
  },
);

export const NIGERIA_PROFILE: TaxProfile = simple(
  {
    code: 'NG',
    name: 'Nigeria (VAT)',
    currency: 'NGN',
    locale: 'en-NG',
    taxLabel: 'VAT',
    rates: [
      rate('VAT_STD', 'VAT 5%', 'vat', 'standard', '5', '1994-01-01', {
        effectiveTo: '2020-01-31',
      }),
      rate('VAT_STD', 'VAT 7.5%', 'vat', 'standard', '7.5', '2020-02-01', { isDefault: true }),
      ...ZERO_AND_EXEMPT('VAT', 'vat', 'VAT', '1994-01-01'),
    ],
    seller: {
      spec: ID_SPECS.ngTin,
      requirement: 'required_if_registered',
      note: 'Tax Identification Number (TIN).',
    },
    buyer: { spec: ID_SPECS.ngTin, requirement: 'b2b_only' },
    titles: { tax_invoice: 'Tax Invoice', credit_note: 'Credit Note' },
    checklist: commonChecklist({
      title: 'Tax Invoice',
      extra: [
        {
          field: 'e_invoice_irn',
          label: 'FIRS e-invoicing (MBS) identifier / QR for businesses in the e-invoicing phase',
          level: 'recommended',
          when: 'b2b',
        },
      ],
    }),
    notes: [
      'VAT 7.5% since 1 Feb 2020. Zero-rated: exports, basic food, medical goods, educational books (varies); exempt lists are long. Small-business registration thresholds changed with the 2025 tax reforms: check the current limit.',
      'The Nigeria Tax Acts took effect in 2026; the VAT rate stayed 7.5% at the date of this preset. FIRS e-invoicing (MBS) is being phased in.',
    ],
    sources: [
      {
        name: 'Federal Inland Revenue Service',
        url: 'https://www.firs.gov.ng/',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: STD_CODES,
    zeroCode: 'VAT',
    exportGoods: { category: 'zero', note: 'Zero-rated export of goods' },
    exportServicesB2B: { category: 'zero', note: 'Zero-rated export of services' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('VAT'),
  },
);

export const KENYA_PROFILE: TaxProfile = simple(
  {
    code: 'KE',
    name: 'Kenya (VAT)',
    currency: 'KES',
    locale: 'en-KE',
    taxLabel: 'VAT',
    rates: [
      rate('VAT_STD', 'VAT 16%', 'vat', 'standard', '16', '2013-09-02', { isDefault: true }),
      ...ZERO_AND_EXEMPT('VAT', 'vat', 'VAT', '2013-09-02'),
    ],
    seller: {
      spec: ID_SPECS.kePin,
      requirement: 'required',
      note: 'KRA PIN. Every tax invoice must carry the supplier PIN.',
    },
    buyer: {
      spec: ID_SPECS.kePin,
      requirement: 'b2b_only',
      note: 'The buyer PIN is needed for the buyer to claim input VAT.',
    },
    titles: { tax_invoice: 'Tax Invoice', credit_note: 'Credit Note' },
    checklist: commonChecklist({
      title: 'Tax Invoice',
      extra: [
        {
          field: 'etims_qr',
          label: 'eTIMS control unit data / QR code (invoices must be issued through eTIMS)',
          level: 'required',
          when: 'always',
        },
      ],
    }),
    fiscalYear: {
      startMonth: 7,
      startDay: 1,
      labelFormat: 'YYYY-YY',
      note: 'Kenyan government and many companies use 1 July; income tax follows the calendar year for most.',
    },
    notes: [
      'VAT 16%. Registration threshold KES 5 million in 12 months. All tax invoices must be generated through KRA eTIMS; this engine only computes the amounts.',
      'Zero-rated: exports, some agricultural inputs. Exempt: unprocessed foods, some medical and educational goods.',
    ],
    sources: [
      { name: 'Kenya Revenue Authority', url: 'https://www.kra.go.ke/', asOf: '2026-09-01' },
    ],
  },
  {
    codes: STD_CODES,
    zeroCode: 'VAT',
    exportGoods: { category: 'zero', note: 'Zero-rated export of goods' },
    exportServicesB2B: { category: 'zero', note: 'Zero-rated export of services' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('VAT'),
  },
);

// --- Latin America ----------------------------------------------------------------------------------------------------------

export const MEXICO_PROFILE: TaxProfile = simple(
  {
    code: 'MX',
    name: 'Mexico (IVA)',
    currency: 'MXN',
    locale: 'es-MX',
    taxLabel: 'IVA',
    rates: [
      rate('IVA_STD', 'IVA 16%', 'iva', 'standard', '16', '2010-01-01', { isDefault: true }),
      rate('IVA_BORDER', 'IVA 8% (northern border region)', 'iva', 'reduced', '8', '2019-01-01', {
        note: 'Border-region stimulus; verify that the decree is still extended and that your address qualifies.',
      }),
      rate('IVA_ZERO', 'IVA 0%', 'iva', 'zero', '0', '2010-01-01', {
        note: 'Food, medicines, exports.',
      }),
      rate('IVA_EXEMPT', 'IVA exempt', 'iva', 'exempt', '0', '2010-01-01'),
    ],
    withholding: [
      rate(
        'RET_IVA_2_3',
        'IVA retention 10.6667%',
        'withholding',
        'withholding',
        '10.6667',
        '2014-01-01',
        {
          note: 'Two thirds of 16%: companies paying individuals for professional services or leasing.',
        },
      ),
      rate(
        'RET_IVA_4',
        'IVA retention 4% (freight)',
        'withholding',
        'withholding',
        '4',
        '2014-01-01',
      ),
      rate(
        'RET_ISR_10',
        'ISR retention 10% (professional fees)',
        'withholding',
        'withholding',
        '10',
        '2014-01-01',
        {
          note: 'Income-tax retention on fees paid by a company to an individual.',
        },
      ),
    ],
    seller: { spec: ID_SPECS.mexRfc, requirement: 'required' },
    buyer: {
      spec: ID_SPECS.mexRfc,
      requirement: 'required',
      note: 'The buyer RFC and CFDI use code are required to issue a CFDI.',
    },
    titles: { cfdi: 'Factura (CFDI)' },
    checklist: [
      {
        field: 'seller_tax_id',
        label: 'Issuer RFC and tax regime',
        level: 'required',
        when: 'always',
      },
      {
        field: 'buyer_tax_id',
        label: 'Receiver RFC, name, postal code, tax regime and CFDI use',
        level: 'required',
        when: 'always',
      },
      {
        field: 'cfdi_uuid',
        label: 'CFDI 4.0 stamped by a PAC (folio fiscal UUID, SAT seal, QR)',
        level: 'required',
        when: 'always',
        note: 'Mexican invoices are legal only when stamped through a PAC; this engine computes amounts, not the XML.',
      },
      {
        field: 'line_description',
        label: 'Product/service SAT key, unit key and description',
        level: 'required',
        when: 'always',
      },
      {
        field: 'tax_summary',
        label: 'Transferred taxes (IVA) and retentions',
        level: 'required',
        when: 'always',
      },
      { field: 'total_amount', label: 'Total', level: 'required', when: 'always' },
      {
        field: 'payment_method',
        label: 'Payment form and method (PUE / PPD)',
        level: 'required',
        when: 'always',
      },
    ],
    notes: [
      'IVA 16% (8% in the northern border region under a presidential stimulus; 0% for food, medicines and exports). CFDI 4.0 via an authorised PAC is mandatory: use the PAC for the legal document.',
      'Retentions (IVA and ISR) reduce the amount payable, not the invoice total.',
    ],
    sources: [
      {
        name: 'SAT (Servicio de Administracion Tributaria)',
        url: 'https://www.sat.gob.mx/',
        asOf: '2026-09-01',
      },
    ],
  },
  {
    codes: { standard: 'IVA_STD', reduced: 'IVA_BORDER', zero: 'IVA_ZERO', exempt: 'IVA_EXEMPT' },
    zeroCode: 'IVA',
    exportGoods: { category: 'zero', note: 'Exportacion: IVA tasa 0%' },
    exportServicesB2B: { category: 'zero', note: 'Exportacion de servicios: IVA tasa 0%' },
    exportServicesB2C: 'charge',
    notRegisteredNote: NOT_REG('IVA'),
  },
);

export const BRAZIL_PROFILE: TaxProfile = build(
  {
    code: 'BR',
    name: 'Brazil (note only)',
    currency: 'BRL',
    locale: 'pt-BR',
    taxLabel: 'Tax',
    support: 'note_only',
    rates: [],
    seller: {
      spec: ID_SPECS.cnpj,
      requirement: 'required',
      note: 'CNPJ (14 digits) or CPF for a sole proprietor.',
    },
    buyer: { spec: ID_SPECS.cnpj, requirement: 'b2b_only' },
    titles: { nfe: 'NF-e / NFS-e' },
    checklist: [
      { field: 'seller_tax_id', label: 'Issuer CNPJ', level: 'required', when: 'always' },
      { field: 'buyer_tax_id', label: 'Recipient CNPJ/CPF', level: 'required', when: 'always' },
      {
        field: 'nfe_key',
        label: 'Electronic fiscal document (NF-e / NFS-e) authorised by SEFAZ or the municipality',
        level: 'required',
        when: 'always',
        note: 'A legal Brazilian invoice is an authorised electronic fiscal note. This app cannot issue it.',
      },
    ],
    notes: [
      'Brazilian indirect tax is a mix of ICMS (state), ISS (municipal), IPI, PIS and COFINS (federal), with a reform (IBS/CBS) being phased in from 2026. Rates depend on product, state and the seller regime (Simples Nacional, Lucro Presumido, ...).',
      'No tax is computed automatically. Issue the legal fiscal note (NF-e/NFS-e) with certified fiscal software, and use this app for the commercial invoice, entering any tax amount manually (custom rate or override).',
    ],
    sources: [
      { name: 'Receita Federal', url: 'https://www.gov.br/receitafederal/', asOf: '2026-09-01' },
    ],
  },
  () => (ctx) => {
    const res = emptyResult();
    res.placeOfSupply = { country: 'BR' };
    res.reasons.push(
      'Brazilian taxes are not computed automatically: enter the tax manually or use certified fiscal software.',
    );
    res.warnings.push(
      'This is a commercial document, not a legal Brazilian fiscal note (NF-e/NFS-e).',
    );
    if (ctx.overrideRatePercent !== undefined || ctx.product.ratePercent !== undefined) {
      const raw = String(ctx.overrideRatePercent ?? ctx.product.ratePercent);
      res.taxes.push({
        code: 'TAX_MANUAL',
        name: `${ctx.product.taxName ?? 'Tax'} ${raw}%`,
        rate: raw,
        category: 'standard',
      });
      res.reasons.push(`Manual rate ${raw}% used as given.`);
    }
    return res;
  },
);
