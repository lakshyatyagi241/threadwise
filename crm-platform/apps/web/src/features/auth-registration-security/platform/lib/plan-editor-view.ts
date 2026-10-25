import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  isLimitCapped,
  type PlanAddonOption,
  type PlanAdminItem,
  type PlanLimitKey,
} from '@crm/contracts';
import { isUnofficialOnlyLimit, type UnofficialSwitchState } from '@/lib/unofficial-whatsapp';
import type { PlanField, PlanProblems } from './plan-draft';

/**
 * What the plan editor's tabs need, away from React: which tab a problem lives on, the unit shown
 * beside each limit, the search filter, and the add-on rows (options plus stale selected ids).
 */

export const PLAN_TABS = [
  'details',
  'features',
  'limits',
  'addons',
  'integrations',
  'miniApps',
] as const;
export type PlanTab = (typeof PLAN_TABS)[number];

/** The two tabs that list Marketplace apps, by the app's kind. */
export type AppTab = 'integrations' | 'miniApps';

/** The tab an app of this kind is listed on (`app.kind` is `integration` or `mini_app`; anything else reads as a mini app). */
export const appTabFor = (kind: string): AppTab =>
  kind === 'integration' ? 'integrations' : 'miniApps';

/** App pack id -> the tab that lists it, for routing an error on `addonOffers.<id>` to the tab that holds the id. */
export type AppTabs = ReadonlyMap<string, AppTab>;

export function appTabsOf(options: readonly PlanAddonOption[]): AppTabs {
  return new Map(options.map((o) => [o.id, appTabFor(o.app.kind)]));
}

/**
 * The tab a field's input lives on. An offer error names its add-on by id: an app goes to the tab that lists it (`appTabs`), a plain
 * add-on, an id nobody lists and the tab-wide offer error go to the Add-ons tab.
 */
export function tabForField(field: PlanField, appTabs?: AppTabs): PlanTab {
  if (field.startsWith('addonOffers.'))
    return appTabs?.get(field.slice('addonOffers.'.length)) ?? 'addons';
  if (field === 'visibleAddons' || field === 'addonOffers') return 'addons';
  if (field.startsWith('limits.')) return 'limits';
  return 'details';
}

/** The tabs that hold at least one problem, in tab order (client problems and server 422s alike). */
export function tabsWithProblems(problems: PlanProblems, appTabs?: AppTabs): PlanTab[] {
  const found = new Set<PlanTab>();
  for (const field of Object.keys(problems) as PlanField[]) found.add(tabForField(field, appTabs));
  return PLAN_TABS.filter((t) => found.has(t));
}

/** The first field in tab order, then in the order the problems were found: where focus goes after a failed save. */
export function firstProblemField(problems: PlanProblems, appTabs?: AppTabs): PlanField | null {
  const fields = Object.keys(problems) as PlanField[];
  for (const tab of PLAN_TABS) {
    const hit = fields.find((f) => tabForField(f, appTabs) === tab);
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
  sms_monthly: 'perMonth',
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
  email_mailboxes: 'total',
  email_monthly: 'perMonth',
  storage_gb: 'total',
  teams: 'total',
  webbot_messages: 'perMonth',
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

/** The app packs of one tab: Integrations lists `integration` apps, Mini apps everything else (a kind this build does not know reads as a mini app). */
export function appOptionsFor(options: readonly PlanAddonOption[], tab: AppTab): PlanAddonOption[] {
  return options.filter((o) => appTabFor(o.app.kind) === tab);
}

/** Options matching the search (add-on, app and pack names). */
export function filterAppOptions(
  options: readonly PlanAddonOption[],
  query: string,
): PlanAddonOption[] {
  return options.filter((o) => matchesQuery(query, o.name, o.app.name, o.packSlug, o.app.slug));
}

/** Selected ids that no option lists (a deleted pack): shown on the Add-ons tab so the operator can remove them. */
export function staleAppIds(
  options: readonly PlanAddonOption[],
  selected: readonly string[],
): string[] {
  const known = new Set(options.map((o) => o.id));
  return [...new Set(selected)].filter((id) => !known.has(id));
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
    limitsSet: PLAN_LIMIT_KEYS.filter((k) => isLimitCapped(k, plan.limits[k])).length,
    limitsTotal: PLAN_LIMIT_KEYS.length,
    addons: plan.visibleAddons.length,
  };
}

/**
 * Whether a plan limit row is greyed with the "only applies when unofficial WhatsApp is enabled" hint. Only the limits that exist for
 * personal numbers (`devices`) and only while the switch is known to be off: an unknown state (the call failed, an older API) greys
 * nothing, so an operator is never told something the platform did not say.
 */
export function limitDisabledByPlatform(key: string, state: UnofficialSwitchState): boolean {
  return state === 'off' && isUnofficialOnlyLimit(key);
}
