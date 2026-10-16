import {
  MARKET_COMP_MAX_MONTHS,
  MARKET_SUBSCRIPTION_SOURCES,
  MARKET_SUBSCRIPTION_STATUSES,
  marketOperatorSubscriptionListQuerySchema,
  uuidSchema,
  type CancelOperatorSubscriptionRequest,
  type CompSubscriptionRequest,
  type MarketOperatorSubscription,
  type MarketSubscriptionStatus,
  type MarketSubscriptionSummaryRow,
} from '@crm/contracts';
import type { SubscriptionListFilters } from '../api';
import { textRule, type TextRule } from './confirmations';
import type { ChipTone } from './status';

/**
 * The subscriptions page's rules, kept pure: the list filters and what goes on the wire, the badge of each state, what the renewal
 * column says, which cancellations a subscription allows, and the checks of the cancel and comp forms (the contract's lengths and ranges).
 */

// --- filters --------------------------------------------------------------------------------------------------------------------------

export const SUBSCRIPTION_STATUS_FILTERS = ['all', ...MARKET_SUBSCRIPTION_STATUSES] as const;
export type SubscriptionStatusFilter = (typeof SUBSCRIPTION_STATUS_FILTERS)[number];
export const SUBSCRIPTION_SOURCE_FILTERS = ['all', ...MARKET_SUBSCRIPTION_SOURCES] as const;
export type SubscriptionSourceFilter = (typeof SUBSCRIPTION_SOURCE_FILTERS)[number];

export const ALL_APPS = 'all';

export interface SubscriptionFilters {
  /** An app's slug, or `all`. */
  app: string;
  status: SubscriptionStatusFilter;
  source: SubscriptionSourceFilter;
  /** Part of the workspace's name. */
  search: string;
}

export const NO_SUBSCRIPTION_FILTERS: SubscriptionFilters = {
  app: ALL_APPS,
  status: 'all',
  source: 'all',
  search: '',
};

/** What goes on the wire: only the filters that are set, the search trimmed to the API's 80 characters. */
export function subscriptionQuery(f: SubscriptionFilters): SubscriptionListFilters {
  const q = f.search.trim();
  return {
    ...(f.app !== ALL_APPS ? { app: f.app } : {}),
    ...(f.status !== 'all' ? { status: f.status } : {}),
    ...(f.source !== 'all' ? { source: f.source } : {}),
    ...(q ? { q: q.slice(0, 80) } : {}),
  };
}

/** The `?app=` of the address, when it is an app's slug or uuid (anything else opens the page unfiltered). */
export function appFromSearchParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = marketOperatorSubscriptionListQuerySchema.shape.app.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export const isFiltered = (f: SubscriptionFilters): boolean =>
  f.app !== ALL_APPS || f.status !== 'all' || f.source !== 'all' || f.search.trim() !== '';

// --- badges and dates -----------------------------------------------------------------------------------------------------------------

/** Active is the one that earns money (green); canceling is on its way out (amber); ended and the free ones are plain. */
export const SUBSCRIPTION_STATUS_TONE: Record<MarketSubscriptionStatus, ChipTone> = {
  active: 'success',
  trialing: 'neutral',
  comped: 'neutral',
  canceling: 'warning',
  past_due: 'warning',
  ended: 'neutral',
};

export const subscriptionStatusTone = (s: MarketSubscriptionStatus): ChipTone =>
  SUBSCRIPTION_STATUS_TONE[s];

export type PeriodKind =
  /** Paid access runs to the date and the workspace pays again by hand: "paid until". */
  | 'paidUntil'
  /** The card renews it on the date (a provider subscription is live): "renews on". */
  | 'renewsOn'
  /** The last card renewal failed: the app keeps working until the date (the grace days). */
  | 'graceUntil'
  | 'trialEnds'
  /** Not renewing: access stops on the date. */
  | 'endsOn'
  | 'compUntil'
  /** A comp the operator has not given an end to. */
  | 'compOpen'
  | 'endedOn'
  | 'none';

export interface PeriodInfo {
  kind: PeriodKind;
  /** ISO date-time, null when there is no date to show. */
  date: string | null;
}

/** What the renewal column says about a row, by its state. The screen turns the kind into words and formats the date. */
export function periodInfo(
  s: Pick<
    MarketOperatorSubscription,
    'status' | 'currentPeriodEnd' | 'trialEndsAt' | 'lapsedAt' | 'autoRenew' | 'graceEndsAt'
  >,
): PeriodInfo {
  switch (s.status) {
    case 'ended': {
      const date = s.lapsedAt ?? s.currentPeriodEnd;
      return { kind: date ? 'endedOn' : 'none', date };
    }
    case 'canceling':
      return s.currentPeriodEnd
        ? { kind: 'endsOn', date: s.currentPeriodEnd }
        : { kind: 'none', date: null };
    case 'trialing': {
      const date = s.trialEndsAt ?? s.currentPeriodEnd;
      return { kind: date ? 'trialEnds' : 'none', date };
    }
    case 'comped':
      return s.currentPeriodEnd
        ? { kind: 'compUntil', date: s.currentPeriodEnd }
        : { kind: 'compOpen', date: null };
    case 'past_due': {
      const date = s.graceEndsAt ?? s.currentPeriodEnd;
      return date ? { kind: 'graceUntil', date } : { kind: 'none', date: null };
    }
    case 'active':
      return s.currentPeriodEnd
        ? { kind: s.autoRenew ? 'renewsOn' : 'paidUntil', date: s.currentPeriodEnd }
        : { kind: 'none', date: null };
  }
}

