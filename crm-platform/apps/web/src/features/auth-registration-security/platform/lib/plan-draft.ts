import {
  NEW_PLAN_FEATURES_OFF,
  PACK_GRANTABLE_FEATURES,
  PLAN_ADDON_OFFER_MODES,
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  PLAN_UNLIMITED_FROM,
  addonKindOf,
  checkPlanRules,
  isUnlimitedFor,
  limitZeroIsNone,
  isMoney,
  moneyCents,
  normaliseMoney,
  type CreatePlanRequest,
  type PlanAddonOffer,
  type PlanAddonOfferMode,
  type PlanAdminItem,
  type PlanBillingUnit,
  type PlanLimitKey,
  type PlanRuleCode,
} from '@crm/contracts';

/**
 * The plan form (TW-PLAN-002/003), away from React: the editable draft (every
 * number a string, as typed), how a stored plan becomes a draft, and how a
 * draft becomes the request, with the same rules the API applies (the
 * cross-field ones come from `checkPlanRules` in @crm/contracts, so the form
 * and the server cannot drift).
 */

export const NAME_MAX = 120;
export const SUBTITLE_MAX = 191;
export const DETAIL_MAX = 5000;
export const CTA_MAX = 64;
export const DURATION = { min: 1, max: 120 } as const;
export const SORT_MAX = 100_000;
export const CAP_MAX = 2_000_000_000;
export const RETENTION_MAX = 3650;

export interface PlanDraft {
  name: string;
  subtitle: string;
  detail: string;
  amount: string;
  offerAmount: string;
  currency: string;
  billingUnit: PlanBillingUnit;
  billingDuration: string;
  isFree: boolean;
  isLifetime: boolean;
  isActive: boolean;
  isDefault: boolean;
  isHighlighted: boolean;
  isCustomQuote: boolean;
  sortOrder: string;
  ctaLabel: string;
  /** Days after a paid plan lapses before the workspace's data is wiped; 0 = never (TW-PLAN-023). */
  dataRetentionDays: string;
  /** Blank = unlimited (stored as 0). */
  limits: Record<string, string>;
  features: Record<string, boolean>;
  /** Ids (uuid) of the Marketplace add-on packs (mini apps) the plan makes visible to its workspaces. */
  visibleAddons: string[];
  /** Plain add-on id -> how the plan offers it. A pack with no entry is paid at its own price (see `offerFor`). */
  addonOffers: Record<string, AddonOfferDraft>;
}

export type PlanScalarField =
  | 'name'
  | 'subtitle'
  | 'detail'
  | 'amount'
  | 'offerAmount'
  | 'currency'
  | 'billingDuration'
  | 'sortOrder'
  | 'ctaLabel'
  | 'dataRetentionDays'
  | 'isFree'
  | 'isDefault';
export type PlanField =
  | PlanScalarField
  | 'visibleAddons'
  | `limits.${string}`
  /** A refused add-on offer the API could not tie to one add-on. */
  | 'addonOffers'
  /** One add-on's offer (its price input), by the add-on's id. */
  | `addonOffers.${string}`;

export type PlanProblemCode =
  | 'required'
  | 'tooLong'
  | 'money'
  | 'range'
  | 'whole'
  | 'server'
  | 'addonPriceZero'
  | 'addonGone'
  | PlanRuleCode;
export interface PlanProblem {
  code: PlanProblemCode;
  max?: number;
  min?: number;
  /** The API's own sentence, for a server-side failure the form has no wording for. */
  message?: string;
  /** For a refused add-on selection: the ids the API did not know. */
  ids?: string[];
}
export type PlanProblems = Partial<Record<PlanField, PlanProblem>>;

/**
 * Reference's defaults for a new package: active, every feature ticked, limits blank, sort 0, 1 month. One deliberate difference: the
 * features sold as the Smart routing add-on (NEW_PLAN_FEATURES_OFF) start unticked, so a new plan is a minimal entry plan. Existing plans
 * are not touched: they are read from what they store.
 */
