import { commonChecklist, rate } from '../common';
import type { RateRow, ResolveContext, ResolveResult, TaxProfile } from '../types';
import { euVatPrefix, euVatSpec, validateEuVatId } from '../validators';
import {
  emptyResult,
  explicitRate,
  FY_JAN,
  isBusiness,
  isRegistered,
  numbering,
  rateInForce,
  toLineTax,
  withholdingTaxes,
  zeroTax,
} from '../utils';

/**
 * EU member-state VAT. One profile per member state, generated from this table. Dates: `from` is the start of the rate in force
 * today; where a rate changed since 2024 the previous row is kept with an end date. Rates not listed as changed are given an
 * effective date of 2020-01-01 (start of this table's coverage), NOT the year they were introduced.
 */
interface Hist {
  pct: string;
  from: string;
  to?: string;
}
interface Country {
  iso: string;
  name: string;
  currency: string;
  locale: string;
  std: Hist[];
  /** The first reduced rate is the primary one (category "reduced"); the others are selectable by explicit rate. */
  red: Hist[][];
  superReduced?: string;
  /** Plain-language note. */
  note?: string;
}
const START = '2020-01-01';
const h = (pct: string, from = START, to?: string): Hist =>
  to ? { pct, from, to } : { pct, from };

const COUNTRIES: Country[] = [
  {
    iso: 'AT',
    name: 'Austria',
    currency: 'EUR',
    locale: 'de-AT',
    std: [h('20')],
    red: [[h('10')], [h('13')]],
  },
  {
    iso: 'BE',
    name: 'Belgium',
    currency: 'EUR',
    locale: 'nl-BE',
    std: [h('21')],
    red: [[h('6')], [h('12')]],
  },
  {
    iso: 'BG',
    name: 'Bulgaria',
    currency: 'EUR',
    locale: 'bg-BG',
    std: [h('20')],
    red: [[h('9')]],
    note: 'Bulgaria adopted the euro on 1 Jan 2026; use BGN only for documents dated earlier.',
  },
  {
    iso: 'HR',
    name: 'Croatia',
    currency: 'EUR',
    locale: 'hr-HR',
    std: [h('25')],
    red: [[h('13')], [h('5')]],
  },
  {
    iso: 'CY',
    name: 'Cyprus',
    currency: 'EUR',
    locale: 'el-CY',
    std: [h('19')],
    red: [[h('9')], [h('5')]],
  },
  {
    iso: 'CZ',
    name: 'Czechia',
    currency: 'CZK',
    locale: 'cs-CZ',
    std: [h('21')],
    red: [[h('12')]],
    note: 'The 10% and 15% rates were merged into 12% on 1 Jan 2024.',
  },
  {
    iso: 'DK',
    name: 'Denmark',
    currency: 'DKK',
    locale: 'da-DK',
    std: [h('25')],
    red: [],
    note: 'Denmark has no reduced rate.',
  },
  {
    iso: 'EE',
    name: 'Estonia',
    currency: 'EUR',
    locale: 'et-EE',
    std: [h('22', '2024-01-01', '2025-06-30'), h('24', '2025-07-01')],
    red: [[h('9')], [h('13', '2025-01-01')]],
  },
  {
    iso: 'FI',
    name: 'Finland',
    currency: 'EUR',
    locale: 'fi-FI',
    std: [h('24', START, '2024-08-31'), h('25.5', '2024-09-01')],
    red: [[h('14')], [h('10')]],
  },
  {
    iso: 'FR',
    name: 'France',
    currency: 'EUR',
    locale: 'fr-FR',
    std: [h('20')],
    red: [[h('10')], [h('5.5')]],
    superReduced: '2.1',
    note: 'Corsica and the overseas departments have special rates (not modelled).',
  },
  { iso: 'DE', name: 'Germany', currency: 'EUR', locale: 'de-DE', std: [h('19')], red: [[h('7')]] },
  {
    iso: 'GR',
    name: 'Greece',
    currency: 'EUR',
    locale: 'el-GR',
    std: [h('24')],
    red: [[h('13')], [h('6')]],
    note: 'Some islands have 30% lower rates (not modelled). The VAT prefix is EL.',
  },
  {
    iso: 'HU',
    name: 'Hungary',
    currency: 'HUF',
    locale: 'hu-HU',
    std: [h('27')],
    red: [[h('5')], [h('18')]],
  },
  {
    iso: 'IE',
    name: 'Ireland',
    currency: 'EUR',
    locale: 'en-IE',
    std: [h('23')],
    red: [[h('13.5')], [h('9')]],
    superReduced: '4.8',
  },
  {
    iso: 'IT',
    name: 'Italy',
    currency: 'EUR',
    locale: 'it-IT',
    std: [h('22')],
    red: [[h('10')], [h('5')]],
    superReduced: '4',
    note: 'Electronic invoicing via the SDI is mandatory for domestic B2B and B2C: this engine only computes the amounts.',
  },
  {
    iso: 'LV',
    name: 'Latvia',
    currency: 'EUR',
    locale: 'lv-LV',
    std: [h('21')],
    red: [[h('12')], [h('5')]],
  },
  {
    iso: 'LT',
    name: 'Lithuania',
    currency: 'EUR',
    locale: 'lt-LT',
    std: [h('21')],
    red: [[h('9')], [h('5')]],
  },
  {
    iso: 'LU',
    name: 'Luxembourg',
    currency: 'EUR',
    locale: 'fr-LU',
    std: [h('17')],
    red: [[h('8')]],
    superReduced: '3',
  },
  {
    iso: 'MT',
    name: 'Malta',
    currency: 'EUR',
    locale: 'en-MT',
    std: [h('18')],
    red: [[h('7')], [h('5')]],
  },
  {
    iso: 'NL',
    name: 'Netherlands',
    currency: 'EUR',
    locale: 'nl-NL',
    std: [h('21')],
    red: [[h('9')]],
  },
  {
    iso: 'PL',
    name: 'Poland',
    currency: 'PLN',
    locale: 'pl-PL',
    std: [h('23')],
    red: [[h('8')], [h('5')]],
    note: 'KSeF e-invoicing is being phased in during 2026: this engine only computes the amounts.',
  },
  {
    iso: 'PT',
    name: 'Portugal',
    currency: 'EUR',
    locale: 'pt-PT',
    std: [h('23')],
    red: [[h('13')], [h('6')]],
    note: 'Madeira and the Azores have lower rates (not modelled).',
  },
  {
    iso: 'RO',
    name: 'Romania',
    currency: 'RON',
    locale: 'ro-RO',
    std: [h('19', START, '2025-07-31'), h('21', '2025-08-01')],
    red: [[h('9', START, '2025-07-31'), h('11', '2025-08-01')]],
  },
  {
    iso: 'SK',
    name: 'Slovakia',
    currency: 'EUR',
    locale: 'sk-SK',
    std: [h('20', START, '2024-12-31'), h('23', '2025-01-01')],
    red: [[h('10', START, '2024-12-31'), h('19', '2025-01-01')], [h('5', '2025-01-01')]],
  },
  {
    iso: 'SI',
    name: 'Slovenia',
    currency: 'EUR',
    locale: 'sl-SI',
    std: [h('22')],
    red: [[h('9.5')], [h('5')]],
  },
  {
    iso: 'ES',
    name: 'Spain',
    currency: 'EUR',
    locale: 'es-ES',
    std: [h('21')],
    red: [[h('10')]],
    superReduced: '4',
    note: 'The Canary Islands, Ceuta and Melilla are outside the EU VAT area (IGIC/IPSI): not modelled.',
  },
  {
    iso: 'SE',
    name: 'Sweden',
    currency: 'SEK',
    locale: 'sv-SE',
    std: [h('25')],
    red: [[h('12')], [h('6')]],
  },
];

