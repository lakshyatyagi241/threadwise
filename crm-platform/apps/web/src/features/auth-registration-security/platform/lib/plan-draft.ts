import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  checkPlanRules,
  isMoney,
  moneyCents,
  normaliseMoney,
  type CreatePlanRequest,
  type PlanAdminItem,
  type PlanBillingUnit,
  type PlanFeatureKey,
  type PlanLimitKey,
  type PlanRuleCode,
} from '@crm/contracts';

/**
 * The plan form (WD-PLAN-002/003), away from React: the editable draft (every
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
  /** Days after a paid plan lapses before the workspace's data is wiped; 0 = never (WD-PLAN-023). */
  dataRetentionDays: string;
  /** Blank = unlimited (stored as 0). */
  limits: Record<PlanLimitKey, string>;
  features: Record<PlanFeatureKey, boolean>;
  /** Ids (uuid) of the Marketplace add-on packs the plan makes visible to its workspaces. */
  visibleAddons: string[];
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
export type PlanField = PlanScalarField | 'visibleAddons' | `limits.${PlanLimitKey}`;

export type PlanProblemCode =
  'required' | 'tooLong' | 'money' | 'range' | 'whole' | 'server' | PlanRuleCode;
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

/** WaDesk's defaults for a new package: active, every feature ticked, limits blank, sort 0, 1 month. */
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
    features: Object.fromEntries(PLAN_FEATURE_KEYS.map((k) => [k, true])) as PlanDraft['features'],
    visibleAddons: [],
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
    limits: Object.fromEntries(
      PLAN_LIMIT_KEYS.map((k) => [k, p.limits[k] > 0 ? String(p.limits[k]) : '']),
    ) as PlanDraft['limits'],
    features: { ...p.features },
    visibleAddons: [...p.visibleAddons],
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
  { includeAddons = true }: { includeAddons?: boolean } = {},
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
  for (const key of PLAN_LIMIT_KEYS) {
    const raw = draft.limits[key].trim();
    if (!raw) {
      limits[key] = 0;
      continue;
    }
    const n = wholeNumber(raw);
    if (n === null) problems[`limits.${key}`] = { code: 'whole' };
    else if (n > CAP_MAX) problems[`limits.${key}`] = { code: 'range', min: 0, max: CAP_MAX };
    else limits[key] = n;
  }

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
      features: { ...draft.features },
      ...(includeAddons ? { visibleAddons: [...new Set(draft.visibleAddons)] } : {}),
    },
  };
}

/** The form field an API validation path belongs to, or null when it has none. */
export function planFieldForPath(path: string): PlanField | null {
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
): PlanProblems {
  const out: PlanProblems = {};
  const unknown: string[] = [];
  for (const e of errors) {
    const field = planFieldForPath(e.path);
    if (!field) continue;
    const id = field === 'visibleAddons' ? unknownAddonId(e.message) : null;
    if (id) {
      unknown.push(id);
      continue;
    }
    if (!(field in out)) out[field] = { code: 'server', message: e.message };
  }
  if (unknown.length > 0) out.visibleAddons = { code: 'server', ids: [...new Set(unknown)] };
  return out;
}

/** A limit input left blank or at 0 means unlimited (0 is what is stored; for the API rate it means "platform default"). */
export function limitIsUnlimited(raw: string): boolean {
  const v = raw.trim();
  return v === '' || /^0+$/.test(v);
}

/** What a limit shows right after "Unlimited" is unticked: a small real cap to edit (blank would mean unlimited again). */
const LIMITED_START: Partial<Record<PlanLimitKey, string>> = { api_rate_limit_per_minute: '60' };

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
  keys: readonly PlanLimitKey[] = PLAN_LIMIT_KEYS,
): number {
  return keys.filter((k) => !limitIsUnlimited(limits[k])).length;
}

/** How many of the given features (default: all) are on. */
export function countFeaturesOn(
  features: PlanDraft['features'],
  keys: readonly PlanFeatureKey[] = PLAN_FEATURE_KEYS,
): number {
  return keys.filter((k) => features[k]).length;
}

/** Switch the given features (a group's visible rows) on or off, leaving the rest. */
export function toggleFeatures(
  features: PlanDraft['features'],
  keys: readonly PlanFeatureKey[],
  on: boolean,
): PlanDraft['features'] {
  const next = { ...features };
  for (const k of keys) next[k] = on;
  return next;
}

/** One add-on ticked or unticked. */
export function toggleAddon(ids: readonly string[], id: string, on: boolean): string[] {
  const rest = ids.filter((x) => x !== id);
  return on ? [...rest, id] : rest;
}

/** Add every id (the visible rows) to the selection, keeping what is already selected and each id once. */
export function selectAddons(ids: readonly string[], add: readonly string[]): string[] {
  return [...new Set([...ids, ...add])];
}

/** Drop the given ids (the visible rows) from the selection. */
export function clearAddons(ids: readonly string[], remove: readonly string[]): string[] {
  const drop = new Set(remove);
  return ids.filter((x) => !drop.has(x));
}

/** Whether anything differs from the draft the form opened with (drives the "unsaved changes" guard). */
export function isPlanDraftDirty(initial: PlanDraft, current: PlanDraft): boolean {
  // The add-on selection is a set: ticking an add-on back on must not read as a change because it moved to the end.
  const norm = (d: PlanDraft) =>
    JSON.stringify({ ...d, visibleAddons: [...d.visibleAddons].sort() });
  return norm(initial) !== norm(current);
}
