import {
  storedLimit,
  type PlanState,
  type WorkspaceHubDetail,
  type WorkspaceHubHealth,
  type WorkspaceHubRow,
  type WorkspaceHubSort,
} from '@crm/contracts';
import { Fx, healthOf, monthlyOf, money2 } from '../dashboards-analytics-charts';
import { validityForState } from '../plans-subscriptions-trials';

/** The flags that hold a workspace suspended (the inbox's `syncStatus` rule). */
export const SUSPENDING_FLAGS = ['frozen', 'tos_violation', 'fraud'] as const;

/** A workspace younger than this with no outbound message is "new" rather than "idle". */
export const NEW_WORKSPACE_DAYS = 7;
const DAY_MS = 86_400_000;

/** States whose plan is being paid for: only these count toward MRR. */
const PAYING_STATES: ReadonlySet<PlanState> = new Set(['paid_active', 'paid_grace']);
export const isPayingState = (s: PlanState): boolean => PAYING_STATES.has(s);

/** What the list query returns for one workspace (snake_case, as `tx.execute` hands it back). */
export interface HubRawRow {
  id: string | number;
  uuid: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  created_at: string | Date;
  created_at_iso: string;
  state: PlanState;
  trial_ends_at: string | Date | null;
  plan_ends_at: string | Date | null;
  overrides: unknown;
  platform_owned: boolean | null;
  plan_found: boolean;
  plan_name: string | null;
  plan_limits: unknown;
  amount: string | null;
  offer_amount: string | null;
  billing_unit: string | null;
  billing_duration: number | null;
  plan_currency: string | null;
  is_free: boolean | null;
  unit: string;
  balance: string | null;
  low: boolean;
  provider_key: string | null;
  provider_label: string | null;
  owner_uuid: string | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  admin_note?: string | null;
  sort_value?: string | null;
}

/** The per-page figures the list gathers with grouped queries (never per row). */
export interface PageFacts {
  numbers: ReadonlyMap<number, number>;
  flags: ReadonlyMap<number, readonly string[]>;
  messages7d: ReadonlyMap<number, number>;
  lastActive: ReadonlyMap<number, Date>;
}

export interface ProviderContext {
  /** The registry default (active) or, with none, the platform setting. */
  fallbackKey: string;
  fallbackSource: 'default' | 'platform_setting';
  labels: ReadonlyMap<string, string>;
}

export interface HubContext {
  now: Date;
  fx: Fx;
  provider: ProviderContext;
  /** The limits and the plan flags of the free plan a lapsed paid plan falls back to; null when the catalogue has none. */
  freeLimits: unknown;
}

// --- money ---------------------------------------------------------------------------------------------------------------------