export function newPlanDraft(currency = 'USD'): PlanDraft {
  return {
    name: '',
    subtitle: '',
    detail: '',
    amount: '',
    offerAmount: '',
    currency,
    billingUnit: 'months',
    billingDuration: '1',
    isFree: false,
    isLifetime: false,
    isActive: true,
    isDefault: false,
    isHighlighted: false,
    isCustomQuote: false,
    sortOrder: '0',
    ctaLabel: 'Get started',
    dataRetentionDays: '0',
    limits: Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, ''])) as PlanDraft['limits'],
    features: Object.fromEntries(
      PLAN_FEATURE_KEYS.map((k) => [k, !NEW_PLAN_FEATURES_OFF.includes(k)]),
    ) as PlanDraft['features'],
    visibleAddons: [],
    addonOffers: {},
  };
}

/** A stored plan as an editable draft: a stored 0 limit shows blank ("unlimited"). */
export function planToDraft(p: PlanAdminItem): PlanDraft {
  return {
    name: p.name,
    subtitle: p.subtitle ?? '',
    detail: p.detail ?? '',
    amount: p.kind === 'paid' ? p.amount : p.isFree ? '0' : '',
    offerAmount: p.offerAmount ?? '',
    currency: p.currency,
    billingUnit: p.billingUnit,
    billingDuration: String(p.billingDuration),
    isFree: p.isFree,
    isLifetime: p.isLifetime,
    isActive: p.isActive,
    isDefault: p.isDefault,
    isHighlighted: p.isHighlighted,
    isCustomQuote: p.isCustomQuote,
    sortOrder: String(p.sortOrder),
    ctaLabel: p.ctaLabel,
    dataRetentionDays: String(p.dataRetentionDays),
    // Registry keys first, then the caps an installed module contributed (TW-ADD-013).
    limits: Object.fromEntries([
      ...PLAN_LIMIT_KEYS.map((k) => [
        k,
        // `teams`: 0 is a real cap (solo) and a huge value is the unlimited stand-in, shown blank.
        limitZeroIsNone(k)
          ? isUnlimitedFor(k, p.limits[k])
            ? ''
            : String(p.limits[k])
          : p.limits[k] > 0
            ? String(p.limits[k])
            : '',
      ]),
      ...Object.entries(p.moduleLimits).map(([k, v]) => [k, (v ?? 0) > 0 ? String(v) : '']),
    ]),
    features: { ...p.moduleFeatures, ...p.features },
    visibleAddons: [...p.visibleAddons],
    addonOffers: offersToDraft(p.addonOffers ?? []),
  };
}

type Toggle =
  'isFree' | 'isCustomQuote' | 'isLifetime' | 'isActive' | 'isDefault' | 'isHighlighted';

/**
 * A flag switched on or off, with what it implies: a free plan costs nothing
 * and carries no offer; a custom quote shows no price and is not free; the
 * signup default must be active.
 */
export function withToggle(draft: PlanDraft, key: Toggle, on: boolean): PlanDraft {
  const next = { ...draft, [key]: on };
  if (key === 'isFree' && on)
    return { ...next, amount: '0', offerAmount: '', isCustomQuote: false };
  if (key === 'isCustomQuote' && on)
    return { ...next, amount: '0', offerAmount: '', isFree: false };
  if (key === 'isDefault' && on) return { ...next, isActive: true };
  if (key === 'isActive' && !on) return { ...next, isDefault: false };
  // Turning free/custom off leaves a price to type: do not keep the placeholder 0.
  if ((key === 'isFree' || key === 'isCustomQuote') && !on && draft.amount === '0') {
    return { ...next, amount: '' };
  }
  return next;
}

