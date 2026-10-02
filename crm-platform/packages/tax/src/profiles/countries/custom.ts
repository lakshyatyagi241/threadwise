import { rate } from '../common';
import type { ResolveContext, ResolveResult, TaxProfile } from '../types';
import { emptyResult, explicitRate, FY_JAN, numbering, withholdingTaxes } from '../utils';

function resolveCustom(ctx: ResolveContext): ResolveResult {
  const res = emptyResult();
  res.placeOfSupply = { country: ctx.buyer.country.toUpperCase() };
  if (ctx.seller.registered === false) {
    res.reasons.push('The seller is marked as not charging tax.');
    res.taxFree = true;
    return res;
  }
  const explicit = explicitRate(ctx);
  if (!explicit) {
    res.reasons.push('Custom profile: no automatic rate. Set a rate on the product or the line.');
    res.warnings.push('No tax rate is configured for this line.');
    return res;
  }
  const name = ctx.product.taxName ?? 'Tax';
  if (explicit.percent === '0') {
    res.taxes.push({ code: 'TAX', name: `${name} 0%`, rate: '0', category: 'zero' });
    res.taxFree = true;
  } else {
    res.taxes.push({
      code: 'TAX',
      name: `${name} ${explicit.percent}%`,
      rate: explicit.percent,
      category: 'standard',
    });
  }
  res.reasons.push(
    explicit.source === 'override'
      ? `Rate ${explicit.percent}% entered manually.`
      : `Rate ${explicit.percent}% taken from the product.`,
  );
  res.taxes.push(...withholdingTaxes(CUSTOM_PROFILE.withholding, ctx, res));
  return res;
}

/** The generic profile: nothing is assumed. The user defines every tax name and rate. */
export const CUSTOM_PROFILE: TaxProfile = {
  code: 'CUSTOM',
  name: 'Custom (define your own taxes)',
  currency: 'USD',
  locale: 'en-US',
  taxLabel: 'Tax',
  support: 'note_only',
  pricesIncludeTaxDefault: false,
  rounding: {
    level: 'per_line',
    mode: 'half_up',
    dictatedByLaw: false,
    note: 'Engine default: round each line half-up. Change it per document if your rules differ.',
  },
  rates: [rate('TAX_ZERO', 'No tax', 'custom', 'zero', '0', '2000-01-01', { isDefault: true })],
  withholding: [],
  sellerTaxId: { spec: null, requirement: 'optional' },
  buyerTaxId: { spec: null, requirement: 'optional' },
  documentTitles: { invoice: 'Invoice' },
  checklist: [
    { field: 'invoice_number', label: 'Unique invoice number', level: 'required', when: 'always' },
    { field: 'issue_date', label: 'Issue date', level: 'required', when: 'always' },
    { field: 'seller_name', label: 'Seller name and address', level: 'required', when: 'always' },
    { field: 'buyer_name', label: 'Buyer name', level: 'required', when: 'always' },
    { field: 'total_amount', label: 'Total amount', level: 'required', when: 'always' },
  ],
  fiscalYear: FY_JAN,
  numbering: numbering({ rule: 'Your own rule: keep numbers unique.', gapsAllowed: true }),
  notes: [
    'No tax is assumed. Enter a rate on each product or line. Check your local invoice rules: this profile has only a minimal checklist.',
  ],
  sources: [],
  resolve: resolveCustom,
};
