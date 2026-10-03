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
  limits: Record<PlanLimitKey, string>;
  features: Record<PlanFeatureKey, boolean>;
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
export type PlanField = PlanScalarField | `limits.${PlanLimitKey}`;

export type PlanProblemCode =
  'required' | 'tooLong' | 'money' | 'range' | 'whole' | 'server' | PlanRuleCode;
export interface PlanProblem {
  code: PlanProblemCode;
  max?: number;
  min?: number;
  /** The API's own sentence, for a server-side failure the form has no wording for. */
  message?: string;
}
export type PlanProblems = Partial<Record<PlanField, PlanProblem>>;

/** Reference's defaults for a new package: active, every feature ticked, limits blank, sort 0, 1 month. */
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
  const m = /^limits\.(\w+)$/.exec(path);
  if (m && (PLAN_LIMIT_KEYS as string[]).includes(m[1]!)) return path as PlanField;
  return null;
}

/** Whether anything differs from the draft the form opened with (drives the "unsaved changes" guard). */
export function isPlanDraftDirty(initial: PlanDraft, current: PlanDraft): boolean {
  return JSON.stringify(initial) !== JSON.stringify(current);
}
