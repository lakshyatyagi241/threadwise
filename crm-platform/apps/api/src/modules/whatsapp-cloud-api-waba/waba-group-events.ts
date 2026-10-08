import type { Tx } from '@crm/db';
import type { OutboxService } from '../../kernel/outbox/outbox.service';
import type { GroupFacts, GroupField } from './waba-group-rules';

/**
 * The `whatsapp.group.*` outbox events (docs/specs/waba-groups-management.md 11), decided from the row before and after a change. Pure:
 * the same function serves the screen's own actions and Meta's webhooks, so a change never emits twice or not at all depending on how it
 * arrived.
 */

export const GROUP_EVENTS = {
  created: 'whatsapp.group.created',
  updated: 'whatsapp.group.updated',
  deleted: 'whatsapp.group.deleted',
  joinRequest: 'whatsapp.group.join_request',
  suspended: 'whatsapp.group.suspended',
} as const;
export type GroupEventType = (typeof GROUP_EVENTS)[keyof typeof GROUP_EVENTS];

export interface GroupEventDraft {
  type: GroupEventType;
  /** Merged into the payload next to the group's identifiers. Never a phone number. */
  extra: Record<string, unknown>;
}

export type GroupChangeKind = 'subject' | 'description' | 'invite_link' | 'join_mode' | 'members';

const pendingOf = (f: GroupFacts | null): Record<string, unknown> => {
  const p = f?.meta.join_requests;
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
};

/** Which visible facts of the group moved. */
export function changedKinds(before: GroupFacts | null, after: GroupFacts): GroupChangeKind[] {
  const out: GroupChangeKind[] = [];
  if ((before?.subject ?? null) !== after.subject) out.push('subject');
  if ((before?.description ?? null) !== after.description) out.push('description');
  if ((before?.inviteLink ?? null) !== after.inviteLink) out.push('invite_link');
  if ((before?.joinApprovalMode ?? null) !== after.joinApprovalMode) out.push('join_mode');
  if ((before?.participantCount ?? 0) !== after.participantCount) out.push('members');
  return out;
}

/**
 * What a change to one group row announces. `before` is null when the row did not exist, `after` null when it was deleted.
 *
 * - created: the row appeared (our create, or a lifecycle webhook for a group made elsewhere);
 * - updated: a visible fact changed (carries which: `changed`);
 * - deleted: the row went away;
 * - join_request: a request entered the queue or left it without us acting (`handled: 'revoked'`);
 * - suspended: the flag flipped, both ways.
 */
export function groupEventsFor(
  _field: GroupField | 'action',
  before: GroupFacts | null,
  after: GroupFacts | null,
): GroupEventDraft[] {
  if (!after) return before ? [{ type: GROUP_EVENTS.deleted, extra: {} }] : [];
  const events: GroupEventDraft[] = [];
  const changed = changedKinds(before, after);
  if (!before) {
    events.push({ type: GROUP_EVENTS.created, extra: { changed } });
  } else if (changed.length > 0) {
    events.push({ type: GROUP_EVENTS.updated, extra: { changed } });
  }
  if ((before?.suspended ?? false) !== after.suspended) {
    events.push({ type: GROUP_EVENTS.suspended, extra: { suspended: after.suspended } });
  }
  const was = pendingOf(before);
  const now = pendingOf(after);
  const added = Object.keys(now).filter((k) => !(k in was));
  const gone = Object.keys(was).filter((k) => !(k in now));
  if (added.length > 0) {
    events.push({
      type: GROUP_EVENTS.joinRequest,
      extra: { handled: null, count: added.length, pending: Object.keys(now).length },
    });
  }
  if (gone.length > 0) {
    events.push({
      type: GROUP_EVENTS.joinRequest,
      extra: { handled: 'revoked', count: gone.length, pending: Object.keys(now).length },
    });
  }
  return events;
}

export const GROUP_AGGREGATE = 'waba_groups';

/**
 * Writes the drafts to the outbox in the caller's transaction. The payload names the group and the number by uuid (the consumers in other
 * domains must not need internal ids); the Meta group id is there because the inbox thread is keyed on it.
 */
export async function emitGroupEvents(
  outbox: OutboxService,
  tx: Tx,
  orgId: number,
  group: { id: number; uuid: string; group_id: string; subject: string | null },
  connectionUuid: string,
  drafts: GroupEventDraft[],
): Promise<void> {
  for (const d of drafts) {
    await outbox.emit(tx, {
      orgId,
      aggregateModule: GROUP_AGGREGATE,
      aggregateId: group.id,
      eventType: d.type,
      payload: {
        groupUuid: group.uuid,
        connectionId: connectionUuid,
        groupId: group.group_id,
        subject: group.subject,
        ...d.extra,
      },
    });
  }
}
