import {
  createAddonRequestSchema,
  isLegacyAddonPack,
  isMoney,
  moneyCents,
  normaliseMoney,
  type AddonKind,
  type AddonPack,
  type AddonPlanOffer,
  type CreateAddonPayload,
  type PlanAddonOfferMode,
  type PlanBillingUnit,
  type SetAddonPlanOffersRequest,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The add-on editor's form state: every input is text so a half-typed value never turns into NaN. */
export interface PackDraft {
  /** `feature` unlocks part of the product (and may add capacity); `capacity` only adds to limits. Chosen by the operator, stored on the pack. */
  kind: AddonKind;
  name: string;
  subtitle: string;
  detail: string;
  amount: string;
  offerAmount: string;
  currency: string;
  billingUnit: PlanBillingUnit;
  billingDuration: string;
  billingMode: 'one_time' | 'recurring';
  isLifetime: boolean;
  /**
   * A pack sold before add-ons became subscriptions only (one-time, lifetime, or on a period that is not one month / one year). It keeps
   * selling as it is and its billing fields are read-only; a new pack, or a monthly / yearly recurring one, is edited with the period picker.
   */
  legacy: boolean;
  isActive: boolean;
  sortOrder: string;
  features: string[];
  /**
   * The features ticked before the type was switched to Capacity (which clears `features`), so switching back restores them. Never sent;
   * gone once the pack is saved.
   */
  heldFeatures: string[];
  /** limit key -> typed amount ('' = not granted, '-1' = unlimited). */
  limits: Record<string, string>;
}

export const newPackDraft = (): PackDraft => ({
  kind: 'feature',
  name: '',
  subtitle: '',
  detail: '',
  amount: '',
  offerAmount: '',
  currency: 'USD',
  billingUnit: 'months',
  billingDuration: '1',
  billingMode: 'recurring',
  isLifetime: false,
  legacy: false,
  isActive: true,
  sortOrder: '0',
  features: [],
  heldFeatures: [],
  limits: {},
});

export const packToDraft = (p: AddonPack): PackDraft => ({
  kind: p.kind,
  name: p.name,
  subtitle: p.subtitle ?? '',
  detail: p.detail ?? '',
  amount: p.amount,
  offerAmount: p.offerAmount ?? '',
  currency: p.currency,
  billingUnit: p.billingUnit,
  billingDuration: String(p.billingDuration),
  billingMode: p.billingMode,
  isLifetime: p.isLifetime,
  // Legacy only while it still sells or still has live buyers: an inactive draft nobody holds (the seeded Smart routing / Teams drafts) is free to become a subscription.
  legacy: isLegacyAddonPack(p) && (p.isActive || p.activePurchases > 0),
  isActive: p.isActive,
  sortOrder: String(p.sortOrder),
  features: [...p.grants.features],
  heldFeatures: [],
  limits: Object.fromEntries(Object.entries(p.grants.limits).map(([k, v]) => [k, String(v)])),
});

export type PackField =
  | 'name'
  | 'amount'
  | 'amountPositive'
  | 'offerAmount'
  | 'currency'
  | 'billingDuration'
  | 'billingMode'
  | 'sortOrder'
  | 'limits'
  | 'features'
  | 'limitsNeeded'
  | 'form';

export type BuildResult =
  | { ok: true; body: CreateAddonPayload }
  | { ok: false; problems: Partial<Record<PackField, true>> };

const FIELDS: readonly PackField[] = [
  'name',
  'amount',
  'amountPositive',
  'offerAmount',
  'currency',
  'billingDuration',
  'billingMode',
  'sortOrder',
  'limits',
  'features',
];

/**
 * Switching the type. Capacity has no features: they are cleared from the form (and so from the request) but remembered, so switching back
 * to Feature gives them back. Feature keeps limits as they are (they are optional there); Capacity keeps them too (they are required).
 */
export function setPackKind(d: PackDraft, kind: AddonKind): PackDraft {
  if (kind === d.kind) return d;
  if (kind === 'capacity') return { ...d, kind, features: [], heldFeatures: d.features };
  return {
    ...d,
    kind,
    features: d.features.length > 0 ? d.features : d.heldFeatures,
    heldFeatures: [],
  };
}

/** The price input is marked when the amount is not a price at all, or is zero on a subscription. */
export const amountFlagged = (p: Partial<Record<PackField, true>>): boolean =>
  !!(p.amount || p.amountPositive);

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
  // New add-ons are subscriptions (owner decision 2026-10-22): monthly or yearly, recurring, never lifetime, so a price is required.
  // A legacy pack is saved exactly as it is.
  const legacy = d.legacy;
  const unit = legacy ? d.billingUnit : d.billingUnit === 'years' ? 'years' : 'months';
  if (!legacy && /^\d+(\.\d+)?$/.test(d.amount.trim()) && moneyCents(d.amount.trim()) === 0) {
    bad.amountPositive = true;
  }
  const parsed = createAddonRequestSchema.safeParse({
    name: d.name,
    subtitle: d.subtitle,
    detail: d.detail,
    amount: d.amount,
    offerAmount: d.offerAmount,
    currency: d.currency,
    billingUnit: unit,
    billingDuration: legacy
      ? /^\d+$/.test(d.billingDuration)
        ? Number(d.billingDuration)
        : Number.NaN
      : 1,
    billingMode: legacy ? (d.isLifetime ? 'one_time' : d.billingMode) : 'recurring',
    isLifetime: legacy ? d.isLifetime : false,
    isActive: d.isActive,
    sortOrder: /^\d+$/.test(d.sortOrder) ? Number(d.sortOrder) : Number.NaN,
    kind: d.kind,
    features: d.kind === 'capacity' ? [] : d.features,
    limits,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const root = String(issue.path[0] ?? 'form') as PackField;
      // A zero price on a subscription already has its own, clearer message.
      if (root === 'billingMode' && bad.amountPositive) continue;
      // `limits` on its own is "a capacity add-on adds to at least one limit"; `limits.<key>` is a bad amount.
      if (root === 'limits' && issue.path.length === 1) {
        if (!bad.limits) bad.limitsNeeded = true;
        continue;
      }
      bad[FIELDS.includes(root) ? root : 'form'] = true;
    }
    return { ok: false, problems: bad };
  }
  if (Object.keys(bad).length) return { ok: false, problems: bad };
  return { ok: true, body: parsed.data };
}

