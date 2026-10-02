import { commonChecklist, rate } from '../common';
import type { RateRow, ResolveContext, ResolveResult, TaxProfile } from '../types';
import { ID_SPECS } from '../validators';
import { emptyResult, explicitRate, FY_JAN, numbering, rateInForce, zeroTax } from '../utils';

/**
 * United States: there is NO national sales tax. States (and counties/cities/districts) set their own. This preset carries the
 * STATE-LEVEL base rate only, as a starting point; the combined local rate is usually higher and is entered by hand
 * (`overrideRatePercent`). The engine never calls a live tax service.
 */
export const US_STATES: readonly { code: string; name: string; rate: string; note?: string }[] = [
  { code: 'AL', name: 'Alabama', rate: '4' },
  {
    code: 'AK',
    name: 'Alaska',
    rate: '0',
    note: 'No state tax; many boroughs levy local sales tax.',
  },
  { code: 'AZ', name: 'Arizona', rate: '5.6', note: 'Transaction privilege tax.' },
  { code: 'AR', name: 'Arkansas', rate: '6.5' },
  {
    code: 'CA',
    name: 'California',
    rate: '7.25',
    note: 'Base rate incl. mandatory local part; districts add more.',
  },
  { code: 'CO', name: 'Colorado', rate: '2.9', note: 'Home-rule cities collect their own tax.' },
  { code: 'CT', name: 'Connecticut', rate: '6.35' },
  {
    code: 'DE',
    name: 'Delaware',
    rate: '0',
    note: 'No sales tax (gross receipts tax on sellers).',
  },
  { code: 'DC', name: 'District of Columbia', rate: '6' },
  { code: 'FL', name: 'Florida', rate: '6', note: 'Counties add discretionary surtax.' },
  { code: 'GA', name: 'Georgia', rate: '4' },
  {
    code: 'HI',
    name: 'Hawaii',
    rate: '4',
    note: 'General excise tax, can be passed on to the buyer.',
  },
  { code: 'ID', name: 'Idaho', rate: '6' },
  { code: 'IL', name: 'Illinois', rate: '6.25' },
  { code: 'IN', name: 'Indiana', rate: '7' },
  { code: 'IA', name: 'Iowa', rate: '6' },
  { code: 'KS', name: 'Kansas', rate: '6.5' },
  { code: 'KY', name: 'Kentucky', rate: '6' },
  { code: 'LA', name: 'Louisiana', rate: '5', note: 'Raised from 4.45% on 1 Jan 2025.' },
  { code: 'ME', name: 'Maine', rate: '5.5' },
  { code: 'MD', name: 'Maryland', rate: '6' },
  { code: 'MA', name: 'Massachusetts', rate: '6.25' },
  { code: 'MI', name: 'Michigan', rate: '6' },
  { code: 'MN', name: 'Minnesota', rate: '6.875' },
  { code: 'MS', name: 'Mississippi', rate: '7' },
  { code: 'MO', name: 'Missouri', rate: '4.225' },
  { code: 'MT', name: 'Montana', rate: '0', note: 'No state sales tax.' },
  { code: 'NE', name: 'Nebraska', rate: '5.5' },
  { code: 'NV', name: 'Nevada', rate: '6.85' },
  { code: 'NH', name: 'New Hampshire', rate: '0', note: 'No sales tax.' },
  { code: 'NJ', name: 'New Jersey', rate: '6.625' },
  { code: 'NM', name: 'New Mexico', rate: '4.875', note: 'Gross receipts tax, local rates add.' },
  { code: 'NY', name: 'New York', rate: '4', note: 'Counties and NYC add 4% to 4.875%.' },
  { code: 'NC', name: 'North Carolina', rate: '4.75' },
  { code: 'ND', name: 'North Dakota', rate: '5' },
  { code: 'OH', name: 'Ohio', rate: '5.75' },
  { code: 'OK', name: 'Oklahoma', rate: '4.5' },
  { code: 'OR', name: 'Oregon', rate: '0', note: 'No sales tax.' },
  { code: 'PA', name: 'Pennsylvania', rate: '6' },
  { code: 'RI', name: 'Rhode Island', rate: '7' },
  { code: 'SC', name: 'South Carolina', rate: '6' },
  { code: 'SD', name: 'South Dakota', rate: '4.2' },
  { code: 'TN', name: 'Tennessee', rate: '7' },
  { code: 'TX', name: 'Texas', rate: '6.25', note: 'Local jurisdictions add up to 2%.' },
  { code: 'UT', name: 'Utah', rate: '6.1', note: 'Includes mandatory local portion.' },
  { code: 'VT', name: 'Vermont', rate: '6' },
  { code: 'VA', name: 'Virginia', rate: '5.3', note: 'Includes the regional 1% (4.3% + 1%).' },
  { code: 'WA', name: 'Washington', rate: '6.5' },
  { code: 'WV', name: 'West Virginia', rate: '6' },
  { code: 'WI', name: 'Wisconsin', rate: '5' },
  { code: 'WY', name: 'Wyoming', rate: '4' },
];