const isRegistryLimit = (k: string) => (PLAN_LIMIT_KEYS as readonly string[]).includes(k);
const isRegistryFeature = (k: string) => (PLAN_FEATURE_KEYS as readonly string[]).includes(k);

const wholeNumber = (raw: string): number | null =>
  /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null;

/**
 * The request for the API, or the problems to show. Optional text that is blank
 * is sent as null; a blank limit is 0 (unlimited); an offer of 0 is "no offer".
 */
export function buildPlanRequest(
  draft: PlanDraft,
  /**
   * `includeAddons` (default true): send `visibleAddons`. The API replaces the stored list with what it
   * receives and keeps it when the field is absent, so the editor passes false only when the add-on
   * options never loaded AND the admin did not touch the Add-ons tab: it never saw the real list, so
   * the stored selection must not be overwritten (a stale or unloaded view must not wipe it).
   */
  {
    includeAddons = true,
    addonPacks,
    appIds,
  }: {
    includeAddons?: boolean;
    /**
     * The plain add-ons the Add-ons tab lists (when they loaded). The request then carries an offer for EVERY one of them (no stored row
     * = paid at the add-on's price), and the features those add-ons grant follow the offers, exactly as the API will write them.
     * Without it only the draft's own offers (the stored ones) are sent back.
     */
    addonPacks?: readonly PackGrants[];
    /**
     * The ids of the Marketplace apps the Integrations and Mini apps tabs list (when they loaded). The request then carries one offer for
     * EVERY one of them (amount null: an app keeps its own price) with its effective mode, and `visibleAddons` is derived from those
     * modes, so the two cannot disagree. Without it the draft's own offer rows are sent back as they are.
     */
    appIds?: readonly string[];
  } = {},
):
  { body: CreatePlanRequest; problems?: undefined } | { body?: undefined; problems: PlanProblems } {
  const problems: PlanProblems = {};

  const name = draft.name.trim();
  if (!name) problems.name = { code: 'required' };
  else if (name.length > NAME_MAX) problems.name = { code: 'tooLong', max: NAME_MAX };

  const subtitle = draft.subtitle.trim();
  if (subtitle.length > SUBTITLE_MAX) problems.subtitle = { code: 'tooLong', max: SUBTITLE_MAX };
  const detail = draft.detail.trim();
  if (detail.length > DETAIL_MAX) problems.detail = { code: 'tooLong', max: DETAIL_MAX };

  const cta = draft.ctaLabel.trim();
  if (!cta) problems.ctaLabel = { code: 'required' };
  else if (cta.length > CTA_MAX) problems.ctaLabel = { code: 'tooLong', max: CTA_MAX };

  const priced = !draft.isFree && !draft.isCustomQuote;
  let amount = '0.00';
  let offerAmount: string | null = null;
  if (priced) {
    const raw = draft.amount.trim();
    if (!raw) problems.amount = { code: 'required' };
    else if (!isMoney(raw)) problems.amount = { code: 'money' };
    else amount = normaliseMoney(raw);

    const offer = draft.offerAmount.trim();
    if (offer) {
      if (!isMoney(offer)) problems.offerAmount = { code: 'money' };
      else if (moneyCents(offer) > 0) offerAmount = normaliseMoney(offer);
    }
  }

  const duration = wholeNumber(draft.billingDuration);
  if (duration === null || duration < DURATION.min || duration > DURATION.max) {
    problems.billingDuration = { code: 'range', ...DURATION };
  }
  const sort = wholeNumber(draft.sortOrder);
  if (sort === null || sort > SORT_MAX)
    problems.sortOrder = { code: 'range', min: 0, max: SORT_MAX };

  const retention = wholeNumber(
    draft.dataRetentionDays.trim() === '' ? '0' : draft.dataRetentionDays,
  );
  if (retention === null || retention > RETENTION_MAX)
    problems.dataRetentionDays = { code: 'range', min: 0, max: RETENTION_MAX };

  const limits: Record<string, number> = {};
  const moduleLimits: Record<string, number> = {};
  for (const key of Object.keys(draft.limits)) {
    const raw = (draft.limits[key] ?? '').trim();
    // Registry caps and the caps installed modules add travel apart (TW-ADD-013).
    const target = isRegistryLimit(key) ? limits : moduleLimits;
    if (!raw) {
      target[key] = limitZeroIsNone(key) ? PLAN_UNLIMITED_FROM : 0;
      continue;
    }
    const n = wholeNumber(raw);
    if (n === null) problems[`limits.${key}` as PlanField] = { code: 'whole' };
    else if (n > CAP_MAX)
      problems[`limits.${key}` as PlanField] = { code: 'range', min: 0, max: CAP_MAX };
    else target[key] = n;
  }

  // Only the offers the plan holds (stored rows, and the ones the operator set in this edit). An add-on with no row is left alone, so a plan
  // that carries only part of its features keeps them on a save that never touched that add-on.
  const listedApps = new Set(appIds ?? []);
  const offerIds = Object.keys(draft.addonOffers).filter((id) => !listedApps.has(id));
  const addonOffers: PlanAddonOffer[] = [];
  for (const addonId of offerIds) {
    const o = offerFor(draft, addonId);
    const raw = o.mode === 'paid' ? o.amount.trim() : '';
    let amount: string | null = null;
    if (raw) {
      if (!isMoney(raw)) problems[`addonOffers.${addonId}`] = { code: 'money' };
      else if (moneyCents(raw) === 0)
        problems[`addonOffers.${addonId}`] = { code: 'addonPriceZero' };
      else amount = normaliseMoney(raw);
    }
    addonOffers.push({ addonId, mode: o.mode, amount });
  }
  for (const addonId of listedApps) {
    addonOffers.push({ addonId, mode: appModeFor(draft, addonId), amount: null });
  }
  // Visible = Paid or Included. A listed app follows its mode; an id no option lists (stale) is left as the draft holds it.
  const visibleAddons = [
    ...new Set([
      ...draft.visibleAddons.filter(
        (id) => !listedApps.has(id) || appModeFor(draft, id) !== 'hidden',
      ),
      ...[...listedApps].filter((id) => appModeFor(draft, id) !== 'hidden'),
    ]),
  ];
  const features = addonPacks
    ? { ...draft.features, ...offerFeatures(draft, decidedPacks(draft, addonPacks)) }
    : draft.features;

  // The cross-field rules, shared with the API. A field already known to be malformed keeps its own
  // message, and an offer is not compared against a price that could not be read.
  const skip = new Set<string>(Object.keys(problems));
  if (problems.amount) skip.add('offerAmount');
  for (const issue of checkPlanRules({
    amount,
    offerAmount,
    isFree: draft.isFree,
    isCustomQuote: draft.isCustomQuote,
    isDefault: draft.isDefault,
    isActive: draft.isActive,
  })) {
    if (!skip.has(issue.path)) problems[issue.path] = { code: issue.code };
  }

  if (Object.keys(problems).length > 0) return { problems };
  return {
    body: {
      name,
      subtitle: subtitle || null,
      detail: detail || null,
      amount,
      offerAmount,
      currency: draft.currency,
      billingUnit: draft.billingUnit,
      billingDuration: duration!,
      isFree: draft.isFree,
      isLifetime: draft.isLifetime,
      isActive: draft.isActive,
      isDefault: draft.isDefault,
      isHighlighted: draft.isHighlighted,
      isCustomQuote: draft.isCustomQuote,
      sortOrder: sort!,
      ctaLabel: cta,
      dataRetentionDays: retention!,
      limits,
      features: Object.fromEntries(Object.entries(features).filter(([k]) => isRegistryFeature(k))),
      moduleLimits,
      moduleFeatures: Object.fromEntries(
        Object.entries(features).filter(([k]) => !isRegistryFeature(k)),
      ),
      ...(includeAddons ? { visibleAddons } : {}),
      addonOffers,
    },
  };
}