function ratesOf(c: Country): RateRow[] {
  const rows: RateRow[] = [];
  for (const s of c.std) {
    rows.push(
      rate('VAT_STD', `VAT ${s.pct}%`, 'vat', 'standard', s.pct, s.from, {
        ...(s.to ? { effectiveTo: s.to } : { isDefault: true }),
      }),
    );
  }
  c.red.forEach((hist, i) => {
    const code = i === 0 ? 'VAT_RED' : `VAT_RED${i + 1}`;
    for (const s of hist) {
      rows.push(
        rate(code, `VAT ${s.pct}% (reduced)`, 'vat', 'reduced', s.pct, s.from, {
          ...(s.to ? { effectiveTo: s.to } : {}),
        }),
      );
    }
  });
  if (c.superReduced)
    rows.push(
      rate(
        'VAT_SUPER',
        `VAT ${c.superReduced}% (super-reduced)`,
        'vat',
        'super_reduced',
        c.superReduced,
        START,
      ),
    );
  rows.push(rate('VAT_ZERO', 'VAT 0% (zero-rated / intra-EU / export)', 'vat', 'zero', '0', START));
  rows.push(rate('VAT_EXEMPT', 'VAT exempt', 'vat', 'exempt', '0', START));
  return rows;
}

const BY_ISO = new Map(COUNTRIES.map((c) => [c.iso, c]));
const PROFILE_RATES = new Map(COUNTRIES.map((c) => [c.iso, ratesOf(c)]));

