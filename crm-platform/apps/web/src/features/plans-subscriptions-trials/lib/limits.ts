import {
  PLAN_FEATURE_DEFS,
  PLAN_FEATURE_GROUPS,
  PLAN_LIMIT_DEFS,
  PLAN_LIMIT_GROUPS,
  type BillingPlan,
  type PlanFeatureGroup,
  type PlanLimitGroup,
  type UsageMeter,
} from '@crm/contracts';

/** The one cap where 0 does not mean unlimited: it means "use the platform default" (TW-PLAN-022). */
export const PLATFORM_DEFAULT_KEY = 'api_rate_limit_per_minute';

export const groupOfLimit = (key: string): PlanLimitGroup | null =>
  PLAN_LIMIT_DEFS.find((d) => d.key === key)?.group ?? null;

// --- usage meters ----------------------------------------------------------------------------------------------------

/** normal below 80%, warning from 80%, danger at the cap (100%). */
export type LimitTone = 'normal' | 'warning' | 'danger';

/** Tone of a bar from the real counts (not the rounded percent, so 99.6% is not shown as full). null for an uncapped limit. */
export function limitTone(used: number, limit: number): LimitTone {
  if (limit <= 0) return 'normal';
  if (used >= limit) return 'danger';
  if (used * 100 >= limit * 80) return 'warning';
  return 'normal';
}

/** 0..100 for the bar's width; null when uncapped. */
export function limitPercent(used: number, limit: number): number | null {
  if (limit <= 0) return null;
  return Math.min(100, Math.max(0, Math.floor((used * 100) / limit)));
}

export interface LimitRow {
  key: string;
  group: PlanLimitGroup;
  /** The counter, or null when the usage payload carries none for this key ("No usage tracked"). */
  used: number | null;
  limit: number;
  /** No cap: shown as "Unlimited" (and hidden until "Show all limits"). */
  unlimited: boolean;
  /** `api_rate_limit_per_minute` with no cap set: the platform's own rate applies. */
  platformDefault: boolean;
  tracked: boolean;
  window: 'month' | 'total' | null;
  percent: number | null;
  tone: LimitTone;
}

export interface LimitGroupView {
  group: PlanLimitGroup;
  /** Rows to draw now (unlimited ones only when `showAll`). */
  rows: LimitRow[];
  /** Every limit of the group, drawn or not. */
  total: number;
  /** Capped limits of the group. */
  capped: number;
  /** Unlimited limits left out of `rows` until "Show all limits". */
  hiddenUnlimited: number;
  /** A group with any capped limit starts open, the others collapsed. */
  defaultOpen: boolean;
}

export function limitRow(
  key: string,
  group: PlanLimitGroup,
  meter: UsageMeter | undefined,
): LimitRow {
  if (!meter) {
    // No counter for this key: the limit is unknown to the panel, so it is not claimed to be unlimited.
    return {
      key,
      group,
      used: null,
      limit: 0,
      unlimited: false,
      platformDefault: false,
      tracked: false,
      window: null,
      percent: null,
      tone: 'normal',
    };
  }
  const uncapped = meter.limit <= 0;
  const platformDefault = uncapped && key === PLATFORM_DEFAULT_KEY;
  return {
    key,
    group,
    used: meter.used,
    limit: meter.limit,
    unlimited: uncapped && !platformDefault,
    platformDefault,
    tracked: true,
    window: meter.window,
    percent: limitPercent(meter.used, meter.limit),
    tone: limitTone(meter.used, meter.limit),
  };
}

/**
 * The usage panel's data: every registry limit in its group (registry order), with unlimited ones left out unless `showAll`. A group with
 * nothing to draw is dropped. Keys the payload does not know are kept as untracked rows; meters for keys the registry does not know are ignored.
 */
export function groupLimits(
  meters: readonly UsageMeter[],
  options: { showAll?: boolean } = {},
): LimitGroupView[] {
  const byKey = new Map(meters.map((m) => [m.key, m]));
  const out: LimitGroupView[] = [];
  for (const group of PLAN_LIMIT_GROUPS) {
    const all = PLAN_LIMIT_DEFS.filter((d) => d.group === group).map((d) =>
      limitRow(d.key, group, byKey.get(d.key)),
    );
    const rows = options.showAll ? all : all.filter((r) => !r.unlimited);
    if (rows.length === 0) continue;
    const capped = all.filter((r) => r.tracked && !r.unlimited && !r.platformDefault).length;
    out.push({
      group,
      rows,
      total: all.length,
      capped,
      hiddenUnlimited: all.length - rows.length,
      defaultOpen: capped > 0,
    });
  }
  return out;
}

/** How many unlimited limits "Show all limits" would reveal. */
export function countUnlimited(meters: readonly UsageMeter[]): number {
  return groupLimits(meters, { showAll: true })
    .flatMap((g) => g.rows)
    .filter((r) => r.unlimited).length;
}

// --- plan cards -----------------------------------------------------------------------------------------------------------

/** What a card leads with, in this order, before the capabilities (the volume a buyer compares first). */
export const CARD_HIGHLIGHT_LIMITS = [
  'monthly_messages',
  'devices',
  'users',
  'contacts',
  'broadcasts',
] as const;

export type CardRow = { kind: 'limit'; key: string; value: number } | { kind: 'flag'; key: string };