/**
 * The form field an API validation path belongs to, or null when it has none. `addonOfferIds` is the order the request listed its
 * `addonOffers` in, so `addonOffers.<i>.<field>` lands on that add-on's row (else on the tab as a whole).
 */
export function planFieldForPath(
  path: string,
  addonOfferIds: readonly string[] = [],
): PlanField | null {
  const scalar: PlanScalarField[] = [
    'name',
    'subtitle',
    'detail',
    'amount',
    'offerAmount',
    'currency',
    'billingDuration',
    'sortOrder',
    'ctaLabel',
    'dataRetentionDays',
    'isFree',
    'isDefault',
  ];
  if ((scalar as string[]).includes(path)) return path as PlanScalarField;
  if (path === 'visibleAddons') return 'visibleAddons';
  const offer = /^addonOffers(?:\.(\d+))?(?:\.|$)/.exec(path);
  if (offer) {
    const id = offer[1] === undefined ? undefined : addonOfferIds[Number(offer[1])];
    return id ? `addonOffers.${id}` : 'addonOffers';
  }
  const m = /^limits\.(\w+)$/.exec(path);
  if (m && (PLAN_LIMIT_KEYS as string[]).includes(m[1]!)) return path as PlanField;
  return null;
}

const UNKNOWN_ADDON = /^unknown_addon:(.+)$/;