const FROM = '2025-01-01';
const RATES: RateRow[] = [
  rate('ST_LA', 'Louisiana state sales tax 4.45%', 'sales_tax', 'sales_tax', '4.45', '2016-04-01', {
    region: 'LA',
    effectiveTo: '2024-12-31',
  }),
  ...US_STATES.map((s) =>
    rate(
      `ST_${s.code}`,
      `${s.name} state sales tax ${s.rate}%`,
      'sales_tax',
      'sales_tax',
      s.rate,
      FROM,
      {
        region: s.code,
        ...(s.note ? { note: s.note } : {}),
      },
    ),
  ),
  rate('ST_ZERO', 'Sales tax exempt (resale / exempt customer)', 'sales_tax', 'exempt', '0', FROM),
];

const stateOf = (v: string | undefined) => {
  if (!v) return undefined;
  const s = v.trim().toUpperCase();
  return US_STATES.find((x) => x.code === s || x.name.toUpperCase() === s);
};

function resolveUs(ctx: ResolveContext): ResolveResult {
  const res = emptyResult();
  res.warnings.push(
    'Only the STATE base rate is built in. Counties, cities and districts add more: enter the combined rate as a manual override for exact amounts.',
  );
  res.warnings.push(
    'Sales tax is destination-based in most states and depends on product taxability and your nexus; this preset does not look rates up live.',
  );
  const sellerState = stateOf(ctx.seller.region);
  const buyerState = stateOf(ctx.buyer.region);
  res.placeOfSupply = { country: 'US', ...(buyerState ? { region: buyerState.code } : {}) };

  if (ctx.seller.registered === false) {
    res.reasons.push('The seller is not registered to collect sales tax: none is charged.');
    res.taxFree = true;
    return res;
  }
  if (ctx.buyer.country.toUpperCase() !== 'US') {
    res.taxes.push(zeroTax('SALES_TAX', 'Sales tax 0% (export)', 'zero'));
    res.reasons.push(
      `The buyer is in ${ctx.buyer.country.toUpperCase()}: exports are not subject to US sales tax.`,
    );
    res.taxFree = true;
    return res;
  }
  if (ctx.buyer.taxExempt) {
    res.taxes.push(zeroTax('SALES_TAX', 'Sales tax exempt', 'exempt'));
    res.reasons.push(
      'The customer is tax-exempt (resale or exemption certificate): no sales tax is charged.',
    );
    res.warnings.push(
      'Keep the exemption/resale certificate on file; it can expire and differs per state.',
    );
    res.taxFree = true;
    return res;
  }
  const cat = ctx.product.category;
  if (cat === 'exempt' || cat === 'zero') {
    res.taxes.push(zeroTax('SALES_TAX', 'Sales tax exempt product', 'exempt'));
    res.reasons.push(
      'The product is marked non-taxable (e.g. groceries, prescription drugs, or services in most states).',
    );
    res.taxFree = true;
    return res;
  }
  const explicit = explicitRate(ctx);
  if (explicit) {
    res.taxes.push({
      code: 'SALES_TAX',
      name: `Sales tax ${explicit.percent}%`,
      rate: explicit.percent,
      category: 'sales_tax',
    });
    res.reasons.push(
      explicit.source === 'override'
        ? `Combined rate ${explicit.percent}% entered manually.`
        : `Rate ${explicit.percent}% taken from the product.`,
    );
    return res;
  }
  if (ctx.supplyType !== 'goods' && cat !== 'standard') {
    res.taxes.push(zeroTax('SALES_TAX', 'Sales tax not applicable', 'out_of_scope'));
    res.reasons.push(
      `${ctx.supplyType === 'services' ? 'Services are' : 'Digital products are'} not taxed in most states: no sales tax by default. Set the product category to "standard" (taxable) if your state taxes it.`,
    );
    res.taxFree = true;
    return res;
  }
  if (!sellerState) res.warnings.push('The seller state is missing: add it in the tax settings.');
  if (!buyerState) {
    res.warnings.push(
      'The buyer state is missing: the seller state rate is used. Add the ship-to state.',
    );
  }
  const nexus = ctx.seller.registeredRegions ?? [];
  let taxState = sellerState;
  if (buyerState && sellerState && buyerState.code !== sellerState.code) {
    if (nexus.some((n) => n.toUpperCase() === buyerState.code)) {
      taxState = buyerState;
      res.reasons.push(
        `The seller has nexus in ${buyerState.name}: sales tax is charged at the destination state rate.`,
      );
    } else {
      res.taxes.push(zeroTax('SALES_TAX', 'Sales tax 0% (no nexus)', 'zero'));
      res.reasons.push(
        `The seller has no nexus in ${buyerState.name}: no sales tax is collected there.`,
      );
      res.warnings.push(
        `Economic nexus rules (commonly USD 100,000 of sales or 200 transactions into a state) can oblige you to register in ${buyerState.name}. Add it to the seller's registered regions when you do.`,
      );
      res.taxFree = true;
      return res;
    }
  } else if (buyerState) {
    taxState = buyerState;
    res.reasons.push(`The sale is within ${buyerState.name}: that state's rate applies.`);
  }
  if (!taxState) return res;
  const row = rateInForce(RATES, {
    code: `ST_${taxState.code}`,
    date: ctx.date,
    region: taxState.code,
  });
  if (!row) {
    res.warnings.push(`No state rate for ${taxState.name} on ${ctx.date}.`);
    return res;
  }
  if (row.ratePercent === '0') {
    res.taxes.push(zeroTax('SALES_TAX', `${taxState.name}: no state sales tax`, 'zero'));
    res.taxFree = true;
    res.reasons.push(`${taxState.name} has no state sales tax.`);
    return res;
  }
  res.taxes.push({
    code: 'SALES_TAX',
    name: `${taxState.name} sales tax ${row.ratePercent}%`,
    rate: row.ratePercent,
    category: 'sales_tax',
  });
  res.reasons.push(`${taxState.name} state sales tax ${row.ratePercent}% on ${ctx.date}.`);
  return res;
}

