import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  type PlanAddonOption,
  type PlanAdminItem,
  type PlanLimitKey,
} from '@crm/contracts';
import type { PlanField, PlanProblems } from './plan-draft';

/**
 * What the plan editor's tabs need, away from React: which tab a problem lives on, the unit shown
 * beside each limit, the search filter, and the add-on rows (options plus stale selected ids).
 */

export const PLAN_TABS = ['details', 'features', 'limits', 'addons'] as const;
export type PlanTab = (typeof PLAN_TABS)[number];

/** The tab a field's input lives on. */
export function tabForField(field: PlanField): PlanTab {
  if (field === 'visibleAddons') return 'addons';
  if (field.startsWith('limits.')) return 'limits';
  return 'details';
}

/** The tabs that hold at least one problem, in tab order (client problems and server 422s alike). */
export function tabsWithProblems(problems: PlanProblems): PlanTab[] {
  const found = new Set<PlanTab>();
  for (const field of Object.keys(problems) as PlanField[]) found.add(tabForField(field));
  return PLAN_TABS.filter((t) => found.has(t));
}

/** The first field in tab order, then in the order the problems were found: where focus goes after a failed save. */
export function firstProblemField(problems: PlanProblems): PlanField | null {
  const fields = Object.keys(problems) as PlanField[];
  for (const tab of PLAN_TABS) {
    const hit = fields.find((f) => tabForField(f) === tab);
    if (hit) return hit;
  }
  return null;
}

export type LimitUnit = 'perMonth' | 'perBroadcast' | 'perMinute' | 'perPlanPeriod' | 'total';

/**
 * The unit shown next to each limit's input (message key `limitUnits.<unit>`). A Record over every
 * key, so a new catalogue limit does not compile until it has a unit.
 */
export const LIMIT_UNITS: Record<PlanLimitKey, LimitUnit> = {
  monthly_messages: 'perMonth',
  broadcasts: 'total',
  scheduled_messages: 'total',
  total_campaigns: 'perPlanPeriod',
  devices: 'total',
  users: 'total',
  contacts: 'total',
  tags: 'total',
  pipelines: 'total',
  appointments: 'perMonth',
  saved_replies: 'total',
  routing_rules: 'total',
  templates: 'total',
  flows: 'total',
  autoreplies: 'total',
  api_rate_limit_per_minute: 'perMinute',
  installed_apps: 'total',
  lead_sources: 'total',
  broadcast_recipients: 'perBroadcast',
  segments: 'total',
  custom_fields: 'total',
  team_chat_channels: 'total',
  sla_policies: 'total',
  booking_types: 'total',
  chatbot_widgets: 'total',
  catalog_products: 'total',
  invoices_monthly: 'perMonth',
  recurring_invoices: 'total',
  api_keys: 'total',
  webhooks: 'total',
  ai_token_limit_monthly: 'perMonth',
  forms: 'total',
  form_submissions_monthly: 'perMonth',
  ai_form_generations_monthly: 'perMonth',
};

/** The api rate limit is the one cap where 0 does not mean unlimited: its checkbox says "Platform default". */
export const isPlatformDefaultLimit = (key: PlanLimitKey): boolean =>
  key === 'api_rate_limit_per_minute';

/** Case-insensitive "every word appears in one of the texts" search; a blank query matches all. */
export function matchesQuery(query: string, ...texts: ReadonlyArray<string | undefined>): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = texts.join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The keys whose label or hint match the query, keeping their order. */
export function filterKeys<K extends string>(
  keys: readonly K[],
  query: string,
  label: (k: K) => string,
  hint: (k: K) => string,
): K[] {
  return keys.filter((k) => matchesQuery(query, label(k), hint(k)));
}

export type AddonSaleState = 'onSale' | 'packInactive' | 'appUnpublished';

/** Whether a workspace could actually buy the add-on: the pack must be active and its app published. */
export function addonSaleState(option: PlanAddonOption): AddonSaleState {
  if (!option.isActive) return 'packInactive';
  if (option.app.status !== 'published') return 'appUnpublished';
  return 'onSale';
}

/** A row of the Add-ons tab: a known option, or a selected id the options no longer list. */
export type AddonRow =
  { kind: 'option'; id: string; option: PlanAddonOption } | { kind: 'unknown'; id: string };

/**
 * Every option, then every selected id that is not among them (a deleted pack), so the admin can
 * untick it. Unknown rows are listed first: they are the ones that make a save fail.
 */
export function addonRows(
  options: readonly PlanAddonOption[],
  selected: readonly string[],
): AddonRow[] {
  const known = new Set(options.map((o) => o.id));
  const unknown = [...new Set(selected)].filter((id) => !known.has(id));
  return [
    ...unknown.map((id): AddonRow => ({ kind: 'unknown', id })),
    ...options.map((option): AddonRow => ({ kind: 'option', id: option.id, option })),
  ];
}

/** Rows matching the search (an unknown row always shows: it has no name to search and is the one that blocks a save). */
export function filterAddonRows(rows: readonly AddonRow[], query: string): AddonRow[] {
  return rows.filter((r) =>
    r.kind === 'unknown'
      ? true
      : matchesQuery(query, r.option.name, r.option.app.name, r.option.packSlug, r.option.app.slug),
  );
}

/** The entitlement counts the plans table shows: features on, limits capped (0 = unlimited / default), add-ons made visible. */
export function planCounts(plan: Pick<PlanAdminItem, 'features' | 'limits' | 'visibleAddons'>): {
  featuresOn: number;
  featuresTotal: number;
  limitsSet: number;
  limitsTotal: number;
  addons: number;
} {
  return {
    featuresOn: PLAN_FEATURE_KEYS.filter((k) => plan.features[k]).length,
    featuresTotal: PLAN_FEATURE_KEYS.length,
    limitsSet: PLAN_LIMIT_KEYS.filter((k) => plan.limits[k] > 0).length,
    limitsTotal: PLAN_LIMIT_KEYS.length,
    addons: plan.visibleAddons.length,
  };
}