/** The add-on id an API message `unknown_addon:<id>` names, or null for any other message. */
export function unknownAddonId(message: string): string | null {
  return UNKNOWN_ADDON.exec(message)?.[1]?.trim() || null;
}

/**
 * The API's 422 `errors[]` as form problems, first message per field. Every `unknown_addon:<id>` error
 * is folded into ONE `visibleAddons` problem carrying all the ids (the form words it, with the count).
 */
export function problemsFromServer(
  errors: ReadonlyArray<{ path: string; message: string }>,
  { addonOfferIds = [] }: { addonOfferIds?: readonly string[] } = {},
): PlanProblems {
  const out: PlanProblems = {};
  const unknown: string[] = [];
  for (const e of errors) {
    const field = planFieldForPath(e.path, addonOfferIds);
    if (!field) continue;
    const id = field === 'visibleAddons' ? unknownAddonId(e.message) : null;
    if (id) {
      unknown.push(id);
      continue;
    }
    // An add-on offer naming an add-on that no longer exists: the row says so in words, not with the raw code.
    const gone = field.startsWith('addonOffers') ? unknownAddonId(e.message) : null;
    if (gone) {
      if (!(field in out)) out[field] = { code: 'addonGone' };
      continue;
    }
    if (!(field in out)) out[field] = { code: 'server', message: e.message };
  }
  if (unknown.length > 0) out.visibleAddons = { code: 'server', ids: [...new Set(unknown)] };
  return out;
}

/** A limit input left blank or at 0 means unlimited (0 is what is stored; for the API rate it means "platform default"). */
export function limitIsUnlimited(raw: string, key?: string): boolean {
  const v = raw.trim();
  // `teams`: a typed 0 means solo (no teams), only a blank box is unlimited.
  if (key !== undefined && limitZeroIsNone(key)) return v === '';
  return v === '' || /^0+$/.test(v);
}

/** What a limit shows right after "Unlimited" is unticked: a small real cap to edit (blank would mean unlimited again). */
const LIMITED_START: Partial<Record<PlanLimitKey, string>> = {
  api_rate_limit_per_minute: '60',
  teams: '5',
};

export function setLimitUnlimited(
  draft: PlanDraft,
  key: PlanLimitKey,
  unlimited: boolean,
): PlanDraft {
  return {
    ...draft,
    limits: { ...draft.limits, [key]: unlimited ? '' : (LIMITED_START[key] ?? '1') },
  };
}