export const US_PROFILE: TaxProfile = {
  code: 'US',
  name: 'United States (sales tax)',
  currency: 'USD',
  locale: 'en-US',
  taxLabel: 'Sales tax',
  support: 'rates_only',
  pricesIncludeTaxDefault: false,
  rounding: {
    level: 'per_line',
    mode: 'half_up',
    dictatedByLaw: false,
    note: 'States differ (some round per item, some per invoice). Sales tax is always added on top of the price.',
  },
  rates: RATES,
  sellerTaxId: {
    spec: ID_SPECS.usEin,
    requirement: 'optional',
    note: 'Sales-tax permit numbers are state-specific and are not validated.',
  },
  buyerTaxId: {
    spec: null,
    requirement: 'optional',
    note: 'Keep the resale/exemption certificate for exempt customers.',
  },
  documentTitles: { invoice: 'Invoice', credit_note: 'Credit memo' },
  checklist: commonChecklist({}).filter(
    (i) => !['seller_tax_id', 'buyer_tax_id'].includes(i.field),
  ),
  fiscalYear: FY_JAN,
  numbering: numbering({
    rule: 'No statutory invoice numbering; keep numbers unique and sequential for audit.',
    gapsAllowed: true,
  }),
  regions: US_STATES.map((s) => ({ code: s.code, name: s.name })),
  notes: [
    'There is no federal sales tax. Rates here are the STATE base rate (as of the preset date); local rates are extra. Use "manual override" with the combined rate for exact amounts: the engine never looks rates up live.',
    'Nexus: you collect sales tax only in states where you have a physical or economic nexus. Add those states to your registered regions; otherwise sales into other states are charged no tax by this preset.',
    'Services are not taxed in most states and digital products vary (SaaS is taxable in some): this preset charges tax on goods and on anything you mark "taxable".',
    'Exempt customers (resellers, charities, government) are zero-rated when the customer is flagged tax-exempt; keep their certificate.',
  ],
  sources: [
    {
      name: 'Tax Foundation: state sales tax rates',
      url: 'https://taxfoundation.org/data/all/state/2025-sales-taxes/',
      asOf: '2026-09-01',
    },
    {
      name: 'Streamlined Sales Tax Governing Board',
      url: 'https://www.streamlinedsalestax.org/',
      asOf: '2026-09-01',
    },
  ],
  resolve: resolveUs,
};