// --- cancelling -----------------------------------------------------------------------------------------------------------------------

export type CancelChoice = 'periodEnd' | 'now';

/**
 * The ways this subscription can be cancelled, from the same facts the API decides on (`cancelByOperator`): an ended one has nothing
 * left to cancel; one that is already not renewing can only be ended early; one with no end date has no "end of the period", so it ends
 * now. A subscription that pays and runs to a date offers both.
 */
export function cancelChoices(
  s: Pick<MarketOperatorSubscription, 'status' | 'currentPeriodEnd'>,
): CancelChoice[] {
  if (s.status === 'ended') return [];
  if (s.status === 'canceling' || s.currentPeriodEnd === null) return ['now'];
  return ['periodEnd', 'now'];
}

export const canCancel = (
  s: Pick<MarketOperatorSubscription, 'status' | 'currentPeriodEnd'>,
): boolean => cancelChoices(s).length > 0;

/** The reason for a cancellation or a comp: 5 to 300 characters after trimming (the contract's `text(300, 5)`). */
export const OPERATOR_NOTE_MIN = 5;
export const OPERATOR_NOTE_MAX = 300;

export interface CancelDraft {
  when: CancelChoice;
  reason: string;
}

export const initialCancelDraft = (
  s: Pick<MarketOperatorSubscription, 'status' | 'currentPeriodEnd'>,
): CancelDraft => ({ when: cancelChoices(s)[0] ?? 'now', reason: '' });

export interface CancelCheck {
  reason: TextRule;
  canSubmit: boolean;
}

export function cancelCheck(
  s: Pick<MarketOperatorSubscription, 'status' | 'currentPeriodEnd'>,
  d: CancelDraft,
): CancelCheck {
  const reason = textRule(d.reason, OPERATOR_NOTE_MIN, OPERATOR_NOTE_MAX);
  return { reason, canSubmit: reason.ok && cancelChoices(s).includes(d.when) };
}

export function cancelPayload(d: CancelDraft): CancelOperatorSubscriptionRequest {
  return { immediate: d.when === 'now', reason: d.reason.trim() };
}

// --- comping --------------------------------------------------------------------------------------------------------------------------

export type CompDuration = 'months' | 'open';

export interface CompDraft {
  /** The app's slug. */
  app: string;
  /** The workspace's uuid (chosen from the picker). */
  workspaceId: string;
  duration: CompDuration;
  /** Whole months as typed, 1 to 36. */
  months: string;
  note: string;
}

export const DEFAULT_COMP_MONTHS = '3';

export const initialCompDraft = (app = ''): CompDraft => ({
  app,
  workspaceId: '',
  duration: 'months',
  months: DEFAULT_COMP_MONTHS,
  note: '',
});

export const COMP_MONTHS_MAX = MARKET_COMP_MAX_MONTHS;

/** Whole months from 1 to 36, or null when the text is not that. */
export function parseMonths(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MARKET_COMP_MAX_MONTHS ? n : null;
}

export interface CompCheck {
  app: boolean;
  workspace: boolean;
  months: boolean;
  note: TextRule;
  /** The submit button is enabled only when every part holds. */
  canSubmit: boolean;
}

export function compCheck(d: CompDraft): CompCheck {
  const app = d.app.trim() !== '';
  const workspace = uuidSchema.safeParse(d.workspaceId).success;
  const months = d.duration === 'open' || parseMonths(d.months) !== null;
  const note = textRule(d.note, OPERATOR_NOTE_MIN, OPERATOR_NOTE_MAX);
  return { app, workspace, months, note, canSubmit: app && workspace && months && note.ok };
}

/** The POST body (the app goes in the address). `months: null` is "until the operator ends it". */
export function compPayload(d: CompDraft): CompSubscriptionRequest {
  return {
    workspaceId: d.workspaceId,
    months: d.duration === 'open' ? null : (parseMonths(d.months) ?? Number.NaN),
    note: d.note.trim(),
  };
}

/** The apps a workspace can be comped on: only a paid one has anything to give. The summary is the list because it needs no catalogue key. */
export function paidApps(
  rows: readonly MarketSubscriptionSummaryRow[],
): Array<{ slug: string; name: string }> {
  return rows
    .filter((r) => r.pricing.model === 'paid_monthly')
    .map((r) => ({ slug: r.slug, name: r.name }));
}

// --- the summary ----------------------------------------------------------------------------------------------------------------------

export type SummaryCounts = MarketSubscriptionSummaryRow['counts'];

/** The per-state counts over every app, for the totals row. */
export function sumCounts(rows: readonly MarketSubscriptionSummaryRow[]): SummaryCounts {
  const out: SummaryCounts = {
    active: 0,
    trialing: 0,
    comped: 0,
    canceling: 0,
    pastDue: 0,
    ended: 0,
    total: 0,
  };
  for (const r of rows) {
    out.active += r.counts.active;
    out.trialing += r.counts.trialing;
    out.comped += r.counts.comped;
    out.canceling += r.counts.canceling;
    out.pastDue += r.counts.pastDue;
    out.ended += r.counts.ended;
    out.total += r.counts.total;
  }
  return out;
}
