/**
 * Pure rules for the Groups webhooks (TW-WABA-040): what one entry of `value.groups[]` does to the mirrored `waba_groups` row.
 * No database, no clock of its own; the service loads the row, calls this, and writes the result.
 */

export const GROUP_FIELDS = [
  'group_lifecycle_update',
  'group_participants_update',
  'group_settings_update',
  'group_status_update',
] as const;

export type GroupField = (typeof GROUP_FIELDS)[number];

export interface GroupFacts {
  subject: string | null;
  description: string | null;
  inviteLink: string | null;
  joinApprovalMode: string | null;
  participantCount: number;
  suspended: boolean;
  creationTimestamp: Date | null;
  meta: Record<string, unknown>;
}

export const EMPTY_GROUP: GroupFacts = {
  subject: null,
  description: null,
  inviteLink: null,
  joinApprovalMode: null,
  participantCount: 0,
  suspended: false,
  creationTimestamp: null,
  meta: {},
};

type Entry = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
const flagged = (v: unknown): { text?: unknown } | null =>
  v && typeof v === 'object' && (v as { update_successful?: unknown }).update_successful
    ? (v as { text?: unknown })
    : null;

/** `{ delete: true }` when Meta deleted the group; otherwise the row as it should now be stored. */
export function applyGroupEntry(
  field: GroupField,
  entry: Entry,
  current: GroupFacts | null,
  now: Date,
): { delete: true } | { next: GroupFacts } {
  const type = String(entry.type ?? '');
  // A deleted group is gone for everyone, this workspace included: keeping the row would leave a thread no API call can touch.
  if (type === 'group_delete') return { delete: true };

  const next: GroupFacts = {
    ...(current ?? EMPTY_GROUP),
    meta: { ...(current ?? EMPTY_GROUP).meta },
  };
  const meta = next.meta;

  switch (field) {
    case 'group_lifecycle_update': {
      next.subject = str(entry.subject) ?? next.subject;
      next.description = str(entry.description) ?? next.description;
      next.inviteLink = str(entry.invite_link) ?? next.inviteLink;
      next.joinApprovalMode = str(entry.join_approval_mode) ?? next.joinApprovalMode;
      const at = Number(entry.timestamp);
      if (at > 0 && !next.creationTimestamp) next.creationTimestamp = new Date(at * 1000);
      // A group that failed to create must not look healthy.
      meta.last_error = Array.isArray(entry.errors) ? (entry.errors[0] ?? null) : null;
      break;
    }
    case 'group_participants_update': {
      const added = count(entry.added_participants);
      const removed = count(entry.removed_participants);
      if (type === 'group_participants_add') {
        next.participantCount = Math.max(0, next.participantCount + Math.max(1, added));
      } else if (type === 'group_participants_remove') {
        next.participantCount = Math.max(0, next.participantCount - Math.max(1, removed));
      }
      const pending = { ...((meta.join_requests as Record<string, unknown> | undefined) ?? {}) };
      const requestId = str(entry.join_request_id);
      if (requestId && type === 'group_join_request_created') {
        pending[requestId] = {
          wa_id: String(entry.wa_id ?? ''),
          created_at: String(entry.timestamp ?? ''),
        };
      }
      if (requestId && type === 'group_join_request_revoked') delete pending[requestId];
      meta.join_requests = pending;
      meta.failed_participants = entry.failed_participants ?? null;
      break;
    }
    case 'group_settings_update': {
      // Per-field success flags: a subject can land while the picture fails. Only what applied is accepted.
      const subject = flagged(entry.group_subject);
      if (subject) next.subject = str(subject.text) ?? next.subject;
      const description = flagged(entry.group_description);
      if (description) next.description = str(description.text) ?? next.description;
      meta.picture_update = entry.profile_picture ?? null;
      break;
    }
    case 'group_status_update': {
      // A suspended group cannot be messaged until Meta clears it.
      next.suspended = type === 'group_suspend';
      meta.suspended_at = next.suspended ? String(entry.timestamp ?? '') : null;
      break;
    }
  }
  meta.last_event = { field, type, at: now.toISOString() };
  return { next };
}

// --- delivery of one message sent to a group (TW-WABA-039) -----------------------------------------------------------------------

const RANK: Record<string, number> = { failed: -1, sent: 1, delivered: 2, read: 3 };
export const groupStatusRank = (status: string): number => RANK[status] ?? 0;

export interface GroupDelivery {
  participants: Record<string, { status: string; billable: boolean }>;
  category: string | null;
  delivered_to: number;
  billable_count: number;
  free_count: number;
}

/**
 * One participant's status row folded into the bubble's `group_delivery`. Keyed by participant so Meta's retries of a row cannot
 * inflate a count; a participant's status only moves forward; a participant is free when Meta says the group's customer-service
 * window covers it (`free_group_customer_service`) or `billable` is false. The bubble's own status advances through `groupStatusRank`.
 */
export function applyGroupDelivery(
  previous: Partial<GroupDelivery> | undefined,
  currentStatus: string,
  st: Entry,
): { delivery: GroupDelivery; status: string } {
  const status = String(st.status ?? '');
  const participant = String(st.recipient_participant_id ?? '');
  const conversation = (st.conversation ?? {}) as { pricing?: Entry; origin?: { type?: string } };
  const pricing = conversation.pricing ?? (st.pricing as Entry | undefined) ?? {};
  const category =
    conversation.origin?.type ?? (typeof pricing.category === 'string' ? pricing.category : '');
  const free = pricing.type === 'free_group_customer_service' || pricing.billable === false;

  const seen = { ...(previous?.participants ?? {}) };
  if (participant) {
    const prev = seen[participant];
    seen[participant] = {
      status:
        groupStatusRank(status) >= groupStatusRank(prev?.status ?? '')
          ? status
          : (prev?.status ?? status),
      billable: prev?.billable ?? !free,
    };
  }
  const billable = Object.values(seen).filter((p) => p.billable).length;
  const total = Object.keys(seen).length;
  return {
    delivery: {
      participants: seen,
      category: category || previous?.category || null,
      delivered_to: total,
      billable_count: billable,
      free_count: total - billable,
    },
    status: groupStatusRank(status) > groupStatusRank(currentStatus) ? status : currentStatus,
  };
}