export const EU_MEMBER_CODES: readonly string[] = COUNTRIES.map((c) => c.iso);
export const isEuMember = (iso2: string): boolean => BY_ISO.has(iso2.toUpperCase());

const CODE: Record<string, string> = {
  standard: 'VAT_STD',
  reduced: 'VAT_RED',
  super_reduced: 'VAT_SUPER',
  zero: 'VAT_ZERO',
  exempt: 'VAT_EXEMPT',
  special: 'VAT_RED2',
};

function rateFor(iso: string, category: string, date: string): RateRow | undefined {
  return rateInForce(PROFILE_RATES.get(iso) ?? [], { code: CODE[category] ?? 'VAT_STD', date });
}

/** OSS threshold for B2C intra-EU distance sales and digital services (EUR 10,000 across the EU). */
export const OSS_THRESHOLD_EUR = 10_000;

function resolveEu(seller: string) {
  return (ctx: ResolveContext): ResolveResult => {
    const res = emptyResult();
    const sellerIso = (ctx.seller.country ?? seller).toUpperCase();
    const buyerIso = ctx.buyer.country.toUpperCase();
    const category = ctx.product.category ?? 'standard';
    const business = isBusiness(ctx);

    if (!isRegistered(ctx) || ctx.seller.scheme === 'small_supplier') {
      res.reasons.push(
        'The seller is not VAT-registered (or uses the small-business exemption): no VAT is charged.',
      );
      res.documentNotes.push('VAT not charged: small business / supplier not registered for VAT');
      res.documentTypeHint = 'invoice';
      res.taxFree = true;
      res.placeOfSupply = { country: sellerIso };
      res.warnings.push(
        'Check your member state: the wording for the small-business exemption is prescribed in some countries.',
      );
      return res;
    }
    if (!ctx.seller.taxId)
      res.warnings.push(
        'Add the seller VAT identification number: it is mandatory on an EU VAT invoice.',
      );
    const explicit = explicitRate(ctx);
    const buyerId = ctx.buyer.taxId ? validateEuVatId(ctx.buyer.taxId, buyerIso) : undefined;

    const domesticRow = (iso: string, why: string) => {
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
        return;
      }
      const row = rateFor(iso, category, ctx.date);
      if (!row) {
        res.warnings.push(
          `${iso} has no "${category}" VAT rate in force on ${ctx.date}: pick a rate manually.`,
        );
        return;
      }
      if (row.category === 'zero' || row.category === 'exempt') {
        res.taxes.push(zeroTax(row.code, row.name, row.category));
        res.taxFree = true;
        res.reasons.push(`${why}: ${row.name}.`);
      } else {
        res.taxes.push(toLineTax(row, `VAT ${row.ratePercent}%`));
        res.reasons.push(`${why}: ${iso} VAT ${row.ratePercent}% (${category}) on ${ctx.date}.`);
      }
    };

    // ---- domestic ----------------------------------------------------------------------------------------------------
    if (buyerIso === sellerIso) {
      res.placeOfSupply = { country: sellerIso };
      domesticRow(sellerIso, 'Domestic supply');
      res.taxes.push(...withholdingTaxes(undefined, ctx, res));
      return res;
    }

    // ---- other EU member state --------------------------------------------------------------------------------------
    if (isEuMember(buyerIso)) {
      if (business && buyerId?.valid) {
        res.taxes.push(zeroTax('VAT', 'VAT 0% (reverse charge)', 'reverse_charge'));
        res.reverseCharge = true;
        res.taxFree = true;
        res.placeOfSupply = { country: buyerIso };
        if (ctx.supplyType === 'goods') {
          res.reasons.push(
            `Goods to a VAT-registered business in ${buyerIso}: an intra-Community supply, exempt from VAT in ${sellerIso}; the buyer accounts for acquisition VAT.`,
          );
          res.documentNotes.push(
            'VAT exempt: intra-Community supply of goods (Article 138, Directive 2006/112/EC). Reverse charge.',
          );
        } else {
          res.reasons.push(
            `Services to a VAT-registered business in ${buyerIso}: the place of supply is the customer's country, so the buyer accounts for VAT (reverse charge).`,
          );
          res.documentNotes.push(
            'Reverse charge: VAT to be accounted for by the recipient (Articles 44 and 196, Directive 2006/112/EC)',
          );
        }
        res.warnings.push(
          'Verify the buyer VAT number in VIES before invoicing and file the EC Sales List / intrastat where required.',
        );
        return res;
      }
      if (business) {
        res.warnings.push(
          ctx.buyer.taxId
            ? `The buyer VAT number is not valid (${buyerId?.reason ?? 'unknown'}): treated as a consumer, VAT charged.`
            : 'No buyer VAT number: treated as a consumer, VAT charged. Add the buyer VAT number to apply the reverse charge.',
        );
      }
      // B2C
      if (ctx.seller.scheme === 'oss') {
        res.placeOfSupply = { country: buyerIso };
        domesticRow(
          buyerIso,
          `OSS: B2C ${ctx.supplyType} to ${buyerIso} is taxed at the destination rate`,
        );
        res.documentNotes.push(
          `VAT charged at the ${buyerIso} rate under the One Stop Shop (OSS) scheme`,
        );
        return res;
      }
      res.placeOfSupply = { country: sellerIso };
      domesticRow(
        sellerIso,
        `B2C to ${buyerIso} below the EUR ${OSS_THRESHOLD_EUR.toLocaleString('en-US')} EU-wide distance-sales threshold, taxed at the seller's rate`,
      );
      res.warnings.push(
        `Above EUR ${OSS_THRESHOLD_EUR.toLocaleString('en-US')} of B2C cross-border sales in the EU per year, VAT is due at the destination rate: register for OSS and set the seller scheme to OSS.`,
      );
      return res;
    }

    // ---- outside the EU ---------------------------------------------------------------------------------------------
    res.placeOfSupply = { country: buyerIso };
    if (ctx.supplyType === 'goods' && !explicit) {
      res.taxes.push(zeroTax('VAT', 'VAT 0% (export)', 'zero'));
      res.taxFree = true;
      res.reasons.push(
        `Goods dispatched outside the EU to ${buyerIso} are an exempt export (Article 146).`,
      );
      res.documentNotes.push(
        'VAT exempt: export of goods outside the EU (Article 146, Directive 2006/112/EC)',
      );
      res.warnings.push('Keep customs export proof (EAD / exit confirmation).');
      return res;
    }
    if (business && !explicit) {
      res.taxes.push(zeroTax('VAT', 'Not subject to VAT', 'out_of_scope'));
      res.taxFree = true;
      res.reasons.push(
        `Services to a business outside the EU: the place of supply is ${buyerIso}, so the supply is not subject to EU VAT.`,
      );
      res.documentNotes.push(
        'Not subject to VAT: place of supply outside the EU (Article 44, Directive 2006/112/EC)',
      );
      return res;
    }
    res.placeOfSupply = { country: sellerIso };
    res.warnings.push(
      'Services to a consumer outside the EU are often still taxed at the seller rate (exceptions apply). VAT charged.',
    );
    domesticRow(sellerIso, 'B2C service');
    return res;
  };
}