/** How many of the given limits (default: all) carry a cap. */
export function countLimitsSet(
  limits: PlanDraft['limits'],
  keys: readonly string[] = PLAN_LIMIT_KEYS,
): number {
  return keys.filter((k) => !limitIsUnlimited(limits[k] ?? '', k)).length;
}

/** How many of the given features (default: all) are on. */
export function countFeaturesOn(
  features: PlanDraft['features'],
  keys: readonly string[] = PLAN_FEATURE_KEYS,
): number {
  return keys.filter((k) => features[k]).length;
}

/** Switch the given features (a group's visible rows) on or off, leaving the rest. */
export function toggleFeatures(
  features: PlanDraft['features'],
  keys: readonly string[],
  on: boolean,
): PlanDraft['features'] {
  const next = { ...features };
  for (const k of keys) next[k] = on;
  return next;
}

// --- plain add-on offers (Add-ons tab, docs/specs/addons-plan-offers.md) ------------------------------------------------------------
//
// Every plain add-on is Included, Paid (optionally at the plan's own price) or Hidden on a plan. The mode is the source of truth: the API
// writes the add-on's feature keys on the plan from it (true when included, false otherwise), and the editor mirrors that in the draft's
// `features` as the mode changes, so the Features tab (where those keys are locked) shows what the save will store.

/** The part of an add-on pack (`AddonPack` from the API) these helpers read. */
export interface PackGrants {
  id: string;
  /**
   * The kind the operator chose for the pack (stored). Smart routing is a feature add-on even while no feature is ticked on it yet, so the
   * kind is read from here and never worked out from the grants. A caller with no stored kind (older data) falls back to the grants.
   */
  kind?: 'feature' | 'capacity';
  grants: { features: readonly string[]; limits: Readonly<Record<string, number>> };
}

/** One add-on's offer as the form holds it. `amount` is the typed price ('' = the add-on's own price); it is only sent when paid. */
export interface AddonOfferDraft {
  mode: PlanAddonOfferMode;
  amount: string;
}

/** What a pack with no stored row means: paid at the add-on's own price. */
export const DEFAULT_OFFER: AddonOfferDraft = { mode: 'paid', amount: '' };

/** The stored offers of a plan as the draft's map (a pack with no row is absent and reads as `DEFAULT_OFFER`). */
export function offersToDraft(offers: PlanAdminItem['addonOffers']): PlanDraft['addonOffers'] {
  return Object.fromEntries(
    offers.map((o) => [
      o.addonId,
      { mode: o.mode, amount: o.mode === 'paid' && o.amount !== null ? o.amount : '' },
    ]),
  );
}

/** How the plan offers one pack: its draft row, or paid at the add-on's price. */
export function offerFor(draft: Pick<PlanDraft, 'addonOffers'>, packId: string): AddonOfferDraft {
  return draft.addonOffers[packId] ?? DEFAULT_OFFER;
}

/** Feature or capacity: the kind the operator stored on the pack (the grants only decide for data that carries none). */
export function packKind(pack: Pick<PackGrants, 'kind' | 'grants'>): 'feature' | 'capacity' {
  return pack.kind ?? addonKindOf(pack.grants);
}

/** The modes a pack can take: a capacity add-on is never included, the plan sets its own cap on the Limits tab. */
export function offerModesFor(
  pack: Pick<PackGrants, 'kind' | 'grants'>,
): readonly PlanAddonOfferMode[] {
  return packKind(pack) === 'feature' ? PLAN_ADDON_OFFER_MODES : ['paid', 'hidden'];
}

/**
 * Whether a pack can be Included right now: a feature add-on that unlocks no feature yet has nothing to include (the operator adds the
 * features under Add-ons first), and a capacity add-on is never included.
 */
export function canIncludePack(pack: Pick<PackGrants, 'kind' | 'grants'>): boolean {
  return packKind(pack) === 'feature' && pack.grants.features.length > 0;
}

