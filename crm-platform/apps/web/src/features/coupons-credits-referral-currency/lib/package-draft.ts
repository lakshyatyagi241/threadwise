import {
  createCreditPackageRequestSchema,
  type CreateCreditPackagePayload,
  type CreditPackageItem,
} from '@crm/contracts';

/** The credit-package form's state: every input is text so a half-typed value never turns into NaN. */
export interface PackageDraft {
  name: string;
  slug: string;
  price: string;
  currencyCode: string;
  credits: string;
  badge: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
  isFeatured: boolean;
}

/** Reference defaulted the currency to INR when the catalogue offers it. */
export const newPackageDraft = (preferred: string): PackageDraft => ({
  name: '',
  slug: '',
  price: '',
  currencyCode: preferred,
  credits: '',
  badge: '',
  description: '',
  sortOrder: '0',
  isActive: true,
  isFeatured: false,
});

export const packageToDraft = (p: CreditPackageItem): PackageDraft => ({
  name: p.name,
  slug: p.slug,
  price: p.price,
  currencyCode: p.currencyCode,
  credits: String(p.credits),
  badge: p.badge ?? '',
  description: p.description ?? '',
  sortOrder: String(p.sortOrder),
  isActive: p.isActive,
  isFeatured: p.isFeatured,
});

export type PackageField =
  'name' | 'slug' | 'price' | 'currencyCode' | 'credits' | 'badge' | 'description' | 'sortOrder';

const FIELDS: readonly PackageField[] = [
  'name',
  'slug',
  'price',
  'currencyCode',
  'credits',
  'badge',
  'description',
  'sortOrder',
];

export type PackageBuildResult =
  { ok: true; body: CreateCreditPackagePayload } | { ok: false; problems: PackageField[] };

const wholeOrNaN = (v: string): number => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN);

/** Validates with the same schema the API uses; returns the request body or the fields to flag, in form order. */
export function buildPackageRequest(d: PackageDraft): PackageBuildResult {
  const parsed = createCreditPackageRequestSchema.safeParse({
    name: d.name,
    slug: d.slug,
    price: d.price,
    currencyCode: d.currencyCode,
    credits: wholeOrNaN(d.credits),
    badge: d.badge,
    description: d.description,
    sortOrder: d.sortOrder.trim() === '' ? 0 : wholeOrNaN(d.sortOrder),
    isActive: d.isActive,
    isFeatured: d.isFeatured,
  });
  if (parsed.success) return { ok: true, body: parsed.data };
  const bad = new Set<PackageField>();
  for (const issue of parsed.error.issues) {
    const root = String(issue.path[0]) as PackageField;
    if (FIELDS.includes(root)) bad.add(root);
  }
  return { ok: false, problems: FIELDS.filter((f) => bad.has(f)) };
}