/** Every limit the plan sets, in registry order. */
export function planLimitRows(plan: Pick<BillingPlan, 'limits'>): CardRow[] {
  const limits = plan.limits as Record<string, number | undefined>;
  return PLAN_LIMIT_DEFS.filter((d) => limits[d.key] !== undefined).map((d): CardRow => ({
    kind: 'limit',
    key: d.key,
    value: limits[d.key] as number,
  }));
}

/** Every capability the plan enables, in registry order. */
export function planFlagRows(plan: Pick<BillingPlan, 'features'>): CardRow[] {
  const features = plan.features as Record<string, boolean | undefined>;
  return PLAN_FEATURE_DEFS.filter((d) => features[d.key]).map((d): CardRow => ({
    kind: 'flag',
    key: d.key,
  }));
}

/**
 * The short list on a card: the headline volumes first, then enabled capabilities, up to `max`. `all` is the full list for the
 * "Show all" expander (limits in registry order, then every enabled capability).
 */
export function cardRows(
  plan: Pick<BillingPlan, 'limits' | 'features'>,
  max = 7,
): { highlights: CardRow[]; all: CardRow[] } {
  const limits = planLimitRows(plan);
  const flags = planFlagRows(plan);
  const lead = CARD_HIGHLIGHT_LIMITS.flatMap((k) => limits.filter((r) => r.key === k));
  const highlights = [...lead, ...flags].slice(0, max);
  return { highlights, all: [...limits, ...flags] };
}

// --- compare table --------------------------------------------------------------------------------------------------------

export type CompareRowDef =
  | { kind: 'limit'; key: string }
  | { kind: 'flag'; key: string }
  | { kind: 'addon'; key: string; name: string };

export interface CompareSection {
  id: string;
  /** Which message names the section header. */
  title:
    | { type: 'limitGroup'; group: PlanLimitGroup }
    | { type: 'featureGroup'; group: PlanFeatureGroup }
    | { type: 'addons' };
  rows: CompareRowDef[];
}

/** A cell as a comparable string: limits as the number or `unlimited`/`default`, flags and add-ons as `1`/`0`. */
export function cellValue(plan: BillingPlan, row: CompareRowDef): string {
  if (row.kind === 'limit') {
    const v = (plan.limits as Record<string, number | undefined>)[row.key] ?? 0;
    if (v > 0) return String(v);
    return row.key === PLATFORM_DEFAULT_KEY ? 'default' : 'unlimited';
  }
  if (row.kind === 'flag')
    return (plan.features as Record<string, boolean | undefined>)[row.key] ? '1' : '0';
  return plan.visibleAddons.some((a) => a.app.id === row.key) ? '1' : '0';
}

export const rowDiffers = (plans: readonly BillingPlan[], row: CompareRowDef): boolean =>
  new Set(plans.map((p) => cellValue(p, row))).size > 1;

/**
 * The comparison table's sections: limits by group, capabilities by group, then one row per Marketplace add-on any plan makes visible.
 * A limit shows when at least one plan sets it, a capability when at least one plan enables it. `onlyDiffering` drops rows every plan
 * shares (and the sections that empties).
 */
export function compareSections(
  plans: readonly BillingPlan[],
  options: { onlyDiffering?: boolean } = {},
): CompareSection[] {
  const sections: CompareSection[] = [];
  const keep = (row: CompareRowDef) => !options.onlyDiffering || rowDiffers(plans, row);

  for (const group of PLAN_LIMIT_GROUPS) {
    const rows = PLAN_LIMIT_DEFS.filter(
      (d) =>
        d.group === group &&
        plans.some((p) => (p.limits as Record<string, number | undefined>)[d.key] !== undefined),
    )
      .map((d): CompareRowDef => ({ kind: 'limit', key: d.key }))
      .filter(keep);
    if (rows.length)
      sections.push({ id: `limits-${group}`, title: { type: 'limitGroup', group }, rows });
  }
  for (const group of PLAN_FEATURE_GROUPS) {
    const rows = PLAN_FEATURE_DEFS.filter(
      (d) =>
        d.group === group &&
        plans.some((p) => (p.features as Record<string, boolean | undefined>)[d.key]),
    )
      .map((d): CompareRowDef => ({ kind: 'flag', key: d.key }))
      .filter(keep);
    if (rows.length)
      sections.push({ id: `features-${group}`, title: { type: 'featureGroup', group }, rows });
  }
  const seen = new Map<string, string>();
  for (const p of plans)
    for (const a of p.visibleAddons) if (!seen.has(a.app.id)) seen.set(a.app.id, a.app.name);
  const addonRows = [...seen]
    .map(([key, name]): CompareRowDef => ({ kind: 'addon', key, name }))
    .filter(keep);
  if (addonRows.length) sections.push({ id: 'addons', title: { type: 'addons' }, rows: addonRows });
  return sections;
}

/** A plan's limits under their group headings (registry order), for the public pricing card's "all limits" list. */
export function groupedPlanLimits(
  plan: Pick<BillingPlan, 'limits'>,
): Array<{ group: PlanLimitGroup; rows: Array<Extract<CardRow, { kind: 'limit' }>> }> {
  const rows = planLimitRows(plan) as Array<Extract<CardRow, { kind: 'limit' }>>;
  return PLAN_LIMIT_GROUPS.map((group) => ({
    group,
    rows: rows.filter((r) => groupOfLimit(r.key) === group),
  })).filter((g) => g.rows.length > 0);
}