/**
 * The plan's value for each feature key the packs grant: on when ANY pack granting it is included (a key two packs share stays on while
 * one of them is included). Keys no pack grants are absent.
 */
export function offerFeatures(
  draft: Pick<PlanDraft, 'addonOffers'>,
  packs: readonly PackGrants[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const p of packs) {
    const on = offerFor(draft, p.id).mode === 'included';
    for (const k of p.grants.features) out[k] = (out[k] ?? false) || on;
  }
  return out;
}

/**
 * Set how the plan offers one pack, and bring the draft's `features` in line for the keys the packs grant (included -> true, otherwise
 * false), so the Features tab reflects it at once. Switching away from Paid forgets the typed price. Included on a capacity add-on is
 * refused (the draft is returned unchanged). Limits, the Marketplace selection and features no pack grants are never touched.
 */
export function setAddonOffer(
  draft: PlanDraft,
  pack: PackGrants,
  mode: PlanAddonOfferMode,
  packs: readonly PackGrants[],
): PlanDraft {
  if (!offerModesFor(pack).includes(mode)) return draft;
  // Nothing to include yet: keep a pack that is already included as it is, refuse a new inclusion.
  if (mode === 'included' && !canIncludePack(pack) && offerFor(draft, pack.id).mode !== 'included')
    return draft;
  const was = offerFor(draft, pack.id);
  const addonOffers = {
    ...draft.addonOffers,
    [pack.id]: { mode, amount: mode === 'paid' ? was.amount : '' },
  };
  const all = packs.some((p) => p.id === pack.id) ? packs : [...packs, pack];
  return {
    ...draft,
    addonOffers,
    features: {
      ...draft.features,
      ...offerFeatures({ addonOffers }, decidedPacks({ addonOffers }, all)),
    },
  };
}

/** The packs the plan holds an offer for (stored or set in this edit): only their features follow the offers. */
export function decidedPacks<P extends Pick<PackGrants, 'id'>>(
  draft: Pick<PlanDraft, 'addonOffers'>,
  packs: readonly P[],
): P[] {
  return packs.filter((p) => p.id in draft.addonOffers);
}

/** The plan's own price for a paid pack, as typed ('' = the add-on's price). */
export function setAddonOfferAmount(draft: PlanDraft, packId: string, amount: string): PlanDraft {
  const was = offerFor(draft, packId);
  if (was.mode !== 'paid') return draft;
  return { ...draft, addonOffers: { ...draft.addonOffers, [packId]: { mode: 'paid', amount } } };
}

/**
 * The feature keys a plain pack grants, each with the pack names that grant it: the Features tab shows them read-only ("Set by the
 * Smart routing add-on on the Add-ons tab") and its Enable all / Disable all skip them.
 */
export function packLockedFeatures(
  packs: ReadonlyArray<PackGrants & { name: string }>,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of packs)
    for (const k of new Set(p.grants.features)) out.set(k, [...(out.get(k) ?? []), p.name]);
  return out;
}

/** How many feature add-ons the plan includes (a capacity add-on is never counted). */
export function includedPackCount(
  draft: Pick<PlanDraft, 'addonOffers'>,
  packs: readonly PackGrants[],
): number {
  return packs.filter((p) => packKind(p) === 'feature' && offerFor(draft, p.id).mode === 'included')
    .length;
}

/** Feature keys a pack grants that the shared entitlement resolver does not merge from a live pack (they still work on a plan). */
export function unlistedPackFeatures(pack: Pick<PackGrants, 'grants'>): string[] {
  return pack.grants.features.filter((k) => !PACK_GRANTABLE_FEATURES.includes(k));
}

/** How many plain add-ons the plan includes or offers (Included + Paid; Hidden is not counted). A pack with no stored row is paid. */
export function packsOfferedCount(
  draft: Pick<PlanDraft, 'addonOffers'>,
  packs: readonly PackGrants[],
): number {
  return packs.filter((p) => offerFor(draft, p.id).mode !== 'hidden').length;
}

