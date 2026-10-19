import {
  LEAD_REASONS,
  type LeadEventResponse,
  type LeadEventStatus,
  type LeadReason,
  type LeadSourceResponse,
} from '@crm/contracts';
import type { BadgeTone } from '@/components/ui/badge';

/**
 * How a lead and a lead source are shown: the colour of a status, what a reason means and what to do about it, and which leads can
 * be retried. Ported from the web screen (`lead-sources/lib/event-view.ts`); the rules are the same.
 */

export const EVENT_STATUS_TONE: Record<LeadEventStatus, BadgeTone> = {
  received: 'neutral',
  created: 'success',
  updated: 'success',
  duplicate: 'neutral',
  needs_review: 'warning',
  failed: 'danger',
};

/** The two statuses that wait for a person: the "needs attention" count and the retry button are about these. */
export const isAttentionStatus = (status: LeadEventStatus): boolean =>
  status === 'needs_review' || status === 'failed';

/** A retry makes sense only for a lead that waits, whose payload is still stored. The server decides the rest (a paused source). */
export const isRetryable = (e: Pick<LeadEventResponse, 'status' | 'hasPayload'>): boolean =>
  isAttentionStatus(e.status) && e.hasPayload;

const REASONS: ReadonlySet<string> = new Set(LEAD_REASONS);
export const isKnownReason = (reason: string): reason is LeadReason => REASONS.has(reason);

/** What to do about a lead, as a key under `leads.guidance`. */
export type GuidanceKey =
  | 'noContactPoint'
  | 'invalidPhone'
  | 'planLimit'
  | 'sourcePaused'
  | 'internalError'
  | 'identityConflict'
  | 'generic';

const GUIDANCE_OF_REASON: Record<LeadReason, GuidanceKey> = {
  no_contact_point: 'noContactPoint',
  invalid_phone: 'invalidPhone',
  plan_limit_reached: 'planLimit',
  source_paused: 'sourcePaused',
  internal_error: 'internalError',
  identity_conflict: 'identityConflict',
};

/**
 * The advice for one lead, or null when there is nothing to do. A lead that waits always has advice, even for a reason this build
 * does not know; a lead that went through has advice only when its reason says something worth knowing (`identity_conflict`).
 */
export function guidanceFor(status: LeadEventStatus, reason: string | null): GuidanceKey | null {
  const known = reason !== null && isKnownReason(reason) ? GUIDANCE_OF_REASON[reason] : null;
  if (isAttentionStatus(status)) return known ?? 'generic';
  return known === 'identityConflict' ? known : null;
}

/** The reason as the list shows it: a known code is translated, an unknown one is shown as the server wrote it. */
export type ReasonView = { known: true; code: LeadReason } | { known: false; raw: string };

export function reasonView(reason: string | null): ReasonView | null {
  if (reason === null || reason === '') return null;
  return isKnownReason(reason) ? { known: true, code: reason } : { known: false, raw: reason };
}

/** The filters of a source's leads: all of them, or just one of the two statuses that wait. */
export const EVENT_FILTERS = ['all', 'needs_review', 'failed'] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number];
export const statusOfFilter = (filter: EventFilter): LeadEventStatus | undefined =>
  filter === 'all' ? undefined : filter;

/** How many leads wait for a person across every source (the banner on the sources list). */
export const totalNeedingAttention = (
  sources: readonly Pick<LeadSourceResponse, 'needsAttention'>[],
) => sources.reduce((sum, s) => sum + s.needsAttention, 0);
