import { getTaxProfile } from './registry';
import type {
  BuyerInfo,
  ProductInfo,
  ResolveContext,
  ResolveResult,
  SellerInfo,
  SupplyType,
  TaxProfile,
} from './types';
import { isIsoDate, todayIso } from './utils';

export interface ResolveTaxInput {
  /** A profile, or its country code ("IN", "GB", "DE", "US", "CUSTOM"). */
  sellerProfile: TaxProfile | string;
  seller?: SellerInfo;
  buyer: BuyerInfo;
  product?: ProductInfo;
  supplyType?: SupplyType;
  /** Supply date ISO (YYYY-MM-DD); default today (the only impure line in the package: pass it explicitly in tests and APIs). */
  date?: string;
  overrideRatePercent?: string | number;
  withholdingCodes?: readonly string[];
}

/**
 * "Why this tax?": decides which taxes apply to ONE invoice line and explains each decision.
 *
 *   resolveTaxForLine({ sellerProfile: 'IN', seller: { region: 'MH', taxId: '27AAPFU0939F1ZV' },
 *                       buyer: { country: 'IN', region: 'KA', type: 'business' }, product: { ratePercent: 18 },
 *                       supplyType: 'services', date: '2026-10-02' })
 *   -> { taxes: [IGST 18%], reasons: ['Seller state (Maharashtra) differs ...'], ... }
 *
 * Feed `result.taxes` straight into `LineInput.taxes` of `calculateDocument`. Nothing here is legal advice: the preset rates and
 * rules are defaults the business must verify.
 */
export function resolveTaxForLine(input: ResolveTaxInput): ResolveResult {
  const profile =
    typeof input.sellerProfile === 'string'
      ? getTaxProfile(input.sellerProfile)
      : input.sellerProfile;
  if (!profile)
    throw new RangeError(`No tax profile for "${String(input.sellerProfile)}"; use "CUSTOM".`);
  const date = input.date ?? todayIso();
  if (!isIsoDate(date)) throw new RangeError(`"${date}" is not an ISO date (YYYY-MM-DD)`);

  const ctx: ResolveContext = {
    seller: input.seller ?? {},
    buyer: { ...input.buyer, country: input.buyer.country.toUpperCase() },
    product: input.product ?? {},
    supplyType: input.supplyType ?? 'goods',
    date,
    ...(input.overrideRatePercent !== undefined
      ? { overrideRatePercent: input.overrideRatePercent }
      : {}),
    ...(input.withholdingCodes ? { withholdingCodes: input.withholdingCodes } : {}),
  };
  const res = profile.resolve(ctx);

  // Tax-id sanity warnings shared by every profile.
  const sellerSpec = profile.sellerTaxId.spec;
  if (ctx.seller.taxId && sellerSpec) {
    const v = sellerSpec.validate(ctx.seller.taxId);
    if (!v.valid)
      res.warnings.push(
        `The seller ${sellerSpec.label} looks invalid: ${v.reason ?? 'format error'}`,
      );
  }
  const buyerSpec = profile.buyerTaxId.spec;
  const buyerLocal =
    ctx.buyer.country === profile.code || (profile.code === 'GB' && ctx.buyer.country === 'GB');
  if (
    ctx.buyer.taxId &&
    buyerSpec &&
    buyerLocal &&
    !res.warnings.some((w) => /buyer .*(invalid|not valid)/i.test(w))
  ) {
    const v = buyerSpec.validate(ctx.buyer.taxId);
    if (!v.valid)
      res.warnings.push(
        `The buyer ${buyerSpec.label} looks invalid: ${v.reason ?? 'format error'}`,
      );
  }
  return res;
}
