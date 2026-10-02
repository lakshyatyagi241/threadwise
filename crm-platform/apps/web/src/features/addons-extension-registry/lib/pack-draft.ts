import {
  createAddonRequestSchema,
  type AddonPack,
  type CreateAddonPayload,
  type PlanBillingUnit,
} from '@crm/contracts';

/** The add-on editor's form state: every input is text so a half-typed value never turns into NaN. */
export interface PackDraft {
  name: string;
  subtitle: string;
  detail: string;
  amount: string;
  offerAmount: string;
  currency: string;
  billingUnit: PlanBillingUnit;
  billingDuration: string;
  isLifetime: boolean;
  isActive: boolean;
  sortOrder: string;
  features: string[];
  /** limit key -> typed amount ('' = not granted, '-1' = unlimited). */
  limits: Record<string, string>;
}

export const newPackDraft = (): PackDraft => ({
  name: '',
  subtitle: '',
  detail: '',
  amount: '',
  offerAmount: '',
  currency: 'USD',
  billingUnit: 'months',
  billingDuration: '1',
  isLifetime: false,
  isActive: true,
  sortOrder: '0',
  features: [],
  limits: {},
});

export const packToDraft = (p: AddonPack): PackDraft => ({
  name: p.name,
  subtitle: p.subtitle ?? '',
  detail: p.detail ?? '',
  amount: p.amount,
  offerAmount: p.offerAmount ?? '',
  currency: p.currency,
  billingUnit: p.billingUnit,
  billingDuration: String(p.billingDuration),
  isLifetime: p.isLifetime,
  isActive: p.isActive,
  sortOrder: String(p.sortOrder),
  features: [...p.grants.features],
  limits: Object.fromEntries(Object.entries(p.grants.limits).map(([k, v]) => [k, String(v)])),
});

export type PackField =
  | 'name'
  | 'amount'
  | 'offerAmount'
  | 'currency'
  | 'billingDuration'
  | 'sortOrder'
  | 'limits'
  | 'form';

export type BuildResult =
  | { ok: true; body: CreateAddonPayload }
  | { ok: false; problems: Partial<Record<PackField, true>> };

const FIELDS: readonly PackField[] = [
  'name',
  'amount',
  'offerAmount',
  'currency',
  'billingDuration',
  'sortOrder',
  'limits',
];

/** Validates with the same schema the API uses, so the form and the server cannot disagree. */
export function buildPackRequest(d: PackDraft): BuildResult {
  const limits: Record<string, number | null> = {};
  const bad: Partial<Record<PackField, true>> = {};
  for (const [k, raw] of Object.entries(d.limits)) {
    const v = raw.trim();
    if (v === '') continue;
    if (!/^-?\d+$/.test(v)) {
      bad.limits = true;
      continue;
    }
    limits[k] = Number(v);
  }
  const parsed = createAddonRequestSchema.safeParse({
    name: d.name,
    subtitle: d.subtitle,
    detail: d.detail,
    amount: d.amount,
    offerAmount: d.offerAmount,
    currency: d.currency,
    billingUnit: d.billingUnit,
    billingDuration: /^\d+$/.test(d.billingDuration) ? Number(d.billingDuration) : Number.NaN,
    isLifetime: d.isLifetime,
    isActive: d.isActive,
    sortOrder: /^\d+$/.test(d.sortOrder) ? Number(d.sortOrder) : Number.NaN,
    features: d.features,
    limits,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const root = String(issue.path[0] ?? 'form') as PackField;
      bad[FIELDS.includes(root) ? root : 'form'] = true;
    }
    return { ok: false, problems: bad };
  }
  if (Object.keys(bad).length) return { ok: false, problems: bad };
  return { ok: true, body: parsed.data };
}

/** The one-line summary of what a pack grants, as parts the screen words (no English here). */
export function grantParts(p: Pick<AddonPack, 'grants'>) {
  return {
    features: p.grants.features,
    limits: Object.entries(p.grants.limits).map(([key, amount]) => ({ key, amount })),
  };
}

export const isDraftDirty = (a: PackDraft, b: PackDraft): boolean =>
  JSON.stringify(a) !== JSON.stringify(b);
