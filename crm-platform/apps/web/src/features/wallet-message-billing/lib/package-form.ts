import {
  creditPackageInputSchema,
  walletMinorToMajor,
  type CreditPackage,
  type CreditPackageInput,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** A package as the form holds it: text for every field, money as typed major units ("25.00"). */
export interface PackageDraft {
  name: string;
  slug: string;
  description: string;
  price: string;
  currency: string;
  walletCredit: string;
  badge: string;
  sortOrder: string;
  isActive: boolean;
  isFeatured: boolean;
}

export const PACKAGE_FIELDS = [
  'name',
  'slug',
  'description',
  'price',
  'currency',
  'walletCredit',
  'badge',
  'sortOrder',
] as const;
export type PackageField = (typeof PACKAGE_FIELDS)[number];

export const emptyPackageDraft = (currency: string): PackageDraft => ({
  name: '',
  slug: '',
  description: '',
  price: '',
  currency,
  walletCredit: '',
  badge: '',
  sortOrder: '0',
  isActive: true,
  isFeatured: false,
});

export const toPackageDraft = (p: CreditPackage): PackageDraft => ({
  name: p.name,
  slug: p.slug,
  description: p.description ?? '',
  price: walletMinorToMajor(p.priceMinor),
  currency: p.currency,
  walletCredit: walletMinorToMajor(p.walletCreditMinor),
  badge: p.badge ?? '',
  sortOrder: String(p.sortOrder),
  isActive: p.isActive,
  isFeatured: p.isFeatured,
});

export type PackageProblems = Partial<Record<PackageField, true>>;

/**
 * Checks a draft with the contract's own schema, so the form can never accept what the API would refuse. The slug is optional
 * (blank = made from the name). Returns the request body when fine, otherwise the fields to mark.
 */
export function checkPackage(
  draft: PackageDraft,
  currencies: readonly string[],
  rowVersion?: number,
): { ok: true; input: CreditPackageInput } | { ok: false; problems: PackageProblems } {
  const sort = draft.sortOrder.trim();
  const problems: PackageProblems = {};
  if (!/^\d{1,4}$/.test(sort)) problems.sortOrder = true;
  const parsed = creditPackageInputSchema.safeParse({
    ...draft,
    sortOrder: /^\d{1,4}$/.test(sort) ? Number(sort) : 0,
    ...(rowVersion !== undefined ? { rowVersion } : {}),
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((PACKAGE_FIELDS as readonly unknown[]).includes(field)) {
        problems[field as PackageField] = true;
      }
    }
  }
  if (!currencies.includes(draft.currency.trim().toUpperCase())) problems.currency = true;
  if (Object.keys(problems).length > 0 || !parsed.success) return { ok: false, problems };
  return { ok: true, input: parsed.data };
}

/** Wallet credit above the price as a percent of the price ("20" for 120 on a 100 price), or null when there is no bonus. */
export function bonusOf(priceMinor: number, walletCreditMinor: number): number | null {
  if (priceMinor <= 0 || walletCreditMinor <= priceMinor) return null;
  return Math.round(((walletCreditMinor - priceMinor) / priceMinor) * 10_000) / 100;
}

export type PackageSubmitError =
  { kind: 'stale' } | { kind: 'fields'; problems: PackageProblems } | { kind: 'other' };

/** What a failed save means for the form: a stale version (409), fields the server refused (422), or anything else. */
export function packageSubmitError(err: unknown): PackageSubmitError {
  if (err instanceof ApiError) {
    if (err.isRowVersionConflict) return { kind: 'stale' };
    if (err.fieldErrors.length > 0) {
      const problems: PackageProblems = {};
      for (const e of err.fieldErrors) {
        const field = e.path.split('.')[0];
        if ((PACKAGE_FIELDS as readonly unknown[]).includes(field)) {
          problems[field as PackageField] = true;
        }
      }
      if (Object.keys(problems).length > 0) return { kind: 'fields', problems };
    }
  }
  return { kind: 'other' };
}