/** `numeric(20,4)` text in major units to a string of minor units (hundredths), truncating beyond two decimals. */
export function balanceToMinor(text: string | null | undefined): string {
  if (!text) return '0';
  const neg = text.startsWith('-');
  const [whole = '0', frac = ''] = (neg ? text.slice(1) : text).split('.');
  const minor = BigInt(whole || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  return (neg ? -minor : minor).toString();
}

// --- limits --------------------------------------------------------------------------------------------------------------------

type HubLimitKey = 'monthly_messages' | 'users' | 'contacts' | 'devices';

function overridesOf(raw: unknown): {
  limits: Record<string, unknown>;
  features: Record<string, unknown>;
} {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return { limits: obj(o.limits), features: obj(o.features) };
}

/**
 * The cap the workspace really has (the entitlement resolver's rule): platform-owned is never limited; a per-workspace override beats
 * the plan (an override of 0 or -1 is "unlimited"); a plan with no catalogue row limits nothing; a lapsed paid plan carries the free
 * plan's caps. 0 and -1 come back as `null`.
 */
export function effectiveLimits(
  r: Pick<HubRawRow, 'platform_owned' | 'plan_found' | 'plan_limits' | 'overrides' | 'state'>,
  freeLimits: unknown,
): WorkspaceHubRow['limits'] {
  const { limits: lo, features: fo } = overridesOf(r.overrides);
  const planLimits = r.state === 'paid_lapsed' && freeLimits ? freeLimits : r.plan_limits;
  const one = (key: HubLimitKey): number | null => {
    if (r.platform_owned) return null;
    const o = lo[key];
    if (typeof o === 'number' && Number.isInteger(o)) return o > 0 ? o : null;
    if (!r.plan_found) return null;
    const n = storedLimit(planLimits, key);
    return n > 0 ? n : null;
  };
  return {
    monthlyMessages: one('monthly_messages'),
    users: one('users'),
    contacts: one('contacts'),
    devices: one('devices'),
    overridden: Object.keys(lo).length > 0 || Object.keys(fo).length > 0,
  };
}

// --- health --------------------------------------------------------------------------------------------------------------------

/**
 * Suspended beats everything; a workspace created in the last 7 days that has sent nothing is "new"; otherwise the dashboard's own
 * label by the 7-day outbound count (`healthOf`).
 */
export function hubHealth(i: {
  status: string;
  suspendedBy: readonly string[];
  createdAt: Date;
  messages7d: number;
  now: Date;
}): WorkspaceHubHealth {
  if (i.status !== 'active' || i.suspendedBy.length > 0) return 'suspended';
  if (i.messages7d === 0 && i.now.getTime() - i.createdAt.getTime() < NEW_WORKSPACE_DAYS * DAY_MS)
    return 'new';
  return healthOf(i.messages7d);
}

// --- the row -------------------------------------------------------------------------------------------------------------------

export function toHubRow(r: HubRawRow, facts: PageFacts, ctx: HubContext): WorkspaceHubRow {
  const orgId = Number(r.id);
  const trialEndsAt = r.trial_ends_at ? new Date(r.trial_ends_at) : null;
  const planEndsAt = r.plan_ends_at ? new Date(r.plan_ends_at) : null;
  const suspendedBy = [...(facts.flags.get(orgId) ?? [])];
  const messages7d = facts.messages7d.get(orgId) ?? 0;
  const last = facts.lastActive.get(orgId) ?? null;
  const createdAt = new Date(r.created_at);
  const platformOwned = r.platform_owned ?? false;
  const mrrNumber =
    isPayingState(r.state) && !platformOwned
      ? ctx.fx.toBase(
          monthlyOf({
            amount: r.amount,
            offer_amount: r.offer_amount,
            billing_unit: r.billing_unit,
            billing_duration: r.billing_duration,
            is_free: r.is_free ?? false,
          }),
          r.plan_currency ?? ctx.fx.base,
        )
      : 0;

  const overrideKey = r.provider_key;
  const providerKey = overrideKey ?? ctx.provider.fallbackKey;

  return {
    workspaceId: r.uuid,
    name: r.name,
    slug: r.slug,
    status: r.status,
    suspendedBy,
    createdAt: createdAt.toISOString(),
    provider: {
      key: providerKey,
      name: overrideKey
        ? (r.provider_label ?? null)
        : (ctx.provider.labels.get(providerKey) ?? null),
      source: overrideKey ? 'override' : ctx.provider.fallbackSource,
    },
    numbers: facts.numbers.get(orgId) ?? 0,
    plan: {
      slug: r.plan,
      name: r.plan_name,
      known: r.plan_found,
      platformOwned,
    },
    validity: validityForState(r.state, { trialEndsAt, planEndsAt, now: ctx.now }),
    limits: effectiveLimits(r, ctx.freeLimits),
    wallet: { currency: r.unit, balanceMinor: balanceToMinor(r.balance), low: r.low },
    owner: r.owner_uuid
      ? {
          userId: r.owner_uuid,
          name: r.owner_name,
          email: r.owner_email,
          phone: r.owner_phone,
        }
      : null,
    mrr: money2(mrrNumber),
    messages7d,
    lastActiveAt: last ? last.toISOString() : null,
    health: hubHealth({
      status: r.status,
      suspendedBy,
      createdAt,
      messages7d,
      now: ctx.now,
    }),
  };
}

// --- detail --------------------------------------------------------------------------------------------------------------------

/** `days` UTC dates ending today (oldest first), the zero-fill spine of the 30-day series. */
export function daySpine(now: Date, days: number): string[] {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) =>
    new Date(today - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
}

export function fillSeries(
  spine: readonly string[],
  found: ReadonlyArray<{ day: string; sent: number; delivered: number }>,
): WorkspaceHubDetail['messages30d'] {
  const byDay = new Map(found.map((f) => [f.day, f] as const));
  return spine.map((day) => ({
    day,
    sent: byDay.get(day)?.sent ?? 0,
    delivered: byDay.get(day)?.delivered ?? 0,
  }));
}

/** Delivered share of what was sent, one decimal; null when nothing was sent. */
export function deliveredPct(series: WorkspaceHubDetail['messages30d']): number | null {
  const sent = series.reduce((a, d) => a + d.sent, 0);
  if (sent === 0) return null;
  const delivered = series.reduce((a, d) => a + d.delivered, 0);
  return Math.round((delivered / sent) * 1000) / 10;
}

/** What the caller may do, from the platform permission map (and the super-admin tier for money and plan edits). */
export function hubCan(
  held: ReadonlySet<string>,
  operatorRole: string | undefined,
): WorkspaceHubDetail['can'] {
  const superAdmin = operatorRole === 'super_admin';
  return {
    suspend: held.has('platform.workspace.suspend'),
    unsuspend: held.has('platform.workspace.unsuspend'),
    impersonate: held.has('platform.workspace.impersonate'),
    editPlan: superAdmin,
    manageProvider: held.has('platform.whatsapp_providers.manage'),
    adjustWallet: superAdmin,
  };
}

// --- cursor --------------------------------------------------------------------------------------------------------------------

export interface HubCursor {
  sort: WorkspaceHubSort;
  /** The sort value of the last row: ISO micros for the dates, the lower-cased name for `name`; null for "never active". */
  v: string | null;
  id: number;
}

export const encodeHubCursor = (c: HubCursor): string =>
  Buffer.from(JSON.stringify(c)).toString('base64url');

/** Null for a cursor that is not this list's, or was made for another sort order. */
export function decodeHubCursor(raw: string | undefined, sort: WorkspaceHubSort): HubCursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<HubCursor>;
    if (c.sort !== sort || !Number.isSafeInteger(c.id)) return null;
    if (c.v !== null && typeof c.v !== 'string') return null;
    return { sort, v: c.v ?? null, id: c.id! };
  } catch {
    return null;
  }
}