// --- Marketplace apps (Integrations and Mini apps tabs) ------------------------------------------------------------------------------
//
// An app pack takes the same three modes as a plain add-on but has no price of its own here (it keeps the price on its Marketplace listing).
// Stored as: `visibleAddons` holds every app that is Paid or Included, and `addonOffers` holds a row with mode 'included' for each app
// that is Included. The draft keeps the two in step, so a mode is always read from both (see `appModeFor`) and never drifts.

/** How the plan offers one Marketplace app: its offer row if it has one, else Paid when it is visible, else Hidden. */
export function appModeFor(
  draft: Pick<PlanDraft, 'addonOffers' | 'visibleAddons'>,
  appId: string,
): PlanAddonOfferMode {
  const row = draft.addonOffers[appId];
  if (row) return row.mode;
  return draft.visibleAddons.includes(appId) ? 'paid' : 'hidden';
}

/**
 * Set how the plan offers one Marketplace app, keeping `visibleAddons` and `addonOffers` together: Paid and Included make it visible,
 * Hidden removes it, and only Included keeps an offer row. The app's own plan features are never touched here (the API switches them).
 * The same draft object comes back when nothing would change, so an untouched plan stays unchanged.
 */
export function setAppOffer(draft: PlanDraft, appId: string, mode: PlanAddonOfferMode): PlanDraft {
  const visible = draft.visibleAddons.includes(appId);
  const row = draft.addonOffers[appId];
  const wantVisible = mode !== 'hidden';
  const sameRow = mode === 'included' ? row?.mode === 'included' : row === undefined;
  if (visible === wantVisible && sameRow) return draft;

  const { [appId]: _drop, ...others } = draft.addonOffers;
  return {
    ...draft,
    visibleAddons: wantVisible
      ? visible
        ? draft.visibleAddons
        : [...draft.visibleAddons, appId]
      : draft.visibleAddons.filter((id) => id !== appId),
    addonOffers: mode === 'included' ? { ...others, [appId]: { mode, amount: '' } } : others,
  };
}

/** Set every given app to one mode (the "Set all shown to" control). */
export function setAppOffers(
  draft: PlanDraft,
  appIds: readonly string[],
  mode: PlanAddonOfferMode,
): PlanDraft {
  return appIds.reduce((d, id) => setAppOffer(d, id, mode), draft);
}

/** How many of the given apps the plan includes or offers (Included + Paid; Hidden is not counted). */
export function appsOfferedCount(
  draft: Pick<PlanDraft, 'addonOffers' | 'visibleAddons'>,
  appIds: readonly string[],
): number {
  return appIds.filter((id) => appModeFor(draft, id) !== 'hidden').length;
}

/** One stale id ticked or unticked in `visibleAddons` (an app no option lists any more, shown so it can be removed). */
export function toggleAddon(ids: readonly string[], id: string, on: boolean): string[] {
  const rest = ids.filter((x) => x !== id);
  return on ? [...rest, id] : rest;
}

/** Whether anything differs from the draft the form opened with (drives the "unsaved changes" guard). */
export function isPlanDraftDirty(initial: PlanDraft, current: PlanDraft): boolean {
  // The add-on selection is a set: ticking an add-on back on must not read as a change because it moved to the end. An offer put back to
  // the default (paid, no price of its own) is the same as no row.
  const norm = (d: PlanDraft) =>
    JSON.stringify({
      ...d,
      visibleAddons: [...d.visibleAddons].sort(),
      addonOffers: Object.entries(d.addonOffers)
        .filter(([, o]) => o.mode !== 'paid' || o.amount.trim() !== '')
        .sort(([a], [b]) => a.localeCompare(b)),
    });
  return norm(initial) !== norm(current);
}