/**
 * The `features` / `limits` problems of a refused save (the API names the path), as the same field flags the client check uses. Anything else
 * is left to the generic message. `limits` alone is "adds to at least one limit"; `limits.<key>` is a bad amount.
 */
export function packProblemsFromError(error: unknown): Partial<Record<PackField, true>> {
  const out: Partial<Record<PackField, true>> = {};
  if (!(error instanceof ApiError)) return out;
  for (const e of error.fieldErrors) {
    if (e.path === 'features' || e.path.startsWith('features.')) out.features = true;
    else if (e.path === 'limits') out.limitsNeeded = true;
    else if (e.path.startsWith('limits.')) out.limits = true;
  }
  return out;
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

// --- how each plan offers this pack (pack editor "Plans" section, list "Plans" column; docs/specs/addons-plan-offers.md) -------------

/** One plan's offer as the form holds it: `amount` is the typed plan price ('' = the add-on's own price), kept only while paid. */
export interface PlanOfferDraft {
  mode: PlanAddonOfferMode;
  amount: string;
}

/** Plan id -> offer, for every plan the API listed (a plan with no stored row reads paid at the add-on's price). */
export type PlanOffersDraft = Record<string, PlanOfferDraft>;

export const planOffersToDraft = (p: Pick<AddonPack, 'planOffers'>): PlanOffersDraft =>
  Object.fromEntries(
    p.planOffers.map((o) => [
      o.planId,
      { mode: o.mode, amount: o.mode === 'paid' && o.amount !== null ? o.amount : '' },
    ]),
  );

/** One choice of the per-plan control, and whether it can be picked. */
export interface PlanOfferOption {
  mode: PlanAddonOfferMode;
  disabled: boolean;
}

/**
 * The modes a pack can take on a plan, from its stored kind and how many features it unlocks: a capacity add-on is never included (the plan
 * sets its own cap); a feature add-on with no features has nothing to include yet, so Included shows but cannot be picked.
 */
export const planOfferModes = (
  kind: AddonKind,
  featureCount: number,
): readonly PlanOfferOption[] =>
  kind === 'capacity'
    ? [
        { mode: 'paid', disabled: false },
        { mode: 'hidden', disabled: false },
      ]
    : [
        { mode: 'included', disabled: featureCount === 0 },
        { mode: 'paid', disabled: false },
        { mode: 'hidden', disabled: false },
      ];

/** A plan's mode changed: leaving Paid forgets the typed price. */
export const setPlanOfferMode = (
  d: PlanOffersDraft,
  planId: string,
  mode: PlanAddonOfferMode,
): PlanOffersDraft => ({
  ...d,
  [planId]: { mode, amount: mode === 'paid' ? (d[planId]?.amount ?? '') : '' },
});

export const setPlanOfferAmount = (
  d: PlanOffersDraft,
  planId: string,
  amount: string,
): PlanOffersDraft => ({ ...d, [planId]: { mode: d[planId]?.mode ?? 'paid', amount } });

/** Why a typed plan price was refused: not an amount, or zero (empty means "the add-on's price", Included means free). */
export type PlanOfferProblem = 'money' | 'zero';

export type PlanOffersBuild =
  | { ok: true; body: SetAddonPlanOffersRequest }
  | { ok: false; problems: Record<string, PlanOfferProblem> };

const sameAmount = (a: string, b: string) =>
  a === b || (isMoney(a) && isMoney(b) && normaliseMoney(a) === normaliseMoney(b));

/**
 * `PUT platform/addons/:id/plans` for the rows that differ from what the pack was loaded with (a plan not named keeps its offer), or the
 * plans whose price cannot be sent. A blank price is null (the add-on's own price).
 */
export function buildPlanOffersRequest(
  pack: Pick<AddonPack, 'planOffers'>,
  d: PlanOffersDraft,
): PlanOffersBuild {
  const saved = planOffersToDraft(pack);
  const problems: Record<string, PlanOfferProblem> = {};
  const offers: SetAddonPlanOffersRequest['offers'] = [];
  for (const { planId } of pack.planOffers) {
    const now = d[planId] ?? saved[planId]!;
    const was = saved[planId]!;
    const raw = now.mode === 'paid' ? now.amount.trim() : '';
    if (raw && !isMoney(raw)) problems[planId] = 'money';
    else if (raw && moneyCents(raw) === 0) problems[planId] = 'zero';
    if (now.mode === was.mode && sameAmount(raw, was.amount)) continue;
    offers.push({
      planId,
      mode: now.mode,
      amount: raw && isMoney(raw) ? normaliseMoney(raw) : null,
    });
  }
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, body: { offers } };
}

/** How many plans differ from what was loaded (the "Save plan offers" button is off at 0). */
export const changedPlanOfferCount = (pack: Pick<AddonPack, 'planOffers'>, d: PlanOffersDraft) => {
  const saved = planOffersToDraft(pack);
  return pack.planOffers.filter(({ planId }) => {
    const now = d[planId] ?? saved[planId]!;
    const was = saved[planId]!;
    return (
      now.mode !== was.mode || !sameAmount(now.mode === 'paid' ? now.amount.trim() : '', was.amount)
    );
  }).length;
};

/** The add-ons list's "Plans" column: the plans grouped by mode, in the API's plan order (no stored row = paid at the add-on's price). */
export function planOfferSummary(
  p: Pick<AddonPack, 'planOffers'>,
): Record<PlanAddonOfferMode, AddonPlanOffer[]> {
  const out: Record<PlanAddonOfferMode, AddonPlanOffer[]> = { included: [], paid: [], hidden: [] };
  for (const o of p.planOffers) out[o.mode].push(o);
  return out;
}