function profileFor(c: Country): TaxProfile {
  const prefix = euVatPrefix(c.iso);
  const spec = euVatSpec(c.iso);
  return {
    code: c.iso,
    name: `${c.name} (VAT)`,
    currency: c.currency,
    locale: c.locale,
    taxLabel: 'VAT',
    support: 'full',
    pricesIncludeTaxDefault: false,
    rounding: {
      level: 'per_line',
      mode: 'half_up',
      dictatedByLaw: false,
      note: 'The VAT Directive lets you round per line or on the invoice total per rate (Article 91 / national rules). Switch to "on total" if your accounting software works that way.',
    },
    rates: PROFILE_RATES.get(c.iso)!,
    sellerTaxId: {
      spec,
      requirement: 'required_if_registered',
      note: `VAT number starting with ${prefix}.`,
    },
    buyerTaxId: {
      spec,
      requirement: 'b2b_only',
      note: 'Needed for the intra-EU reverse charge: verify it in VIES.',
    },
    documentTitles: { tax_invoice: 'Invoice', credit_note: 'Credit note' },
    checklist: commonChecklist({
      extra: [
        {
          field: 'supply_date',
          label: 'Date of supply if different from the invoice date',
          level: 'required',
          when: 'always',
        },
        {
          field: 'buyer_address',
          label: 'Customer name and address',
          level: 'required',
          when: 'always',
        },
        {
          field: 'buyer_tax_id',
          label: 'Customer VAT number (reverse charge and intra-EU supplies)',
          level: 'required',
          when: 'reverse_charge',
        },
        {
          field: 'reverse_charge_wording',
          label: 'Wording "Reverse charge" (or the national equivalent) / exemption reference',
          level: 'required',
          when: 'reverse_charge',
          mustContain: 'Reverse charge',
        },
        {
          field: 'exemption_reason',
          label:
            'Reason for exemption or reference to the Directive article (zero-rated / exempt lines)',
          level: 'required',
          when: 'exempt_or_zero',
        },
      ],
    }),
    fiscalYear: FY_JAN,
    numbering: numbering({
      pattern: '{PREFIX}-{YYYY}-{SEQ}',
      reset: 'yearly',
      rule: 'Sequential numbering, one or more series, unique (Article 226 Directive 2006/112/EC). Gaps must be explained.',
    }),
    notes: [
      `Standard rate ${c.std[c.std.length - 1]!.pct}%${c.red.length ? `, reduced ${c.red.map((r) => `${r[r.length - 1]!.pct}%`).join(' / ')}` : ''}${c.superReduced ? `, super-reduced ${c.superReduced}%` : ''}. Rates were checked against the European Commission "VAT rates applicable in the EU" table; the exact goods that qualify for reduced rates differ per country.`,
      'Intra-EU B2B: with a valid buyer VAT ID the supply is zero-rated with reverse charge (goods) or taxed in the buyer country by reverse charge (services). B2C cross-border: above the EUR 10,000 EU-wide threshold use the One Stop Shop (OSS) and charge the destination country rate.',
      ...(c.note ? [c.note] : []),
    ],
    sources: [
      {
        name: 'European Commission: VAT rates',
        url: 'https://taxation-customs.ec.europa.eu/taxation/vat/vat-rates_en',
        asOf: '2026-09-01',
      },
      {
        name: 'VIES VAT number validation',
        url: 'https://ec.europa.eu/taxation_customs/vies/',
        asOf: '2026-09-01',
      },
    ],
    resolve: resolveEu(c.iso),
  };
}

export const EU_PROFILES: readonly TaxProfile[] = COUNTRIES.map(profileFor);

/** Current-date helper kept for the OSS note. */
export const euCountryName = (iso2: string): string | undefined =>
  BY_ISO.get(iso2.toUpperCase())?.name;
