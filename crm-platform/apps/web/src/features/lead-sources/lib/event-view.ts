import {
  LEAD_REASONS,
  type LeadEventResponse,
  type LeadEventStatus,
  type LeadReason,
} from '@crm/contracts';

/**
 * How a lead event is shown: the colour of its status, what its reason means in words, what to do about it, and the filters of the
 * events list. Pure, so every status and reason has a test.
 */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export const EVENT_STATUS_TONE: Record<LeadEventStatus, Tone> = {
  received: 'neutral',
  created: 'success',
  updated: 'success',
  duplicate: 'neutral',
  needs_review: 'warning',
  failed: 'danger',
};

/** The two statuses that wait for a person: the "needs attention" count and the retry button are about these. */
export const ATTENTION_STATUSES = [
  'needs_review',
  'failed',
] as const satisfies readonly LeadEventStatus[];

export const isAttentionStatus = (status: LeadEventStatus): boolean =>
  status === 'needs_review' || status === 'failed';

/** A retry makes sense only for a lead that waits, whose payload is still stored. The server decides the rest (a paused source). */
export const isRetryable = (e: Pick<LeadEventResponse, 'status' | 'hasPayload'>): boolean =>
  isAttentionStatus(e.status) && e.hasPayload;

const REASON_SET: ReadonlySet<string> = new Set(LEAD_REASONS);
export const isKnownReason = (reason: string): reason is LeadReason => REASON_SET.has(reason);

/** What to do about a lead, as a key under `lead-sources.guidance`. */
export const GUIDANCE_KEYS = [
  'noContactPoint',
  'invalidPhone',
  'planLimit',
  'sourcePaused',
  'internalError',
  'identityConflict',
  'generic',
] as const;
export type GuidanceKey = (typeof GUIDANCE_KEYS)[number];

export interface Guidance {
  key: GuidanceKey;
  /** The advice is "upgrade, then retry": show the upgrade link. */
  upgrade: boolean;
}

const GUIDANCE_OF_REASON: Record<LeadReason, GuidanceKey> = {
  no_contact_point: 'noContactPoint',
  invalid_phone: 'invalidPhone',
  plan_limit_reached: 'planLimit',
  source_paused: 'sourcePaused',
  internal_error: 'internalError',
  identity_conflict: 'identityConflict',
};

/**
 * The advice for one event, or null when there is nothing to do. A lead that waits (`needs_review`, `failed`) always has advice,
 * even for a reason this build does not know; a lead that went through has advice only when its reason says something worth
 * knowing (`identity_conflict`).
 */
export function guidanceFor(status: LeadEventStatus, reason: string | null): Guidance | null {
  const known = reason !== null && isKnownReason(reason) ? GUIDANCE_OF_REASON[reason] : null;
  if (isAttentionStatus(status)) {
    const key = known ?? 'generic';
    return { key, upgrade: key === 'planLimit' };
  }
  if (known === 'identityConflict') return { key: known, upgrade: false };
  return null;
}

/** The reason as the list shows it: a known code is translated, an unknown one is shown as the server wrote it. */
export type ReasonView = { known: true; code: LeadReason } | { known: false; raw: string };

export function reasonView(reason: string | null): ReasonView | null {
  if (reason === null || reason === '') return null;
  return isKnownReason(reason) ? { known: true, code: reason } : { known: false, raw: reason };
}

// --- filters -----------------------------------------------------------------------------------------------------------------

export const EVENT_FILTERS = [
  'all',
  'attention',
  'needs_review',
  'failed',
  'created',
  'updated',
  'duplicate',
  'received',
] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number];

export const TEST_FILTERS = ['all', 'only', 'hide'] as const;
export type TestFilter = (typeof TEST_FILTERS)[number];

export interface EventFilters {
  status: EventFilter;
  tests: TestFilter;
}

export const DEFAULT_EVENT_FILTERS: EventFilters = { status: 'all', tests: 'all' };

/** The API takes one status; "needs attention" is the two that wait, asked for separately and merged. */
export function statusesFor(filter: EventFilter): Array<LeadEventStatus | undefined> {
  if (filter === 'all') return [undefined];
  if (filter === 'attention') return [...ATTENTION_STATUSES];
  return [filter];
}

export const isTestParam = (tests: TestFilter): 'true' | 'false' | undefined =>
  tests === 'only' ? 'true' : tests === 'hide' ? 'false' : undefined;

/** The address's `?events=` value: a known status filter, `attention` for the link from the list, anything else is "all". */
export function parseEventFilter(value: string | null | undefined): EventFilter {
  return (EVENT_FILTERS as readonly string[]).includes(value ?? '')
    ? (value as EventFilter)
    : 'all';
}

/** Arriving from the "needs attention" badge shows the leads that wait and hides the test ones the badge does not count. */
export const filtersFromLink = (value: string | null | undefined): EventFilters => {
  const status = parseEventFilter(value);
  return { status, tests: status === 'attention' ? 'hide' : 'all' };
};

/** Pages of several statuses, merged newest first without a repeated event. */
export function mergeEvents(lists: readonly (readonly LeadEventResponse[])[]): LeadEventResponse[] {
  const seen = new Set<string>();
  const out: LeadEventResponse[] = [];
  for (const e of lists.flat()) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export interface AttentionGroup {
  key: GuidanceKey;
  upgrade: boolean;
  count: number;
}

/** The leads that wait, grouped by what to do about them (the banner above the list). */
export function attentionGroups(events: readonly LeadEventResponse[]): AttentionGroup[] {
  const groups = new Map<GuidanceKey, AttentionGroup>();
  for (const e of events) {
    if (e.isTest || !isAttentionStatus(e.status)) continue;
    const g = guidanceFor(e.status, e.reason);
    if (!g) continue;
    const cur = groups.get(g.key);
    if (cur) cur.count += 1;
    else groups.set(g.key, { ...g, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
